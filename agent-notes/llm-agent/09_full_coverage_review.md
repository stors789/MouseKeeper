# LLM Agent 完整能力覆盖独立审查

> 历史快照：本报告记录五轮实施后修复之前的严格审查结果，不是最终覆盖结论。schema、页面上下文、菜单/导航保护、文件 preview/commit、高风险撤回和逐行 runtime 契约缺口已在 `iterations/iteration-01-schema.md` 至 `iteration-05-provider-ui.md` 中修复；最终认证见仓库根目录 `LLM_CAPABILITY_AUDIT.md`。

审查日期：2026-08-01  
审查对象：`LLM_CAPABILITY_AUDIT.md` 的 106 项基线能力与当前 `feat/llm-agent` 工作树  
审查口径：只有“可发现的 capability ID + 足够窄且可理解的输入 schema + 稳定 handler/页面或业务落地 + 修改型命令恢复边界 + 能证明该条路径的自动化测试”全部成立才记 **covered**。**partial 不计覆盖**。

## 严格结论

- **covered：5 / 106（4.72%）**
- **partial：97 / 106（91.51%）**
- **uncovered：4 / 106（3.77%）**
- 严格完整覆盖率仅为 **4.72%**；“注册了通用 handler”或“业务 Service 本身有测试”不能替代该能力的 LLM 路径测试。
- 当前不存在“106/106 已完整覆盖”的证据。工具面已经相当广，但绝大多数项仍缺专项目标变体测试、页面状态契约或端到端恢复验证。

## 证据缩写

为使 106 行矩阵可读，测试位置使用以下固定缩写（不是泛称）：

- **T-R**：`src/application/capabilities/registry.test.ts`（只实际执行 `cage.create`、`cage.update`、`mouse.status.batch`、`query.entities`；其余仅注册数量）
- **T-X**：`src/application/capabilities/extended-handlers.test.ts`（实际覆盖 entity 导航事件、主题、CSV 导入、task 永久删除、视图事件存储）
- **T-O**：`src/agent/orchestrator/orchestrator.test.ts`（实际覆盖 `cage.create`、`mouse.create` 复合命令、错误修正、轮次与取消）
- **T-U**：`src/agent/recovery/recovery-manager.test.ts`（通用整命令 row diff/full snapshot、偏好恢复、冲突阻止）
- **T-S**：`src/services/mousekeeper-service.test.ts`（业务规则与原子性；不是 Agent capability 逐项测试）
- **T-P**：`src/services/permanent-delete.test.ts`
- **T-B**：`src/backup/backup.test.ts`
- **T-C**：`src/import-export/csv.test.ts`、`mouse-import.test.ts`、`mouse-import-runner.test.ts`、`exporters.test.ts`
- **T-A**：`src/agent/settings-capabilities.test.ts`
- **T-E**：`e2e/app.spec.ts`（基线 UI；没有 Agent 自然语言执行矩阵）
- **R0**：只读/导航，无恢复；**RD**：Orchestrator 命令边界的 row diff（达到阈值会升 full）；**RF**：强制 full recovery point；**RP**：localStorage 偏好 diff；**RB**：浏览器管理、不能精确撤回；**RU**：没有稳定恢复策略。

## 106 项逐行证据矩阵

