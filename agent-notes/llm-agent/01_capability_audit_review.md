# MouseKeeper 真实用户能力独立审计

审计日期：2026-08-01  
审计分支：`feat/llm-agent`  
审计性质：只读代码/运行测试审计；本文件是本次审计唯一产物，不包含 LLM Agent 实现。

## 1. 审查范围

本审计从实际路由和可见交互入口出发，反向核对查询、`MouseKeeperService` 命令、IndexedDB 实体和测试证据，重点检查：

- 所有桌面/移动导航、全局搜索、新建菜单及业务子路由；
- 小鼠、笼位、繁育、实验、记录、任务、数据安全、设置页面中的可见按钮、表单、批量操作和文件流程；
- `MouseKeeperService` 的全部公开命令，以及永久删除、备份恢复和 CSV 导入导出旁路；
- 16 张 Dexie 表、核心关系和活动日志；
- 当前的软删除、恢复、永久删除、恢复前备份、幂等重放和 revision 冲突机制；
- Vitest 与 Playwright 的现有证据；
- UI 有但服务层没有、服务层有但 UI 没有、组件直接写 DB、批量/文件/导航能力。

本次实际执行：

- `npm test -- --run`：11 个测试文件、67 个测试全部通过；
- `npm run test:e2e`：Chromium 与 mobile-chromium 共 22 个项目用例，14 个通过、8 个按设备条件跳过。

## 2. 实际阅读文件

完整或大段阅读：

- `src/App.tsx`
- `src/layout/navigation.ts`、`AppShell.tsx`、`CreateMenu.tsx`、`GlobalSearchDialog.tsx`
- `src/domain/types.ts`
- `src/db/database.ts`
- `src/services/types.ts`、`mousekeeper-service.ts`、`permanent-delete.ts`
- `src/backup/backup.ts`、`docs/backup-and-recovery.md`
- `src/import-export/mouse-import-runner.ts`
- `src/queries/dashboard.ts`、`search.ts`
- `src/features/data/DataPage.tsx`、`settings/SettingsPage.tsx`
- `src/features/mice/MouseDetailPage.tsx`
- `src/features/experiments/ExperimentDetailPage.tsx`
- `src/features/breeding/BreedingDetailPage.tsx`
- `src/features/tasks/TasksPage.tsx`
- `e2e/app.spec.ts`、`package.json`

通过全仓调用点、关键处理函数和按钮上下文核对：

- `src/features/**` 下全部页面；
- `src/services/mousekeeper-service.test.ts`、`permanent-delete.test.ts`；
- `src/backup/backup.test.ts`；
- `src/import-export/*.test.ts`；
- 其余单元/组件测试文件。

## 3. 实体与持久化边界

数据库实际有 16 张表：`mice`、`cages`、`cageAssignments`、`breedingPairs`、`litters`、`experiments`、`experimentGroups`、`experimentAssignments`、`mouseEvents`、`weightRecords`、`tasks`、`tags`、`activityLogs`、`savedViews`、`appSettings`、`backupMetadata`（`src/db/database.ts`）。

业务页面使用 `useLiveQuery`/Dexie 直接读取是当前常态；常规业务写入基本集中在 `MouseKeeperService`。例外是两个有意独立的高风险写入口：全库备份恢复模块和永久删除模块。主题与小鼠列表卡片偏好写 `localStorage`，浏览器持久存储授权写浏览器存储策略，不属于业务事实。

## 4. 能力清单与 UI → service → entity → mutation 链路

“LLM 状态”描述审计时现状：仓库尚无 Agent、tool registry 或 provider adapter，因此所有能力当前均为“未接入”。

