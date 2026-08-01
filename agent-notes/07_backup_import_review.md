# MouseKeeper 备份、恢复与 CSV 闭环审查（当前 HEAD）

> 审查日期：2026-08-01；基线：`a7f3f1d`。

## 1. 范围与实际读取文件

范围包括 16 表 JSON 导出、canonical checksum、大小/结构/引用校验、替换恢复、事务回滚、恢复前安全副本、CSV 解析/映射/逐行导入、CSV 导出、回收站相关交界面与现有测试。

实际读取：`src/backup/backup.ts`、`canonical.ts`、`normalize.ts`、`types.ts`、`validation.ts`、`index.ts`、`src/import-export/csv.ts`、`mouse-import.ts`、`mouse-import-runner.ts`、`exporters.ts`、`src/features/data/DataPage.tsx`、`src/lib/download.ts`、`src/db/database.ts`、`src/db/integrity.ts`、`src/services/permanent-delete.ts`、相应的 6 个 `*.test.ts`、`e2e/app.spec.ts`、`playwright.config.ts`、`docs/migrations.md`、`docs/testing.md`，以及 `444b20c`、`9d72ce4`、`8d19434`、`82b06a3`、`975baa6`、`a7f3f1d`。

## 2. 结论与问题

### [高] BK-01 底层恢复 API 在替换事务提交后才构造/校验精确安全副本，后一步失败会出现“已换库但 Promise 拒绝”

- 证据：`restoreDatabaseBackup` 先调用 `replaceAllTables`；该函数在单个 `rw` 事务读取旧数据、清空并写入新数据后提交（`src/backup/backup.ts:225-286,289-303`）。提交之后才对 `preRestoreData` 调 `createBackupFromData`（`304-307`），而后者会做 SHA-256 和完整恢复校验（`138-167`），任一步仍可能抛错。
- 影响：直接调用 API 时，调用者收到失败但数据库其实已替换，且拿不到返回值中的 `preRestoreBackup`。当前 `DataPage` 会先额外导出一次旧库（`273-277`），正常 UI 路径降低了风险，但无法修复底层操作结果语义；旧库本来不一致时，UI 的预导出反而会先失败，从而不允许用有效备份救援。
- 静态复现（未执行临时故障注入）：向旧库直接放入校验器拒绝的关系数据，准备一份有效备份并直接调用 `restoreDatabaseBackup`；替换事务可成功，随后旧数据的 `createBackupFromData` 抛 `BackupValidationError`。
- 建议：在替换前先把旧数据转成已验证的备份，或让同一事务只返回 canonical 原始快照且保证事务提交后的封装不再失败；API 必须返回明确的 committed 状态。UI 只应下载一份有确定来源的安全副本，并提供“旧库不一致时仍可恢复”的受控路径。

### [中] CSV-01 CSV 导出混入软删除记录，且不同实体对删除状态的表达不一致

- 证据：数据页 inventory 对 mice/cages/experiments/weights/events 都使用全表 `toArray()`（`src/features/data/DataPage.tsx:137-176`），导出时不筛 `deletedFlag`（`336-422`）。小鼠、笼位 CSV 有 `deletedAt` 列（`src/import-export/exporters.ts:81-95,128-141`），实验、体重、事件 CSV 没有删除列（`145-207,210-247,249-299`）。
- 影响：已删除体重/事件在 CSV 中看起来与活动记录相同；实验 CSV 也无法区分回收站记录。小鼠 CSV 再导入时，内部 ID 又会因数据库仍保留软删除行而冲突，不能作为可逆 CSV 闭环。
- 复现：记录体重或人工事件→软删除→在“CSV 导出”下载对应文件；删除记录仍出现且没有删除标志。现有 E2E 只验证文件能下载（`e2e/app.spec.ts:444-450`），没有验证行集合。
- 建议：默认只导出活动记录，另设“含回收站”开关；若包含删除项，每种 CSV 都输出一致的 `deletedAt/deletedFlag`，页面说明 CSV 是分析导出而非完整恢复格式。

### [中] TEST-01 默认 E2E 命令本次不稳定，不能作为发布门禁的通过证据

- 实际结果：`npm run test:e2e` 使用默认 2 workers 时，前 5 个测试通过后预览服务端口 4173 拒绝连接，最终 **5 通过、7 失败、8 跳过**；失败均为 `page.goto: net::ERR_CONNECTION_REFUSED`，不是断言失败。
- 同一 HEAD 紧接着执行 `npx playwright test --workers=1`，结果 **12 通过、8 跳过**，覆盖完整备份下载/恢复、CSV 隔离导入与五类 CSV 下载、离线未访问路由。
- 配置证据：`playwright.config.ts` 的 webServer 为 build + vite preview，项目含 desktop/mobile；默认没有固定 `workers:1`。建议定位并行时 preview 生命周期/复用问题，在 CI 和本地都跑稳定的默认命令；在修复前只能记录 single-worker 通过，不能宣称 `npm run test:e2e` 通过。

## 3. 已验证行为与已修复问题

- `npm test -- --reporter=dot` 实际 11 文件、63 测试通过。备份测试覆盖空库 round-trip、canonical SHA-256、非空替换、截断 JSON、缺表/计数/checksum/future schema/重复主键/无效引用/派生键/大小上限，以及注入写失败时全部回滚（`src/backup/backup.test.ts:83-309`）。
- 单 worker E2E 实际验证浏览器产生可落盘的 JSON 下载、预览有效、替换后数据回到备份状态（`e2e/app.spec.ts:375-411`）；CSV 实际验证坏行隔离、好行提交和五类下载事件（`413-451`）。
- 16 表清单与数据库表一致（`src/backup/types.ts:24-41`；`src/db/database.ts:100-116`）；恢复前执行 envelope、表键、计数、checksum、schema、行 schema、派生键与引用审计，再进入全表单事务替换。
- 已修复的既有问题：`8d19434` 将替换写入与精确旧状态读取合并进同一事务，并补批处理/引用校验；`82b06a3` 改为按 instant 投影验证事件本地时间；`9d72ce4` 加强 CSV 解析错误隔离、引用完整性和导入回滚；CSV 公式前缀中和见 `src/import-export/csv.ts:26-43,74-93`；每行导入在独立全表事务中并记录 `origin/importBatchId`（`mouse-import-runner.ts:100-150`）。
- 下载提示使用“已发起”而非声称已保存（`DataPage.tsx:289-293`），与浏览器无法由页面确认最终落盘的事实一致。

## 4. 未确定与未检查

- 当前只有 schema/backup format v1；旧版本迁移分支明确返回 requires migration，没有 migration fixture。没有把未来兼容性标记为已验证。
- 未测 100 MB 边界文件在低内存移动设备上的解析峰值、配额不足、浏览器崩溃、两个标签页同时 restore/import/export、恶意压缩包（输入仅接收 JSON/Blob，不解压）。
- 未验证 Safari/Firefox 的下载与 IndexedDB 行为；现有 E2E 只有 Chromium/Pixel 7 仿真。
- 未逐一审查永久删除的每一种引用组合；本报告只读取了交界实现与现有 mouse/task 测试。
