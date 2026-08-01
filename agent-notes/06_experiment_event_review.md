# MouseKeeper 实验、事件与任务闭环审查（当前 HEAD）

> 审查日期：2026-08-01；基线：`a7f3f1d`。

## 1. 范围与实际读取文件

范围包括实验与初始组创建、分组互斥、批量加入/退出、实验状态、人工/业务事件、体重事件一对一、记录中心，以及任务创建、编辑、筛选、状态、删除恢复。

实际读取：`src/domain/types.ts`、`src/domain/dates.ts`、`src/domain/validation.ts`、`src/db/database.ts`、`src/db/integrity.ts`、`src/services/types.ts`、`src/services/mousekeeper-service.ts`、`src/features/experiments/ExperimentsPage.tsx`、`ExperimentFormPage.tsx`、`ExperimentDetailPage.tsx`、`src/features/mice/MouseDetailPage.tsx`、`src/features/records/RecordsPage.tsx`、`QuickWeightPage.tsx`、`src/features/tasks/TasksPage.tsx`、`TaskFormPage.tsx`、`src/queries/dashboard.ts`、`src/services/mousekeeper-service.test.ts`、`src/domain/dates.test.ts`、`e2e/app.spec.ts`，以及 `5049f13`、`8d19434`、`975baa6`、`ec93d38`、`23e6154`、`b154d4f`、`a7f3f1d`。

## 2. 结论与问题

### [高] E-01 人工事件更新可在 DST 缺口写入自相矛盾的墙上时间，继而阻断完整备份

- 证据：创建事件经 `buildEvent` 把 instant 再投影回本地时间并比较（`src/services/mousekeeper-service.ts:406-430`）；但 `updateMouseEvent` 直接调用 `localDateTimeToInstant` 后保存原 `occurredOn/occurredTime/timeZone`（`3031-3139`），没有同样的反向投影检查。
- 完整性扫描会报告不一致（`src/db/integrity.ts:615-642`），备份验证也会拒绝（`src/backup/validation.ts:883-909`）；而 `exportDatabaseBackup` 用恢复校验器验证导出（`src/backup/backup.ts:164-167`），所以一次被接受的更新可能让用户无法导出完整备份。
- 静态复现（本次未执行临时用例）：先创建人工事件，再调用 `updateMouseEvent`，patch 为 `occurredOn:'2026-03-08', occurredTime:'02:30', timeZone:'America/New_York'`。该时间处于春季 DST 缺口，转换通常投影为 03:30，但记录仍保留 02:30。
- 建议：更新路径复用 `buildEvent` 的一致性断言，或新增统一 `resolveAndValidateLocalEventTime`；补 DST gap/fold 的 update→integrity→backup 回归链。

### [中] E-02 实验状态没有转换矩阵，已取消/归档实验可直接恢复为活动

- 证据：编辑表单始终提供全部 `EXPERIMENT_STATUSES`（`src/features/experiments/ExperimentFormPage.tsx:305-320`）；`updateExperiment` 只在目标状态非 planned/active 且仍有活动成员时阻止关闭（`src/services/mousekeeper-service.ts:2293-2305`），没有像繁育组合那样校验当前状态到目标状态的合法转换。
- 静态复现：创建实验，改为 `archived` 或 `cancelled`，再次编辑选择 `active`；无活动成员时现有服务允许。
- 建议：产品若允许“重新开放”，应做显式命令和审计原因；否则建立状态转换矩阵并覆盖归档/取消终态测试。

### [中] T-01 从回收站恢复任务不重新验证关联对象是否仍可用

- 证据：创建/编辑任务会调用 `activeRecord` 验证小鼠、笼位、实验（`mousekeeper-service.ts:3539-3551,3620-3644`）；`restoreTask` 的事务只包含 tasks/activityLogs，直接清除删除标志（`3775-3816`）。完整性扫描只检查引用 ID 是否存在，不关心引用对象已软删除（`src/db/integrity.ts:657-673`）。
- 复现：创建关联小鼠的任务→软删除任务→软删除小鼠→恢复任务；任务成为活动记录但关联对象仍在回收站，任务筛选的活动关联选项也不会列出它。
- 建议：恢复时重新验证关联对象；可选择拒绝、提示用户解除关联，或明确保留历史快照而不是活动引用。

## 3. 已验证行为与已修复问题

- 本次单测 63/63 通过。已验证互斥实验组和加入/退出事件（`mousekeeper-service.test.ts:566-671`）、实验与初始组单事务（`672-708`）、体重与事件一对一软删除（`785-867`）、业务事件不能绕过领域命令（`868-906`）、快速称重批次回滚（`907-960`）。
- 单 worker E2E 通过称重、人工事件、实验初始组、批量加入小鼠、完成任务并从鼠详情回看实验（`e2e/app.spec.ts:309-373`）。
- 事件时区和 operational truth 在 `5049f13` 已明显加固；备份的墙上时间投影检查又在 `82b06a3` 修复，但 E-01 的更新入口仍未统一。
- 记录中心“先 limit 100 再按小鼠过滤导致历史空缺”已由 `ec93d38` 修为先按小鼠取数、排序再截断（`RecordsPage.tsx:24-103`）。
- 任务“未来 7 天”现排除今日/逾期且只含 pending（`TasksPage.tsx:98-139`）；dashboard 的 focus 链接由 `23e6154` 修复并在页面滚动聚焦（`142-152`）。异步关联下拉编辑值由 `b154d4f` 修复。

## 4. 未确定与未检查

- 未验证跨时区旅行后编辑既有事件的 UI 语义；当前详情表单不暴露 timeZone，风险主要存在于服务/API、恢复数据和未来 UI。
- 未做通知权限、系统通知投递或后台调度测试；当前任务是应用内列表，不应推断为系统提醒已实现。
- 未做 50,000 事件/20,000 体重的性能基准；记录中心只显示最近 100 条，详情页仍会读取该鼠全部事件/体重。
