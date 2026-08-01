# 第 5 轮：Provider、流式 UI 与移动端审查

审查日期：2026-08-01
分支：`feat/llm-agent`
执行方式：独立审查、修复与验证；本轮未创建 Git 提交，也未修改 README 或 docs 草稿。

## 审查范围

- 三种 Provider 协议的 request builder、非流式 parser、SSE/JSONL parser、transport、错误与中止；
- Provider profile、preset、secret 隔离、设置存储与设置界面；
- ProviderClient → AgentModelClient → AgentOrchestrator → AgentPage 的流式状态链；
- 本地历史裁剪策略、工具轮次完整性与页面历史上限；
- Agent/Settings 的桌面、Pixel 7、深色、窄宽、长连续内容和横向溢出；
- Provider、orchestrator、展示 helper、全量 Vitest、生产构建与 Playwright 回归。

## 实际读取文件

- 需求：`/Users/eros/.codex/attachments/15d63492-f456-4491-9316-2a0874f6f798/pasted-text.txt`
- 既有审查：`agent-notes/llm-agent/03_provider_compatibility_review.md`、`04_agent_ux_review.md`、`10_performance_review.md`
- Provider：`src/agent/provider/types.ts`、`client.ts`、`parsers.ts`、`request-builders.ts`、`defaults.ts`、`settings-store.ts`、`provider.test.ts`
- Agent：`src/agent/orchestrator/types.ts`、`orchestrator.ts`、`orchestrator.test.ts`、`src/agent/runtime.ts`
- UI：`src/features/agent/AgentPage.tsx`、`run-presentation.ts`、`run-presentation.test.ts`、`src/features/settings/AgentSettingsPanel.tsx`、`src/styles.css`
- 浏览器测试与工程配置：`e2e/app.spec.ts`、`playwright.config.ts`、`package.json`

## 发现与证据

### F-01：`stream=true` 仍是“结束后一次返回”

`parseOpenAiStream()` 会累计 delta，但 ProviderClient 没有事件回调，AgentModelClient/Orchestrator 也没有增量事件契约。AgentPage 的 `liveText` 只可能收到最终 `text`。这与设置中的“流式输出”不一致。

### F-02：`streamDialect: jsonl` 是无效配置

profile 类型和默认值包含 `jsonl`，但 ProviderClient 无条件调用 SSE parser，Settings 也没有流格式控件。JSONL 末行无换行、`[DONE]`、Responses 完成事件和 Chat `finish_reason` 均无测试。

### F-03：收到响应头后“停止/超时”可能失效

原 `send()` 在 `fetch()` 返回 Response 后立刻执行 `timeout.dispose()`，清除了 timeout，并解除父 AbortSignal 到 fetch signal 的转发。长流读取期间，用户点击停止或达到总超时不再可靠。这是本轮额外发现的高风险正确性问题。

### F-04：三个上下文策略实际走同一逻辑

`buildGenerationRequest()` 无条件调用 `trimCompleteTurns()`；`fail` 不会报错，`summarize-then-trim` 不会摘要。设置控件因此会声称一个未生效的行为。

实施后复审又发现 Orchestrator 在成功后执行 `messages.slice(-historyLimit)`：它会在 Provider 构建下一次请求前无策略丢弃历史，还可能把 assistant tool call 与 tool output 拆开。即使 request builder 的策略已经实现，连续命令也通常只剩被提前截断的历史，导致 `fail`/本地摘要没有机会看到真实完整 turn。

### F-05：Agent 页面历史无界，停止后的旧流式状态缺少运行隔离

页面首次只读 30 条，但每次完成都向 `runs` 前插且不裁剪；长会话会持续增加 DOM。进度回调也没有 execution identity，后续引入真流式后，停止边界需要避免迟到 delta 写回 UI。

### F-06：窄屏长内容存在实际溢出边界

Agent live text 没有 `white-space/overflow-wrap`；Settings 连接错误、隐私说明、header 文案和文件名所在 flex/grid 子项缺少统一的 `min-width: 0` 与断词规则。连续 URL、Provider 错误和无空格模型输出可能把 Pixel 7 页面撑宽。

## 修复

1. 新增 `ProviderEventListener`，SSE Responses 与 Chat 每个文本 delta 都立即从 parser 经 ProviderClient 转发；Orchestrator 产生带累计文本的 `text-delta` progress，AgentPage 实时显示。
2. 新增统一 `parseProviderStream()`：
   - SSE 保持按空行分帧、多行 data、任意 chunk 边界；
   - JSONL 按行解析，并消费 EOF 时没有换行的末行；
   - 支持 `[DONE]`、Responses `response.completed` / `done`，以及 JSONL Chat `finish_reason`；
   - 标准 Chat SSE 仍要求 `[DONE]`，不能只凭 `finish_reason` 假装完成；
   - 中断发送 `response-failed` 并抛出 `stream-interrupted`；累计文本设 2 MiB 上限。