| 用户能力 / UI 入口 | 查询或服务链路 | 主要实体与实际 mutation | 恢复现状 | 测试证据 | LLM 状态 |
|---|---|---|---|---|---|
| 总览 `/`、`/dashboard` | `loadDashboardSnapshot(db)` | 只读 mice/cages/assignments/breeding/tasks/events/activity/settings | 不适用 | E2E 工作区渲染；query 无专门单测 | 未接入 |
| 全局搜索（按钮、`⌘K`/`Ctrl+K`/`/`） | `searchGlobalRecords(db)` + 导航表 | 只读 tags/cages/mice/experiments/mouseEvents；导航到详情/模块 | 不适用 | E2E 焦点恢复；没有结果正确性用例 | 未接入 |
| 模块/详情/表单导航、新建菜单、返回列表 | wouter `Link`/`useLocation`；`CREATE_ACTIONS` | 路由/视图状态，不改业务 DB | 浏览器返回；无命令撤销 | E2E 覆盖九个工作区和主要子路由 | 未接入 |
| 小鼠列表查询、搜索、性别/状态/品系/基因型/笼位/实验筛选、排序 | 页面直接读 mice/cages/tags/experiments/assignments | 只读；卡片/表格模式写 `localStorage` | 可手动切换 | E2E 搜索和性别筛选 | 未接入 |
| 创建/复制创建小鼠，可选父母、标签、初始笼位 | `createMouseWithCage` → 内部 `createMouse`/`moveMouse` | add Mouse；可 add CageAssignment、MouseEvent、ActivityLog | 创建无一键撤销；只能再软删除档案，且不会恢复“创建前不存在”语义 | service 原子创建/容量警告；E2E 小鼠+初始笼位 | 未接入 |
| 批量创建小鼠 `/mice/bulk-create` | `createMice` → 多次 `createMouse`，同一外层事务 | bulk/add Mice + ActivityLogs | 无整批撤销 | service 覆盖基础批处理；移动端只验证页面可用，未 E2E 提交 | 未接入 |
| 编辑小鼠档案 | `updateMouse(expectedRevision, patch)` | put Mouse + ActivityLog | revision 防并发覆盖；日志不保存通用 before image，不能撤销 | service 关系/唯一性/修订相关覆盖；E2E 编辑名称 | 未接入 |
| 更改单只/批量小鼠状态（含终止状态） | `changeMouseStatus` / `changeMiceStatus`; `terminateMouse` 只是别名 | put Mouse；add status MouseEvent；终止时关闭 CageAssignment、ExperimentAssignment、BreedingPair | 无反向命令；终止产生的多关系关闭不可一键还原 | service 终止状态原子关闭关系、批量状态；E2E 批量状态 | 未接入 |
| 单只转笼/分配笼位/移出笼位 | `moveMouse` / `leaveCage` | 关闭旧 CageAssignment，add 新 assignment/event，put Mouse | 容量警告可确认；无撤销或恢复旧 active assignment | service 单一活动笼位/容量警告；E2E 初始分配 | 未接入 |
| 批量转笼 | `moveMice` → 多次 `moveMouse`，全表事务 | 多只 Mouse、CageAssignment、MouseEvent、ActivityLog | 无整批撤销 | service 原子批量；E2E 批量转笼 | 未接入 |
| 单只添加/移除标签；现场创建标签并绑定 | `setMouseTags`; `createTag` 后再次 `setMouseTags` | put Mouse，add tag-change event/log；可 add Tag | 两次 operationId，组合动作不是一个原子用户命令；无整组撤销 | service 标签命令；无对应 E2E | 未接入 |
| 批量添加/移除标签 | `setMiceTags` | put 多只 Mouse + events/logs | 无整批撤销 | service 批量标签单测；无 E2E | 未接入 |
| 保存、更新、删除小鼠筛选视图 | `createSavedView` / `updateSavedView` / `softDeleteSavedView` | add/put SavedView + ActivityLog | 服务有 `restoreSavedView`，但 UI 回收站不展示 savedViews，用户删后无法恢复 | service 单测覆盖 create/update/recycle；无 E2E | 未接入 |
| 软删除小鼠 | `softDeleteMouse` | put Mouse；结束当前笼位/实验/繁育；add MouseEvent/ActivityLog | 回收站可 `restoreMouse`，但只恢复档案本身，不重建删除时关闭的关系 | service 删除/恢复冲突；E2E 删除并恢复小鼠 | 未接入 |
| 创建/编辑笼位 | `createCage` / `updateCage` | add/put Cage + ActivityLog | 无撤销；revision 冲突控制 | service 覆盖；E2E 创建 | 未接入 |
| 笼位详情分配/转入小鼠、移出小鼠 | `moveMouse` / `leaveCage` | Mouse + CageAssignment + MouseEvent + ActivityLog | 无撤销；有容量确认 | service 覆盖；E2E 主要从小鼠建档分配 | 未接入 |
| 软删除笼位 | `softDeleteCage` | put Cage；要求无活动占用 | 回收站可 `restoreCage`；不会恢复历史活动状态 | service 有实现，E2E 未覆盖删除/恢复 | 未接入 |
| 创建繁育组合 | `createBreedingPair` | add BreedingPair + ActivityLog | 无软删除/恢复命令，无撤销 | service 性别/可用性警告；E2E 创建 | 未接入 |
| 更新繁育进度、分笼/预计产期/备注 | `updateBreedingPair` | put BreedingPair + ActivityLog | revision 控制；无撤销 | service 状态转换/日期不变量；E2E 未覆盖更新 | 未接入 |
| 创建窝记录并可批量创建后代 | `createLitterWithOffspring` | add Litter、bulkAdd Mice/MouseEvents、ActivityLog | 无修改/删除/撤销窝记录；后代可各自按小鼠处理 | service 原子性；E2E 窝+后代 | 未接入 |
| 创建实验并创建初始组 | `createExperimentWithInitialGroup` → `createExperiment` + `createExperimentGroup` | add Experiment、ExperimentGroup、logs | 无创建撤销 | service 原子性；E2E 创建 | 未接入 |
| 编辑/软删除实验 | `updateExperiment` / `softDeleteExperiment` | put Experiment；关闭/限制活动关系；ActivityLog | 回收站可 `restoreExperiment`，但不会自动恢复已关闭分配 | service 关闭条件/恢复存在；E2E 未覆盖删除恢复 | 未接入 |
| 添加实验组 | `createExperimentGroup` | add ExperimentGroup + ActivityLog | 没有组编辑/删除/恢复 | service 互斥组约束；E2E 主要使用初始组 | 未接入 |
| 单只或批量加入实验组 | UI 总是 `assignMiceToExperiment` → 内部 `assignMouseToExperiment` | add ExperimentAssignment、MouseEvent、ActivityLog | 警告可确认；无反向一键撤销（只能退出） | service 互斥/批量；E2E 批量加入 1 只 | 未接入 |
| 单只/批量退出实验组 | `exitExperimentAssignment` / `exitExperimentAssignments` | put ExperimentAssignment，add MouseEvent/ActivityLog | 没有重新激活原 assignment 的恢复命令 | service 覆盖；E2E 未覆盖退出 | 未接入 |
| 小鼠详情记录/编辑/删除人工事件 | `createMouseEvent` / `updateMouseEvent` / `softDeleteMouseEvent` | add/put MouseEvent + ActivityLog | 回收站可 `restoreMouseEvent`; revision 控制 | service 区分人工/系统事件；E2E 仅创建事件 | 未接入 |
| 记录单只体重 | `recordWeight` | add WeightRecord + 配对 MouseEvent + ActivityLog | 异常值需确认；服务可通过 `softDeleteMouseEvent` 成对软删体重/事件，但 UI 不提供体重删除按钮 | service 成对写删与异常；E2E 记录体重 | 未接入 |
| 快速批量称重 `/records/weights/quick` | `recordWeights` → 多次 `recordWeight`，外层事务 | 多个 WeightRecord、MouseEvent、ActivityLog | 无整批撤销 | service 快速称重原子单测；E2E 仅验证页面可用 | 未接入 |
| 记录中心按小鼠/类型浏览事件、体重、活动日志 | 页面直接读 mouseEvents/weightRecords/activityLogs/mice | 只读；清除 mouse query 用 `window.history.pushState` | 不适用 | E2E 工作区渲染；无筛选正确性专测 | 未接入 |
| 创建/编辑任务，可关联小鼠/笼位/实验 | `createTask` / `updateTask` | add/put Task + ActivityLog | revision 控制；无撤销 | service 覆盖关联校验；E2E 创建关联任务 | 未接入 |
| 完成/取消/恢复待办状态 | `setTaskStatus` | put Task + ActivityLog | 可手动切回 pending，但不是命令撤销 | service 覆盖；E2E 完成任务 | 未接入 |
| 软删除任务 | `softDeleteTask` | put Task + ActivityLog | 回收站可 `restoreTask` | service 有实现；E2E 未覆盖删除/恢复 | 未接入 |
| 下载完整 JSON 备份 | `ensureAppSettings` + `exportDatabaseBackup` + `downloadBlob` | 只读全部 16 表；文件下载 | 文件是灾难恢复点 | backup 单测；E2E 下载并检查文件名 | 未接入 |
| 预检并整库恢复 JSON | `createRestorePreview` → `restoreDatabaseBackup`（不经过 `MouseKeeperService`） | 单事务 clear + bulkAdd 全部 16 表 | 事务内生成精确恢复前备份，提交后尝试下载；下载失败不回滚已提交恢复 | backup 校验/失败回滚单测；E2E 损坏拒绝与恢复计数 | 未接入 |
| CSV 小鼠导入：预览、映射、逐行隔离、父母/笼位/标签解析 | `commitMouseImport` → 每行事务内 `createTag`/`createMouse`/`moveMouse` | Tag/Mouse/CageAssignment/MouseEvent/ActivityLog，带 importBatchId | 无导入批次删除或整批撤销；失败仅逐行隔离 | import 单测；E2E 一好一坏行 | 未接入 |
| CSV 导出小鼠/笼位/实验/体重/事件 | 页面从 DB 组装 → exporters → `downloadBlob` | 只读多个实体；文件下载 | 不适用 | exporter 单测；E2E 五种下载 | 未接入 |
| 回收站恢复 mouse/cage/experiment/task/tag/mouseEvent | 分派到相应 `restore*` service | put 目标实体 + ActivityLog；体重事件可连带 WeightRecord | revision/唯一键冲突会拒绝；只恢复目标记录，不通用恢复被关闭关系 | service 部分覆盖；E2E 仅 mouse | 未接入 |
| 回收站永久删除及影响预览 | `createPurgePreview` / `purgeDeletedEntity`（独立于 `MouseKeeperService`） | 直接 delete/bulkDelete 目标及允许的依赖，再 add 审计 tombstone | 明确不可恢复；执行前没有自动完整备份 | permanent-delete 单测 2 个；无 E2E | 未接入 |
| 生成/删除示例批次 | `generateSampleData` / `deleteSampleBatch` | add/bulkAdd 或 bulkDelete 带 sampleBatchId 的多表记录 | 删除是物理删除；无备份/撤销 | service 单测；E2E 生成与备份，未验证删除 | 未接入 |
| 主题设置 | `ThemeProvider` → `localStorage` | 非业务视图偏好 | 可切换/清除站点偏好 | E2E 深色切换 | 未接入 |
| 请求浏览器持久存储 | `navigator.storage.persist()` | 浏览器授权状态 | 由浏览器控制 | 无自动化 | 未接入 |
| 数据库完整性扫描 | `scanIntegrity(appDatabase)` | 只读全库 | 不修复，仅报告 | service 测试构造正常/损坏库；无 UI E2E | 未接入 |
| 侧栏折叠、移动端“更多”、数据页 tab、列表筛选等瞬时视图状态 | React state；少数 localStorage/URL | 不改业务实体 | 刷新后多数丢失，卡片模式/主题保留 | 主要是工作区/无溢出 E2E | 未接入 |

