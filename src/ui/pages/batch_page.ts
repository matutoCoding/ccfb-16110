import { store } from '../store';
import { h, clear, modal, toast } from '../dom';
import { repo } from '../../db/idb';
import { STEEL_GRADES } from '../../domain/materials';
import { autoPack } from '../../domain/layout_rules';
import type { Batch, Forging, ShapeKind, ShapeParams } from '../../domain/types';
import { uid } from '../../util/rng';

export function renderBatchPage(root: HTMLElement): void {
  const s = store.get();
  clear(root);

  const createSec = h('div', { class: 'panel-section' });
  createSec.append(h('h3', {}, ['新建锻件批次']));
  const form = buildBatchForm();
  const createBtn = h('button', {
    class: 'btn primary',
    style: 'width:100%',
    onclick: () => form.create(),
  }, ['按码放规则生成批次']);
  createSec.append(form.body, createBtn);
  const stressBtn = h('button', {
    class: 'btn',
    style: 'width:100%;margin-top:8px',
    onclick: () => createStressBatch(),
  }, ['生成 300 件验收压力批次（350mm 密排）']);
  createSec.append(stressBtn);
  root.append(createSec);

  const listSec = h('div', { class: 'panel-section' });
  listSec.append(h('h3', {}, [`批次列表（${s.batches.length}）`]));
  if (!s.batches.length) {
    listSec.append(emptyHint('还没有批次，用上方表单创建，或载入内置 200 件演示批次'));
  }
  s.batches.forEach((b) => {
    const count = s.forgings.filter((f) => f.batchId === b.id).length;
    const card = h('div', { class: 'card' });
    card.innerHTML = `
      <div class="card-title">${b.name}</div>
      <div class="card-meta">
        钢种 <b>${steelName(b.steelId)}</b> · ${b.shape.kind} D${b.shape.outerD}×H${b.shape.height} mm<br>
        出炉 <b>${b.dischargeTemp}℃</b> · 计划 <b>${b.count}</b> 件 · 实际码放 <b>${count}</b> 件
      </div>`;
    const row = h('div', { class: 'btn-row', style: 'margin-top:12px' });
    row.append(
      h('button', {
        class: 'btn small',
        onclick: () => repack(b),
      }, ['重新自动排位']),
      h('button', {
        class: 'btn ghost small',
        onclick: () => removeBatch(b),
      }, ['删除批次']),
    );
    card.append(row);
    listSec.append(card);
  });
  root.append(listSec);

  // 锻件清单（当前批次）
  const fgSec = h('div', { class: 'panel-section' });
  fgSec.append(h('h3', {}, [`锻件清单（前 50 件，共 ${s.forgings.length}）`]));
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `<thead><tr><th>ID</th><th>类型</th><th>位置 (mm)</th><th>出炉℃</th><th>状态</th></tr></thead>`;
  const tbody = document.createElement('tbody');
  s.forgings.slice(0, 50).forEach((f) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${f.id}</td><td>${f.shape.kind}</td>
      <td class="num">${f.pos.x.toFixed(0)}, ${f.pos.z.toFixed(0)}</td>
      <td class="num">${f.dischargeTemp}</td>
      <td><span class="tag ${f.status === 'rejected' ? 'danger' : f.status === 'qualified' ? 'ok' : 'warn'}">${f.status}</span></td>`;
    tr.addEventListener('click', () => store.set({ selectedForgingId: f.id, page: 'sim' }));
    tbody.append(tr);
  });
  table.append(tbody);
  fgSec.append(table);
  root.append(fgSec);
}

function steelName(id: string): string {
  return STEEL_GRADES.find((g) => g.id === id)?.name ?? id;
}

// 300 件验收压力批次：密排 350mm，用于 1080p@45fps 与整批仿真核验
function createStressBatch(): void {
  const s = store.get();
  if (!s.layout) return toast('场地未初始化');
  const shape: ShapeParams = {
    kind: 'flange', outerD: 1800, innerD: 700, height: 320, hubD: 950, hubH: 140,
  };
  const pack = autoPack(s.layout, shape, 300, { gapMm: 350, startId: s.forgings.length + 1 });
  const batch: Batch = {
    id: uid('batch', Date.now() % 1000000),
    name: `300件压力批次-${new Date().toLocaleTimeString('zh-CN')}`,
    steelId: '42crmo4',
    shape,
    dischargeTemp: 860,
    dischargeTime: 0,
    count: pack.placed,
    createdAt: Date.now(),
    note: '验收压力测试：300 件密排',
  };
  const forgings: Forging[] = pack.positions.map((pos, i) => ({
    id: uid('fg', s.forgings.length + i + 1),
    batchId: batch.id,
    shape: { ...shape },
    steelId: batch.steelId,
    pos,
    dischargeTemp: 860,
    dischargeTime: i * 10,
    pinned: false,
    status: 'cooling',
  }));
  void repo.put('batches', batch).then(() => repo.putAll('forgings', forgings)).then(() => {
    store.set({
      batches: [...store.get().batches, batch],
      forgings: [...store.get().forgings, ...forgings],
      sim: null,
    });
    toast(`压力批次已码放 ${forgings.length} 件，去推演页跑仿真并观察右上角 FPS`);
  });
}

function emptyHint(title: string): HTMLElement {
  return h('div', { class: 'empty-state' }, [
    h('div', { class: 'es-title' }, [title]),
    h('div', { class: 'es-sub' }, ['系统首次启动已自动生成演示数据；删除后可在此重建']),
  ]);
}

function buildBatchForm(): { body: HTMLElement; create: () => void } {
  const body = document.createElement('div');
  const nameInp = textInput('批次名称', `批次-${Date.now() % 100000}`);
  const steelSel = document.createElement('select');
  STEEL_GRADES.forEach((g) => {
    const op = document.createElement('option');
    op.value = g.id;
    op.textContent = `${g.name}（临界冷速 ${g.cctCriticalRate} ℃/s）`;
    steelSel.append(op);
  });
  const kindSel = document.createElement('select');
  (['flange', 'ring', 'shaft'] as ShapeKind[]).forEach((k) => {
    const op = document.createElement('option');
    op.value = k;
    op.textContent = k === 'flange' ? '法兰' : k === 'ring' ? '齿圈' : '轴类';
    kindSel.append(op);
  });
  const dInp = numInput('外径 mm', 1800);
  const innerInp = numInput('内径 mm', 700);
  const hInp = numInput('高度 mm', 320);
  const tempInp = numInput('出炉温度 ℃', 860);
  const countInp = numInput('件数', 60);
  const gapInp = numInput('码放净间隙 mm', 500);
  body.append(
    nameInp.wrap,
    labelWrap('钢种', steelSel),
    labelWrap('截面类型', kindSel),
    dInp.wrap, innerInp.wrap, hInp.wrap,
    tempInp.wrap, countInp.wrap, gapInp.wrap,
  );

  const create = (): void => {
    const s = store.get();
    if (!s.layout) return toast('场地未初始化');
    const shape: ShapeParams = {
      kind: kindSel.value as ShapeKind,
      outerD: dInp.val(),
      innerD: kindSel.value === 'shaft' ? 0 : innerInp.val(),
      height: hInp.val(),
      hubD: kindSel.value === 'flange' ? dInp.val() * 0.53 : undefined,
      hubH: kindSel.value === 'flange' ? hInp.val() * 0.44 : undefined,
    };
    const count = countInp.val();
    const pack = autoPack(s.layout, shape, count, { gapMm: gapInp.val(), startId: s.forgings.length + 1 });
    if (pack.placed < count) {
      toast(`场地容量不足：只码下 ${pack.placed}/${count} 件，${pack.skipped} 个点位被占用`, 4500);
    }
    const batch: Batch = {
      id: uid('batch', Date.now() % 1000000),
      name: nameInp.val(),
      steelId: steelSel.value,
      shape,
      dischargeTemp: tempInp.val(),
      dischargeTime: 0,
      count: pack.placed,
      createdAt: Date.now(),
      note: '页面表单创建',
    };
    const forgings: Forging[] = pack.positions.map((pos, i) => ({
      id: uid('fg', s.forgings.length + i + 1),
      batchId: batch.id,
      shape: { ...shape },
      steelId: batch.steelId,
      pos,
      dischargeTemp: batch.dischargeTemp,
      dischargeTime: i * 12,
      pinned: false,
      status: 'cooling',
    }));
    void repo.put('batches', batch).then(() => repo.putAll('forgings', forgings)).then(() => {
      store.set({
        batches: [...store.get().batches, batch],
        forgings: [...store.get().forgings, ...forgings],
        sim: null,
      });
      toast(`批次 ${batch.name} 已码放 ${forgings.length} 件，去冷却推演页跑仿真`);
    });
  };
  return { body, create };
}

function repack(b: Batch): void {
  const s = store.get();
  if (!s.layout) return;
  const mine = s.forgings.filter((f) => f.batchId === b.id);
  const others = s.forgings.filter((f) => f.batchId !== b.id);
  const pack = autoPack(s.layout, b.shape, b.count, { gapMm: 500, startId: 1 }, others);
  const next: Forging[] = mine.map((f, i) => ({
    ...f,
    pos: pack.positions[i] ?? f.pos,
  }));
  const all = [...others, ...next];
  void repo.putAll('forgings', all).then(() => {
    store.set({ forgings: all, sim: null });
    toast(`已重新排位 ${next.length} 件，需重新推演`);
  });
}

function removeBatch(b: Batch): void {
  const s = store.get();
  const keep = s.forgings.filter((f) => f.batchId !== b.id);
  modal(`确认删除批次 ${b.name}？`, document.createElement('div'), () => {
    void repo.remove('batches', b.id).then(async () => {
      await repo.putAll('forgings', keep);
      store.set({
        batches: s.batches.filter((x) => x.id !== b.id),
        forgings: keep,
        sim: null,
        selectedForgingId: null,
      });
      toast('批次及其锻件已删除');
    });
  });
}

function textInput(label: string, val: string): { wrap: HTMLElement; val: () => string } {
  const wrap = h('div', { class: 'field' });
  wrap.append(h('label', {}, [label]));
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = val;
  wrap.append(inp);
  return { wrap, val: () => inp.value };
}

function numInput(label: string, val: number): { wrap: HTMLElement; val: () => number } {
  const wrap = h('div', { class: 'field' });
  wrap.append(h('label', {}, [label]));
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = String(val);
  wrap.append(inp);
  return { wrap, val: () => Number(inp.value) };
}

function labelWrap(label: string, el: HTMLElement): HTMLElement {
  const wrap = h('div', { class: 'field' });
  wrap.append(h('label', {}, [label]), el);
  return wrap;
}
