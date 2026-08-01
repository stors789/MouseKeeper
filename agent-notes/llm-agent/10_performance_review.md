# LLM Agent 性能独立审查

审查日期：2026-08-01  
审查范围：`src/agent/**`、`src/application/capabilities/**`、`src/features/agent/AgentPage.tsx`、Provider 设置、构建产物与 PWA 缓存。只做只读构建、测试和临时 `/tmp` 基准，没有修改产品源码。

## 结论

当前实现对小型、桌面端、单标签页数据集是可接受的：Agent 自身按路由懒加载，模型只看到 2 个分层工具而非 66 个完整函数定义，初次只渲染 30 条历史，写工具严格串行，SSE 未消费缓冲区也有 2 MiB 上限。

但在合并/发布前有两类必须修复的问题：

1. **恢复点不是一致性快照**。16 个 `toArray()` 由 `Promise.all` 发起，但不处在同一个 Dexie 只读事务中；同时业务写入也不与“前/后快照”构成同一原子边界。另一个标签页或 UI 操作可在快照期间穿插，使差分不再可靠。这是撤回正确性问题，列为 P0。
2. **每条命令无条件保留全库快照并产生大额读写放大**。`begin()` 在第一次模型网络请求之前读取全部 16 表，把完整 `fullBefore` 写入 Agent DB，并把同一完整对象保留在内存直至所有模型轮次结束；`finish()` 又读取全部 16 表。即使纯查询/导航也如此。达到 512 KiB 阈值后，最终记录仍同时保存 `changes` 和 `fullBefore`，阈值没有降低存储量。无历史保留/配额策略，长期使用会持续增长。这些列为 P1，属于大数据、移动端上线前必须修复。

## 实际证据

### 构建与静态体积

运行：

```text
npm run build
```

结果：构建成功，Vite 处理 2,081 个模块，构建阶段 1.39 s；`dist` 总计约 1.3 MiB。关键产物：

| 产物 | minified | gzip | 判断 |
|---|---:|---:|---|
| 主入口 `index-*.js` | 744.91 KiB | 221.22 KiB | 已触发 Vite 500 KiB 警告；主要是全应用基线负担，不全由 Agent 引入 |
| `AgentPage-*.js` | 11.80 KiB | 4.98 KiB | 可接受，路由懒加载 |
| Agent/runtime 共享 chunk | 38.41 KiB | 13.23 KiB | 可接受 |
| `SettingsPage-*.js` | 22.67 KiB | 7.51 KiB | 可接受 |
| 全局 CSS | 87.97 KiB | 15.86 KiB | 可接受但继续增长需监控 |

`App.tsx` 使用 `lazy(import('./features/agent/AgentPage'))`，所以未进入 Agent 页面时不会下载其页面 chunk。PWA 安装会根据 `asset-manifest.json` 预缓存全部构建资产，因此安装时仍会下载约 1.3 MiB；好处是 Agent UI 离线可打开，代价是首次安装网络与缓存开销包含所有懒加载页面。

### 恢复快照基准

基准通过临时 `/tmp` TypeScript 入口、项目内 `esbuild`、`fake-indexeddb`、真实 `MouseKeeperDatabase`、`snapshotBusinessData` 和 `diffBusinessData` 运行。每个表放入相同数量、约 160 字节 payload 的合成行；快照预热两次后取 5 次样本中位数。环境是本机 Node 26 + fake-indexeddb，**不能替代 Safari/移动端 IndexedDB 实测**，只能说明复杂度和桌面量级。

```text
./node_modules/.bin/esbuild /tmp/llm-agent-performance-bench.ts --bundle --platform=node --format=esm --outfile=/tmp/llm-agent-performance-bench.mjs
node /tmp/llm-agent-performance-bench.mjs
```

| 每表行数 | 16 表总行数 | 快照 JSON 大小 | 单次快照中位数 | 相同快照差分 |
|---:|---:|---:|---:|---:|
| 0 | 0 | 269 B | 0.24 ms | 0.10 ms |
| 100 | 1,600 | 377,293 B | 1.68 ms | 4.12 ms |
| 1,000 | 16,000 | 3,786,493 B | 13.88 ms | 43.19 ms |

因此 16,000 行的一条命令仅“前快照 + 后快照 + 无变化差分”在该理想基准中约为 **70.9 ms**，还没有计入：浏览器结构化克隆、完整快照写入 IndexedDB、最终命令记录写入、GC、业务工具本身和模型网络等待。对象堆占用也会高于 3.79 MB JSON 字节数。算法复杂度是 O(全库行数)，而不是 O(本次写集)。真实低性能手机、Safari 和接近存储配额时会明显更慢。

