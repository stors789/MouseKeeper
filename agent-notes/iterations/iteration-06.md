# Iteration 06 — 独立审查、仲裁与发布收口

> 范围：commit `82b06a3` 至 `9ac30df`，共 9 个真实提交；其后的安全忽略规则、恢复下载结果和 Service Worker 收窄属于最终仲裁追加修复。
> 独立审查：`workflow_review_sol`、`qa_a11y_sol`、`perf_security_sol`，均为 `gpt-5.6-sol / medium`，只读业务代码并分别输出 04–11 报告。
> 记录性质：问题是否成立由主代理按代码、复现和测试逐项裁决，不按代理票数决定。

## 检查范围

- 小鼠、笼位/繁育、实验/事件/任务、备份/CSV 四条业务闭环；
- 破坏性 QA、键盘/焦点/对比度、320px 布局；
- 5k 小鼠、1k 笼位、50k 事件、20k 体重合成性能；
- 依赖、XSS、CSV 公式、反序列化、隐私文件和 PWA 缓存。

## 发现与处理（14 项；12 已修复/验证，2 记录为产品边界）

1. 备份事件本地时间投影边界不足：`82b06a3` 修复并测试。
2. 异步 Select 编辑值会被默认值覆盖：`b154d4f` 修复。
3. 记录先截断再筛选会漏历史：`ec93d38` 改为先查询目标再限制。
4. “未来 7 天”混入今日/逾期且 focus 链接不落目标：`23e6154` 修复。
5. 核心 E2E 覆盖不完整：`a7f3f1d` 扩展到完整本地闭环。
6. 修改父母生日可制造父母晚于后代：`1213e2e` 在服务、扫描和备份预检共同阻止。
7. 有成员笼位可直接停用/退役：`1213e2e` 阻止并加入扫描/恢复审计。
8. 合笼日可早于父母出生：`1213e2e` 在创建/编辑/扫描/恢复阻止。
9. 恢复提交后才构造安全副本，可能“已换库但 Promise 拒绝”：`1c54c0a` 在同一事务、任何写入前完成精确副本摘要。
10. CSV 混入软删除记录且导出汇总嵌套扫描：`1c54c0a` 默认仅导出活动记录并预聚合。
11. CSV 每行重扫全部小鼠/笼位/标签：`ef00091` 提升为批次级 Map，成功行再更新缓存。
12. 1,000 笼位一次渲染约 22,250 DOM：`ef00091` 加 48 条分页并接入容量提示设置。
13. 全局搜索关闭丢焦点、浅色 muted 4.48:1：`9ac30df` 恢复触发按钮焦点并加深 token。
14. 实验终态能否重开、任务恢复是否允许保留软删除关联：当前行为有审计且不造成引用丢失，属于需要产品策略的边界；不在 v0.1.0 擅自改写历史语义，记录到已知限制/后续方向。

## 被拒绝或降级的审查结论

- “事件更新可写入 DST 缺口”未复现：`localDateTimeToInstant` 已执行往返投影并在 gap 抛错；该意见使用了通常行为推断而忽略现有函数实现，故拒绝为缺陷。
- 某次默认 2-worker E2E 的 `ERR_CONNECTION_REFUSED` 与并行子代理共享/终止 preview 进程同时发生；同一基线另一独立 QA 默认执行通过，单 worker 也通过。它被视为环境竞争信号而非产品断言失败，最终 HEAD 仍必须重新跑默认命令。
- 小鼠列表和 DataPage 全表读取、大备份内存峰值成立但未达到阻断级；保留为性能已知限制，不在收口阶段做高风险架构重写。

## 提交

- `82b06a3` backup local-time projection
- `b154d4f` async edit selects
- `ec93d38` filtered record histories
- `23e6154` task scope and focus links
- `a7f3f1d` complete local-first E2E
- `1213e2e` chronology and occupied-cage invariants
- `1c54c0a` exact restore safety copy and active exports
- `ef00091` bounded cage render and import maps
- `9ac30df` search focus and contrast

最终仲裁追加：`f2ccfab`（敏感导出忽略）、`55b77ab`（恢复/下载结果分离与损坏备份 UI E2E）、`0aed2a6`（静态资源缓存白名单）、`60b40da`（Vite `Vary: Origin` 下的离线静态命中）。

## 回归证据

- 本轮范围内静态 `it/test` 声明由 56 增至 60，净增 4；最终实际 Vitest 数量为 67。
- 三位子代理基线分别运行/审查了单测、构建、Playwright、窄屏、性能和依赖审计；主代理在所有修复后重跑完整发布门禁。
- 最终默认 E2E、coverage、build、控制台和文件安全结果以 `final-test-report.md` 为准。

## 未解决 / 下一轮

- Firefox/WebKit/Edge、真实手机、屏幕阅读器和浏览器进程重启仍需真实平台验证。
- 小鼠/DataPage 查询分页下推、备份 Worker/流式处理和大文件峰值仍需专项性能工程。
- 实验重开与任务恢复关联语义需要真实用户流程确认后再形成状态迁移 ADR。
