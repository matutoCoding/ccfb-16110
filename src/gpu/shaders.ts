// WGSL 着色器库：G-Buffer 前向几何 → 分簇计算 → 延迟光照 → 后处理
export const COMMON_WGSL = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  eye: vec3<f32>,
  pad0: f32,
  nightFactor: f32,
  thermalMode: f32,
  time: f32,
  pad1: f32,
};

fn unproject(ndc: vec3<f32>, inv: mat4x4<f32>) -> vec3<f32> {
  let h = inv * vec4<f32>(ndc, 1.0);
  return h.xyz / h.w;
}

// 黑体色温（与 TS 端 blackbodyColor 同一套近似）
fn blackbody(tempC: f32) -> vec4<f32> {
  let t = tempC + 273.15;
  let t100 = t / 100.0;
  var r = 1.0; var g = 1.0; var b = 1.0;
  if (t <= 660.0) { r = 0.0; } else { r = 329.6987 * pow(t100 - 60.0, -0.1332); }
  if (t <= 660.0) { g = 99.4708 * log(t100) - 161.1196; } else { g = 288.1222 * pow(t100 - 60.0, -0.0755); }
  if (t >= 660.0) { b = 255.0; } else if (t <= 190.0) { b = 0.0; } else { b = 138.5177 * log(t100 - 10.0) - 305.0448; }
  r = clamp(r, 0.0, 255.0) / 255.0;
  g = clamp(g, 0.0, 255.0) / 255.0;
  b = clamp(b, 0.0, 255.0) / 255.0;
  var intensity = clamp((tempC - 380.0) / 420.0, 0.0, 1.0);
  if (tempC < 500.0) {
    let k = clamp((tempC - 350.0) / 150.0, 0.0, 1.0);
    r = r * (0.25 + 0.75 * k);
    g = g * 0.08 * k;
    b = 0.0;
  }
  return vec4<f32>(r, g, b, intensity);
}

// 铁红伪彩
fn thermalColor(n: f32) -> vec3<f32> {
  let x = clamp(n, 0.0, 1.0);
  let stops = array<vec4<f32>, 6>(
    vec4<f32>(0.0, 0.05, 0.02, 0.18),
    vec4<f32>(0.25, 0.1, 0.25, 0.75),
    vec4<f32>(0.5, 0.15, 0.75, 0.65),
    vec4<f32>(0.7, 0.95, 0.85, 0.2),
    vec4<f32>(0.88, 0.95, 0.35, 0.1),
    vec4<f32>(1.0, 0.95, 0.95, 0.92)
  );
  for (var i = 0; i < 5; i++) {
    let a = stops[i]; let c = stops[i + 1];
    if (x >= a.x && x <= c.x) {
      let k = (x - a.x) / (c.x - a.x);
      return mix(a.yzw, c.yzw, k);
    }
  }
  return stops[5].yzw;
}
`;

// G-Buffer MRT：世界坐标 / 法线+ID / 自发光 / 不合格标记
export const GEO_MRT_WGSL = /* wgsl */ `
${COMMON_WGSL}
struct Uniforms { cam: Camera, };
struct Instance {
  model: mat4x4<f32>,
  radius: f32,
  halfH: f32,
  id: f32,
  emissive: f32,
  pad: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(2) var<storage, read> temps: array<f32>; // 每件表面温度 ℃
@group(0) @binding(3) var<storage, read> flags: array<u32>;  // 1=不合格描边

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) iid: f32,
  @location(3) emissive: f32,
};
@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) nrm: vec3<f32>, @builtin(instance_index) ii: u32) -> VSOut {
  let it = instances[ii];
  let w = it.model * vec4<f32>(pos, 1.0);
  var out: VSOut;
  out.clip = u.cam.viewProj * w;
  out.world = w.xyz;
  out.normal = normalize((it.model * vec4<f32>(nrm, 0.0)).xyz);
  out.iid = it.id;
  out.emissive = it.emissive;
  return out;
}
struct MRT {
  @location(0) normalId: vec4<f32>, // xyz 法线, w id
  @location(1) emit: vec4<f32>,     // rgb 自发光颜色, a 强度
  @location(2) flag: vec4<f32>,     // r=不合格标记
};
@fragment
fn fs_main(in: VSOut) -> MRT {
  let n = arrayLength(&temps);
  // 环境件 id 为大值，统一映射到 0 号温度槽并关闭发光
  let isPiece = in.iid < 100000.0;
  var idx = u32(in.iid);
  idx = min(idx, n - 1u);
  var tempC = 30.0;
  var bb = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var power = 0.0;
  if (isPiece) {
    tempC = temps[idx];
    bb = blackbody(tempC);
    power = bb.a * (0.35 + 0.65 * clamp((tempC - 400.0) / 500.0, 0.0, 1.0));
  }
  var out: MRT;
  out.normalId = vec4<f32>(in.normal * 0.5 + 0.5, in.iid + 0.5);
  out.emit = vec4<f32>(bb.rgb * power * 2.2, power);
  let fl = select(0.0, f32(flags[idx]), isPiece);
  out.flag = vec4<f32>(fl, 0.0, 0.0, 1.0);
  return out;
}
`;

export const CLUSTER_BUILD_WGSL = /* wgsl */ `
${COMMON_WGSL}
struct Uniforms { cam: Camera, };
struct Light { pos: vec4<f32>, color: vec4<f32>, range: f32, intensity: f32, pad1: f32, pad2: f32, };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> lights: array<Light>;
@group(0) @binding(2) var<storage, read_write> indexBuf: array<u32>;
@group(0) @binding(3) var<storage, read_write> countBuf: array<u32>;

