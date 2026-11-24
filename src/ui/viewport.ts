import { store, fmtTime, type ViewMode } from './store';
import { h, clear, toast } from './dom';
import { repo } from '../db/idb';
import type { CoolingRenderer } from '../gpu/renderer';
import { attachCamera, pickForging } from '../gpu/controls';
import { sampleAt, type SimResult } from '../sim/engine';
import { marchingSquares } from '../sim/contours';
import { FLUX_LIMIT, FLUX_WARN } from '../sim/physics';
import { MM } from '../domain/geometry';
import type { Forging, YardLayout } from '../domain/types';

export class Viewport {
  el: HTMLElement;
  renderer: CoolingRenderer;
  private canvas: HTMLCanvasElement;
  private hudTl: HTMLElement;
  private hudTr: HTMLElement;
  private raf = 0;
  private lastTick = performance.now();

  constructor(renderer: CoolingRenderer) {
    this.renderer = renderer;
    this.el = h('div', { class: 'view-stage' });
    this.canvas = document.createElement('canvas');
    this.el.append(this.canvas);
    this.hudTl = h('div', { class: 'hud hud-tl' });
    this.hudTr = h('div', { class: 'hud hud-tr' });
    this.el.append(this.hudTl, this.hudTr);
    this.buildHud();
    this.buildTimeline();
    attachCamera(this.canvas, renderer, {
      onDrag: (xM, zM) => this.dragSelected(xM / MM, zM / MM),
    });
    this.canvas.addEventListener('click', (e) => this.onPick(e));
    this.canvas.title = '左键旋转 · 右键平移 · 滚轮缩放 · Shift+拖拽移动选中锻件';
    renderer.onFps = (fps) => store.set({ fps });
    this.loop();
  }

  private dragToken = 0;
  private dragSelected(xMm: number, zMm: number): void {
    const s = store.get();
    const id = s.selectedForgingId;
    if (!id || !s.layout) return;
    const x = Math.min(s.layout.sizeX - 500, Math.max(500, xMm));
    const z = Math.min(s.layout.sizeZ - 500, Math.max(500, zMm));
    const forgings = s.forgings.map((f) =>
      f.id === id ? { ...f, pos: { ...f.pos, x, z }, pinned: true } : f,
    );
    store.set({ forgings, sim: null });
    // 节流持久化：拖拽结束 400ms 后写一次库
    const token = ++this.dragToken;
    setTimeout(() => {
      if (token !== this.dragToken) return;
      const moved = forgings.find((f) => f.id === id);
      if (moved) void repo.put('forgings', moved);
    }, 400);
  }

  private buildHud(): void {
    const s = store.get();
    clear(this.hudTl);
    clear(this.hudTr);
    const pill1 = h('div', { class: 'hud-pill' });
    const pill2 = h('div', { class: 'hud-pill' });
    this.hudTl.append(pill1, pill2);
    this.hudTr.append(h('div', { class: 'hud-pill', id: 'hud-fps' }));
    this.refreshHud();
    void s;
  }

  private buildTimeline(): void {
    const bar = h('div', { class: 'timeline' });
    const playBtn = h('button', { class: 'btn small', id: 'tl-play' }, ['▶ 播放']);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'tl-slider';
    slider.min = '0';
    slider.max = String(12 * 3600);
    slider.value = '0';
    const label = h('div', { class: 'time-label', id: 'tl-label' }, ['00:00:00']);
    const speedSel = document.createElement('select');
    speedSel.id = 'tl-speed';
    [10, 30, 60, 180, 600].forEach((v) => {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = `${v}x`;
      speedSel.append(o);
    });
    speedSel.value = '60';
    playBtn.addEventListener('click', () => store.set({ playing: !store.get().playing }));
    slider.addEventListener('input', () => store.set({ timeS: Number(slider.value), playing: false }));
    speedSel.addEventListener('change', () => store.set({ speed: Number(speedSel.value) }));
    bar.append(playBtn, slider, label, speedSel);
    this.el.append(bar);
  }

  private onPick(e: MouseEvent): void {
    const s = store.get();
    if (!s.layout) return;
    const hit = pickForging(this.canvas, e.clientX, e.clientY, this.renderer.cam, s.forgings);
    if (hit) {
      store.set({ selectedForgingId: hit.id });
      toast(`选中锻件 ${hit.id}（${hit.shape.kind}）`);
    } else {
      store.set({ selectedForgingId: null });
    }
  }

  private currentTemps(result: SimResult | null, timeS: number, n: number): Float32Array {
    if (!result) return new Float32Array(n).fill(860);
    const f = sampleAt(result, timeS);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = f.ts[i] - 273.15;
    return out;
  }

