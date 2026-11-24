// 浏览器端 WGSL 编译检查：用无头 Chrome + WebGPU 软件适配真编译
import {
  CLUSTER_BUILD_WGSL,
  DEFERRED_WGSL,
  GEO_MRT_WGSL,
  OVERLAY_WGSL,
  POST_WGSL,
} from '../src/gpu/shaders';

(window as unknown as { SHADER_SOURCES: Array<[string, string]> }).SHADER_SOURCES = [
  ['geo-mrt', GEO_MRT_WGSL],
  ['cluster-build', CLUSTER_BUILD_WGSL],
  ['deferred', DEFERRED_WGSL],
  ['post', POST_WGSL],
  ['overlay', OVERLAY_WGSL],
];
