import type { LLMPreset, ProviderCapabilities, ProviderProfile, ProviderSettingsDocument } from './types'

const NOW = '2026-08-01T00:00:00.000Z'

export const OPENAI_RESPONSES_CAPABILITIES: ProviderCapabilities = {
  reasoning: 'supported',
  reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  temperature: 'unknown',
  topP: 'unknown',
  maxOutputTokens: 'supported',
  streaming: 'supported',
  parallelToolCalls: 'supported',
  modelListing: 'supported',
  strictTools: 'supported'
}

export const CHAT_COMPATIBLE_CAPABILITIES: ProviderCapabilities = {
  reasoning: 'unknown',
  reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  temperature: 'supported',
  topP: 'supported',
  maxOutputTokens: 'supported',
  streaming: 'supported',
  parallelToolCalls: 'unknown',
  modelListing: 'unknown',
  strictTools: 'unknown'
}

function profile(input: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'name' | 'protocol' | 'baseUrl' | 'generationPath' | 'authMode' | 'capabilities'>): ProviderProfile {
  return {
    modelsPath: '/models',
    customHeaders: [],
    streamDialect: 'openai-sse',
    chatMaxTokensField: 'max_completion_tokens',
    directBrowserRiskAccepted: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...input
  }
}

function preset(input: Partial<LLMPreset> & Pick<LLMPreset, 'id' | 'name' | 'providerProfileId' | 'model'>): LLMPreset {
  return {
    timeoutMs: 60_000,
    maxToolRounds: 12,
    stream: true,
    parallelToolCalls: false,
    retries: 2,
    historyLimit: 20,
    contextStrategy: 'drop-oldest',
    systemPromptAppend: '',
    providerParameters: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...input
  }
}

export function createDefaultProviderSettings(now = new Date().toISOString()): ProviderSettingsDocument {
  const profiles = [
    profile({
      id: 'openai-gateway',
      name: 'OpenAI Responses（用户网关）',
      protocol: 'openai-responses',
      baseUrl: 'http://127.0.0.1:8787/v1',
      generationPath: '/responses',
      authMode: 'none',
      capabilities: OPENAI_RESPONSES_CAPABILITIES,
      createdAt: now,
      updatedAt: now
    }),
    profile({
      id: 'local-compatible',
      name: '本地 OpenAI 兼容服务',
      protocol: 'compatible-chat-completions',
      baseUrl: 'http://127.0.0.1:11434/v1',
      generationPath: '/chat/completions',
      authMode: 'none',
      capabilities: CHAT_COMPATIBLE_CAPABILITIES,
      createdAt: now,
      updatedAt: now
    })
  ]
  const presets = [
    preset({
      id: 'high-quality',
      name: '高质量复杂操作',
      providerProfileId: 'openai-gateway',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      maxOutputTokens: 4096,
      createdAt: now,
      updatedAt: now
    }),
    preset({
      id: 'local-private',
      name: '本地隐私模式',
      providerProfileId: 'local-compatible',
      model: '',
      temperature: 0.1,
      maxOutputTokens: 2048,
      createdAt: now,
      updatedAt: now
    })
  ]
  return { version: 1, profiles, presets, defaultPresetId: 'high-quality', updatedAt: now }
}
