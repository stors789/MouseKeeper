# MouseKeeper 性能审查（当前 HEAD `a7f3f1d`）

审查日期：2026-08-01（Asia/Shanghai）

## 结论摘要

当前实现能构建并通过全部单元测试，在目标规模下，小鼠分页列表、仪表盘和最近记录页仍可打开；但“分页”主要发生在数据全部进入内存之后。最需要优先处理的是 CSV 导入逐行全库扫描，以及笼位页无分页/虚拟化地渲染全部 1,000 张卡片。数据页、完整备份和若干统计也会把 75,000+ 条对象反复物化，浏览器内存余量较小的设备风险明显。

严重级别定义：高＝目标规模下很可能造成秒级以上阻塞、失去响应或导入不可用；中＝目标规模下线性成本明显或有内存峰值风险；低＝目前可接受但增长后会成为瓶颈。

## 实测基线

### 仓库自带检查

- `npm run build`：通过；Vite 生产构建 1.15 s，2,053 modules transformed。
- `npm test -- --reporter=dot`：11 个测试文件、63 个测试全部通过，1.63 s。
- `dist` 总磁盘占用约 1.1 MiB。最大构建文件：基础 `index` JS 342.96 KiB（gzip 110.77 KiB）、`validation` 185.32 KiB（gzip 56.71 KiB）、`runtime` 89.66 KiB（gzip 17.12 KiB）、CSS 76.81 KiB（gzip 14.16 KiB）、`DataPage` 74.76 KiB（gzip 24.29 KiB）。

### 目标规模浏览器烟测

环境：本机 Chromium headless、Vite production preview、单一新浏览器上下文。通过 IndexedDB 直接放入 5,000 mice、1,000 cages、5,000 active cage assignments、50,000 events、20,000 weights；记录的是冷导航到目标文字可见再稳定 100 ms 的墙钟时间。数据是结构上满足页面读取需求的合成数据，不是业务服务写入基准，也不是低端设备结果。

| 页面 | 实测就绪时间 | DOM 元素数 | 说明 |
|---|---:|---:|---|
| `/mice` | 943 ms | 3,050 | UI 只显示 50 条，但查询先读取全部 5,000 条及关联维表 |
| `/cages` | 976 ms | 22,250 | 同时渲染全部 1,000 个笼位卡片 |
| `/dashboard` | 178 ms | 251 | 全量统计后只渲染摘要 |
| `/records` | 924 ms | 1,460 | 记录限制为各 100 条，但仍读取全部 5,000 mice 建 Map |

`performance.memory` 在该 headless 环境中固定返回约 14.3 MB，不能作为可信内存测量，故未把它用于结论。IndexedDB 合成灌库耗时约 87.9 s，但该路径不是产品导入路径，不可用于评价应用写入性能。

### CSV 纯函数合成基准

在 Node 26、`--expose-gc` 下按 `createCsv` 的“先构造 data 对象数组、再 Papa.unparse”路径执行：50,000 条代表性事件为 6.49 MiB CSV，67.5 ms，进程 heap 增量约 51.9 MiB；20,000 条体重为 1.72 MiB，61.6 ms，heap 增量约 19.59 MiB。该结果只量化字符串/对象构造，不含 IndexedDB 全量读取、React inventory、副本下载和真实长备注，因此只能视为下界。

## 发现

### P1 高：CSV 导入每一行都重新扫描三张活动表

- 实际读取：`src/import-export/mouse-import-runner.ts`、`src/features/data/DataPage.tsx`、`src/import-export/mouse-import.ts`。
- 证据：`mouse-import-runner.ts:38-60` 的 `resolveCandidate` 对每个候选行执行 mice/cages/tags 三次 `.filter(...).toArray()` 并重建三个 Map；`mouse-import-runner.ts:160-193` 串行逐行调用；每行还单独开启覆盖 `database.tables` 的事务（`:100-150`）。
- 影响：在 5,000 mice/1,000 cages 下导入 N 行，解析关联的成本近似 `O(N × (M+C+T))`，而不是 `O(M+C+T+N)`。即使 CSV 本身不大，大批导入也会产生大量 IndexedDB 游标遍历和对象分配。
- 复现/验证：准备含 500/1,000 个有效小鼠的 CSV，在已有 5,000 mice/1,000 cages 数据库上记录点击提交到报告完成的时间；DevTools Performance 应显示每行重复的 Dexie 读取。对照实现一次预加载 Map 后重测。
- 建议：在一次导入开始时读取并维护 `mouseByEarTag`、`cageByNumber`、`tagByName`；新建标签时更新共享 Map。按合理批次写入，避免每行使用全部 16 张表的事务；保留行级错误报告与幂等 operationId。
- 残余风险：服务调用本身可能跨表写事件/日志，批处理仍需验证事务大小、回滚语义和跨标签并发。