## 5. UI 与服务层不对称

### 5.1 UI 有能力，但不通过统一 `MouseKeeperService`

1. **整库恢复**：`DataPage` 直接调用 `restoreDatabaseBackup`。该模块本身有严格事务和验证，不是组件裸写，但对未来统一 capability registry 来说仍是旁路。
2. **永久删除**：`DataPage` 直接调用 `createPurgePreview`/`purgeDeletedEntity`。实现位于 `src/services/permanent-delete.ts`，却不属于 `MouseKeeperService` 的公共命令面；内部直接 delete/bulkDelete。
3. **文件导入/导出**：CSV 导入 runner 正确复用业务服务写入，但整个“预览→映射→提交”工作流不是一个应用命令；CSV/backup 导出是独立文件能力。
4. **设置/浏览器能力**：主题、列表视图偏好、持久存储授权、完整性扫描和导航状态都没有统一 application service。这些不是核心业务写入，但如果 Agent 要操作设置和视图，必须正式注册。
5. **URL 状态**：`RecordsPage` 清除小鼠筛选时直接 `window.history.pushState`，不走 wouter 导航；这是视图能力旁路，可能不触发路由订阅。

结论：未发现 React 业务组件直接对 Dexie 调用 `add`/`put`/`delete`。常规业务 mutation 走服务；真正的直接 DB 写集中在 backup restore、permanent delete 以及服务内部。UI 中大量直接 DB 调用是查询，不是 mutation。

