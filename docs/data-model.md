# MouseKeeper 数据模型

## 1. 版本与存储

当前 APP_CONFIG.schemaVersion 为 1，Dexie 数据库名为 mousekeeper。src/db/database.ts 定义 16 张表及索引，src/domain/types.ts 和 src/domain/validation.ts 定义实体与 Zod schema。

IndexedDB 没有传统关系数据库的外键。MouseKeeper 通过三层保持一致性：唯一索引、MouseKeeperService 事务检查、备份/设置完整性扫描。

## 2. 所有实体的公共字段

StoredEntity 提供：

- id：字符串主键；
- schemaVersion：记录版本；
- revision：乐观并发版本；
- createdAt、updatedAt：ISO instant；
- deletedAt 与 deletedFlag：软删除；
- origin：user、sample、import 或 system；
- sampleBatchId / importBatchId：来源追踪；
- custom：受 JSON 值约束的扩展字段。

规范化键、活动唯一键和 searchTerms 是查询/约束 helper。权威文本变化时只能由服务层同步更新。

## 3. 16 张表

| 表 | 权威内容 | 关键索引/关系 |
|---|---|---|
| mice | 身份、生物学字段、状态、父母、标签、当前笼位投影 | 活动耳标唯一；状态、生日、父母、litter、currentCage、searchTerms |
| cages | 编号、位置、容量、用途、状态 | 活动笼号唯一；房间、架位、状态 |
| cageAssignments | 小鼠在笼位的时间区间 | 活动 mouse 唯一；mouse/date、cage/active |
| breedingPairs | 父本、母本、合笼/分笼、状态 | 活动 sire+dam 唯一；父/母+状态 |
| litters | 窝号、父母、出生/存活数、断奶 | 活动窝号唯一；pair+出生日期 |
| experiments | 名称/编号、日期、干预、负责人、状态 | 活动编号唯一；状态、日期、searchTerms |
| experimentGroups | 实验内组名、类型、互斥集合 | 实验内活动组名唯一；experiment |
| experimentAssignments | 小鼠加入/退出实验组历史 | 活动 group+mouse 唯一；互斥 set+mouse 唯一；mouse/experiment/group |
| mouseEvents | 统一时间线事件及 payload | mouse/cage/experiment+时间、类型、searchTerms |
| weightRecords | 体重数值、单位、克投影和异常确认 | eventId 一对一唯一；mouse+时间 |
| tasks | 截止日时、关联对象、优先级、状态 | status+dueSortKey、各关联对象+status |
| tags | 标签名、颜色、说明 | 活动规范化名称唯一 |
| activityLogs | operationId、动作、主对象和引用对象 | operationId 唯一；主对象 key、引用 key、时间 |
| savedViews | 作用域、筛选、排序、列偏好 | 作用域+活动名称唯一 |
| appSettings | 时区、周起始、阈值、非关键通知偏好、数据库实例 ID | id、schemaVersion |
| backupMetadata | 备份种类、状态、版本、计数与错误摘要 | backupId、导出时间、版本 |

## 4. 核心关系

    Mouse ──< CageAssignment >── Cage
      │
      ├── sireId / damId ──► Mouse
      ├── litterId ──► Litter ──► BreedingPair
      ├──< ExperimentAssignment >── ExperimentGroup ──► Experiment
      ├──< MouseEvent
      ├──< WeightRecord ──1:1── MouseEvent(type=weight)
      └──< Task（可选）

ActivityLog 可用 primaryEntityKey 和多值 entityRefKeys 关联所有实体，但不会作为业务关系的权威来源。

## 5. 日期与时间

- 纯日期保存为 YYYY-MM-DD LocalDate，用于生日、合笼、任务日期等。
- 可选时间保存为 HH:mm LocalTime。
- 事件/体重同时保存声明时区、当地日期/时间和 ISO instant，排序使用 instant，显示/验证使用声明时区反投影。
- 年龄和周龄按当地日历日期计算，避免 UTC 跨日。
- 备份验证允许 instant 中保留秒/毫秒，但当地日期和已填写到分钟的 occurredTime/measuredTime 必须一致。

## 6. 软删除与永久删除

小鼠、笼位、实验、任务、标签和手工事件进入回收站。软删除会释放活动唯一 helper key，并在必要时关闭当前关系，但保留历史快照。

恢复会重新检查唯一键与引用；不会自动重新打开删除时关闭的笼位、实验或繁育关系。永久删除先创建影响预览，在全表事务中再次检查引用；存在子代或历史强引用时阻止。成功后保留不含业务正文的 ActivityLog 审计墓碑，并支持同 operationId 幂等回放。

## 7. 权威事实和投影

- 当前笼位：活动 CageAssignment 权威，Mouse.currentCageId 是列表投影。
- 实验成员：ExperimentAssignment 权威，不由 Mouse.status 推断。
- 繁育参与：BreedingPair 权威，不由 Mouse.status 推断。
- 体重：WeightRecord 权威；配对 MouseEvent 为统一时间线投影。
- 容量：活动 CageAssignment 数量与 Cage.maxCapacity 派生。
- 年龄、周龄、逾期、分布和仪表盘计数均不落第二份业务事实。

## 8. 事务边界

以下操作在单一 rw 事务中完成：

- 创建小鼠并初始分笼；
- 批量创建、批量状态、批量转笼和批量标签；
- 转笼：关闭旧 assignment、创建新 assignment、更新投影、创建事件/日志；
- 终结状态：更新小鼠并关闭笼位、实验和繁育活动关系；
- 创建窝及后代；
- 创建实验与初始组；批量加入/退出成员；
- 创建、编辑、软删除和恢复体重/事件配对；
- 单行 CSV 的标签、小鼠和初始笼位分配；
- 示例批次闭合删除；
- 16 表完整恢复和永久删除。

UI 不应把多步服务命令拆成多个独立 await。

## 9. 引用完整性规则

- 活动耳标和笼位编号规范化后唯一。
- 同一小鼠最多一个活动笼位；已删除/非活动笼位不能接收小鼠。
- 有当前成员的笼位不能删除。
- 父母不能是自身，不允许祖先循环；父母日期不能晚于子代；非典型性别和终结状态需确认。
- 实验组必须属于目标实验；同一组重复加入阻止；同一 exclusionSet 的活动组互斥。
- 有活动成员时不能结束实验；历史分配和事件不随实验删除而静默消失。
- Task 的可选 mouse/cage/experiment 必须存在。
- WeightRecord 与 weight MouseEvent 必须一对一、同 mouse、同本地时间和同软删除状态。
- sampleBatch 删除前验证所有示例实体形成闭合子图，真实记录引用示例时阻止。

## 10. 并发与幂等

ActivityLog.operationId 唯一。服务在事务内先查询同 action 的 operationId：

- 完全相同的请求返回已落库结果并标记 replayed；
- operationId 已用于不同 action 或不同请求内容时拒绝；
- 结果引用缺失时报告 integrity-error，不重新执行副作用。

编辑携带 expectedRevision。活动 helper key 的唯一索引负责最后一道并发防线。

## 11. 备份映射

BACKUP_TABLE_NAMES 与 16 张 Dexie 表一一对应。备份不省略软删除、helper key、来源信息或审计历史。恢复先验证所有实体 Zod schema，再验证跨表引用、重复活动关系、规范化投影、谱系和体重配对。

## 12. schema 变更

v1 是首个 schema，没有旧版数据升级函数。任何 v2 必须新增 Dexie version 块、书面字段转换、旧库 fixture、事务失败回滚测试和备份内存迁移；不得修改已发布 v1 stores 定义来“就地重写历史”。详见 migrations.md。