代码证据：

- `RecoveryManager.begin()` 总是 `snapshotBusinessData()`，随后把 `structuredClone(token.before)` 作为 `fullBefore` 写入 `commandRuns`。
- `RecoveryManager.finish()` 再次执行全库快照，然后对每行调用规范化 JSON 比较。
- `snapshotBusinessData()` 对 `BACKUP_TABLE_NAMES` 的全部 16 表执行 `toArray()`。
- `FULL_BACKUP_ROW_THRESHOLD = 25`、4 表阈值、512 KiB 差分阈值只决定是否额外保留 `fullBefore`；`changes` 从不被清空。
- `commandRuns` 没有过期、条数上限、总字节上限或清理入口。

### 工具定义与 prompt token

用真实 `createApplicationCapabilityRegistry()` 生成静态指标：

| 指标 | 实测 |
|---|---:|
| LLM 暴露能力 | 66 |
| 每轮发送的工具定义 | 2 |
| 两个工具的 JSON | 840 B |
| 典型 `/mice` 系统提示字符数 | 1,053 字符 |
| 系统提示内起始能力 | 8 |

这是当前架构的优点。完整 66 项 schema 不会每轮都进入 tools；模型通过 `search_capabilities` 按需发现。默认搜索返回上限 20，工具 schema 上限 50，工具输出又在 48,000 字符处截断，能控制大部分 prompt 膨胀。

仍有两点需要约束：

- `search_capabilities` 返回完整 descriptor（包括 schema、reads/writes）；50 项在复杂 schema 下可能接近 48 KB，且进入会话历史后被下一轮再次发送。
- `historyLimit` 按“消息条数”而非 token/字符预算裁剪；单条工具输出可约 48 KB，20 条默认历史在极端情况下可接近 1 MB 文本。Responses 的 `previous_response_id` 与完整本地 messages 同时发送时，也应确认目标 Provider 是否会重复计入上下文。

### 历史、SSE 与执行并发

当前可接受：

- `trimCompleteTurns()` 不会从工具调用中间截断，避免无效 Chat 历史。
- session 最终仅保留 `historyLimit` 条消息，默认 20；最近实体限制 30。
- SSE 的尚未分帧 `buffer` 超过 2 MiB 会失败，断流不会把部分结果冒充成功。
- 工具执行通过 `for ... of` 严格串行，符合写操作和复合依赖的正确性要求。即使模型返回 parallel tool calls，应用也不会并行写 Dexie。
- Provider 有 AbortSignal、超时、指数退避，并在停止后释放事件监听器。

风险：

- SSE 的累计 `text`、每个工具的累计 `arguments`、调用 Map 和非流式 `response.json()` 没有总响应上限；2 MiB 只保护当前未分帧 buffer。长流仍可线性占用内存。
- 每轮工具调用数量和整条命令工具总数没有上限。`maxToolRounds` 默认 12 只限制轮次；单轮可返回很多调用，全部串行执行，造成长任务、巨量 trace 和恢复记录。
- AgentPage 载入时限制 30 条，但当前页面每次完成后只 prepend、不裁剪；长时间不刷新会无限增加 `runs` 与 DOM。IndexedDB 历史本身也无限增长。
- 初始历史记录不含完整 `AgentRunResult`，所以刷新后只展示命令记录，不会重建 affected/file artifacts。这不直接拖慢性能，但使“历史轻量化”和“功能完整性”之间的契约需要明确。

### 查询与批量操作

`query.entities` 的返回上限是 500，但实现先 `table.toArray()`，再在主线程执行软删除过滤、任意字段过滤、`JSON.stringify` 全文搜索和全量排序，最后才 `slice(0, limit)`。所以 limit 只限制输出/prompt，不限制 IndexedDB 读取、内存和 CPU。`data.csv.import` 也会先读取全部 mice 构建 ID/耳标集合，这是合理的导入预检，但对超大群体需要进度/分块。

列表上限本身是好的防护：registry 列表最多 250；模型搜索工具最多 50；实体结果最多 500；recent history 最多 200、页面使用 30。然而这些上限没有覆盖底层全量扫描。

