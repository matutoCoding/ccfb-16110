import './styles.css';
import { bootData } from './app/boot';
import { store } from './ui/store';
import { AppShell } from './ui/app_shell';
import { Viewport } from './ui/viewport';
import { CoolingRenderer } from './gpu/renderer';

async function main(): Promise<void> {
  const msg = document.getElementById('boot-msg')!;
  const fill = document.getElementById('boot-fill')!;
  const progress = (pct: number, text: string): void => {
    fill.style.width = `${pct}%`;
    msg.textContent = text;
  };

  const data = await bootData(progress);
  store.set({
    layout: data.layout,
    batches: data.batches,
    forgings: data.forgings,
    readings: data.readings,
    hardness: data.hardness,
  });

  progress(92, '初始化 WebGPU（集群延迟着色）…');
  const canvas = document.createElement('canvas');
  let renderer: CoolingRenderer;
  try {
    renderer = await CoolingRenderer.create(canvas);
  } catch (e) {
    msg.innerHTML = `WebGPU 初始化失败：${(e as Error).message}<br>请使用 Chrome/Edge 113+ 并在 chrome://flags 开启 WebGPU`;
    return;
  }

  progress(100, '就绪');
  document.getElementById('boot-splash')?.remove();
  const viewport = new Viewport(renderer);
  viewport.rebuild(data.forgings, data.layout);
  new AppShell(viewport);
  store.set({ ready: true });
}

main().catch((e) => {
  const msg = document.getElementById('boot-msg');
  if (msg) msg.textContent = `启动失败：${(e as Error).message}`;
  console.error(e);
});
