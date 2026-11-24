// 300 件压力场景：码放、整批仿真耗时、CCT 判定、暴露网格全链路
import { buildSeedLayout } from '../src/db/seed';
import { runSimulation, DEFAULT_SIM_CONFIG } from '../src/sim/engine';
import { autoPack } from '../src/domain/layout_rules';
import type { Forging, ShapeParams } from '../src/domain/types';

const layout = buildSeedLayout();
const shape: ShapeParams = {
  kind: 'flange',
  outerD: 1800,
  innerD: 700,
  height: 320,
  hubD: 950,
  hubH: 140,
};
const pack = autoPack(layout, shape, 300, { gapMm: 350, startId: 1 });
const forgings: Forging[] = pack.positions.map((pos, i) => ({
  id: `fg-${String(i + 1).padStart(5, '0')}`,
  batchId: 'stress-300',
  shape: { ...shape },
  steelId: '42crmo4',
  pos,
  dischargeTemp: 860,
  dischargeTime: i * 10,
  pinned: false,
  status: 'cooling',
}));

console.log(`码放 ${forgings.length} 件（请求 300，实际 ${pack.placed}，跳过 ${pack.skipped}）`);
const t0 = performance.now();
const result = await runSimulation(forgings, layout, DEFAULT_SIM_CONFIG);
const elapsed = performance.now() - t0;
const rejected = result.rejectedIds.length;
const out = {
  pieces: forgings.length,
  simElapsedMs: Math.round(elapsed),
  samples: result.samples.length,
  exposureFrames: result.exposure.length,
  rejected,
  rejectionPct: Number(((rejected / forgings.length) * 100).toFixed(1)),
  pairsPerPiece: 'see physics.buildPairs',
};
console.log(JSON.stringify(out, null, 2));
if (forgings.length < 300) {
  console.error('未达 300 件容量');
  process.exit(1);
}
if (elapsed > 60000) {
  console.error('300 件仿真超时');
  process.exit(1);
}
console.log('STRESS_300_OK');
