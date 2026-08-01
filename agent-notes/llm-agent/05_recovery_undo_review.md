# LLM Agent 自动恢复点与整命令撤回：独立架构审查

## 范围

本审查仅覆盖 Agent 写操作的恢复与撤回边界，重点核对：

- 当前 IndexedDB 的 16 张表、实体 revision 与软删除语义；
- `MouseKeeperService` 的事务、`operationId` 幂等、活动日志与复合命令；
- 完整备份/恢复的校验、恢复前快照和事务原子性；
- CSV 导入的逐行事务与部分成功语义；
- 回收站永久删除和示例批次物理删除；
- 可实现的 command-level before/after journal、高影响完整恢复点、冲突检测、幂等、并发与多标签页策略；
- 所需的持久化隔离和测试矩阵。

这是独立只读审查。除本报告外，没有修改业务源码、配置或测试，也没有提交 Git commit。

## 实际读取文件

- `src/db/database.ts`
- `src/db/integrity.ts`
- `src/domain/types.ts`
- `src/config/app.ts`
- `src/services/types.ts`
- `src/services/errors.ts`
- `src/services/mousekeeper-service.ts`
- `src/services/mousekeeper-service.test.ts`
- `src/services/permanent-delete.ts`
- `src/services/permanent-delete.test.ts`
- `src/backup/types.ts`
- `src/backup/backup.ts`
- `src/backup/backup.test.ts`
- `src/import-export/mouse-import-runner.ts`
- `src/import-export/mouse-import-runner.test.ts`
- `src/features/data/DataPage.tsx`
- 当前在建的 `src/application/capabilities/types.ts` 与 `schema.ts`（只用于确认 Registry 已预留 `risk` / `recovery` 描述，不把未完成代码当作既有保障）

## 代码证据

1. 当前 schemaVersion 为 1，Dexie 中有 16 张表：12 张核心业务/关系表，加 `activityLogs`、`savedViews`、`appSettings`、`backupMetadata`。所有表及索引集中定义在 `src/db/database.ts:28-80`，表类型在 `src/db/database.ts:100-116`。这为一次事务覆盖完整业务状态提供了现成基础。

2. 所有持久化实体继承 `StoredEntity`，包含 `revision`、`updatedAt`、`deletedFlag`、来源与导入/示例批次 provenance，见 `src/domain/types.ts:14-25`。服务更新普遍使用 `revision + 1`；`assertRevision` 在不匹配时抛出 `revision-conflict`，见 `src/services/mousekeeper-service.ts:332-340`。

3. `activityLogs.operationId` 有唯一索引（`src/db/database.ts:73-75`）；服务先按 operationId 查重并核对 action（`src/services/mousekeeper-service.ts:342-357`），随后活动日志仅保存摘要、changedFields、warnings、结果 ID 与可选 metadata（`src/domain/types.ts:336-349`，`src/services/mousekeeper-service.ts:371-403`）。它能支持幂等回放，但没有足够的 before state，不能充当撤回日志。

4. 多数基础 mutation 把业务表与 `activityLogs` 放在同一个 Dexie `rw` 事务内。复合/批处理进一步用外层事务调用子服务，并派生 `${operationId}:...` 子 operationId。例如创建小鼠并分笼见 `src/services/mousekeeper-service.ts:664-720`，批量建鼠见 `src/services/mousekeeper-service.ts:723-764`，批量改状态/移动见 `src/services/mousekeeper-service.ts:766-849`。现有测试已证明子操作失败会回滚整个复合事务，例如 `src/services/mousekeeper-service.test.ts:158-205`。

5. 完整备份显式固定为这 16 张表，见 `src/backup/types.ts:24-41`；带 schema/app/databaseInstanceId、逐表计数及 SHA-256 canonical digest（`src/backup/types.ts:72-89`）。恢复会先验证输入，然后在同一个 all-table 写事务中读取精确的恢复前状态、清空并重写全部 16 表（`src/backup/backup.ts:232-296`）；注释明确说明该位置消除了跨标签页提交遗漏窗口（`src/backup/backup.ts:299-323`）。故障注入测试证明清空/写入失败会整体回滚（`src/backup/backup.test.ts:327-344`）。

6. 当前恢复前快照只作为 `RestoreResult.preRestoreBackup` 返回内存，随后 UI 尝试触发浏览器下载（`src/features/data/DataPage.tsx:270-307`）。若页面在事务提交后、下载前崩溃，或浏览器拒绝下载，恢复点没有自动持久化；`backupMetadata` 类型存在，但该流程没有写入实际恢复内容。