3. transport 将组合 AbortSignal 的生命周期延长到响应体解析完成；stream 中止映射为 `aborted`，总超时映射为 `timeout`，最后统一释放 timer/listener。
4. 实现三种本地上下文策略：
   - `fail`：超过消息上限时在发请求前报错；
   - `drop-oldest`：仅删除最旧的完整 turn；
   - `summarize-then-trim`：对被删除的完整 turn 做有长度上限的确定性文本摘录，明确标记“本地历史摘要、未调用额外模型、可能省略细节”，保留最新完整工具 turn。
   - Orchestrator 会话缓存不再使用裸 `slice`；改为完整 turn 裁剪，缓存容量为 `max(40, historyLimit × 4)`、最高 400 条。它只负责安全内存上限，真正的 `fail/drop/summary` 仍由每次 request builder 执行。
5. Settings 增加 `OpenAI SSE / JSONL` 控件；把文案改为“本地上下文超限策略”和“本地确定性摘录后裁剪”，明确不产生额外模型调用或费用。
6. Agent 页面用 execution identity 丢弃停止后的迟到 delta；每次新运行先清空旧 text/error/traces；停止立即清空流式文本；内存执行记录去重并封顶 40 条。
7. 修复长 live text、Provider 错误、隐私说明、文件名和 header flex/grid 子项的断词与最小宽度；Pixel 7 下 Agent/Settings 横向 padding 收紧为 12 px。
8. E2E 增加长无断点命令、上下文策略控件、JSONL 切换与 reload 持久化断言，并在 desktop/mobile 都检查无横向溢出。

## 测试

- `npm run typecheck`：通过。
- `npm run lint`：通过，0 warning。
- 相关回归：3 files / 66 tests passed。
  - Responses SSE 逐 delta；
  - Chat SSE 逐 delta + `[DONE]`；
  - JSONL Chat EOF 无换行 + `finish_reason`；
  - JSONL Responses + `[DONE]`；
  - 断流不成功并发送 failure event；
  - 响应体读取期间 timeout 仍有效；
  - 三种上下文策略和完整工具 turn；
  - 连续命令经过真实 ProviderClient 时，下一次请求分别验证 fail/drop/summary，并证明旧 assistant tool call、tool output 与最终 assistant 保持为同一完整 turn；
  - Orchestrator 累计 text-delta；
  - Agent 内存历史去重与 40 条上限。
- `npm test`：23 files / 194 tests passed。
- `npm run build`：通过，2,085 modules；AgentPage 13.27 KiB（gzip 5.50 KiB），Provider/runtime 共享 chunk 42.05 KiB（gzip 14.46 KiB）。主入口 755.25 KiB（gzip 224.19 KiB），仍有既有的 500 KiB 警告。
- Agent 专项 Playwright：Desktop Chrome + Pixel 7，2/2 passed；实际启动 production preview，覆盖 `/mice → /agent → /settings`、长连续文本、JSONL 保存/reload 与无横向溢出。
- 完整 Playwright：`test-results/.last-run.json` 为 `status: passed`、`failedTests: []`；16 passed / 8 按项目条件 skipped。覆盖桌面与 Pixel 7、所有 workspace、深色切换、Agent/Settings 和长内容。
- `git diff --check`：通过。

完整 E2E 第一次重跑曾出现一次基础设施失败：Playwright 复用了上一条命令正在退出的 preview，失败全部为 `net::ERR_CONNECTION_REFUSED`，没有产品断言失败。随后使用独立持久 preview 重跑，最终结果通过。

## 剩余限制

- 没有可用的真实 Provider credential/endpoint，本轮没有验证真实 OpenAI、第三方兼容服务的 CORS、SSE 心跳、首 token 延迟或厂商私有 JSONL 形状；协议行为由确定性 Response/ReadableStream 测试覆盖。
- “本地确定性摘录”是字符级有损摘录，不是语义摘要，也不是 token 精确预算；UI 已如实命名。未来如增加付费模型摘要，必须成为单独、可追踪的显式能力。
- Agent DOM 已有 40 条硬上限，但尚未做分页/虚拟列表；持久历史配额由第 4 轮 recovery policy 负责。
- 流式文本有 2 MiB 上限，未分帧 buffer 也有 2 MiB 上限；单命令总 tool argument/调用数仍值得增加独立硬预算。
- 主入口 bundle 仍超过 Vite 500 KiB 警告；Agent 路由自身保持懒加载且体积较小，本轮没有扩大范围拆分全应用入口。
- 未进行真实 iOS Safari、软键盘、VoiceOver/NVDA 或低端 Android 内存分析；Pixel 7 Chromium、深色和横向溢出已自动验证。
