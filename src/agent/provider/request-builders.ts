import type { CapabilityToolDefinition } from '../../application'
import type { BuiltProviderRequest, EffectiveProviderSettings, LLMPreset, NormalizedLLMRequest, NormalizedMessage, ProviderProfile } from './types'
import type { SecretStore } from './secret-store'

const FORBIDDEN_HEADERS = new Set([
  'host', 'origin', 'content-length', 'cookie', 'set-cookie', 'connection',
  'transfer-encoding', 'upgrade', 'referer'
])

const RESERVED_BODY_FIELDS = new Set([
  'model', 'input', 'messages', 'instructions', 'tools', 'tool_choice',
  'parallel_tool_calls', 'stream', 'reasoning', 'reasoning_effort',
  'temperature', 'top_p', 'max_output_tokens', 'max_completion_tokens',
  'max_tokens'
])

export function joinProviderUrl(baseUrl: string, path: string): string {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    throw new Error('Base URL 无效')
  }
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Base URL 只支持 http/https')
  if (base.username || base.password) throw new Error('Base URL 不得包含用户名或密码')
  if (base.search || base.hash) throw new Error('Base URL 不得包含 query 或 fragment')
  const joined = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  const endpoint = new URL(joined)
  if (
    typeof location !== 'undefined' &&
    location.protocol === 'https:' &&
    endpoint.protocol === 'http:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
  ) {
    throw new Error('HTTPS 页面不能连接不安全的 HTTP Provider')
  }
  return endpoint.toString()
}

function trimCompleteTurns(messages: readonly NormalizedMessage[], limit: number): NormalizedMessage[] {
  if (messages.length <= limit) return structuredClone([...messages])
  const turns: NormalizedMessage[][] = []
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) turns.push([message])
    else turns.at(-1)!.push(message)
  }
  const kept: NormalizedMessage[] = []
  for (const turn of turns.toReversed()) {
    if (kept.length > 0 && kept.length + turn.length > limit) break
    kept.unshift(...turn)
  }
  return structuredClone(kept.length > 0 ? kept : turns.at(-1) ?? [])
}

function responseInput(messages: readonly NormalizedMessage[]): unknown[] {
  return messages.flatMap((message) => {
    if (message.role === 'tool') {
      return [{
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content
      }]
    }
    const items: unknown[] = [{ role: message.role, content: message.content }]
    for (const call of message.toolCalls ?? []) {
      items.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: call.rawArguments
      })
    }
    return items
  })
}

function chatMessages(instructions: string, messages: readonly NormalizedMessage[]): unknown[] {
  return [
    { role: 'developer', content: instructions },
    ...messages.map((message) => {
      if (message.role === 'tool') {
        return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
      }
      return {
        role: message.role,
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.rawArguments }
              }))
            }
          : {})
      }
    })
  ]
}

function chatTools(tools: readonly CapabilityToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: tool.strict
    }
  }))
}

function applyOptionalSettings(
  body: Record<string, unknown>,
  profile: ProviderProfile,
  preset: LLMPreset,
  effective: EffectiveProviderSettings
): void {
  const capabilities = profile.capabilities
  if (preset.reasoningEffort) {
    if (capabilities.reasoning === 'unsupported') {
      effective.omitted.push({ setting: 'reasoningEffort', reason: 'Provider 标记为不支持' })
    } else if (profile.protocol === 'compatible-chat-completions') {
      body.reasoning_effort = preset.reasoningEffort
    } else {
      body.reasoning = { effort: preset.reasoningEffort }
    }
  }
  if (preset.temperature !== undefined) {
    if (capabilities.temperature === 'unsupported') effective.omitted.push({ setting: 'temperature', reason: 'Provider 标记为不支持' })
    else body.temperature = preset.temperature
  }
  if (preset.topP !== undefined) {
    if (capabilities.topP === 'unsupported') effective.omitted.push({ setting: 'topP', reason: 'Provider 标记为不支持' })
    else body.top_p = preset.topP
  }
  if (preset.maxOutputTokens !== undefined) {
    if (capabilities.maxOutputTokens === 'unsupported') {
      effective.omitted.push({ setting: 'maxOutputTokens', reason: 'Provider 标记为不支持' })
    } else if (profile.protocol === 'compatible-chat-completions') {
      body[profile.chatMaxTokensField] = preset.maxOutputTokens
    } else body.max_output_tokens = preset.maxOutputTokens
  }
  if (profile.capabilities.streaming === 'unsupported' && preset.stream) {
    effective.omitted.push({ setting: 'stream', reason: 'Provider 标记为不支持' })
    body.stream = false
  } else body.stream = preset.stream
  if (profile.capabilities.parallelToolCalls === 'unsupported') {
    if (preset.parallelToolCalls) effective.omitted.push({ setting: 'parallelToolCalls', reason: 'Provider 标记为不支持' })
  } else body.parallel_tool_calls = preset.parallelToolCalls
}

