import { store } from '../store';
import { h, clear, modal, toast } from '../dom';
import { repo } from '../../db/idb';
import { SHIELD_MATERIALS, getShieldMaterial } from '../../domain/materials';
import type { Shield, SiteObject, YardLayout } from '../../domain/types';

export function renderLayoutPage(root: HTMLElement): void {
  const s = store.get();
  clear(root);
  if (!s.layout) return;
  const layout = s.layout;

  const section = h('div', { class: 'panel-section' });
  section.append(h('h3', {}, ['场地参数（实测）']));
  const sizeX = field('场地长 X (mm)', layout.sizeX);
  const sizeZ = field('场地宽 Z (mm)', layout.sizeZ);
  const apply = h('button', {
    class: 'btn primary',
    onclick: () => {
      const next: YardLayout = {
        ...layout,
        sizeX: Number((sizeX.querySelector('input') as HTMLInputElement).value),
        sizeZ: Number((sizeZ.querySelector('input') as HTMLInputElement).value),
      };
      void repo.put('layouts', next).then(() => {
        store.set({ layout: next });
        toast('场地尺寸已更新，3D 视图同步刷新');
      });
    },
  }, ['保存尺寸']);
  section.append(sizeX, sizeZ, apply);
  root.append(section);

  // 对象列表
  const listSec = h('div', { class: 'panel-section' });
  listSec.append(h('h3', {}, [`场地对象（${layout.objects.length}）`]));
  layout.objects.forEach((o) => {
    const card = h('div', { class: 'card' });
    const title = h('div', { class: 'card-title' }, [nameOf(o)]);
    const meta = h('div', { class: 'card-meta' });
    if (o.kind === 'shield') {
      const m = getShieldMaterial(o.matId);
      meta.innerHTML = `材质 <b>${m.name}</b> · 高 <b>${o.height}</b> mm · 长 <b>${o.length}</b> mm<br>朝向 <b>${o.yawDeg}°</b> · 位置 (${o.pos.x}, ${o.pos.z})`;
    } else if (o.kind === 'fan') {
      meta.innerHTML = `风速 <b>${o.speed} m/s</b> · 锥角 ${o.coneDeg}° · 射程 ${o.range} mm<br>朝向 <b>${o.yawDeg}°</b> · 位置 (${o.pos.x}, ${o.pos.z})`;
    } else {
      meta.innerHTML = `位置 <b>(${o.pos.x}, ${o.pos.z})</b>`;
    }
    const row = h('div', { class: 'btn-row', style: 'margin-top:12px' });
    if (o.kind === 'shield') {
      row.append(editShieldBtn(o, layout));
    }
    if (o.kind === 'fan') {
      row.append(editFanBtn(o, layout));
    }
    row.append(deleteBtn(o, layout));
    card.append(title, meta, row);
    listSec.append(card);
  });
  root.append(listSec);

  // 添加对象
  const addSec = h('div', { class: 'panel-section' });
  addSec.append(h('h3', {}, ['添加对象']));
  const addRow = h('div', { class: 'btn-row' });
  addRow.append(
    addBtn('加隔热屏', () => addShield(layout)),
    addBtn('加风机', () => addFan(layout)),
    addBtn('加工位', () => addStation(layout)),
  );
  addSec.append(addRow);
  root.append(addSec);

  // 材质说明
  const matSec = h('div', { class: 'panel-section' });
  matSec.append(h('h3', {}, ['隔热屏材质库']));
  SHIELD_MATERIALS.forEach((m) => {
    const c = h('div', { class: 'card' });
    c.innerHTML = `<div class="card-title">${m.name}</div><div class="card-meta">
      发射率 <b>${m.emissivity}</b> · 吸收率 <b>${m.absorptivity}</b> · 导热 <b>${m.conductivity} W/(m·K)</b></div>`;
    matSec.append(c);
  });
  root.append(matSec);
}

function nameOf(o: SiteObject): string {
  const kindName: Record<SiteObject['kind'], string> = {
    shield: '隔热屏',
    fan: '风机',
    station: '工位/测点',
    aisle: '过道',
  };
  const n = 'name' in o ? o.name : '';
  return `${kindName[o.kind]} ${o.id}${n ? ` · ${n}` : ''}`;
}

