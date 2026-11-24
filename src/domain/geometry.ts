import type { ShapeParams, Vec3 } from './types';

// 几何工具：全部内部计算转 SI（米），存储仍用 mm
export const MM = 0.001;

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function dist2D(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// 锻件等效体积 m3（按截面旋转体）
export function shapeVolumeM3(s: ShapeParams): number {
  const R = (s.outerD / 2) * MM;
  const r = (s.innerD / 2) * MM;
  const h = s.height * MM;
  const ringArea = Math.PI * (R * R - r * r);
  if (s.kind === 'flange' && s.hubD && s.hubH) {
    // 法兰 = 盘体（环形）+ 轮毂（环形柱）
    const hubR = (s.hubD / 2) * MM;
    const hubArea = Math.PI * (hubR * hubR - r * r);
    return ringArea * (h - s.hubH * MM) + hubArea * (s.hubH * MM);
  }
  return ringArea * h;
}

// 锻件外表面积 m2（外圆柱面 + 上下环面，内孔近似忽略辐射贡献）
export function shapeSurfaceM2(s: ShapeParams): number {
  const R = (s.outerD / 2) * MM;
  const r = (s.innerD / 2) * MM;
  const h = s.height * MM;
  const outerSide = 2 * Math.PI * R * h;
  const topRing = Math.PI * (R * R - r * r);
  let extra = 0;
  if (s.kind === 'flange' && s.hubD && s.hubH) {
    const hubR = (s.hubD / 2) * MM;
    const hubH = s.hubH * MM;
    extra = 2 * Math.PI * hubR * hubH;
  }
  return outerSide + 2 * topRing + extra;
}

// 等效特征长度（Bi 数用）= 体积 / 表面积
export function characteristicLength(s: ShapeParams): number {
  return shapeVolumeM3(s) / shapeSurfaceM2(s);
}

// 轴类卧放时的占地半径 mm；其余为外半径
export function footprintRadiusMm(s: ShapeParams): number {
  return s.outerD / 2;
}

// 黑体辐射色温映射（输入摄氏温度，输出线性 sRGB 前的线性 RGB 与归一化亮度）
// 参考 Tanner Helland 黑体近似 + 暗红尾段手工过渡
export interface BlackbodyColor {
  r: number;
  g: number;
  b: number;
  // 发光强度 0~1，用于 bloom 阈值与夜间光强
  intensity: number;
}

export function blackbodyColor(tempC: number): BlackbodyColor {
  const t = tempC + 273.15;
  let r: number;
  let g: number;
  let b: number;
  const t100 = t / 100;

  if (t <= 660) r = 0;
  else r = 329.698727446 * Math.pow(t100 - 60, -0.1332047592);
  if (t <= 660) g = 99.4708025861 * Math.log(t100) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t100 - 60, -0.0755148492);
  if (t >= 660) b = 255;
  else if (t <= 190) b = 0;
  else b = 138.5177312231 * Math.log(t100 - 10) - 305.0447927307;

  const clamp255 = (x: number) => Math.min(255, Math.max(0, x)) / 255;
  r = clamp255(r);
  g = clamp255(g);
  b = clamp255(b);

  // 500℃ 以下进入暗红可见尾段，700℃ 以上全亮
  const intensity = Math.min(1, Math.max(0, (tempC - 380) / 420));
  if (tempC < 500) {
    const k = Math.max(0, (tempC - 350) / 150);
    r *= 0.25 + 0.75 * k;
    g *= 0.08 * k;
    b = 0;
  }
  return { r, g, b, intensity };
}

// 热像伪彩：铁红 rainbow（蓝→青→黄→红→白）
export function thermalPseudoColor(norm: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, norm));
  const stops: Array<[number, [number, number, number]]> = [
    [0, [0.05, 0.02, 0.18]],
    [0.25, [0.1, 0.25, 0.75]],
    [0.5, [0.15, 0.75, 0.65]],
    [0.7, [0.95, 0.85, 0.2]],
    [0.88, [0.95, 0.35, 0.1]],
    [1, [0.95, 0.95, 0.92]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (x >= t0 && x <= t1) {
      const k = (x - t0) / (t1 - t0);
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k,
      ];
    }
  }
  return stops[stops.length - 1][1];
}
