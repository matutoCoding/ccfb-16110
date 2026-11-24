// 2D 折线图：冷却曲线、冷速对比
export interface ChartSeries {
  name: string;
  color: string;
  points: Array<[number, number]>;
  dashed?: boolean;
}

export function lineChart(
  container: HTMLElement,
  series: ChartSeries[],
  opts: { xLabel?: string; yLabel?: string; height?: number } = {},
): void {
  container.innerHTML = '';
  const w = Math.max(320, container.clientWidth || 480);
  const hgt = opts.height || 220;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 36;
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = hgt * 2;
  canvas.style.height = `${hgt}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(2, 2);

  const allX = series.flatMap((s) => s.points.map((p) => p[0]));
  const allY = series.flatMap((s) => s.points.map((p) => p[1]));
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const yMin = Math.min(...allY);
  const yMax = Math.max(...allY);
  const sx = (x: number) => padL + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * (w - padL - padR);
  const sy = (y: number) => padT + (1 - (y - yMin) / Math.max(1e-9, yMax - yMin)) * (hgt - padT - padB);

  // 网格 + 刻度
  ctx.strokeStyle = '#1d293d';
  ctx.fillStyle = '#75849c';
  ctx.font = '12px Consolas, monospace';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (i / 4) * (hgt - padT - padB);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    const val = yMax - (i / 4) * (yMax - yMin);
    ctx.fillText(val.toFixed(0), 8, y + 4);
  }
  for (let i = 0; i <= 5; i++) {
    const x = padL + (i / 5) * (w - padL - padR);
    const val = xMin + (i / 5) * (xMax - xMin);
    ctx.fillText(opts.xLabel ? `${(val / 3600).toFixed(1)}h` : val.toFixed(0), x - 12, hgt - 12);
  }

  // 序列
  series.forEach((s) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const x = sx(p[0]);
      const y = sy(p[1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // 图例
  let lx = padL;
  ctx.font = '13px Segoe UI';
  series.forEach((s) => {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 4, 10, 10);
    ctx.fillStyle = '#aab7ca';
    ctx.fillText(s.name, lx + 14, 13);
    lx += ctx.measureText(s.name).width + 34;
  });

  if (opts.yLabel) {
    ctx.save();
    ctx.fillStyle = '#75849c';
    ctx.translate(14, hgt / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel, -30, 0);
    ctx.restore();
  }
  container.append(canvas);
}
