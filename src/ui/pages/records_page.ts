import { store, fmtTime } from '../store';
import { h, clear, modal, toast } from '../dom';
import { repo } from '../../db/idb';
import { lineChart } from '../widgets/chart';
import { getSteel } from '../../domain/materials';
import type { ProcessRecord } from '../../domain/types';

export function renderRecordsPage(root: HTMLElement): void {
  const s = store.get();
  clear(root);

  const ctl = h('div', { class: 'panel-section' });
  ctl.append(h('h3', {}, ['工艺记录']));
  ctl.append(h('div', { class: 'card-meta', style: 'margin-bottom:12px' }, [
    '把当前摆放方案、推演结果和实测硬度挂接归档，支持同钢种同截面历史批次冷速对比。',
  ]));
  const saveBtn = h('button', {
    class: 'btn primary',
    style: 'width:100%',
    onclick: () => saveRecord(),
  }, ['归档当前方案与推演结果']);
  ctl.append(saveBtn);
  root.append(ctl);

  // 实测硬度
  const hdSec = h('div', { class: 'panel-section' });
  hdSec.append(h('h3', {}, [`实测硬度记录（${s.hardness.length}）`]));
  if (s.hardness.length) {
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `<thead><tr><th>锻件</th><th>HBW</th><th>取样</th><th>结论</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    s.hardness.slice(0, 30).forEach((r) => {
      const steel = s.forgings.find((f) => f.id === r.forgingId);
      const min = steel ? getSteel(steel.steelId).hardnessMin : 240;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.forgingId}</td><td class="num">${r.hbw}</td>
        <td>${r.position}</td>
        <td><span class="tag ${r.hbw >= min ? 'ok' : 'danger'}">${r.hbw >= min ? '合格' : `低于 ${min}`}</span></td>`;
      tbody.append(tr);
    });
    table.append(tbody);
    hdSec.append(table);
  } else {
    hdSec.append(h('div', { class: 'empty-state' }, [h('div', { class: 'es-sub' }, ['暂无硬度数据，演示批次已自动生成'])]));
  }
  root.append(hdSec);

  // 同钢种同截面历史对比
  const cmpSec = h('div', { class: 'panel-section' });
  cmpSec.append(h('h3', {}, ['同钢种同截面冷速对比']));
  renderCompare(cmpSec);
  root.append(cmpSec);

  // 归档列表
  const recSec = h('div', { class: 'panel-section' });
  recSec.append(h('h3', {}, [`归档记录（${s.records.length}）`]));
  if (!s.records.length) {
    recSec.append(h('div', { class: 'empty-state' }, [h('div', { class: 'es-sub' }, ['还没有归档记录'])]));
  }
  s.records.forEach((r) => {
    const c = h('div', { class: 'card' });
    c.innerHTML = `<div class="card-title">${r.title}</div>
      <div class="card-meta">${new Date(r.createdAt).toLocaleString('zh-CN')}<br>
      不达标 <b class="bad">${r.simSummary.rejectedCount}</b> 件 · 最高暴露通量 <b>${r.simSummary.maxExposureWm2.toFixed(0)} W/m²</b><br>
      ${r.note}</div>`;
    const row = h('div', { class: 'btn-row', style: 'margin-top:12px' });
    row.append(h('button', { class: 'btn ghost small', onclick: () => viewRecord(r) }, ['查看摘要']));
    c.append(row);
    recSec.append(c);
  });
  root.append(recSec);
}

function renderCompare(container: HTMLElement): void {
  const s = store.get();
  if (!s.sim) {
    container.append(h('div', { class: 'empty-state' }, [h('div', { class: 'es-sub' }, ['跑完推演后自动生成对比曲线'])]));
    return;
  }
  // 同钢种批次的中位冷速件做代表
  const groups = new Map<string, typeof s.sim.verdicts>();
  s.sim.verdicts.forEach((v) => {
    const f = s.forgings.find((x) => x.id === v.forgingId);
    if (!f) return;
    const key = `${f.steelId}|${f.shape.outerD}x${f.shape.height}`;
    const arr = groups.get(key) ?? [];
    arr.push(v);
    groups.set(key, arr);
  });
  const wrap = h('div', { class: 'chart-wrap' });
  const series = [...groups.entries()].map(([key, arr], gi) => {
    const sorted = [...arr].sort((a, b) => a.rate700_500 - b.rate700_500);
    const median = sorted[Math.floor(sorted.length / 2)];
    const idx = s.sim!.forgingIds.indexOf(median.forgingId);
    const points = s.sim!.samples.map((sm) => [sm.t, sm.ts[idx] - 273.15] as [number, number]);
    const colors = ['#e8893c', '#5b9bd5', '#4caf82', '#b07cd1'];
    return { name: key, color: colors[gi % colors.length], points };
  });
  lineChart(wrap, series, { xLabel: 'time', yLabel: '表面℃' });
  container.append(wrap);
}

function saveRecord(): void {
  const s = store.get();
  if (!s.sim || !s.layout) {
    toast('需要先完成一次推演');
    return;
  }
  const body = document.createElement('div');
  const titleInp = document.createElement('input');
  titleInp.type = 'text';
  titleInp.value = `方案 ${new Date().toLocaleDateString('zh-CN')}`;
  const note = document.createElement('textarea');
  note.placeholder = '备注：班次、异常情况、整改动作…';
  const f1 = document.createElement('div');
  f1.className = 'field';
  f1.append(Object.assign(document.createElement('label'), { textContent: '记录标题' }), titleInp);
  const f2 = document.createElement('div');
  f2.className = 'field';
  f2.append(Object.assign(document.createElement('label'), { textContent: '备注' }), note);
  body.append(f1, f2);
  modal('归档工艺记录', body, () => {
    const maxFlux = Math.max(0, ...s.sim!.exposure.flatMap((e) => Object.values(e.stationFlux)));
    const rec: ProcessRecord = {
      id: `rec-${Date.now()}`,
      batchId: s.batches[0]?.id ?? 'mixed',
      title: titleInp.value,
      createdAt: Date.now(),
      layoutSnapshot: structuredClone(s.layout!),
      simSummary: {
        durationS: s.sim!.durationS,
        minAvgRate: Math.min(...s.sim!.verdicts.map((v) => v.rate700_500)),
        rejectedCount: s.sim!.rejectedIds.length,
        maxExposureWm2: maxFlux,
        perForgingRate: Object.fromEntries(s.sim!.verdicts.map((v) => [v.forgingId, v.rate700_500])),
      },
      note: note.value || '无',
    };
    void repo.put('records', rec).then(() => {
      store.set({ records: [...store.get().records, rec] });
      toast('工艺记录已归档到 IndexedDB');
    });
  });
}

function viewRecord(r: ProcessRecord): void {
  const body = document.createElement('div');
  body.className = 'card-meta';
  body.innerHTML = `
    推演时长 <b>${fmtTime(r.simSummary.durationS)}</b><br>
    最低平均冷速 <b>${r.simSummary.minAvgRate.toFixed(3)} ℃/s</b><br>
    不达标件数 <b class="bad">${r.simSummary.rejectedCount}</b><br>
    最大辐射热通量 <b>${r.simSummary.maxExposureWm2.toFixed(0)} W/m²</b><br>
    场地对象 <b>${r.layoutSnapshot.objects.length}</b> 个 · ${r.layoutSnapshot.name}`;
  modal(r.title, body);
}