  private refreshHud(): void {
    const s = store.get();
    const pill1 = this.hudTl.children[0] as HTMLElement;
    const pill2 = this.hudTl.children[1] as HTMLElement;
    const hot = s.forgings.length;
    const rejected = s.sim?.rejectedIds.length ?? 0;
    pill1.innerHTML = `
      <div><span class="k">在场锻件</span> <span class="v">${hot}</span> 件</div>
      <div><span class="k">冷速不达标</span> <span class="${rejected ? 'hot' : 'v'}">${rejected}</span> 件</div>
      <div><span class="k">仿真时刻</span> <span class="v">${fmtTime(s.timeS)}</span></div>`;
    const modeName: Record<ViewMode, string> = {
      visible: '可见光',
      thermal: '热像伪彩',
      split: '分屏同步',
      night: '夜班视角',
    };
    pill2.innerHTML = `
      <div><span class="k">视角</span> <span class="v">${modeName[s.viewMode]}</span></div>
      <div><span class="k">等值线</span> <span class="v">${s.showContour ? '开启' : '关闭'}</span></div>
      <div><span class="k">数据源</span> <span class="v">IndexedDB</span></div>`;
    const fpsEl = document.getElementById('hud-fps');
    if (fpsEl) fpsEl.innerHTML = `<div><span class="k">帧率</span> <span class="${s.fps >= 45 ? 'good' : 'bad'}">${s.fps.toFixed(1)} FPS</span></div><div class="k">1080p 延迟着色</div>`;
  }

  private updateOverlay(timeS: number): void {
    const s = store.get();
    if (!s.sim || !s.showContour || !s.layout) {
      this.renderer.setOverlay([]);
      return;
    }
    const exp = s.sim.exposure;
    if (!exp.length) return;
    let frame = exp[0];
    for (const e of exp) if (e.t <= timeS) frame = e;
    const levels = marchingSquares(frame.grid, s.sim.gridNx, s.sim.gridNz, s.layout.sizeX, s.layout.sizeZ, [
      FLUX_WARN,
      FLUX_LIMIT,
    ]);
    this.renderer.setOverlay(levels.flatMap((l) => l.lines.map((line) => ({ ...line, level: l.level }))));
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const s = store.get();
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;

    if (s.playing) {
      const next = Math.min(12 * 3600, s.timeS + dt * s.speed);
      store.set({ timeS: next });
      if (next >= 12 * 3600) store.set({ playing: false });
      const slider = document.getElementById('tl-slider') as HTMLInputElement | null;
      if (slider) slider.value = String(next);
      const label = document.getElementById('tl-label');
      if (label) label.textContent = fmtTime(next);
    }

    const n = s.forgings.length;
    const temps = this.currentTemps(s.sim, s.timeS, n);
    const reject = new Uint8Array(n);
    if (s.sim) {
      const set = new Set(s.sim.rejectedIds);
      s.forgings.forEach((f, i) => {
        if (set.has(f.id)) reject[i] = 1;
      });
    }
    this.updateOverlay(s.timeS);
    const thermal = s.viewMode === 'thermal';
    const night = s.viewMode === 'night';
    const split = s.viewMode === 'split';
    this.toggleSplitLabels(split);
    this.renderer.render(
      { tempsC: temps, rejectFlags: reject, night, thermal, split, timeS: s.timeS },
      s.forgings,
    );
    this.refreshHud();
  };

  private splitLabels: HTMLElement[] = [];
  private toggleSplitLabels(on: boolean): void {
    if (on && this.splitLabels.length === 0) {
      const mk = (text: string, left: string): HTMLElement => {
        const el = h('div', { class: 'split-label', style: `left:${left}` }, [text]);
        this.el.append(el);
        return el;
      };
      this.splitLabels = [mk('可见光视角', '16px'), mk('热像伪彩（同步）', 'calc(50% + 16px)')];
    } else if (!on && this.splitLabels.length) {
      this.splitLabels.forEach((el) => el.remove());
      this.splitLabels = [];
    }
  }

  private sceneSig = '';
  rebuild(forgings: Forging[], layout: YardLayout): void {
    const sig = `${layout.id}:${layout.objects.length}:${forgings.length}:${forgings
      .map((f) => `${f.id}@${f.pos.x.toFixed(0)},${f.pos.z.toFixed(0)}`)
      .join('|')}`;
    if (sig === this.sceneSig) return;
    this.sceneSig = sig;
    this.renderer.buildScene(forgings, layout);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }
}