function field(label: string, value: number): HTMLElement {
  const wrap = h('div', { class: 'field' });
  wrap.append(h('label', {}, [label, h('span', { class: 'val' }, [String(value)])]));
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = String(value);
  wrap.append(inp);
  return wrap;
}

function addBtn(text: string, fn: () => void): HTMLElement {
  return h('button', { class: 'btn', onclick: fn }, [text]);
}

function deleteBtn(o: SiteObject, layout: YardLayout): HTMLElement {
  return h('button', {
    class: 'btn ghost small',
    onclick: () => {
      const next = { ...layout, objects: layout.objects.filter((x) => x.id !== o.id) };
      void repo.put('layouts', next).then(() => {
        store.set({ layout: next });
        toast(`已删除 ${o.id}`);
      });
    },
  }, ['删除']);
}

function editShieldBtn(o: Shield, layout: YardLayout): HTMLElement {
  return h('button', {
    class: 'btn small',
    onclick: () => {
      const body = document.createElement('div');
      const matSel = document.createElement('select');
      SHIELD_MATERIALS.forEach((m) => {
        const op = document.createElement('option');
        op.value = m.id;
        op.textContent = m.name;
        if (m.id === o.matId) op.selected = true;
        matSel.append(op);
      });
      const hInp = numInput('屏高 mm', o.height);
      const yawInp = numInput('朝向角度', o.yawDeg);
      body.append(labeled('材质', matSel), hInp.wrap, yawInp.wrap);
      modal('编辑隔热屏（遮挡关系实时更新）', body, () => {
        const next = {
          ...layout,
          objects: layout.objects.map((x) =>
            x.id === o.id
              ? { ...o, matId: matSel.value, height: hInp.val(), yawDeg: yawInp.val() }
              : x,
          ),
        };
        void repo.put('layouts', next).then(() => {
          store.set({ layout: next });
          toast('隔热屏参数已更新，视因子遮挡已重算');
        });
      });
    },
  }, ['编辑材质/高度']);
}

function editFanBtn(o: Extract<SiteObject, { kind: 'fan' }>, layout: YardLayout): HTMLElement {
  return h('button', {
    class: 'btn small',
    onclick: () => {
      const body = document.createElement('div');
      const spd = numInput('出口风速 m/s', o.speed);
      const yaw = numInput('朝向角度', o.yawDeg);
      body.append(spd.wrap, yaw.wrap);
      modal('编辑风机', body, () => {
        const next = {
          ...layout,
          objects: layout.objects.map((x) =>
            x.id === o.id ? { ...o, speed: spd.val(), yawDeg: yaw.val() } : x,
          ),
        };
        void repo.put('layouts', next).then(() => {
          store.set({ layout: next });
          toast('风机参数已更新');
        });
      });
    },
  }, ['编辑风机']);
}

function labeled(text: string, el: HTMLElement): HTMLElement {
  const wrap = h('div', { class: 'field' });
  wrap.append(h('label', {}, [text]), el);
  return wrap;
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

let seq = 100;
function addShield(layout: YardLayout): void {
  const o: Shield = {
    id: `shield-${seq++}`,
    kind: 'shield',
    matId: 'refractory-fiber',
    pos: { x: layout.sizeX / 2, y: 0, z: layout.sizeZ / 2 },
    yawDeg: 90,
    length: 8000,
    height: 2500,
    thickness: 100,
  };
  persist(layout, o);
}

function addFan(layout: YardLayout): void {
  persist(layout, {
    id: `fan-${seq++}`,
    kind: 'fan',
    pos: { x: layout.sizeX - 3000, y: 0, z: layout.sizeZ / 2 },
    yawDeg: 270,
    speed: 8,
    coneDeg: 50,
    range: 12000,
  });
}

function addStation(layout: YardLayout): void {
  persist(layout, {
    id: `station-${seq++}`,
    kind: 'station',
    name: `新测点 ${seq}`,
    pos: { x: layout.sizeX / 2, y: 0, z: 6000 },
    measureH: 1500,
  });
}

function persist(layout: YardLayout, o: SiteObject): void {
  const next = { ...layout, objects: [...layout.objects, o] };
  void repo.put('layouts', next).then(() => {
    store.set({ layout: next });
    toast(`已添加 ${o.id}，可在卡片中编辑`);
  });
}
