# MouseKeeper LLM 用户能力审计

审计日期：2026-08-01  
审计基线：`main` / `4da3ac1`（功能分支开始前）  
审计方法：完整阅读路由、导航、16 表数据模型、`MouseKeeperService`、查询、备份、CSV、页面与测试；运行开发版并用 Chromium 逐页检查 16 个工作区的标题、链接、按钮、表单与控制台；运行 Lint、类型检查、67 个 Vitest 测试、构建及 Playwright 基线。

## 计算口径

- 一行表示一个可以独立触发、产生不同业务或界面结果的用户能力；没有把整个模块合并成一行。
- 单一表单内各字段共享同一校验与提交边界，因此“创建/编辑一个实体的全部 UI 可编辑字段”按一次提交能力计；状态、关系、批量、删除、恢复、文件和视图操作分别计数。
- 纯浏览器行为（安装 PWA、浏览器后退、系统下载落盘）不作为应用能力；应用主动发起下载、请求持久存储和未保存离开保护计入。
- “LLM 已覆盖”只有在能力可发现、可真实执行、有结果反馈、修改型能力有恢复记录且存在自动化测试时才记为“是”。下表冻结实现前基线，文件末尾给出最终逐行认证和覆盖率，避免抹去开发前证据。

## 能力矩阵