| # | 严格状态 | capability ID 与输入变体 | 实际落地 | 测试证据 | 恢复 | 审查判定 |
|---:|---|---|---|---|---|---|
| 1 | partial | `navigation.open {href}`，一级路由字符串 | AppShell 监听 navigate 事件 | T-X 只测 entity 事件；T-E 只测 UI | R0 | handler 存在，但任意一级路由的 Agent 执行/渲染无测试 |
| 2 | partial | `navigation.open {href:'/mice?...'}` 或 `view.configure` 后导航 | Wouter/页面查询参数 | T-E；无 Agent 变体 | R0 | 可拼路由，但总览各指标的稳定预筛选契约未编码 |
| 3 | partial | `navigation.open {href:'/data|/tasks|/mice'}` | AppShell | T-E；无提醒变体 | R0 | 能导航，未证明所有提醒目标与筛选语义 |
| 4 | uncovered | **无 capability** | `CreateMenu` 的临时展开状态 | T-E 间接 | R0 | `navigation.open` 不能打开菜单本身 |
| 5 | partial | `navigation.open {href}`，6 条 create 路由 | Wouter | T-E；T-X 未测 | R0 | schema 是任意字符串，没有 6 路径枚举/逐项测试 |
| 6 | partial | `view.search.focus {}` | AppShell 打开 `GlobalSearchDialog` | T-X 未执行该 ID；T-E | R0 | listener 存在，无 capability→焦点专项测试 |
| 7 | partial | `query.search {query,limit?}` | `searchGlobalRecords` | App UI 测试；T-R 未执行该 ID | R0 | handler 稳定，但 capability 查询五类对象无专项测试 |
| 8 | partial | `query.search` + `navigation.open(.entity)` | 搜索结果 href/AppShell | T-X 只测 entity URL 编码；T-E UI 焦点 | R0 | LLM 路径没有关闭搜索/恢复触发焦点语义 |
| 9 | **covered** | `settings.theme.set {theme:light|dark|system}` | localStorage + ThemeProvider 事件 | T-X 精确执行；T-U 偏好撤回 | RP | capability、页面落地、持久化与撤回均有证据 |
| 10 | uncovered | **无“未保存状态/安全导航” capability** | `useUnsavedChanges` | T-E | R0 | LLM 导航不知道表单 dirty 状态，不能保证保护分支 |
| 11 | partial | `query.dashboard {}` | `loadDashboardSnapshot` | dashboard/Service 间接；T-R 未执行 | R0 | 返回聚合快照，但 Agent 路径无专项断言 |
| 12 | partial | `query.entities {entityType:'mouse',text}` 或 `view.configure {workspace:'mice',state:{query}}` | raw table query / MicePage listener | T-R 只测 cage；T-X 仅存 state | R0/RP | 页面 key 无 schema，页面结果未测试 |
| 13 | partial | `query.entities filters.sex` / `view.configure state.sex` | mouse 字段/MicePage | T-S/E 间接 | R0/RP | exact/in 操作可用，但 capability→页面筛选未验证 |
| 14 | partial | `filters.status` / `state.status` | 同上 | T-S/E 间接 | R0/RP | 同上 |
| 15 | partial | `filters.strain|genotype` / `state.strain|genotype` | raw Mouse/MicePage | T-R generic filter only | R0/RP | 模型看不到允许的页面键和值；无变体测试 |
| 16 | partial | `filters.currentCageId` / `state.cageId` | Mouse 投影/MicePage join | T-S/E 间接 | R0/RP | query 与 view 使用不同键，descriptor 未说明 |
| 17 | partial | 先查 `experimentAssignment` 再查 mouse，或 `state.experimentId` | 两表查询/MicePage join | 无 Agent 复合测试 | R0/RP | 无单次 join 能力，需模型推导两步 |
| 18 | partial | `filters.tagIds:{contains:id}` / `state.tagId` | Mouse.tagIds/MicePage | 无 Agent 变体 | R0/RP | ID 解析与页面 key 未在 schema 中说明 |
| 19 | partial | `filters.birthDate:{gte,lte}` / `state.birthFrom,birthTo` | generic comparator/MicePage | T-R 仅 contains；T-E 间接 | R0/RP | 日期范围操作符无 JSON schema/专项测试 |
| 20 | partial | `includeDeleted:true` / `state.includeDeleted` | queryEntities/MicePage | 无 capability 变体 | R0/RP | 可实现但未证明 |
| 21 | partial | `sortBy,sortDirection` / `state.sort` | queryEntities/MicePage | T-R 只测 cage sort | R0/RP | 页面 sort 枚举未暴露在 schema |
| 22 | uncovered | **无 page/perPage 输入** | MicePage 固定 `PAGE_SIZE=50`、内部 page state | T-E 间接 | RU | Agent 不能切页或设置每页数 |
| 23 | partial | `view.configure` 显式把全部 flat keys 重置 | MicePage listener | T-X 使用错误形状 `state.filters`，页面不读取它 | RP | 没有 `clearFilters` 稳定语义，测试未证明清除 |
| 24 | uncovered | **无 selection capability/context bridge** | MicePage `selectedIds` 仅组件内 state | T-E | R0 | AgentPage 只从详情路由推导一个对象，不知道列表多选/当前页/筛选集 |
| 25 | partial | `saved-view.create {scope,name,filters,sort,columns?}` | Service | T-S；T-R 只注册 | RD | columns 未 required、无 LLM 执行+撤回专项测试 |
| 26 | partial | `view.configure state`（没有 `savedViewId` 契约） | MicePage 自己应用保存视图 | T-E | RP | Agent 不能稳定按 ID 调用页面的 applySavedView 路径 |
| 27 | partial | `saved-view.update {savedViewId,patch}` | Service | T-S | RD | `patch` 为任意对象，registry 不做字段/类型校验；无 Agent 测试 |
| 28 | partial | `saved-view.delete {savedViewId}` | Service soft delete | T-S | RD | handler/恢复通用存在，无该 capability 的执行/撤回测试 |
| 29 | **covered** | `mouse.create`，含 `initialCageId`、标签/档案字段 | `createMouseWithCage` | T-O 真实复合创建+分笼；T-S；T-U 通用边界 | RD（复合时升 RF） | 当前证据完整；标签变体仍应加入矩阵但不降本条核心判定 |
| 30 | partial | `query.entities/query.search` + `mouse.create` | Service create；无 duplicate ID | T-O 只测新建 | RD | 没有“复制并覆盖字段”的稳定输入契约/测试 |
| 31 | partial | `mouse.create.batch {entries[]}` | `createMice` | T-U 用 30 条验证 full；T-S | RD/RF | 批量真实执行有证据，但无自然语言路由及全字段/失败原子性 capability 测试 |
| 32 | partial | `mouse.update {mouseId,patch}` | 自动补 revision→Service | T-R 只测 cage.update；T-S | RD | mouse patch schema较窄，但 capability 本身未执行测试 |
| 33 | partial | `mouse.status.batch {mouseIds,status,date,time?,reason?}` | core 转 revision targets→Service | T-R 精确执行；T-S | RD/RF | 有 handler 测试，但未测试整命令恢复/终止状态变体 |
| 34 | partial | `mouse.status.set` | Service | T-S | RD | 无 capability 专项执行/恢复测试 |
| 35 | partial | 同 `mouse.status.set`，status 为死亡/安乐死/转出 | Service 关闭关系 | T-S 精确业务规则 | RD/RF | LLM 路径与三种终结输入未测试 |
| 36 | partial | `mouse.move.batch {mouseIds,cageId,reason?}` | Service 原子批次 | T-S/E | RD/RF | 无 capability/恢复专项测试 |
| 37 | partial | `mouse.move {mouseId,cageId}` | Service | T-S/E | RD | 无 capability 专项测试 |
| 38 | partial | `mouse.cage.leave {mouseId,reason?}` | Service | T-S | RD | 无 capability 专项测试 |
| 39 | partial | `mouse.tags.batch {mouseIds,addTagIds?,removeTagIds?}` | core 转 targets→Service | T-S/E | RD/RF | schema 未把 add/remove 至少一个表达为约束；无 capability 测试 |
| 40 | partial | `mouse.tags.set {mouseId,tagIds}` | Service | T-S | RD | 无 capability 专项测试 |
| 41 | partial | `tag.create` 后 `mouse.tags.set` | 两个 Service handler | T-S；无 Agent 依赖链测试 | RD | 可组合但未证明前一步 ID 传递 |
| 42 | partial | `tag.delete {tagId}` | Service | T-S | RD | 无 capability 专项测试 |
| 43 | partial | `mouse.delete {mouseId,reason?}` | Service | T-S/E | RD/RF | 无 Agent 删除+整命令撤回测试 |
| 44 | partial | `mouse.restore {mouseId}` | Service | T-S/E | RD | 无 capability 专项测试 |
| 45 | partial | 多次 `query.entities`（mouse/assignments/events/weights） | raw tables | T-E | R0 | 没有稳定的聚合详情 capability；模型需自行 join，谱系/时间线未测试 |
| 46 | partial | `event.create` 全人工事件字段 | Service | T-S/E | RD | payload 为任意对象；无 capability 变体测试 |
| 47 | partial | `event.update {eventId,patch}` | Service | T-S | RD | patch 任意对象，registry 不校验字段；无 capability 测试 |
| 48 | partial | `event.delete {eventId}` | Service 配对删除 | T-S | RD | 无 capability 及配对恢复快照测试 |
| 49 | partial | `event.restore {eventId}` | Service 配对恢复 | T-S | RD | 无 capability 专项测试 |
| 50 | partial | `weight.record {mouseId,value,unit,date,time?,...}` | Service | T-S/E | RD | anomaly 默认/确认约束不在 schema；无 capability 测试 |
| 51 | partial | `weight.record.batch {entries[]}` | Service 原子批次 | T-S/E | RD/RF | 无 capability 自然语言/回滚测试 |
| 52 | partial | `query.entities {entityType:'cage',text}` 或 `query.search` | generic/search | T-R cage filter；T-E | R0 | 搜索语义 capability 无 cage 专项断言 |
| 53 | partial | 多次 query cage/mouse/cageAssignment | raw tables | T-E | R0 | 无聚合容量/成员/历史结果能力与测试 |
| 54 | **covered** | `cage.create {cageNumber,maxCapacity,...}` | Service | T-R、T-O 均真实执行；T-U 真撤回；T-S | RD | 端到端工具、数据与恢复证据完整 |
| 55 | partial | `cage.update {cageId,patch}` | 自动 revision→Service | T-R 精确执行；T-S | RD | patch 为任意对象，且未做整命令撤回测试 |
| 56 | partial | `mouse.move` | Service | T-S | RD | 与 37 同工具，但 cage-detail 来源语义无测试 |
| 57 | partial | `mouse.cage.leave` | Service | T-S | RD | 与 38 同工具，无 cage-detail 上下文测试 |
| 58 | partial | `cage.delete {cageId}` | Service 规则阻止非空笼 | T-S | RD | 无 capability 成功/阻止/撤回三分支测试 |
| 59 | partial | `cage.restore {cageId}` | Service | T-S | RD | 无 capability 专项测试 |
| 60 | partial | query breedingPair/litter/mouse | raw tables | T-E | R0 | 无聚合繁育列表/详情 capability |
| 61 | partial | `breeding.create {sireId,damId,pairedOn,...}` | Service warning rules | T-S/E | RD | warning acknowledgement 不在公开 schema，模型可能无法继续警告分支 |
| 62 | partial | `breeding.update {breedingPairId,patch}` | Service | T-S | RD | patch 任意对象；无 capability 变体 |
| 63 | partial | `breeding.litter.create {...offspring[]}` | Service 原子 | T-S/E | RF | descriptor 强制 full，但无 Agent 执行/撤回测试，warning acknowledgement 同样缺失 |
| 64 | partial | query experiment/group/assignment/mouse | raw tables | T-E | R0 | 无聚合详情工具，需模型 join |
| 65 | partial | `experiment.create {…,initialGroup}` | Service | T-S/E | RD/RF | 无 capability 专项测试 |
| 66 | partial | `experiment.update {experimentId,patch}` | Service | T-S | RD | patch 任意对象；无 capability 专项测试 |
| 67 | partial | `experiment.group.create` | Service | T-S | RD | 无 capability 专项测试 |
| 68 | partial | `experiment.assign.batch {mouseIds,experimentId,groupId,joinedOn}` | Service 原子 | T-S/E | RD/RF | 无 capability/排他组警告测试 |
| 69 | partial | `experiment.assign` | Service | T-S | RD | 无 capability 专项测试 |
| 70 | partial | `experiment.exit {assignmentId,exitedOn,...}` | Service | T-S | RD | 需先查询 assignment ID；无 Agent 依赖链测试 |
| 71 | partial | `experiment.exit.batch {assignmentIds,...}` | Service 原子 | T-S | RD/RF | 无 capability 专项测试 |
| 72 | partial | `experiment.delete` | Service | T-S | RD | 无 capability 成功/阻止/撤回测试 |
| 73 | partial | `experiment.restore` | Service | T-S | RD | 无 capability 专项测试 |
| 74 | partial | `view.configure {workspace:'records',state:{tab}}` | RecordsPage listener+持久读取 | T-X 只测 mice state 存储；T-E | RP | tab 枚举未在 capability schema 中，页面落地未测 |
| 75 | partial | records `state.query`；mouse filter 实际来自 URL `?mouse=` | RecordsPage | T-E | R0/RP | view handler 不支持 `mouseId`，需导航 URL；契约未声明 |
| 76 | partial | `task.create`，关联 ID 三选一 | Service | T-S/E | RD | schema 未表达关联互斥；无 capability 测试 |
| 77 | partial | `task.update {taskId,patch}` | Service | T-S | RD | 无 capability 专项测试 |
| 78 | partial | `view.configure {workspace:'tasks',state:{status}}` | TasksPage listener | T-E；无 exact T-X | RP | 状态枚举不在 schema |
| 79 | partial | `task.status.set {status:'completed'}` | Service | T-S/E | RD | 无 capability+撤回测试 |
| 80 | partial | `task.status.set {status:'cancelled'}` | Service | T-S | RD | 无 capability+撤回测试 |
| 81 | partial | `task.status.set {status:'pending'}` | Service | T-S | RD | 无 capability+撤回测试 |
| 82 | partial | `task.delete` | Service | T-S | RD | 无 capability 专项测试 |
| 83 | partial | `task.restore` | Service | T-S | RD | 无 capability 专项测试 |
| 84 | partial | `data.backup.export {}` | export + `downloadBlob` | T-B 只测内存备份；T-X 未执行下载 | RD（若 backupMetadata 变化） | 浏览器下载/artifact/Agent 路径无测试，descriptor 声称写 metadata 需核实 |
| 85 | partial | `data.file.request {kind:'backup-restore'}`，随后 restore 内部 preview | FileBroker + restore handler | T-B；T-X 只测 CSV request | R0 | 缺“只预检、不提交”的 capability，用户看不到恢复前预览 |
| 86 | partial | `data.backup.restore {fileRequestId}` | preview→原子替换→安全副本下载 | T-B 业务；无 T-X restore/Orchestrator | RF | handler 存在，但文件 UI 自动续跑、恢复点与下载未端到端测试 |
| 87 | partial | `data.file.request {kind:'csv-import'}` 后 import 内部 parse/validate | FileBroker/CSV | T-X 精确选择+提交；T-C | R0 | 缺独立 preview，选择后直接进入提交 |
| 88 | partial | `data.csv.import {fileRequestId,mapping?}` | 自动 suggest 或一次性 supplied mapping | T-C；T-X 只测自动 | RF | Agent 无法先读取建议/错误再人工修订映射；mapping 为任意对象 |
| 89 | **covered** | `data.csv.import` 自动 mapping、合法行导入 | FileBroker→validator→Service | T-X 精确真实导入；T-C；T-U 通用 RF 边界 | RF | 核心“逐行提交合法行”链有真实证据；手动映射另见 88 |
| 90 | partial | `data.csv.export {kind:'mice'}` | shared `buildCsvExport` + download | T-C exporter；无 handler 下载测试 | R0 | kind 业务输出有测试，Agent artifact/下载没有 |
| 91 | partial | 同上 `kind:'cages'` | 同上 | T-C | R0 | 同上 |
| 92 | partial | 同上 `kind:'experiments'` | 同上 | T-C | R0 | 同上 |
| 93 | partial | 同上 `kind:'weights'` | 同上 | T-C | R0 | 同上 |
| 94 | partial | 同上 `kind:'events'` | 同上 | T-C | R0 | 同上 |
| 95 | partial | `tag.restore` | Service | T-S | RD | 无 capability 专项测试 |
| 96 | partial | `data.purge.preview/execute {entityType:'mouse'}` | permanent-delete service | T-P blocker场景；无 handler该变体 | RF | schema/handler有，缺成功执行+恢复测试 |
| 97 | partial | 同上 `cage` | service | T-P 间接 | RF | 无 capability 变体测试 |
| 98 | partial | 同上 `experiment` | service | T-P 间接 | RF | 无 capability 变体测试 |
| 99 | **covered** | 同上 `task` | preview→purge | T-X 精确 preview+执行；T-P；T-U 通用 full/undo | RF | 工具与真实物理删除有精确证据；建议再加同一测试内 undo |
| 100 | partial | 同上 `tag` | service | T-P 间接 | RF | 无 capability 变体测试 |
| 101 | partial | 同上 `mouseEvent`（Service 同时处理配对 weight） | service | T-P/ T-S 间接 | RF | 无配对事件 capability purge+恢复测试 |
| 102 | partial | `sample.create {}` | Service | T-S/E | RF | 无 capability/整批撤回测试 |
| 103 | partial | `sample.delete {sampleBatchId}` | Service 物理删除 | T-S | RF | 无 capability/恢复点专项测试 |
| 104 | partial | `settings.storage.persist {}` | `navigator.storage.persist()` | 无专项测试 | RB | handler 存在，但浏览器支持/拒绝/异常未测，且不可精确撤回 |
| 105 | partial | `settings.storage.status {}` | Storage API + counts + integrity | T-E；无 capability 测试 | R0 | navigator API 缺失时的输出与字段无测试 |
| 106 | partial | `query.integrity {}` | `scanIntegrity` | T-S/T-B 间接；T-R 未执行 | R0 | 业务扫描有测试，Agent capability 路径无直接断言 |

