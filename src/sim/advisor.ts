import type { Forging, YardLayout } from '../domain/types';
import type { ForgingVerdict, SimResult } from './engine';
import { fanWindAt } from './physics';
import { footprintRadiusMm } from '../domain/geometry';

export interface CoolingAdvice {
  forgingId: string;
  problem: string;
  // 建议净间距 mm
  suggestGapMm: number;
  // 建议挪动目标点（风机下风口）
  target?: { x: number; z: number; fanId: string };
  expectedGain: string;
}

// 对冷速不达标的件：先找最近风机下风口，再给间距建议
export function advise(
  forgings: Forging[],
  result: SimResult,
  layout: YardLayout,
): CoolingAdvice[] {
  const fans = layout.objects.filter((o) => o.kind === 'fan');
  const verdictMap = new Map(result.verdicts.map((v) => [v.forgingId, v]));
  const out: CoolingAdvice[] = [];

  for (const f of forgings) {
    const v = verdictMap.get(f.id);
    if (!v || v.qualified) continue;

    // 当前最小净距
    const r = footprintRadiusMm(f.shape);
    let minGap = Infinity;
    for (const o of forgings) {
      if (o.id === f.id) continue;
      const d = Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z);
      const gap = d - r - footprintRadiusMm(o.shape);
      if (gap < minGap) minGap = gap;
    }
    const deficit = v.criticalRate / Math.max(v.rate700_500, 1e-6);
    const suggestGap = Math.round(Math.min(1800, Math.max(400, (minGap === Infinity ? 400 : minGap) * Math.sqrt(deficit)) / 50) * 50);

    let target: CoolingAdvice['target'];
    let bestWind = fanWindAt(f.pos, fans);
    for (const fan of fans) {
      const yaw = (fan.yawDeg * Math.PI) / 180;
      // 下风口 1.5m 候选点
      const tx = fan.pos.x + Math.sin(yaw) * 1500;
      const tz = fan.pos.z + Math.cos(yaw) * 1500;
      if (tx < 500 || tz < 500 || tx > layout.sizeX - 500 || tz > layout.sizeZ - 500) continue;
      const w = fanWindAt({ x: tx, y: 0, z: tz }, fans);
      if (w > bestWind + 0.5) {
        bestWind = w;
        target = { x: tx, z: tz, fanId: fan.id };
      }
    }

    out.push({
      forgingId: f.id,
      problem: `700→500℃ 冷速 ${v.rate700_500.toFixed(3)} ℃/s，低于临界 ${v.criticalRate} ℃/s`,
      suggestGapMm: suggestGap,
      target,
      expectedGain: target
        ? `挪至风机 ${target.fanId} 下风口，局部风速 ${bestWind.toFixed(1)} m/s，预计冷速提升 ${Math.round((bestWind + 1) * 22)}%`
        : `净间距加大到 ${suggestGap} mm，降低相邻件辐射互烤`,
    });
  }
  return out;
}

export function verdictMapOf(result: SimResult): Map<string, ForgingVerdict> {
  return new Map(result.verdicts.map((v) => [v.forgingId, v]));
}
