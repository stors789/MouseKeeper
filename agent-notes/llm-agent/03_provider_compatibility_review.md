# Provider Adapter 与设置映射独立审查

> 子任务：LLM Provider、模型参数与纯前端安全边界  
> 审查日期：2026-08-01（Asia/Shanghai）  
> 审查性质：独立只读架构审查；除本报告外未修改业务源码、配置或测试，未创建提交  
> 子代理：`gpt-5.6-sol`，reasoning effort `medium`

## 1. 范围

本审查覆盖：

- OpenAI Responses API；
- OpenAI-compatible Responses API；
- OpenAI-compatible Chat Completions API 与本地模型服务；
- Provider / preset / secret 的数据边界；
- Base URL、API path、API Key、模型列表、连接测试、模型及生成参数的逐项映射；
- reasoning effort、temperature、top_p、最大输出 token、超时、最大工具轮次、流式、并行工具调用、重试、历史保留、上下文策略、系统提示追加、Provider 特有参数、自定义请求头、organization、project；
- SSE、非流式响应、错误、断流、中止和重试；
- 浏览器直连的 CORS、mixed-content 和 API Key 限制；
- 请求映射测试矩阵。

不在本报告中设计领域 Capability Registry 的具体业务工具，也不修改业务服务、数据库 schema、设置 UI 或备份代码。

## 2. 阅读文件与官方依据

### 2.1 项目文件

- `README.md`：确认产品承诺为单用户、无后端、本地优先 PWA。
- `docs/architecture.md`：确认运行时没有远程 API，业务事实位于 IndexedDB，`localStorage` 仅保存非关键偏好。
- `docs/known-limitations.md`：确认本地数据、平台、备份与浏览器边界。
- `docs/backup-and-recovery.md`：确认完整 JSON 当前导出 16 张表，并包含应用设置。
- `package.json`：React/Vite/Dexie 纯前端工程，当前没有 OpenAI SDK 或服务端 runtime。
- `vite.config.ts`、`public/sw.js`、`src/main.tsx`：没有 CSP/connect-src 配置；Service Worker 只处理同源 GET 应用壳，不会缓存跨源 Provider POST。
- `src/app/runtime.ts`：当前只组合数据库与 `MouseKeeperService`。
- `src/features/settings/SettingsPage.tsx`：现有设置仅有主题、持久存储、版本和完整性扫描。
- `src/domain/types.ts`、`src/domain/validation.ts`：`AppSettings` 是单例业务实体，当前没有 LLM 字段。
- `src/db/database.ts`：`appSettings` 是 16 张表之一。
- `src/backup/types.ts`、`src/backup/backup.ts`、`src/backup/normalize.ts`：`appSettings` 会原样进入普通备份；因此不能把 API Key 放入现有 `AppSettings`。
- `src/services/types.ts`、`src/services/errors.ts`、`src/lib/errors.ts`：现有命令有 operationId、revision 和结构化错误，可供后续 Agent 运行时采用相同的错误/幂等纪律。
- 新需求附件 `pasted-text.txt` 第 329–482、672–711、889–927、1084–1172 行：Provider、设置、密钥、预设与请求映射测试的明确要求。

### 2.2 官方依据（2026-08-01 获取）

