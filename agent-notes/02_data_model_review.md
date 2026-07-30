# MouseKeeper 数据模型与本地数据架构审查

> 角色：IndexedDB、Dexie 与本地优先应用数据架构师  
> 报告性质：绿地设计审查／实现约束，不是已实现功能的验收  
> 审查日期：2026-07-30

## 1. 审查范围与证据

### 1.1 审查范围

- MouseKeeper 的核心实体、字段、关联和数据所有权。
- Dexie/IndexedDB 表、主键、唯一键、查询索引和版本策略。
- 创建、编辑、转笼、繁育、实验、事件、体重、删除、导入、恢复等写操作的事务边界。
- 软删除、历史保留、引用完整性、重复提交、多标签页并发、迁移及损坏恢复。
- 完整 JSON 备份、CSV 部分导入和示例数据清理的数据安全约束。
- 面向至少 5,000 只小鼠、1,000 个笼位、50,000 条事件、20,000 条体重记录的查询设计。

不在本报告范围：页面布局、视觉设计、路由、远程同步、登录权限、复杂统计、云备份。

### 1.2 实际读取的文件

- `/Users/eros/.codex/attachments/134715d2-1503-4765-9ffc-df6aa043dca2/pasted-text.txt`，完整读取 1–2320 行。

没有读取或依赖其他子代理报告，避免循环引用结论。

### 1.3 工作区事实

- 审查时 `/Users/eros/Documents/EasyMouse` 尚无应用源代码、`package.json`、Dexie schema、migration 或测试；可见业务文件为零。
- 审查时该目录不是 Git 仓库。此事实仅用于说明当前结论是设计基线，不能视为代码实现审查。
- 需求明确要求 JSON 完整备份和逐行隔离的 CSV 导入（附件 500–546 行）。
- 需求列出的实体位于附件 550–569 行。该清单实际为 **16 个实体**，不是 15 个；本报告全部覆盖。
- 需求明确要求版本、迁移、软删除、引用完整性、失败恢复、并发重复提交和示例数据区分（附件 571–604 行）。
- 需求明确指出不能把 IndexedDB 当作具有传统外键约束的关系数据库，引用完整性必须由应用服务层实现（附件 602–604 行）。

## 2. 必须先固定的存储约定

### 2.1 三种版本不可混为一谈

| 名称 | 示例 | 用途 |
|---|---:|---|
| `DB_VERSION` | `1` | Dexie `db.version(n)` 的物理数据库版本 |
| `backupFormatVersion` | `1` | 备份外层信封格式；决定如何解析文件 |
| `schemaVersion` | `1` | 记录／备份业务结构版本；决定字段迁移 |
| `revision` | `1, 2, 3...` | 单条记录乐观并发版本；每次更新递增 |

不能拿 `revision` 判断 migration，也不能仅凭 `appVersion` 判断备份兼容性。

### 2.2 ID、日期和时间

- 所有实体主键都是应用生成的不可变字符串 ID，优先使用 `crypto.randomUUID()`；业务编号不能作为主键。
- `createdAt`、`updatedAt`、`deletedAt`、`occurredAt` 使用带 `Z` 的 UTC ISO-8601 instant，例如 `2026-07-30T08:15:30.123Z`。
- 生日、实验开始日、窝出生日期等“日历日期”使用严格校验的 `YYYY-MM-DD`，不能用宽松的 `Date.parse`。
- 用户输入的事件日期与时间另存 `occurredOn: YYYY-MM-DD`、`occurredTime?: HH:mm`、`timeZone`，同时计算 `occurredAt` 供排序；这样在时区变化后仍可还原原始输入语义。
- 年龄和周龄是从 `birthDate` 与当前本地日历日计算的派生值，不落库，避免每天产生过期数据。
- 金额之外的数值也不应依赖格式化字符串。体重保存原单位和标准化 `valueGrams`。

### 2.3 公共基类

所有 16 个实体都应具有或继承下列字段；对系统单例仍保留相同审计语义：

```ts
type IsoInstant = string;
type LocalDate = string;
type LocalTime = string;
type JsonValue =
  | null | boolean | number | string
  | JsonValue[] | { [key: string]: JsonValue };

interface StoredEntity {
  id: string;
  schemaVersion: number;
  revision: number;
  createdAt: IsoInstant;
  updatedAt: IsoInstant;
  deletedAt: IsoInstant | null;
  deletedFlag: 0 | 1;
  origin: "user" | "sample" | "import" | "system";
  sampleBatchId?: string;
  importBatchId?: string;
  custom?: Record<string, JsonValue>;
}
```

约束：

- `deletedAt === null` 当且仅当 `deletedFlag === 0`。`deletedFlag` 是索引辅助字段。
- 不使用布尔值或 `null` 作为 IndexedDB 索引键；它们不是有效 IndexedDB key。可选唯一索引字段在“不参与索引”时必须完全省略／设为 `undefined`，不能设为 `null`。
- `custom` 必须由 Zod 限定 JSON 类型、最大深度、键数量和序列化大小；不能保存函数、DOM、Blob 任意对象或循环引用。
- `origin` 和批次 ID 必须传播到示例数据产生的所有关联记录，不能只标记 Mouse。

### 2.4 规范化与“仅活动记录唯一”

显示值与唯一比较值分离。例如耳标原文保存在 `earTag`，比较值按以下固定算法生成：

1. Unicode NFKC；
2. 去除首尾空白；
3. 连续空白折叠为一个空格；
4. 大小写不敏感字段转为 locale-independent lower case；
5. 空字符串视为缺失。

软删除后仍保留原字段，因此不能直接给 `earTag` 建永久唯一索引。使用可选辅助键：

```ts
activeEarTagKey?: string; // 活动且耳标非空时为 `ear:${normalizedEarTag}`
activeCageNumberKey?: string;
activeMouseKey?: string;  // 当前 CageAssignment 才存在，值为 mouseId
```

删除时移除辅助键，恢复时在同一事务内重新计算；若已有新活动记录占用相同键，恢复必须报冲突，不能覆盖。

