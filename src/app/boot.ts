import { repo } from '../db/idb';
import {
  buildSeedBatchAndForgings,
  buildSeedHardness,
  buildSeedLayout,
  buildSeedReadings,
} from '../db/seed';
import type { Batch, Forging, HardnessRecord, TempReading, YardLayout } from '../domain/types';

export interface BootData {
  layout: YardLayout;
  batches: Batch[];
  forgings: Forging[];
  readings: TempReading[];
  hardness: HardnessRecord[];
}

// 首次启动注入种子数据；已存在则读库
export async function bootData(onProgress: (pct: number, msg: string) => void): Promise<BootData> {
  onProgress(10, '打开 IndexedDB…');
  const layouts = await repo.all<YardLayout>('layouts');
  if (layouts.length) {
    onProgress(70, '读取已保存数据…');
    const [batches, forgings, readings, hardness] = await Promise.all([
      repo.all<Batch>('batches'),
      repo.all<Forging>('forgings'),
      repo.all<TempReading>('readings'),
      repo.all<HardnessRecord>('hardness'),
    ]);
    onProgress(100, '完成');
    return { layout: layouts[0], batches, forgings, readings, hardness };
  }

  onProgress(25, '生成实测场地（60×40m，含屏/风机/过道/测点）…');
  const layout = buildSeedLayout();
  await repo.put('layouts', layout);

  onProgress(45, '生成 200 件风电法兰批次并自动码放…');
  const { batch, forgings } = buildSeedBatchAndForgings(layout);
  await repo.put('batches', batch);
  await repo.putAll('forgings', forgings);

  onProgress(70, '生成带偏差的红外测温记录…');
  const readings = buildSeedReadings(forgings);
  await repo.putAll('readings', readings);

  onProgress(85, '生成实测硬度记录（中间圈偏低）…');
  const hardness = buildSeedHardness(forgings);
  await repo.putAll('hardness', hardness);

  onProgress(100, '种子数据就绪');
  return { layout, batches: [batch], forgings, readings, hardness };
}
