import type { Forging } from '../domain/types';
import { MM } from '../domain/geometry';
import type { CameraState, CoolingRenderer } from './renderer';

// 轨道相机控制：左键旋转、右键平移、滚轮缩放；Shift+左键拖拽锻件由 onDrag 回调处理
export function attachCamera(
  canvas: HTMLCanvasElement,
  renderer: CoolingRenderer,
  hooks: { onDrag?: (worldX: number, worldZ: number) => void } = {},
): () => void {
  let dragging: 'orbit' | 'pan' | 'piece' | null = null;
  let lastX = 0;
  let lastY = 0;

  const down = (e: PointerEvent) => {
    if (e.shiftKey && hooks.onDrag) {
      dragging = 'piece';
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    dragging = e.button === 2 ? 'pan' : 'orbit';
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    if (dragging === 'piece') {
      const p = screenToGround(canvas, e.clientX, e.clientY, renderer.cam);
      if (p) hooks.onDrag?.(p.x, p.z);
      return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dragging === 'orbit') {
      renderer.orbit(dx, dy);
    } else {
      const k = renderer.cam.dist * 0.0012;
      renderer.cam.target[0] -= dx * k * Math.cos(renderer.cam.yaw);
      renderer.cam.target[2] -= dx * k * Math.sin(renderer.cam.yaw);
      renderer.cam.target[1] = Math.max(0, renderer.cam.target[1] + dy * k);
    }
  };
  const up = () => {
    dragging = null;
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    renderer.zoom(e.deltaY > 0 ? 1.12 : 0.89);
  };
  const ctx = (e: Event) => e.preventDefault();

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', ctx);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('contextmenu', ctx);
  };
}

// 屏幕点 → 地面 y=0 世界坐标（米转 mm 由调用方处理）
export function screenToGround(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  cam: CameraState,
): { x: number; z: number } | null {
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
  const eye = cam.eye;
  const cp = Math.cos(cam.pitch);
  const forward: [number, number, number] = [
    -cp * Math.cos(cam.yaw),
    -Math.sin(cam.pitch),
    -cp * Math.sin(cam.yaw),
  ];
  const right: [number, number, number] = [-Math.sin(cam.yaw), 0, Math.cos(cam.yaw)];
  const up: [number, number, number] = [
    forward[1] * right[2] - forward[2] * right[1],
    forward[2] * right[0] - forward[0] * right[2],
    forward[0] * right[1] - forward[1] * right[0],
  ];
  const aspect = rect.width / rect.height;
  const tan = Math.tan((25 * Math.PI) / 180);
  const dir: [number, number, number] = [
    forward[0] + right[0] * nx * tan * aspect + up[0] * ny * tan,
    forward[1] + right[1] * nx * tan * aspect + up[1] * ny * tan,
    forward[2] + right[2] * nx * tan * aspect + up[2] * ny * tan,
  ];
  if (Math.abs(dir[1]) < 1e-6) return null;
  const t = -eye[1] / dir[1];
  if (t < 0) return null;
  // 渲染器内部单位为米，这里返回米，viewport 层转 mm
  return { x: eye[0] + dir[0] * t, z: eye[2] + dir[2] * t };
}

// CPU 拾取：屏幕射线对锻件圆柱做水平距离 + 高度判定
export function pickForging(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  cam: CameraState,
  forgings: Forging[],
): Forging | null {
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
  const eye = cam.eye;
  const cp = Math.cos(cam.pitch);
  const forward: [number, number, number] = [
    -cp * Math.cos(cam.yaw),
    -Math.sin(cam.pitch),
    -cp * Math.sin(cam.yaw),
  ];
  const right: [number, number, number] = [
    -Math.sin(cam.yaw),
    0,
    Math.cos(cam.yaw),
  ];
  const up: [number, number, number] = [
    forward[1] * right[2] - forward[2] * right[1],
    forward[2] * right[0] - forward[0] * right[2],
    forward[0] * right[1] - forward[1] * right[0],
  ];
  const aspect = rect.width / rect.height;
  const tan = Math.tan((25 * Math.PI) / 180);
  const dir: [number, number, number] = [
    forward[0] + right[0] * nx * tan * aspect + up[0] * ny * tan,
    forward[1] + right[1] * nx * tan * aspect + up[1] * ny * tan,
    forward[2] + right[2] * nx * tan * aspect + up[2] * ny * tan,
  ];
  const dl = Math.hypot(dir[0], dir[1], dir[2]);
  dir[0] /= dl; dir[1] /= dl; dir[2] /= dl;

  let best: Forging | null = null;
  let bestT = Infinity;
  for (const f of forgings) {
    const cx = f.pos.x * MM;
    const cz = f.pos.z * MM;
    const r = (f.shape.outerD / 2) * MM;
    const h = f.shape.height * MM;
    // 射线与竖直圆柱（y∈[0,h]）求交
    const ox = eye[0] - cx;
    const oz = eye[2] - cz;
    const a = dir[0] ** 2 + dir[2] ** 2;
    const b = 2 * (ox * dir[0] + oz * dir[2]);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > bestT) continue;
    const y = eye[1] + dir[1] * t;
    if (y < 0 || y > h) continue;
    bestT = t;
    best = f;
  }
  return best;
}
