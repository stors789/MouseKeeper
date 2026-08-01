import type { EffectiveProviderSettings, NormalizedLLMResult, NormalizedToolCall, ProviderProtocol } from './types'
import { ProviderError } from './types'

function scalarString(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback
}

function parseArguments(raw: unknown): { raw: string; value: Record<string, unknown> } {
  const text = typeof raw === 'string' ? raw : '{}'
  try {
    const value: unknown = JSON.parse(text || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return { raw: text, value: value as Record<string, unknown> }
  } catch {
    throw new ProviderError('protocol', '模型返回了无效的工具参数 JSON')
  }
}

function responseToolCall(item: Record<string, unknown>): NormalizedToolCall {
  const parsed = parseArguments(item.arguments)
  return {
    id: scalarString(item.call_id, scalarString(item.id, crypto.randomUUID())),
    name: scalarString(item.name),
    arguments: parsed.value,
    rawArguments: parsed.raw
  }
}

export function parseResponsesJson(value: unknown, effective: EffectiveProviderSettings): NormalizedLLMResult {
  if (!value || typeof value !== 'object') throw new ProviderError('protocol', 'Responses API 返回格式无效')
  const response = value as Record<string, unknown>
  const output = Array.isArray(response.output) ? response.output.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []
  const text = output.flatMap((item) => {
    if (item.type !== 'message' || !Array.isArray(item.content)) return []
    return item.content.flatMap((content) =>
      content && typeof content === 'object' && (content as Record<string, unknown>).type === 'output_text'
        ? [scalarString((content as Record<string, unknown>).text)]
        : []
    )
  }).join('')
  const toolCalls = output.filter((item) => item.type === 'function_call').map(responseToolCall)
  const usage = response.usage && typeof response.usage === 'object' ? response.usage as Record<string, unknown> : undefined
  return {
    id: typeof response.id === 'string' ? response.id : undefined,
    text,
    toolCalls,
    finishReason: typeof response.status === 'string' ? response.status : undefined,
    usage: usage ? {
      inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
      outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
      totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined
    } : undefined,
    effective
  }
}

export function parseChatJson(value: unknown, effective: EffectiveProviderSettings): NormalizedLLMResult {
  if (!value || typeof value !== 'object') throw new ProviderError('protocol', 'Chat Completions 返回格式无效')
  const response = value as Record<string, unknown>
  const choices = Array.isArray(response.choices) ? response.choices : []
  const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : undefined
  const message = first?.message && typeof first.message === 'object' ? first.message as Record<string, unknown> : undefined
  if (!message) throw new ProviderError('protocol', 'Chat Completions 缺少 message')
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const call = item as Record<string, unknown>
        const fn = call.function && typeof call.function === 'object' ? call.function as Record<string, unknown> : {}
        const parsed = parseArguments(fn.arguments)
        return [{ id: scalarString(call.id, crypto.randomUUID()), name: scalarString(fn.name), arguments: parsed.value, rawArguments: parsed.raw }]
      })
    : []
  const usage = response.usage && typeof response.usage === 'object' ? response.usage as Record<string, unknown> : undefined
  return {
    id: typeof response.id === 'string' ? response.id : undefined,
    text: typeof message.content === 'string' ? message.content : '',
    toolCalls,
    finishReason: typeof first?.finish_reason === 'string' ? first.finish_reason : undefined,
    usage: usage ? {
      inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
      outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
      totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined
    } : undefined,
    effective
  }
}

interface ChatToolAccumulator { id: string; name: string; arguments: string }