- [Create a model response](https://developers.openai.com/api/reference/resources/responses/methods/create)：Responses 的 `instructions`、`max_output_tokens`、`parallel_tool_calls`、`reasoning`、`stream`、`temperature`、`top_p`、`tools` 等请求结构。
- [Create chat completion](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)：Chat Completions 的 `messages`、`max_completion_tokens`、`reasoning_effort`、`parallel_tool_calls`、`stream`、`temperature`、`top_p` 和 `tools`。
- [Streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses)：Responses 使用语义化 SSE 事件；常见事件包括 `response.created`、`response.output_text.delta`、`response.completed` 和 `error`；Chat Completions 使用增量 `delta` 与 `[DONE]`。
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling)：模型可能同轮返回多个函数调用；`parallel_tool_calls: false` 可限制为零或一个；函数参数仍须应用端校验。
- [API authentication](https://developers.openai.com/api/reference/overview#authentication)：OpenAI 使用 `Authorization: Bearer ...`，可选 `OpenAI-Organization` 和 `OpenAI-Project`；`x-request-id` 可用于诊断。
- [List models](https://developers.openai.com/api/reference/resources/models/methods/list)：OpenAI 模型列表是 `GET /models`，结果为 `{ object: "list", data: [{ id, ... }] }`。
- [Model guidance](https://developers.openai.com/api/docs/guides/latest-model)：当前官方建议 agentic/tool-calling 工作流优先 Responses；当前 GPT-5.6 reasoning effort 为 `none/low/medium/high/xhigh/max`，但不同模型支持集合不同。
- [API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)：官方明确不应把 OpenAI API Key 部署在浏览器/移动端，应通过能安全持有密钥的后端路由请求。
- [OpenAI Node 官方库](https://github.com/openai/openai-node#retries)：官方 SDK 默认对连接错误、408、409、429 和 5xx 做有限退避重试；这可作为自实现 transport 的基线，而不是强制复制全部 SDK 默认值。

本会话未暴露 OpenAI Docs MCP/API Key credential 工具；已运行最新模型 resolver，得到 `gpt-5.6-sol`。官方页面通过 OpenAI 官方域名检索/读取；没有发送真实 API 请求，也没有使用真实 Key。

## 3. 当前状态与关键发现

### F-01（阻断）纯浏览器架构不能安全持有 OpenAI API Key

OpenAI 官方明确禁止把 Key 放进浏览器客户端。MouseKeeper 又明确“无后端”。因此以下说法都不成立：

- “IndexedDB 保存即安全”；
- “localStorage 保存即安全”；
- “用固定前端密钥加密后安全”；
- “只把输入框设为 password 就安全”；
- “PWA 安装后等于原生安全存储”。

同源脚本、XSS、浏览器扩展、DevTools、恶意依赖和取得浏览器配置的本机用户都可能读取浏览器内可用的秘密。把加密密钥和密文一起保存在同一 origin 只是编码，不是安全存储。

**结论：** 对 OpenAI 官方 Provider，安全默认必须是用户控制的本机/远程网关，由网关持有 Key；MouseKeeper 浏览器只保存网关 URL 和非秘密配置。纯本地无 Key 模型可直接连接。若产品仍提供“浏览器直连 BYOK”，必须标为兼容/开发模式并显示明确风险，不能称为安全方案。

### F-02（阻断）现有 `AppSettings` 会进入普通备份

`appSettings` 在 `BACKUP_TABLE_NAMES` 中，导出会读取并序列化整个对象。把 `apiKey`、秘密请求头或可逆密钥材料加入现有 `AppSettings` 会直接违反“不得进入普通备份”。

**结论：** secret 必须与业务设置和可导出 Provider profile 分离；普通备份/export 的类型层面不能接触 secret value。

### F-03（高）浏览器自定义 Base URL 受 CORS 与 mixed-content 约束

浏览器 `fetch` 到跨源 API 时，服务端必须允许应用 origin、POST/GET、`Content-Type`、`Authorization` 和所有自定义头；模型列表与生成请求都可能触发预检。HTTPS 部署通常不能调用普通 HTTP LAN 服务；`localhost` 行为也不能被当作所有平台的保证。

**结论：** “任意兼容 API”在纯浏览器中实际等于“协议兼容且允许 CORS、满足页面安全上下文规则的 API”。连接测试必须区分 DNS/TLS/CORS/mixed-content/认证/协议解析错误，不能统一显示“Key 无效”。

### F-04（高）三种协议不能靠字段透传伪装兼容

Responses 与 Chat Completions 在 prompt、工具、工具结果、输出 token、reasoning、SSE 和最终响应形状上不同。仅把 path 从 `/responses` 改为 `/chat/completions` 不足以兼容。

**结论：** Adapter 必须拥有独立 request builder、stream parser、response parser 和 tool continuation builder；上层 Agent 只依赖规范化协议。

### F-05（高）Provider/模型能力必须显式建模，不能以 400 错误驱动每次请求

reasoning、sampling、parallel tools、model list、stream、strict function schema 等支持度随 Provider/模型变化。需求还要求“不支持时不发送且不假装生效”。

**结论：** profile 需要 `capabilities`（`supported/unsupported/unknown`）和来源（built-in/probe/user override）；每次请求生成 `effectiveSettings` 与 `omittedSettings[]`，UI 展示实际生效情况。

### F-06（高）“最大工具轮次”不是 Provider 的 `max_tool_calls`

Responses 的 `max_tool_calls` 是内置 hosted tools 的总调用上限；本项目的“最大工具调用轮次”是 Agent 在模型响应—本地函数执行—继续请求之间的本地循环上限。

**结论：** `maxToolRounds` 留在 orchestrator，不能错误映射为 Responses `max_tool_calls`，也不能发给 Chat Completions。达到上限时返回结构化 `tool_round_limit`，停止新工具执行，保留已完成结果。

### F-07（高）并行工具调用的协议开关不等于可以并行执行写操作

`parallel_tool_calls` 只控制模型是否可以同轮提出多个工具调用。即使设置为 true，本地执行器仍必须按 capability metadata 判断：只读且互不依赖的调用可并行；任何写操作、共享 revision、先后依赖或恢复点范围重叠的调用必须串行。

### F-08（中）流式响应必须以“完成事件”作为成功条件

收到若干文本 delta 后连接断开，不等于成功。Chat 的最终 usage chunk 也可能因断流缺失。若 UI 已展示部分文本，应标记“未完成/已中止”，不能写入完整 assistant 历史或开始执行不完整的工具参数。

## 4. 推荐 Provider Adapter 架构

建议建立四层，避免业务逻辑与协议耦合：

```text
AgentOrchestrator
  -> NormalizedLLMRequest / NormalizedLLMEvent
  -> ProviderAdapter
       - OpenAIResponsesAdapter
       - CompatibleResponsesAdapter
       - CompatibleChatCompletionsAdapter
  -> HttpTransport (fetch + timeout + retry + SSE)
  -> SecretResolver (只返回给 transport，不进入 request log/tool/model context)
```

核心接口建议：

```ts
type ProviderProtocol =
  | 'openai-responses'
  | 'compatible-responses'
  | 'compatible-chat-completions'

interface ProviderAdapter {
  protocol: ProviderProtocol
  resolveCapabilities(profile: ProviderProfile): Promise<CapabilityReport>
  listModels(profile: ProviderProfile, signal: AbortSignal): Promise<ModelInfo[]>
  testConnection(profile: ProviderProfile, signal: AbortSignal): Promise<ConnectionReport>
  createRequest(input: NormalizedLLMRequest, effective: EffectiveSettings): HttpRequest
  parseResponse(response: Response): Promise<NormalizedLLMResult>
  parseStream(response: Response): AsyncIterable<NormalizedLLMEvent>
}
```

`NormalizedLLMEvent` 至少区分：

- `response_started`；
- `text_delta`；
- `tool_call_delta` / `tool_call_completed`；
- `usage`；
- `response_completed`；
- `response_failed`；
- `aborted`。

任何协议解析器都不得把尚未完成的工具 arguments 交给执行器。工具 arguments 完成后仍需按 Capability Registry 的 Zod/JSON Schema 重新校验。

## 5. URL、认证、模型列表与连接测试

### 5.1 URL 组合

Provider profile 分开保存：

- `baseUrl`，例如 `https://api.openai.com/v1`；
- `generationPath`，默认 Responses `/responses`、Chat `/chat/completions`；
- `modelsPath`，默认 `/models`，允许设为“不支持”；
- 可选 `testPath`，通常不需要独立字段。

规则：去掉 `baseUrl` 末尾 `/`，确保 path 以 `/` 开头，再用受控 URL 组合；不得自动猜测并重复追加 `/v1`。拒绝 `javascript:`、`data:`、带 userinfo 的 URL；生产 HTTPS 页面要在保存/测试时预警 HTTP endpoint。重定向到不同 origin 时不要自动携带 Authorization；最好 `redirect: 'error'`，要求用户明确修改 Base URL。

### 5.2 认证与 headers

OpenAI 官方：

```http
Authorization: Bearer <secret>
OpenAI-Organization: <optional org id>
OpenAI-Project: <optional project id>
Content-Type: application/json
```

兼容 Provider 允许 profile 声明 `authMode: bearer | api-key-header | none` 与自定义 header name，但：

- secret value 只由 `SecretResolver` 在最后一步注入；
- 禁止 Provider profile、日志、错误、history、tool result 持有完整 secret；
- 自定义 header 与系统保留 header 冲突时拒绝保存，不做静默覆盖；
- 禁止用户设置浏览器控制的 `Host`、`Origin`、`Content-Length`、`Cookie` 等 forbidden headers；
- `Authorization`、API key 类 header、cookie/token/secret 命名的自定义值自动标为 secret，永不导出；
- organization/project 是普通标识但仍不应发送给模型。

### 5.3 模型列表

OpenAI/兼容默认请求 `GET {baseUrl}{modelsPath}`；接受标准 `{ data: [{ id }] }`。兼容服务可通过 adapter-specific parser 支持 `{ models: [...] }` 或字符串数组，但必须由 profile 明确选择兼容格式，避免宽松解析掩盖服务错误。

模型列表接口不可用不是生成能力失败：记录 `modelListing: unsupported`，保留手动模型名。401/403 记录认证/权限失败；404/405 可提示“此服务不提供模型列表”；HTML 登录页或代理错误必须报告 content-type/状态，不把 HTML 写入 UI 或日志全文。

### 5.4 测试连接

优先顺序：

1. 如果模型列表受支持，GET models 验证网络、认证和协议；
2. 若不支持模型列表，发送一次最小、非流式、无工具、极小输出 token 的生成请求；
3. 测试响应只验证协议与选定模型可用，不执行任何模型返回的工具调用；
4. 保存 `testedAt/status/safeErrorCode/requestId`，不保存完整响应、请求体或 headers。

“测试 Key”必须使用当前输入框中的临时值；失败也不能把该值写入 error object。

## 6. 设置逐项映射

| 设置 | OpenAI Responses | Compatible Responses | Compatible Chat Completions / local | 本地语义与降级 |
|---|---|---|---|---|
| Provider 类型/名称 | adapter id；名称仅本地 | 同左 | 同左 | 名称不进请求 |
| Base URL | 默认 `https://api.openai.com/v1` | 用户配置 | 用户配置，local 可为 CORS-enabled loopback | transport URL；不进 body |
| API path | `/responses` | 默认 `/responses`，可改 | 默认 `/chat/completions`，可改 | 独立 models path |
| API Key | `Authorization: Bearer` | profile auth mapping | bearer / custom header / none | SecretResolver 最后注入 |
| organization | `OpenAI-Organization` | 仅 capability 声明支持时 | 通常 omit，或显式 header mapping | 不发送未知 header |
| project | `OpenAI-Project` | 仅声明支持时 | 通常 omit，或显式 mapping | 同上 |
| 模型 | body `model` | body `model` | body `model` | 必填；手输永远可用 |
| 模型列表 | `GET /models` | configurable models path/parser | configurable；可 unsupported | 不可用不阻断手输 |
| reasoning effort | `reasoning: { effort }` | capability/mapping 后同左 | OpenAI-style 为顶层 `reasoning_effort`；其他仅显式 provider param | unsupported 时 omit 并展示；值来自 capability，不写死六项 |
| temperature | body `temperature` | 声明支持才发送 | body `temperature`（声明支持） | 建议与 top_p 二选一；unsupported omit |
| top_p | body `top_p` | 声明支持才发送 | body `top_p`（声明支持） | 同上 |
| 最大输出 token | `max_output_tokens` | 默认同左，可由已知兼容映射覆盖 | 优先 `max_completion_tokens`；旧服务才显式选择 `max_tokens` | 不同时发送两个别名 |
| 超时 | 不进 body | 不进 body | 不进 body | `AbortController` transport deadline；区分 connect/first-byte/total 可作为未来扩展 |
| 最大工具轮次 | 不进 body | 不进 body | 不进 body | AgentOrchestrator 循环上限；不是 Responses `max_tool_calls` |
| 流式 | body `stream: true/false`；semantic SSE | 同左但需兼容事件 capability | body `stream`；data-only SSE + `[DONE]` | UI 关闭流式时走 JSON parser |
| 并行工具调用 | `parallel_tool_calls` | capability 支持才发送 | `parallel_tool_calls`，支持才发送 | 仅模型提议；本地写工具仍串行 |
| 重试次数 | 不进 body | 不进 body | 不进 body | transport policy；有界指数退避 + jitter |
| 历史保留数量 | 构造 `input`/continuation | 同左 | 截取 `messages` | 本地策略；不能只删 tool call 一半 |
| 上下文长度策略 | 可选显式 `truncation`/本地 compaction，但跨 Provider 默认本地实现 | capability 后使用，否则本地 | 本地 trim/summarize/fail | 生成前给出 token/字符预算；不能静默丢系统提示或未配对工具项 |
| 系统提示追加 | 合并到 `instructions`；每次 continuation 重发 | 同左或 provider mapping | 首条 `developer`（优先）或兼容所需 `system` message | 追加在固定安全/工具规则之后还是之前需固定；不得包含 secret |
| Provider 特有参数 | allowlisted extra body | profile schema + allowlist | profile schema + allowlist | 核心字段冲突拒绝；JSON primitive/object 限深限大小 |
| 自定义 headers | transport headers | transport headers | transport headers | secrets 分离，CORS 预检提示，保留字段冲突拒绝 |
| 预设切换 | 选择整个 profile/settings 快照 | 同左 | 同左 | 正在运行的 command 使用 immutable snapshot；切换只影响下一命令 |

### 6.1 reasoning effort 细节

- UI 选项从 `CapabilityReport.reasoningEfforts` 渲染；`unknown` 时允许手动选择，但标“未经验证”。
- OpenAI Responses 映射为 `reasoning.effort`；Chat 映射为 `reasoning_effort`。
- 当前 OpenAI 通用 schema 包含 `minimal`，但具体 GPT-5.6 官方模型指导列出 `none/low/medium/high/xhigh/max`。不得因全局 schema 出现 `minimal` 就对所有模型展示为可用。
- Provider 返回 unsupported/400 且能可靠定位该字段时，可更新本地 capability cache，但不得静默重试并声称参数已生效。用户可选择“移除不支持参数并重试”。
- 每个 Agent 运行记录 `requestedEffort` 与 `effectiveEffort`（可能为 omitted），但绝不记录 secret。

### 6.2 temperature 与 top_p

OpenAI 官方建议通常只调整两者之一。UI 可允许高级用户同时设置，但默认采用三态 `inherit/unset/value`，避免把 UI 默认值无意强加给所有 Provider。Adapter 只发送显式 value；`inherit` 不发送。

### 6.3 历史与上下文

推荐默认保持本地可恢复、跨 Provider 一致的 history：

- 每一轮保存规范化 user、assistant output、tool call、tool output；
- 不能保留 tool result 而丢掉对应 call，也不能只保留未完成的 arguments；
- Responses 若使用 `previous_response_id`，必须承认这是服务端状态模式；本地隐私预设默认 `store: false` 并手动重放必要 items；
- Chat 生成 `messages`，工具调用 ID 与 tool result 必须配对；
- `keepLastN` 按完整 turn 计数，不按裸 message 数切断；
- 上下文超限策略建议：`fail`、`dropOldestCompleteTurns`、`summarizeThenTrim`。摘要是新的模型调用，应在 UI/history 中可追踪，不能伪装为无损压缩。

## 7. 流式、错误、中止与重试

### 7.1 SSE 实现

浏览器不能用普通 `EventSource`，因为生成是 POST 且需要自定义 Authorization/header。应使用 `fetch` + `Response.body.getReader()` + `TextDecoder(stream: true)`。

解析器必须：

- 正确处理任意 TCP chunk 边界、CRLF/LF、跨 chunk UTF-8；
- 累积一个 SSE event 的多行 `data:`；
- Responses 读取 `event:`/JSON `type`，只在 `response.completed` 成功收尾；处理 `response.failed` 和 `error`；
- Chat 解析 `data: {...}`，按 choice/index/tool-call-index 合并 delta，`data: [DONE]` 才正常结束；
- 限制单事件和总缓冲大小，拒绝无限无换行数据；
- content-type 不符时转到安全错误解析，不能把 HTML 当 SSE；
- 不执行尚未 complete 的 tool call；
- 断流后返回 `stream_interrupted`，保留可见 partial text 但标记 incomplete。

兼容服务常出现 JSONL、缺少 `event:`、缺 `[DONE]` 等差异；只能通过 profile 的 `streamDialect` 明确选择，不能使用过度宽松的自动猜测把损坏响应当成功。

### 7.2 中止与超时

每个模型请求创建单独 `AbortController`，组合用户取消、页面卸载/新命令取消和 timeout signal。错误分类至少区分：

- `user_aborted`；
- `timeout`；
- `network_or_cors`（浏览器通常无法进一步区分）；
- `mixed_content`（可在发请求前检测）；
- `stream_interrupted`。

用户中止后立即停止读取 stream、禁止新工具调用，并把当前 Agent run 标为 cancelled；已提交的本地工具结果不会自动回滚，需交给该 run 的恢复/撤回机制处理。

### 7.3 重试

建议默认 2 次以内、指数退避 + jitter，并尊重合理的 `Retry-After`。可重试候选：连接失败、408、409、429、5xx；401/403/404(model)、多数 400/422 不重试。

关键限制：

- 用户主动取消不重试；
- 已收到任何有效 stream event 后不自动重发整个生成请求，否则会重复计费/产生不同工具调用；
- 模型请求重试与本地工具重试分离；模型请求重试绝不重复已成功的本地写工具；
- tool continuation 重试复用同一 local run/call identity；领域命令继续依赖 `operationId` 幂等；
- 记录 attempt、status、requestId、backoff，不记录 request body 中可能包含的业务内容或 headers/secret；
- Provider 特有 `x-should-retry` 可作为 OpenAI adapter 的可选信号，不能假设所有兼容服务都实现。

### 7.4 规范化错误

```ts
interface ProviderError {
  kind: 'auth' | 'permission' | 'rate_limit' | 'model_not_found' |
    'invalid_request' | 'context_length' | 'timeout' | 'network_or_cors' |
    'tls_or_mixed_content' | 'stream_interrupted' | 'protocol' | 'server'
  status?: number
  providerCode?: string
  safeMessage: string
  requestId?: string
  retryAfterMs?: number
  retryable: boolean
}
```

错误解析接受标准 `{ error: { message, type, code, param } }`、顶层 message、纯文本和空响应。显示前进行长度限制与 secret redaction；绝不保存/展示请求 headers、完整请求 body、HTML 错误页、API Key 或秘密自定义 header。浏览器跨源 fetch 的 `TypeError` 往往无法区分 TLS/DNS/CORS，应如实显示“网络、TLS 或 CORS”，不要误判成认证错误。

## 8. API Key 与配置存储策略

### 8.1 推荐优先级

1. **安全默认：本机/远程 Gateway**。OpenAI Key 存在用户控制的 gateway 环境变量/系统密钥链；浏览器 profile 使用 `authMode: none` 或 gateway 自己的短期同源凭据。保持主应用无云业务后端，但需要文档化可选 companion gateway；若坚持绝对“零后端”，就不能声称安全支持 OpenAI Key。
2. **本地无 Key Provider**。对允许 CORS 的 Ollama/OpenAI-compatible local server 直接请求；这是“本地隐私模式”的合理默认。
3. **每次启动/每次使用输入**。Key 只存在 JS 内存，刷新/关闭即丢失；仍会暴露给同源运行时/XSS/扩展，只是降低静态落盘风险。
4. **仅本次会话**。同样建议内存，不使用 `sessionStorage`；`sessionStorage` 仍是可读取的持久 Web Storage，且页面复制/崩溃恢复语义由浏览器决定。
5. **保存在本机**。纯 Web 环境只能标“风险较高的本机浏览器存储”，必须二次确认；IndexedDB/localStorage 不是安全存储。若做 WebCrypto + 用户口令，口令不得落盘，可降低离线复制风险，但无法防止正在运行的恶意同源代码；不能称为平台安全存储。
6. **平台安全存储**。当前 PWA 无可靠通用接口；UI 应显示“不支持”。未来原生壳/桌面 companion 才可映射 macOS Keychain/Windows Credential Manager 等。

### 8.2 数据模型边界

建议至少分为：

- `ProviderProfile`：名称、协议、URL/path、model、普通 header、capability、非秘密参数；可备份/可导出。
- `LLMPreset`：引用 profile，保存 reasoning/generation/orchestrator 设置；可备份/可导出。
- `SecretMetadata`：`secretRef`、是否已配置、掩码尾部 4 位、保存策略、更新时间；模型工具只能读取这个投影。
- `SecretMaterial`：真实 key/秘密 header；仅 `SecretResolver` 可访问，永不进入领域 DB 的通用导出路径、ActivityLog、Agent history、错误、React props dump 或测试 fixture。

普通备份的“排除 LLM 配置”开关只控制 **非秘密** profile/preset/history 是否导出；secret 永远排除，不应提供“包含 secret”选项。导入 preset 时 `secretRef` 重置为未配置，要求用户重新输入。

### 8.3 UI/Agent 可见性

- UI 显示/隐藏只改变 input type；不把 Key 放到 DOM attribute、URL、toast、aria-label 或错误中。
- “我的 API Key 是什么”工具只能返回 `{ configured, masked, storagePolicy }`。
- LLM 修改 Provider 设置时可改变 model/effort/timeout 等，但不能调用任何 `getSecret` 能力。
- `customHeaders` 在发给模型的设置摘要中只显示 header name 与 `configured`，不显示值；普通 header value 也应谨慎，避免用户误把 token 放进未标秘密字段。

## 9. Provider-specific 参数与合并规则

允许高级 JSON，但不能任意覆盖：

1. 每个 adapter 提供 schema 与 allowlist；
2. core builder 先构建 `model/input|messages/tools/...`；
3. extra body 只填非保留键；发现与 core/secret/protocol 字段冲突即报错；
4. 限制深度、键数、字符串长度和总序列化大小；拒绝 `__proto__`、`constructor`、`prototype`；
5. `undefined/NaN/Infinity` 不可序列化；
6. 请求预览只展示 redacted body/headers；
7. Provider 参数是否生效记录到 `effectiveSettings`，不把“已保存”当作“Provider 已支持”。

保留键至少包含 model、input/messages、instructions、tools、tool_choice、parallel_tool_calls、stream、reasoning/reasoning_effort、temperature、top_p、max_output_tokens/max_completion_tokens/max_tokens、Authorization 与 secret headers。

## 10. 请求映射测试矩阵

测试应使用注入的 fake `fetch`/捕获 transport，断言 **实际 URL、method、headers、body、AbortSignal、重试次数及解析事件**，而非只测表单保存。所有 fixture 使用明显假值 `test-key-redacted`，测试失败输出需由 redactor 过滤。

### 10.1 每项设置的正向测试

| 编号 | 场景 | 必须断言 |
|---|---|---|
| MAP-001 | OpenAI Responses 默认 URL | POST `https://api.openai.com/v1/responses`，无双 `/v1` |
| MAP-002 | Compatible Responses 自定义 base/path | 精确组合且 query/fragment 策略明确 |
| MAP-003 | Chat 自定义 base/path | POST 到 `/chat/completions` |
| MAP-004 | Bearer Key | 仅 Authorization header；body/log 无 Key |
| MAP-005 | custom API-key header | 正确 header；redacted snapshot |
| MAP-006 | no-auth local | 不发送 Authorization |
| MAP-007 | organization/project | 仅 OpenAI adapter 发送官方 header |
| MAP-008 | model | 三协议 body `model` 精确等于 preset |
| MAP-009 | list models | GET models path、认证、标准结果解析 |
| MAP-010 | no models endpoint | 手工模型仍可连接/生成 |
| MAP-011 | Responses reasoning | `reasoning.effort`，无顶层 `reasoning_effort` |
| MAP-012 | Chat reasoning | 顶层 `reasoning_effort`，无 `reasoning` |
| MAP-013 | unsupported reasoning | body 完全 omit；effective report 标 omitted |
| MAP-014 | temperature | 显式值发送；inherit 不发送 |
| MAP-015 | top_p | 显式值发送；inherit 不发送 |
| MAP-016 | Responses max output | 只发 `max_output_tokens` |
| MAP-017 | modern Chat max output | 只发 `max_completion_tokens` |
| MAP-018 | legacy compatible Chat | 配置后只发 `max_tokens` |
| MAP-019 | timeout | body 无 timeout；signal 到期 abort |
| MAP-020 | max tool rounds | body 无此字段；orchestrator 恰好 N 轮停止 |
| MAP-021 | stream off/on | JSON 与 SSE parser 分流，body 值正确 |
| MAP-022 | parallel off/on | 支持时映射；写 capability 仍串行 |
| MAP-023 | retries | 408/409/429/5xx/network 尝试次数与 backoff |
| MAP-024 | history keep N | 完整 turn 保留，不产生孤立 tool output |
| MAP-025 | context trim | 仅删完整旧 turn；固定规则/当前用户消息保留 |
| MAP-026 | system append Responses | 每次 request/continuation 的 instructions 正确 |
| MAP-027 | system append Chat | developer/system 位置与顺序正确 |
| MAP-028 | provider params | allowlisted 键发送；核心冲突拒绝 |
| MAP-029 | custom headers | 非秘密发送；秘密仅 transport 注入；CORS 提示元数据 |
| MAP-030 | preset switch | 下一 command 使用完整新快照，运行中 command 不漂移 |
| MAP-031 | connection test models | 不产生 tool execution、不保存响应正文 |
| MAP-032 | connection fallback generation | 非流式、无工具、极小输出上限 |

以上每个关键 mapping 至少在三种 adapter 各有适用/omit 断言，不能只共享一个宽松 snapshot。

### 10.2 SSE 与协议测试

- Responses semantic event：created → text delta → function arguments delta/done → completed。
- Responses `response.failed` 与顶层 `error`。
- Chat content delta、分片 tool arguments、多 choices/index、`[DONE]`。
- chunk 恰好切在 `data:`、JSON 字符串、UTF-8 多字节和空行中间。
- CRLF、多行 data、注释/keepalive、未知 event type（忽略并记录而非崩溃）。
- 缺 completed/[DONE]、半截 JSON、reader throw、用户 abort、timeout。
- 错误 content-type、HTML、空 body、超大 event/缓冲上限。
- 断流后不自动重试，不执行 partial tool call，usage 缺失允许但状态必须 incomplete。

### 10.3 失败与安全测试

- 400 不支持参数：不静默判成功；用户确认移除后才发第二次。
- 401 无效 Key、403 权限、404 模型不存在、409、422、429、500/502/503。
- 标准 error JSON、顶层 message、纯文本、HTML、无 body、非 UTF-8。
- 上下文过长映射为 `context_length`；工具轮次上限是本地错误。
- CORS/网络 `TypeError` 的诚实模糊提示；预检失败不能误报 Key 错。
- HTTPS 页面配置 HTTP endpoint 的保存/测试前警告。
- URL userinfo、跨 origin redirect、forbidden header、header 换行注入、原型污染键。
- error message/body/header/history/backup/export/ActivityLog/console spy 中均搜索不到 secret。
- 备份始终排除 SecretMaterial；选择“排除 LLM 配置”时 profile/preset/history 也不出现。
- 导入 profile 后 secret 状态为未配置；重复 profile id/恶意 header 被拒绝。
- 多标签页下 preset 更新有 revision conflict；secret 不通过 BroadcastChannel/localStorage event 广播。

## 11. 实施优先级建议

1. 先冻结 `ProviderProtocol`、规范化 request/result/event/error、capability 与 secret 边界。
2. 先实现 `HttpTransport` + OpenAI Responses adapter + 全量 mapping/SSE 测试。
3. 再实现 compatible Responses；所有差异由显式 profile capability/dialect 表达。
4. 实现 Chat Completions adapter，单独处理 messages、tool call continuation、delta 和 token 字段。
5. 完成 secret-free ProviderProfile/LLMPreset schema 与 SecretResolver；在接入设置 UI 前先证明备份不会包含 secret。
6. 接入设置 UI、模型列表/连接测试与 effective/omitted 显示。
7. 最后接入 AgentOrchestrator；先做到无 Provider 配置时原应用完全无网络、无错误、原测试不变。

## 12. 建议的验收门槛

- 三个 adapter 都有独立 request mapping 和 parser 测试。
- 需求列出的每个设置至少有“发送”“omit/不支持”“切换 preset”证据。
- fake fetch 覆盖成功、错误、SSE 边界、断流、中止、重试。
- 任一 Provider 未配置时应用不发网络请求，既有功能可完整使用。
- OpenAI 官方 profile 默认展示“推荐网关；浏览器直连不安全”的明确文案。
- 任何普通备份、非秘密 preset 导出、Agent history、错误报告、日志或测试快照都不能包含 Key。
- UI 能解释：设置已保存、请求实际生效、Provider 不支持、请求失败，这四种状态互不混淆。
- CORS/mixed-content 限制写入 Provider 配置文档和连接错误帮助。

## 13. 未检查项

- 未运行当前 UI、Playwright、Vitest、lint、typecheck 或 build；本任务是架构/映射审查，不是回归测试。
- 未读取或修改尚未实现的 Provider/Agent 源码；审查时仓库中还没有相关实现。
- 未向 OpenAI、第三方兼容 API、Ollama/LM Studio 等真实服务发送请求。
- 未验证任何真实 API Key、组织、项目、模型权限、费用、限流或 CORS 配置。
- 未确认目标部署域名是否有外部 CSP/反向代理 header；仓库内没有 CSP 配置。
- 未为 optional companion gateway 选择实现语言、安装方式或原生密钥链方案；这需要主架构明确“无后端”是否允许用户自管的独立本机网关。
- 未验证 Safari/Firefox 的 ReadableStream、PWA mixed-content、本地服务证书和移动端后台中止差异。
- 未评估第三方 Provider 各自的数据保留、隐私、模型能力或非标准 tool schema；必须按具体 Provider 增加 adapter contract test，不能由“OpenAI-compatible”一词推定。

## 14. 最终审查结论

Provider Adapter 可在当前 React PWA 中实现，但“功能可用”和“密钥安全”必须分开陈述。三协议应共享规范化 Agent 接口，不共享未经区分的原始请求；每项设置必须生成可测试的 effective request 或明确 omitted 原因。对纯浏览器架构，最重要的停止条件是：**不要把 OpenAI Key 加进 `AppSettings`、IndexedDB 普通业务表或 JSON 备份，也不要把浏览器直连包装成安全存储。** 安全默认应是用户控制的 gateway 或无需 Key 的本地服务；直连 BYOK 只能作为带明确风险的兼容模式。