## 关键问题（按严重度）

### P0：能力 schema 没有被真正执行验证

`CapabilityRegistry.validateRequired` 只检查 required 是否缺失，不校验类型、enum、日期格式、`additionalProperties` 或数组成员。发送给模型的 JSON Schema 因而只是提示，不是运行时边界。尤其以下公开写能力使用 `jsonObject`（`additionalProperties:true`）：

- `cage.update`
- `breeding.update`
- `experiment.update`
- `event.update`
- `saved-view.update`
- `settings.agent.preset.update`
- `settings.agent.provider.update`
- `data.csv.import.mapping`

业务 Service 的 Zod 会拦下一部分错误，但 `view.configure` 没有 Service 校验，错误字段会被持久化并被 handler 报为“已更新”，页面则静默忽略。建议 registry 在 handler 前执行完整 JSON Schema 校验（如 Ajv），并把所有 patch/state 收窄到公开字段。

### P0：页面上下文没有进入 Agent

`AgentPage.selectedFromRoute` 只从详情 URL 推导单个 mouse/cage/breedingPair/experiment。`MicePage.selectedIds`、列表当前筛选、排序、页码、保存视图、Records 的 mouseFilter、Tasks 的状态范围都没有送入 `AgentContext.visibleFilters/selected`。虽然 system prompt 声称存在“当前筛选”，AgentPage 实际没有设置 `visibleFilters`。