7. 永久删除会在 `database.tables` 事务中重新生成 preview、检查引用、物理删除记录并留下审计 tombstone（`src/services/permanent-delete.ts:256-327`）。tombstone 只保存 label 与删除数量（`src/services/permanent-delete.ts:222-253`），没有被删记录内容，因此永久删除在当前实现中不可逆。测试只覆盖引用阻断、tombstone 和 operationId 回放（`src/services/permanent-delete.test.ts:23-89`）。

8. CSV 导入按“每一行一个事务”执行标签创建、建鼠和可选分笼（`src/import-export/mouse-import-runner.ts:116-181`）；外层逐行捕获错误继续处理（`src/import-export/mouse-import-runner.ts:197-239`）。因此一次文件导入允许部分成功，不能假设整个 importBatch 天然原子。

9. `deleteSampleBatch` 扫描 16 表、拒绝批次外引用，然后物理 `bulkDelete` 该批次的所有记录，最后写活动日志；动作虽在 all-table transaction 内，但没有 before state，见 `src/services/mousekeeper-service.ts:5155-5277`。它与永久删除一样必须在执行前建立完整恢复材料。

10. Dexie 目前仅显式处理数据库升级 `blocked/versionchange` 并关闭旧连接（`src/db/database.ts:23-26,126-135`）。没有跨标签页命令租约、command journal、数据库 epoch 或撤回状态机。`useLiveQuery` 能让视图响应变更，但不是并发互斥或冲突检测机制。

## 主要发现

### F1 — 现有活动日志不能支持可靠撤回（高）

`resultEntityIds` 只能定位部分结果，不能恢复被覆盖字段、被结束的旧笼位/实验 assignment、配对 weight record、批量导入创建的共享标签，也不能复活物理删除数据。把 before/after 塞进现有 `ActivityLog.metadata` 也不理想：活动日志当前同时承担 operationId 幂等索引和用户审计，生命周期、查询方式与大体积恢复数据不同；撤回活动日志本身还会破坏原命令的幂等证据。

结论：保留 `activityLogs` 为不可变审计/回放证据，新增专用 command journal；撤回时追加 `command.undo` 审计，不删除原活动日志。

### F2 — 基础事务足够强，但“整条自然语言命令”不等于一个现有事务（高）

单个 service 或已封装 compound service 可以被一个 Dexie 事务覆盖；但 Agent 一条用户消息可能跨多个 tool call，模型推理/网络等待不能安全地放进长时间 IndexedDB 事务。若逐 tool commit，就会在后续 tool 失败时留下部分完成状态。

结论：使用两层边界：

- `commandRunId`：一条用户自然语言命令，负责整命令撤回与 saga 状态；
- `segmentId`：一次实际 mutation capability，必须在单个 Dexie 事务中同时提交业务变更与 before/after journal。

优先把确定性的多步业务流程暴露成 compound capability，使其成为一个 segment；真正跨 tool-round 的写操作用 saga，失败时按 segment 逆序自动补偿。不能把 LLM 网络调用放入数据库事务。

### F3 — 物理删除和全库恢复必须在写入前持久化恢复点（高）

永久删除、示例批次删除、全库 restore 一旦成功，仅凭现有 tombstone 无法还原。restore 虽能生成事务内精确 pre-restore backup，但只返回内存，持久化仍有 crash gap。

结论：高影响命令若恢复点写入失败（quota、序列化、校验错误），业务写入必须不发生；不得以“执行成功但无恢复点”降级继续。

### F4 — revision 可用于冲突检测，但直接恢复旧 revision 会制造 ABA（高）

若把 before snapshot 原样 `put` 回去，revision 会从例如 8 降回 7。另一个标签页先前持有 revision 7 的陈旧表单会再次被接受，形成 ABA。恢复应还原业务字段，但 revision 必须单调增加，`updatedAt` 使用撤回时刻；before/after 的 canonical hash 用于确认当前状态确实仍等于命令提交后的状态。

### F5 — 导入的“部分成功”需要显式建模（中高）

现有逐行容错是产品语义，不宜为 Agent 暗改成全文件全有或全无。但所有成功行必须挂到同一 `commandRunId/importBatchId`，用户点击一次“撤回”应移除整次命令中所有成功行的效果；共享标签和父子顺序要求按 journal 逆序回放。

### F6 — 恢复数据必须与 16 表业务备份逻辑隔离（高）

