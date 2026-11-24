export interface GpuDevice {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

export async function initGpu(canvas: HTMLCanvasElement): Promise<GpuDevice> {
  if (!('gpu' in navigator)) {
    throw new Error('当前浏览器不支持 WebGPU，请使用 Chrome/Edge 113+ 或开启实验标记');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('未找到可用的 GPU 适配器');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('无法获取 WebGPU 画布上下文');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  return { device, context, format };
}

export function makeBuffer(
  device: GPUDevice,
  data: Float32Array | Uint32Array,
  usage: GPUBufferUsageFlags,
): GPUBuffer {
  const buf = device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
  new Uint8Array(buf.getMappedRange()).set(new Uint8Array(data.buffer));
  buf.unmap();
  return buf;
}

export function makeEmptyBuffer(device: GPUDevice, size: number, usage: GPUBufferUsageFlags): GPUBuffer {
  return device.createBuffer({ size, usage });
}
