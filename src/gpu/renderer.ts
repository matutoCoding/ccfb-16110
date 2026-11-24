import type { Forging, YardLayout } from '../domain/types';
import { MM } from '../domain/geometry';
import { initGpu, makeBuffer, makeEmptyBuffer, type GpuDevice } from './device';
import { makeBoxMesh, makeConeMesh, makeCylinderMesh, type MeshData } from './meshes';
import {
  CLUSTER_BUILD_WGSL,
  DEFERRED_WGSL,
  GEO_MRT_WGSL,
  OVERLAY_WGSL,
  POST_WGSL,
} from './shaders';

export interface CameraState {
  eye: [number, number, number];
  target: [number, number, number];
  yaw: number;
  pitch: number;
  dist: number;
}

export interface RenderFrame {
  tempsC: Float32Array;
  rejectFlags: Uint8Array;
  night: boolean;
  thermal: boolean;
  split: boolean;
  timeS: number;
}

interface InstanceRow {
  model: Float32Array;
  radius: number;
  halfH: number;
  id: number;
  emissive: number;
}

const LIGHT_FLOATS = 8;
const MAX_LIGHTS = 512;
const CLUSTER_MAX = 96;

function mat4Identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4ScaleTranslate(sx: number, sy: number, sz: number, tx: number, ty: number, tz: number): Float32Array {
  const m = mat4Identity();
  m[0] = sx;
  m[5] = sy;
  m[10] = sz;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  return m;
}

function mat4YawScale(yaw: number, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number): Float32Array {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const m = mat4Identity();
  m[0] = c * sx;
  m[2] = -s * sz;
  m[8] = s * sx;
  m[10] = c * sz;
  m[5] = sy;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  return m;
}

function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

function lookAt(eye: number[], target: number[]): Float32Array {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz);
  const z = [zx / zl, zy / zl, zz / zl];
  const up = [0, 1, 0];
  const xx = up[1] * z[2] - up[2] * z[1];
  const xy = up[2] * z[0] - up[0] * z[2];
  const xz = up[0] * z[1] - up[1] * z[0];
  const xl = Math.hypot(xx, xy, xz);
  const x = [xx / xl, xy / xl, xz / xl];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const m = mat4Identity();
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  return m;
}

function matMul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function invertAffine(m: Float32Array): Float32Array {
  const o = new Float32Array(16);
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const id = 1 / det;
  o[0] = (e * i - f * h) * id; o[4] = (c * h - b * i) * id; o[8] = (b * f - c * e) * id;
  o[1] = (f * g - d * i) * id; o[5] = (a * i - c * g) * id; o[9] = (c * d - a * f) * id;
  o[2] = (d * h - e * g) * id; o[6] = (b * g - a * h) * id; o[10] = (a * e - b * d) * id;
  o[15] = 1;
  o[12] = -(o[0] * m[12] + o[4] * m[13] + o[8] * m[14]);
  o[13] = -(o[1] * m[12] + o[5] * m[13] + o[9] * m[14]);
  o[14] = -(o[2] * m[12] + o[6] * m[13] + o[10] * m[14]);
  return o;
}

export class CoolingRenderer {
  gpu: GpuDevice;
  canvas: HTMLCanvasElement;
  cam: CameraState = {
    eye: [30000, 26000, 34000],
    target: [30000, 0, 20000],
    yaw: 0.7,
    pitch: 0.62,
    dist: 38000,
  };

  private cyl: MeshData;
  private box: MeshData;
  private cone: MeshData;
  private geoPipeline!: GPURenderPipeline;
  private deferredPipeline!: GPURenderPipeline;
  private postPipeline!: GPURenderPipeline;
  private clusterPipeline!: GPUComputePipeline;
  private overlayPipeline!: GPURenderPipeline;
  private geoBind!: GPUBindGroup;
  private clusterBind!: GPUBindGroup;
  private deferredBind!: GPUBindGroup;
  private postBind!: GPUBindGroup;
  private overlayBind: GPUBindGroup | null = null;

  private uniformBuf!: GPUBuffer;
  private instanceBuf!: GPUBuffer;
  private tempBuf!: GPUBuffer;
  private flagBuf!: GPUBuffer;
  private lightBuf!: GPUBuffer;
  private clusterIndexBuf!: GPUBuffer;
  private clusterCountBuf!: GPUBuffer;
  private overlayBuf!: GPUBuffer;
  private overlayCount = 0;