### P2 高：笼位列表全量读入并渲染 1,000 个卡片

- 实际读取：`src/features/cages/CagesPage.tsx`、`src/db/database.ts`。
- 证据：`CagesPage.tsx:34-60` 全量读取 cages、active assignments 和 mice；`:65-77` 在内存过滤；`:149-210` 对所有结果 `.map()`，没有分页或虚拟化。
- 实测：目标数据下冷导航约 976 ms，产生约 22,250 个 DOM 元素。该数据已接近“一帧不可交互”级别，在低端设备或开启辅助技术时会更差。
- 复现/验证：以上浏览器烟测；在真实 Chrome Performance/Memory 中录制首次进入、搜索输入与滚动，并用 4× CPU throttling 重测。
- 建议：先加入分页（例如 50/100）或窗口化列表；占用量用 assignment 的 cageId 聚合，不必为列表项保留完整 Mouse 对象。搜索可用索引/预计算字段或至少只在筛选后的页构建展示模型。
- 残余风险：虚拟化会改变键盘/读屏体验，需补可访问性回归；仅分页仍会保留全量读取成本。

### P3 中：小鼠“分页”只减少渲染，不减少读取、联接和排序

- 实际读取：`src/features/mice/MicePage.tsx`、`src/db/database.ts`。
- 证据：`MicePage.tsx:185-210` 将 mice/cages/tags/experiments/assignments/savedViews 全部读入；`:211-270` 在内存联接；`:320-358` 每次筛选后对全结果排序；直到 `:360-365` 才切 50 条页面。
- 实测：5,000 mice 下冷导航约 943 ms，DOM 约 3,050。页面在目标规模可用，但每次改变筛选或排序仍是 `O(5,000 log 5,000)` 加字符串规范化。
- 复现/验证：在 5,000 条数据上连续输入搜索词并切换排序，录制主线程 Long Tasks；比较 Dexie 索引游标分页方案。
- 建议：把常见状态、性别、笼位、更新时间排序下推到已有索引；使用游标/主键分页。复杂多字段搜索可保留内存路径，但应延迟、限制候选集或维护专门索引。只为当前页读取/联接关联显示信息。
- 残余风险：多条件任意组合未必都能由单一 IndexedDB 索引覆盖，需要明确查询规划和稳定分页键。

### P4 中：数据页常驻读取 75,000+ 记录，并重复扫描已删除集合

- 实际读取：`src/features/data/DataPage.tsx`。
- 证据：`DataPage.tsx:137-176` 同时 `.toArray()` 读取 mice、cages、assignments、experiments、groups、experimentAssignments、weights、events、tasks、tags，并额外对六张表再做 deleted filter 扫描；`:186-209` 把这些数组长期放在 React live-query 结果中。
- 静态推断：在目标数据下，仅 events+weights 就是 70,000 个结构化克隆；进入“数据与安全”即支付成本，即使用户只看备份说明。任何相关表变更还可能使 `useLiveQuery` 重跑。
- 复现/验证：在目标库打开 `/data`，以 Chrome Allocation instrumentation 比较进入前后 retained size；新增一条 event，观察查询重跑和 Long Task。
- 建议：各 tab 懒加载所需数据；库存数字使用 `.count()`；回收站按 deletedFlag 索引和分页查询；导出操作点击后再读取对应表，并避免同时保留所有大数组。
- 残余风险：Dexie live-query 的具体失效范围需在目标浏览器实测，本审查未获得可信 heap snapshot。

### P5 中：完整备份/恢复存在多份全量对象与字符串的峰值

- 实际读取：`src/backup/backup.ts`、`src/backup/canonical.ts`、`src/backup/validation.ts`、`src/backup/types.ts`、`src/features/data/DataPage.tsx`。
- 证据：`backup.ts:44-100` 一次读入 16 表；`:138-167` canonicalize 做 SHA-256 后，又把完整 canonical JSON 交给 `parseAndValidateBackup`；`validation.ts:101-143` 将输入完整读为 bytes/text，`:1162-1170` 再 `JSON.parse`；`:1238-1275` 校验并再次 canonicalize/hash。恢复还在事务内读取精确 pre-restore 全库（`backup.ts:225-305`）。最大文件允许 100 MiB（`types.ts:22`）。
- 静态推断：100 MiB UTF-8 输入可能同时存在 Uint8Array、UTF-16 JS string、解析对象、规范化字符串和 WebCrypto 输入，峰值远高于文件大小，移动设备可能 OOM 或长时间冻结。
- 复现/验证：生成 25/50/100 MiB 合法备份，在支持 `performance.measureUserAgentSpecificMemory()` 的 Chrome 上分别记录 preview、export、restore 峰值与耗时；当前未实测真实完整备份。
- 建议：降低/按设备调整限制；将昂贵解析/校验/规范化放入 Worker；避免导出后为了自校验而序列化、解析、再序列化整份数据；长期考虑流式导出/哈希。恢复前保留安全副本语义，但明确最低内存/空间要求。
- 残余风险：WebCrypto digest 本身仍需完整 ArrayBuffer；IndexedDB 大事务在不同浏览器上的配额/时限差异未测。

