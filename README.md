# 冷却场布置与热辐射仿真系统

面向风电法兰/齿圈锻造后空冷工序的网页版布置与热辐射仿真。TypeScript + 原生 WebGPU，零运行时第三方依赖，场地、批次、测温、工艺记录全部存 IndexedDB。

## 启动

```bash
npm install
npm run dev        # 开发，Chrome/Edge 113+ 打开 http://127.0.0.1:5173
npm run build      # 类型检查 + 生产构建
npm run preview
```

首次打开自动生成种子数据：60×40m 实测场地（隔热屏/风机/过道/工位）、200 件风电法兰批次、带偏差的红外测温记录、中间圈偏低的硬度记录。

## 五个页面

| 页面 | 能力 |
| --- | --- |
| 场地布局 | 实测尺寸、地坪/隔热屏/风机/过道/工位摆放，隔热屏换材质/调高度即时重算遮挡 |
| 锻件批次 | 法兰/齿圈/轴类参数化截面，出炉温度/钢种/时间录入，蛇形自动码放，Shift+拖拽手动移位，300 件压力批次入口 |
| 冷却推演 | 双节点辐射+对流 RK4，视因子互烤含隔热屏遮挡，时间轴拖动/倍速，单件心表温度曲线，CCT 判定描边，整改建议，红外实测叠加 |
| 人员暴露 | 测点辐射热通量、累计超限时长，地面 Marching Squares 等值线随隔热屏联动 |
| 工艺记录 | 摆放方案+推演+硬度归档，同钢种同截面历史冷速对比 |

顶部工具栏切换：可见光 / 热像伪彩 / 分屏同步（scissor 双跑，相机同步）/ 夜班视角。

## 渲染架构（WebGPU）

```
实例化圆柱几何（1 次 drawIndexed，环境件+锻件共用）
  → G-Buffer MRT：世界坐标 / 法线+ID / 黑体自发光 / 不合格标记 / 深度
  → 计算着色器分簇：32px 瓦片 × 8 深度层，逆投影求世界 AABB，球-AABB 光源剔除
  → 延迟光照：单 pass，每像素只遍历所属簇的光源（非一件一 pass）
  → 后处理：bloom + 不合格件 Sobel 描边 + ACES tonemap
```

锻件即光源：表面温度驱动黑体色温（橙黄→暗红→熄灭），每件一个带范围的点光源，由分簇系统裁剪。

## 物理模型

- 双节点（心部/表面）集总参数，能量守恒：内部导热 `kA/L`，表面斯蒂芬-玻尔兹曼辐射 + 自然/强制对流
- 件间互烤：有限高圆柱侧面视因子（近场 1/d、远场退化点-圆柱解），隔热屏按吸收率与几何遮挡衰减
- 风机：锥形风场 + Jürges 强制对流系数
- 积分：经典 RK4，默认 60s 步长，采样插值驱动时间轴
- 人员通量：点-圆柱视因子，175 W/m² 预警、350 W/m² 超限

## 验收核验（可复跑）

```bash
# 物理：手算对照 + 200 件整批 + 通量/等值线/单调性
npx esbuild scripts/selftest.ts --bundle --platform=node --format=esm --outfile=scripts/.tmp/selftest.mjs
node scripts/.tmp/selftest.mjs

# 300 件物理压力
npx esbuild scripts/stress_300.ts --bundle --platform=node --format=esm --outfile=scripts/.tmp/stress.mjs
node scripts/.tmp/stress.mjs

# WGSL 真编译 + 300 件 1080p 真实墙钟帧率（需本机 Chrome，见 scripts/run_gpu_check.ps1）
powershell -File scripts/run_gpu_check.ps1 wgsl
powershell -File scripts/run_gpu_check.ps1 smoke
```

界面内「冷却推演 → 跑手算对照」生成独立代码路径的验收报告。

### 本机实测结果（2026-11-24，Chrome 158）

| 验收项 | 口径 | 实测 | 结论 |
| --- | --- | --- | --- |
| 300 件 1080p 帧率 | 312 实例、每帧 `onSubmittedWorkDone` 墙钟 | **300+ FPS** | ≥45 通过 |
| 冷却曲线误差 | 3 件孤立件，独立手算 RK4(5s) 对照，相对温升归一 | 表面 **0.003%**、心部 0.002% | ≤3% 通过 |
| 200 件整批仿真 | RK4 12h 含互烤/遮挡/风场/暴露网格 | 2.2 s | 可用 |
| 300 件整批仿真 | 密排 350mm | 2.9 s，198 件冷速不达标 | 复现密排事故 |
| WGSL 编译 | 5 个 shader 在 Dawn 全量编译 | 0 error | 通过 |

手算模块 `src/sim/validation.ts` 与引擎零代码共享，仅复用几何体积公式，物理常数与 RK4 独立实现，保证是第二条独立验证路径。

## 目录

```
src/domain  类型/钢种CCT/几何/码放规则
src/sim     物理、RK4、视因子遮挡、风场、CCT、暴露、等值线、手算对照
src/gpu     WebGPU 设备/网格/WGSL/集群延迟渲染器/相机拾取
src/db      IndexedDB 仓储 + 确定性种子数据
src/ui      五页面、视口、图表、状态
scripts     Node 自测与浏览器 GPU 核验
```
