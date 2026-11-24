// 参数化旋转体网格：单位圆柱（半径1、半高1），实例矩阵负责缩放
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export function makeCylinderMesh(segments = 28): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // 侧面
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    positions.push(x, -1, z, x, 1, z);
    normals.push(x, 0, z, x, 0, z);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }

  // 顶盖 / 底盖
  const topCenter = positions.length / 3;
  positions.push(0, 1, 0);
  normals.push(0, 1, 0);
  const topStart = positions.length / 3;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(a), 1, Math.sin(a));
    normals.push(0, 1, 0);
  }
  for (let i = 0; i < segments; i++) indices.push(topCenter, topStart + i, topStart + i + 1);

  const botCenter = positions.length / 3;
  positions.push(0, -1, 0);
  normals.push(0, -1, 0);
  const botStart = positions.length / 3;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(a), -1, Math.sin(a));
    normals.push(0, -1, 0);
  }
  for (let i = 0; i < segments; i++) indices.push(botCenter, botStart + i + 1, botStart + i);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

// 地面/屏板/风机架用扁盒
export function makeBoxMesh(): MeshData {
  const p = [
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ];
  const n = [
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  ];
  const idx = [
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
    0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
  ];
  return { positions: new Float32Array(p), normals: new Float32Array(n), indices: new Uint32Array(idx) };
}

// 圆锥（风机风筒/风锥示意）
export function makeConeMesh(segments = 20): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    positions.push(x, -1, z, 0, 1, 0);
    normals.push(x, 0.5, z, 0, 1, 0);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    indices.push(b, b + 2, b + 1);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}