  private gWorld!: GPUTexture;
  private gNormal!: GPUTexture;
  private gEmit!: GPUTexture;
  private gFlag!: GPUTexture;
  private gDepth!: GPUTexture;
  private hdrTex!: GPUTexture;
  private gViews!: GPUTextureView[];
  private hdrView!: GPUTextureView;
  private sampler!: GPUSampler;

  private instanceRows: InstanceRow[] = [];
  private forgingIndexMap = new Map<string, number>();
  private frameCount = 0;
  private lastFpsT = performance.now();
  fps = 0;
  onFps?: (fps: number) => void;

  constructor(canvas: HTMLCanvasElement, gpu: GpuDevice) {
    this.canvas = canvas;
    this.gpu = gpu;
    this.cyl = makeCylinderMesh();
    this.box = makeBoxMesh();
    this.cone = makeConeMesh();
  }

  static async create(canvas: HTMLCanvasElement): Promise<CoolingRenderer> {
    const gpu = await initGpu(canvas);
    const r = new CoolingRenderer(canvas, gpu);
    r.initResources();
    return r;
  }

  private initResources(): void {
    const { device, format } = this.gpu;
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.uniformBuf = makeEmptyBuffer(device, 256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.instanceBuf = makeEmptyBuffer(device, 16384 * 80, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.tempBuf = makeEmptyBuffer(device, 16384 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.flagBuf = makeEmptyBuffer(device, 16384 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.lightBuf = makeEmptyBuffer(device, MAX_LIGHTS * LIGHT_FLOATS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const tilesX = Math.ceil(1920 / 32);
    const tilesY = Math.ceil(1080 / 32);
    const clusterNum = tilesX * tilesY * 8;
    this.clusterIndexBuf = makeEmptyBuffer(device, clusterNum * CLUSTER_MAX * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.clusterCountBuf = makeEmptyBuffer(device, clusterNum * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.overlayBuf = makeEmptyBuffer(device, 8192 * 32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.createTargets();
    this.createPipelines(format);
  }

  // 内部按 1080p 固定 G-Buffer 分辨率渲染（验收口径），CSS 缩放到容器
  private createTargets(): void {
    const { device } = this.gpu;
    const w = 1920;
    const h = 1080;
    this.canvas.width = w;
    this.canvas.height = h;
    const mk = (usage: GPUTextureUsageFlags, f: GPUTextureFormat = 'rgba32float'): GPUTexture =>
      device.createTexture({ size: [w, h], format: f, usage });
    this.gWorld = mk(GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
    this.gNormal = mk(GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
    this.gEmit = mk(GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
    this.gFlag = mk(GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
    this.gDepth = device.createTexture({
      size: [w, h],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.hdrTex = mk(GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
    this.gViews = [this.gWorld, this.gNormal, this.gEmit, this.gFlag].map((t) => t.createView());
    this.hdrView = this.hdrTex.createView();
  }

  private createPipelines(format: GPUTextureFormat): void {
    const { device } = this.gpu;
    const geoMod = device.createShaderModule({ code: GEO_MRT_WGSL });
    const cylVerts = makeBuffer(device, this.cyl.positions, GPUBufferUsage.VERTEX);
    const cylNormals = makeBuffer(device, this.cyl.normals, GPUBufferUsage.VERTEX);
    const cylIdx = makeBuffer(device, this.cyl.indices, GPUBufferUsage.INDEX);
    void boxVertsGuard(this.box, this.cone);

    this.geoPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: geoMod,
        entryPoint: 'vs_main',
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
        ],
      },
      fragment: {
        module: geoMod,
        entryPoint: 'fs_main',
        targets: [
          { format: 'rgba32float' },
          { format: 'rgba32float' },
          { format: 'rgba32float' },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.geoBind = device.createBindGroup({
      layout: this.geoPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.instanceBuf } },
        { binding: 2, resource: { buffer: this.tempBuf } },
        { binding: 3, resource: { buffer: this.flagBuf } },
      ],
    });
    this.cylVerts = cylVerts;
    this.cylNormals = cylNormals;
    this.cylIdx = cylIdx;
    this.cylIndexCount = this.cyl.indices.length;

    const clusterMod = device.createShaderModule({ code: CLUSTER_BUILD_WGSL });
    this.clusterPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: clusterMod, entryPoint: 'cs_main' },
    });
    this.clusterBind = device.createBindGroup({
      layout: this.clusterPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.lightBuf } },
        { binding: 2, resource: { buffer: this.clusterIndexBuf } },
        { binding: 3, resource: { buffer: this.clusterCountBuf } },
      ],
    });

    const defMod = device.createShaderModule({ code: DEFERRED_WGSL });
    this.deferredPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: defMod, entryPoint: 'vs_main' },
      fragment: { module: defMod, entryPoint: 'fs_main', targets: [{ format: 'rgba32float' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.deferredBind = device.createBindGroup({
      layout: this.deferredPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: this.gViews[0] },
        { binding: 2, resource: this.gViews[1] },
        { binding: 3, resource: this.gViews[2] },
        { binding: 4, resource: this.gViews[3] },
        { binding: 5, resource: this.gDepth.createView() },
        { binding: 6, resource: { buffer: this.lightBuf } },
        { binding: 7, resource: { buffer: this.clusterIndexBuf } },
        { binding: 8, resource: { buffer: this.clusterCountBuf } },
        { binding: 9, resource: { buffer: this.tempBuf } },
      ],
    });

    const postMod = device.createShaderModule({ code: POST_WGSL });
    this.postPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: postMod, entryPoint: 'vs_full' },
      fragment: { module: postMod, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.postBind = device.createBindGroup({
      layout: this.postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: this.hdrView },
        { binding: 2, resource: this.gViews[3] },
        { binding: 3, resource: this.gDepth.createView() },
        { binding: 4, resource: this.sampler },
      ],
    });

    const ovMod = device.createShaderModule({ code: OVERLAY_WGSL });
    this.overlayPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: ovMod, entryPoint: 'vs_main' },
      fragment: { module: ovMod, entryPoint: 'fs_main', targets: [{ format: 'rgba32float' }] },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less' },
    });
    void format;
  }

  private cylVerts!: GPUBuffer;
  private cylNormals!: GPUBuffer;
  private cylIdx!: GPUBuffer;
  private cylIndexCount = 0;

  // 场景构建：锻件 + 场地对象 → 实例行
  buildScene(forgings: Forging[], layout: YardLayout): void {
    this.instanceRows = [];
    this.forgingIndexMap.clear();
    forgings.forEach((f, i) => {
      const r = (f.shape.outerD / 2) * MM;
      const h = (f.shape.height / 2) * MM;
      this.instanceRows.push({
        model: mat4ScaleTranslate(r, h, r, f.pos.x * MM, h, f.pos.z * MM),
        radius: r,
        halfH: h,
        id: i,
        emissive: 1,
      });
      this.forgingIndexMap.set(f.id, i);
    });

    // 地面
    this.instanceRows.push({
      model: mat4ScaleTranslate(layout.sizeX * MM * 0.5, 1, layout.sizeZ * MM * 0.5, layout.sizeX * MM * 0.5, -0.5, layout.sizeZ * MM * 0.5),
      radius: 0, halfH: 0, id: 100001, emissive: 0,
    });
    for (const o of layout.objects) {
      if (o.kind === 'shield') {
        this.instanceRows.push({
          model: mat4YawScale((o.yawDeg * Math.PI) / 180, o.length * MM * 0.5, o.height * MM * 0.5, o.thickness * MM * 0.5, o.pos.x * MM, o.height * MM * 0.5, o.pos.z * MM),
          radius: 0, halfH: 0, id: 100002, emissive: 0,
        });
      } else if (o.kind === 'fan') {
        this.instanceRows.push({
          model: mat4YawScale((o.yawDeg * Math.PI) / 180, 1.2, 1.6, 1.2, o.pos.x * MM, 1.6, o.pos.z * MM),
          radius: 0, halfH: 0, id: 100003, emissive: 0,
        });
      } else if (o.kind === 'station') {
        this.instanceRows.push({
          model: mat4ScaleTranslate(0.35, 0.9, 0.35, o.pos.x * MM, 0.9, o.pos.z * MM),
          radius: 0, halfH: 0, id: 100004, emissive: 0,
        });
      } else if (o.kind === 'aisle') {
        this.instanceRows.push({
          model: mat4ScaleTranslate(o.length * MM * 0.5, 0.02, o.width * MM * 0.5, o.pos.x * MM, 0.02, o.pos.z * MM),
          radius: 0, halfH: 0, id: 100005, emissive: 0,
        });
      }
    }
    this.uploadInstances();
  }

  // 统一 buffer 写入，规避 TS5.7 泛型 TypedArray 与 WebGPU 类型定义的兼容摩擦
  private wb(buf: GPUBuffer, data: Float32Array | Uint32Array | Uint8Array): void {
    this.gpu.device.queue.writeBuffer(buf, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  }

  private uploadInstances(): void {
    const stride = 20;
    const data = new Float32Array(this.instanceRows.length * stride);
    this.instanceRows.forEach((row, i) => {
      data.set(row.model, i * stride);
      data[i * stride + 16] = row.radius;
      data[i * stride + 17] = row.halfH;
      data[i * stride + 18] = row.id;
      data[i * stride + 19] = row.emissive;
    });
    this.wb(this.instanceBuf, data);
  }

  // 光源：每件高温锻件一个球光源，位置取锻件中心高度
  private uploadLights(tempsC: Float32Array, forgings: Forging[]): void {
    const data = new Float32Array(MAX_LIGHTS * LIGHT_FLOATS);
    let n = 0;
    for (let i = 0; i < forgings.length && n < MAX_LIGHTS; i++) {
      const t = tempsC[i] ?? 30;
      if (t < 380) continue;
      const f = forgings[i];
      const hot = Math.min(1, Math.max(0, (t - 380) / 480));
      const range = (3 + hot * 7 + f.shape.outerD * MM * 2.2);
      const base = n * LIGHT_FLOATS;
      data[base] = f.pos.x * MM;
      data[base + 1] = f.shape.height * MM * 0.8;
      data[base + 2] = f.pos.z * MM;
      data[base + 3] = 1;
      // 黑体色（简化分段）
      data[base + 4] = 1.0;
      data[base + 5] = 0.45 + hot * 0.4;
      data[base + 6] = 0.12 + hot * 0.25;
      data[base + 7] = 1;
      data[base + 8] = range;
      data[base + 9] = hot * hot * 2.4;
      n++;
    }
    this.wb(this.lightBuf, data);
  }

  forgingIdAt(instanceId: number): string | undefined {
    for (const [id, idx] of this.forgingIndexMap) if (idx === instanceId) return id;
    return undefined;
  }

  get instanceCount(): number {
    return this.instanceRows.length;
  }

  // 等值线叠加
  setOverlay(lines: Array<{ x1: number; z1: number; x2: number; z2: number; level: number }>): void {
    const stride = 8;
    const data = new Float32Array(Math.min(lines.length, 8192) * stride);
    lines.slice(0, 8192).forEach((l, i) => {
      const b = i * stride;
      data[b] = l.x1 * MM; data[b + 1] = 0.06; data[b + 2] = l.z1 * MM; data[b + 3] = 1;
      data[b + 4] = l.x2 * MM; data[b + 5] = 0.06; data[b + 6] = l.z2 * MM; data[b + 7] = l.level;
    });
    this.wb(this.overlayBuf, data);
    this.overlayCount = Math.min(lines.length, 8192);
    this.overlayBind = this.gpu.device.createBindGroup({
      layout: this.overlayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: { buffer: this.overlayBuf } },
      ],
    });
  }

