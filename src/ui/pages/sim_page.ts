import { store, fmtTemp, fmtTime } from '../store';
import { h, clear, toast } from '../dom';
import { DEFAULT_SIM_CONFIG, runSimulation, sampleAt } from '../../sim/engine';
import { advise } from '../../sim/advisor';
import { lineChart } from '../widgets/chart';
import { renderReadingsPanel } from './readings_panel';
import { getSteel } from '../../domain/materials';

export function renderSimPage(root: HTMLElement): void {
  const s = store.get();
  clear(root);

  const ctl = h('div', { class: 'panel-section' });
  ctl.append(h('h3', {}, ['冷却推演（辐射 + 对流）']));
  const meta = h('div', { class: 'card-meta', style: 'margin-bottom:12px' });
  meta.innerHTML = `模型：双节点（心部/表面）集总参数 · RK4 积分，步长 <b>${DEFAULT_SIM_CONFIG.stepS}s</b><br>
    互烤：近场视因子 + 隔热屏遮挡 · 时长 <b>${DEFAULT_SIM_CONFIG.durationS / 3600}h</b>`;
  const runBtn = h('button', {
    class: 'btn primary',
    style: 'width:100%',
    onclick: () => void run(),
  }, [s.sim ? '重新运行推演' : '开始冷却推演']);
  ctl.append(meta, runBtn);
  if (s.simRunning) {
    const bar = document.createElement('div');
    bar.className = 'boot-bar';
    bar.style.marginTop = '12px';
    bar.innerHTML = `<div class="boot-bar-fill" style="width:${(s.simProgress * 100).toFixed(0)}%"></div>`;
    ctl.append(bar);
  }
  root.append(ctl);

  if (!s.sim) {
    root.append(h('div', { class: 'empty-state' }, [
      h('div', { class: 'es-title' }, ['还没有推演结果']),
      h('div', { class: 'es-sub' }, ['码放好锻件后点「开始冷却推演」，时间轴出现在 3D 视图底部']),
    ]));
    return;
  }

  // CCT 判定汇总
  const verdictSec = h('div', { class: 'panel-section' });
  verdictSec.append(h('h3', {}, ['CCT 冷速判定']));
  const rejected = s.sim.verdicts.filter((v) => !v.qualified);
  const sumCard = h('div', { class: 'card' });
  sumCard.innerHTML = `
    <div class="card-title">总览 <span class="tag ${rejected.length ? 'danger' : 'ok'}">${rejected.length ? `${rejected.length} 件不达标` : '全部达标'}</span></div>
    <div class="card-meta">共 <b>${s.sim.verdicts.length}</b> 件 · 判据 700→500℃ 平均冷速 ≥ 钢种临界值<br>
    不达标件已在 3D 场景中<span class="bad">红色描边</span></div>`;
  verdictSec.append(sumCard);
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `<thead><tr><th>锻件</th><th>冷速 ℃/s</th><th>临界</th><th>判定</th></tr></thead>`;
  const tbody = document.createElement('tbody');
  [...s.sim.verdicts]
    .sort((a, b) => a.rate700_500 - b.rate700_500)
    .slice(0, 15)
    .forEach((v) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${v.forgingId}</td><td class="num">${v.rate700_500.toFixed(3)}</td>
        <td class="num">${v.criticalRate}</td>
        <td><span class="tag ${v.qualified ? 'ok' : 'danger'}">${v.qualified ? '合格' : '不合格'}</span></td>`;
      tr.addEventListener('click', () => store.set({ selectedForgingId: v.forgingId }));
      tbody.append(tr);
    });
  table.append(tbody);
  verdictSec.append(table);
  root.append(verdictSec);

  // 建议
  const adviceSec = h('div', { class: 'panel-section' });
  adviceSec.append(h('h3', {}, ['整改建议']));
  if (s.layout) {
    const list = advise(s.forgings, s.sim, s.layout);
    if (!list.length) {
      adviceSec.append(h('div', { class: 'card' }, [h('div', { class: 'card-meta' }, ['所有锻件冷速达标，无需调整'])]));
    }
    list.slice(0, 8).forEach((a) => {
      const c = h('div', { class: 'card' });
      c.innerHTML = `<div class="card-title">${a.forgingId}</div>
        <div class="card-meta">${a.problem}<br><b>${a.expectedGain}</b><br>建议净间距 <b>${a.suggestGapMm} mm</b>${
          a.target ? ` · 挪到 (${a.target.x.toFixed(0)}, ${a.target.z.toFixed(0)})` : ''
        }</div>`;
      adviceSec.append(c);
    });
  }
  root.append(adviceSec);

  // 选中件曲线
  if (s.selectedForgingId) renderSelectedCurve(root, s.selectedForgingId);

  // 红外/热电偶实测叠加
  renderReadingsPanel(root);
}

function renderSelectedCurve(root: HTMLElement, forgingId: string): void {
  const s = store.get();
  if (!s.sim) return;
  const idx = s.sim.forgingIds.indexOf(forgingId);
  const forging = s.forgings.find((f) => f.id === forgingId);
  if (idx < 0 || !forging) return;

  const sec = h('div', { class: 'panel-section' });
  sec.append(h('h3', {}, [`锻件 ${forgingId} 温度曲线`]));
  const cur = sampleAt(s.sim, s.timeS);
  const info = h('div', { class: 'card' });
  const steel = getSteel(forging.steelId);
  info.innerHTML = `<div class="card-meta">
    钢种 <b>${steel.name}</b> · ${forging.shape.kind} D${forging.shape.outerD}×H${forging.shape.height}<br>
    当前表面 <b class="warn-txt">${fmtTemp(cur.ts[idx] - 273.15)}</b> ·
    心部 <b>${fmtTemp(cur.tc[idx] - 273.15)}</b> · 时刻 ${fmtTime(s.timeS)}</div>`;
  const chartWrap = h('div', { class: 'chart-wrap', style: 'margin-top:12px' });
  const surfPts: Array<[number, number]> = s.sim.samples.map((sm) => [sm.t, sm.ts[idx] - 273.15]);
  const corePts: Array<[number, number]> = s.sim.samples.map((sm) => [sm.t, sm.tc[idx] - 273.15]);
  lineChart(chartWrap, [
    { name: '表面温度', color: '#e8893c', points: surfPts },
    { name: '心部温度', color: '#5b9bd5', points: corePts },
  ], { xLabel: 'time', yLabel: '℃' });
  sec.append(info, chartWrap);
  root.append(sec);
}

async function run(): Promise<void> {
  const s = store.get();
  if (!s.layout || !s.forgings.length) {
    toast('请先在批次页创建锻件');
    return;
  }
  store.set({ simRunning: true, simProgress: 0 });
  try {
    const result = await runSimulation(s.forgings, s.layout, {
      ...DEFAULT_SIM_CONFIG,
      onProgress: (p) => store.set({ simProgress: p }),
    });
    const next = s.forgings.map((f) => ({
      ...f,
      status: (result.rejectedIds.includes(f.id)
        ? 'rejected'
        : 'qualified') as ForgingStatus,
    }));
    store.set({ sim: result, simRunning: false, forgings: next, timeS: 0 });
    toast(`推演完成：${result.rejectedIds.length} 件冷速不达标，已描边标记`);
  } catch (e) {
    store.set({ simRunning: false });
    toast(`推演失败：${(e as Error).message}`);
  }
}

type ForgingStatus = 'cooling' | 'qualified' | 'rejected';
