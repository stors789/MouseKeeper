import { buildGenerationRequest, buildModelsRequest } from './request-builders'
import { parseChatJson, parseProviderStream, parseResponsesJson } from './parsers'
import type { BuiltProviderRequest, ConnectionReport, LLMPreset, ModelInfo, NormalizedLLMRequest, NormalizedLLMResult, ProviderEventListener, ProviderProfile } from './types'
import { ProviderError } from './types'
import type { SecretStore } from './secret-store'

export type FetchLike = typeof fetch

function redact(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏密钥]')
    .slice(0, 500)
}

function classifyStatus(status: number, body: string, requestId?: string): ProviderError {
  let message = body
  let code: string | undefined
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const error = parsed.error && typeof parsed.error === 'object' ? parsed.error as Record<string, unknown> : parsed
    if (typeof error.message === 'string') message = error.message
    if (typeof error.code === 'string') code = error.code
  } catch {
    if (/^\s*</.test(body)) message = 'Provider 返回了 HTML 错误页面'
  }
  const safe = redact(message || `Provider 请求失败（HTTP ${status}）`)
  if (status === 401) return new ProviderError('auth', safe, { status, providerCode: code, requestId })
  if (status === 403) return new ProviderError('permission', safe, { status, providerCode: code, requestId })
  if (status === 404) return new ProviderError('model-not-found', safe, { status, providerCode: code, requestId })
  if (status === 429) return new ProviderError('rate-limit', safe, { status, providerCode: code, requestId, retryable: true })
  if (status >= 500) return new ProviderError('server', safe, { status, providerCode: code, requestId, retryable: true })
  if (/context/i.test(code ?? '') || /context length/i.test(safe)) return new ProviderError('context-length', safe, { status, providerCode: code, requestId })
  return new ProviderError('invalid-request', safe, { status, providerCode: code, requestId, retryable: status === 408 || status === 409 })
}

function combineSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(new DOMException('Provider 请求超时', 'TimeoutError')), timeoutMs)
  const abort = () => controller.abort(parent?.reason)
  parent?.addEventListener('abort', abort, { once: true })
  return {
    signal: controller.signal,
    dispose: () => {
      globalThis.clearTimeout(timeout)
      parent?.removeEventListener('abort', abort)
    }
  }
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, ms)
    const abort = () => {
      globalThis.clearTimeout(timer)
      const reason: unknown = signal?.reason
      reject(reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError'))
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

async function send(
  request: BuiltProviderRequest,
  options: { timeoutMs: number; retries: number; signal?: AbortSignal; fetchImpl: FetchLike }
): Promise<{ response: Response; signal: AbortSignal; dispose: () => void }> {
  for (let attempt = 0; ; attempt += 1) {
    const timeout = combineSignal(options.signal, options.timeoutMs)
    let keepSignalAlive = false
    try {
      const response = await options.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: timeout.signal,
        redirect: 'error'
      })
      if (response.ok) {
        keepSignalAlive = true
        return { response, signal: timeout.signal, dispose: timeout.dispose }
      }
      const body = await response.text()
      const error = classifyStatus(response.status, body, response.headers.get('x-request-id') ?? undefined)
      if (!error.options.retryable || attempt >= options.retries) throw error
    } catch (error) {
      if (error instanceof ProviderError) {
        if (!error.options.retryable || attempt >= options.retries) throw error
      } else if (options.signal?.aborted) {
        throw new ProviderError('aborted', '请求已停止')
      } else if (timeout.signal.reason instanceof DOMException && timeout.signal.reason.name === 'TimeoutError') {
        if (attempt >= options.retries) throw new ProviderError('timeout', 'Provider 请求超时', { retryable: true })
      } else if (attempt >= options.retries) {
        throw new ProviderError('network-or-cors', '无法连接 Provider；请检查网络、TLS、CORS 和地址', { retryable: true })
      }
    } finally {
      if (!keepSignalAlive) timeout.dispose()
    }
    await wait(Math.min(250 * 2 ** attempt, 2_000), options.signal)
  }
}

export class ProviderClient {
  constructor(
    private readonly secrets: SecretStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async generate(
    profile: ProviderProfile,
    preset: LLMPreset,
    input: NormalizedLLMRequest,
    signal?: AbortSignal,
    onEvent?: ProviderEventListener
  ): Promise<NormalizedLLMResult> {
    const request = buildGenerationRequest(profile, preset, input, this.secrets)
    const sent = await send(request, {
      timeoutMs: preset.timeoutMs,
      retries: preset.retries,
      signal,
      fetchImpl: this.fetchImpl
    })
    try {
      if (preset.stream && profile.capabilities.streaming !== 'unsupported') {
        return await parseProviderStream(sent.response, profile.protocol, request.effective, profile.streamDialect, onEvent)
      }
      const value: unknown = await sent.response.json()
      return profile.protocol === 'compatible-chat-completions'
        ? parseChatJson(value, request.effective)
        : parseResponsesJson(value, request.effective)
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (signal?.aborted) throw new ProviderError('aborted', '请求已停止')
      if (sent.signal.reason instanceof DOMException && sent.signal.reason.name === 'TimeoutError') {
        throw new ProviderError('timeout', 'Provider 请求超时', { retryable: true })
      }
      throw error
    } finally {
      sent.dispose()
    }
  }

  async listModels(profile: ProviderProfile, signal?: AbortSignal): Promise<ModelInfo[]> {
    const request = buildModelsRequest(profile, this.secrets)
    const sent = await send(request, {
      timeoutMs: 20_000,
      retries: 1,
      signal,
      fetchImpl: this.fetchImpl
    })
    let value: unknown
    try {
      value = await sent.response.json()
    } finally {
      sent.dispose()
    }
    if (!value || typeof value !== 'object') throw new ProviderError('protocol', '模型列表格式无效')
    const record = value as Record<string, unknown>
    const items = Array.isArray(record.data)
      ? record.data
      : Array.isArray(record.models)
        ? record.models
        : Array.isArray(value)
          ? value
          : []
    return items.flatMap((item) => {
      if (typeof item === 'string') return [{ id: item }]
      if (!item || typeof item !== 'object' || typeof (item as Record<string, unknown>).id !== 'string') return []
      return [{
        id: String((item as Record<string, unknown>).id),
        ownedBy: typeof (item as Record<string, unknown>).owned_by === 'string'
          ? String((item as Record<string, unknown>).owned_by)
          : undefined
      }]
    })
  }

  async testConnection(
    profile: ProviderProfile,
    preset: LLMPreset,
    signal?: AbortSignal
  ): Promise<ConnectionReport> {
    const testedAt = new Date().toISOString()
    try {
      if (profile.modelsPath && profile.capabilities.modelListing !== 'unsupported') {
        const models = await this.listModels(profile, signal)
        return { ok: true, testedAt, method: 'models', modelCount: models.length }
      }
      const testPreset = {
        ...preset,
        stream: false,
        maxOutputTokens: 1,
        retries: 0
      }
      const result = await this.generate(profile, testPreset, {
        instructions: 'Reply with OK only. Do not call tools.',
        messages: [{ role: 'user', content: 'OK' }],
        tools: []
      }, signal)
      return { ok: true, testedAt, method: 'generation', requestId: result.id }
    } catch (error) {
      const providerError = error instanceof ProviderError
        ? error
        : new ProviderError('network-or-cors', '连接测试失败')
      return {
        ok: false,
        testedAt,
        method: profile.modelsPath ? 'models' : 'generation',
        error: { kind: providerError.kind, message: providerError.message }
      }
    }
  }
}