直接后果：第 17、18、24、33、36、39、68、71 等“这些/当前筛选结果/已选择对象”的指令不能可靠落地。应建立共享的 `ApplicationContextStore`，由页面发布结构化 selection/filters，Agent 订阅快照。

### P0：文件 preview 与 commit 没有拆分

- JSON：`data.file.request` 只建请求；`data.backup.restore` 内部预检通过后立即替换全库，没有独立的 `data.backup.preview`。
- CSV：`data.csv.import` 内部 parse/suggest/validate 后立即提交，没有 `data.csv.preview`；用户/模型不能先检查逐行错误和建议映射再修改映射后提交。

因此第 85、87、88 只能 partial。建议 file request → preview token（包含文件摘要/校验结果）→ explicit commit 三阶段，token 绑定文件 digest 并一次性消费。

### P1：视图能力虽然已接到页面，但契约仍不稳定

Mice/Records/Tasks/Data 页面已经监听 `APPLICATION_EVENT_NAMES.view` 并在 mount 时读取 localStorage，这是有效进展；但 `view.configure.state` 完全自由。现有 T-X 发送 `{filters:{sex:'female'},sort:'age-oldest'}`，而 `MicePage` 只读取 flat `state.sex`，所以测试“通过”但页面性别筛选不会变化。