大批量写会触发至少三份相关数据：内存中的 `token.before`、`changes`（每项又克隆 before/after）、以及达到阈值后的 `fullBefore`。恢复记录在写入前还执行 `JSON.stringify(changes)` 计算 512 KiB 阈值，额外分配整段字符串。25 行阈值很低，因此中等批量即持久化全库快照，同时仍持久化完整逐行差分。

### 设置更新

Provider 名称、URL、模型、数值等输入每次键击都会：clone 当前 document、映射 profile/preset、再 clone、`JSON.stringify` 全 document、同步写 localStorage、通知订阅者并重渲染。默认只有少量 profile/preset 时可接受；配置可无限复制，长 system prompt/参数或很多配置时会造成输入卡顿。自定义请求头和 providerParameters 已采用显式“保存”，这部分做法较好。

### PWA、离线与移动端

- service worker 安装阶段缓存 app shell 和 asset manifest 中的全部 chunk，Agent 页面可以离线打开，历史/撤回仍可使用本地 IndexedDB。
- 外部 Provider 请求不是同源静态请求，不会被 service worker 缓存，这是正确的隐私与一致性选择；离线时 Agent 模型执行必然失败。
- 当前没有在发起 Provider 请求前识别 `navigator.onLine`，离线可能仍经历配置的重试/退避后才给出失败。
- CSS 在 1,023 px 切单列，在 767 px 折叠 header/footer/button，移动布局基本合格；`min-width: 0` 也避免多数溢出。
- 移动端主要风险不在 CSS，而是命令期间长期持有全库对象、同步 localStorage 更新、无历史配额和主线程全表过滤。iOS PWA 的存储回收/内存压力应作为发布门槛实测。

## P0-P3 建议

### P0 — 必须修复：使恢复边界一致且可证明

1. 不要用 16 个彼此独立的 `toArray()` 冒充一致快照。至少把全表读取放在一个 Dexie `r` transaction 中；更理想的是让 registry/service 在同一个命令事务或写集 journal 中记录 before/after。
2. 明确定义跨标签页并发。可用 Web Locks/租约锁串行化 Agent 写命令，并在 undo 前继续保留 revision 冲突检查。UI 写与 Agent 写若不能共用锁，恢复点仍可能在边界间被污染。
3. 添加并发回归测试：快照读取期间插入 UI 写、两个 Agent command 并发、另一个标签页写、undo 前后写，验证不会恢复到混合状态。

### P1 — 发布前必须修复

1. **延迟恢复捕获**：纯查询/导航不应读写全库。建议先创建轻量 `running` record，只在第一次 `modifiesData` 工具执行前捕获恢复信息；最佳方案是由 capability/service 记录实际写集，复杂恢复/永久删除才用完整备份。
2. **修正 512 KiB/25 行策略**：选择 full backup 后不要再持久化完整 `changes` before/after；只保留用于冲突检测的行 id + after revision/digest。反之 row-diff 不应保留 full snapshot。计算大小应增量估算，避免 `JSON.stringify(changes)` 的峰值分配。
3. **历史保留与配额**：提供最大条数、最大总字节、最大年龄和“清理 Agent 历史”入口；监测 `navigator.storage.estimate()`。先保留最近可撤回记录，再清理无变化/失败/已撤回的旧记录。
4. **响应资源上限**：对累计 SSE text、累计 tool args、非流式响应 body、单轮 tool call 数和每命令总 tool call 数设硬上限；超限失败并完成 recovery finish。建议同时限制工具结果进入历史的字符数/token 预算。
5. **底层查询分页/索引化**：常用 `query.entities` 过滤和排序走 Dexie index/cursor，至少在 limit + scanBudget 达到后停止；全文搜索另设明确扫描预算。不要先 `toArray()` 全表再应用 limit。

### P2 — 应在稳定版前完成

1. AgentPage 每次 prepend 后裁剪到 30～50 条，或使用分页/虚拟列表；技术详情按需序列化，避免大量 `<pre>` 同时存在。
2. 历史裁剪改为“完整轮次 + 近似 token/字符预算”双限，而不仅是消息条数；大型工具结果只保留摘要、ID 和分页游标。
3. 设置文本输入改成局部 draft，在 blur/保存时写 store，或 150～300 ms debounce；限制 profile/preset 数和 system prompt/provider params 尺寸。
4. parallel tool calls 维持“写串行”；可以仅对明确 `read-only/view-only` 且无依赖的调用做有界并发（例如 2～4），但先由 orchestrator 建立依赖/风险分类，不能直接 `Promise.all` 所有调用。
5. 在线状态明确展示；离线时立即阻止模型网络请求，但保留本地撤回/历史/设置功能。
6. 拆分 744.91 KiB 主入口，特别检查 Radix、通用业务 service 和数据库模块是否过早进入主 chunk；设 gzip bundle budget 防回退。