## 3. 16 个实体的建议字段

以下字段均在公共基类字段之外。

### 3.1 Mouse

- `earTag?`、`normalizedEarTag?`、`activeEarTagKey?`
- `experimentNumber?`、`normalizedExperimentNumber?`
- `name?`／`alias?`、`normalizedAlias?`
- `strain`、`strainKey`、`genotype?`、`genotypeKey?`
- `sex: "male" | "female" | "unknown" | "intersex" | "other"`
- `birthDate?`
- `sireId?`、`damId?`：自关联父本／母本
- `litterId?`
- `currentCageId?`：查询投影，不是笼位关系的唯一事实来源
- `status: "alive" | "experimental" | "breeding" | "reserved" | "transferred" | "dead" | "euthanized" | "other"`
- `source?`、`coatColor?`、`notes?`
- `tagIds: string[]`
- `searchTerms: string[]`：受长度上限约束的派生搜索词

不在 Mouse 中保存：

- `age`、`ageWeeks`，二者实时计算。
- “当前实验组”单值，因为一只小鼠可参与多个实验；通过 `ExperimentAssignment` 查询。
- 完整笼位历史数组；通过 `CageAssignment` 查询。

`currentCageId` 只是加速列表的投影，权威来源是唯一活动 `CageAssignment`。任何转笼都必须在同一事务内同步二者；完整性扫描以 assignment 修复投影，不能反向凭投影制造 assignment。

### 3.2 Cage

- `cageNumber`、`normalizedCageNumber`、`activeCageNumberKey?`
- `room?`、`roomKey?`、`rack?`、`rackKey?`
- `maxCapacity: number`
- `primaryStrain?`：可由当前成员计算，也可作为人工备注值；UI 必须标明来源
- `purpose?`
- `status: "active" | "inactive" | "cleaning" | "retired" | "other"`
- `notes?`

当前小鼠和当前容量不保存为 ID 数组或可修改计数；从 `CageAssignment` 的活动记录查询。可缓存统计，但缓存不能参与完整性判断。

### 3.3 CageAssignment

- `mouseId`、`cageId`
- `startedAt`
- `endedAt?`
- `activeFlag: 0 | 1`
- `activeMouseKey?: string`：活动且未删除时等于 `mouseId`，唯一索引从存储层阻止一鼠多笼
- `startReason?`、`endReason?`
- `startedEventId?`、`endedEventId?`
- `cageNumberSnapshot`、`mouseLabelSnapshot`：历史可读性快照

一条记录表达一个连续驻笼区间；转笼是关闭旧记录并新建记录，而不是改写旧 `cageId`。

### 3.4 BreedingPair

- `sireId`、`damId`
- `pairedOn`
- `separatedOn?`
- `expectedDeliveryDate?`
- `status: "planned" | "active" | "separated" | "completed" | "cancelled"`
- `activePairKey?: string`：活动组合为 `sireId + damId` 的规范键
- `notes?`
- `warningAcknowledgements?: string[]`

父母 ID 角色固定，结束后不回写为另一对父母。需要改变父母时关闭旧组合并创建新组合。

### 3.5 Litter

- `breedingPairId`
- `litterNumber`、`normalizedLitterNumber`
- `activeLitterKey?`：建议在繁育组合内唯一，而不是全局唯一
- `sireId`、`damId`：创建时从组合复制的不可变谱系快照
- `bornOn`
- `bornCount`
- `aliveCount`
- `weanedOn?`
- `notes?`

后代不存为 `offspringIds` 数组；Mouse 通过 `litterId` 指向窝，避免双向数组漂移。

### 3.6 Experiment

- `code?`、`normalizedCode?`、`activeExperimentCodeKey?`
- `name`、`normalizedName`
- `description?`
- `startDate?`、`endDate?`
- `status: "planned" | "active" | "completed" | "cancelled" | "archived"`
- `intervention?`、`dose?`、`frequency?`
- `principalInvestigator?`
- `notes?`
- `searchTerms: string[]`

结束或软删除实验不删除分组、分配和历史事件。

### 3.7 ExperimentGroup

- `experimentId`
- `name`、`normalizedName`
- `groupType: "control" | "treatment" | "custom"`
- `activeGroupNameKey?: string`：`experimentId + normalizedName`
- `exclusionSet?`：同一实验内具有同一非空值的组互斥
- `intervention?`、`dose?`、`frequency?`
- `notes?`

使用 `exclusionSet` 比简单 `isExclusive` 更可扩展：同一实验将来可有多套互斥分组维度。

### 3.8 ExperimentAssignment

- `mouseId`、`experimentId`、`groupId`
- `joinedAt`
- `exitedAt?`
- `exitReason?`
- `activeFlag: 0 | 1`
- `activeGroupMouseKey?: string`：活动时为 `groupId + mouseId`
- `activeExclusionMouseKey?: string`：组有 `exclusionSet` 时为 `experimentId + exclusionSet + mouseId`
- `joinedEventId?`、`exitedEventId?`
- 实验名、组名、小鼠标签的只读历史快照

`experimentId` 看似可由 group 得出，但保留它可以高效查询和检测 group/experiment 不一致；服务层必须验证两者匹配。

### 3.9 MouseEvent

- `eventType: "weight" | "medication" | "injection" | "surgery" | "behavior" | "sampling" | "cage-transfer" | "status-change" | "observation" | "abnormality" | "death" | "euthanasia" | "tag-change" | "experiment-join" | "experiment-exit" | "custom"`
- `occurredOn`、`occurredTime?`、`timeZone`、`occurredAt`
- `mouseId`
- `cageId?`、`experimentId?`
- `title`、`normalizedTitle`、`description?`
- `payloadVersion`
- `payload: JsonValue`：按 `eventType` 使用判别联合 Zod schema
- `sourceType?`、`sourceId?`：如 WeightRecord、CageAssignment
- 关联对象显示值的不可变快照
- `searchTerms: string[]`