### 5.2 服务层有能力，但 UI 无独立入口

- `restoreSavedView`：服务存在，但回收站不加载 savedViews；删除保存视图后用户无法恢复。
- `softDeleteTag`：服务存在，UI 能创建和绑定标签，却没有标签管理/删除入口。因而回收站虽支持恢复 tag，普通用户无法从 UI 把 tag 放入回收站。
- `softDeleteMouseEvent` 对 weight event 支持配对软删，但 UI 只给人工事件显示编辑/删除按钮，体重记录没有删除入口。
- `terminateMouse` 是 `changeMouseStatus` 的语义别名，UI 通过状态变更实现同一能力，不算真实缺口。
- `createMouse`、`createExperiment`、`assignMouseToExperiment` 是复合/批量命令内部复用或导入复用，UI 功能已间接覆盖，不应重复暴露成不同业务语义。

### 5.3 数据模型存在但当前产品没有的生命周期能力

以下不是“UI 漏接已有服务”，而是服务本身也没有：繁育组合软删除/恢复、窝记录更新/删除、实验组更新/删除、体重独立编辑、笼位/实验成员历史重新激活。这些对象一旦创建，多数只能继续追加历史，或依靠整库恢复纠错。Agent 不应通过直接 DB 写擅自补出这些能力。

