# MouseKeeper 数据迁移说明

## 文档状态

当前应用配置声明 `schemaVersion: 1`，Dexie 4 已列入依赖；静态检查基线中尚无实际数据库
class、`db.version(1).stores(...)`、upgrade callback 或 migration fixture。本文是 v1 建库和
后续版本迁移的发布契约，所有行为均待实现和验证。

## 1. 版本模型

MouseKeeper 同时维护：

- `DB_VERSION`：Dexie/IndexedDB 物理版本；
- `schemaVersion`：业务记录和备份 payload 版本；
- `backupFormatVersion`：备份外层信封版本；
- `appVersion`：应用发布版本；
- `revision`：单条记录并发版本。

它们当前可都出现数字 `1`，但用途不同，不允许用 `appVersion` 推断数据库迁移，也不允许
用记录 revision 解析备份。

版本规则：

1. DB 和 schema 版本只能使用递增整数；
2. 已发布版本不重用、不降级、不按运行时条件分叉；
3. 每个 Dexie version 声明该版本全部 stores，不只写变化项；
4. 每条已迁移记录更新其 schemaVersion；
5. 备份升级在内存副本执行，不直接复用 Dexie upgrade callback。

## 2. v1 策略

v1 一次建立 [数据模型说明](./data-model.md#3-16-个实体) 中的全部 16 张表。初始发布不制造
空的 v2/v3 来展示“已有迁移”。

v1 发布门：

- 16 表名称、字段、Zod schema、Dexie stores 和备份 key 一致；
- 活动耳标、笼号、活动 CageAssignment、实验互斥等唯一 helper key 已测试；
- 目标查询具有必要索引；
- v1 空库和非空 fixture 能成功打开；
- 完整 JSON round-trip 覆盖全部 16 表；
- 数据库名和版本由集中配置或单一数据库模块管理。

在首个包含真实用户数据的版本发布前，可以调整开发中的 v1 定义并清理**明确的测试数据库**。
一旦任何可持久保存真实数据的 v1 交付，后续结构变化必须新增 v2；生产代码不得通过删除
数据库“解决”开发期 schema 变化。

## 3. 何时需要新版本

需要提升 DB/schema version：

- 新增或删除表；
- 增删/改变 Dexie 索引；
- 字段语义或枚举变化，需要回填；
- 规范化/唯一 helper key 算法变化；
- 关联从一种权威来源迁到另一种；
- 事件 payloadVersion 变化且旧记录必须改形；
- 保存视图 queryVersion 需要持久结构转换。

通常不需要提升 DB version：

- 仅修改组件、文案或布局；
- 新增不落库的派生显示；
- service 校验收紧但旧记录 shape 不变；
- 添加可重建且不由 Dexie schema 管理的内存缓存。

若校验规则收紧会让旧记录非法，仍需数据审计或 migration，不能以“不改字段”为由跳过。

## 4. 每次 migration 的交付物

每个版本必须同时提交：

1. 上一版和新版本的完整 stores 定义；
2. 确定性的 upgrade 函数；
3. 上一版真实 shape fixture；
4. 正常、边界、损坏和大数据 fixture；
5. 字段/索引变化说明；
6. 备份 schema 的兼容策略；
7. 预期表计数、主键集合和引用不变量；
8. 失败、blocked 和 versionchange 测试；
9. 用户可见的失败恢复文案。

建议目标位置：

```text
src/db/
  database.ts
  schema/
    v1.ts
    v2.ts
  migrations/
    v1-to-v2.ts
src/test/fixtures/migrations/
  v1/
  v2/
```

这些路径是设计建议，尚未在静态基线中建立。

## 5. Upgrade callback 约束

```ts
db.version(2)
  .stores(v2Stores)
  .upgrade(async transaction => {
    // 仅使用本次 Dexie upgrade transaction 中的表和 promise。
    // 扫描冲突，重建派生键，更新 schemaVersion。
  })
```

- schema 变更、数据回填和派生索引重建在同一个 versionchange transaction 中完成；
- callback 内不访问网络、不下载文件、不使用 timer、不更新 React state；
- 不调用普通 service 命令，以免嵌套事务或写入不属于 migration 的副作用；
- 大表只扫描受影响记录，优先 collection `modify`，避免逐记录关联全表查询；
- 新增唯一 helper key 前先扫描冲突；冲突会 abort，不能任意保留一条；
- migration 不写常规用户 ActivityLog；应记录结构化 migration 结果或失败诊断，避免假装是用户操作；
- upgrade 失败依赖 IndexedDB versionchange transaction 回滚，catch 分支绝不调用
  `deleteDatabase()`。

## 6. 推荐迁移步骤

1. 打开数据库前读取目标代码版本。
2. 注册 `versionchange` 和 `blocked` 处理。
3. 让 Dexie 发起 upgrade。
4. 在 upgrade transaction 中先验证会产生唯一冲突的旧数据。
5. 转换字段、关系和派生 helper key。
6. 更新每条受影响记录的 schemaVersion。
7. 核对受影响表计数和关键引用。
8. 提交后运行启动快速完整性扫描。
9. 将成功的 DB/schema 版本写入 AppSettings/诊断信息。

如果步骤 4–7 抛错，旧版本必须保持原状，应用进入只读恢复页面并允许用户导出诊断信息。

## 7. 多标签页与 PWA 更新

数据库升级和 Service Worker 更新是两个独立生命周期，必须协调：

- 旧页收到 Dexie `versionchange` 时立即停止写入、关闭连接并提示刷新；
- 新页遇到 `blocked` 时明确提示关闭其他 MouseKeeper 标签页；
- 不无限等待，也不自动清库；
- 新 Service Worker 不应让旧 JS 在新 schema 上继续执行写命令；
- 可使用 `navigator.locks` 为 migration、restore 和大型 import 提供跨标签页独占体验；
- 不支持 Locks API 时，数据库事务、唯一索引、operationId 和 revision 仍是最终安全线。

需要在真实浏览器中验证：

1. 两个标签页同时打开 v1；
2. 一个标签页加载带 v2 的新应用；
3. 旧页收到提示并停止写入；
4. 关闭旧页后升级继续；
5. 更新后离线重载仍能打开并读取迁移数据。

当前原生 Service Worker 和 Dexie migration 尚未完成该联合验证。

## 8. 备份迁移

备份恢复流水线与已安装数据库升级分离：

```text
读取文件
→ 校验 backupFormatVersion
→ 校验 checksum
→ 按 schemaVersion 在内存逐版升级 payload
→ Zod + 引用完整性审计
→ 生成 pre-restore 备份
→ 单事务替换 16 表
```

规则：

- 旧备份只能逐版本迁移，不能从 v1 直接跳到 v4 的未测试转换；
- 未来 `backupFormatVersion` 或 `schemaVersion` 直接拒绝；
- 每一步返回新的内存对象，不修改用户原始文件；
- 恢复时重算标准化值、active helper key、`deletedFlag` 和投影；
- schema 兼容不代表引用完整；父母环、缺笼位、Weight/Event 缺边等仍须拒绝；
- appVersion 仅提供来源信息，不作为唯一兼容判据；
- checksum 失败不能通过“忽略并继续”绕过。

## 9. 失败与恢复

| 失败点 | 要求行为 | 禁止行为 |
|---|---|---|
| 打开数据库失败 | 显示只读恢复页和错误码 | 自动删除数据库 |
| upgrade 唯一冲突 | abort，列出冲突类别 | 随机保留一条 |
| upgrade 中异常 | version 不提升，旧记录不部分回填 | catch 后建空库 |
| 旧标签页阻塞 | 提示关闭标签页并允许重试 | 无限 spinner |
| 配额不足 | abort，保留旧库，提示导出/释放空间 | 部分升级 |
| 恢复文件未来版本 | 写入前拒绝 | 尝试降级解析 |
| 恢复写入失败 | 整个 16 表事务回滚 | 逐表 clear/commit |
| 提交后完整性失败 | 使用仍在内存的 pre-restore 数据执行受审计回滚 | 留在未知损坏态 |

## 10. Migration 测试契约

每个发布过的版本至少覆盖：

- 从该版本 fixture 逐版升级到 current；
- migration 前后主键集合、表计数和业务事实保持；
- 软删除记录的活动唯一键不会被错误重建；
- 新 helper key 冲突会 abort；
- upgrade 中人工抛出 `ConstraintError`、`AbortError` 和配额错误时旧库保持；
- 旧枚举、缺字段、超大事件表和历史孤儿按书面策略处理；
- 两标签页 blocked/versionchange；
- PWA 旧壳到新壳的离线更新；
- 对应旧备份也能通过独立内存迁移恢复。

发布前应保存迁移测试输出和真实浏览器证据。当前基线尚无 migration fixture 或测试结果，
因此 v1 migration 能力状态为**待实现、待验证**。
