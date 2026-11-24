import type {
  Batch,
  Forging,
  HardnessRecord,
  TempReading,
  YardLayout,
} from '../domain/types';
import { autoPack } from '../domain/layout_rules';
import { gaussian, mulberry32, uid } from '../util/rng';

export const SEED_LAYOUT_ID = 'layout-seed-01';
export const SEED_BATCH_ID = 'batch-seed-flange-200';

// 实测场地 60m × 40m，含过道、工位、风机、隔热屏
export function buildSeedLayout(): YardLayout {
  return {
    id: SEED_LAYOUT_ID,
    name: '一号冷却场（实测 60×40m）',
    sizeX: 60000,
    sizeZ: 40000,
    objects: [
      {
        id: 'aisle-01',
        kind: 'aisle',
        name: '主过道（料车通道）',
        pos: { x: 30000, y: 0, z: 6000 },
        length: 58000,
        width: 4000,
      },
      {
        id: 'aisle-02',
        kind: 'aisle',
        name: '横向巡检道',
        pos: { x: 12000, y: 0, z: 24000 },
        length: 3500,
        width: 36000,
      },
      {
        id: 'station-01',
        kind: 'station',
        name: '过道巡检点 A',
        pos: { x: 8000, y: 0, z: 6000 },
        measureH: 1500,
      },
      {
        id: 'station-02',
        kind: 'station',
        name: '过道巡检点 B',
        pos: { x: 30000, y: 0, z: 6000 },
        measureH: 1500,
      },
      {
        id: 'station-03',
        kind: 'station',
        name: '工位 C（翻面作业）',
        pos: { x: 48000, y: 0, z: 14000 },
        measureH: 1500,
      },
      {
        id: 'station-04',
        kind: 'station',
        name: '工位 D（质检）',
        pos: { x: 12000, y: 0, z: 32000 },
        measureH: 1500,
      },
      {
        id: 'fan-01',
        kind: 'fan',
        pos: { x: 56000, y: 0, z: 14000 },
        yawDeg: 270,
        speed: 9,
        coneDeg: 50,
        range: 14000,
      },
      {
        id: 'fan-02',
        kind: 'fan',
        pos: { x: 56000, y: 0, z: 26000 },
        yawDeg: 270,
        speed: 8,
        coneDeg: 50,
        range: 12000,
      },
      {
        id: 'fan-03',
        kind: 'fan',
        pos: { x: 4000, y: 0, z: 36000 },
        yawDeg: 0,
        speed: 7,
        coneDeg: 55,
        range: 12000,
      },
      {
        id: 'shield-01',
        kind: 'shield',
        matId: 'refractory-fiber',
        pos: { x: 20000, y: 0, z: 8800 },
        yawDeg: 90,
        length: 12000,
        height: 2600,
        thickness: 120,
      },
      {
        id: 'shield-02',
        kind: 'shield',
        matId: 'oxidized-steel',
        pos: { x: 42000, y: 0, z: 8800 },
        yawDeg: 90,
        length: 10000,
        height: 2400,
        thickness: 80,
      },
    ],
  };
}

export function buildSeedBatchAndForgings(layout: YardLayout): { batch: Batch; forgings: Forging[] } {
  const rng = mulberry32(20261124);
  const batch: Batch = {
    id: SEED_BATCH_ID,
    name: '风电法兰 WF-200 批次',
    steelId: '42crmo4',
    shape: {
      kind: 'flange',
      outerD: 1800,
      innerD: 700,
      height: 320,
      hubD: 950,
      hubH: 140,
    },
    dischargeTemp: 860,
    dischargeTime: 0,
    count: 200,
    createdAt: Date.now(),
    note: '程序生成的演示批次：200 件风电法兰，出炉 860℃，42CrMo4',
  };

  const pack = autoPack(layout, batch.shape, batch.count, { gapMm: 500, startId: 1 });
  const forgings: Forging[] = pack.positions.map((pos, i) => ({
    id: uid('fg', i + 1),
    batchId: batch.id,
    shape: { ...batch.shape },
    steelId: batch.steelId,
    pos,
    dischargeTemp: batch.dischargeTemp + Math.round(gaussian(rng, 0, 6)),
    dischargeTime: batch.dischargeTime + i * 12,
    pinned: false,
    status: 'cooling',
  }));
  return { batch, forgings };
}

// 带测量偏差的红外枪测温记录：真值来自解析冷却趋势 + 高斯偏差
export function buildSeedReadings(forgings: Forging[]): TempReading[] {
  const rng = mulberry32(7701);
  const sampleTimes = [1800, 3600, 7200, 10800];
  const picked = forgings.filter((_, i) => i % 20 === 0).slice(0, 10);
  const readings: TempReading[] = [];
  let n = 1;
  for (const f of picked) {
    for (const t of sampleTimes) {
      // 粗解析趋势：860℃ 指数衰减，时间常数约 4.2h
      const truth = 35 + (f.dischargeTemp - 35) * Math.exp(-t / (4.2 * 3600));
      const measured = truth + gaussian(rng, 0, Math.max(4, truth * 0.018));
      readings.push({
        id: uid('rd', n++),
        batchId: f.batchId,
        forgingId: f.id,
        t,
        tempC: Math.round(measured * 10) / 10,
        pos: { ...f.pos, y: f.shape.height / 2 },
        source: rng() > 0.25 ? 'ir-gun' : 'thermocouple',
      });
    }
  }
  return readings;
}

// 硬度记录：中间圈码放过密的件硬度偏低，复刻现场事故
export function buildSeedHardness(forgings: Forging[]): HardnessRecord[] {
  const rng = mulberry32(991);
  const out: HardnessRecord[] = [];
  let n = 1;
  forgings.forEach((f, i) => {
    if (i % 9 !== 4) return;
    const central = f.pos.x > 18000 && f.pos.x < 42000 && f.pos.z > 12000 && f.pos.z < 30000;
    const hbw = central
      ? Math.round(gaussian(rng, 222, 7))
      : Math.round(gaussian(rng, 268, 9));
    out.push({
      id: uid('hd', n++),
      batchId: f.batchId,
      forgingId: f.id,
      t: 12 * 3600,
      hbw,
      position: central ? 'mid-ring' : 'surface',
    });
  });
  return out;
}
