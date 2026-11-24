import { store } from '../store';
import { h, clear, toast } from '../dom';
import { repo } from '../../db/idb';
import { sampleAt } from '../../sim/engine';
import { lineChart } from '../widgets/chart';
import type { TempReading } from '../../domain/types';
import { uid } from '../../util/rng';

// 红外/热电偶实测点温与仿真值偏差对比
export function renderReadingsPanel(root: HTMLElement): void {
  const s = store.get();
  const sec = h('div', { class: 'panel-section' });
  sec.append(h('h3', {}, ['实测点温叠加（红外枪/热电偶）']));

  const addBtn = h('button', {
    class: 'btn',
    style: 'width:100%;margin-bottom:12px',
    onclick: () => addReading(),
  }, ['录入当前选中件的点温']);
  sec.append(addBtn);

  if (!s.readings.length) {
    sec.append(h('div', { class: 'empty-state' }, [h('div', { class: 'es-sub' }, ['暂无测温记录'])]));
    root.append(sec);
    return;
  }

  const rows = s.readings.map((r) => {
    const idx = s.sim ? s.sim.forgingIds.indexOf(r.forgingId ?? '') : -1;
    let simC: number | null = null;
    if (s.sim && idx >= 0) {
      const f = sampleAt(s.sim, r.t);
      simC = f.ts[idx] - 273.15;
    }
    const dev = simC === null ? null : r.tempC - simC;
    return { r, simC, dev };
  });

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `<thead><tr><th>锻件</th><th>时刻</th><th>实测℃</th><th>仿真℃</th><th>偏差</th><th>来源</th></tr></thead>`;
  const tbody = document.createElement('tbody');
  rows.slice(0, 40).forEach(({ r, simC, dev }) => {
    const tr = document.createElement('tr');
    const devCls = dev === null ? 'muted' : Math.abs(dev) <= 15 ? 'good' : 'warn-txt';
    tr.innerHTML = `<td>${r.forgingId ?? '-'}</td>
      <td class="num">${(r.t / 3600).toFixed(2)}h</td>
      <td class="num">${r.tempC.toFixed(1)}</td>
      <td class="num">${simC === null ? '-' : simC.toFixed(1)}</td>
      <td class="num ${devCls}">${dev === null ? '-' : `${dev >= 0 ? '+' : ''}${dev.toFixed(1)}`}</td>
      <td><span class="tag">${r.source === 'ir-gun' ? '红外枪' : '热电偶'}</span></td>`;
    tbody.append(tr);
  });
  table.append(tbody);
  sec.append(table);

  // 偏差统计图：同一锻件的实测点 vs 仿真曲线
  if (s.sim) {
    const byForging = new Map<string, TempReading[]>();
    s.readings.forEach((r) => {
      if (!r.forgingId) return;
      const arr = byForging.get(r.forgingId) ?? [];
      arr.push(r);
      byForging.set(r.forgingId, arr);
    });
    const first = [...byForging.entries()][0];
    if (first) {
      const [fid, rs] = first;
      const idx = s.sim.forgingIds.indexOf(fid);
      if (idx >= 0) {
        const wrap = h('div', { class: 'chart-wrap', style: 'margin-top:12px' });
        lineChart(wrap, [
          {
            name: `${fid} 仿真表面`,
            color: '#e8893c',
            points: s.sim.samples.map((sm) => [sm.t, sm.ts[idx] - 273.15]),
          },
          {
            name: '实测点温',
            color: '#5b9bd5',
            points: rs.map((r) => [r.t, r.tempC]),
          },
        ], { xLabel: 'time', yLabel: '℃', height: 200 });
        sec.append(wrap);
      }
    }
  }

  const valid = rows.filter((x) => x.dev !== null) as Array<{ dev: number }>;
  if (valid.length) {
    const maxAbs = Math.max(...valid.map((x) => Math.abs(x.dev)));
    const mean = valid.reduce((a, x) => a + x.dev, 0) / valid.length;
    const c = h('div', { class: 'card', style: 'margin-top:12px' });
    c.innerHTML = `<div class="card-title">偏差统计 <span class="tag ${maxAbs <= 20 ? 'ok' : 'warn'}">${maxAbs <= 20 ? '可信' : '需标定'}</span></div>
      <div class="card-meta">样本 <b>${valid.length}</b> · 平均偏差 <b>${mean >= 0 ? '+' : ''}${mean.toFixed(1)}℃</b> ·
      最大绝对偏差 <b>${maxAbs.toFixed(1)}℃</b><br>红外枪通常比接触式高 ${(mean > 0 ? mean : 0).toFixed(1)}℃，可据此修正发射率设置</div>`;
    sec.append(c);
  }

  root.append(sec);
}

function addReading(): void {
  const s = store.get();
  if (!s.selectedForgingId) {
    toast('先在 3D 视图点选一件锻件');
    return;
  }
  const forging = s.forgings.find((f) => f.id === s.selectedForgingId);
  if (!forging) return;
  const temp = window.prompt('输入红外枪测得表面温度（℃）', '620');
  if (temp === null) return;
  const tempC = Number(temp);
  if (Number.isNaN(tempC)) return toast('温度数值无效');
  const reading: TempReading = {
    id: uid('rd', Date.now() % 1000000),
    batchId: forging.batchId,
    forgingId: forging.id,
    t: s.timeS,
    tempC,
    pos: { ...forging.pos, y: forging.shape.height / 2 },
    source: 'ir-gun',
  };
  void repo.put('readings', reading).then(() => {
    store.set({ readings: [...store.get().readings, reading] });
    toast(`已记录 ${forging.id} 在 ${(s.timeS / 3600).toFixed(2)}h 的点温 ${tempC}℃`);
  });
}

export function clearPanel(root: HTMLElement): void {
  clear(root);
}
