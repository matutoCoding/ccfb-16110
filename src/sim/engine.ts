import type { Batch, Forging, Shield, Station, Vec3, YardLayout } from '../domain/types';
import { getSteel } from '../domain/materials';
import { MM } from '../domain/geometry';
import {
  FLUX_LIMIT,
  buildPairs,
  fanWindAt,
  makeThermal,
  pointCylinderViewFactor,
  rk4Step,
  SIGMA,
  T_AMB_K,
  type PieceThermal,
} from './physics';
import { getShieldMaterial } from '../domain/materials';

export interface SimSample {
  t: number;
  ts: Float32Array;
  tc: Float32Array;
}

export interface ForgingVerdict {
  forgingId: string;
  rate700_500: number; // ℃/s
  criticalRate: number;
  qualified: boolean;
  tTo500S: number;
}

export interface ExposureSample {
  t: number;
  // 场地网格通量 W/m2
  grid: Float32Array;
  stationFlux: Record<string, number>;
}

export interface SimResult {
  forgingIds: string[];
  samples: SimSample[];
  verdicts: ForgingVerdict[];
  exposure: ExposureSample[];
  // 累计超限暴露时长（按 FLUX_LIMIT）秒
  cumulativeOver: Record<string, number>;
  gridNx: number;
  gridNz: number;
  durationS: number;
  stepS: number;
  rejectedIds: string[];
}

export interface SimConfig {
  durationS: number;
  stepS: number;
  sampleEvery: number;
  gridNx: number;
  gridNz: number;
  onProgress?: (p: number) => void;
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  durationS: 12 * 3600,
  stepS: 60,
  sampleEvery: 2,
  gridNx: 36,
  gridNz: 28,
};

// 测点/网格点受锻件辐射热通量，含隔热屏遮挡
export function fluxAtPoint(
  p: Vec3,
  heightMm: number,
  pieces: PieceThermal[],
  shields: Shield[],
): number {
  const target: Vec3 = { x: p.x, y: heightMm, z: p.z };
  let total = 0;
  for (const pc of pieces) {
    const src: Vec3 = { x: pc.forging.pos.x, y: pc.forging.shape.height * 0.5, z: pc.forging.pos.z };
    const dx = (src.x - target.x) * MM;
    const dz = (src.z - target.z) * MM;
    const dy = (src.y - heightMm) * MM;
    const r = Math.hypot(dx, dy, dz);
    if (r < 0.4) continue;
    const horiz = Math.hypot(dx, dz);
    const srcHalfH = pc.forging.shape.height * MM * 0.5;
    let f = pointCylinderViewFactor(horiz, pc.radius, -dy, srcHalfH);
    let block = 0;
    for (const sh of shields) {
      const yaw = (sh.yawDeg * Math.PI) / 180;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const ox = target.x - sh.pos.x;
      const oz = target.z - sh.pos.z;
      const v0 = ox * cos - oz * sin;
      const vd = (src.x - target.x) * cos - (src.z - target.z) * sin;
      if (Math.abs(vd) < 1e-9) continue;
      const t = -v0 / vd;
      if (t <= 0 || t >= 1) continue;
      const u = ox * sin + oz * cos + t * ((src.x - target.x) * sin + (src.z - target.z) * cos);
      if (Math.abs(u) > sh.length / 2) continue;
      const mat = getShieldMaterial(sh.matId);
      block = Math.max(block, mat.absorptivity);
    }
    f *= 1 - block;
    total += pc.eps * SIGMA * (pc.ts ** 4 - T_AMB_K ** 4) * f;
  }
  return Math.max(0, total);
}