`payload` 不是无校验垃圾桶。每个事件类型必须有独立版本化 schema；未知未来类型在导入时应作为不兼容处理，而不是直接断言类型。

### 3.10 WeightRecord

- `mouseId`
- `eventId`：唯一一对一关联到 `MouseEvent(type="weight")`
- `measuredOn`、`measuredTime?`、`timeZone`、`measuredAt`
- `value`、`unit: "g" | "mg"`、`valueGrams`
- `notes?`
- `anomalyAcknowledged?: boolean`

WeightRecord 是趋势计算的结构化权威数据；MouseEvent 是时间线表达。二者必须同事务创建、更新、软删除，禁止只写其中一张表。异常值只生成警告，不阻止保存。

### 3.11 Task

- `title`
- `dueDate`
- `dueTime?`
- `dueSortKey`：`YYYY-MM-DDTHH:mm`，无时间时按当天结束计算
- `mouseId?`、`cageId?`、`experimentId?`
- `priority: "low" | "normal" | "high" | "urgent"`
- `status: "pending" | "completed" | "cancelled"`
- `notes?`
- `completedAt?`

关联均可选；关联对象软删除后任务仍保留并显示“关联对象已删除”。

### 3.12 Tag

- `name`、`normalizedName`
- `activeNameKey?: string`
- `color?`
- `description?`

Mouse 侧的 `tagIds` 是当前关联集合，并用 multiEntry 索引查询。删除 Tag 时必须在一个事务中从所有活动 Mouse 移除并生成标签变化事件；不应留下无法显示的当前 tag ID。

### 3.13 ActivityLog

- `operationId`：唯一；也是幂等命令键
- `occurredAt`
- `action`
- `primaryEntityType`、`primaryEntityId`、`primaryEntityKey`
- `entityRefKeys: string[]`
- `summary`
- `changedFields?: string[]`
- `warningAcknowledgements?: string[]`
- `metadata?: JsonValue`

ActivityLog 每个用户命令一条，原则上追加后不可编辑。不要把整份长备注的 before/after 副本写入日志，避免隐私和存储膨胀。业务时间线使用 MouseEvent；审计使用 ActivityLog，两者职责不同。

### 3.14 SavedView

- `scope: "mice" | "cages" | "experiments" | "events" | "tasks"`
- `name`、`normalizedName`
- `activeScopeNameKey?: string`
- `queryVersion`
- `filters: JsonValue`
- `sort: JsonValue`
- `columns?: JsonValue`
- `lastUsedAt?`

过滤结构必须按 `queryVersion` 校验／迁移；不能反序列化为可执行函数。

### 3.15 AppSettings

- 固定 `id: "app-settings"`
- `appName`
- `locale`
- `timeZone`
- `weekStartsOn`
- `capacityWarningPercent`
- `weightAnomalyPercent`
- `notificationPreferences`
- `lastIntegrityCheckAt?`
- `databaseInstanceId`

主题和纯 UI 表格偏好可留在 localStorage；业务阈值、时区和需要进入备份的设置应在本表。关键业务数据不得在 localStorage 保存，符合附件 125–134 行。

### 3.16 BackupMetadata

- `backupId`
- `kind: "export" | "pre-restore" | "restore" | "salvage"`
- `status: "started" | "succeeded" | "failed"`
- `backupFormatVersion`
- `backupSchemaVersion`
- `appVersion`
- `exportedAt`
- `fileName?`
- `checksum?`
- `tableCounts?`
- `sourceDatabaseInstanceId?`
- `errorCode?`、`errorSummary?`

本表只记录操作元数据，不在主数据库内长期保存完整备份 Blob；否则既消耗配额，也无法抵御该数据库被清除。

## 4. 关联与权威来源

| 关联 | 基数 | 权威来源 | 删除后的处理 |
|---|---|---|---|
| Mouse → sire/dam | 多对一、自关联 | `Mouse.sireId/damId` | 父母软删除后仍可解析并显示删除标记 |
| Litter → BreedingPair | 多对一 | `Litter.breedingPairId` | 保留历史；父母快照不变 |
| Mouse → Litter | 多对一 | `Mouse.litterId` | 窝软删除后保留关联 |
| Mouse ↔ Cage | 历史多对多、当前至多一 | `CageAssignment` | 当前投影由活动 assignment 推导 |
| Experiment → Group | 一对多 | `ExperimentGroup.experimentId` | 不级联删除历史 |
| Mouse ↔ Group | 历史多对多 | `ExperimentAssignment` | 退出是关闭区间，不删除 |
| Mouse → Event | 一对多 | `MouseEvent.mouseId` | Mouse 软删除后事件保留 |
| Weight → Event | 一对一 | `WeightRecord.eventId` | 同事务同生命周期 |
| Mouse ↔ Tag | 多对多 | 当前态为 `Mouse.tagIds` | 删除 Tag 时显式解除并记录事件 |
| Task → Mouse/Cage/Experiment | 可选多对一 | Task 外键字段 | 缺失时任务仍可用并显示警告 |
| ActivityLog → 任意实体 | 多对多审计引用 | `entityRefKeys` | 永不静默级联 |

**IndexedDB 不会验证以上任意关联。** Dexie schema 中的普通索引也不是外键。所有创建、更新、删除、恢复和导入必须走服务层，在同一读写事务内重新读取目标记录、确认未删除、确认 revision 和业务状态，再写入所有受影响表。

## 5. Dexie v1 schema 建议

初始发布应直接创建一个完整、可用的 v1；不要为了“看起来有迁移”制造空的 v2/v3。下面是建议基线，具体属性名应在 TypeScript 类型、Zod schema 和 Dexie schema 三处保持一致。

