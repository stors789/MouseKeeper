import type { CapabilityToolDefinition } from '../../application'
import { CHAT_COMPATIBLE_CAPABILITIES, OPENAI_RESPONSES_CAPABILITIES, createDefaultProviderSettings } from './defaults'
import { ProviderClient } from './client'
import { parseChatJson, parseOpenAiStream, parseProviderStream, parseResponsesJson } from './parsers'
import { applyContextStrategy, buildGenerationRequest, buildModelsRequest, joinProviderUrl } from './request-builders'
import { SecretStore } from './secret-store'
import type { LLMPreset, NormalizedLLMRequest, ProviderProfile } from './types'
import { ProviderError } from './types'

const tool: CapabilityToolDefinition = {
  type: 'function',
  name: 'execute_capability',
  description: 'execute',
  parameters: { type: 'object', additionalProperties: true },
  strict: true
}

const normalized: NormalizedLLMRequest = {
  instructions: '固定系统规则',
  messages: [{ role: 'user', content: '创建一只小鼠' }],
  tools: [tool]
}

function fixtures(protocol: ProviderProfile['protocol'] = 'openai-responses') {
  const defaults = createDefaultProviderSettings('2026-08-01T00:00:00.000Z')
  const base = defaults.profiles[0]!
  const profile: ProviderProfile = {
    ...base,
    id: `profile-${protocol}`,
    protocol,
    baseUrl: 'https://provider.example/v1',
    generationPath: protocol === 'compatible-chat-completions' ? '/chat/completions' : '/responses',
    authMode: 'none',
    capabilities: protocol === 'compatible-chat-completions'
      ? structuredClone(CHAT_COMPATIBLE_CAPABILITIES)
      : structuredClone(OPENAI_RESPONSES_CAPABILITIES)
  }
  const preset: LLMPreset = {
    ...defaults.presets[0]!,
    providerProfileId: profile.id,
    model: 'test-model',
    stream: false,
    retries: 0
  }
  return { profile, preset, secrets: new SecretStore(undefined, undefined) }
}

function bodyOf(profile: ProviderProfile, preset: LLMPreset, secrets = new SecretStore(undefined, undefined), input = normalized) {
  const request = buildGenerationRequest(profile, preset, input, secrets)
  return { request, body: JSON.parse(request.body!) as Record<string, unknown> }
}

function sse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  }), { headers: { 'Content-Type': 'text/event-stream' } })
}

