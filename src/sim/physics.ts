import type { Fan, Forging, Shield, Vec3 } from '../domain/types';
import { getShieldMaterial, getSteel } from '../domain/materials';
import { characteristicLength, shapeSurfaceM2, shapeVolumeM3, MM } from '../domain/geometry';

// 物理常量与环境参数
export const SIGMA = 5.670374419e-8; // Stefan-Boltzmann W/(m2 K4)
export const T_AMB_C = 35; // 夏季车间环境温度 ℃
export const T_AMB_K = T_AMB_C + 273.15;
export const GROUND_EMISSIVITY = 0.9;
// 职业接触辐射热通量判据 W/m2（预警 / 超限）
export const FLUX_WARN = 175;
export const FLUX_LIMIT = 350;

export interface PieceThermal {
  forging: Forging;
  // 缓存几何/物性（SI）
  volume: number;
  area: number;
  length: number;
  radius: number;
  height: number;
  eps: number;
  capacity: number; // rho*cp*V  J/K
  conductance: number; // 心表导热电导 kA/L  W/K
  // 状态（K）
  ts: number;
  tc: number;
}

export function makeThermal(f: Forging): PieceThermal {
  const steel = getSteel(f.steelId);
  const volume = shapeVolumeM3(f.shape);
  const area = shapeSurfaceM2(f.shape);
  const length = characteristicLength(f.shape);
  const t0 = f.dischargeTemp + 273.15;
  return {
    forging: f,
    volume,
    area,
    length,
    radius: (f.shape.outerD / 2) * MM,
    height: f.shape.height * MM,
    eps: steel.emissivity,
    capacity: steel.rho * steel.cp * volume,
    conductance: (steel.k * area) / length,
    ts: t0,
    tc: t0,
  };
}

// 同轴平行圆盘视因子（Howell 标准解析式），r 为中心距，R 为源圆盘半径
export function diskViewFactor(r: number, R: number): number {
  if (r <= 1e-6) return 0;
  const rr = R / r;
  if (rr < 1e-4) return rr * rr; // 远场退化为立体角/π，保证 1/r² 衰减
  const r2 = rr * rr;
  const s = 2 + 1 / r2;
  const f = 0.5 * (s - Math.sqrt(Math.max(0, s * s - 4)));
  return Math.min(0.95, f);
}

// 空间点对竖直圆柱侧面的视因子：可见弧面立体角近似（侧向受照专用）
// 输入水平中心距 d、圆柱半径 R、点与圆柱中心的高度差 dy、圆柱半高 hh
export function pointCylinderViewFactor(d: number, R: number, dy: number, hh: number): number {
  if (d <= R) return 0.25;
  // 可见弧面半角（圆柱遮挡自身一半，故不用 2β）
  const beta = Math.asin(Math.min(1, R / d));
  // 竖直张角覆盖比例
  const vert = Math.min(1, (Math.atan2(hh - dy, d) + Math.atan2(hh + dy, d)) / Math.PI);
  return Math.min(0.5, Math.max(0, (beta / Math.PI) * vert * 2));
}

// 两件等径有限高圆柱的侧面互视因子：1/d 衰减（交叉串公式工程化）
// 贴件 ~0.22，远场平滑退化为点-圆柱解
export function pairViewFactor(a: PieceThermal, b: PieceThermal): number {
  const dx = (a.forging.pos.x - b.forging.pos.x) * MM;
  const dz = (a.forging.pos.z - b.forging.pos.z) * MM;
  const r = Math.hypot(dx, dz);
  const R = Math.max(a.radius, b.radius);
  const minR = a.radius + b.radius;
  if (r < minR) return 0;
  const hh = Math.max(a.height, b.height) / 2;
  // 高度覆盖：有限高圆柱在侧向的有效投影占比
  const cover = Math.min(1, (2 * hh) / r);
  const fClose = (R / (Math.PI * r)) * cover;
  const fFar = pointCylinderViewFactor(r, R, 0, hh);
  // 近场用串公式，3R 外交接给点-圆柱解
  const k = Math.min(1, Math.max(0, (r / R - 1) / 2));
  return Math.min(0.45, fClose * (1 - k * 0.5) + fFar * k * 0.5);
}

// 线段（水平面）与屏面板求交，返回沿线段参数 t 与遮挡高度覆盖率
interface ShieldHit {
  t: number;
  cover: number; // 0~1
}

function rayVsShield(p0: Vec3, p1: Vec3, sh: Shield): ShieldHit | null {
  const yaw = (sh.yawDeg * Math.PI) / 180;
  // 屏局部坐标：u 沿屏长，v 沿法向
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const ox = p0.x - sh.pos.x;
  const oz = p0.z - sh.pos.z;
  const v0 = ox * cos - oz * sin; // 法向分量
  const vd = dx * cos - dz * sin;
  if (Math.abs(vd) < 1e-9) return null;
  const t = -v0 / vd;
  if (t <= 0 || t >= 1) return null;
  const u0 = ox * sin + oz * cos;
  const ud = dx * sin + dz * cos;
  const u = u0 + t * ud;
  if (Math.abs(u) > sh.length / 2 + sh.thickness / 2) return null;
  // 高度覆盖：屏高相对于连线两端高度的遮挡比例（取中点高度近似）
  const yMid = (p0.y + p1.y) / 2;
  const cover = Math.min(1, Math.max(0, sh.height / Math.max(sh.height, yMid)));
  return { t, cover };
}

