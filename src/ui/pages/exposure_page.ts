import { store, fmtTime } from '../store';
import { h, clear, toast } from '../dom';
import { FLUX_LIMIT, FLUX_WARN } from '../../sim/physics';
import { marchingSquares } from '../../sim/contours';
import type { Station } from '../../domain/types';

export function renderExposurePage(root: HTMLElement): void {
  const s = store.get();
  clear(root);

  const ctl = h('div', { class: 'panel-section' });
  ctl.append(h('h3', {}, ['人员热暴露评估']));
  ctl.append(h('div', { class: 'card-meta', style: 'margin-bottom:12px' }, [
    `测点高度按人体躯干 1.5m，辐射热通量逐件按视因子累加；预警 ${FLUX_WARN} W/m²，超限 ${FLUX_LIMIT} W/m²。挪动隔热屏后等值线立即重算。`,
  ]));
  const toggle = h('button', {
    class: s.showContour ? 'btn primary' : 'btn',
    style: 'width:100%',
    onclick: () => {
      store.set({ showContour: !store.get().showContour });
      toast(store.get().showContour ? '地面等值线已开启（黄=预警，红=超限）' : '等值线已关闭');
    },
  }, [s.showContour ? '关闭地面等值线' : '开启地面等值线']);
  ctl.append(toggle);
  root.append(ctl);

  if (!s.sim) {
    root.append(h('div', { class: 'empty-state' }, [
      h('div', { class: 'es-title' }, ['需要先跑冷却推演']),
      h('div', { class: 'es-sub' }, ['暴露通量随锻件表面温度变化，推演完成后给出全程累计暴露时长']),
    ]));
    return;
  }

  const stations = s.layout?.objects.filter((o): o is Station => o.kind === 'station') ?? [];
  const sec = h('div', { class: 'panel-section' });
  sec.append(h('h3', {}, ['测点实时通量']));
  const frame = nearestFrame(s.sim.exposure, s.timeS);
  stations.forEach((st) => {
    const flux = frame?.stationFlux[st.id] ?? 0;
    const cum = s.sim!.cumulativeOver[st.id] ?? 0;
    const level = flux >= FLUX_LIMIT ? 'danger' : flux >= FLUX_WARN ? 'warn' : 'ok';
    const card = h('div', { class: 'card' });
    card.innerHTML = `
      <div class="card-title">${st.name} <span class="tag ${level}">${level === 'danger' ? '超限' : level === 'warn' ? '预警' : '安全'}</span></div>
      <div class="card-meta">
        位置 (${st.pos.x}, ${st.pos.z}) · 测高 ${st.measureH} mm<br>
        当前辐射热通量 <b class="${level === 'ok' ? 'good' : level === 'danger' ? 'bad' : 'warn-txt'}">${flux.toFixed(0)} W/m²</b><br>
        累计超限暴露 <b>${fmtTime(cum)}</b>（限值 ${FLUX_LIMIT} W/m²）
      </div>`;
    sec.append(card);
  });
  root.append(sec);

  // 等值线说明
  if (s.layout && frame) {
    const lv = marchingSquares(frame.grid, s.sim.gridNx, s.sim.gridNz, s.layout.sizeX, s.layout.sizeZ, [
      FLUX_WARN,
      FLUX_LIMIT,
    ]);
    const lineSec = h('div', { class: 'panel-section' });
    lineSec.append(h('h3', {}, ['等值线统计（当前时刻）']));
    lv.forEach((l) => {
      const c = h('div', { class: 'card' });
      c.innerHTML = `<div class="card-title">${l.level} W/m²</div>
        <div class="card-meta">等值线段 <b>${l.lines.length}</b> 段${
          l.level >= FLUX_LIMIT ? ' · <span class="bad">该封闭区域禁止长时间停留</span>' : ''
        }</div>`;
      lineSec.append(c);
    });
    root.append(lineSec);
  }
}

function nearestFrame<T extends { t: number }>(frames: T[], t: number): T | null {
  if (!frames.length) return null;
  let best = frames[0];
  for (const f of frames) {
    if (f.t <= t) best = f;
  }
  return best;
}
