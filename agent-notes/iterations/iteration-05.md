# Iteration 05 — 破坏性 QA 与跨模块一致性

> 范围：commit `9d72ce4` 至 `975baa6`，共 9 个真实提交。
> 独立审查：`final_qa_medium` 隔离审查（服务/恢复/路由破坏性检查），其发现由主代理复现后处理。
> 记录性质：按真实 Git 历史与最终回归证据整理。

## 检查范围

- CSV、备份、永久删除和批处理恢复；
- 无效深链、复制、保存视图与仪表盘；
- 事件时区、记录/任务导航、移动端与危险操作重放。

## 发现与处理（9 / 9）

1. CSV 解析错误、恢复引用和 helper key 审计仍有缺口：统一强化数据边界。
2. 编辑不存在记录时可能落入“新建”语义：无效 edit route 明确拒绝创建。
3. 事件只保存墙上时间会在时区/DST 下失真：保存 instant、声明时区并反投影核对。
4. 保存视图和批量工作区缺少真实可用闭环：补持久视图与选中操作。
5. 复制档案可能带走身份/关系：只复制生物学模板字段并清空身份、笼位和状态。
6. 恢复与多条批处理存在部分提交风险：补单事务恢复/删除和故障注入。
7. 仪表盘只有计数：增加可行动分布、异常和目标链接。
8. 窄屏表格、详情导航和焦点目标不稳：修复响应式与深链定位。
9. 永久删除等 destructive operation 仅按 operationId 返回旧结果，未绑定原请求：保存请求指纹，复用不同参数时拒绝。

## 复现、根因与修复

- 在 `/mice/missing/edit` 提交表单可能走新建分支；根因是异步读取的“尚未加载”和“不存在”状态混用。`6016803` 分离状态并阻止写入。
- 同一个 destructive operationId 改换目标再次调用可能返回旧结果；根因是只检查 action，不比较输入。`975baa6` 绑定规范化请求摘要并补重放测试。
- 事件本地日期、时区和 instant 可互相矛盾；`5049f13` 用声明时区生成/校验投影，后续轮再覆盖备份边界。

## 提交

- `9d72ce4` relation integrity and imports
- `6016803` invalid edit routes
- `5049f13` timezone and operational truth
- `3934852` saved views and batch workspace
- `490d0d6` safe biological-profile copy
- `8d19434` atomic recovery and batch workflows
- `630cea3` actionable dashboard distributions
- `8f68c86` responsive/navigation hardening
- `975baa6` destructive operation replay binding

## 回归证据

- 静态 `it/test` 声明由 50 增至 56，净增 6。
- 最终 Vitest 覆盖无效关联、时区投影、批处理回滚、永久删除重放和恢复失败回滚。
- 最终 Playwright 纵向覆盖复制之外的核心日常闭环，并验证控制台错误、窄屏和深色。

## 未解决 / 下一轮

- 审查仍需逐模块复查父母/繁育日期、占用笼状态和恢复安全副本的提交语义。
- 大数据浏览器基准、屏幕阅读器和真实平台矩阵未完成。
- 下一轮重点：由多个只读子代理独立审查业务闭环、QA、无障碍、性能和隐私。