export async function parseOpenAiStream(
  response: Response,
  protocol: ProviderProtocol,
  effective: EffectiveProviderSettings
): Promise<NormalizedLLMResult> {
  if (!response.body) throw new ProviderError('stream-interrupted', 'Provider 没有返回流式响应体')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let completed = false
  let responseId: string | undefined
  const responsesCalls = new Map<string, { id: string; name: string; arguments: string }>()
  const chatCalls = new Map<number, ChatToolAccumulator>()

  const consume = (data: string, eventName?: string) => {
    if (data === '[DONE]') {
      completed = true
      return
    }
    let parsed: unknown
    try { parsed = JSON.parse(data) } catch { throw new ProviderError('protocol', '流式响应包含无效 JSON') }
    if (!parsed || typeof parsed !== 'object') return
    const event = parsed as Record<string, unknown>
    const type = typeof event.type === 'string' ? event.type : eventName
    if (protocol !== 'compatible-chat-completions') {
      if (type === 'response.output_text.delta') text += scalarString(event.delta)
      if (type === 'response.output_item.added' && event.item && typeof event.item === 'object') {
        const item = event.item as Record<string, unknown>
        if (item.type === 'function_call') {
          const key = scalarString(item.id, scalarString(item.call_id, String(responsesCalls.size)))
          responsesCalls.set(key, {
            id: scalarString(item.call_id, scalarString(item.id, key)),
            name: scalarString(item.name),
            arguments: scalarString(item.arguments)
          })
        }
      }
      if (type === 'response.function_call_arguments.delta') {
        const key = scalarString(event.item_id, scalarString(event.call_id))
        const call = responsesCalls.get(key) ?? {
          id: scalarString(event.call_id, key),
          name: scalarString(event.name),
          arguments: ''
        }
        call.arguments += scalarString(event.delta)
        responsesCalls.set(key, call)
      }
      if (type === 'response.completed') {
        completed = true
        if (event.response && typeof event.response === 'object') {
          const final = parseResponsesJson(event.response, effective)
          if (final.text || final.toolCalls.length) return final
        }
      }
      if (type === 'response.failed' || type === 'error') throw new ProviderError('server', 'Provider 报告流式生成失败')
      if (event.response && typeof event.response === 'object') {
        responseId = scalarString((event.response as Record<string, unknown>).id, responseId) || undefined
      }
      return
    }
    if (typeof event.id === 'string') responseId = event.id
    const choices = Array.isArray(event.choices) ? event.choices : []
    for (const choiceValue of choices) {
      if (!choiceValue || typeof choiceValue !== 'object') continue
      const choice = choiceValue as Record<string, unknown>
      const delta = choice.delta && typeof choice.delta === 'object' ? choice.delta as Record<string, unknown> : {}
      if (typeof delta.content === 'string') text += delta.content
      if (Array.isArray(delta.tool_calls)) {
        for (const callValue of delta.tool_calls) {
          if (!callValue || typeof callValue !== 'object') continue
          const part = callValue as Record<string, unknown>
          const index = typeof part.index === 'number' ? part.index : 0
          const fn = part.function && typeof part.function === 'object' ? part.function as Record<string, unknown> : {}
          const current = chatCalls.get(index) ?? { id: '', name: '', arguments: '' }
          if (typeof part.id === 'string') current.id = part.id
          if (typeof fn.name === 'string') current.name += fn.name
          if (typeof fn.arguments === 'string') current.arguments += fn.arguments
          chatCalls.set(index, current)
        }
      }
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    if (buffer.length > 2 * 1024 * 1024) throw new ProviderError('protocol', '流式响应缓冲区过大')
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      let eventName: string | undefined
      const dataLines: string[] = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      if (dataLines.length > 0) {
        const final = consume(dataLines.join('\n'), eventName)
        if (final) return final
      }
    }
  }
  if (!completed) throw new ProviderError('stream-interrupted', '流式响应在完成事件前中断')
  const calls = protocol === 'compatible-chat-completions'
    ? [...chatCalls.values()].map((call) => {
        const parsed = parseArguments(call.arguments)
        return { id: call.id || crypto.randomUUID(), name: call.name, arguments: parsed.value, rawArguments: parsed.raw }
      })
    : [...responsesCalls.values()].map((call) => {
        const parsed = parseArguments(call.arguments)
        return { id: call.id, name: call.name, arguments: parsed.value, rawArguments: parsed.raw }
      })
  return { id: responseId, text, toolCalls: calls, finishReason: 'completed', effective }
}