export async function runSimulation(
  forgings: Forging[],
  layout: YardLayout,
  config: SimConfig = DEFAULT_SIM_CONFIG,
): Promise<SimResult> {
  const pieces = forgings.map(makeThermal);
  const shields = layout.objects.filter((o): o is Shield => o.kind === 'shield');
  const fans = layout.objects.filter((o) => o.kind === 'fan');
  const stations = layout.objects.filter((o): o is Station => o.kind === 'station');
  const links = buildPairs(pieces, shields);

  const steps = Math.round(config.durationS / config.stepS);
  const samples: SimSample[] = [];
  const exposure: ExposureSample[] = [];
  const snap = (t: number): SimSample => ({
    t,
    ts: Float32Array.from(pieces.map((p) => p.ts)),
    tc: Float32Array.from(pieces.map((p) => p.tc)),
  });
  samples.push(snap(0));

  const cumulativeOver: Record<string, number> = {};
  for (const st of stations) cumulativeOver[st.id] = 0;

  for (let step = 1; step <= steps; step++) {
    rk4Step(pieces, links, fans, config.stepS);
    const t = step * config.stepS;
    if (step % config.sampleEvery === 0) samples.push(snap(t));

    if (step % (config.sampleEvery * 5) === 0) {
      const grid = new Float32Array(config.gridNx * config.gridNz);
      const stationFlux: Record<string, number> = {};
      for (let gz = 0; gz < config.gridNz; gz++) {
        for (let gx = 0; gx < config.gridNx; gx++) {
          const x = (layout.sizeX * (gx + 0.5)) / config.gridNx;
          const z = (layout.sizeZ * (gz + 0.5)) / config.gridNz;
          grid[gz * config.gridNx + gx] = fluxAtPoint({ x, y: 0, z }, 1500, pieces, shields);
        }
      }
      for (const st of stations) {
        const f = fluxAtPoint(st.pos, st.measureH, pieces, shields);
        stationFlux[st.id] = f;
        if (f > FLUX_LIMIT) cumulativeOver[st.id] += config.stepS * config.sampleEvery * 5;
      }
      exposure.push({ t, grid, stationFlux });
    }

    if (step % 20 === 0) {
      config.onProgress?.(step / steps);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // CCT 判定（每件独立取时间序列）
  const verdicts: ForgingVerdict[] = pieces.map((pc, idx) => {
    const steel = getSteel(pc.forging.steelId);
    let t700 = -1;
    let t500 = -1;
    const findTime = (targetC: number): number => {
      let p = samples[0];
      for (const s of samples) {
        const tsC = s.ts[idx] - 273.15;
        if (tsC <= targetC) {
          const pC = p.ts[idx] - 273.15;
          const k = (pC - targetC) / Math.max(1e-6, pC - tsC);
          return p.t + (s.t - p.t) * k;
        }
        p = s;
      }
      return -1;
    };
    t700 = findTime(700);
    t500 = findTime(500);
    const rate = t700 > 0 && t500 > t700 ? 200 / (t500 - t700) : 0;
    return {
      forgingId: pc.forging.id,
      rate700_500: rate,
      criticalRate: steel.cctCriticalRate,
      qualified: rate >= steel.cctCriticalRate,
      tTo500S: t500,
    };
  });

  const rejectedIds = verdicts.filter((v) => !v.qualified).map((v) => v.forgingId);
  config.onProgress?.(1);
  return {
    forgingIds: pieces.map((p) => p.forging.id),
    samples,
    verdicts,
    exposure,
    cumulativeOver,
    gridNx: config.gridNx,
    gridNz: config.gridNz,
    durationS: config.durationS,
    stepS: config.stepS,
    rejectedIds,
  };
}

// 按时间取插值温度帧（K）
export function sampleAt(result: SimResult, t: number): { ts: Float32Array; tc: Float32Array } {
  const s = result.samples;
  if (t <= 0) return { ts: s[0].ts, tc: s[0].tc };
  if (t >= s[s.length - 1].t) return { ts: s[s.length - 1].ts, tc: s[s.length - 1].tc };
  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const k = (t - s[lo].t) / (s[hi].t - s[lo].t);
  const n = s[0].ts.length;
  const ts = new Float32Array(n);
  const tc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ts[i] = s[lo].ts[i] + (s[hi].ts[i] - s[lo].ts[i]) * k;
    tc[i] = s[lo].tc[i] + (s[hi].tc[i] - s[lo].tc[i]) * k;
  }
  return { ts, tc };
}

// 风场快照供建议/调试
export function windSummary(forgings: Forging[], layout: YardLayout): Record<string, number> {
  const fans = layout.objects.filter((o) => o.kind === 'fan');
  const out: Record<string, number> = {};
  for (const f of forgings) out[f.id] = fanWindAt(f.pos, fans);
  return out;
}

export function batchSteel(b: Batch): string {
  return b.steelId;
}
