# MouseKeeper 小鼠模块闭环审查（当前 HEAD）

> 审查日期：2026-08-01
> 审查基线：`a7f3f1d`
> 性质：只读代码、测试与现有 E2E 审查；未修改业务代码。

## 1. 范围与实际读取文件

范围是小鼠建档、编辑/复制、批量创建与批量操作、谱系、初始分笼、详情时间线、软删除/恢复和列表查询闭环。

实际读取：`src/domain/types.ts`、`src/domain/validation.ts`、`src/db/database.ts`、`src/db/integrity.ts`、`src/services/types.ts`、`src/services/mousekeeper-service.ts`、`src/features/mice/MicePage.tsx`、`MouseFormPage.tsx`、`MouseBulkCreatePage.tsx`、`MouseDetailPage.tsx`、`MouseStatusChip.tsx`、`src/features/data/DataPage.tsx`、`src/services/mousekeeper-service.test.ts`、`src/services/permanent-delete.test.ts`、`e2e/app.spec.ts`，并查看了与本模块相关的提交 `1903fac`、`490d0d6`、`3934852`、`6e05096`、`9d72ce4`、`b154d4f`、`a7f3f1d`。

## 2. 结论与问题

### [高] M-01 编辑父本/母本出生日期可反向制造“父母晚于后代出生”的谱系

- 证据：创建或编辑一只小鼠时，`validateMouseRelations` 只检查“当前小鼠的出生日期不早于其父母”（`src/services/mousekeeper-service.ts:464-487`）；`updateMouse` 随后直接保存当前记录（`934-1052`），没有查询以它为 `sireId`/`damId` 的既有后代。
- 完整性扫描只检查父母存在、窝快照一致和环（`src/db/integrity.ts:320-376`），也没有比较父母/后代日期；备份引用审计同样只检查引用、窝一致和环（`src/backup/validation.ts:509-579`）。因此该异常写入后不会被扫描或备份预检揭示。
- 静态复现（本次未另写临时测试执行）：创建父本 A（`birthDate=2020-01-01`），创建后代 B（`birthDate=2021-01-01,sireId=A`），再调用 `updateMouse(A,{birthDate:'2022-01-01'})`；现有路径会通过。
- 建议：`updateMouse` 在修改 `birthDate` 时于同一事务查询直接后代（必要时也校验相关 `BreedingPair`/`Litter`），拒绝晚于任何后代出生日期的值；在 `scanIntegrity` 与备份引用审计增加同一规则，并补服务层回归测试。

### [中] M-02 列表闭环在设计规模下仍是全表加载、内存关联与客户端分页

- 证据：`MicePage` 同时 `toArray()` 读取全部小鼠、笼位、标签和实验，再遍历组装（`src/features/mice/MicePage.tsx:183-270`）；分页常量虽为 50（`53`），但分页发生在加载和过滤之后。
- 影响：5,000 只小鼠的基线也许可用，但关联表增长后，每次 live query 失效都可能重读并重建全量映射；当前单测/E2E 没有大数据耗时或内存门槛。
- 复现：导入 5,000+ 小鼠并附加大量标签/实验分配，在列表进行写操作并观察 IndexedDB 读取、主线程时间和内存；本次未构造该数据集。
- 建议：将常用状态/笼位/更新时间筛选下推到 Dexie 索引，先取得分页 ID 再批量补关联；至少添加 5,000/50,000 规模基准，明确可接受阈值。

## 3. 已验证行为与已修复问题

- `npm test -- --reporter=dot` 实际运行：11 个测试文件、63 个测试全部通过。覆盖规范化活动耳标唯一与 `operationId` 重放（`mousekeeper-service.test.ts:78-102`）、初始分笼事务回滚（`149-197`）、批量状态/转笼/标签原子性（`199-281`）、谱系环（`359-392`）、软删除后释放唯一键与冲突恢复（`961-996`）。
- `npx playwright test --workers=1` 实际运行：12 通过、8 按项目配置跳过；桌面闭环覆盖搜索、筛选、编辑、批量操作、回收站恢复和刷新持久化（`e2e/app.spec.ts:190-265`），也覆盖建鼠时初始分笼、称重与任务（`146-188`）。
- 既有“先建鼠、后分笼导致半成品”已由 `createMouseWithCage` 外层事务修复（`mousekeeper-service.ts:645-702`），服务测试验证无效/超容笼位时鼠记录回滚。
- 复制生物学档案时会清空身份字段与笼位并回到 `alive`；异步下拉编辑值的丢失问题已在 `b154d4f` 修复（`MouseFormPage.tsx:154-176`）。
- 软删除会原子关闭当前笼位、实验分配与当前繁育组合并释放耳标键（`mousekeeper-service.ts:4097-4218`）；恢复不会擅自恢复已关闭关系（`4223-4290`）。

## 4. 未确定与未检查

- 未做多标签页并发、5,000 只规模、浏览器崩溃中断、配额耗尽和长时间运行测试。
- 未逐项审查视觉、键盘/读屏和移动端细节；只引用了现有 E2E 的无横向溢出检查。
- 默认 `npm run test:e2e` 本次因预览服务器中途拒绝连接而 5 通过、7 失败、8 跳过；改为单 worker 后通过。不能把默认并行命令标记为稳定通过，详情见 `07_backup_import_review.md`。
