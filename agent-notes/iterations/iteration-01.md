# Iteration 01 — 数据安全地基

> 范围：commit 7cf9ff7 至 7b935a6，共 10 个原子提交。
> 独立审查：初始项目盘点、产品架构、数据模型和 UI 四个隔离子代理；本轮以 02_data_model_review.md 为主要复核输入。
> 记录性质：本文件在交付阶段按 Git 历史回溯整理；提交内容是真实记录，但当轮终端输出未逐条落盘，因此测试数字只引用可重建的代码/最终回归证据。

## 检查范围

- domain 实体、严格日期、规范化与 Zod；
- 16 张 Dexie 表、唯一 helper key 和数据库生命周期；
- MouseKeeperService 的事务、operationId、revision、warning；
- JSON 备份信封、SHA-256、恢复事务和损坏输入。

## 发现与处理（8 / 8）

1. 绿地目录没有 schema：建立 16 实体公共字段与明确版本。
2. IndexedDB 没有外键：把关联检查放进服务事务和完整性扫描。
3. 宽松 Date 可能跨时区错日：改为严格 LocalDate/LocalTime 与日历年龄函数。
4. 活动耳标、笼位和关系可能重复：用只在活动记录存在的唯一 helper key。
5. 快速重复点击可能产生双副作用：ActivityLog.operationId 唯一并支持重放。
6. 多标签页旧编辑可能覆盖新值：引入 revision / expectedRevision。
7. 备份可能缺表、损坏或引用断裂：版本化信封、canonical SHA-256、Zod 与关系预检。
8. 恢复中途失败可能清空部分表：16 表同一 rw 事务，故障注入证明回滚。

## 复现、根因与证据

- 使用同一规范化耳标创建两只活动小鼠；根因是业务编号不是主键且 IndexedDB 无条件唯一约束。证据：database.ts activeEarTagKey、service 测试。
- 修改已签名 JSON 的 tableCounts 或删除表；根因是仅 JSON.parse 不能证明完备性。证据：backup.test.ts 的 count/missing/checksum 用例。
- 在替换到某表前注入异常；根因是逐表独立事务会留下半恢复。证据：restore testOnlyFailBeforeTable 与 rollback 用例。

## 提交

- 7cf9ff7 validated domain model
- 9e1740f local date tests
- 5e50733 IndexedDB schema/lifecycle
- 34cd8ba integrity scanner
- a1b1c4a service contracts
- 9c8f28b integrity-safe services
- e75c020 transactional tests
- 854f92e backup validation
- 3e97360 backup export/restore
- 7b935a6 corruption/rollback tests

## 回归证据

- 本轮结束点可静态重建 26 个 it/test 声明。
- 最终 HEAD 上 lint、typecheck、63 个 Vitest 和完整 Playwright 均通过，覆盖本轮代码的现态。
- 未保留当轮浏览器 E2E 输出；本轮还没有业务 UI，不能声称当时通过端到端流程。

## 未解决 / 下一轮

- schemaVersion 1 没有旧生产 schema，真实升级路径待未来 v2。
- 服务尚未有完整业务页面调用。
- 下一轮重点：小鼠、笼位、繁育与实验闭环，确保 UI 不绕过服务写库。
