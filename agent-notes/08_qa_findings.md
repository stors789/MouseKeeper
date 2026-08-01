# MouseKeeper 独立 QA 发现

审查日期：2026-08-01（Asia/Shanghai）
被审 HEAD：`a7f3f1de7a7d986aa88eaf35513f7bac965cb29f`
环境：macOS 27.0、Node v26.0.0、Playwright 1.62.0、headless Chromium

## 结论

本轮没有发现阻断级产品缺陷。静态质量门禁、63 个单元/服务测试、production build 和当前 Playwright 套件均通过；已有实现对唯一键、严格日期、核心引用、备份校验、事务回滚与 operationId 幂等有较强的服务层保护。

发布证据仍有 3 个中等风险缺口：损坏/未来备份没有 UI 级拒绝测试；引用完整性测试只抽查少量关系；PWA 与手机矩阵没有覆盖离线业务写入、更新、多标签页及完整手机核心操作。下文的“通过”只代表列明的实际证据，不能外推到未检查平台或流程。

## 实际执行基线

| 检查 | 结果 | 实际证据 |
|---|---|---|
| lint | 通过 | `npm run lint`，退出码 0 |
| TypeScript | 通过 | `npm run typecheck`，退出码 0 |
| Vitest | 通过 | `npm run test`：11 files、63 tests passed |
| production build | 通过 | `npm run build`：2053 modules transformed，退出码 0 |
| Playwright | 通过/有条件跳过 | `npm run test:e2e`：12 passed、8 skipped，34.6s；桌面 Chromium 与 Pixel 7 项目 |
| 320px 补充巡检 | 通过 | headless Chromium 320×800，16 个列表/新建/工具路由的 `body.scrollWidth - clientWidth` 均为 0 |

Playwright 的 8 个 skipped 是项目条件分支：桌面专属用例在 mobile-chromium 跳过，手机专属用例在 chromium 跳过，不是失败；但它们也说明同一工作流没有跨两个项目完整执行。当前配置见 `playwright.config.ts:19-29`，跳过点见 `e2e/app.spec.ts:95,118,271,313,379,417,458`。

## 必查破坏性场景

### QA-01 重复编号与活动唯一键

- 严重级别：信息（当前证据通过）；残余覆盖风险：低。
- 文件/测试证据：`src/db/database.ts:28-80` 为活动耳标、笼号、活动窝号、实验编号、组名、标签名、operationId 等建立唯一索引；`src/services/mousekeeper-service.test.ts:78-102` 验证 NFKC 后的活动耳标唯一与重放幂等；`src/import-export/mouse-import.test.ts:46-70` 验证 CSV 文件内重复 ID/耳标隔离；备份恢复会在 `src/backup/validation.ts:1052-1123` 检查所有活动唯一关系。
- 本轮复现/验证：在全新 Chromium context 创建 `QA-CAGE-01`，随后提交全角 `ＱＡ－ＣＡＧＥ－０１`；页面停留在 `/cages/new` 并显示“该笼位编号已被使用。”。对首次“保存笼位”执行 `dblclick` 后直接读取 IndexedDB，`cages.count()` 为 1。
- 是否已修复/残余风险：现状通过，无本轮修复。自动化回归只直接覆盖耳标和保存视图；笼号的证据是本轮临时浏览器检查，窝号、实验编号、组名、标签名的规范化碰撞尚无逐项测试。

### QA-02 非法日期与未来日期

- 严重级别：信息（当前证据通过）；残余覆盖风险：低。
- 文件/测试证据：`src/domain/dates.ts:3-29` 做真实日历校验；`src/domain/dates.test.ts:12-20` 覆盖闰年、非法月日和格式，`src/domain/dates.test.ts:30-36` 覆盖未来生日；Mouse schema 在 `src/domain/validation.ts:151-156` 拒绝未来生日；CSV 在 `src/import-export/mouse-import.ts:235-236` 拒绝非法/未来生日；表单规则见 `src/features/mice/MouseFormPage.tsx:52-69`。
- 本轮复现/验证：在 Chromium 将出生日期填为 `2030-01-01`；输入的 `max` 为 `2026-08-01`，`validity.rangeOverflow=true`，提交后焦点留在该日期输入且没有写入/跳转。浏览器原生消息为英文，这是 headless Chromium/locale 结果，不代表中文系统上的文案。
- 是否已修复/残余风险：现状通过，无本轮修复。未逐个验证繁育、窝、实验、任务、事件和体重日期的 UI 边界，也未覆盖所有 DST 重叠时刻。

### QA-03 引用完整性

- 严重级别：中（测试覆盖缺口，不是已复现的数据破坏）。
- 文件/测试证据：`src/db/integrity.ts:320-620` 扫描亲本、窝、笼位分配、实验分组、事件与体重等引用；`src/backup/validation.ts:487-1135` 在恢复写入前检查引用、一对一关系、投影和活动唯一键；`src/services/mousekeeper-service.test.ts:283-303` 验证悬空 litter 写入原子拒绝，`:1023-1066` 只对 clean DB 与 missing tag 做完整性扫描抽查；`src/backup/backup.test.ts:237-256` 只用 missing sire 代表恢复引用拒绝。
- 复现/验证步骤：运行 `npm run test`；再检查上述测试名称 `rejects dangling litter references without partial writes`、`reports dangling secondary relations during integrity scans`、`rejects invalid rows and missing required references` 均在 63 个通过测试中。
- 是否已修复/残余风险：实现存在且抽查通过，无本轮修复。缺少覆盖所有外键字段的表驱动故障注入，特别是 assignment/event 双向关系、软删除对象上的 task warning 语义和恢复前后全库 scanner 对照。

### QA-04 损坏备份与未来备份

