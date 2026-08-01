# 数据迁移策略

## 1. 当前能力

MouseKeeper v0.1.0 使用 Dexie schemaVersion 1。这是首个发布 schema，因此当前代码只有 this.version(1).stores(DEXIE_STORES)，没有从旧生产版本升级的转换函数。

这意味着：

- 新数据库可直接创建 16 张表及索引；
- schemaVersion 1 JSON 可在完整验证后恢复；
- 小于 1 或大于 1 的备份不会被猜测迁移；
- 本版本不能声称已验证真实 v0→v1 业务迁移，因为不存在已发布的旧 schema。

## 2. 数据库生命周期

MouseKeeperDatabase 监听：

- blocked：派发 mousekeeper:database-blocked，并调用可注入 handler；
- versionchange：派发 mousekeeper:database-versionchange，调用 handler 后关闭旧连接。

升级遇到旧标签页时不得删除数据库或无限重试。用户应关闭其他 MouseKeeper 标签页后重新打开。

## 3. 新增 v2 的强制流程

1. 在 src/config/app.ts 把 schemaVersion 提升为 2。
2. 保留 version(1) 的已发布 stores 定义，新增 version(2).stores(...).upgrade(...).
3. 在 docs/data-model.md 记录新增/删除/重命名字段、索引和权威事实变化。
4. 对每个旧实体先读取权威字段，确定性生成 helper key；冲突时中止升级，不随机选胜者。
5. upgrade 回调只执行 IndexedDB/Dexie 可等待操作；不做网络、文件下载或长时间 UI 交互。
6. 添加 v1 非空 fixture、软删除 fixture、冲突 fixture、异常注入和 versionchange/blocked 测试。
7. 为 schemaVersion 1 JSON 提供纯内存 backup migration，迁移后重新运行当前 Zod、校验和和引用审计。
8. 在生产构建中联合测试新 Service Worker、旧应用标签页、旧数据库和离线重载。

## 4. 迁移不变量

- 主键、createdAt、历史关系和软删除语义保持。
- 不因为无法解析字段而静默丢记录。
- helper key 可重建，但重建结果必须与权威字段一致。
- WeightRecord/MouseEvent 一对一、活动 CageAssignment 唯一和实验互斥关系保持。
- schemaVersion 只在整个 upgrade 事务成功后提升。
- 失败时 IndexedDB 保留旧版本，不运行 clear/deleteDatabase 兜底。
- 迁移过程不得把真实数据写入日志或网络。

## 5. 备份迁移

备份迁移必须与数据库升级分离：

    原始文件 → 大小/JSON 安全检查 → 旧格式结构检查
             → 纯内存逐版本迁移 → 当前 schema 完整校验
             → 用户预览与确认 → 单事务替换

原始 Blob/string 保持不变。每个版本只知道如何迁移到下一个版本，禁止跳过中间版本或直接把 schemaVersion 数字改成当前值。

未来 schemaVersion 与 future backupFormatVersion 始终拒绝；用户应使用生成文件的较新应用版本。

## 6. Service Worker 协调

Service Worker 缓存名当前为 mousekeeper-shell-v4，构建资产带哈希。发布 schema 变更时：

- 先确认新壳能打开旧数据库并触发 Dexie upgrade；
- 旧页面收到 versionchange 后必须关闭连接，不能继续写；
- activate 清理旧应用壳缓存不能触碰 IndexedDB；
- 迁移失败时应保留旧数据库，并向用户提供关闭标签页、备份和恢复指引；
- 离线设备可能跨多个应用版本升级，迁移链必须逐版完整。

## 7. 发布验收矩阵

任何 v2 发布前至少验证：空库创建、v1 非空升级、软删除、唯一 helper 冲突、upgrade 中途抛错、两个标签页 blocked/versionchange、旧备份迁移、未来备份拒绝、配额失败、PWA 新壳离线重载和升级后完整性扫描。

当前 v1 已测试 schema 创建、事务回滚、备份未来版本拒绝和数据库生命周期代码路径；上述 v1→v2 场景属于未来工作，未标记为通过。