## 6. 当前撤销、恢复与审计机制

### 已有

- 每个常规命令要求 `operationId`，`activityLogs.operationId` 唯一；相同 operationId/相同 action 可幂等重放，不同 action 会拒绝。
- 多数更新/软删/恢复使用 `expectedRevision`，能检测并发覆盖。
- 常规服务命令在 Dexie 事务中同时维护实体、关系投影、业务事件和 ActivityLog。
- 容量、繁育可用性、实验互斥、体重异常等危险条件以 warning code 要求显式确认。
- mouse/cage/experiment/task/tag/mouseEvent 有软删除和恢复命令；weight event 可连带恢复 WeightRecord。
- 永久删除先做引用影响预览，并保留一条不含原数据的审计 tombstone。
- 整库恢复先校验、单事务替换，并在同一事务快照中生成精确恢复前备份，随后触发下载。

### 不等同于撤销的地方

- ActivityLog 普遍只保存摘要、changed fields、结果 ID 和少量 metadata，并没有标准化 before image、inverse command 或 recovery descriptor。
- `operationId` 解决的是重试幂等，不是撤销。
- `expectedRevision` 解决的是并发冲突，不是恢复旧值。
- 回收站只恢复软删目标本身；小鼠/实验删除时被关闭的笼位、实验、繁育关系不会自动重建。
- 批量状态、批量转笼、批量标签、批量称重、实验批量加入/退出、CSV 导入没有“整个用户命令一次撤销”。
- 永久删除、示例批次物理删除在执行前没有自动完整备份阈值。
- 创建命令没有通用“删除本次创建及其副作用”的 inverse。

因此，当前产品具有审计、重放、软删除恢复和灾难恢复，但**没有命令级 undo 系统**。

## 7. 测试证据与缺口

### 已验证证据

- 67/67 Vitest 通过：唯一键、幂等、revision、容量警告、原子转笼/状态/标签批处理、谱系、繁育、实验互斥、终止状态关闭关系、体重事件成对写删、快速称重、软删恢复、示例批次、完整性扫描、备份校验/回滚、CSV 解析/导入/导出。
- 14/14 实际执行的 Playwright 项目用例通过，8 个为设备条件跳过。覆盖九工作区、桌面/移动无溢出、未保存离开警告、全局搜索焦点、小鼠/笼位/体重/任务主链路、批量状态/转笼、小鼠回收站、繁育窝和后代、实验加入、备份下载/损坏拒绝/恢复、CSV 导入导出、离线打开。

### 主要缺口

- 没有 capability registry、LLM tool、provider 或自然语言 eval 的任何测试。
- E2E 未覆盖：批量标签、保存视图、事件编辑/删除/恢复、体重删除/恢复、笼位/实验/任务/tag 的删除恢复、永久删除、批量称重提交、实验批量退出、繁育更新、示例批次删除、完整性扫描结果、持久存储授权。
- 查询层只有通过页面间接覆盖；全局搜索结果语义、复杂列表筛选组合、dashboard 指标和 attention 链接缺少直接测试。
- `permanent-delete.test.ts` 仅两个用例，尚未覆盖所有六类 purge、重放冲突、预览后状态变化和事务故障。
- 备份测试很强，但浏览器下载失败后恢复已提交的分支只靠代码路径，未见 E2E 故障注入。
- 不存在命令级 undo/revision-conflict-on-undo 测试，因为产品尚无该机制。

