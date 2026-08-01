# LLM Agent 严格 ESLint 修复审查

日期：2026-08-01

## 范围

仅审查并修复以下新增 LLM Agent/能力系统代码：

- `src/agent/orchestrator/**`
- `src/agent/provider/**`（未修改 `settings-store.ts`）
- `src/agent/recovery/**`
- `src/application/capabilities/core-handlers.ts`
- 对应测试

未修改功能页面、设置页面或布局代码，未关闭或弱化任何 ESLint 规则。

## 修复摘要

初始 `npm run lint` 报告 40 个严格错误，最终为 0：

1. 将 recovery trace 的内联 `import()` 类型改为顶层 type-only import。
2. 对模型工具参数、Responses/Chat JSON 与 SSE 事件中的 `unknown` 值进行字符串/数字标量收窄，避免对象隐式变成 `[object Object]`。非法对象现在按既有回退路径处理，不改变合法 Provider 响应行为。
3. Provider 中止与测试桩保证 Promise rejection reason 始终为 `Error`。
4. Provider 请求参数直接使用公共 `BuiltProviderRequest` 类型，移除重复联合类型。
5. Dexie 动态表读取显式落到 `unknown`，消除 `any` 泄漏。
6. 查询过滤与排序仅序列化明确可比较的标量；移除无效类型断言。
7. 测试桩移除无意义 `async`、未使用参数和错误的值/type import。

## 行为检查

- 合法字符串、数字 ID 继续按原值处理。
- Provider 返回对象作为 ID、名称或文本时不再被静默接受为 `[object Object]`。
- AbortSignal 的既有 `Error` reason 原样传播；非 Error reason 使用标准 `AbortError`。
- 查询 `contains`、`gte`、`lte` 和排序对字符串、数字、布尔值维持原有标量比较语义。

## 验证

- `npm run typecheck`：通过。
- `npm run lint`：通过，0 warnings / 0 errors。
- `npx vitest run src/agent/orchestrator/orchestrator.test.ts src/agent/provider/provider.test.ts src/agent/recovery/recovery-manager.test.ts src/application/capabilities/registry.test.ts`：4 个测试文件、62 个测试全部通过。

Node 运行测试时仍会打印其自身的 experimental localStorage warning；它不是 ESLint 或测试失败，且本次改动未触碰测试环境配置。