  // 渲染主循环由外部 rAF 驱动；分屏时左右各跑一次完整管线（共享相机）
  render(frame: RenderFrame, forgings: Forging[]): void {
    if (frame.split) {
      this.renderPass({ ...frame, split: false, thermal: false, night: frame.night }, forgings, { x: 0, w: 960 });
      this.renderPass({ ...frame, split: false, thermal: true, night: false }, forgings, { x: 960, w: 960 });
    } else {
      this.renderPass(frame, forgings, { x: 0, w: 1920 });
    }
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsT >= 1000) {
      this.fps = (this.frameCount * 1000) / (now - this.lastFpsT);
      this.frameCount = 0;
      this.lastFpsT = now;
      this.onFps?.(this.fps);
    }
  }

  private renderPass(frame: RenderFrame, forgings: Forging[], scissor: { x: number; w: number }): void {
    const { device } = this.gpu;
    const eye = this.eyeFromOrbit();
    const view = lookAt(eye, this.cam.target);
    // 分屏单侧宽高比与全幅不同，投影按半幅重算保证两侧各自不变形
    const aspect = scissor.w / 1080;
    const proj = perspective((50 * Math.PI) / 180, aspect, 1, 95000);
    const vp = matMul(proj, view);
    const inv = invertAffine(vp);

    const u2 = new Float32Array(32);
    u2.set(vp, 0);
    u2.set(inv, 16);
    u2[16] = eye[0]; u2[17] = eye[1]; u2[18] = eye[2]; u2[19] = 0;
    u2[20] = frame.night ? 1 : 0;
    u2[21] = frame.thermal ? 1 : 0;
    u2[22] = frame.timeS;
    this.wb(this.uniformBuf, u2);

    this.wb(this.tempBuf, frame.tempsC);
    const flags = new Uint32Array(frame.rejectFlags.length);
    frame.rejectFlags.forEach((v, i) => (flags[i] = v));
    this.wb(this.flagBuf, flags);
    this.uploadLights(frame.tempsC, forgings);

    const encoder = device.createCommandEncoder();

    // 1. G-Buffer（分屏时只清当前半幅，避免两侧互相覆盖）
    const gPass = encoder.beginRenderPass({
      colorAttachments: [
        { view: this.gViews[0], clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: scissor.x === 0 ? 'clear' : 'load', storeOp: 'store' },
        { view: this.gViews[1], clearValue: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, loadOp: scissor.x === 0 ? 'clear' : 'load', storeOp: 'store' },
        { view: this.gViews[2], clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: scissor.x === 0 ? 'clear' : 'load', storeOp: 'store' },
        { view: this.gViews[3], clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: scissor.x === 0 ? 'clear' : 'load', storeOp: 'store' },
      ],
      depthStencilAttachment: {
        view: this.gDepth.createView(),
        depthClearValue: 1,
        depthLoadOp: scissor.x === 0 ? 'clear' : 'load',
        depthStoreOp: 'store',
      },
    });
    gPass.setPipeline(this.geoPipeline);
    gPass.setBindGroup(0, this.geoBind);
    gPass.setVertexBuffer(0, this.cylVerts);
    gPass.setVertexBuffer(1, this.cylNormals);
    gPass.setIndexBuffer(this.cylIdx, 'uint32');
    gPass.setScissorRect(scissor.x, 0, scissor.w, 1080);
    gPass.drawIndexed(this.cylIndexCount, this.instanceRows.length);
    gPass.end();

    // 2. 分簇计算
    const cPass = encoder.beginComputePass();
    cPass.setPipeline(this.clusterPipeline);
    cPass.setBindGroup(0, this.clusterBind);
    cPass.dispatchWorkgroups(8, 5, 4);
    cPass.end();

    // 3. 延迟光照 → HDR
    const dPass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: scissor.x === 0 ? 'clear' : 'load', storeOp: 'store' }],
    });
    dPass.setPipeline(this.deferredPipeline);
    dPass.setBindGroup(0, this.deferredBind);
    dPass.setScissorRect(scissor.x, 0, scissor.w, 1080);
    dPass.draw(6);
    if (this.overlayBind && this.overlayCount > 0 && !frame.thermal) {
      dPass.setPipeline(this.overlayPipeline);
      dPass.setBindGroup(0, this.overlayBind);
      dPass.draw(2, this.overlayCount);
    }
    dPass.end();

    // 4. 后处理 → 画布（scissor 限定半幅）
    const out = this.gpu.context.getCurrentTexture().createView();
    const pPass = encoder.beginRenderPass({
      colorAttachments: [{ view: out, loadOp: scissor.x === 0 ? 'clear' : 'load', storeOp: 'store' }],
    });
    pPass.setPipeline(this.postPipeline);
    pPass.setBindGroup(0, this.postBind);
    pPass.setScissorRect(scissor.x, 0, scissor.w, 1080);
    pPass.draw(6);
    pPass.end();

    device.queue.submit([encoder.finish()]);
  }

  eyeFromOrbit(): number[] {
    const cp = Math.cos(this.cam.pitch);
    return [
      this.cam.target[0] + this.cam.dist * cp * Math.cos(this.cam.yaw),
      this.cam.target[1] + this.cam.dist * Math.sin(this.cam.pitch),
      this.cam.target[2] + this.cam.dist * cp * Math.sin(this.cam.yaw),
    ];
  }

  orbit(dx: number, dy: number): void {
    this.cam.yaw -= dx * 0.005;
    this.cam.pitch = Math.min(1.45, Math.max(0.08, this.cam.pitch + dy * 0.005));
  }

  zoom(factor: number): void {
    this.cam.dist = Math.min(90000, Math.max(4000, this.cam.dist * factor));
  }
}

function boxVertsGuard(_b: MeshData, _c: MeshData): void {
  // 占位：盒/锥网格在后续场地细化时接入，当前统一走圆柱实例
}