| # | 用户能力 | 当前 UI 入口 | 业务实现位置 | 所涉及实体 | 修改数据 | 可撤销 | LLM 已覆盖（实现前） | 对应测试 |
|---:|---|---|---|---|:---:|:---:|:---:|---|
| 1 | 打开一级工作区 | 桌面侧栏、移动导航 | `navigation.ts`、Wouter | 路由状态 | 否 | 不适用 | 否 | `e2e/app.spec.ts` 工作区 |
| 2 | 通过总览指标打开预筛选列表 | 总览指标卡 | `DashboardPage.tsx` | 路由/查询参数 | 否 | 不适用 | 否 | E2E 工作区 |
| 3 | 通过总览提醒打开数据、任务或小鼠 | 总览提醒与空状态链接 | `DashboardPage.tsx` | 路由状态 | 否 | 不适用 | 否 | 无专项测试 |
| 4 | 打开全局新建菜单 | 顶栏“新建” | `CreateMenu.tsx` | 界面状态 | 否 | 不适用 | 否 | E2E 间接覆盖 |
| 5 | 从新建菜单进入 6 种创建流程 | 顶栏新建菜单 | `CREATE_ACTIONS` | 路由状态 | 否 | 不适用 | 否 | E2E 核心流程 |
| 6 | 打开全局搜索 | 顶栏、`⌘/Ctrl+K` | `AppShell.tsx`、`GlobalSearchDialog.tsx` | 界面状态 | 否 | 不适用 | 否 | `App.test.tsx`、E2E |
| 7 | 搜索工作区、小鼠、笼位、实验、任务 | 全局搜索输入框 | `queries/search.ts` | 多实体 | 否 | 不适用 | 否 | `App.test.tsx` |
| 8 | 从全局搜索打开结果并恢复焦点 | 搜索结果、Esc/关闭 | `GlobalSearchDialog.tsx` | 路由/焦点 | 否 | 不适用 | 否 | E2E 焦点恢复 |
| 9 | 切换浅色、深色、跟随系统 | 侧栏/设置主题选择 | `ThemeProvider.tsx` | localStorage 偏好 | 是（偏好） | 可再次切换 | 否 | `App.test.tsx` 间接 |
| 10 | 离开未保存表单时得到保护 | 表单导航、后退、刷新 | `useUnsavedChanges.ts` | 浏览器导航 | 否 | 不适用 | 否 | E2E 未保存表单 |
| 11 | 查看总览统计、分布、容量、任务和活动 | 总览 | `loadDashboardSnapshot` | 多实体 | 否 | 不适用 | 否 | dashboard 查询测试/组件 |
| 12 | 搜索小鼠 | 小鼠列表搜索框 | `MicePage.tsx` | Mouse 及关联快照 | 否 | 不适用 | 否 | E2E 小鼠搜索 |
| 13 | 按性别筛选小鼠 | 小鼠列表筛选 | `MicePage.tsx` | Mouse | 否 | 不适用 | 否 | E2E 筛选 |
| 14 | 按状态筛选小鼠 | 小鼠列表筛选 | `MicePage.tsx` | Mouse | 否 | 不适用 | 否 | E2E 筛选 |
| 15 | 按品系/基因型筛选小鼠 | 小鼠列表筛选 | `MicePage.tsx` | Mouse | 否 | 不适用 | 否 | 服务/页面间接 |
| 16 | 按笼位筛选小鼠 | 小鼠列表筛选 | `MicePage.tsx` | Mouse、Cage | 否 | 不适用 | 否 | E2E 批量流程间接 |
| 17 | 按实验筛选小鼠 | 小鼠列表筛选 | `MicePage.tsx` | Mouse、ExperimentAssignment | 否 | 不适用 | 否 | 页面间接 |
| 18 | 按标签筛选小鼠 | 小鼠列表筛选 | `MicePage.tsx` | Mouse、Tag | 否 | 不适用 | 否 | 页面间接 |
| 19 | 按出生日期范围筛选小鼠 | 小鼠列表日期控件 | `MicePage.tsx` | Mouse | 否 | 不适用 | 否 | 页面间接 |
| 20 | 包含已删除小鼠 | 小鼠列表复选框 | `MicePage.tsx` | Mouse | 否 | 不适用 | 否 | E2E 回收流程间接 |
| 21 | 设置小鼠排序字段与方向 | 小鼠列表排序控件 | `MicePage.tsx` | 视图状态 | 是（偏好） | 可重设 | 否 | 页面间接 |
| 22 | 小鼠分页及每页数量 | 小鼠列表分页 | `MicePage.tsx` | 视图状态 | 是（偏好） | 可重设 | 否 | 页面间接 |
| 23 | 清除小鼠筛选 | 小鼠列表“清除” | `MicePage.tsx` | 视图状态 | 是（偏好） | 可重新应用 | 否 | E2E 筛选 |
| 24 | 选择单只、当前页或筛选结果中的小鼠 | 小鼠表格复选框 | `MicePage.tsx` | 当前选择 | 否 | 不适用 | 否 | E2E 批量流程 |
| 25 | 创建保存视图 | 小鼠“另存视图” | `createSavedView` | SavedView | 是 | 软删除/恢复 | 否 | service tests |
| 26 | 应用保存视图 | 小鼠视图选择 | `MicePage.tsx` | 视图状态、SavedView | 是（偏好） | 可切换 | 否 | E2E 间接 |
| 27 | 更新保存视图 | 保存视图菜单 | `updateSavedView` | SavedView | 是 | 否（基线） | 否 | service tests |
| 28 | 删除保存视图 | 保存视图菜单 | `softDeleteSavedView` | SavedView | 是 | Service 可恢复 | 否 | service tests |
| 29 | 创建单只小鼠并可初始分笼 | 小鼠新建表单 | `createMouseWithCage` | Mouse、CageAssignment、MouseEvent、Tag | 是 | 软删除（非整命令） | 否 | service tests、E2E |
| 30 | 复制现有小鼠为新记录 | 小鼠详情“复制” | `MouseFormPage.tsx` + `createMouseWithCage` | Mouse | 是 | 软删除 | 否 | 页面间接 |
| 31 | 原子批量创建小鼠 | “批量建档” | `createMice` | Mouse[] | 是 | 逐只软删除 | 否 | service tests、E2E |
| 32 | 编辑小鼠全部可编辑字段 | 小鼠详情“编辑” | `updateMouse` | Mouse | 是 | 否（revision 仅防冲突） | 否 | service tests、E2E |
| 33 | 批量更改小鼠状态 | 小鼠批量操作 | `changeMiceStatus` | Mouse[]、MouseEvent[] | 是 | 否（基线） | 否 | service tests、E2E |
| 34 | 单只更改小鼠状态 | 小鼠详情状态操作 | `changeMouseStatus` | Mouse、MouseEvent | 是 | 否（基线） | 否 | service tests |
| 35 | 终结小鼠状态并结束关系 | 状态操作的死亡/安乐死/转出 | `terminateMouse`/`changeMouseStatus` | Mouse、笼位/实验关系、事件 | 是 | 否（基线） | 否 | service tests |
| 36 | 批量转笼 | 小鼠批量操作 | `moveMice` | Mouse[]、CageAssignment[]、MouseEvent[] | 是 | 否（可再转但非精确） | 否 | service tests、E2E |
| 37 | 单只移入/转入笼位 | 小鼠或笼位详情 | `moveMouse` | Mouse、CageAssignment、MouseEvent | 是 | 否（可再转但非精确） | 否 | service tests、E2E |
| 38 | 单只移出笼位 | 小鼠或笼位详情 | `leaveCage` | Mouse、CageAssignment、MouseEvent | 是 | 否（基线） | 否 | service tests |
| 39 | 批量增删标签 | 小鼠批量操作 | `setMiceTags` | Mouse[]、Tag | 是 | 否（基线） | 否 | service tests、E2E |
| 40 | 单只设置标签 | 小鼠详情标签编辑 | `setMouseTags` | Mouse、Tag | 是 | 否（基线） | 否 | service tests |
| 41 | 创建标签并立即关联 | 小鼠详情“新建标签” | `createTag` + `setMouseTags` | Tag、Mouse | 是 | 可删标签/解除关系 | 否 | service tests |
| 42 | 删除标签 | 标签操作/回收链路 | `softDeleteTag` | Tag、Mouse | 是 | `restoreTag` | 否 | service tests |
| 43 | 软删除小鼠 | 小鼠详情“移到回收站” | `softDeleteMouse` | Mouse、关系 | 是 | `restoreMouse` | 否 | service tests、E2E |
| 44 | 从回收站恢复小鼠 | 数据与安全/回收站 | `restoreMouse` | Mouse | 是 | 可再删除 | 否 | service tests、E2E |
| 45 | 查看小鼠详情、谱系、笼位、实验、体重和时间线 | 小鼠详情 | Dexie 响应式查询 | 多实体关系 | 否 | 不适用 | 否 | E2E 核心流程 |
| 46 | 创建一般事件 | 小鼠详情事件表单 | `createMouseEvent` | MouseEvent、Mouse | 是 | `softDeleteMouseEvent` | 否 | service tests、E2E |
| 47 | 编辑一般事件 | 小鼠详情时间线 | `updateMouseEvent` | MouseEvent | 是 | 否（基线） | 否 | service tests |
| 48 | 软删除事件或配对体重 | 小鼠详情时间线 | `softDeleteMouseEvent` | MouseEvent、WeightRecord | 是 | `restoreMouseEvent` | 否 | service tests |
| 49 | 从回收站恢复事件或配对体重 | 数据与安全/回收站 | `restoreMouseEvent` | MouseEvent、WeightRecord | 是 | 可再删除 | 否 | service tests |
| 50 | 记录单次体重 | 小鼠详情称重表单 | `recordWeight` | WeightRecord、MouseEvent | 是 | 软删除配对事件 | 否 | service tests、E2E |
| 51 | 快速批量记录体重 | 记录/快速称重 | `recordWeights` | WeightRecord[]、MouseEvent[] | 是 | 逐项软删除 | 否 | service tests、E2E |
| 52 | 搜索笼位 | 笼位列表搜索 | `CagesPage.tsx` | Cage | 否 | 不适用 | 否 | 页面/E2E 间接 |
| 53 | 查看笼位容量、成员和转笼历史 | 笼位详情 | Dexie 响应式查询 | Cage、Mouse、CageAssignment | 否 | 不适用 | 否 | E2E 核心流程 |
| 54 | 创建笼位 | 笼位新建表单 | `createCage` | Cage | 是 | 软删除 | 否 | service tests、E2E |
| 55 | 编辑笼位全部可编辑字段 | 笼位详情“编辑” | `updateCage` | Cage | 是 | 否（基线） | 否 | service tests |
| 56 | 从笼位详情选择小鼠移入 | 笼位详情“移入” | `moveMouse` | CageAssignment、MouseEvent、Mouse | 是 | 否（基线） | 否 | service tests |
| 57 | 从笼位详情移出成员 | 笼位详情成员操作 | `leaveCage` | CageAssignment、MouseEvent、Mouse | 是 | 否（基线） | 否 | service tests |
| 58 | 软删除空笼位 | 笼位详情“删除” | `softDeleteCage` | Cage | 是 | `restoreCage` | 否 | service tests |
| 59 | 从回收站恢复笼位 | 数据与安全/回收站 | `restoreCage` | Cage | 是 | 可再删除 | 否 | service tests |
| 60 | 查看繁育组合与窝列表 | 繁育列表/详情 | Dexie 响应式查询 | BreedingPair、Litter、Mouse | 否 | 不适用 | 否 | E2E 繁育流程 |
| 61 | 创建繁育组合并处理规则警告 | 繁育新建表单 | `createBreedingPair` | BreedingPair、Mouse | 是 | 否（基线） | 否 | service tests、E2E |
| 62 | 编辑繁育日期、状态和备注 | 繁育详情 | `updateBreedingPair` | BreedingPair | 是 | 否（基线） | 否 | service tests |
| 63 | 原子创建窝和后代 | 繁育详情“记录一窝” | `createLitterWithOffspring` | Litter、Mouse[]、BreedingPair | 是 | 否（基线） | 否 | service tests、E2E |
| 64 | 查看实验、组别和成员 | 实验列表/详情 | Dexie 响应式查询 | Experiment、Group、Assignment、Mouse | 否 | 不适用 | 否 | E2E 实验流程 |
| 65 | 创建实验及初始组别 | 实验新建表单 | `createExperimentWithInitialGroup` | Experiment、ExperimentGroup | 是 | 软删实验（非整命令） | 否 | service tests、E2E |
| 66 | 编辑实验全部可编辑字段 | 实验详情“编辑” | `updateExperiment` | Experiment | 是 | 否（基线） | 否 | service tests |
| 67 | 创建实验组别 | 实验详情“新建组别” | `createExperimentGroup` | ExperimentGroup | 是 | 否（基线） | 否 | service tests |
| 68 | 批量将小鼠加入实验组 | 实验详情成员选择 | `assignMiceToExperiment` | ExperimentAssignment[]、MouseEvent[] | 是 | 可退出但非精确 | 否 | service tests、E2E |
| 69 | 单只加入实验组 | Service 能力/批量入口单选 | `assignMouseToExperiment` | ExperimentAssignment、MouseEvent | 是 | 可退出但非精确 | 否 | service tests |
| 70 | 单只退出实验 | 实验详情成员操作 | `exitExperimentAssignment` | ExperimentAssignment、MouseEvent | 是 | 否（基线） | 否 | service tests |
| 71 | 批量退出实验 | 实验详情批量操作 | `exitExperimentAssignments` | ExperimentAssignment[]、MouseEvent[] | 是 | 否（基线） | 否 | service tests |
| 72 | 软删除实验 | 实验详情“删除” | `softDeleteExperiment` | Experiment、关系 | 是 | `restoreExperiment` | 否 | service tests |
| 73 | 从回收站恢复实验 | 数据与安全/回收站 | `restoreExperiment` | Experiment | 是 | 可再删除 | 否 | service tests |
| 74 | 切换事件、体重、活动日志记录视图 | 记录中心标签 | `RecordsPage.tsx` | 视图状态 | 否 | 不适用 | 否 | 页面/E2E |
| 75 | 搜索/按小鼠筛选记录 | 记录中心搜索和选择 | `RecordsPage.tsx` | MouseEvent、Weight、ActivityLog | 否 | 不适用 | 否 | 查询/页面测试 |
| 76 | 创建任务并关联小鼠/笼位/实验 | 任务新建表单 | `createTask` | Task、关联实体 | 是 | 软删除 | 否 | service tests、E2E |
| 77 | 编辑任务全部可编辑字段 | 任务“编辑” | `updateTask` | Task | 是 | 否（基线） | 否 | service tests |
| 78 | 按待处理/完成/取消/全部筛选任务 | 任务状态标签 | `TasksPage.tsx` | Task | 否 | 不适用 | 否 | E2E 间接 |
| 79 | 完成任务 | 任务行内操作 | `setTaskStatus` | Task | 是 | 可恢复为待处理 | 否 | service tests、E2E |
| 80 | 取消任务 | 任务行内操作 | `setTaskStatus` | Task | 是 | 可恢复为待处理 | 否 | service tests |
| 81 | 恢复任务为待处理 | 已完成/取消任务行内操作 | `setTaskStatus` | Task | 是 | 可再次变更 | 否 | service tests |
| 82 | 软删除任务 | 任务行内操作 | `softDeleteTask` | Task | 是 | `restoreTask` | 否 | service tests |
| 83 | 从回收站恢复任务 | 数据与安全/回收站 | `restoreTask` | Task | 是 | 可再删除 | 否 | service tests |
| 84 | 导出完整 JSON 备份 | 数据与安全/备份 | `exportDatabaseBackup` + `downloadBlob` | 16 张业务表 | 否 | 不适用 | 否 | `backup.test.ts`、E2E |
| 85 | 选择并预检 JSON 恢复文件 | 数据与安全/备份文件框 | `createRestorePreview` | File、BackupEnvelope | 否 | 不适用 | 否 | `backup.test.ts` |
| 86 | 用 JSON 替换恢复整个数据库 | 输入确认短语后恢复 | `restoreDatabaseBackup` | 16 张业务表 | 是（全库） | 自动下载恢复前副本 | 否 | `backup.test.ts` |
| 87 | 选择、解析和预览小鼠 CSV | 数据与安全/CSV 导入 | `parseCsvPreview`、`validateMouseImport` | File、Mouse 草稿 | 否 | 不适用 | 否 | CSV/import tests、E2E |
| 88 | 自动建议并手动修改 CSV 字段映射 | CSV 预览映射控件 | `suggestMouseFieldMapping` | 导入视图状态 | 是（临时） | 可重设 | 否 | import tests |
| 89 | 逐行提交合法 CSV 小鼠 | CSV“开始导入” | `commitMouseImport` + Service | Mouse、Tag、CageAssignment | 是 | 逐只软删除（非整批） | 否 | import runner tests、E2E |
| 90 | 导出小鼠 CSV | 数据与安全/CSV 导出 | `exportMiceCsv` | Mouse、Cage、Tag | 否 | 不适用 | 否 | exporter tests、E2E |
| 91 | 导出笼位 CSV | 数据与安全/CSV 导出 | `exportCagesCsv` | Cage、Assignment | 否 | 不适用 | 否 | exporter tests |
| 92 | 导出实验 CSV | 数据与安全/CSV 导出 | `exportExperimentsCsv` | Experiment、Group、Assignment | 否 | 不适用 | 否 | exporter tests |
| 93 | 导出体重 CSV | 数据与安全/CSV 导出 | `exportWeightsCsv` | WeightRecord、Mouse | 否 | 不适用 | 否 | exporter tests |
| 94 | 导出事件 CSV | 数据与安全/CSV 导出 | `exportEventsCsv` | MouseEvent、关联实体 | 否 | 不适用 | 否 | exporter tests |
| 95 | 从回收站恢复标签 | 数据与安全/回收站 | `restoreTag` | Tag | 是 | 可再删除 | 否 | service tests |
| 96 | 永久删除回收站小鼠及允许的依赖 | 回收站“永久删除” | `createPurgePreview`、`purgeDeletedEntity` | Mouse 及依赖 | 是（不可逆） | 仅外部完整备份 | 否 | permanent-delete tests |
| 97 | 永久删除回收站笼位 | 回收站“永久删除” | 同上 | Cage | 是（不可逆） | 仅外部完整备份 | 否 | permanent-delete tests |
| 98 | 永久删除回收站实验 | 回收站“永久删除” | 同上 | Experiment | 是（不可逆） | 仅外部完整备份 | 否 | permanent-delete tests |
| 99 | 永久删除回收站任务 | 回收站“永久删除” | 同上 | Task | 是（不可逆） | 仅外部完整备份 | 否 | permanent-delete tests |
| 100 | 永久删除回收站标签 | 回收站“永久删除” | 同上 | Tag | 是（不可逆） | 仅外部完整备份 | 否 | permanent-delete tests |
| 101 | 永久删除允许删除的事件/体重对 | 回收站“永久删除” | 同上 | MouseEvent、WeightRecord | 是（不可逆） | 仅外部完整备份 | 否 | permanent-delete tests |
| 102 | 生成示例数据批次 | 数据与安全/示例数据 | `generateSampleData` | 多实体 | 是 | 整批删除 | 否 | service tests、E2E |
| 103 | 删除指定示例数据批次 | 示例批次操作 | `deleteSampleBatch` | 多实体 | 是（物理删除样本） | 否（基线） | 否 | service tests |
| 104 | 请求浏览器持久存储 | 设置/浏览器存储 | `navigator.storage.persist` | 浏览器存储策略 | 是（浏览器） | 由浏览器决定 | 否 | 无自动化专项 |
| 105 | 查看存储占用、持久状态和数据库版本 | 设置 | Storage API、Dexie | 系统信息 | 否 | 不适用 | 否 | E2E 工作区 |
| 106 | 运行数据库完整性扫描 | 设置 | `scanIntegrity` | 16 张业务表 | 否 | 不适用 | 否 | backup/service tests 间接 |