```ts
db.version(1).stores({
  mice:
    "id,&activeEarTagKey,normalizedEarTag,normalizedExperimentNumber," +
    "normalizedAlias,strainKey,genotypeKey,sex,status,birthDate,sireId,damId," +
    "litterId,currentCageId,*tagIds,updatedAt,[deletedFlag+status]," +
    "[deletedFlag+currentCageId],[deletedFlag+updatedAt],origin,sampleBatchId," +
    "importBatchId,*searchTerms",

  cages:
    "id,&activeCageNumberKey,normalizedCageNumber,roomKey,rackKey,status,updatedAt," +
    "[deletedFlag+status],[deletedFlag+updatedAt],origin,sampleBatchId,importBatchId",

  cageAssignments:
    "id,&activeMouseKey,mouseId,cageId,startedAt,endedAt,activeFlag," +
    "[mouseId+startedAt],[cageId+activeFlag],[cageId+startedAt]," +
    "[deletedFlag+updatedAt],origin,sampleBatchId,importBatchId",

  breedingPairs:
    "id,&activePairKey,sireId,damId,status,pairedOn,separatedOn," +
    "[sireId+status],[damId+status],[deletedFlag+status],origin,sampleBatchId,importBatchId",

  litters:
    "id,&activeLitterKey,breedingPairId,sireId,damId,bornOn,weanedOn," +
    "[breedingPairId+bornOn],[deletedFlag+bornOn],origin,sampleBatchId,importBatchId",

  experiments:
    "id,&activeExperimentCodeKey,normalizedCode,normalizedName,status,startDate,endDate," +
    "updatedAt,[deletedFlag+status],[deletedFlag+updatedAt],origin,sampleBatchId," +
    "importBatchId,*searchTerms",

  experimentGroups:
    "id,&activeGroupNameKey,experimentId,groupType,exclusionSet," +
    "[experimentId+deletedFlag],origin,sampleBatchId,importBatchId",

  experimentAssignments:
    "id,&activeGroupMouseKey,&activeExclusionMouseKey,mouseId,experimentId,groupId," +
    "joinedAt,exitedAt,activeFlag,[mouseId+joinedAt],[experimentId+activeFlag]," +
    "[groupId+activeFlag],origin,sampleBatchId,importBatchId",

  mouseEvents:
    "id,mouseId,cageId,experimentId,eventType,occurredAt,occurredOn,updatedAt," +
    "[mouseId+occurredAt],[cageId+occurredAt],[experimentId+occurredAt]," +
    "[deletedFlag+occurredAt],origin,sampleBatchId,importBatchId,*searchTerms",

  weightRecords:
    "id,&eventId,mouseId,measuredAt,[mouseId+measuredAt]," +
    "[deletedFlag+measuredAt],origin,sampleBatchId,importBatchId",

  tasks:
    "id,status,priority,dueSortKey,mouseId,cageId,experimentId,updatedAt," +
    "[deletedFlag+status+dueSortKey],[mouseId+status],[cageId+status]," +
    "[experimentId+status],origin,sampleBatchId,importBatchId",

  tags:
    "id,&activeNameKey,normalizedName,updatedAt,[deletedFlag+normalizedName]," +
    "origin,sampleBatchId,importBatchId",

  activityLogs:
    "id,&operationId,occurredAt,action,primaryEntityKey,*entityRefKeys," +
    "[deletedFlag+occurredAt],origin,sampleBatchId,importBatchId",

  savedViews:
    "id,&activeScopeNameKey,scope,lastUsedAt,updatedAt,[deletedFlag+scope],origin",

  appSettings:
    "id,updatedAt,schemaVersion",

  backupMetadata:
    "id,backupId,kind,status,exportedAt,backupSchemaVersion,checksum,createdAt,origin"
});
```

### 5.1 索引取舍

- 所有列表必须先用索引缩小候选集，再在内存做二次过滤；不能为每个表格列都建索引。
- `*searchTerms` 是有上限的派生 multiEntry 索引，适合编号、名称、品系、基因型、标签和事件标题。长备注可生成有限 token，但不能为全文生成无限中文二元组。
- 备注子串搜索若仍需覆盖全部 50,000 事件，应在性能验证后增加可重建的 `searchDocuments` 派生表；它不是业务事实，不进入备份。MVP 不应每次按键全表扫描所有事件。
- 稳定分页使用索引值加 ID 作为游标。若实测需要严格同时间排序，可在后续版本增加 `[updatedAt+id]`、`[occurredAt+id]` 复合索引。
- `CageAssignment.activeMouseKey`、`ExperimentAssignment` 的两个 active key 是存储级最后防线，但不替代服务层状态、日期和引用检查。

## 6. 服务层约束

### 6.1 唯一写入口

React 组件、hooks 和页面不得直接调用 `db.table.put/update/delete`。建议调用命令式服务，例如：

- `createMouse(command)`
- `updateMouse(command, expectedRevision)`
- `moveMouse(command)`
- `changeMouseStatus(command)`
- `createBreedingPair(command)`
- `createLitterWithOffspring(command)`
- `assignMouseToExperiment(command)`
- `recordWeight(command)`
- `softDeleteMouse(command)`
- `restoreBackup(command)`

每个命令包含由 UI 首次提交时生成且重试不变的 `operationId`。事务先查 ActivityLog，重复 `operationId` 返回第一次结果；并用 `&operationId` 兜底。按钮禁用和 debounce 只改善体验，不是数据安全机制。

编辑命令携带 `expectedRevision`。事务读到不同 revision 时返回冲突，让用户选择刷新或有意识覆盖，不能静默 last-write-wins。

### 6.2 阻止、警告和确认

**必须阻止：**

- 主键重复、活动耳标重复、活动笼位编号重复。
- 已删除笼位接收小鼠。
- 一只小鼠存在第二条活动 CageAssignment。
- 子代等于自己的父／母；父母图出现循环。
- 子代出生日期早于任一已知父母出生日期。
- 同一小鼠重复加入同一实验组。
- `group.experimentId !== assignment.experimentId`。
- 同一 `exclusionSet` 出现第二条活动 assignment。
- 无法解析的枚举、非法日历日期、非有限数值、非正体重。
- 恢复文件主键重复、结构不完整、未来 schema、校验和不符或必要引用缺失。

**允许在明确确认后继续，并记录确认代码：**