## 8. 关键发现

1. **现有业务服务面很强，但不是完整应用能力面。** 查询、导航、文件、设置、恢复和永久删除散落在 pages/queries/backup/import-export/services 中，不能仅把 `MouseKeeperService` 方法机械转成 LLM tools。
2. **常规业务组件没有裸写 DB，这是可复用的好边界。** Agent 应复用同一 service/application command，而不是操作 DOM 或 Dexie。
3. **当前没有真正的 undo。** 把软删恢复或 operationId 重放称为撤销会造成数据安全误导，尤其是终止状态、多关系关闭和批量命令。
4. **保存视图与标签存在生命周期断链。** saved view 可删不可从 UI 恢复；tag 可建可绑但无 UI 删除，回收站 tag 分支实际上缺少普通用户入口。
5. **高风险命令不在统一命令面。** 整库恢复、永久删除、示例物理删除和 CSV 批量导入需要 capability registry 中更高风险等级、确认策略和备份策略。
6. **复合动作边界不总是用户命令边界。** “创建标签并绑定当前小鼠”使用两个独立 operationId；CSV 导入按行事务；现有日志无法表达一个可整组撤销的用户意图。
7. **视图/导航能力必须被当作正式能力。** 当前导航表结构化程度不错，可直接成为 registry 的只读来源；但筛选、data tab、sidebar 折叠等状态仍散落在组件本地 state。

## 9. 建议

1. 建立共享 `CapabilityRegistry`，至少区分 `query`、`mutation`、`navigation`、`view-state`、`file-read`、`file-download`、`browser-setting`，由 UI 与 LLM 共用 application handler；不要从 DOM 按钮反推执行。
2. 给每个 mutation 定义统一结果：`operationId`、affected entity refs、before/after revision、human summary、navigation target、warnings、risk tier、recovery descriptor。
3. 新增 application-level 复合命令，把“创建标签并绑定”“CSV 导入批次”“实验批量关系变化”等纳入一个用户命令 envelope；底层仍复用现有 service。
4. 为可逆更新保存最小必要 before image/inverse 参数；undo 时校验 after revision。对关系操作记录被关闭/新建 assignment 和 event 的精确集合。
5. 对永久删除、整库恢复、大批量导入/物理删除设置自动全库备份阈值。永久删除应明确不可 undo，但应提供可下载且已验证的 pre-command backup。
6. 补齐 saved view 恢复与 tag 管理 UI，或明确从正式 capability 集合移除这些生命周期动作；不要让 Agent 拥有用户 UI 无法理解/验证的隐藏能力。
7. 将 navigation 定义、全局搜索与 dashboard/query handlers 纳入 registry；把 URL query 和可持久化视图状态抽离组件，避免 LLM 写 `window.history` 或直接操纵 React state。
8. 文件工具只应处理用户明确选择/提供的文件和下载产物；JSON restore 必须保持现有预检/确认/事务/安全副本链路，CSV import 必须保持逐行报告和业务服务校验。
9. LLM 工具覆盖测试应从本表逐项生成，除 happy path 外覆盖歧义、同名实体、revision conflict、warning confirmation、部分失败、重复 operationId、undo 冲突和无 provider 配置。

## 10. 未检查项

- 未手工逐按钮使用浏览器探索所有弹窗组合；运行 UI 证据来自完整 Playwright 套件及源码交叉核对。
- 未进行真实大数据、100 MB 备份、磁盘配额耗尽、多标签页并发、Safari/Firefox 或跨设备恢复。
- 未检查生产用户数据库中的真实数据形态；测试使用隔离 IndexedDB。
- 未做安全渗透、性能 profiling、无障碍人工读屏或视觉回归审查。
- 未检查尚未实现的 LLM Agent/provider，因为审计时仓库中不存在该代码。
- 未将缺少的产品生命周期能力视为可擅自新增；繁育、窝、实验组等删除/恢复语义需要产品决策。