若 journal 被纳入普通全库备份，恢复旧备份会同时恢复旧 journal，产生循环快照、operationId 重复及错误撤回目标；若放到另一个 IndexedDB，又无法与业务 mutation 原子提交。最佳折中是在同一个 IndexedDB 增加专用 recovery tables，但从 `BACKUP_TABLE_NAMES`、业务导出、业务完整性计数、sample/import provenance 扫描中排除。

## 建议架构

### 1. 持久化模型

将数据库 schema 升级，并在同一个 `MouseKeeperDatabase` 增加三个辅助表。它们不属于当前 16 张业务/运营表，也不得进入普通 backup envelope：

```ts
interface CommandRun {
  id: string                 // commandRunId
  databaseInstanceId: string
  databaseEpoch: number
  clientId: string           // 当前标签页随机 ID，仅用于诊断
  requestKey: string         // 用户意图/规范化请求 hash
  status: 'running' | 'succeeded' | 'failed' |
          'undoing' | 'undone' | 'undo-conflict'
  capabilityIds: string[]
  segmentCount: number
  recoveryKind: 'row-diff' | 'full-backup'
  createdAt: string
  committedAt?: string
  undoneAt?: string
  lastError?: JsonValue
}

interface CommandSegment {
  id: string
  commandRunId: string
  ordinal: number
  operationId: string        // unique
  capabilityId: string
  capabilityVersion: number
  inputHash: string
  status: 'started' | 'committed' | 'compensated'
  result?: JsonValue         // 幂等重放需要的精简结果
  committedAt?: string
}

interface CommandChange {
  id: string                 // run:segment:ordinal
  commandRunId: string
  segmentId: string
  ordinal: number
  tableName: DomainTableName
  recordId: string
  kind: 'create' | 'update' | 'delete'
  before: JsonValue | null
  after: JsonValue | null
  beforeHash: string | null
  afterHash: string | null
}

interface RecoveryCheckpoint {
  id: string
  commandRunId: string
  databaseInstanceId: string
  databaseEpoch: number
  checksum: string
  tableCounts: BackupTableCounts
  envelope: BackupEnvelope | Blob
  byteLength: number
  createdAt: string
  expiresAt?: string
}
```

实现时可把 `CommandSegment` 嵌入 `CommandRun`，但不要把所有 row snapshots 塞进一条大记录；逐 change 存储便于索引、quota 估算和流式清理。建议索引：`commandRuns: id,&requestKey,status,committedAt,[databaseEpoch+status]`；`segments: id,&operationId,commandRunId,[commandRunId+ordinal]`；`changes: id,commandRunId,segmentId,[commandRunId+ordinal],[tableName+recordId]`；`checkpoints: id,&commandRunId,createdAt,databaseEpoch`。

恢复表与业务表处于同一个 IndexedDB，才能在一个事务内提交 row diff；但它们必须通过显式 `DOMAIN_TABLE_NAMES` 与 `RECOVERY_TABLE_NAMES` 分组，禁止继续把含义不同的范围都写成裸 `database.tables`。现有 restore、sample delete、integrity scan 都应改为使用显式表组。

### 2. before/after 捕获与提交

新增唯一的 `CommandRecoveryCoordinator`，所有来自 UI 和 LLM Registry 的 mutation 都经此执行；禁止 Agent handler 直接写 Dexie。建议 segment 流程：

1. Registry descriptor 声明完整 `writes` 表集合、risk、recovery strategy 和可选 impact estimator。
2. 开启覆盖 declared write tables、`activityLogs` 和 recovery tables 的外层 Dexie `rw` 事务。
3. 在事务内获取这些业务表的 before snapshot。第一版为正确性优先，可读取 declared write tables 全表；落库时只保存按 id 比较后真正变化的记录。后续只有在测试证明不会漏 cascade 时，才改为 descriptor 的 target selector。
4. 调用既有 service。Dexie 的兼容嵌套事务会复用外层事务；handler 不得在此阶段发网络请求、等待用户输入或触发下载。
5. 在同一事务内读取 after，按 `(tableName,id)` 生成 create/update/delete change，使用现有 canonical JSON 算 SHA-256 hash；非 IndexedDB promise 必须用 `Dexie.waitFor`，或使用同步 canonical + 已验证 hash 实现。
6. 原子写入 segment、changes，并将 run 状态/计数推进。任何 journal 写入或 quota 失败都会回滚业务 mutation。
7. 事务提交后才向 Agent/UI 返回结果。