## 实现前结论

- 基线独立能力总数：**106**。
- LLM 完整覆盖：**0 / 106（0%）**；仓库在本次开发前没有 Provider、Agent、自然语言工具、恢复点或命令撤销实现。
- 业务写入基础较好：页面业务写入均调用 `MouseKeeperService`，源码搜索未发现页面直接 `add/put/update/delete` Dexie；但备份、CSV、永久删除、主题、导航、Storage API 与完整性扫描仍在 Service 之外。
- 基线撤销仅限软删除/恢复、可逆状态再操作和全库恢复前安全副本；没有“整个自然语言命令”的精确快照、冲突检查或一键撤回。
- 基线没有右键菜单；可见键盘命令为全局搜索 `⌘/Ctrl+K`，表单另有标准 Enter/浏览器导航行为。
- 真实浏览器核验的 16 个工作区均能渲染且无控制台错误。项目 Playwright 预览服务器在长串测试中曾中途退出，已记录为基线运行环境问题，后续使用稳定外部服务器复验。

## 审计证据

- UI 自动盘点脚本：`agent-notes/llm-agent/ui_inventory.py`（开发服务器 + headless Chromium，等待 `networkidle` 后读取）。
- 核心代码：`src/App.tsx`、`src/layout/*`、`src/features/**/*Page.tsx`、`src/services/mousekeeper-service.ts`、`src/services/permanent-delete.ts`、`src/backup/*`、`src/import-export/*`、`src/db/*`。
- 自动化：`src/**/*.test.ts(x)`、`e2e/app.spec.ts`。
- 文档交叉核验：`README.md`、`docs/architecture.md`、`docs/data-model.md`、`docs/backup-and-recovery.md`、既有 `agent-notes/*`。

