# Iteration 04 — 生产路由、批量操作与 PWA

> 范围：commit `aaae38f` 至 `6c18e7e`，共 10 个真实提交。
> 独立复核：初始 UI/产品架构审查结论，以及最终 `workflow_review_sol` 对当前闭环的回溯检查。
> 记录性质：交付时依据 Git、测试代码和最终浏览器回归整理；没有保留的当轮输出不补写成“当时已通过”。

## 检查范围

- 批量建档与批量状态、转笼、标签；
- 所有生产路由、响应式工作区和自定义 Select；
- 初始分笼原子性、备份/离线失败路径；
- 路由拆包、PWA 预缓存和第一版纵向 E2E。

## 发现与处理（10 / 10）

1. 批量建档只有页面草图：增加服务命令、逐行输入与全批事务。
2. 多个生产子路由仍未接到 App：补齐详情、编辑、批量和快速称重路由。
3. 业务工作区视觉密度不一致：统一卡片、表格、工具栏、窄屏操作区和状态表达。
4. 建鼠与初始分笼分两次写：改为 `createMouseWithCage` 单事务。
5. 自定义 Select 未把 label/required/error 语义传到 trigger：补 ARIA 连接与组件测试。
6. 所有页面进入首包：按路由 lazy import，并让 PWA 资产清单包含异步 chunk。
7. 备份 UI 对下载结果措辞过强、离线深链缺资源：改为“已发起”并修复应用壳缓存。
8. 真实浏览器闭环没有发布证据：建立 Desktop Chromium / Pixel 7 Playwright 套件。
9. 小鼠只有批量创建，没有批量日常操作：补原子状态、转笼和标签命令。
10. 移动端密集子路由易溢出：加入实际窄屏路由巡检和响应式样式。

## 复现、根因与修复

- 在建鼠保存成功、分笼失败时可留下无笼记录；根因是 UI 串联两个命令。`1903fac` 把两个事实纳入一个事务并用无效/超容笼回滚测试覆盖。
- 自定义 Select 可见标签与无障碍 trigger 没有关联；根因是原生 label 语义不会自动穿过 Radix trigger。`43582e9` 显式传递 id 与 ARIA。
- 离线打开未访问过的页面会缺异步 chunk；根因是只缓存入口资源。`78b52c8` / `444b20c` 生成并消费完整构建资产清单。

## 提交

- `aaae38f` atomic batch creation service
- `bd7c0db` bulk creation sheet
- `724d9b0` production workspace routes
- `2f3296b` operational workspace styling
- `1903fac` atomic initial placement
- `43582e9` accessible custom selects
- `78b52c8` route splitting and chunk precache
- `444b20c` backup and offline reliability
- `6e05096` local-first E2E workflows
- `6c18e7e` atomic mouse batch operations

## 回归证据

- 静态 `it/test` 声明由 47 增至 50，净增 3；其中 Playwright 场景本身包含多个纵向断言。
- 最终 HEAD 的 lint、typecheck、Vitest、build 和完整 Playwright 会统一记录在 `final-test-report.md`。
- 最终 E2E 实际覆盖桌面/Pixel 7、深色、离线未访问路由、初始分笼和批量操作。

## 未解决 / 下一轮

- 复杂关系、恢复和 destructive replay 仍需破坏性测试。
- 浏览器进程重启、Safari/Firefox 与真实手机未验证。
- 下一轮重点：服务入口幂等、恢复原子性、时区、深链和移动导航。
