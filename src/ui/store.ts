// 极简响应式 store：订阅 + 不可变更新
import type {
  Batch,
  Forging,
  HardnessRecord,
  ProcessRecord,
  TempReading,
  YardLayout,
} from '../domain/types';
import type { SimResult } from '../sim/engine';

export type PageId = 'layout' | 'batch' | 'sim' | 'exposure' | 'records';
export type ViewMode = 'visible' | 'thermal' | 'split' | 'night';

export interface AppState {
  ready: boolean;
  page: PageId;
  layout: YardLayout | null;
  forgings: Forging[];
  batches: Batch[];
  readings: TempReading[];
  hardness: HardnessRecord[];
  records: ProcessRecord[];
  sim: SimResult | null;
  simRunning: boolean;
  simProgress: number;
  // 时间轴当前时刻 秒
  timeS: number;
  playing: boolean;
  speed: number;
  viewMode: ViewMode;
  showContour: boolean;
  selectedForgingId: string | null;
  fps: number;
}

type Listener = (s: AppState) => void;

const state: AppState = {
  ready: false,
  page: 'layout',
  layout: null,
  forgings: [],
  batches: [],
  readings: [],
  hardness: [],
  records: [],
  sim: null,
  simRunning: false,
  simProgress: 0,
  timeS: 0,
  playing: false,
  speed: 60,
  viewMode: 'visible',
  showContour: false,
  selectedForgingId: null,
  fps: 0,
};

const listeners = new Set<Listener>();

export const store = {
  get(): AppState {
    return state;
  },
  set(patch: Partial<AppState>): void {
    Object.assign(state, patch);
    listeners.forEach((l) => l({ ...state }));
  },
  sub(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function fmtTemp(c: number): string {
  return `${c.toFixed(0)} ℃`;
}
