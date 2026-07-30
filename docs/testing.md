# MouseKeeper 测试与验收说明

## 文档状态

本文定义 v1 测试矩阵，并记录 2026-07-30 23:46 CST 静态基线。本文档工作没有运行
lint、类型检查、单元测试、E2E、构建或浏览器测试，因此不声明任何命令通过。

基线中可确认：

- `npm run lint`、`typecheck`、`test`、`test:coverage`、`test:e2e` 和 `build` 脚本已配置；
- Vitest 使用 jsdom，`src/test/setup.ts` 加载 jest-dom 与 fake-indexeddb；
- 现有单元测试仅验证 App 渲染集中配置的产品名；
- Playwright 配置桌面 Chromium 与 Pixel 7 两个项目，使用 production build + preview；
- 基线中没有 `e2e/` 测试文件；
- coverage 使用 V8 text/html reporter，尚未配置覆盖率阈值；
- Firefox、WebKit、Windows 和 macOS 的真实平台矩阵尚未配置或验证。

## 1. 运行命令

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
npm run test:e2e
```

`npm run test:e2e` 会先执行 production build，再在 `127.0.0.1:4173` 启动 preview。
Playwright 在本地失败时保留 trace，并仅在失败时截图；CI 配置为最多重试两次。重试后的
通过必须同时检查首次失败，不能用重试掩盖不稳定测试。

## 2. 测试层级

| 层级 | 工具 | 责任 |
|---|---|---|
| 纯单元 | Vitest | 日期、规范化、Zod、派生计算、状态规则、CSV 行解析 |
| 数据/服务集成 | Vitest + fake-indexeddb | Dexie schema、事务、operationId、revision、软删除、备份和 migration |
| 组件 | Testing Library + user-event | 表单错误、焦点、确认流程、键盘和状态反馈 |
| E2E | Playwright | 真实路由、IndexedDB 持久化、核心闭环、移动视口、下载/上传 |
| 真浏览器专项 | Playwright/人工 | 多标签页、versionchange、PWA 安装/离线/更新、下载权限 |
| 性能 | 可重复 fixture + 浏览器测量 | 目标数据量查询、渲染、导入导出、恢复、内存 |
| 视觉/a11y | 截图、键盘、语义检查 | 360px、桌面、深色、长文本、对比度、焦点 |

fake-indexeddb 不能证明真实浏览器的配额、锁、versionchange、下载和 Service Worker 行为；
这些必须保留真浏览器测试。

## 3. 单元与服务测试矩阵

下表状态均为“待实现/待运行”，除非后续验收报告附上具体测试文件和运行输出。

| ID | 范畴 | 必测案例 |
|---|---|---|
| U-01 | 日期 | 严格日期、闰年、非法月日、未来生日、自然日与 UTC 不错日 |
| U-02 | 年龄 | 生日当天、跨年、周龄取整、未知出生日期 |
| U-03 | 规范化 | NFKC、大小写、首尾/连续空白、全角字符、空耳标 |
| U-04 | 唯一性 | 活动耳标、笼号、CageAssignment、组内及互斥 assignment |
| U-05 | 幂等并发 | 同 operationId 重试、revision 冲突、两个并发转笼至多一个成功 |
| U-06 | 笼位容量 | 低于 80%、达到阈值、刚好满、超容确认、确认后并发变化 |
| U-07 | 软删除 | 释放 active key、恢复冲突、恢复成功、历史引用保留 |
| U-08 | 状态终结 | 死亡/安乐死关闭笼位、实验、繁育关系并保留历史 |
| U-09 | 谱系 | 性别 warning、自我父母、二节点/多节点循环、父母日期、重复组合 |
| U-10 | 后代批量 | 任一 ID/耳标/日期失败时整窝回滚，无孤立 Mouse |
| U-11 | 实验 | group 归属、重复加入、互斥冲突、终结状态 warning、退出原因 |
| U-12 | 体重 | 正值/单位/克换算、相邻变化、异常只提示、Weight/Event 一对一 |
| U-13 | 事件 | 判别联合 payload、未知类型/版本、系统事件不可独立编辑 |
| U-14 | 任务 | 待处理/完成/取消、completedAt 一致、逾期边界、对象删除 |
| U-15 | 标签 | 批量增删、Tag 删除解除引用、事件与日志同事务 |
| U-16 | CSV | BOM、CRLF、引号内换行、非法日期/枚举、重复、错误行隔离 |
| U-17 | 备份 | 16 key、table count、canonical checksum、空库/非空库 round-trip |
| U-18 | 恢复拒绝 | 截断 JSON、错误 checksum、未来版本、重复 PK、缺引用、谱系环 |
| U-19 | 恢复回滚 | bulkAdd 注入 Abort/Quota/Constraint 后旧库语义不变 |
| U-20 | 示例数据 | 闭合批次删除、混合真实引用时拒绝、不留孤儿 |
| U-21 | 完整性扫描 | 投影漂移、活动孤儿、Weight/Event 缺边、可修复项写日志 |
| U-22 | SavedView | queryVersion、非法 filters、删除关联后的部分失效 |

每个跨表动作至少有一条“中途抛错后所有表均未部分变化”的故障注入测试。

## 4. Migration 测试矩阵

| ID | 必测案例 | 验收 |
|---|---|---|
| M-01 | 空库创建 v1 | 16 表和预期索引存在 |
| M-02 | v1 非空 fixture 打开 | 主键、字段、引用和计数保持 |
| M-03 | 未来 v2 fixture 逐版升级 | 只按 v1→v2 顺序执行 |
| M-04 | helper key 回填冲突 | upgrade abort，不随机丢数据 |
| M-05 | upgrade 人工抛错 | version 不提升，无部分回填 |
| M-06 | 旧枚举/缺字段 | 按书面策略转换或明确失败 |
| M-07 | 软删除记录 | 不重建活动唯一 key |
| M-08 | 旧标签页阻塞 | 显示指引；关闭后继续 |
| M-09 | versionchange | 旧页停止写并关闭连接 |
| M-10 | PWA 新壳 + 旧 DB | 更新后正确升级并可离线重载 |
| M-11 | 旧备份内存迁移 | 原文件不变，迁移后再校验 |
| M-12 | 配额不足 | 旧数据库保持并进入恢复路径 |

当前没有 migration 实现或 fixture，上表全部待实现和运行。详细策略见
[迁移说明](./migrations.md)。

## 5. E2E 核心矩阵

用例使用稳定 `data-testid` 或可访问 role/name，不能依赖 Tailwind class 或易变布局文本。
每个数据用例使用独立数据库实例或明确清理其测试数据库，绝不清理用户数据库。

| ID | 流程 | 关键断言 |
|---|---|---|
| E-01 | 首次启动 | 空库说明、建笼/导入/示例入口真实可用 |
| E-02 | 创建笼位 | 保存后出现在列表和详情 |
| E-03 | 创建小鼠并分笼 | Mouse、assignment、容量和详情一致 |
| E-04 | 编辑小鼠 | revision 递增，刷新后保留 |
| E-05 | 搜索小鼠 | 耳标/编号/名称命中并可进入详情 |
| E-06 | 组合筛选 | 条件可见、一键清除、空结果可恢复 |
| E-07 | 批量修改状态 | 影响范围明确，失败整批回滚 |
| E-08 | 转笼 | 旧 assignment 关闭，新 assignment 唯一，时间线存在 |
| E-09 | 容量超限 | 强警告、原因、确认记录；并发变化重新提示 |
| E-10 | 创建繁育组合 | 性别/终结状态 warning 和重复提示 |
| E-11 | 创建窝记录 | 数量和日期校验，组合双向可见 |
| E-12 | 从窝创建后代 | 父母/窝自动关联，整批原子 |
| E-13 | 记录体重 | 数值与只读事件同时出现 |
| E-14 | 查看体重趋势 | 排序、相邻变化和异常提示正确 |
| E-15 | 创建实验和组 | 至少一个组，状态和日期持久化 |
| E-16 | 加入/退出实验组 | 重复/互斥阻止，历史保留 |
| E-17 | 创建事件 | 类型字段、对象关联和时间线正确 |
| E-18 | 创建/完成/恢复任务 | 状态、完成时间、逾期分组刷新后保持 |
| E-19 | 导出 JSON | 文件含版本、checksum、16 表和计数 |
| E-20 | 恢复 JSON | 替换预览、安全备份、恢复后回到导出状态 |
| E-21 | 拒绝损坏备份 | 写前失败，当前数据库不变 |
| E-22 | CSV 导入预览 | 映射、逐行错误和重复清晰 |
| E-23 | CSV 部分成功 | 合法行成功、错误行失败、报告精确 |
| E-24 | 软删除和恢复 | 回收站、唯一冲突和历史引用正确 |
| E-25 | 刷新/重启持久化 | 所有关键事实仍在 IndexedDB |
| E-26 | 手机核心路径 | 390px 完成查鼠、转笼、称重、状态、事件和任务 |
| E-27 | 示例数据删除 | 只删除 sampleBatchId 闭合子图 |
| E-28 | 保存视图 | 返回列表后筛选、排序、列和密度恢复 |

仲裁指定的第一条纵向路径必须优先自动化：

```text
空库 → 建笼 → 建鼠并分笼 → 刷新仍存在 → 转笼 → 记录体重
→ 创建任务并完成 → 导出备份 → 修改/删除数据 → 恢复 → 回到导出状态
```

在该路径稳定通过前，不以装饰图表或次要偏好测试替代核心数据验收。

## 6. PWA 与离线测试

PWA 必须针对 production build 测试：

1. 在线首次打开并等待 Service Worker 控制页面；
2. 检查 manifest 名称、start URL、standalone display、192/512 和 maskable 图标；
3. 创建可辨识业务数据；
4. 关闭网络并从新标签/已安装入口重载；
5. 确认应用壳可打开，IndexedDB 数据可读写；
6. 恢复网络并部署新 cache version；
7. 确认旧 cache 清理、更新提示和新壳加载；
8. 确认数据库未被 Service Worker 更新清除；
9. 两个标签页联合验证 versionchange/blocked。

当前只静态确认 manifest、图标文件、`sw.js` 和生产注册代码存在；尚未确认安装条件、缓存所有
构建资产、断网重载或更新行为。

## 7. 响应式、视觉和可访问性矩阵

| 范畴 | 视口/输入 | 验收 |
|---|---|---|
| 桌面宽屏 | 1440px | 侧栏、表格、详情层级清晰，无无意义卡片墙 |
| 笔记本 | 1024px | 操作不被截断，表格仅自身必要滚动 |
| 手机 | 360×800 / Pixel 7 | 无整页横向滚动，底栏五项，触控目标至少 44px |
| 深色 | 系统/手动 | 非简单反相，状态对比可读 |
| 键盘 | Tab/Shift+Tab/Enter/Space/Escape | 顺序合理、焦点可见、对话框锁焦与关闭后恢复 |
| 屏幕阅读 | role/name/label | 表单和状态有语义，状态不只依赖颜色 |
| 减少动画 | `prefers-reduced-motion` | 非必要动画被移除 |
| 长内容 | 64 字符 ID、长品系、2,000 字备注、中英混排 | 不破坏布局，可查看全文和复制 |
| 失败状态 | IndexedDB 写入/加载失败 | 输入保留，页面内持续错误和重试 |
| 空/加载 | 空数据库、空筛选、慢查询 | 有下一步；Skeleton 与最终结构一致 |

## 8. 性能与容量测试

标准 fixture 至少包含：

- 5,000 Mouse；
- 1,000 Cage；
- 50,000 MouseEvent；
- 20,000 WeightRecord；
- 足量 assignment、task、tag 和 activity log 形成真实关联。

必须测量并保存：

- 小鼠列表初始查询、筛选、排序和翻页/虚拟滚动；
- 全局搜索和事件时间线分段加载；
- 仪表盘聚合；
- CSV 预览、合法行提交和结果报告；
- JSON 导出 Blob 大小、生成时间和峰值内存；
- 完整恢复、checksum、Zod 和引用审计；
- IndexedDB 体积、索引体积与浏览器内存；
- p50/p95 耗时以及测试机器、浏览器和数据种子。

本文件不虚构性能阈值。首轮基线测量后由主代理给出明确预算；在此之前，验收底线是常用
路径无 O(n²)，长列表不一次渲染全部记录，50,000 条时间线不一次载入。

## 9. 浏览器和平台覆盖

当前 Playwright 自动配置：

- Chromium Desktop；
- Chromium Pixel 7 模拟。

发布前仍需补充或手工证明：

- macOS Chrome/Chromium；
- macOS Safari/WebKit，重点是 IndexedDB 配额、下载与 PWA；
- Windows Chrome/Edge；
- 至少一个真实手机浏览器；
- 多标签页、关闭浏览器后持久化、站点存储持久化请求的真实结果。

未覆盖的平台必须在发布报告中列为“未验证”，不能从 Chromium 模拟推断通过。

## 10. 发布检查与证据格式

建议完整检查顺序：

```bash
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
npm run test:e2e
```

发布报告对每项记录：

- 命令和运行时间；
- commit SHA；
- Node、浏览器和操作系统版本；
- 通过/失败/未运行；
- 测试数量和失败名称；
- E2E trace/screenshot 位置；
- 性能 fixture seed 和测量；
- 环境限制及替代验证。

停止条件：

- lint、类型检查、单元/集成、核心 E2E 和生产构建实际通过；
- 无阻断数据完整性问题；
- IndexedDB 刷新和浏览器重启持久化通过；
- 完整备份 round-trip 与损坏备份拒绝通过；
- CSV 预览、逐行隔离和报告通过；
- 手机核心路径、浅/深色、键盘和离线重载有实际证据；
- 最终 HEAD 与被测试代码一致。

本次文档提交只定义上述契约，没有产生测试通过证据。