- 笼位达到／超过容量；需求只要求明确警告，不能静默，也不宜绝对阻止。
- 父本非雄性、母本非雌性。
- 已死亡、安乐死或已转出小鼠被用于新繁育组合。
- 已死亡、安乐死或已转出小鼠被加入进行中实验。
- 与历史繁育组合重复但当前没有相同活动组合。
- 体重相对前值异常。

服务第一次返回结构化 `warningCodes`；UI 二次提交同一个 operationId 和 acknowledgements。事务必须再次读取现状；若容量或 revision 已改变，旧确认失效并重新提示。

### 6.3 谱系校验

- 在覆盖 `mice` 表的同一 read-write 事务内，从候选父母向祖先遍历，使用 `visited` 集合阻止环。
- 设置合理的安全上限只用于识别已有损坏，不能把“超过深度”当作无环；超过上限应报 integrity error。
- 父／母缺失、已软删除、未知性别是不同状态，UI 不得都显示为空。
- 同窝批量创建先在内存构造所有子代，再整体校验 ID、耳标和日期，最后一个事务写入 Litter、Mouse、事件和日志。

### 6.4 状态变化

- 设为 `dead` 或 `euthanized` 时，在同事务中关闭活动 CageAssignment、活动 ExperimentAssignment 和相关活动 BreedingPair，创建相应 MouseEvent 与一条 ActivityLog。
- 设为 `transferred` 时至少关闭活动笼位和实验分配；若产品允许例外，必须显式确认并记录。
- 不通过普通编辑表单直接修改 `currentCageId`、父母关系或终结状态；这些必须走专用命令。

## 7. 事务边界矩阵

下表中的表必须由一个 Dexie `rw` 事务覆盖。事务内只等待 Dexie/IndexedDB promise；Zod 解析、CSV 解析、文件下载、`crypto.subtle.digest` 和网络操作必须在事务外完成。

| 操作 | 同一事务涉及的表 | 原子性要求 |
|---|---|---|
| 新建／普通编辑 Mouse | `mice`, `activityLogs`，重要变更另含 `mouseEvents` | revision、唯一键、日志一起成功 |
| 转笼 | `mice`, `cages`, `cageAssignments`, `mouseEvents`, `activityLogs` | 重查目标笼位、容量；关闭旧 assignment、新建新 assignment、更新投影、写事件 |
| 终结状态 | `mice`, `cageAssignments`, `experimentAssignments`, `breedingPairs`, `mouseEvents`, `activityLogs` | 不允许出现“已死亡但仍活动驻笼”中间态 |
| 新建繁育组合 | `mice`, `breedingPairs`, `activityLogs` | 性别／状态／重复组合在写前重查 |
| 新建窝及批量后代 | `breedingPairs`, `litters`, `mice`, `mouseEvents`, `activityLogs`，可选 `cages`, `cageAssignments` | 一窝创建整体成功或整体回滚 |
| 加入／退出实验 | `mice`, `experiments`, `experimentGroups`, `experimentAssignments`, `mouseEvents`, `activityLogs` | 组归属、互斥、状态、事件一致 |
| 记录／编辑／删除体重 | `mice`, `weightRecords`, `mouseEvents`, `activityLogs` | 结构化记录和时间线一对一 |
| 完成／恢复 Task | `tasks`, `activityLogs` | status 与 completedAt 一致 |
| 添加／移除 Tag | `tags`, `mice`, `mouseEvents`, `activityLogs` | Tag 存在且活动，批量修改不留半成品 |
| 软删除 Mouse | `mice`, 活动关系表, `mouseEvents`, `activityLogs` | 关闭当前关系但保留全部历史 |
| 软删除 Cage | `cages`, `cageAssignments`, `activityLogs` | 有活动小鼠则整个操作失败 |
| 软删除 Experiment | `experiments`, `experimentAssignments`, `activityLogs` | 活动实验先结束／退出；不删除历史事件 |
| CSV 单行落库 | 该行涉及的所有业务表及 `activityLogs` | 一行成功或一行回滚；其他行不受影响 |
| 完整恢复 | **全部 16 张表** | 清空与 bulkAdd 必须在同一个数据库级事务 |
| 删除示例数据 | 所有可能含该 `sampleBatchId` 的表 | 先检查与真实数据的混合引用，再整体删除／拒绝 |

容量并发检查必须和 assignment 写入处在同一个事务。仅在事务外先数一次笼内小鼠，无法防止两个标签页同时越过容量。

## 8. 软删除、恢复与永久删除

### 8.1 通用软删除

- 软删除设置 `deletedAt`、`deletedFlag = 1`、递增 revision、移除所有 `active*Key`，保留原字段。
- 恢复先重新验证所有当前约束，再设置活动键。冲突时保持在回收站并给出具体占用记录。
- 普通查询必须默认 `deletedFlag = 0`；回收站显式查询删除记录。
- ActivityLog 默认不允许由普通 UI 删除；MouseEvent、WeightRecord 可软删除但保留审计日志。

### 8.2 按实体的引用动作

| 删除对象 | 规则 |
|---|---|
| Cage | 有活动 CageAssignment 时阻止；清空后可软删除。历史 assignment 和事件继续引用该 Cage。 |
| Experiment | 进行中时先要求结束或显式退出成员；软删除后 Group、Assignment、Event 均保留。禁止静默级联。 |
| Mouse | 软删除时关闭当前驻笼／实验／繁育关系并生成事件；父母、后代、窝、历史实验、体重和事件引用保留。 |
| Tag | 在同一事务从当前 Mouse 中移除，生成 tag-change 事件后软删除 Tag。 |
| ExperimentGroup | 有活动 assignment 时阻止；历史 assignment 保留。 |
| Litter/BreedingPair | 有历史后代时只允许软删除／归档，不能破坏谱系。 |

### 8.3 永久删除

二次确认只是 UX 条件，不足以保证引用完整性。永久删除必须先执行 inbound-reference 检查：