- 严重级别：中（UI 级发布证据缺口）。
- 文件/测试证据：`src/backup/backup.test.ts:167-275` 实际覆盖截断 JSON、缺表、计数错、checksum 错、未来 schema、重复 PK、非法行、缺引用、派生键漂移和超限文件；`src/backup/validation.ts:1192-1235` 同时实现 future backup-format、future schema 和旧版本拒绝；`:1269-1279` 在返回可恢复结果前校验 digest。
- 复现/验证步骤：运行 `npm run test -- src/backup/backup.test.ts`（本轮完整 `npm run test` 已包含并通过）。浏览器 E2E `e2e/app.spec.ts:375-410` 只验证合法备份 round-trip，并未上传损坏或未来备份。
- 是否已修复/残余风险：服务层通过，无本轮修复。未来 `schemaVersion` 有直接测试，但 `backupFormatVersion` 的未来/旧版本分支没有直接测试；错误文件未验证 UI 是否持续展示具体原因、保持原数据库和恢复按钮禁用。

### QA-05 重复提交与幂等

- 严重级别：信息（抽查通过）；残余覆盖风险：低。
- 文件/测试证据：`src/components/ui/Button.tsx:38-58` 在 loading 时禁用按钮；表单使用 React Hook Form `isSubmitting`，例如 `src/features/cages/CageFormPage.tsx:65-73,316`；活动日志 `operationId` 唯一索引见 `src/db/database.ts:70-75`；服务幂等测试见 `src/services/mousekeeper-service.test.ts:78-94,265-269,467-477`。
- 本轮复现/验证：全新库对“保存笼位”执行 `dblclick`，落库笼位数为 1；该结果是实际 Chromium 检查。
- 是否已修复/残余风险：抽查通过，无本轮修复。尚未对恢复、CSV 导入、窝与后代批量、快速称重、批量转笼等较慢/多写事务做 UI 双击和网络/事件重入测试。

### QA-06 刷新持久化

- 严重级别：信息（当前证据通过）；残余覆盖风险：低。
- 文件/测试证据：`e2e/app.spec.ts:190-265` 创建/编辑/批量状态/批量转笼/回收恢复后刷新，并断言 `E2E-MALE` 仍存在。
- 复现/验证步骤：运行 `npm run test:e2e`，观察 `mouse search, filters, edits, atomic batches, recycle, and refresh persist` 在 desktop Chromium 通过。
- 是否已修复/残余风险：现状通过，无本轮修复。只验证同一 page/context 的 reload；未实际关闭并重启浏览器后验证全部关键事实，也未测试清理站点数据、配额或隐私模式。

### QA-07 PWA/离线

- 严重级别：中（范围不足）。
- 文件/测试证据：manifest 包含 standalone、192/512 与 maskable 图标，见 `public/manifest.webmanifest:1-28`；SW 安装、预缓存、旧 cache 清理和 navigation fallback 见 `public/sw.js:1-104`；production 注册见 `src/main.tsx:18-21`；`e2e/app.spec.ts:453-481` 实际等待 SW 控制，离线后打开未访问的 `/settings` 并通过。
- 复现/验证步骤：运行 `npm run test:e2e`，观察 `installed app opens an unvisited workspace while offline` 在 desktop Chromium 通过。
- 是否已修复/残余风险：基础壳离线通过，无本轮修复。未验证离线时读取/新增 IndexedDB 业务数据、从安装入口启动、cache version 更新提示、数据库不被更新影响、多标签 `versionchange/blocked`、真实 macOS/Windows/手机安装。

### QA-08 窄屏与手机路径

- 严重级别：中（完整手机业务矩阵缺口）。
- 文件/测试证据：`e2e/app.spec.ts:66-89` 在 Pixel 7 项目巡检 9 个 workspace；`:114-144` 验证批量建档、数据页、快速称重和笼位详情无整页横向溢出；`:146-188` 在 mobile-chromium 通过建笼、建鼠、称重、关联任务。其余密集流程在 mobile 项目明确跳过。
- 本轮复现/验证：额外用 headless Chromium 320×800 访问 `/`、mice/cages/breeding/experiments/records/tasks 的列表与新建页、bulk-create、quick-weight、data、settings，共 16 个路由；所有页面 `body.scrollWidth - clientWidth = 0`。这只证明页面级横向溢出，不证明控件未被遮挡或触控可完成。
- 是否已修复/残余风险：现有路由无整页溢出，无本轮修复。手机端转笼、状态、事件、完成任务、导入导出、恢复、回收与繁育/实验编辑没有完整操作证据；没有真实触屏设备、横屏、字号放大或 200% zoom 测试。

## 其他观察

- production build 中主入口约 342.96 kB（gzip 110.77 kB）；本轮没有设置性能预算，也没有做 5,000 mice / 50,000 events 的容量测试。
- 当前 E2E 使用同一 baseURL，但 Playwright browser context 隔离了测试存储；本轮没有并发标签页或跨 context 共享 IndexedDB 测试。
- 文档 `docs/testing.md` 的“没有 e2e 测试文件/尚未运行”是旧静态基线描述，与当前仓库实际状态不一致；本报告以当前 HEAD 与实跑结果为准。

## 未检查项

- Firefox、WebKit/Safari、Edge、Windows、真实 Android/iOS。
- 真 PWA 安装、升级提示、后台/冷启动、离线业务写入和恢复联网后的同步行为（应用当前为纯本地，无服务端同步）。
- IndexedDB quota/abort/versionchange/blocked、多标签竞争和浏览器重启持久化。
- 大数据性能、内存峰值、100 MB 备份、20 MB CSV 的实际浏览器压力。
- 系统下载权限、下载失败、安全备份下载失败后恢复是否应继续的产品决策。
- 长文本、极长 ID、中英混排、系统字号放大、缩放与横屏视觉回归。
