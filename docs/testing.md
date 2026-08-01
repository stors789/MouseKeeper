# 测试与验收

## 1. 命令

    npm run lint
    npm run typecheck
    npm test
    npm run test:coverage
    npm run build
    npm run test:e2e

test:e2e 会先执行生产构建，再用 preview 服务运行 Desktop Chrome 和 Pixel 7 Chromium 项目。失败时保存 trace，失败页面截图；CI 可重试两次，本地不重试。

## 2. 当前自动化覆盖

### Vitest

当前 11 个测试文件、67 个测试覆盖：

- 严格日历日期、当地时间、年龄、周龄、未来生日和 IANA 时区投影；
- 活动耳标唯一、幂等重放、revision、容量确认和活动笼位唯一；
- 创建小鼠与初始笼位、批量状态/转笼/标签的事务原子性；
- 父母性别警告、自我父母、谱系循环、繁育日期/状态、窝及批量后代；
- 实验互斥组、批量加入/退出、终结状态关闭活动关系；
- 体重/事件创建、编辑、删除、恢复、损坏配对回滚和快速称重；
- 软删除、冲突恢复、引用阻止的永久删除和幂等审计墓碑；
- CSV BOM/引号/多行、映射、日期/枚举、重复行隔离、逐行导入、五类导出和公式注入中和；
- 16 表 JSON round-trip、canonical SHA-256、大小限制、缺表/计数/校验和/未来 schema/重复主键/非法行/缺引用拒绝，以及恢复故障注入回滚；
- 示例批次闭合删除和 16 表完整性扫描；
- 自定义 Select 的 label、required、description 和 error 语义。

fake-indexeddb 不能证明真实浏览器配额、Service Worker、下载和多标签页行为，因此保留 Playwright 层。

### Playwright

e2e/app.spec.ts 的 11 个逻辑场景映射到两个项目。最近一次完整执行结果记录在 agent-notes/final-test-report.md。

覆盖场景：

1. 九个工作区首次打开、无 console/page error、无整页横向溢出、切换深色主题；
2. 未保存小鼠表单离开时取消/确认；
3. 全局搜索打开后聚焦输入，Escape 关闭后恢复到触发按钮；
4. Pixel 7 的批量建档、示例数据、快速称重和笼位成员子路由；
5. 建笼、建鼠并初始分笼、记录体重、创建关联任务（桌面和 Pixel 7 都执行）；
6. 编辑、搜索、性别筛选、批量状态、批量转笼、软删除、回收站恢复、刷新持久化；
7. 父母、繁育组合、窝和原子后代；
8. 体重趋势、一般事件、实验与组、加入小鼠、完成任务和跨模块历史；
9. 示例数据、JSON 下载、损坏备份 UI 拒绝、修改数据、上传原备份、确认恢复和恢复后计数；
10. CSV 一行有效/一行错误预览、部分成功导入和五类 CSV 下载；
11. 已由 Service Worker 控制后，离线打开此前未访问的设置工作区。

移动项目跳过桌面专属的下载、文件上传、密集批量、繁育/实验长流程和离线重复检查；桌面项目跳过只针对窄屏的子路由检查。这些是按项目分工的跳过，不是运行失败。

## 3. 核心需求映射

| 需求 | 主要证据 |
|---|---|
| 首次启动/工作区 | Playwright 场景 1 |
| 建笼、建鼠、初始分笼 | 场景 4 + service 测试 |
| 编辑、搜索、筛选、批量状态/转笼 | 场景 5 + service 测试 |
| 繁育、窝、后代 | 场景 6 + pedigree/service 测试 |
| 体重、趋势、事件 | 场景 4/7 + Weight/Event 原子测试 |
| 实验与分组 | 场景 7 + exclusion/replay 测试 |
| 任务创建/完成 | 场景 4/7 |
| JSON 导出/恢复 | 场景 8 + backup 测试 |
| 损坏备份拒绝 | backup.test.ts |
| CSV 预览/部分成功/导出 | 场景 9 + import-export 测试 |
| 软删除/恢复/永久删除 | 场景 5 + permanent-delete 测试 |
| 刷新保留 | 场景 5 |
| 手机主要流程 | 场景 1/3/4 的 Pixel 7 项目 |
| 深色/无横向溢出 | 场景 1/3 |
| PWA 离线 | 场景 10 |

## 4. 手工/专项检查

最终验收还包括：

- git diff --check 与工作区/忽略规则检查；
- rg 搜索 TODO、FIXME、dangerouslySetInnerHTML、eval、密钥和常见 Token 模式；
- npm audit 依赖审计；
- Vite bundle 体积与路由 chunk 检查；
- 交付文档链接、示例 CSV 和备份说明人工核对。

结果必须记录在最终测试报告，不能仅凭本文件视为通过。

## 5. 尚未自动验证

- Firefox、WebKit/Safari、Windows Edge 和真实移动设备；
- 真正关闭浏览器进程/操作系统后重开、多标签页升级阻塞和站点存储清理恢复；
- 屏幕阅读器、语音控制和完整 WCAG 2.2 人工审计；
- 磁盘耗尽、真实配额拒绝和 100 MB 备份；
- 5,000/1,000/50,000/20,000 最大规模在多台真实机器上的 p50/p95 与峰值内存；
- 未来 schemaVersion 的真实数据库升级（v1 没有旧生产 schema）。

详见 known-limitations.md 和 agent-notes/10_performance_review.md。

## 6. 发布前顺序

1. 确认 git status 和本次差异。
2. 运行 lint、typecheck、Vitest、coverage、build、完整 Playwright。
3. 检查浏览器控制台、失败 trace 和报告。
4. 生成示例数据，完成 JSON round-trip 和 CSV 部分成功演练。
5. 检查桌面、Pixel 7、深色、离线和未保存导航。
6. 检查敏感文件、依赖审计、bundle 和文档。
7. 只在最终 HEAD 重跑通过且工作区干净后交付。