完整 snapshot 比 JSON Patch 更稳妥：可无损恢复被删除的可选字段、派生 active keys 与嵌套 payload；before/after diff 仍可在 UI 中由两份 snapshot 生成。必须做 prototype-pollution 安全解析并复用 canonical JSON 规则。

`activityLogs` 不进入可反向变更集合。它保留原 action 与 operationId；撤回另写一条 `command.undo` 活动记录，metadata 引用 commandRunId 和原 operationIds。已撤回 run 的原 operationId 永久保留，重试应返回“该操作已撤回”或既存撤回结果，不能再次创建同一实体。

### 3. 整命令边界与复合命令

- 一条用户消息创建一个稳定 `commandRunId`；同一次请求重试复用 `requestKey`，避免重复 run。
- 每个 mutating tool call 使用稳定 `operationId = commandRunId + segment ordinal + capability id`。模型重试相同 call 时同时核对 capability/version/inputHash，不能只核对 action 名。
- 一个 compound capability（例如建鼠并分笼、创建实验及初始组、批量转笼）应在一个 segment 内执行；现有子 operationId 可继续用于 service 幂等，journal 以外层 segment 为撤回原子单位。
- 跨多个模型 tool round 的写操作是 saga：每段提交后 journal；最终响应前把 run 标为 succeeded。后续段失败时，Coordinator 自动按逆序撤回已提交段；若发生并发冲突则标记 `failed + undo-conflict`，向用户明确列出部分效果，绝不伪报“已全部回滚”。
- 能预先规划的写序列应优先生成 mutation plan，完成只读解析/消歧后一次执行，不让 LLM 在写了一半后继续自由推理。
- UI 的“一键撤回”针对 `commandRunId`，在一个短 all-domain+recovery transaction 内逆序应用该 run 的所有 changes，确保用户看到的是整命令全撤或完全不撤。

### 4. 撤回算法与冲突检测

撤回必须先完整 preflight，再写任何数据：

1. 以事务内 compare-and-set 将 run 从 `succeeded` 改为 `undoing`；相同 undo operationId 重试直接返回已保存结果。两个标签页同时撤回时只有一个成功取得状态。
2. 验证 `databaseInstanceId` 与 out-of-band `databaseEpoch` 均匹配。普通全库 restore 后 epoch 必须递增，使旧状态 journal 失效；事务内生成的 pre-restore checkpoint 单独保留为灾难恢复入口。
3. 对 changes 逆序检查当前值：
   - 原 create：当前记录必须存在，canonical hash 必须等于 `afterHash`；撤回将其物理删除。
   - 原 update：当前记录必须存在且 hash 等于 `afterHash`；撤回业务字段到 before。
   - 原 delete：当前记录必须不存在；撤回重建 before。
4. 任何一条 hash 不符、记录缺失/意外存在、epoch 不符都使整个撤回事务无写入回滚，并返回逐记录 conflict（table/id/expected hash/current revision）。不提供静默 `force` 覆盖。
5. 对 update/delete 的恢复，不原样回退技术元数据。业务字段来自 before，但 `revision = max(current?.revision ?? 0, before.revision, after?.revision ?? 0) + 1`，`updatedAt = undoNow`；保持 `createdAt`、origin 和 provenance。这样避免 ABA，同时保留恢复语义。
6. 应在 preflight 中检查 active unique keys 的占用；最终仍以 IndexedDB unique constraint 为准。任何 constraint 或关系完整性失败都回滚全部撤回并标为 conflict。
7. 成功后写 immutable `command.undo` activity、保存 undo result，将 run 置为 `undone`。再次点击或网络重试必须幂等返回同一结果。

允许撤回非最新命令，但仅当它涉及的每条记录仍与该命令 after snapshot 完全一致；后续只修改无关记录不会阻断。若希望撤回后支持 redo，需要另建“撤回本身”的 journal，不能简单交换 before/after，因为 revision 已单调前进；本任务可先明确不支持 redo。

### 5. 高影响完整恢复点阈值

以下类型无条件在 mutation 前创建并持久化完整 16 表 checkpoint：

- backup restore / 全库替换；
- permanent purge；
- `deleteSampleBatch` 或任何批次物理删除；
- 写集合未知、动态或无法证明完整的 capability；
- integrity repair / future migration repair；
- 用户明确要求“覆盖、清空、重建、全部删除”的命令。

