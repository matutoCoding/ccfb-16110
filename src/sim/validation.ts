// 独立手算对照（验收第二条）：与 sim/ 引擎零代码共享，仅复用几何体积/面积公式
// 经典四阶 Runge-Kutta，细步长 5s，双节点（心部/表面）辐射+对流
import type { Forging } from '../domain/types';
import { shapeSurfaceM2, shapeVolumeM3 } from '../domain/geometry';
import { getSteel } from '../domain/materials';
import type { SimResult } from './engine';

const SB = 5.670374419e-8;
const AMB_K = 35 + 273.15;
const DT_S = 5;

interface HandState {
  ts: number;
  tc: number;
}

// 单件（无邻居、无风）双节点导数 —— 手写教科书公式
function derivatives(f: Forging, s: HandState): HandState {
  const steel = getSteel(f.steelId);
  const V = shapeVolumeM3(f.shape);
  const A = shapeSurfaceM2(f.shape);
  const L = V / A;
  const C = steel.rho * steel.cp * V;
  const G = (steel.k * A) / L;

  const dT = Math.max(0, s.ts - AMB_K);
  const hNat = 1.32 * Math.pow(dT / Math.max(L, 0.05), 0.25);
  const qRad = steel.emissivity * SB * A * (s.ts ** 4 - AMB_K ** 4);
  const qConv = hNat * A * dT;
  const qCond = G * (s.tc - s.ts);
  return {
    ts: (qCond - qRad - qConv) / (C / 2),
    tc: -qCond / (C / 2),
  };
}

function rk4(f: Forging, s: HandState, dt: number): HandState {
  const k1 = derivatives(f, s);
  const k2 = derivatives(f, { ts: s.ts + k1.ts * dt / 2, tc: s.tc + k1.tc * dt / 2 });
  const k3 = derivatives(f, { ts: s.ts + k2.ts * dt / 2, tc: s.tc + k2.tc * dt / 2 });
  const k4 = derivatives(f, { ts: s.ts + k3.ts * dt, tc: s.tc + k3.tc * dt });
  return {
    ts: s.ts + (dt / 6) * (k1.ts + 2 * k2.ts + 2 * k3.ts + k4.ts),
    tc: s.tc + (dt / 6) * (k1.tc + 2 * k2.tc + 2 * k3.tc + k4.tc),
  };
}

export interface HandCurve {
  times: number[];
  surfaceC: number[];
  coreC: number[];
}

// 独立手算完整冷却曲线
export function handCalcCurve(forging: Forging, durationS: number): HandCurve {
  const t0 = forging.dischargeTemp + 273.15;
  let s: HandState = { ts: t0, tc: t0 };
  const times: number[] = [0];
  const surfaceC: number[] = [forging.dischargeTemp];
  const coreC: number[] = [forging.dischargeTemp];
  const steps = Math.round(durationS / DT_S);
  for (let i = 1; i <= steps; i++) {
    s = rk4(forging, s, DT_S);
    if (i % 12 === 0) {
      times.push(i * DT_S);
      surfaceC.push(s.ts - 273.15);
      coreC.push(s.tc - 273.15);
    }
  }
  return { times, surfaceC, coreC };
}

export interface ValidationRow {
  forgingId: string;
  steel: string;
  shape: string;
  maxSurfaceErrPct: number;
  maxCoreErrPct: number;
  atTimeS: number;
  engineSurfaceC: number;
  handSurfaceC: number;
  passed: boolean;
}

export interface ValidationReport {
  rows: ValidationRow[];
  passed: boolean;
  thresholdPct: number;
  note: string;
}

function engineTempAt(result: SimResult, id: string, t: number): { ts: number; tc: number } {
  const idx = result.forgingIds.indexOf(id);
  const s = result.samples;
  if (t <= 0) return { ts: s[0].ts[idx] - 273.15, tc: s[0].tc[idx] - 273.15 };
  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const k = (t - s[lo].t) / (s[hi].t - s[lo].t);
  return {
    ts: (s[lo].ts[idx] + (s[hi].ts[idx] - s[lo].ts[idx]) * k) - 273.15,
    tc: (s[lo].tc[idx] + (s[hi].tc[idx] - s[lo].tc[idx]) * k) - 273.15,
  };
}

// 对照：手算取孤立件（无互烤）；引擎结果中若该件处于批次内，需另跑孤立仿真后再比
export function compareCurves(
  forging: Forging,
  isolatedResult: SimResult,
  hand: HandCurve,
): ValidationRow {
  let maxSurf = 0;
  let maxCore = 0;
  let atT = 0;
  let es = 0;
  let hs = 0;
  for (let i = 0; i < hand.times.length; i++) {
    const t = hand.times[i];
    const eng = engineTempAt(isolatedResult, forging.id, t);
    // 相对误差按摄氏温标（起点附近温差小，改按相对于室温的温升归一）
    const baseSurf = Math.max(50, hand.surfaceC[i] - 35);
    const baseCore = Math.max(50, hand.coreC[i] - 35);
    const eS = Math.abs(eng.ts - hand.surfaceC[i]) / baseSurf;
    const eC = Math.abs(eng.tc - hand.coreC[i]) / baseCore;
    if (eS > maxSurf) {
      maxSurf = eS;
      atT = t;
      es = eng.ts;
      hs = hand.surfaceC[i];
    }
    maxCore = Math.max(maxCore, eC);
  }
  return {
    forgingId: forging.id,
    steel: getSteel(forging.steelId).name,
    shape: `${forging.shape.kind} D${forging.shape.outerD}×H${forging.shape.height}`,
    maxSurfaceErrPct: maxSurf * 100,
    maxCoreErrPct: maxCore * 100,
    atTimeS: atT,
    engineSurfaceC: es,
    handSurfaceC: hs,
    passed: maxSurf * 100 <= 3 && maxCore * 100 <= 3,
  };
}

export function buildReport(rows: ValidationRow[]): ValidationReport {
  const passed = rows.every((r) => r.passed);
  return {
    rows,
    passed,
    thresholdPct: 3,
    note: passed
      ? '三件独立手算与引擎曲线最大偏差均 ≤3%，物理模型通过验收'
      : '存在偏差超 3% 的锻件，需检查积分步长与热物性参数',
  };
}