- 没有任何当前或历史引用时才允许 hard delete。
- 有历史引用时默认阻止；若产品必须“永久清除个人记录”，应保留最小 tombstone，而不是级联抹掉实验历史。
- “一键删除示例数据”是特例：只允许删除同一 `sampleBatchId` 的闭合子图。任何真实记录引用示例记录，或示例记录引用真实记录时，先展示混合引用并阻止自动清除。

## 9. 备份格式与完整恢复

### 9.1 JSON 信封

```json
{
  "format": "mousekeeper-backup",
  "backupFormatVersion": 1,
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "backupId": "uuid",
  "databaseInstanceId": "uuid",
  "exportedAt": "2026-07-30T08:15:30.123Z",
  "tableCounts": {
    "mice": 0,
    "cages": 0
  },
  "integrity": {
    "algorithm": "SHA-256",
    "canonicalPayloadDigest": "hex"
  },
  "data": {
    "mice": [],
    "cages": [],
    "cageAssignments": [],
    "breedingPairs": [],
    "litters": [],
    "experiments": [],
    "experimentGroups": [],
    "experimentAssignments": [],
    "mouseEvents": [],
    "weightRecords": [],
    "tasks": [],
    "tags": [],
    "activityLogs": [],
    "savedViews": [],
    "appSettings": [],
    "backupMetadata": []
  }
}
```

- 16 个 table key 即使为空也必须存在，避免把“不完整导出”误判为空数据库。
- checksum 覆盖稳定 canonical JSON 的 `data` 与关键 manifest 字段；它检测意外损坏，不提供真实性或加密保证。
- 不导出可重建的搜索派生表。`active*Key`、`deletedFlag`、标准化字段可以导出用于诊断，但恢复时必须从权威字段重算，不能信任文件中的辅助值。
- 导出生成 Blob、checksum 和 table count 后，写入一条 BackupMetadata；若下载被浏览器阻止，状态不能标为 succeeded。

### 9.2 恢复流水线

1. 在事务外限制文件大小、解析 JSON、拒绝 prototype pollution 形态与非 JSON 值。
2. 校验 `format`、format version、schema version、app version 信息和 checksum。
3. 对旧版本备份在内存副本上按版本逐步迁移；未来 schema 直接拒绝。
4. 对每张表运行 Zod，检查枚举、严格日期、有限数、主键和活动唯一键。
5. 建立内存 ID map，检查所有必要引用、父母环、当前 assignment 唯一性、实验组归属、一对一 weight/event 和 table count。
6. 从当前数据库生成 `pre-restore` 备份并提供下载。浏览器下载无法百分之百证明已落盘，UI 必须如实提示；支持 File System Access API 时优先确认保存成功。
7. 用户二次确认后，在覆盖全部表的一个 `rw` 事务里 `clear` + `bulkAdd` 已验证数据，再加入本次 restore 元数据／日志。
8. 事务 abort（包括 quota）会回滚 clear，旧数据库应完整保留。不得用“先清空事务，再逐表导入事务”。
9. 提交后立即运行完整性审计；若失败，在页面仍持有 pre-restore 内存副本时自动回滚，并保留可下载的故障报告。

不要通过 `deleteDatabase()` 实现恢复，也不要在校验失败时“回退到空数据库”。

### 9.3 CSV 部分成功

- 解析、字段映射、空值、日期、枚举和文件内重复检查全部在预览阶段完成。
- 每行分配稳定 `importBatchId + rowNumber + rowDigest` operationId。
- 已验证行可按 100 行分块尝试；若 unexpected constraint 使块回滚，自动改为逐行事务，准确报告失败行。
- 一行若同时创建 Mouse、初始 CageAssignment、Tag 和事件，必须整行原子。
- 缺失父母／笼位默认作为该行错误。可提供“按未关联导入”显式选项：关系置空，原始值进入导入报告，不能偷偷生成幽灵实体。
- 导入报告至少包含成功、失败、跳过、重复、warning、行号、字段和值；导入后的批次可通过 `importBatchId` 审计。

## 10. Schema migration 与失败恢复

### 10.1 版本规则

- 只增加整数版本，不重用、不降级、不根据运行时条件分叉。
- 每个版本同时记录：旧 stores 字符串、新 stores 字符串、升级函数、fixture、预期记录数和回滚行为。
- schema 变更、数据回填、派生索引重建在同一个 Dexie upgrade transaction 中完成。
- upgrade callback 内不请求网络、不下载文件、不使用 timer、不调用 React 状态。
- 对大表只扫描受影响表，使用 Dexie collection `modify`，避免 O(n²) 关联查找。
- 每次新增可选唯一 active key 前，先扫描冲突；发现冲突应 abort migration 并给出恢复提示，不能任意保留一条。

示例后续版本：

```ts
db.version(2)
  .stores({ /* v2 的完整 stores 定义 */ })
  .upgrade(async tx => {
    await tx.table("mice").toCollection().modify(mouse => {
      mouse.schemaVersion = 2;
      mouse.deletedFlag = mouse.deletedAt ? 1 : 0;
      delete mouse.activeEarTagKey;
      if (!mouse.deletedAt && mouse.earTag?.trim()) {
        mouse.activeEarTagKey = buildActiveEarTagKey(mouse.earTag);
      }
    });
  });
```

### 10.2 多标签页与 PWA 旧版本

- 在 Dexie `versionchange` 事件中立即关闭旧连接并提示用户刷新。
- 处理 `blocked`，明确列出“请关闭其他 MouseKeeper 标签页”，不能无限 loading。
- migration 失败时 IndexedDB versionchange transaction 应回滚到旧版本；捕获错误后进入只读恢复页，绝不删除旧库。
- 新 service worker 激活和数据库升级需兼容旧标签页。不能让旧 JS 在新 schema 上继续写。
- 可使用 `navigator.locks` 为 restore/import/migration 提供跨标签页独占 UX；不支持时仍以数据库事务和唯一索引保证安全。

## 11. 缺失关联与损坏处理

读取关联必须返回三态，而不是简单 `undefined`：