### P6 中：部分 CSV 汇总是嵌套全数组扫描

- 实际读取：`src/features/data/DataPage.tsx`、`src/import-export/csv.ts`、`src/import-export/exporters.ts`。
- 证据：cage export 在 `DataPage.tsx:368-378` 对每个 cage `.filter(assignments)`，复杂度 `O(C×A)`；experiment export 在 `:380-396` 对每个 experiment 分别扫描 groups/assignments。`csv.ts:74-89` 先建立完整 data 对象数组再生成完整字符串。
- 目标规模判断：1,000 cages × 5,000 assignments 已是约 500 万次谓词；当前仍可能可接受，但会与 DataPage 的全量驻留和 CSV 双份内存叠加。50k events 的纯函数下界实测见上。
- 复现/验证：在目标库点击每类导出并录制从点击到下载事件的时间、峰值 heap；本审查没有自动触发下载以避免生成研究数据文件。
- 建议：预先一次性建立 `countByCage`、`groupsByExperiment`、`activeMouseSetByExperiment`；CSV 大表考虑逐块编码/流式下载或至少避免中间 `Object.fromEntries` 数组。
- 残余风险：Blob/下载实现仍会保留最终字符串和 Blob backing store，流式文件 API 的浏览器支持需评估。

### P7 低：仪表盘和完整性扫描为线性全库统计

- 实际读取：`src/queries/dashboard.ts`、`src/db/integrity.ts`、`src/features/settings/SettingsPage.tsx`。
- 证据：dashboard `dashboard.ts:73-117` 全量过滤 mice/cages/assignments/experimentAssignments/breedingPairs/tasks；`:119-265` 内存聚合/排序。完整性扫描 `integrity.ts` 在单事务内读取全部 16 表并逐条 Zod/引用检查。
- 实测：仪表盘目标数据冷导航约 178 ms，当前表现良好；线性设计可接受。完整性扫描未做 75k 规模计时。
- 建议：仪表盘若真实设备出现抖动，再引入增量计数或按索引 `count()`；完整性扫描明确为手动重任务并移到 Worker/提供进度，不应为了优化牺牲一致性检查。
- 残余风险：事件删除比例高时，`orderBy(...).filter(...).limit()` 可能游标跳过大量软删除记录。

### P8 低：代码分割有效，但 PWA 安装会预缓存全部惰性 chunk

- 实际读取：`src/App.tsx`、`vite.config.ts`、`public/sw.js`、生产 `dist` 输出。
- 证据：`App.tsx:10-75` 按页面 lazy import；但 `vite.config.ts` 的 asset manifest 包含整个 bundle，`sw.js:19-31` 安装时 `cache.addAll(manifest.assets)`，所以首次 PWA 安装下载所有路由资源。
- 影响：普通在线首屏仍享受拆包；PWA 首装网络流量/Cache Storage 约为完整 1.1 MiB，而不是当前路由最小集合。现有体积不大，故为低。
- 建议：保留核心 shell 预缓存，其他 route chunk 运行时缓存；建立 bundle budget（例如 base gzip、DataPage/validation chunk、总 precache 大小）。
- 残余风险：减少预缓存会改变“首次离线即可打开任意模块”的产品保证，需要产品取舍。

## 建议实施顺序

1. 将 CSV 导入的关联 Map 提升到批次级，并建立 5k 存量 + 1k 导入的性能测试。
2. 为笼位列表加分页/窗口化；随后把小鼠分页下推至 IndexedDB。
3. 将 DataPage 按 tab/动作懒加载，库存改用 count，回收站分页。
4. 用 25/50/100 MiB 合法备份做浏览器内存测试，再决定 Worker、限制和流式方案。
5. 优化导出聚合与 PWA precache，并设持续 bundle/performance budget。

## 未检查与限制

- 未在 Safari/iOS、Firefox、低端 Windows/Android、真实实验室设备或已接近存储配额的浏览器实测。
- 未获得可信浏览器 heap snapshot；报告中的备份/DataPage 内存风险是由对象生命周期作出的静态推断。
- 未实际提交大型 CSV，也未执行完整 75k 数据备份/恢复，避免长时间修改浏览器状态和产生下载文件；导入结论来自明确调用结构。
- 未运行 Lighthouse、React Profiler 或网络限速；首屏指标仅是本机 headless 冷导航墙钟数据，不等同于用户端 SLO。
- 合成数据字段长度较短；长 notes/custom/snapshot 会放大内存与导出体积。
