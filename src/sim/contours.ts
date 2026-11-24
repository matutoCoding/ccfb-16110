// Marching Squares：把通量网格画成地面等值线段
export interface ContourLine {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface ContourLevel {
  level: number;
  lines: ContourLine[];
}

export function marchingSquares(
  grid: Float32Array,
  nx: number,
  nz: number,
  sizeX: number,
  sizeZ: number,
  levels: number[],
): ContourLevel[] {
  const cellW = sizeX / nx;
  const cellH = sizeZ / nz;
  const val = (i: number, j: number) => grid[j * nx + i];
  const interp = (a: number, b: number, lv: number) => (lv - a) / Math.max(1e-9, b - a);

  return levels.map((level) => {
    const lines: ContourLine[] = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const tl = val(i, j);
        const tr = val(i + 1, j);
        const br = val(i + 1, j + 1);
        const bl = val(i, j + 1);
        let idx = 0;
        if (tl > level) idx |= 8;
        if (tr > level) idx |= 4;
        if (br > level) idx |= 2;
        if (bl > level) idx |= 1;
        if (idx === 0 || idx === 15) continue;

        const x0 = i * cellW;
        const x1 = (i + 1) * cellW;
        const z0 = j * cellH;
        const z1 = (j + 1) * cellH;
        // 四条边交点：上、右、下、左
        const pts: Array<[number, number]> = [
          [x0 + cellW * interp(tl, tr, level), z0],
          [x1, z0 + cellH * interp(tr, br, level)],
          [x0 + cellW * interp(bl, br, level), z1],
          [x0, z0 + cellH * interp(tl, bl, level)],
        ];
        const edge: Record<number, Array<[number, number]>> = {
          1: [pts[3], pts[2]],
          2: [pts[2], pts[1]],
          3: [pts[3], pts[1]],
          4: [pts[0], pts[1]],
          5: [pts[3], pts[0], pts[1], pts[2]],
          6: [pts[0], pts[2]],
          7: [pts[3], pts[0]],
          8: [pts[0], pts[3]],
          9: [pts[0], pts[2]],
          10: [pts[0], pts[1], pts[2], pts[3]],
          11: [pts[0], pts[1]],
          12: [pts[3], pts[1]],
          13: [pts[2], pts[1]],
          14: [pts[3], pts[2]],
        };
        const segs = edge[idx];
        for (let k = 0; k < segs.length; k += 2) {
          lines.push({ x1: segs[k][0], z1: segs[k][1], x2: segs[k + 1][0], z2: segs[k + 1][1] });
        }
      }
    }
    return { level, lines };
  });
}