```ts
type RelationResult<T> =
  | { state: "resolved"; value: T }
  | { state: "deleted"; value: T }
  | { state: "missing"; id: string };
```

处理规则：

| 情况 | 在线读取 | 完整备份恢复 | 修复策略 |
|---|---|---|---|
| Mouse.currentCageId 与活动 assignment 不符 | 标记严重警告，以 assignment 为权威 | 拒绝 | 记录 ActivityLog 后重建投影 |
| 活动 assignment 缺 Mouse/Cage | 不计入正常容量，显示损坏记录 | 拒绝 | 不自动删除；导出诊断并由用户选择关闭 |
| sire/dam 缺失 | 显示“关联记录缺失 + ID” | 拒绝完整备份；CSV 行失败或显式置空 | 保留原 ID 供取证，不静默清空 |
| Event 的历史对象缺失 | 使用 immutable snapshot 展示并标警告 | 默认拒绝；salvage 模式可保留 | 不删除事件 |
| Task 可选对象缺失 | Task 仍显示、允许完成 | 可作为 warning，前提是字段确为可选 | 用户可手动解除关联 |
| SavedView 引用已删 Tag/Cage | 标记 view 部分失效 | 允许导入但给 warning | 显式编辑后保存新 queryVersion |
| WeightRecord 与 Event 不成对 | 两处都标严重错误 | 拒绝 | 提供有审计的重建／关闭操作 |

建议提供两级完整性扫描：

- 启动快速扫描：settings 单例、schema 版本、活动唯一关系、关键 projection。
- 手动／备份前深度扫描：全部引用、谱系环、日期、枚举、helper key、weight/event、一致计数。

扫描默认只报告。只有可确定无信息损失的派生字段（规范化值、deletedFlag、currentCageId projection）才能自动修复，并且修复必须写 ActivityLog。

## 12. 严重风险与发现

### F-01 — Blocker：当前没有可审查的数据实现

- 证据：审查时工作区没有应用源代码、package、schema、migration 或测试。
- 复现：在工作区执行文件枚举，仅见系统文件和后续创建的 agent-notes。
- 影响：全部数据安全要求当前均未实现、未验证。
- 建议：以本报告为 v1 基线，由一个数据层所有者实现 schema、validation、service 和测试；完成前不得宣称持久化可用。

### F-02 — Critical：把 `Mouse.currentCageId` 当唯一事实会产生双笼或幽灵笼位

- 触发：两个标签页同时把同一 Mouse 转入不同 Cage，或只更新 Mouse 未写 assignment。
- 影响：容量、时间线和当前笼位互相矛盾。
- 建议：`&activeMouseKey` + 包含 Mouse/Assignment/Cage/Event 的事务；assignment 为权威。

### F-03 — Critical：分事务清空和恢复会不可逆丢失本地唯一数据

- 触发：先 `clear()`，随后逐表导入时遇到 quota、ConstraintError、页面关闭。
- 影响：旧数据已清、备份又未完整落库。
- 建议：完整预校验、pre-restore 下载、覆盖所有表的单一事务；任何 abort 保留旧数据。

### F-04 — High：直接唯一索引与软删除冲突

- 触发：软删除耳标 `A1` 后创建新的 `A1`，若索引是 `&normalizedEarTag` 则创建失败；若没有索引并发又可能重复。
- 建议：使用只在活动记录存在的 `&activeEarTagKey`，恢复时重新检查占用。

### F-05 — High：误用 boolean/null 索引会让查询或唯一约束静默失效

- 触发：为 `isDeleted: boolean` 或 compound 中的 `deletedAt: null` 建索引。
- 影响：IndexedDB 不把这些值作为有效 key，活动查询缺记录。
- 建议：使用数值 `deletedFlag: 0|1`；可选唯一字段不存在时使用 `undefined`。

### F-06 — High：UI 防抖不能阻止重复提交和多标签页竞争

- 触发：双击、浏览器重试、两个标签页同时提交。
- 影响：重复事件、重复转笼、重复实验 assignment。
- 建议：operationId 唯一 ActivityLog、乐观 revision、事务内重查和唯一 active key。

### F-07 — High：级联删除会破坏科研历史

- 触发：删除 Mouse、Cage 或 Experiment 时级联删除 Event/Weight/Assignment。
- 影响：谱系、转笼、实验和时间线不可追溯。
- 建议：默认软删除父记录、保留历史边；有 inbound 引用时阻止 hard delete。

### F-08 — High：WeightRecord 与 MouseEvent 双写可能漂移

- 触发：先写体重后写事件时第二次写失败，或只删除其中之一。
- 建议：`&eventId` 一对一唯一索引并在所有生命周期操作中同事务写两表。

### F-09 — High：migration 被旧标签页阻塞或失败后误清库

- 触发：PWA 旧版本仍开着，新版本升级；upgrade 冲突后 catch 中调用 deleteDatabase。
- 建议：versionchange 主动 close、blocked 指引、upgrade 原子回滚、失败进入只读恢复页。

### F-10 — High：本地优先不等于有备份

- 触发：用户清理站点数据、浏览器 profile 损坏、磁盘故障或卸载 PWA。
- 影响：IndexedDB 数据全部消失，service worker 不能恢复。
- 建议：首次引导说明风险、定期提醒导出、展示最近成功备份时间、尝试 `navigator.storage.persist()` 并报告真实结果。

### F-11 — Medium：无界全文 token 会造成索引和备份膨胀

- 触发：对 50,000 条事件的长备注生成全部中文 n-gram。
- 建议：限制派生词，先索引结构化字段；需要全文搜索时使用可重建的独立搜索表并做性能测试。

### F-12 — Medium：日期瞬间与日历日期混用导致年龄、到期和事件错日

- 触发：把 `YYYY-MM-DD` 转 UTC midnight 后跨时区显示。
- 建议：Date-only 保持字符串并严格日历校验；只有需要时序的事件保存 instant + 原始本地日期／时区。

## 13. 建议测试

### 13.1 单元／服务集成测试