describe('Provider request mapping', () => {
  it('MAP-001 joins the OpenAI Responses default URL without duplicating v1', () => {
    expect(joinProviderUrl('https://api.openai.com/v1/', '/responses')).toBe('https://api.openai.com/v1/responses')
  })

  it('MAP-002 maps a compatible Responses custom base and path exactly', () => {
    const { profile, preset, secrets } = fixtures('compatible-responses')
    profile.baseUrl = 'https://gateway.example/api/openai'
    profile.generationPath = '/custom-responses'
    expect(buildGenerationRequest(profile, preset, normalized, secrets).url).toBe('https://gateway.example/api/openai/custom-responses')
  })

  it('MAP-003 maps a compatible Chat Completions path', () => {
    const { profile, preset, secrets } = fixtures('compatible-chat-completions')
    expect(buildGenerationRequest(profile, preset, normalized, secrets).url).toBe('https://provider.example/v1/chat/completions')
  })

  it('MAP-004 injects a bearer key only into the Authorization header', () => {
    const { profile, preset, secrets } = fixtures()
    profile.authMode = 'bearer'
    profile.secretRef = 'provider-key'
    secrets.set('provider-key', 'test-key-redacted', 'prompt')
    const request = buildGenerationRequest(profile, preset, normalized, secrets)
    expect(request.headers.get('Authorization')).toBe('Bearer test-key-redacted')
    expect(request.body).not.toContain('test-key-redacted')
  })

  it('MAP-005 maps a custom API key header', () => {
    const { profile, preset, secrets } = fixtures('compatible-chat-completions')
    profile.authMode = 'api-key-header'
    profile.apiKeyHeader = 'X-API-Key'
    profile.secretRef = 'custom-key'
    secrets.set('custom-key', 'test-key-redacted', 'session')
    expect(buildGenerationRequest(profile, preset, normalized, secrets).headers.get('X-API-Key')).toBe('test-key-redacted')
  })

  it('MAP-006 sends no authorization for a no-auth local service', () => {
    const { profile, preset, secrets } = fixtures('compatible-chat-completions')
    expect(buildGenerationRequest(profile, preset, normalized, secrets).headers.has('Authorization')).toBe(false)
  })

  it('MAP-007 sends organization and project only for the OpenAI adapter', () => {
    const openai = fixtures()
    openai.profile.organization = 'org-test'
    openai.profile.project = 'proj-test'
    const openaiHeaders = buildGenerationRequest(openai.profile, openai.preset, normalized, openai.secrets).headers
    expect(openaiHeaders.get('OpenAI-Organization')).toBe('org-test')
    expect(openaiHeaders.get('OpenAI-Project')).toBe('proj-test')
    const chat = fixtures('compatible-chat-completions')
    chat.profile.organization = 'org-test'
    expect(buildGenerationRequest(chat.profile, chat.preset, normalized, chat.secrets).headers.has('OpenAI-Organization')).toBe(false)
  })

  it('MAP-008 maps the selected model for all protocols', () => {
    for (const protocol of ['openai-responses', 'compatible-responses', 'compatible-chat-completions'] as const) {
      const { profile, preset, secrets } = fixtures(protocol)
      preset.model = `model-${protocol}`
      expect(bodyOf(profile, preset, secrets).body.model).toBe(`model-${protocol}`)
    }
  })

  it('MAP-009 builds an authenticated model-list request', () => {
    const { profile, secrets } = fixtures()
    profile.authMode = 'bearer'
    profile.secretRef = 'models-key'
    secrets.set('models-key', 'test-key-redacted', 'prompt')
    const request = buildModelsRequest(profile, secrets)
    expect(request).toMatchObject({ method: 'GET', url: 'https://provider.example/v1/models' })
    expect(request.headers.get('Authorization')).toBe('Bearer test-key-redacted')
  })

  it('MAP-010 reports an absent model-list endpoint without blocking manual models', () => {
    const { profile, secrets } = fixtures()
    profile.modelsPath = undefined
    expect(() => buildModelsRequest(profile, secrets)).toThrow('未配置模型列表接口')
  })

  it('MAP-011 maps Responses reasoning to reasoning.effort', () => {
    const { profile, preset, secrets } = fixtures()
    preset.reasoningEffort = 'high'
    const { body } = bodyOf(profile, preset, secrets)
    expect(body.reasoning).toEqual({ effort: 'high' })
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it('MAP-012 maps Chat reasoning to the top-level reasoning_effort', () => {
    const { profile, preset, secrets } = fixtures('compatible-chat-completions')
    preset.reasoningEffort = 'medium'
    const { body } = bodyOf(profile, preset, secrets)
    expect(body.reasoning_effort).toBe('medium')
    expect(body).not.toHaveProperty('reasoning')
  })

  it('MAP-013 omits unsupported reasoning and records why', () => {
    const { profile, preset, secrets } = fixtures()
    profile.capabilities.reasoning = 'unsupported'
    preset.reasoningEffort = 'high'
    const { request, body } = bodyOf(profile, preset, secrets)
    expect(body).not.toHaveProperty('reasoning')
    expect(request.effective.omitted).toEqual(expect.arrayContaining([expect.objectContaining({ setting: 'reasoningEffort' })]))
  })

  it('MAP-014 sends explicit temperature and omits an unset value', () => {
    const { profile, preset, secrets } = fixtures()
    preset.temperature = 0.2
    expect(bodyOf(profile, preset, secrets).body.temperature).toBe(0.2)
    preset.temperature = undefined
    expect(bodyOf(profile, preset, secrets).body).not.toHaveProperty('temperature')
  })

  it('MAP-015 maps top_p and omits it when unsupported', () => {
    const { profile, preset, secrets } = fixtures()
    preset.topP = 0.7
    expect(bodyOf(profile, preset, secrets).body.top_p).toBe(0.7)
    profile.capabilities.topP = 'unsupported'
    expect(bodyOf(profile, preset, secrets).body).not.toHaveProperty('top_p')
  })

  it('MAP-016 maps Responses max output tokens only to max_output_tokens', () => {
    const { profile, preset, secrets } = fixtures()
    preset.maxOutputTokens = 2048
    const { body } = bodyOf(profile, preset, secrets)
    expect(body.max_output_tokens).toBe(2048)
    expect(body).not.toHaveProperty('max_completion_tokens')
  })

  it('MAP-017 maps modern Chat max output only to max_completion_tokens', () => {
    const { profile, preset, secrets } = fixtures('compatible-chat-completions')
    preset.maxOutputTokens = 2048
    const { body } = bodyOf(profile, preset, secrets)
    expect(body.max_completion_tokens).toBe(2048)
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('MAP-018 supports explicitly configured legacy Chat max_tokens', () => {
    const { profile, preset, secrets } = fixtures('compatible-chat-completions')
    profile.chatMaxTokensField = 'max_tokens'
    preset.maxOutputTokens = 512
    const { body } = bodyOf(profile, preset, secrets)
    expect(body.max_tokens).toBe(512)
    expect(body).not.toHaveProperty('max_completion_tokens')
  })

  it('MAP-019 keeps timeout in the transport instead of the request body', () => {
    const { profile, preset, secrets } = fixtures()
    preset.timeoutMs = 1234
    expect(bodyOf(profile, preset, secrets).body).not.toHaveProperty('timeout')
  })

  it('MAP-020 keeps max tool rounds local instead of sending max_tool_calls', () => {
    const { profile, preset, secrets } = fixtures()
    preset.maxToolRounds = 9
    const { body } = bodyOf(profile, preset, secrets)
    expect(body).not.toHaveProperty('maxToolRounds')
    expect(body).not.toHaveProperty('max_tool_calls')
  })

  it('MAP-021 maps streaming on and off', () => {
    const { profile, preset, secrets } = fixtures()
    preset.stream = true
    expect(bodyOf(profile, preset, secrets).body.stream).toBe(true)
    preset.stream = false
    expect(bodyOf(profile, preset, secrets).body.stream).toBe(false)
  })

  it('MAP-022 maps supported parallel tool calls and omits unsupported ones', () => {
    const { profile, preset, secrets } = fixtures()
    preset.parallelToolCalls = true
    expect(bodyOf(profile, preset, secrets).body.parallel_tool_calls).toBe(true)
    profile.capabilities.parallelToolCalls = 'unsupported'
    expect(bodyOf(profile, preset, secrets).body).not.toHaveProperty('parallel_tool_calls')
  })

  it('MAP-023 retries a retryable server response exactly as configured', async () => {
    const { profile, preset, secrets } = fixtures()
    preset.retries = 1
    let calls = 0
    const fakeFetch = (() => {
      calls += 1
      if (calls === 1) return Promise.resolve(new Response('{"error":{"message":"later"}}', { status: 503 }))
      return Promise.resolve(new Response(JSON.stringify({ id: 'r1', status: 'completed', output: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }) as typeof fetch
    await new ProviderClient(secrets, fakeFetch).generate(profile, preset, normalized)
    expect(calls).toBe(2)
  })

  it('MAP-024 trims history only at complete user-turn boundaries', () => {
    const { profile, preset, secrets } = fixtures('compatible-chat-completions')
    preset.historyLimit = 3
    const input: NormalizedLLMRequest = {
      ...normalized,
      messages: [
        { role: 'user', content: 'old' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'old-call', name: 'x', arguments: {}, rawArguments: '{}' }] },
        { role: 'tool', content: '{}', toolCallId: 'old-call' },
        { role: 'assistant', content: 'old done' },
        { role: 'user', content: 'new' },
        { role: 'assistant', content: 'new done' }
      ]
    }
    const messages = bodyOf(profile, preset, secrets, input).body.messages as Array<{ content: string }>
    expect(messages.map((message) => message.content)).toEqual(['固定系统规则', 'new', 'new done'])
  })

  it('MAP-024b preserves an oversized latest tool turn instead of emitting an orphan tool result', () => {
    const { profile, preset, secrets } = fixtures('compatible-chat-completions')
    preset.historyLimit = 2
    preset.contextStrategy = 'drop-oldest'
    const input: NormalizedLLMRequest = {
      ...normalized,
      messages: [
        { role: 'user', content: 'current' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'current-call', name: 'execute_capability', arguments: {}, rawArguments: '{}' }] },
        { role: 'tool', content: '{"ok":true}', toolCallId: 'current-call' },
        { role: 'assistant', content: 'done' }
      ]
    }
    const messages = bodyOf(profile, preset, secrets, input).body.messages as Array<Record<string, unknown>>
    expect(messages.slice(1).map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect((messages[2]?.tool_calls as Array<{ id: string }>)[0]?.id).toBe('current-call')
    expect(messages[3]?.tool_call_id).toBe('current-call')
  })

  it('MAP-025 preserves the current message when context strategy is drop-oldest', () => {
    const { profile, preset, secrets } = fixtures()
    preset.historyLimit = 1
    preset.contextStrategy = 'drop-oldest'
    const input = { ...normalized, messages: [{ role: 'user' as const, content: '当前指令' }] }
    expect(JSON.stringify(bodyOf(profile, preset, secrets, input).body)).toContain('当前指令')
  })

  it('implements fail context strategy locally before issuing a request', () => {
    const { profile, preset, secrets } = fixtures()
    preset.historyLimit = 2
    preset.contextStrategy = 'fail'
    const input: NormalizedLLMRequest = {
      ...normalized,
      messages: [
        { role: 'user', content: 'old' },
        { role: 'assistant', content: 'old answer' },
        { role: 'user', content: 'current' }
      ]
    }
    expect(() => bodyOf(profile, preset, secrets, input)).toThrow('超过本地上限')
  })

  it('summarizes dropped complete turns with a labeled local excerpt and keeps tool turns intact', () => {
    const messages: NormalizedLLMRequest['messages'] = [
      { role: 'user', content: 'old request' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'old-call', name: 'query.entities', arguments: {}, rawArguments: '{}' }] },
      { role: 'tool', content: '{"old":true}', toolCallId: 'old-call' },
      { role: 'assistant', content: 'old done' },
      { role: 'user', content: 'current request' },
      { role: 'assistant', content: 'current answer' }
    ]
    const prepared = applyContextStrategy(messages, 3, 'summarize-then-trim')
    expect(prepared[0]?.content).toContain('本地历史摘要')
    expect(prepared[0]?.content).toContain('工具 old-call')
    expect(prepared.slice(1).map((message) => message.content)).toEqual(['current request', 'current answer'])
  })

  it('MAP-026 appends custom system instructions for Responses', () => {
    const { profile, preset, secrets } = fixtures()
    preset.systemPromptAppend = '实验室自定义规则'
    expect(bodyOf(profile, preset, secrets).body.instructions).toBe('固定系统规则\n\n实验室自定义规则')
  })

  it('MAP-027 places Chat instructions in the developer message', () => {
    const { profile, preset, secrets } = fixtures('compatible-chat-completions')
    preset.systemPromptAppend = '实验室自定义规则'
    const messages = bodyOf(profile, preset, secrets).body.messages as Array<Record<string, unknown>>
    expect(messages[0]).toEqual({ role: 'developer', content: '固定系统规则\n\n实验室自定义规则' })
  })

  it('MAP-028 merges safe provider parameters and rejects core-field overrides', () => {
    const { profile, preset, secrets } = fixtures()
    preset.providerParameters = { metadata: { tenant: 'lab' } }
    expect(bodyOf(profile, preset, secrets).body.metadata).toEqual({ tenant: 'lab' })
    preset.providerParameters = { model: 'override' }
    expect(() => bodyOf(profile, preset, secrets)).toThrow('不能覆盖核心字段')
  })

  it('MAP-029 injects ordinary and secret custom headers without putting secrets in body', () => {
    const { profile, preset, secrets } = fixtures()
    profile.customHeaders = [
      { id: 'ordinary', name: 'X-Tenant', value: 'lab', secret: false },
      { id: 'secret', name: 'X-Gateway-Token', secret: true, secretRef: 'gateway-token' }
    ]
    secrets.set('gateway-token', 'test-header-secret', 'prompt')
    const request = buildGenerationRequest(profile, preset, normalized, secrets)
    expect(request.headers.get('X-Tenant')).toBe('lab')
    expect(request.headers.get('X-Gateway-Token')).toBe('test-header-secret')
    expect(request.body).not.toContain('test-header-secret')
  })

  it('MAP-030 snapshots the selected preset instead of mutating it during request building', () => {
    const { profile, preset, secrets } = fixtures()
    const request = buildGenerationRequest(profile, preset, normalized, secrets)
    preset.model = 'changed-after-build'
    expect((JSON.parse(request.body!) as Record<string, unknown>).model).toBe('test-model')
    expect(request.effective.requested.model).toBe('test-model')
  })

  it('MAP-031 lists standard models without running tools', async () => {
    const { profile, secrets } = fixtures()
    const fakeFetch = (() => Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'model-a', owned_by: 'lab' }] }), { status: 200 }))) as typeof fetch
    await expect(new ProviderClient(secrets, fakeFetch).listModels(profile)).resolves.toEqual([{ id: 'model-a', ownedBy: 'lab' }])
  })

  it('MAP-032 falls back to a minimal generation connection test', async () => {
    const { profile, preset, secrets } = fixtures()
    profile.modelsPath = undefined
    const bodies: string[] = []
    const fakeFetch = ((_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(typeof init?.body === 'string' ? init.body : '')
      return Promise.resolve(new Response(JSON.stringify({ id: 'test-response', status: 'completed', output: [] }), { status: 200 }))
    }) as typeof fetch
    const report = await new ProviderClient(secrets, fakeFetch).testConnection(profile, preset)
    expect(report).toMatchObject({ ok: true, method: 'generation' })
    const body = JSON.parse(bodies[0]!) as Record<string, unknown>
    expect(body).toMatchObject({ stream: false, max_output_tokens: 1 })
    expect(body.tools).toEqual([])
  })
})

