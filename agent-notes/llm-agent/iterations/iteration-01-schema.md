# 实施后审查第 1 轮：能力 Runtime Schema

日期：2026-08-01  
范围：能力注册表运行时输入边界、通用实体筛选操作符、`view.configure` 页面状态契约。未提交 Git。

## 读取范围

- `agent-notes/llm-agent/09_full_coverage_review.md`（P0 runtime schema、P1 view 契约、未知 filter operator）
- `src/application/capabilities/schema.ts`
- `src/application/capabilities/types.ts`
- `src/application/capabilities/registry.ts`
- `src/application/capabilities/catalog.ts`
- `src/application/capabilities/core-handlers.ts`（只读，用于核对 `query.entities` 的操作符语义）
- `src/application/capabilities/extended-handlers.ts`
- `src/application/capabilities/registry.test.ts`
- `src/application/capabilities/extended-handlers.test.ts`
- `src/features/mice/MicePage.tsx`
- `src/features/records/RecordsPage.tsx`
- `src/features/tasks/TasksPage.tsx`
- `src/features/data/DataPage.tsx`
- `src/domain/types.ts`（核对小鼠状态/性别稳定枚举）

## 发现的问题

1. Registry 只检查顶层 required，JSON Schema 的类型、枚举、格式、范围、数组成员、额外属性与 `oneOf` 均不构成运行时边界。
2. required 将 `null`、空字符串误判为“缺失”，与 JSON Schema 的“属性是否存在”语义不一致。
3. `view.configure.state` 接受任意对象；旧测试发送嵌套 `filters`，而 MicePage 实际只读取扁平 `sex` 等字段，因此错误命令会被报告成功并持久化。
4. `query.entities.filters` 接受任意对象；拼错操作符时比较器可能不执行任何条件，从而返回过宽结果。

## 实施修复

- 在 `schema.ts` 加入零依赖递归校验器，覆盖本项目 schema 子集：
  - `type`（含联合类型）、`enum`、`const`；
  - `properties`、`required`、布尔或 schema 型 `additionalProperties`；
  - `items`、`minItems`、`maxItems`；
  - `minimum`、`maximum`、`minLength`；
  - `format`（date/date-time/time/email）；
  - 精确匹配一个分支的 `oneOf`。
- 所有错误使用稳定 JSONPath（例如 `$.entries[0].birthDate`、`$.filters.room.typoContains`），Registry 在 handler 之前统一拒绝无效输入并附 capability ID。
- 将 `query.entities.filters` 收窄为标量或 `{eq,in,contains,gte,lte}` 操作符对象，禁止未知操作符与未知操作符字段。
- 将 `view.configure` 改为以 `workspace` 常量区分的四分支 `oneOf`；每个 `state` 与对应页面实际读取的扁平字段、枚举完全一致且禁止额外字段。
- 小鼠视图状态/性别枚举直接复用 domain 常量，避免手写枚举漂移。
- 修正旧 view 测试为 `{sex:'female', sort:'age-oldest'}`，新增错误嵌套状态不得持久化的回归测试。

## 修复证据

执行命令：

```text
npm run typecheck
npm run lint
npx vitest run src/application/capabilities/schema.test.ts src/application/capabilities/registry.test.ts src/application/capabilities/extended-handlers.test.ts
```

结果：typecheck 通过；ESLint 0 warning；3 个测试文件、18 个测试全部通过。

新增测试明确覆盖：完整 schema 子集的有效输入、每种约束的稳定嵌套路径、required 与显式 null 的区别、无效日期、数组成员类型、额外属性、错误 view shape、未知 filter operator。

## 未检查内容

- 未审查或修改业务 Service、Provider、Orchestrator、AgentPage、恢复/撤回与文件 preview/commit。
- 未处理完整覆盖报告中的页面 selection/context bridge、UI 共用 registry、导航路由白名单及 capability 逐项业务测试问题。
- 补充运行全量 Vitest 时，160 个测试通过，1 个由并行新增 eval 使用旧 `state.sortBy` 契约而失败；应由该 eval 改为页面实际字段 `state.sort`，不放宽本轮 schema。build 与 E2E 留给集成审查轮次。
- 工作树中 README 与 docs 的并行修改来自其他任务，本轮未读取或修改。
