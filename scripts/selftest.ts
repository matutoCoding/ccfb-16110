// Node 端物理自测：手算对照误差、200 件整批仿真耗时、码放与通量健全性
// 由 esbuild 临时打包后用 node 运行，不进入生产产物
import { buildSeedLayout, buildSeedBatchAndForgings } from '../src/db/seed';
import { runSimulation, DEFAULT_SIM_CONFIG, fluxAtPoint } from '../src/sim/engine';
import { handCalcCurve, compareCurves, buildReport } from '../src/sim/validation';
import { makeThermal } from '../src/sim/physics';
import { marchingSquares } from '../src/sim/contours';
import type { Forging } from '../src/domain/types';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  console.log(`  ok - ${msg}`);
}

async function main(): Promise<void> {
  console.log('[1] 种子数据与自动码放');
  const layout = buildSeedLayout();
  const { forgings } = buildSeedBatchAndForgings(layout);
  assert(forgings.length === 200, `生成 200 件法兰（实际 ${forgings.length}）`);
  const inBounds = forgings.every((f) => f.pos.x > 0 && f.pos.x < layout.sizeX && f.pos.z > 0 && f.pos.z < layout.sizeZ);
  assert(inBounds, '全部锻件落在场地边界内');
  let minGap = Infinity;
  for (let i = 0; i < forgings.length; i++) {
    for (let j = i + 1; j < forgings.length; j++) {
      const d = Math.hypot(forgings[i].pos.x - forgings[j].pos.x, forgings[i].pos.z - forgings[j].pos.z);
      minGap = Math.min(minGap, d - forgings[i].shape.outerD);
    }
  }
  assert(minGap >= 499, `相邻净间距 ≥500mm（实测最小 ${minGap.toFixed(0)}mm）`);

  console.log('[2] 三件独立手算对照（验收第二条，阈值 3%）');
  const probes: Forging[] = [forgings[0], forgings[100], forgings[199]];
  const rows = [];
  for (const f of probes) {
    const isolated: Forging = { ...f, id: `iso-${f.id}`, pos: { x: 2000, y: 0, z: 2000 } };
    const t0 = performance.now();
    const isoResult = await runSimulation([isolated], layout, {
      ...DEFAULT_SIM_CONFIG,
      durationS: 6 * 3600,
      sampleEvery: 1,
      gridNx: 4,
      gridNz: 4,
    });
    const hand = handCalcCurve(f, 6 * 3600);
    const row = compareCurves(isolated, isoResult, hand);
    row.forgingId = f.id;
    rows.push(row);
    console.log(`  ${f.id}: 表面最大误差 ${row.maxSurfaceErrPct.toFixed(3)}% 心部 ${row.maxCoreErrPct.toFixed(3)}% (孤立仿真 ${(performance.now() - t0).toFixed(0)}ms)`);
  }
  const report = buildReport(rows);
  assert(report.passed, report.note);

  console.log('[3] 200 件整批仿真（RK4 12h，含互烤/遮挡/风场/暴露网格）');
  const t0 = performance.now();
  const full = await runSimulation(forgings, layout, DEFAULT_SIM_CONFIG);
  const elapsed = performance.now() - t0;
  console.log(`  整批耗时 ${elapsed.toFixed(0)}ms，采样帧 ${full.samples.length}，暴露帧 ${full.exposure.length}`);
  assert(elapsed < 60000, `整批仿真 60s 内完成（实际 ${elapsed.toFixed(0)}ms）`);
  assert(full.verdicts.length === 200, '每件都有 CCT 判定');
  const rejected = full.rejectedIds.length;
  console.log(`  冷速不达标 ${rejected} 件，达标率 ${(((200 - rejected) / 200) * 100).toFixed(1)}%`);
  assert(rejected > 0 && rejected < 200, '存在部分不达标件（密排中间圈效应）');

  console.log('[4] 人员暴露通量与等值线');
  const pieces = forgings.map(makeThermal);
  const shields = layout.objects.filter((o) => o.kind === 'shield');
  const hotFlux = fluxAtPoint({ x: 8000, y: 0, z: 6000 }, 1500, pieces, shields);
  const farFlux = fluxAtPoint({ x: 59000, y: 0, z: 39000 }, 1500, pieces, shields);
  console.log(`  近料过道通量 ${hotFlux.toFixed(0)} W/m2，场地角落 ${farFlux.toFixed(0)} W/m2`);
  assert(hotFlux > farFlux * 3, '近料点通量显著高于远场角落');
  const frame = full.exposure[Math.floor(full.exposure.length / 2)];
  const levels = marchingSquares(frame.grid, full.gridNx, full.gridNz, layout.sizeX, layout.sizeZ, [175, 350]);
  const segCount = levels.reduce((n, l) => n + l.lines.length, 0);
  assert(segCount > 0, `等值线生成 ${segCount} 段`);

  console.log('[5] 物理量级健全性');
  const s0 = full.samples[0];
  const sEnd = full.samples[full.samples.length - 1];
  const avgEnd = s0.ts.reduce((a, b) => a + b, 0) / s0.ts.length - 273.15;
  const avgEndT = sEnd.ts.reduce((a, b) => a + b, 0) / sEnd.ts.length - 273.15;
  console.log(`  起始均温 ${avgEnd.toFixed(1)}℃，12h 后均温 ${avgEndT.toFixed(1)}℃`);
  assert(avgEnd > 800, '出炉均温 >800℃');
  assert(avgEndT < 250 && avgEndT > 40, `12h 后均温处于合理区间（${avgEndT.toFixed(1)}℃）`);
  const monotonic = full.samples.every((s, i) => i === 0 || s.ts[0] <= full.samples[i - 1].ts[0] + 0.5);
  assert(monotonic, '表面温度单调不反弹');

  console.log('\n全部自测通过 ✓');
  console.log(JSON.stringify({
    handCalcMaxErrPct: Math.max(...rows.map((r) => r.maxSurfaceErrPct)),
    simElapsedMs: Math.round(elapsed),
    rejected,
    segCount,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