// 分簇参数：1080p 下 60×34 瓦片 ×8 深度层
const TILE_PX: f32 = 32.0;
const SLICES: f32 = 8.0;
const MAX_LIGHTS: u32 = 96u;
const NEAR: f32 = 1.0;
const DEPTH_SPAN: f32 = 90000.0;

fn sphereAabb(center: vec3<f32>, r: f32, mn: vec3<f32>, mx: vec3<f32>) -> bool {
  let q = max(mn, min(center, mx));
  return distance(center, q) <= r;
}

@compute @workgroup_size(8, 8, 2)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let tilesX = u32(ceil(1920.0 / TILE_PX));
  let tilesY = u32(ceil(1080.0 / TILE_PX));
  if (gid.x >= tilesX || gid.y >= tilesY || f32(gid.z) >= SLICES) { return; }
  let cid = gid.x + gid.y * tilesX + gid.z * tilesX * tilesY;

  // 瓦片屏幕边界 → NDC
  let x0 = f32(gid.x) * TILE_PX / 1920.0 * 2.0 - 1.0;
  let x1 = f32(gid.x + 1u) * TILE_PX / 1920.0 * 2.0 - 1.0;
  let y1 = 1.0 - f32(gid.y) * TILE_PX / 1080.0 * 2.0;
  let y0 = 1.0 - f32(gid.y + 1u) * TILE_PX / 1080.0 * 2.0;
  let zNear = NEAR + f32(gid.z) * (DEPTH_SPAN / SLICES);
  let zFar = NEAR + f32(gid.z + 1u) * (DEPTH_SPAN / SLICES);

  // 视锥四角在近/远平面的世界坐标，求轴对齐包围盒
  var mn = vec3<f32>(1e9, 1e9, 1e9);
  var mx = vec3<f32>(-1e9, -1e9, -1e9);
  let corners = array<vec4<f32>, 8>(
    vec4<f32>(x0, y0, zNear, 1.0), vec4<f32>(x1, y0, zNear, 1.0),
    vec4<f32>(x1, y1, zNear, 1.0), vec4<f32>(x0, y1, zNear, 1.0),
    vec4<f32>(x0, y0, zFar, 1.0), vec4<f32>(x1, y0, zFar, 1.0),
    vec4<f32>(x1, y1, zFar, 1.0), vec4<f32>(x0, y1, zFar, 1.0),
  );
  for (var i = 0; i < 8; i++) {
    let w = unproject(corners[i].xyz, u.cam.invViewProj);
    mn = min(mn, w);
    mx = max(mx, w);
  }

  var count = 0u;
  let base = cid * MAX_LIGHTS;
  for (var i = 0u; i < arrayLength(&lights); i++) {
    let L = lights[i];
    if (sphereAabb(L.pos.xyz, L.range, mn, mx) && count < MAX_LIGHTS) {
      indexBuf[base + count] = i;
      count = count + 1u;
    }
  }
  countBuf[cid] = count;
}
`;

// 延迟光照：单 pass 遍历当前像素所属簇的光源，无一件一 pass
export const DEFERRED_WGSL = /* wgsl */ `
${COMMON_WGSL}
struct Uniforms { cam: Camera, };
struct Light { pos: vec4<f32>, color: vec4<f32>, range: f32, intensity: f32, pad1: f32, pad2: f32, };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var gWorld: texture_2d<f32>;
@group(0) @binding(2) var gNormal: texture_2d<f32>;
@group(0) @binding(3) var gEmit: texture_2d<f32>;
@group(0) @binding(4) var gFlag: texture_2d<f32>;
@group(0) @binding(5) var gDepth: texture_depth_2d;
@group(0) @binding(6) var<storage, read> lights: array<Light>;
@group(0) @binding(7) var<storage, read> indexBuf: array<u32>;
@group(0) @binding(8) var<storage, read> countBuf: array<u32>;
@group(0) @binding(9) var<storage, read> temps: array<f32>;

