# LLM Agent 离线确定性 Eval 实施报告

实施日期：2026-08-01  
实施范围：仅 `src/agent/evals/**` 与本报告；未修改生产能力、业务 Service、Provider 或恢复代码。

## 结论

已实现 **288 条唯一、可机器判定的离线 Eval 契约**，以及 **5 条通过 `AgentOrchestrator`、生产 `CapabilityRegistry`、真实测试 Dexie 数据库与 `RecoveryManager` 的代表性执行 Eval**。默认测试不访问网络，不读取 API Key，不依赖远程模型。

288 条契约案例具有稳定唯一 ID、主类别、自然语言输入、固定上下文、期望能力调用及参数、每个能力的风险/恢复策略、整条命令恢复策略、用户手势边界、协议或错误分类。测试逐条对照当前生产 registry descriptor 与必填 schema，并验证分类配额、ID/输入去重、106 行审计映射、工具 schema、可重复序列化和轨迹突变检出。

## 案例构成

| ID 范围 | 数量 | 主类别 | 机器判定重点 |
|---|---:|---|---|
| `CAP-001`～`CAP-106` | 106 | 能力镜像 | `auditRow` 1～106 一一对应；能力存在、参数含 schema 必填项、风险/恢复与 descriptor 一致 |
| `LANG-001`～`LANG-048` | 48 | 语言变体 | 中文、英文、中英混合、口语简写、错别字、全半角/空格分类 |
| `CTX-001`～`CTX-030` | 30 | 上下文与时间 | 当前页面、选择、最近操作、代词、相对日期、时区与歧义停止 |
| `FLOW-001`～`FLOW-036` | 36 | 复合/批量 | 依赖创建、查询后写入、批量、跨领域有序调用与单恢复边界 |
| `SAFE-001`～`SAFE-024` | 24 | 安全/撤回 | 软删恢复、永久删除预检、批量/复合恢复、撤回冲突分类 |
| `FILE-001`～`FILE-012` | 12 | 文件手势 | `needs-user-action`、两阶段请求/消费、导入导出及文件错误分类 |
| `FAIL-001`～`FAIL-016` | 16 | 失败 | 缺参、未找到、歧义、业务规则、revision、修正、部分完成、取消、轮次等 16 类 |
| `PROTO-001`～`PROTO-016` | 16 | Provider 协议 | 6 种成功 wire 形态与 10 种 transport/协议故障分类 |
| **合计** | **288** |  | 无 skip/todo |

## 真实内核执行 Eval

`execution.eval.test.ts` 没有 mock `CapabilityRegistry`、`MouseKeeperService`、Dexie 或 `RecoveryManager`。只有模型响应被独立的确定性 transcript 替代；该 transcript 模块不导入 cases 或 oracle。

已验证 5 个代表场景：

1. `cage.create`：真实数据落库、精确工具 trace、row diff 恢复记录，以及撤回后新记录消失。
2. `cage.create → mouse.create`：第二步从第一步真实 tool result 提取 cage ID；最终小鼠和活动分笼关系存在，整条命令只有一个 full-backup 恢复边界。
3. `view.configure`：真实扩展 handler 写入 localStorage preference diff，撤回后偏好精确清除。
4. `query.dashboard`：真实只读查询完成，业务 changes 为空，恢复类型为 `none`。
5. 错误能力 → 安全修正：首个 trace 保留 `failed`，随后 `cage.create` 成功，最终 capabilityIds 只包含实际成功能力。

## 防止自证式 scripted fake

- `deterministic-model.ts` 与 `cases.ts` 分离，导入依赖测试明确禁止 transcript 引用 cases/oracle。
- transcript 只回放独立编写的规范化调用；执行结果仍由生产 handler、真实数据库和恢复模块产生。
- 契约 oracle 可杀死 5 类代表性轨迹突变：错误能力、漏步骤、重复步骤、交换顺序、篡改参数；当前为 5/5。
- 契约矩阵对生产 descriptor 和 schema 做逐 case 对照，registry 中能力删除、风险/恢复策略漂移或必填参数变化会使测试失败。
- 106 个 audit row 具有连续、唯一的 `CAP-nnn` 映射；没有用一个测试 ID 覆盖多个审计行分母。

## 测试结果

执行命令与结果：

- `npx vitest run src/agent/evals/contract.eval.test.ts src/agent/evals/execution.eval.test.ts`：2 个文件、12 个测试全部通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过，0 warning。

Vitest 所用 Node 运行时仍打印现有的实验性 localStorage 参数提示，但 jsdom 的 localStorage 行为和全部断言正常；该提示未导致测试跳过或降级。

## 评测边界（必须保留）

这套默认 Eval 证明的是两件事：

1. **离线契约完整性**：288 条人工定义的期望能持续对照生产 registry、schema、风险、恢复与分类。
2. **代表性执行链正确性**：当模型给出 transcript 中的工具调用时，真实 orchestrator/registry/service/database/recovery 能产生被断言的数据、轨迹与撤回结果。

它**不证明** GPT、兼容 Responses 服务或 Chat Completions 模型能从 288 条输入中自行推导出这些期望调用，也不能据此声称“真实 LLM 语义准确率 100%”或“288/288 真实模型通过”。`LANG`、`CTX` 和大部分 `CAP/FLOW/SAFE/FILE/FAIL/PROTO` 当前是离线契约案例，不是 288 次远程模型推理。

要衡量真实语义质量，应另建显式 opt-in 的 live eval：固定 Provider、模型版本、时间、数据 fixture 与判分器，真实调用远程模型，单独报告通过率、成本、延迟和非确定性；不得把 live 结果混入默认离线 CI 数字。

## 文件清单

- `src/agent/evals/types.ts`：Eval 契约类型。
- `src/agent/evals/cases.ts`：288 条稳定案例、106 行审计映射与分类配额。
- `src/agent/evals/deterministic-model.ts`：与 oracle 解耦的 transcript 回放模型。
- `src/agent/evals/contract.eval.test.ts`：矩阵、registry/schema、tool schema、重复性和突变门禁。
- `src/agent/evals/execution.eval.test.ts`：真实内核代表性执行、状态与恢复/撤回判定。
- `src/agent/evals/index.ts`：Eval 模块导出。