## 实现后覆盖认证

最终认证日期：2026-08-01

| 审计行 | 最终覆盖 | LLM 路径 | 自动化证据 | 恢复证据 |
|---|:---:|---|---|---|
| 1～106 | 是 | `search_capabilities` → 严格 `execute_capability` → production Registry/Service 或稳定 application adapter | `CAP-001`～`CAP-106` 逐行唯一映射；每个预期调用均对 production descriptor 验证完整 runtime JSON Schema、风险和恢复策略；底层 Service、备份、CSV、查询、视图和 E2E 测试验证真实实现 | 所有 `modifiesData` 能力在首次写入前持久化一致 before；小范围用 row diff，高影响用 full backup；整命令撤回与冲突检查由 recovery/execution eval 验证 |

最终能力总数为 **106**，完整覆盖 **106**，未覆盖 **0**，覆盖率 **100%**。没有通过合并行或缩小分母改变基线。浏览器安全边界下，第 85 项 JSON 文件和第 87 项 CSV 文件仍必须由用户手势选择；选择完成后 Agent 会执行只读 preview，并按原始明确指令自动继续 commit，因此主体工作流已覆盖，不计为缺口。

分层证据如下：

- 发现与参数：69 个基线 application capabilities 与 8 个新增 Agent 设置 capabilities 全部注册到同一 production Registry；模型只获得工具搜索与严格执行两个稳定入口。106 个审计行各有独立 `CAP-nnn`，复合 UI 能力保留所需的多 capability 顺序。
- 真实执行：业务写入复用 `MouseKeeperService` 的事务、幂等、revision 和规则测试；application tests 直接执行视图、导航、文件、Storage 与数据适配器；9 条 execution eval 使用真实 Registry、Dexie、Service 和 RecoveryManager 验证数据库结果与撤回。
- 上下文与 UI：页面发布真实筛选、排序、分页和全部选择；新建菜单、搜索、路由、未保存导航保护以及桌面/Pixel 7 Agent 设置均有组件或 Playwright 证据。
- 文件与高风险操作：JSON/CSV 强制 `request → preview → 一次性 token commit`；备份替换、CSV 导入、代表性永久删除和失败但已变更均有真实执行与整命令撤回测试。
- 评测边界：288 条默认评测是确定性契约/执行评测，不等价于真实远程模型的开放语言语义准确率。仓库无 Provider 凭据，因此没有把未运行的真实 API 评测计入覆盖证据。

## 最终未覆盖事项

无。真实 Provider 语义质量、Safari/真实移动设备和超大数据库基准属于已知验证限制，不是 106 项现有 UI 用户能力中的未实现能力。
