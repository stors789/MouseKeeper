# LLM Provider 与自定义 API

## 推荐部署

安全默认是“用户网关持钥”：MouseKeeper 调用用户控制的本机或远程网关，浏览器中不保存上游 API Key。默认 OpenAI Responses 预设指向 `http://127.0.0.1:8787/v1`；它只是可编辑示例地址，项目不会自动启动网关。

浏览器也能以 Bearer 或自定义 Key Header 直连兼容服务，但这是显式高风险兼容模式。同源脚本、浏览器扩展、开发者工具、恶意依赖和共享浏览器配置可能读取运行中的秘密；跨源服务还必须正确配置 CORS，HTTPS 页面不能调用 HTTP 非本机端点。

## 协议

| 配置 | 生成端点 | 工具调用 | 思考强度映射 |
|---|---|---|---|
| OpenAI Responses | 自定义 `generationPath`，通常 `/responses` | Responses function tools | `reasoning: { effort }` |
| 兼容 Responses | 自定义 Responses 端点 | Responses/兼容 SSE | Provider 能力声明支持时发送 |
| 兼容 Chat Completions / 本地 | 通常 `/chat/completions` | Chat `tools` / `tool_calls` | 支持时为 `reasoning_effort` |

最大输出 token 在 Responses 使用 `max_output_tokens`；Chat 根据配置使用 `max_completion_tokens` 或旧式 `max_tokens`。temperature、top_p、流式输出、并行工具调用和 strict tools 只有在 Provider 能力不是“不支持”时才发送；被省略的参数记录在 effective settings 中，不会伪装生效。

流式响应支持 OpenAI SSE 和逐行 JSONL。SSE 的 Responses/Chat 文本 delta 会实时传入 Agent；JSONL 支持 EOF 无换行、`[DONE]`、Responses 完成事件和 Chat `finish_reason`。超时与停止信号覆盖整个响应体读取过程，完成事件前断流会失败，不能把部分文本当成成功。

## 可配置项

Provider 配置包括名称、协议、Base URL、生成路径、模型列表路径、认证方式、Key Header、Organization、Project、自定义普通/秘密请求头、SSE 方言和能力声明。预设包括 Provider、模型、reasoning effort、temperature、top_p、最大输出 token、超时、最大工具轮次、流式、并行工具调用、网络重试、历史长度、上下文策略、系统提示追加和 Provider 特有 JSON 参数。

上下文策略按完整工具轮次执行：`fail` 在发请求前报错，`drop-oldest` 丢弃最旧完整轮次，`summarize-then-trim` 生成带明确标记的本地确定性摘录后裁剪。最后一种不是语义摘要，不会额外调用或收费。

Base URL 不会自动追加 `/v1`。模型列表不可用不妨碍手工输入模型。连接测试优先使用模型列表；必要时使用不含业务工具的最小生成请求。界面会保留结构化的认证、权限、限流、模型不存在、请求无效、上下文过长、超时、CORS/网络、混合内容、断流、协议和服务器错误。

## API Key 保存策略

- 每次启动输入：仅存在当前页面内存，刷新后丢失。
- 仅本次标签页会话：保存到 sessionStorage，标签页会话结束后丢失。
- 保存在本机浏览器：保存到 localStorage，方便但风险最高。
- 平台加密保险库：只在 Tauri App 中可用。使用 Stronghold 加密持久化，必须在每次 App 启动后输入保险库口令；错误或不可用时不会退回 Web Storage。

原生 App 明确禁用 sessionStorage/localStorage 密钥持久化。Stronghold 提供静态加密，但当前 Provider 请求仍在 WebView 进程中短暂使用解密后的 Key，因此安全默认仍是无需客户端持有上游 Key 的用户网关。详见 [原生 App](native-app.md)。

界面支持显示/隐藏正在输入的 Key、保存或替换、清除和连接测试。设置页与 Agent 只能读取“是否配置、掩码后四位、保存策略”，不能读取原文。Agent 不能把一个已持钥 Provider 改指向其他端点、认证方式或秘密请求头。

## 非秘密配置迁移

“导出配置”包含 Provider 和预设，但不包含任何 Key 原文；导入时会清除所有 `secretRef`，需要用户重新输入。普通 MouseKeeper 16 表 JSON 备份也不包含 Provider 设置或秘密。不要把含真实凭据的截图、错误日志或浏览器存储导出提交到 Git。