其余命令满足任一条件也升级为 full-backup：预估影响记录数 `>= 50`、预估 before snapshot `>= 512 KiB`、涉及 `>= 4` 张业务表、导入有效行 `>= 25`。阈值应集中配置并可测试，不由 LLM 自行决定。

关键不变量：是否需要 full-backup 必须在第一笔业务写入前确定。若 impact estimator 返回 unknown，就保守创建完整 checkpoint；不能在写完后发现超过阈值再补“恢复前备份”。

完整 checkpoint 是灾难恢复后盾，不应在已有后续业务写入时直接全库覆盖来实现普通撤回；普通整命令撤回仍优先使用 row journal。只有当前 epoch 内不存在后续 command，或用户在明确预览下选择“恢复整个数据库到该时间点”，才可应用 checkpoint。

特别处理 restore：把现有 `replaceAllTables` 扩展为在同一个 all-domain+recovery transaction 内，将已生成的 `preRestoreBackup` 写入 `RecoveryCheckpoint`，然后才清空/写入 16 表。UI 下载只是额外导出，不再是唯一持久化保障。

### 6. 并发、多标签页与幂等

- IndexedDB/Dexie 事务是最终互斥边界；`BroadcastChannel` 只用于通知其他标签页刷新 run/undo 状态，不能作为锁。
- 每个标签页生成 session `clientId` 供审计。可选用 `navigator.locks` 改善高影响命令 UX，但不能依赖它保证正确性，因为浏览器/worker 支持与崩溃恢复不同。
- operationId/requestKey/undoOperationId 都必须唯一并绑定 inputHash。相同 ID 不同参数返回 `invalid-state`，不能回放旧结果。
- run 状态变化必须在事务中 compare-and-set；`running` run 带 heartbeat/startedAt。页面崩溃后的孤儿 run 启动时进入恢复扫描：没有 committed segment 则标 failed；有 segment 则根据 journal 自动补偿或提示恢复，绝不直接重跑未知写操作。
- journal 写入与业务写入同事务，因此不会出现“业务成功、diff 丢失”或“diff 存在、业务失败”。跨 segment saga 只能保证可补偿，不宣称物理原子。
- 当前 service 层 revision 检查继续保留；journal hash 是更强的撤回时 compare-and-swap。两者不可相互替代。

### 7. 持久化隔离、保留与安全

- Recovery tables 与 16 表同库、逻辑隔离；明确排除于 `BACKUP_TABLE_NAMES`、普通 CSV/JSON export、sample/import 批次删除、业务 integrity counts。
- 新增不随业务 restore 回滚的 `recoveryMeta`（或 CommandRun 全局元记录），至少含 `databaseEpoch`。每次全库 restore 成功时原子递增 epoch；恢复来源的 `appSettings.databaseInstanceId` 可改变，但不覆盖 recovery epoch。
- journal/checkpoint 包含完整实验数据，敏感级别与业务数据库相同。不得写入 API key、provider headers、模型原始 prompt 或无关对话；Agent 摘要只保存必要引用。
- 提供“清除恢复历史”操作，但不得删除 running/undoing run。建议默认保留：成功未撤回 run 最近 100 条或 30 天、已撤回 7 天、完整 checkpoint 最近 5 个且总计不超过 50 MiB；触限先清最老 terminal entries。
- 高影响动作若无法腾出 checkpoint 空间必须阻断。普通 row journal 若 quota 写失败也随业务事务回滚并报告“未执行”。
- 每个 journal/change/checkpoint 加 schemaVersion 和 canonical checksum。读取时先验证结构与 hash；损坏时禁用撤回并提供 checkpoint/手工导出路径，绝不能盲写。

## 建议测试矩阵

### A. Row journal 正确性

- 单表 create/update/soft-delete/restore 的 before/after/kind/hash。
- 可选字段从有值到删除、嵌套 payload、数组顺序、Unicode canonical hash。
- 移笼：旧 assignment 结束、新 assignment/event 创建、mouse.currentCageId 更新全部入 journal。
- 体重：event 与 weight pair 同时创建、软删、恢复。
- terminate mouse、litter + offspring、实验分组/加入/退出等多表 cascade 无遗漏。
- activityLogs 不被反向删除；undo 产生独立审计记录。
- service 或 journal 故障注入时，业务与 journal 全部回滚。

### B. 整命令与 saga

