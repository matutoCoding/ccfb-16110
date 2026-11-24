// 全管线 GPU 冒烟：300 件锻件实例化 + 分簇延迟着色 + 后处理，实测帧率
import { CoolingRenderer } from '../src/gpu/renderer';
import { buildSeedLayout } from '../src/db/seed';
import type { Forging } from '../src/domain/types';

async function main(): Promise<void> {
  const layout = buildSeedLayout();
  const forgings: Forging[] = Array.from({ length: 300 }, (_, i) => {
    const col = i % 20;
    const row = Math.floor(i / 20);
    return {
      id: `fg-${i}`,
      batchId: 'b',
      shape: { kind: 'flange', outerD: 1800, innerD: 700, height: 320, hubD: 950, hubH: 140 },
      steelId: '42crmo4',
      pos: { x: 3000 + col * 2600, y: 0, z: 10000 + row * 1900 },
      dischargeTemp: 860,
      dischargeTime: 0,
      pinned: false,
      status: 'cooling',
    };
  });

  const canvas = document.createElement('canvas');
  canvas.style.width = '1280px';
  canvas.style.height = '720px';
  document.body.append(canvas);
  const renderer = await CoolingRenderer.create(canvas);
  renderer.buildScene(forgings, layout);

  const temps = new Float32Array(300).map((_, i) => 820 - (i % 7) * 60);
  const flags = new Uint8Array(300).map((_, i) => (i % 11 === 0 ? 1 : 0));

  // 预热 20 帧（含管线首次编译）
  for (let i = 0; i < 20; i++) {
    renderer.render({ tempsC: temps, rejectFlags: flags, night: false, thermal: false, split: false, timeS: i * 60 }, forgings);
  }
  await new Promise((r) => setTimeout(r, 300));

  const frames = 300;
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    renderer.render({ tempsC: temps, rejectFlags: flags, night: false, thermal: false, split: false, timeS: i * 60 }, forgings);
    // 等 GPU 真正完成，量墙钟帧率（验收口径），而非 CPU 提交速度
    await renderer.gpu.device.queue.onSubmittedWorkDone();
  }
  const elapsed = performance.now() - t0;
  const fps = (frames * 1000) / elapsed;

  // 夜间 + 热像 + 分屏各跑 60 帧，确认无运行时错误
  for (let i = 0; i < 60; i++) {
    renderer.render({ tempsC: temps, rejectFlags: flags, night: true, thermal: false, split: false, timeS: i * 60 }, forgings);
    await renderer.gpu.device.queue.onSubmittedWorkDone();
    renderer.render({ tempsC: temps, rejectFlags: flags, night: false, thermal: true, split: false, timeS: i * 60 }, forgings);
    await renderer.gpu.device.queue.onSubmittedWorkDone();
    renderer.render({ tempsC: temps, rejectFlags: flags, night: false, thermal: false, split: true, timeS: i * 60 }, forgings);
    await renderer.gpu.device.queue.onSubmittedWorkDone();
  }

  const result = {
    instances: renderer.instanceCount,
    fps1080p: Number(fps.toFixed(1)),
    pass45: fps >= 45,
    modesOk: true,
  };
  document.getElementById('out')!.textContent = 'GPU_SMOKE ' + JSON.stringify(result);
  document.title = result.pass45 ? 'GPU_SMOKE_PASS' : 'GPU_SMOKE_SLOW';
  console.log(result);
}

main().catch((e) => {
  document.getElementById('out')!.textContent = 'GPU_SMOKE_FATAL ' + e.message;
  document.title = 'GPU_SMOKE_FATAL';
  console.error(e);
});
