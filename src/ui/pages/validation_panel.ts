import { store } from '../store';
import { h, clear, toast } from '../dom';
import { runSimulation, DEFAULT_SIM_CONFIG } from '../../sim/engine';
import { handCalcCurve, compareCurves, buildReport, type ValidationReport } from '../../sim/validation';
import { lineChart } from '../widgets/chart';
import type { Forging } from '../../domain/types';

// 手算对照：挑三件（最快/中位/最慢冷速），各自单独跑孤立仿真，再与独立手算曲线比
export async function runValidation(onReport: (r: ValidationReport) => void): Promise<void> {
  const s = store.get();
  if (!s.layout || !s.sim) {
    toast('请先完成一次整批推演');
    return;
  }
  const sorted = [...s.sim.verdicts].sort((a, b) => a.rate700_500 - b.rate700_500);
  const pick = [
    sorted[0],
    sorted[Math.floor(sorted.length / 2)],
    sorted[sorted.length - 1],
  ].filter(Boolean);
  const rows = [];
  const charts: Array<{ id: string; hand: ReturnType<typeof handCalcCurve>; enginePts: Array<[number, number]> }> = [];

  for (const v of pick) {
    const forging = s.forgings.find((f) => f.id === v.forgingId);
    if (!forging) continue;
    const isolated: Forging = { ...forging, id: `iso-${forging.id}`, pos: { x: 2000, y: 0, z: 2000 } };
    const isoResult = await runSimulation([isolated], s.layout, {
      ...DEFAULT_SIM_CONFIG,
      durationS: 6 * 3600,
      sampleEvery: 1,
      gridNx: 8,
      gridNz: 8,
    });
    const hand = handCalcCurve(forging, 6 * 3600);
    const row = compareCurves({ ...forging, id: isolated.id }, isoResult, hand);
    row.forgingId = forging.id;
    rows.push(row);
    const idx = isoResult.forgingIds.indexOf(isolated.id);
    charts.push({
      id: forging.id,
      hand,
      enginePts: isoResult.samples.map((sm) => [sm.t, sm.ts[idx] - 273.15]),
    });
  }
  onReport(buildReport(rows));
  renderValidationModal(buildReport(rows), charts);
}

function renderValidationModal(
  report: ValidationReport,
  charts: Array<{ id: string; hand: ReturnType<typeof handCalcCurve>; enginePts: Array<[number, number]> }>,
): void {
  const body = document.createElement('div');
  const head = h('div', { class: 'card' });
  head.innerHTML = `<div class="card-title">验收结论
    <span class="tag ${report.passed ? 'ok' : 'danger'}">${report.passed ? '通过 ≤3%' : '未通过'}</span></div>
    <div class="card-meta">${report.note}</div>`;
  body.append(head);

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `<thead><tr><th>锻件</th><th>钢种/规格</th><th>表面最大误差</th><th>心部最大误差</th></tr></thead>`;
  const tbody = document.createElement('tbody');
  report.rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.forgingId}</td><td>${r.steel}<br>${r.shape}</td>
      <td class="num ${r.maxSurfaceErrPct <= 3 ? 'good' : 'bad'}">${r.maxSurfaceErrPct.toFixed(2)}%</td>
      <td class="num ${r.maxCoreErrPct <= 3 ? 'good' : 'bad'}">${r.maxCoreErrPct.toFixed(2)}%</td>`;
    tbody.append(tr);
  });
  table.append(tbody);
  body.append(table);

  charts.forEach((c) => {
    const title = h('div', { class: 'card-title', style: 'margin:16px 0 8px' }, [`${c.id} 引擎 vs 独立手算`]);
    const wrap = h('div', { class: 'chart-wrap' });
    lineChart(wrap, [
      { name: '引擎表面', color: '#e8893c', points: c.enginePts },
      { name: '手算表面', color: '#5b9bd5', points: c.hand.times.map((t, i) => [t, c.hand.surfaceC[i]]), dashed: true },
    ], { xLabel: 'time', yLabel: '℃', height: 180 });
    body.append(title, wrap);
  });

  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const box = document.createElement('div');
  box.className = 'modal';
  const h3 = document.createElement('h3');
  h3.textContent = '冷却曲线手算对照（独立代码路径，RK4 步长 5s）';
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  const close = document.createElement('button');
  close.className = 'btn primary';
  close.textContent = '关闭';
  close.onclick = () => mask.remove();
  foot.append(close);
  box.append(h3, body, foot);
  mask.append(box);
  document.body.append(mask);
}

export function renderValidationPanel(root: HTMLElement): void {
  const s = store.get();
  clear(root);
  const sec = h('div', { class: 'panel-section' });
  sec.append(h('h3', {}, ['物理模型验收']));
  sec.append(h('div', { class: 'card-meta', style: 'margin-bottom:12px' }, [
    '独立手算模块与仿真引擎零代码共享，仅复用几何公式；三件锻件分别做孤立件对照，误差按相对温升归一。',
  ]));
  const btn = h('button', {
    class: 'btn primary',
    style: 'width:100%',
    onclick: () => {
      btn.textContent = '计算中…';
      void runValidation(() => undefined).finally(() => (btn.textContent = '重新跑手算对照'));
    },
  }, ['跑手算对照（3 件 × 6h）']);
  sec.append(btn);
  if (s.forgings.length >= 300) {
    sec.append(h('div', { class: 'card', style: 'margin-top:12px' }, [
      h('div', { class: 'card-meta' }, [
        `当前在场 <b>${s.forgings.length}</b> 件，右上角 FPS 即 1080p 实测帧率，验收口径 ≥45 FPS。`,
      ]),
    ]));
  }
  root.append(sec);
}