const TILE_PX: f32 = 32.0;
const SLICES: f32 = 8.0;
const MAX_LIGHTS: u32 = 96u;
const NEAR: f32 = 1.0;
const DEPTH_SPAN: f32 = 90000.0;

struct VSOut { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32>, };
@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0));
  var out: VSOut;
  out.clip = vec4<f32>(p[vi], 0.0, 1.0);
  out.uv = p[vi] * 0.5 + 0.5;
  return out;
}

fn clusterId(uv: vec2<f32>, worldZ: f32) -> u32 {
  let tilesX = u32(ceil(1920.0 / TILE_PX));
  let tilesY = u32(ceil(1080.0 / TILE_PX));
  let tx = min(tilesX - 1u, u32(uv.x * 1920.0 / TILE_PX));
  let ty = min(tilesY - 1u, u32((1.0 - uv.y) * 1080.0 / TILE_PX));
  let eyeDist = distance(u.cam.eye, textureLoad(gWorld, vec2<u32>(uv * vec2<f32>(1920.0, 1080.0)), 0).xyz);
  let slice = min(u32(SLICES) - 1u, u32(clamp((eyeDist - NEAR) / (DEPTH_SPAN / SLICES), 0.0, SLICES - 1.0)));
  return tx + ty * tilesX + slice * tilesX * tilesY;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let px = vec2<u32>(in.uv * vec2<f32>(1920.0, 1080.0));
  let world = textureLoad(gWorld, px, 0).xyz;
  let nid = textureLoad(gNormal, px, 0);
  let nrm = normalize(nid.xyz * 2.0 - 1.0);
  let emit = textureLoad(gEmit, px, 0);
  let flag = textureLoad(gFlag, px, 0).r;
  let depth = textureLoad(gDepth, px, 0);

  if (u.cam.thermalMode > 0.5) {
    var idx = u32(nid.w - 0.5);
    var col: vec3<f32>;
    if (idx < 100000u) {
      idx = min(idx, arrayLength(&temps) - 1u);
      let tempC = temps[idx];
      let norm = clamp((tempC - 40.0) / 820.0, 0.0, 1.0);
      col = thermalColor(norm);
      if (flag > 0.5) { col = mix(col, vec3<f32>(1.0, 0.1, 0.9), 0.35); }
    } else {
      col = vec3<f32>(0.03, 0.035, 0.05);
    }
    return vec4<f32>(col, 1.0);
  }

  // 地面/环境基底：夜间只留微弱月光，白天给中性环境光
  let base = mix(0.012, 0.16, 1.0 - u.cam.nightFactor);
  var col = vec3<f32>(base);
  // 非金属锻件氧化皮基色
  var albedo = vec3<f32>(0.16, 0.15, 0.14);
  if (nid.w < 0.5) { albedo = vec3<f32>(0.11, 0.12, 0.14); }
  col = albedo * base;

  let cid = clusterId(in.uv, world.z);
  let count = min(countBuf[cid], MAX_LIGHTS);
  let lightBase = cid * MAX_LIGHTS;
  for (var k = 0u; k < count; k++) {
    let L = lights[indexBuf[lightBase + k]];
    let toL = L.pos.xyz - world;
    let d = length(toL);
    if (d > L.range) { continue; }
    let dir = toL / d;
    let atten = pow(clamp(1.0 - d / L.range, 0.0, 1.0), 1.6) * L.intensity;
    let ndl = max(dot(nrm, dir), 0.0);
    // Blinn-Phong 高光，模拟地面/屏面反光
    let halfV = normalize(dir + normalize(u.cam.eye - world));
    let spec = pow(max(dot(nrm, halfV), 0.0), 24.0) * 0.55;
    col += albedo * L.color.rgb * (ndl * atten) + L.color.rgb * (spec * atten);
  }

  // 自发光本体（黑体辐射色）
  col += emit.rgb;
  // 不合格件红色描边（屏幕空间边缘由后处理加深，这里先给底色）
  if (flag > 0.5) { col = mix(col, vec3<f32>(1.0, 0.12, 0.08), 0.45); }
  return vec4<f32>(col, 1.0);
}
`;

// 后处理：bloom 降采样 + 高斯 + 合成，描边 Sobel，ACES tonemap
export const POST_WGSL = /* wgsl */ `
${COMMON_WGSL}
struct Uniforms { cam: Camera, };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var hdr: texture_2d<f32>;
@group(0) @binding(2) var gFlag: texture_2d<f32>;
@group(0) @binding(3) var gDepth: texture_depth_2d;
@group(0) @binding(4) var samp: sampler;