### P3 — 可观察性与持续优化

1. 在本地记录脱敏指标：snapshot 前后耗时、总行数、变化数、recovery record 估算字节、模型轮次、工具数、请求/首字节/完成耗时、SSE 最大累计字节；不要记录 API Key 或完整 prompt。
2. 为 1k/10k/100k 行建立浏览器基准，至少覆盖 Chromium、Safari/iOS、低端 Android；分别测查询、1 行写、100 行批量、完整恢复和 undo。
3. 对 PWA install 缓存体积、冷启动、Agent 路由首次打开、长历史滚动建立性能预算。

## 200+ eval 性能评估

审查时 `src/agent/evals/cases.ts` 已声明 **288** 个 case（106 capability mirror、48 language、30 context、36 workflow、24 safety、12 file、16 failure、16 protocol）。清单 JSON 为 **144,114 B**，序列化约 **0.40 ms**，所以 case 清单本身不是瓶颈。

但当时目录中还没有 `*.test.ts` runner，因而 **288 case 的端到端时长无法实测，也不能宣称已执行**。现有 `src/agent` 测试运行命令与结果：

```text
/usr/bin/time -p npx vitest run src/agent
4 files passed, 63 tests passed
Vitest duration 972 ms; tests 399 ms; wall time 1.32 s
```

对未来 runner 的性能要求：

- 200+ 路由/协议 case 使用纯内存 deterministic transcript，不应每例创建并快照 16 表。
- 只保留一组代表性端到端数据/恢复 case；每例使用唯一 DB 并在结束删除，或单 worker 顺序复用可重置 fixture。
- 若 288 case 全部经过当前 `RecoveryManager.run`，即使理想空库也会产生至少 576 次全表快照和 288 次临时完整快照写入，测试测到的主要会是基建开销而非能力选择。
- 分组报告 transform/import、routing、provider parse、Dexie integration 的独立耗时；CI 设置总时长预算（建议 deterministic 全集目标 < 15 s，本机基线）和慢例 top list。
- 禁止默认 eval 访问真实 Provider；真实模型评测单列为可选、不可重复的网络任务。

## 当前可接受项

- 两层工具设计：66 个能力仅通过 2 个稳定工具发现/执行，840 B 工具定义很节制。
- 典型系统提示约 1,053 字符，起始能力仅 8 个。
- Agent 页面懒加载且自身 gzip 约 4.98 KiB；响应式布局已覆盖 1,023/767 px。
- 写工具串行执行；历史裁剪保持完整 user/tool turn。
- SSE 未分帧 buffer 有 2 MiB 防护，断流与 Abort/timeout/retry 路径清楚。
- 页面首次仅取 30 条历史，Dexie `recent()` 最多允许 200。
- PWA 不缓存外部模型响应；离线 shell 包含 Agent UI。

## 必须修复项清单

- [ ] P0：恢复前后快照建立一致事务/写集 journal，并覆盖跨标签页并发测试。
- [ ] P1：纯查询不再全库快照；避免命令期间长期保留、临时持久化完整全库。
- [ ] P1：full backup 与 row diff 二选一持久化，修正 512 KiB 阈值的双份存储。
- [ ] P1：Agent 历史设字节/条数/年龄配额和清理策略。
- [ ] P1：SSE/JSON 累计响应、tool args、每轮/每命令工具数设硬上限。
- [ ] P1：`query.entities` 的 limit 下推到 IndexedDB cursor/index 或扫描预算。

## 未检查内容

- 未在真实 Chromium IndexedDB、Safari/iOS PWA、低端 Android 上运行 1k/10k/100k 行基准。
- 未使用真实 Provider 测首 token、SSE 长连接、CORS、网关延迟或 token 账单。
- 未运行尚不存在的 288-case eval runner，只核对并量化了 case 清单。
- 未用 Chrome Performance/Memory 面板采样 GC、React commit、长历史滚动或设置输入延迟。
- 未测接近浏览器存储配额、系统回收 IndexedDB、后台标签页冻结/恢复。
- 未测多标签页/多窗口同时执行命令和 UI 写入；代码审查已确认当前缺少统一锁和一致事务。
- 未做主 chunk 的 sourcemap/module treemap，因此 744.91 KiB 入口的模块归因仍未知。