应拆成稳定 ID，或至少给 discriminated schema：

- `view.mice.configure`：`query,status,sex,strain,genotype,cageId,tagId,experimentId,birthFrom,birthTo,includeDeleted,sort,viewMode`
- `view.records.configure`：`tab,query,mouseId`
- `view.tasks.configure`：`status,dueScope,relatedKey`
- `view.data.configure`：`tab`
- 另加 `view.mice.clear-filters`、selection/page 能力。

### P1：UI 与 LLM 仍不是同一 registry 入口

`src/app/runtime.ts` 暴露了 `executeUiCapability`，但源码搜索显示各页面写入仍直接调用 `appService.*`，`executeUiCapability` 没有实际消费者。两者共享 Service 业务内核是优点，但 capability schema、结果 shape、事件适配和恢复元数据仍可能与 UI 漂移。当前 `view.configure` 测试与页面契约不一致就是实例。

建议逐步把 UI action 也通过 typed capability facade 调用，或至少以契约测试强制每个 UI action 与 capability 的输入/结果等价。

### P1：测试声明夸大了实际覆盖

`catalog.ts` 的 descriptor 默认把 `testLocations` 写成 `registry.test.ts`，但该文件只直接执行少数 ID；注册数量测试不证明每个 handler 可用。类似地，Service 测试证明业务函数，不证明模型可发现、生成正确输入、Orchestrator 调用、AgentPage 展示、整命令恢复。

