import type { CapabilityToolDefinition } from '../../application'

export type ProviderProtocol =
  | 'openai-responses'
  | 'compatible-responses'
  | 'compatible-chat-completions'

export type ProviderAuthMode = 'none' | 'bearer' | 'api-key-header'
export type ParameterSupport = 'supported' | 'unsupported' | 'unknown'
export type ContextStrategy = 'fail' | 'drop-oldest' | 'summarize-then-trim'
export type SecretStoragePolicy = 'prompt' | 'session' | 'local' | 'platform'

export interface ProviderCapabilities {
  reasoning: ParameterSupport
  reasoningEfforts: string[]
  temperature: ParameterSupport
  topP: ParameterSupport
  maxOutputTokens: ParameterSupport
  streaming: ParameterSupport
  parallelToolCalls: ParameterSupport
  modelListing: ParameterSupport
  strictTools: ParameterSupport
}

export interface ProviderHeader {
  id: string
  name: string
  value?: string
  secret: boolean
  secretRef?: string
}

export interface ProviderProfile {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  generationPath: string
  modelsPath?: string
  authMode: ProviderAuthMode
  apiKeyHeader?: string
  secretRef?: string
  organization?: string
  project?: string
  customHeaders: ProviderHeader[]
  capabilities: ProviderCapabilities
  streamDialect: 'openai-sse' | 'jsonl'
  chatMaxTokensField: 'max_completion_tokens' | 'max_tokens'
  directBrowserRiskAccepted: boolean
  createdAt: string
  updatedAt: string
}

export interface LLMPreset {
  id: string
  name: string
  providerProfileId: string
  model: string
  reasoningEffort?: string
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  timeoutMs: number
  maxToolRounds: number
  stream: boolean
  parallelToolCalls: boolean
  retries: number
  historyLimit: number
  contextStrategy: ContextStrategy
  systemPromptAppend: string
  providerParameters: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ProviderSettingsDocument {
  version: 1
  profiles: ProviderProfile[]
  presets: LLMPreset[]
  defaultPresetId: string
  connectionReports: Record<string, ConnectionReport>
  updatedAt: string
}

export interface SecretMetadata {
  configured: boolean
  masked?: string
  policy: SecretStoragePolicy
  updatedAt?: string
  platformSupported: boolean
}

export interface NormalizedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  rawArguments: string
}

export interface NormalizedMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: NormalizedToolCall[]
}

export interface NormalizedLLMRequest {
  instructions: string
  messages: NormalizedMessage[]
  tools: CapabilityToolDefinition[]
  previousResponseId?: string
}

export interface EffectiveProviderSettings {
  requested: LLMPreset
  omitted: Array<{ setting: string; reason: string }>
}

export interface NormalizedLLMResult {
  id?: string
  text: string
  toolCalls: NormalizedToolCall[]
  finishReason?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  effective: EffectiveProviderSettings
}

export type ProviderEvent =
  | { type: 'response-started'; id?: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call-completed'; call: NormalizedToolCall }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { type: 'response-completed'; result: NormalizedLLMResult }
  | { type: 'response-failed'; error: ProviderError }

export type ProviderEventListener = (event: ProviderEvent) => void

export type ProviderErrorKind =
  | 'auth'
  | 'permission'
  | 'rate-limit'
  | 'model-not-found'
  | 'invalid-request'
  | 'context-length'
  | 'timeout'
  | 'network-or-cors'
  | 'mixed-content'
  | 'stream-interrupted'
  | 'protocol'
  | 'server'
  | 'aborted'

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly options: {
      status?: number
      providerCode?: string
      requestId?: string
      retryAfterMs?: number
      retryable?: boolean
    } = {}
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export interface BuiltProviderRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Headers
  body?: string
  effective: EffectiveProviderSettings
}

export interface ModelInfo {
  id: string
  ownedBy?: string
}

export interface ConnectionReport {
  ok: boolean
  testedAt: string
  method: 'models' | 'generation'
  modelCount?: number
  requestId?: string
  error?: { kind: ProviderErrorKind; message: string }
}