function mergeProviderParameters(body: Record<string, unknown>, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (RESERVED_BODY_FIELDS.has(key)) throw new Error(`Provider 特有参数不能覆盖核心字段：${key}`)
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Provider 参数包含不安全键')
    body[key] = structuredClone(value)
  }
  if (JSON.stringify(values).length > 32 * 1024) throw new Error('Provider 特有参数过大')
}

function buildHeaders(profile: ProviderProfile, secrets: SecretStore): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' })
  const secret = profile.secretRef ? secrets.resolve(profile.secretRef) : undefined
  if (profile.authMode !== 'none' && !secret) throw new Error('Provider API Key 尚未配置')
  if (profile.authMode === 'bearer' && secret) headers.set('Authorization', `Bearer ${secret}`)
  if (profile.authMode === 'api-key-header' && secret) {
    const name = profile.apiKeyHeader?.trim()
    if (!name) throw new Error('未配置 API Key header 名称')
    headers.set(name, secret)
  }
  if (profile.protocol === 'openai-responses') {
    if (profile.organization) headers.set('OpenAI-Organization', profile.organization)
    if (profile.project) headers.set('OpenAI-Project', profile.project)
  }
  for (const custom of profile.customHeaders) {
    const name = custom.name.trim()
    const lower = name.toLocaleLowerCase()
    if (!name || FORBIDDEN_HEADERS.has(lower)) throw new Error(`不允许的自定义请求头：${name}`)
    if (['authorization', 'content-type', 'openai-organization', 'openai-project'].includes(lower)) {
      throw new Error(`自定义请求头与保留字段冲突：${name}`)
    }
    if (/\r|\n/.test(name)) throw new Error('请求头名称包含换行')
    const value = custom.secret
      ? custom.secretRef
        ? secrets.resolve(custom.secretRef)
        : undefined
      : custom.value
    if (custom.secret && !value) throw new Error(`秘密请求头 ${name} 尚未配置`)
    if (value !== undefined) {
      if (/\r|\n/.test(value)) throw new Error(`请求头 ${name} 的值包含换行`)
      headers.set(name, value)
    }
  }
  return headers
}

export function buildGenerationRequest(
  profile: ProviderProfile,
  preset: LLMPreset,
  request: NormalizedLLMRequest,
  secrets: SecretStore
): BuiltProviderRequest {
  if (!preset.model.trim()) throw new Error('尚未配置模型名称')
  const messages = trimCompleteTurns(request.messages, preset.historyLimit)
  const instructions = [request.instructions, preset.systemPromptAppend].filter(Boolean).join('\n\n')
  const effective: EffectiveProviderSettings = { requested: structuredClone(preset), omitted: [] }
  const body: Record<string, unknown> = { model: preset.model }
  if (profile.protocol === 'compatible-chat-completions') {
    body.messages = chatMessages(instructions, messages)
    body.tools = chatTools(request.tools)
  } else {
    body.instructions = instructions
    body.input = responseInput(messages)
    body.tools = request.tools
    body.store = false
    if (request.previousResponseId) body.previous_response_id = request.previousResponseId
  }
  applyOptionalSettings(body, profile, preset, effective)
  mergeProviderParameters(body, preset.providerParameters)
  return {
    url: joinProviderUrl(profile.baseUrl, profile.generationPath),
    method: 'POST',
    headers: buildHeaders(profile, secrets),
    body: JSON.stringify(body),
    effective
  }
}

export function buildModelsRequest(profile: ProviderProfile, secrets: SecretStore): BuiltProviderRequest {
  if (!profile.modelsPath) throw new Error('此 Provider 未配置模型列表接口')
  return {
    url: joinProviderUrl(profile.baseUrl, profile.modelsPath),
    method: 'GET',
    headers: buildHeaders(profile, secrets),
    effective: { requested: {} as LLMPreset, omitted: [] }
  }
}
