import type { Forging, ShapeParams, Vec3, YardLayout } from './types';
import { footprintRadiusMm } from './geometry';

// 码放规则：矩形网格阵列 + 安全间距，自动避开隔热屏/工位/过道
export interface PackOptions {
  // 相邻件净间隙 mm
  gapMm: number;
  startId: number;
}

export interface PackResult {
  positions: Vec3[];
  placed: number;
  skipped: number;
}

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function objectFootprint(o: YardLayout['objects'][number]): Rect | null {
  if (o.kind === 'aisle') {
    return {
      minX: o.pos.x - o.length / 2,
      maxX: o.pos.x + o.length / 2,
      minZ: o.pos.z - o.width / 2,
      maxZ: o.pos.z + o.width / 2,
    };
  }
  if (o.kind === 'station') {
    const r = 900;
    return { minX: o.pos.x - r, maxX: o.pos.x + r, minZ: o.pos.z - r, maxZ: o.pos.z + r };
  }
  if (o.kind === 'shield') {
    const c = Math.cos((o.yawDeg * Math.PI) / 180);
    const s = Math.sin((o.yawDeg * Math.PI) / 180);
    const hx = (o.length / 2) * Math.abs(c) + (o.thickness / 2) * Math.abs(s);
    const hz = (o.length / 2) * Math.abs(s) + (o.thickness / 2) * Math.abs(c);
    return { minX: o.pos.x - hx, maxX: o.pos.x + hx, minZ: o.pos.z - hz, maxZ: o.pos.z + hz };
  }
  // 风机占地小，留检修半径
  if (o.kind === 'fan') {
    const r = 700;
    return { minX: o.pos.x - r, maxX: o.pos.x + r, minZ: o.pos.z - r, maxZ: o.pos.z + r };
  }
  return null;
}

function hitsRect(x: number, z: number, radius: number, rects: Rect[], margin: number): boolean {
  for (const r of rects) {
    if (
      x + radius + margin > r.minX &&
      x - radius - margin < r.maxX &&
      z + radius + margin > r.minZ &&
      z - radius - margin < r.maxZ
    ) {
      return true;
    }
  }
  return false;
}

// 蛇形排布，行距与列距按外接圆 + gap
export function autoPack(
  layout: YardLayout,
  shape: ShapeParams,
  count: number,
  opts: PackOptions,
  pinned: Forging[] = [],
): PackResult {
  const radius = footprintRadiusMm(shape);
  const pitch = radius * 2 + opts.gapMm;
  const rects = layout.objects.map(objectFootprint).filter((r): r is Rect => r !== null);
  const margin = 600; // 距屏/过道安全余量
  const edge = 800;

  const cols = Math.max(1, Math.floor((layout.sizeX - edge * 2) / pitch));
  const rows = Math.max(1, Math.floor((layout.sizeZ - edge * 2) / pitch));
  const positions: Vec3[] = [];
  let skipped = 0;

  const occupied = pinned.map((f) => ({ x: f.pos.x, z: f.pos.z, r: footprintRadiusMm(f.shape) }));

  for (let i = 0; i < cols * rows && positions.length < count; i++) {
    const row = Math.floor(i / cols);
    const col = row % 2 === 0 ? i % cols : cols - 1 - (i % cols);
    const x = edge + radius + col * pitch;
    const z = edge + radius + row * pitch;

    if (hitsRect(x, z, radius, rects, margin)) {
      skipped++;
      continue;
    }
    const clash = occupied.some(
      (o) => Math.hypot(o.x - x, o.z - z) < o.r + radius + opts.gapMm / 2,
    );
    if (clash) {
      skipped++;
      continue;
    }
    positions.push({ x, y: 0, z });
    occupied.push({ x, z, r: radius });
  }

  return { positions, placed: positions.length, skipped };
}
