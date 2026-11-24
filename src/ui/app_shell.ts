import { store, type PageId, type ViewMode } from './store';
import { h, clear } from './dom';
import { Viewport } from './viewport';
import { renderLayoutPage } from './pages/layout_page';
import { renderBatchPage } from './pages/batch_page';
import { renderSimPage } from './pages/sim_page';
import { renderExposurePage } from './pages/exposure_page';
import { renderRecordsPage } from './pages/records_page';
import { renderValidationPanel } from './pages/validation_panel';

const NAV: Array<{ id: PageId; label: string }> = [
  { id: 'layout', label: '场地布局' },
  { id: 'batch', label: '锻件批次' },
  { id: 'sim', label: '冷却推演' },
  { id: 'exposure', label: '人员暴露' },
  { id: 'records', label: '工艺记录' },
];

const MODES: Array<{ id: ViewMode; label: string }> = [
  { id: 'visible', label: '可见光' },
  { id: 'thermal', label: '热像' },
  { id: 'split', label: '分屏' },
  { id: 'night', label: '夜班' },
];

export class AppShell {
  private sideRoot: HTMLElement;
  private viewport: Viewport;
  private unsub: () => void;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    const shell = h('div', { class: 'app-shell' });
    const topbar = h('div', { class: 'topbar' });
    topbar.append(h('div', { class: 'brand' }, ['冷却场热辐射仿真', h('span', { class: 'dot' }, [' · ']), 'WebGPU']));
    const nav = h('div', { class: 'nav' });
    NAV.forEach((n) => {
      const btn = h('button', {
        class: 'nav-item',
        'data-page': n.id,
        onclick: () => store.set({ page: n.id }),
      }, [n.label]);
      nav.append(btn);
    });
    const spacer = h('div', { class: 'topbar-spacer' });
    const modeGroup = h('div', { class: 'btn-row', style: 'gap:4px' });
    MODES.forEach((m) => {
      modeGroup.append(h('button', {
        class: 'btn small',
        'data-mode': m.id,
        onclick: () => store.set({ viewMode: m.id }),
      }, [m.label]));
    });
    const status = h('div', { class: 'topbar-status', id: 'topbar-status' });
    topbar.append(nav, spacer, modeGroup, status);

    const workspace = h('div', { class: 'workspace' });
    this.sideRoot = h('div', { class: 'side-panel scroll-y' });
    const stageWrap = h('div', { style: 'position:relative;min-width:0;display:flex' });
    stageWrap.append(viewport.el);
    workspace.append(this.sideRoot, stageWrap);
    shell.append(topbar, workspace);
    document.getElementById('app')!.append(shell);

    this.unsub = store.sub((s) => this.sync(s));
    this.sync(store.get());
  }

  private sync(s: ReturnType<typeof store.get>): void {
    document.querySelectorAll<HTMLElement>('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.page === s.page);
    });
    document.querySelectorAll<HTMLElement>('[data-mode]').forEach((el) => {
      const active = el.dataset.mode === s.viewMode;
      el.classList.toggle('primary', active);
    });
    const status = document.getElementById('topbar-status');
    if (status) {
      status.innerHTML = `锻件 <b>${s.forgings.length}</b> · FPS <b class="${s.fps >= 45 ? 'good' : 'bad'}">${s.fps.toFixed(0)}</b>`;
    }
    this.renderPage(s.page);
    if (s.layout) this.viewport.rebuild(s.forgings, s.layout);
  }

  private renderPage(page: PageId): void {
    clear(this.sideRoot);
    switch (page) {
      case 'layout':
        renderLayoutPage(this.sideRoot);
        break;
      case 'batch':
        renderBatchPage(this.sideRoot);
        break;
      case 'sim':
        renderSimPage(this.sideRoot);
        renderValidationPanel(this.sideRoot);
        break;
      case 'exposure':
        renderExposurePage(this.sideRoot);
        break;
      case 'records':
        renderRecordsPage(this.sideRoot);
        break;
    }
  }

  destroy(): void {
    this.unsub();
  }
}