- 严格日期：闰年 2 月 29 日、无效月日、未来生日、父母与子代同日／早于。
- 年龄和周龄：生日当天、跨年、时区边界。
- 规范化：全角字符、大小写、前后空白、内部重复空白、空耳标。
- 活动唯一：耳标、笼位编号、活动 CageAssignment、组内 assignment、互斥组 assignment。
- 软删除后重用唯一值；恢复时占用冲突；恢复成功时 active key 正确。
- revision 冲突和相同 operationId 重试；第二次调用不生成重复事件。
- 转笼任一步抛错后 Mouse、旧 assignment、新 assignment、Event、Log 全部保持原状。
- 两个并发转笼命令至多一个成功。
- 容量刚好、超过容量、确认后并发变化导致重新警告。
- 父母性别 warning、死鼠 warning、自我父母、二节点和多节点谱系环。
- 同窝批量创建任一 ID／耳标冲突时整窝回滚。
- ExperimentGroup 与 Experiment 不匹配、同组重复、exclusionSet 冲突。
- Weight/Event 创建、更新、软删除任一步失败均不漂移。
- 终结状态关闭当前 assignment 和活动关系并保留历史。
- Cage 有活动小鼠时删除失败；Experiment 删除不删除事件。
- Tag 删除从 Mouse 移除并生成事件；中途失败整体回滚。
- 示例批次闭合删除；混合引用时拒绝。

推荐用 Vitest + `fake-indexeddb` 做确定性单元测试，但不能只依赖 fake-indexeddb 验证真实浏览器锁和升级行为。

### 13.2 Migration fixture

- 每个已发布 DB version 保存一份真实 shape fixture，逐版本升级到 current。
- migration 前后主键集合、表计数、业务字段和引用相等。
- 回填 active key 时发现重复应 abort，旧版本数据仍可读。
- 人工在 upgrade 中抛错，确认 version 未提升且无部分回填。
- 缺字段、未知旧枚举、超大事件表、已软删除记录均有 fixture。
- 旧标签页占用时显示 blocked；关闭后继续；旧页收到 versionchange 后不再写。

### 13.3 备份／恢复

- 空库和最大目标数据量 round-trip；除新 restore 日志外语义等价。
- 截断 JSON、错误 checksum、缺 table key、错误 count、重复 PK、未来 format/schema、非法日期／枚举全部在写前拒绝。
- 缺父母、缺 Cage、group/experiment 不一致、Weight/Event 缺一边、谱系环均拒绝。
- 恢复 bulkAdd 中注入 AbortError、QuotaExceededError、ConstraintError，确认旧库逐字节语义不变。
- pre-restore 备份下载被阻止时不能显示“已安全备份”。
- 恢复后运行深度 integrity scan。

### 13.4 CSV 导入

- UTF-8 BOM、CRLF、空行、引号内逗号／换行、中英文混合、超长字段。
- 空字段、非法日期、未知枚举、文件内重复 ID/耳标、与现有库重复。
- 100 行中若第 47 行失败，其余合法行成功且报告精确。
- 缺父母／笼位默认失败；显式未关联模式保留原始错误信息。
- 同一文件再次导入的 operationId/idempotency 行为。
- 导入批次 rollback 在存在后续真实引用时必须阻止。

### 13.5 真浏览器与性能

- Playwright 两个 page/context 同时创建、转笼、加入实验和恢复。
- 刷新、关闭页、关闭浏览器、PWA 更新后数据保留。
- 5,000 Mouse、1,000 Cage、50,000 Event、20,000 Weight 下测试索引查询、分页、时间线、导出、恢复和深度审计。
- 记录 p95 查询耗时、恢复耗时、导出 Blob 大小、索引后数据库大小和峰值内存；防止常用路径 O(n²)。
- Chromium、Firefox、WebKit 至少验证 schema open、事务 abort、备份下载；Safari/WebKit 对 storage quota 和后台清理需列为平台风险。

## 14. 实施顺序

1. 固定 TypeScript 实体、枚举、Zod schema、时间／规范化 helper。
2. 建立 Dexie v1 stores 和低级 repository，但只向 service 暴露受控方法。
3. 先实现幂等命令、revision、ActivityLog、统一事务 helper。
4. 实现 Mouse/Cage/CageAssignment，并用并发测试锁定最关键不变量。
5. 实现谱系、实验、Event/Weight、Task/Tag。
6. 实现软删除、引用审计、示例批次删除。
7. 最后实现备份／恢复与 CSV；它们复用同一 Zod 和 service，不另写一套宽松校验。
8. 加入 migration fixture 后才允许发布 v1；发布后 schema 变更只能新增 Dexie version。

## 15. 不确定内容与未检查内容

- 需求没有规定耳标是否跨已删除记录永久唯一。本报告选择“仅活动记录唯一，恢复时冲突”，兼顾重用与回收站；若科研流程要求终身唯一，应改为永久 `&normalizedEarTag`，且 UI 明确不可重用。
- 需求没有规定同一小鼠能否同时属于同一实验的多个非互斥维度。本报告用 `exclusionSet` 表达；产品层需要采用这一模型或明确第一版全部组互斥。
- 容量超限按需求设计为“确认后允许”，未设计为绝对硬限制。
- 未规定时间语义。本报告默认日期按用户配置时区，带时间事件同时保存原始本地值和 UTC instant。
- 未规定永久删除在有历史引用时是否必须可用。本报告基于数据安全优先选择阻止 hard delete 并保留 tombstone；产品文案需如实说明。
- 未检查任何实际 schema、service、migration、备份代码、浏览器 IndexedDB、测试或运行性能，因为审查时这些文件不存在。
- 未验证 Dexie 具体版本 API；实现时应锁定依赖版本并依据该版本官方文档验证 transaction、blocked/versionchange 和 bulk 操作行为。
- 本报告不替代发布后的实施审查。代码完成后应在本文件追加“实施后审查”章节，对照每条不变量给出文件、行号、测试和实际浏览器证据，不能覆盖这份初始基线。