struct VSOut { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32>, };
@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0));
  var out: VSOut;
  out.clip = vec4<f32>(p[vi], 0.0, 1.0);
  out.uv = p[vi] * 0.5 + 0.5;
  return out;
}

fn aces(c: vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let cc = 2.43; let d = 0.59; let e = 0.14;
  return clamp((c * (a * c + b)) / (c * (cc * c + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var col = textureSample(hdr, samp, in.uv).rgb;
  // 自发光高亮区域提bloom（hdr 中 >0.85 部分）
  let bloom = max(col - vec3<f32>(0.85), vec3<f32>(0.0));
  var blur = vec3<f32>(0.0);
  let off = 1.0 / vec2<f32>(1920.0, 1080.0) * 2.0;
  let w = array<f32, 9>(0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let s = textureSample(hdr, samp, in.uv + vec2<f32>(f32(x), f32(y)) * off);
      blur += max(s.rgb - vec3<f32>(0.85), vec3<f32>(0.0)) * w[(y + 1) * 3 + (x + 1)];
    }
  }
  col += blur * 1.35 + bloom * 0.4;

  // 不合格件 Sobel 描边
  let px = vec2<u32>(in.uv * vec2<f32>(1920.0, 1080.0));
  var edge = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let f = textureLoad(gFlag, px + vec2<u32>(u32(i32(x) + 1), u32(i32(y) + 1)), 0).r;
      edge += f * f32(x * x + y * y);
    }
  }
  if (edge > 0.4) { col = mix(col, vec3<f32>(1.0, 0.15, 0.1), 0.8); }

  col = aces(col);
  // 线性 → sRGB 近似 gamma
  col = pow(col, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(col, 1.0);
}
`;

// 地面通量等值线/网格叠加
export const OVERLAY_WGSL = /* wgsl */ `
${COMMON_WGSL}
struct Uniforms { cam: Camera, };
struct LineV { p0: vec4<f32>, p1: vec4<f32>, level: f32, pad: vec3<f32>, };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> lines: array<LineV>;
struct VSOut { @builtin(position) clip: vec4<f32>, @location(0) level: f32, };
@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let L = lines[ii];
  let p = select(L.p1, L.p0, vi == 0u);
  var out: VSOut;
  out.clip = u.cam.viewProj * vec4<f32>(p.xyz, 1.0);
  out.level = L.level;
  return out;
}
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // 预警黄 → 超限红
  let k = clamp(in.level / 350.0, 0.0, 1.0);
  let col = mix(vec3<f32>(0.95, 0.75, 0.15), vec3<f32>(0.95, 0.2, 0.15), k);
  return vec4<f32>(col, 0.9);
}
`;