建议建立数据驱动契约套件，对每个 descriptor 至少包含：valid fixture、invalid fixture、handler result、writes diff、undo、affected link；再建立 106 项 audit row→capability→eval case 的机器可读映射，CI 计算严格覆盖率。

### P1：恢复能力存在，但高风险路径缺端到端证明

RecoveryManager 的设计总体扎实：begin 先持久化 full before snapshot；finish 计算 16 表 row diff 与非秘密偏好 diff；undo 在恢复前逐行冲突检查。但以下仍需专项测试：

- JSON 全库 restore 后 undo；
- CSV 部分成功/部分失败后的整命令 undo；
- permanent purge 的 6 种 entity type 后 undo；
- sample delete、litter create、大批量 experiment/mouse 操作；
- Agent 命令失败但已经完成部分工具时，UI 是否明确显示仍可撤回（当前 failed run 的 AgentPage 不显示 undo 按钮，因为 `canUndo` 限定 status=`succeeded`）。

最后一项是实际可恢复但 UI 无入口的缺口：失败命令若前几个 tool 已写入，RecoveryManager 会记录 changes，但 AgentPage 隐藏撤回按钮。

### P2：其他可复现契约问题

- `navigation.open` 只验证以 `/` 开头，未校验是否是已知应用路由；模型可把用户送到 404。
- `navigation.open.entity` 只支持 mouse/cage/breedingPair/experiment；task、event、tag、savedView 没有实体详情目标。结果可用各页面/查询参数绕行，但不稳定。
- `query.entities` 对任何字段名/操作符开放；未知操作符对象可能被当作“全部条件通过”，造成过宽结果，而不是失败。
- generic text 使用 `JSON.stringify(row)`，会搜索内部字段/标识，结果语义与 UI 搜索不一致。
- `query.entities` 最多返回 500 条，没有 cursor/pagination；大批量“全部”操作必须让模型分批，但没有稳定游标能力。
- `settings.storage.persist` descriptor 标记 `modifiesData:true` 却 risk=`view-only`、recovery=`browser-managed`，UI 应明确“不可撤回”。
- Provider/Agent 设置 capability 不属于原 106 行，但其 patch 同样过宽；安全测试做得较好，尤其秘密值不回显和持密钥端点变更阻止。

