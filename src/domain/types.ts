// 领域核心类型：场地、锻件、批次、测点、记录
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type ShapeKind = 'flange' | 'ring' | 'shaft';

export interface ShapeParams {
  kind: ShapeKind;
  // 外径 mm
  outerD: number;
  // 内径 mm（齿圈/法兰通孔，轴类为 0）
  innerD: number;
  // 轴向高度/长度 mm
  height: number;
  // 法兰盘厚度 mm（仅法兰）
  hubH?: number;
  // 法兰轮毂外径 mm（仅法兰）
  hubD?: number;
}

// 钢种热物性与 CCT 判据
export interface SteelGrade {
  id: string;
  name: string;
  // 密度 kg/m3
  rho: number;
  // 比热容 J/(kg·K)，按平均温区取常数
  cp: number;
  // 导热系数 W/(m·K)
  k: number;
  // 发射率
  emissivity: number;
  // CCT 判据：700→500℃ 的临界平均冷速 ℃/s，低于此值组织/硬度不达标
  cctCriticalRate: number;
  // 合格硬度下限 HBW
  hardnessMin: number;
}

export type ForgingStatus = 'cooling' | 'qualified' | 'rejected';

export interface Forging {
  id: string;
  batchId: string;
  shape: ShapeParams;
  steelId: string;
  // 地面码放中心坐标 mm
  pos: Vec3;
  // 出炉温度 ℃
  dischargeTemp: number;
  // 出炉时间（相对仿真原点，秒）
  dischargeTime: number;
  // 手动固定后不参与自动重排
  pinned: boolean;
  status: ForgingStatus;
}

export type SiteObjectKind = 'shield' | 'fan' | 'station' | 'aisle';

export interface ShieldMaterial {
  id: string;
  name: string;
  // 朝向锻件一侧的发射率
  emissivity: number;
  // 吸收率（不透明体 = 1 - 反射率）
  absorptivity: number;
  // 隔热当量导热 W/(m·K)，用于背侧温度估算
  conductivity: number;
}

export interface Shield {
  id: string;
  kind: 'shield';
  matId: string;
  // 屏体中心位置 mm
  pos: Vec3;
  // 屏面朝向（绕 z 轴角度，度）。0 = 法向朝 +x
  yawDeg: number;
  // 屏长（沿面方向）mm
  length: number;
  // 屏高 mm
  height: number;
  // 屏厚 mm
  thickness: number;
}

export interface Fan {
  id: string;
  kind: 'fan';
  pos: Vec3;
  yawDeg: number;
  // 出口风速 m/s
  speed: number;
  // 有效吹风锥角（度）
  coneDeg: number;
  // 有效射程 mm
  range: number;
}

export interface Station {
  id: string;
  kind: 'station';
  name: string;
  pos: Vec3;
  // 人员测量高度 mm（站立呼吸/躯干高度）
  measureH: number;
}

export interface Aisle {
  id: string;
  kind: 'aisle';
  name: string;
  // 过道矩形：中心 + 长宽 mm
  pos: Vec3;
  length: number;
  width: number;
}

export type SiteObject = Shield | Fan | Station | Aisle;

export interface YardLayout {
  id: string;
  name: string;
  // 实测场地尺寸 mm
  sizeX: number;
  sizeZ: number;
  objects: SiteObject[];
}

export interface Batch {
  id: string;
  name: string;
  steelId: string;
  shape: ShapeParams;
  dischargeTemp: number;
  dischargeTime: number;
  count: number;
  createdAt: number;
  note: string;
}

// 红外枪/热电偶实测点温
export interface TempReading {
  id: string;
  batchId: string;
  forgingId?: string;
  // 实测时刻（相对出炉，秒）
  t: number;
  // 实测温度 ℃
  tempC: number;
  // 测点位置 mm（红外空间点，无绑定锻件时使用）
  pos: Vec3;
  source: 'ir-gun' | 'thermocouple';
}

export interface HardnessRecord {
  id: string;
  batchId: string;
  forgingId: string;
  // 检验时刻相对出炉 秒
  t: number;
  hbw: number;
  // 取样位置：心部 / 表面 / 中间圈
  position: 'core' | 'surface' | 'mid-ring';
}

export interface ProcessRecord {
  id: string;
  batchId: string;
  title: string;
  createdAt: number;
  // 摆放方案快照
  layoutSnapshot: YardLayout;
  // 推演摘要
  simSummary: SimSummary;
  note: string;
}

export interface SimSummary {
  durationS: number;
  minAvgRate: number;
  rejectedCount: number;
  maxExposureWm2: number;
  // 每件的平均冷速 ℃/s（700→500℃）
  perForgingRate: Record<string, number>;
}

export interface ExposurePoint {
  stationId: string;
  x: number;
  z: number;
  h: number;
  fluxWm2: number;
  cumulativeS: number;
  overLimit: boolean;
}