export interface PairLink {
  i: number;
  j: number;
  f: number; // 视因子（已乘遮挡衰减）
}

// 构建近场互烤对，含隔热屏遮挡；cullMm 之外不产生可见性
export function buildPairs(pieces: PieceThermal[], shields: Shield[], cullMm = 4500): PairLink[] {
  const links: PairLink[] = [];
  const cull2 = cullMm * cullMm;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i].forging.pos;
      const b = pieces[j].forging.pos;
      const d2 = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
      if (d2 > cull2) continue;
      let f = pairViewFactor(pieces[i], pieces[j]);
      if (f < 0.002) continue;
      // 隔热屏遮挡
      let block = 0;
      for (const sh of shields) {
        const hit = rayVsShield(a, b, sh);
        if (hit) {
          const mat = getShieldMaterial(sh.matId);
          block = Math.max(block, hit.cover * mat.absorptivity);
        }
      }
      f *= 1 - block;
      if (f < 0.002) continue;
      links.push({ i, j, f });
    }
  }
  return links;
}

// 风机在某点产生的风速 m/s
export function fanWindAt(p: Vec3, fans: Fan[]): number {
  let w = 0;
  for (const fan of fans) {
    const dx = p.x - fan.pos.x;
    const dz = p.z - fan.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > fan.range || d < 1) continue;
    const yaw = (fan.yawDeg * Math.PI) / 180;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const align = (dx / d) * fx + (dz / d) * fz;
    const halfCos = Math.cos((fan.coneDeg * Math.PI) / 360);
    const cone = align > halfCos ? 1 : Math.max(0, 0.08 * align);
    const decay = 1 - d / fan.range;
    w = Math.max(w, fan.speed * cone * decay);
  }
  return w;
}

// 自然对流 h = 1.32*(ΔT/L)^0.25；强制对流 Jürges 公式
export function convectionH(deltaTK: number, length: number, wind: number): number {
  const hNat = 1.32 * Math.pow(Math.max(0, deltaTK) / Math.max(length, 0.05), 0.25);
  const hForce = wind > 0.05 ? 10.45 - wind + 10 * Math.sqrt(wind) : 0;
  return hNat + hForce;
}

export interface Deriv {
  dts: number;
  dtc: number;
}

// 单件双节点导数；neighborRad 为相邻锻件贡献的等效入射辐射温度四次方项（K4）
export function pieceDeriv(
  p: PieceThermal,
  neighborT4: number,
  neighborWeight: number,
  wind: number,
): Deriv {
  const ts4 = p.ts ** 4;
  const fAmb = Math.max(0, 1 - neighborWeight);
  const effT4 = fAmb * T_AMB_K ** 4 + neighborT4;
  const qRad = p.eps * SIGMA * p.area * (ts4 - effT4);
  const h = convectionH(p.ts - T_AMB_K, p.length, wind);
  const qConv = h * p.area * (p.ts - T_AMB_K);
  const qCond = p.conductance * (p.tc - p.ts);
  const halfC = p.capacity / 2;
  return {
    dts: (qCond - qRad - qConv) / halfC,
    dtc: -qCond / halfC,
  };
}

// 单步 RK4，状态就地写回 pieces
export function rk4Step(
  pieces: PieceThermal[],
  links: PairLink[],
  fans: Fan[],
  dt: number,
): void {
  const n = pieces.length;
  const save = pieces.map((p) => ({ ts: p.ts, tc: p.tc }));
  const k = [new Float64Array(n * 2), new Float64Array(n * 2), new Float64Array(n * 2), new Float64Array(n * 2)];

  for (let stage = 0; stage < 4; stage++) {
    if (stage > 0) {
      const f = stage === 1 ? 0.5 : stage === 2 ? 0.5 : 1;
      for (let i = 0; i < n; i++) {
        pieces[i].ts = save[i].ts + k[stage - 1][i * 2] * dt * f;
        pieces[i].tc = save[i].tc + k[stage - 1][i * 2 + 1] * dt * f;
      }
    }
    // 邻居等效 T4 汇总
    const nbT4 = new Float64Array(n);
    const nbW = new Float64Array(n);
    for (const l of links) {
      const fji = (pieces[l.i].area * l.f) / pieces[l.j].area;
      nbT4[l.i] += l.f * pieces[l.j].ts ** 4;
      nbW[l.i] += l.f;
      nbT4[l.j] += fji * pieces[l.i].ts ** 4;
      nbW[l.j] += fji;
    }
    for (let i = 0; i < n; i++) {
      const wind = fanWindAt(pieces[i].forging.pos, fans);
      const d = pieceDeriv(pieces[i], nbT4[i], Math.min(0.85, nbW[i]), wind);
      k[stage][i * 2] = d.dts;
      k[stage][i * 2 + 1] = d.dtc;
    }
  }

  for (let i = 0; i < n; i++) {
    pieces[i].ts = save[i].ts + (dt / 6) * (k[0][i * 2] + 2 * k[1][i * 2] + 2 * k[2][i * 2] + k[3][i * 2]);
    pieces[i].tc = save[i].tc + (dt / 6) * (k[0][i * 2 + 1] + 2 * k[1][i * 2 + 1] + 2 * k[2][i * 2 + 1] + k[3][i * 2 + 1]);
  }
}
