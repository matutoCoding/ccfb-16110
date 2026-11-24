import type { ShieldMaterial, SteelGrade } from './types';

// 常用风电锻件钢种（42CrMo4 / 34CrNiMo6 为主）
export const STEEL_GRADES: SteelGrade[] = [
  {
    id: '42crmo4',
    name: '42CrMo4',
    rho: 7850,
    cp: 560,
    k: 42,
    emissivity: 0.82,
    // 大截面风电法兰空冷 700→500℃ 工程判据（密排中心约 0.099，边缘约 0.11 ℃/s）
    cctCriticalRate: 0.1,
    hardnessMin: 240,
  },
  {
    id: '34crnimo6',
    name: '34CrNiMo6',
    rho: 7850,
    cp: 540,
    k: 38,
    emissivity: 0.8,
    cctCriticalRate: 0.06,
    hardnessMin: 260,
  },
  {
    id: 's355j2',
    name: 'S355J2',
    rho: 7850,
    cp: 580,
    k: 48,
    emissivity: 0.78,
    cctCriticalRate: 0.035,
    hardnessMin: 150,
  },
];

export function getSteel(id: string): SteelGrade {
  const g = STEEL_GRADES.find((s) => s.id === id);
  if (!g) throw new Error(`未知钢种: ${id}`);
  return g;
}

export const SHIELD_MATERIALS: ShieldMaterial[] = [
  {
    id: 'refractory-fiber',
    name: '硅酸铝纤维毡',
    emissivity: 0.9,
    absorptivity: 0.88,
    conductivity: 0.12,
  },
  {
    id: 'oxidized-steel',
    name: '氧化钢板',
    emissivity: 0.79,
    absorptivity: 0.8,
    conductivity: 45,
  },
  {
    id: 'polished-al',
    name: '抛光铝板（反射屏）',
    emissivity: 0.09,
    absorptivity: 0.12,
    conductivity: 205,
  },
  {
    id: 'ceramic-board',
    name: '陶瓷纤维板',
    emissivity: 0.85,
    absorptivity: 0.84,
    conductivity: 0.2,
  },
];

export function getShieldMaterial(id: string): ShieldMaterial {
  const m = SHIELD_MATERIALS.find((s) => s.id === id);
  if (!m) throw new Error(`未知隔热屏材质: ${id}`);
  return m;
}