## 建议的修复与验收顺序

1. 加完整 JSON Schema runtime validation；收窄所有 patch/view/mapping schema。
2. 建 `ApplicationContextStore`，接入 Mice selection/filter/page、Records/Tasks/Data 状态，并在 AgentPage 传 `visibleFilters` 与全部 selected IDs。
3. 拆分 JSON/CSV preview 与 commit；文件 token 绑定 digest。
4. 处理 failed-but-mutated run：允许冲突检查后的撤回，并在 ledger 明示“失败但产生 N 项变化”。
5. 添加 selection/page/clear-filter 稳定能力，并把 view capability 拆域。
6. 为 106 行建立一一对应的数据驱动测试；partial 不得在最终审计表标“是”。
7. 高风险恢复矩阵优先：restore、CSV、purge 6 类、sample、litter、批量关系操作。
8. 用 Playwright 从 Agent 输入框执行代表性命令，断言页面状态、数据库、ledger、撤回后的数据库与页面同步。

## 实际读取的文件

- `LLM_CAPABILITY_AUDIT.md`（完整 106 行）
- `src/application/capabilities/catalog.ts`
- `src/application/capabilities/core-handlers.ts`
- `src/application/capabilities/extended-handlers.ts`
- `src/application/capabilities/registry.ts`
- `src/application/capabilities/schema.ts`
- `src/application/view-state.ts`
- `src/application/capabilities/registry.test.ts`
- `src/application/capabilities/extended-handlers.test.ts`
- `src/agent/settings-capabilities.ts`
- `src/agent/settings-capabilities.test.ts`
- `src/agent/orchestrator/orchestrator.ts`
- `src/agent/orchestrator/system-prompt.ts`
- `src/agent/orchestrator/orchestrator.test.ts`
- `src/agent/recovery/recovery-manager.ts`
- `src/agent/recovery/recovery-manager.test.ts`
- `src/agent/runtime.ts`
- `src/features/agent/AgentPage.tsx`
- `src/features/mice/MicePage.tsx`
- `src/features/records/RecordsPage.tsx`
- `src/features/tasks/TasksPage.tsx`
- `src/features/data/DataPage.tsx`
- `src/layout/AppShell.tsx`
- `src/hooks/ThemeProvider.tsx`
- `src/app/runtime.ts`
- `src/services/mousekeeper-service.ts`
- `src/services/mousekeeper-service.test.ts`
- `src/services/permanent-delete.test.ts`
- `src/queries/search.ts`
- `src/domain/types.ts`
- `src/db/database.ts`
- 备份、CSV、E2E 与相关测试文件（见上方测试缩写）

## 未检查内容与边界

- 没有使用真实远程 Provider/API Key 发请求，因此不对特定模型实际选工具的成功率作背书。
- 没有在本子任务运行完整浏览器 Agent E2E；本结论依据代码、既有测试内容与 handler/page 契约静态核对。
- 没有逐像素检查 Agent/Settings CSS、移动端布局、屏幕阅读器输出或性能；这些不影响本报告的 106 项功能覆盖计数。
- 没有审查尚未提交的 `agent-notes/llm-agent/06_eval_design_review.md` 内容；它不是运行中的能力证据。
- 工作树在团队并行开发中变化；本报告以生成时读取到的上述文件版本为准。若修复后要改变 covered 数，必须重新运行对应专项测试并更新逐行证据。