describe('Provider parsers and failures', () => {
  const effective = { requested: fixtures().preset, omitted: [] }

  it('parses a non-streaming Responses result with tool calls', () => {
    const result = parseResponsesJson({
      id: 'resp-1', status: 'completed', output: [
        { type: 'message', content: [{ type: 'output_text', text: '开始执行' }] },
        { type: 'function_call', call_id: 'call-1', name: 'execute_capability', arguments: '{"capabilityId":"query.dashboard","input":{}}' }
      ]
    }, effective)
    expect(result.text).toBe('开始执行')
    expect(result.toolCalls[0]).toMatchObject({ id: 'call-1', name: 'execute_capability' })
  })

  it('parses a non-streaming Chat result with tool calls', () => {
    const result = parseChatJson({
      id: 'chat-1', choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ id: 'call-1', function: { name: 'execute_capability', arguments: '{}' } }] } }]
    }, effective)
    expect(result.toolCalls).toHaveLength(1)
  })

  it('parses Responses SSE across arbitrary chunks and requires completion', async () => {
    const response = sse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"你',
      '好"}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n'
    ])
    await expect(parseOpenAiStream(response, 'openai-responses', effective)).resolves.toMatchObject({ text: '你好', finishReason: 'completed' })
  })

  it('parses Chat SSE content and DONE', async () => {
    const response = sse(['data: {"id":"chat","choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'])
    await expect(parseOpenAiStream(response, 'compatible-chat-completions', effective)).resolves.toMatchObject({ text: 'OK' })
  })

  it('streams Responses text deltas through ProviderClient before completion', async () => {
    const { profile, preset, secrets } = fixtures()
    preset.stream = true
    const seen: string[] = []
    const fakeFetch = (() => Promise.resolve(sse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"先"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"做"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed"}\n\n'
    ]))) as typeof fetch
    const result = await new ProviderClient(secrets, fakeFetch).generate(profile, preset, normalized, undefined, (event) => {
      if (event.type === 'text-delta') seen.push(event.delta)
    })
    expect(seen).toEqual(['先', '做'])
    expect(result.text).toBe('先做')
  })

  it('streams Chat text deltas through ProviderClient and requires DONE', async () => {
    const { profile, preset, secrets } = fixtures('compatible-chat-completions')
    preset.stream = true
    const seen: string[] = []
    const fakeFetch = (() => Promise.resolve(sse([
      'data: {"id":"chat","choices":[{"delta":{"content":"O"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"K"}}]}\n\n',
      'data: [DONE]\n\n'
    ]))) as typeof fetch
    const result = await new ProviderClient(secrets, fakeFetch).generate(profile, preset, normalized, undefined, (event) => {
      if (event.type === 'text-delta') seen.push(event.delta)
    })
    expect(seen).toEqual(['O', 'K'])
    expect(result.text).toBe('OK')
  })

  it('parses JSONL Chat with a final line that has no newline', async () => {
    const response = sse([
      '{"id":"jsonl-chat","choices":[{"delta":{"content":"JSON"}}]}\n',
      '{"choices":[{"delta":{"content":"L"},"finish_reason":"stop"}]}'
    ])
    await expect(parseProviderStream(response, 'compatible-chat-completions', effective, 'jsonl')).resolves.toMatchObject({ text: 'JSONL', finishReason: 'completed' })
  })

  it('parses JSONL Responses completion and [DONE] semantics', async () => {
    const deltas: string[] = []
    const response = sse([
      '{"type":"response.output_text.delta","delta":"本"}\n',
      '{"type":"response.output_text.delta","delta":"地"}\n',
      '[DONE]'
    ])
    const result = await parseProviderStream(response, 'compatible-responses', effective, 'jsonl', (event) => {
      if (event.type === 'text-delta') deltas.push(event.delta)
    })
    expect(result.text).toBe('本地')
    expect(deltas).toEqual(['本', '地'])
  })

  it('rejects an interrupted stream instead of accepting partial text', async () => {
    const response = sse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'])
    const events: string[] = []
    await expect(parseOpenAiStream(response, 'compatible-chat-completions', effective, (event) => events.push(event.type))).rejects.toMatchObject({ kind: 'stream-interrupted' })
    expect(events).toEqual(['response-started', 'text-delta', 'response-failed'])
  })

  it('keeps timeout and abort active while consuming a streaming response body', async () => {
    const { profile, preset, secrets } = fixtures('compatible-chat-completions')
    preset.stream = true
    preset.timeoutMs = 5
    const fakeFetch = ((_url: string | URL | Request, init?: RequestInit) => Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true })
      }
    })))) as typeof fetch
    await expect(new ProviderClient(secrets, fakeFetch).generate(profile, preset, normalized)).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('classifies an invalid key without leaking request headers', async () => {
    const { profile, preset, secrets } = fixtures()
    const fakeFetch = (() => Promise.resolve(new Response('{"error":{"message":"bad key"}}', { status: 401 }))) as typeof fetch
    await expect(new ProviderClient(secrets, fakeFetch).generate(profile, preset, normalized)).rejects.toMatchObject({ kind: 'auth' })
  })

  it('classifies model-not-found responses', async () => {
    const { profile, preset, secrets } = fixtures()
    const fakeFetch = (() => Promise.resolve(new Response('{"error":{"message":"missing model"}}', { status: 404 }))) as typeof fetch
    await expect(new ProviderClient(secrets, fakeFetch).generate(profile, preset, normalized)).rejects.toMatchObject({ kind: 'model-not-found' })
  })

  it('classifies context-length failures', async () => {
    const { profile, preset, secrets } = fixtures()
    const fakeFetch = (() => Promise.resolve(new Response('{"error":{"message":"context length exceeded","code":"context_length_exceeded"}}', { status: 400 }))) as typeof fetch
    await expect(new ProviderClient(secrets, fakeFetch).generate(profile, preset, normalized)).rejects.toMatchObject({ kind: 'context-length' })
  })

  it('classifies browser fetch failures honestly as network or CORS', async () => {
    const { profile, preset, secrets } = fixtures()
    const fakeFetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch
    await expect(new ProviderClient(secrets, fakeFetch).generate(profile, preset, normalized)).rejects.toMatchObject({ kind: 'network-or-cors' })
  })

  it('times out with an AbortSignal and does not place timeout in the body', async () => {
    const { profile, preset, secrets } = fixtures()
    preset.timeoutMs = 5
    const fakeFetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const reason: unknown = init.signal?.reason
        reject(reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })) as typeof fetch
    await expect(new ProviderClient(secrets, fakeFetch).generate(profile, preset, normalized)).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('rejects invalid tool argument JSON', () => {
    expect(() => parseResponsesJson({ output: [{ type: 'function_call', call_id: 'x', name: 'x', arguments: '{' }] }, effective)).toThrow(ProviderError)
  })

  it('rejects forbidden and newline-injected custom headers', () => {
    const { profile, preset, secrets } = fixtures()
    profile.customHeaders = [{ id: 'bad', name: 'Cookie', value: 'x', secret: false }]
    expect(() => buildGenerationRequest(profile, preset, normalized, secrets)).toThrow('不允许')
    profile.customHeaders = [{ id: 'bad', name: 'X-Test', value: 'x\ny', secret: false }]
    expect(() => buildGenerationRequest(profile, preset, normalized, secrets)).toThrow('换行')
  })
})
