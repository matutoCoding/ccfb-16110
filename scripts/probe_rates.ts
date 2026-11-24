import { buildSeedLayout, buildSeedBatchAndForgings } from '../src/db/seed';
import { runSimulation, DEFAULT_SIM_CONFIG } from '../src/sim/engine';

const layout = buildSeedLayout();
const { forgings } = buildSeedBatchAndForgings(layout);
const full = await runSimulation(forgings, layout, { ...DEFAULT_SIM_CONFIG, onProgress: undefined });
const rates = full.verdicts.map((v) => v.rate700_500).sort((a, b) => a - b);
const q = (p: number) => rates[Math.floor(rates.length * p)];
console.log('冷速分布 ℃/s:');
console.log('  min', q(0).toFixed(4), ' p25', q(0.25).toFixed(4), ' 中位', q(0.5).toFixed(4), ' p75', q(0.75).toFixed(4), ' max', q(0.999).toFixed(4));
// 中心区 vs 边缘区
const center = full.verdicts.filter((v) => {
  const f = forgings.find((x) => x.id === v.forgingId)!;
  return f.pos.x > 18000 && f.pos.x < 42000 && f.pos.z > 12000 && f.pos.z < 30000;
}).map((v) => v.rate700_500);
const edge = full.verdicts.filter((v) => !center.includes(v.rate700_500)).map((v) => v.rate700_500);
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
console.log('中心区均速', avg(center).toFixed(4), ' 边缘区均速', avg(edge).toFixed(4), ' 件数', center.length, edge.length);