- compound capability 仅生成一个 segment，子 operationId 仍可幂等回放。
- 多 segment 命令正常完成后一次撤回，所有 segment 逆序恢复。
- 第 N 段失败时自动补偿 1..N-1；补偿冲突时报告精确 partial effects。
- CSV 含 imported/skipped/failed 行：一次撤回只逆转成功行，并正确处理跨行共享标签、父子引用与分笼。
- 批量状态、批量转笼、批量标签中途异常不留下半个 segment。

### C. 冲突与 revision

- 命令后同标签页/另一标签页修改同一记录，撤回全量拒绝且无部分写入。
- 后续只改无关记录，旧命令仍可撤回。
- create 后记录被删、delete 后同 ID 被重建、update 后字段被改，均检测 hash conflict。
- active earTag/cage/tag/experiment unique key 被另一记录占用时撤回回滚。
- 撤回后 revision 严格大于 before 与 after，旧表单 revision 不能通过（ABA 回归测试）。
- 两标签页同时撤回：仅一个提交，另一个幂等得到既存结果。

### D. 幂等与崩溃恢复

- 相同 requestKey/inputHash 重试不重复 run；相同 operationId 不同输入拒绝。
- mutation 响应丢失后重试返回同一 segment result，不重复写业务/journal。
- undo 响应丢失后重试返回同一 undo result。
- 页面在 segment commit 后、run finalize 前崩溃；重启扫描能确定补偿/待恢复状态。
- running 无 segment、running 有已提交 segment、undoing 中断三种孤儿状态。

### E. 完整 checkpoint / 破坏性操作

- permanent purge、sample batch delete、restore、超过每个阈值与 unknown impact 都在写前持久化 checkpoint。
- checkpoint 写入/quota/checksum 失败时业务零写入。
- restore 事务提交后立即模拟页面崩溃，pre-restore checkpoint 仍可读取；浏览器下载失败不影响持久恢复点。
- permanent mouse purge 的 events/weights/assignments/tasks 全部存在于 diff/checkpoint，恢复关系完整。
- full checkpoint 普通导出不包含 recovery tables，不产生递归膨胀。
- restore 后 epoch 增加，旧 journal 普通撤回被拒；pre-restore checkpoint 仍可显式整库恢复。

### F. 多标签页、存储与迁移

- 两个 Dexie 实例并发修改相同/不同记录；事务串行与 hash conflict 行为确定。
- 数据库 versionchange/blocked 时进行中的 run 安全失败，旧标签页不会继续写。
- schema v1 到含 recovery tables 的新版本迁移不改 16 表数据；恢复表空初始化。
- journal JSON 损坏、hash 不匹配、未知 journal schemaVersion 均 fail closed。
- retention 不清理 running/undoing 或其依赖 checkpoint；清理 run 与 changes/checkpoint 原子完成。
- 接近 quota、超大批次、100+ command history 的性能与空间回收测试。

## 实施优先级

1. 先建立显式 `DOMAIN_TABLE_NAMES` / `RECOVERY_TABLE_NAMES`、数据库 epoch 与 journal schema；迁移测试先行。
2. 实现 `CommandRecoveryCoordinator`，先覆盖一个单表 update、一个多表 compound、一个 soft-delete；验证 journal 与业务同事务。
3. 实现全量 preflight + hash conflict + 单调 revision 的整 run undo；接入 immutable undo audit 与 UI 结果。
4. 将所有 Registry mutation 逐项迁移到 Coordinator，并做 descriptor writes 集合与实际 diff 的一致性测试。
5. 接入 full checkpoint 策略，优先修复 restore 的内存/下载 crash gap，然后覆盖 purge、sample delete、批量/import。
6. 最后加入跨标签页、崩溃恢复、retention/quota 与性能测试；在这些测试完成前，不应宣称破坏性 Agent 命令“可一键可靠撤回”。

## 未检查项

- 未运行浏览器进行真实双标签页竞争或崩溃注入；本结论来自 Dexie 边界和现有测试代码。
- 未测量真实数据规模下全表 before snapshot、canonical hash、完整 checkpoint 的耗时/内存/IndexedDB quota，阈值是保守初值，需基准测试校准。
- 未核对尚未完成的 Agent orchestrator/provider/tool-loop 实现，因此无法确认它最终如何划分 `commandRunId`、重试与跨 tool-round saga。
- 未检查 PWA service worker 在升级期间对旧 bundle/新数据库 schema 并存的具体行为。
- 未设计面向用户的冲突 diff、checkpoint 时间点恢复确认 UI，只给出数据与事务约束。
- 未执行测试；此任务是只读架构审查，不是实现验证。
