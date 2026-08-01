import { objectSchema, stringSchema } from '../application/capabilities/schema'
import type { CapabilityDescriptor, CapabilityRegistry } from '../application'
import type { ProviderClient } from './provider/client'
import type { ProviderSettingsStore } from './provider/settings-store'
import type { SecretStore } from './provider/secret-store'
import type { LLMPreset, ProviderProfile } from './provider/types'

function descriptor(input: Partial<CapabilityDescriptor> & Pick<CapabilityDescriptor, 'id' | 'name' | 'description' | 'kind' | 'inputSchema' | 'modifiesData' | 'risk' | 'recovery' | 'service'>): CapabilityDescriptor {
  return {
    version: 1,
    domain: 'settings',
    outputDescription: 'LLM Provider/预设设置结果',
    requiredContext: [],
    reads: ['provider profiles', 'LLM presets'],
    writes: input.modifiesData ? ['local non-secret provider preferences'] : [],
    supportsBatch: false,
    errorTypes: ['validation', 'not-found', 'provider'],
    preconditions: [],
    testLocations: ['src/agent/settings-capabilities.test.ts'],
    llmExposed: true,
    ...input
  }
}

export const AGENT_SETTINGS_DESCRIPTORS: readonly CapabilityDescriptor[] = [
  descriptor({
    id: 'settings.agent.get', name: '查看 Agent 设置', description: '查看 Provider、预设和 API Key 是否已配置的安全摘要；永不返回秘密原文。', kind: 'query', inputSchema: objectSchema({}), modifiesData: false, risk: 'read-only', recovery: 'none', service: 'ProviderSettingsStore'
  }),
  descriptor({
    id: 'settings.agent.preset.update', name: '更新模型预设', description: '修改预设的模型、思考强度、生成参数、超时、工具轮次、历史或系统追加提示。', kind: 'command', inputSchema: objectSchema({ presetId: stringSchema(), patch: objectSchema({}, [], undefined, true) }, ['presetId', 'patch']), modifiesData: true, risk: 'reversible', recovery: 'row-diff', service: 'ProviderSettingsStore'
  }),
  descriptor({
    id: 'settings.agent.preset.default', name: '设置默认预设', description: '设置下一条 Agent 命令默认使用的模型预设。', kind: 'command', inputSchema: objectSchema({ presetId: stringSchema() }, ['presetId']), modifiesData: true, risk: 'reversible', recovery: 'row-diff', service: 'ProviderSettingsStore'
  }),
  descriptor({
    id: 'settings.agent.preset.duplicate', name: '复制模型预设', description: '复制现有预设并使用新名称。', kind: 'command', inputSchema: objectSchema({ presetId: stringSchema(), name: stringSchema() }, ['presetId', 'name']), modifiesData: true, risk: 'reversible', recovery: 'row-diff', service: 'ProviderSettingsStore'
  }),
  descriptor({
    id: 'settings.agent.preset.delete', name: '删除模型预设', description: '删除非唯一的模型预设；如果它是默认预设则自动选择另一个。', kind: 'command', inputSchema: objectSchema({ presetId: stringSchema() }, ['presetId']), modifiesData: true, risk: 'reversible', recovery: 'row-diff', service: 'ProviderSettingsStore'
  }),
  descriptor({
    id: 'settings.agent.provider.update', name: '更新 Provider 配置', description: '修改 Provider 名称、协议、URL、路径、认证模式、普通请求头和能力声明；不能读取或设置 API Key。', kind: 'command', inputSchema: objectSchema({ profileId: stringSchema(), patch: objectSchema({}, [], undefined, true) }, ['profileId', 'patch']), modifiesData: true, risk: 'reversible', recovery: 'row-diff', service: 'ProviderSettingsStore'
  }),
  descriptor({
    id: 'settings.agent.models.list', name: '获取模型列表', description: '从 Provider 的模型接口读取模型 ID；接口不可用时不会阻止手动模型名。', kind: 'query', inputSchema: objectSchema({ profileId: stringSchema() }, ['profileId']), modifiesData: false, risk: 'read-only', recovery: 'none', service: 'ProviderClient.listModels'
  }),
  descriptor({
    id: 'settings.agent.connection.test', name: '测试 Provider 连接', description: '测试模型列表或最小生成请求，不执行任何工具。', kind: 'query', inputSchema: objectSchema({ profileId: stringSchema(), presetId: stringSchema() }, ['profileId', 'presetId']), modifiesData: false, risk: 'read-only', recovery: 'none', service: 'ProviderClient.testConnection'
  })
]

const PRESET_PATCH_KEYS = new Set<keyof LLMPreset>([
  'name', 'providerProfileId', 'model', 'reasoningEffort', 'temperature', 'topP',
  'maxOutputTokens', 'timeoutMs', 'maxToolRounds', 'stream', 'parallelToolCalls',
  'retries', 'historyLimit', 'contextStrategy', 'systemPromptAppend', 'providerParameters'
])

const PROFILE_PATCH_KEYS = new Set<keyof ProviderProfile>([
  'name', 'protocol', 'baseUrl', 'generationPath', 'modelsPath', 'authMode',
  'apiKeyHeader', 'organization', 'project', 'customHeaders', 'capabilities',
  'streamDialect', 'chatMaxTokensField', 'directBrowserRiskAccepted'
])

const SECURITY_SENSITIVE_PROFILE_KEYS = new Set<keyof ProviderProfile>([
  'protocol', 'baseUrl', 'generationPath', 'modelsPath', 'authMode',
  'apiKeyHeader', 'organization', 'project', 'customHeaders', 'streamDialect'
])

function safePatch<T extends object>(
  value: unknown,
  allowed: ReadonlySet<keyof T>
): Partial<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('patch 必须是对象')
  const output: Partial<T> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (!allowed.has(key as keyof T)) throw new Error(`不允许修改设置字段：${key}`)
    ;(output as Record<string, unknown>)[key] = structuredClone(nested)
  }
  return output
}

function safeProfiles(profiles: readonly ProviderProfile[], secrets: SecretStore) {
  return profiles.map((profile) => ({
    ...profile,
    secretRef: undefined,
    secret: profile.secretRef
      ? secrets.metadata(profile.secretRef)
      : { configured: false, policy: 'prompt', platformSupported: false },
    customHeaders: profile.customHeaders.map((header) => ({
      id: header.id,
      name: header.name,
      secret: header.secret,
      configured: header.secret
        ? Boolean(header.secretRef && secrets.metadata(header.secretRef).configured)
        : Boolean(header.value),
      value: header.secret ? undefined : header.value
    }))
  }))
}

export function registerAgentSettingsCapabilities(
  registry: CapabilityRegistry,
  store: ProviderSettingsStore,
  secrets: SecretStore,
  client: ProviderClient
): CapabilityRegistry {
  for (const item of AGENT_SETTINGS_DESCRIPTORS) {
    if (registry.get(item.id)) continue
    registry.register(item, {
      async execute(input) {
        if (item.id === 'settings.agent.get') {
          const document = store.get()
          const data = { ...document, profiles: safeProfiles(document.profiles, secrets) }
          return { status: 'succeeded', capabilityId: item.id, summary: `已读取 ${document.profiles.length} 个 Provider 和 ${document.presets.length} 个预设`, data, affected: [], warnings: [], modifiesData: false }
        }
        if (item.id === 'settings.agent.preset.update') {
          const presetId = String(input.presetId)
          const patch = safePatch<LLMPreset>(input.patch, PRESET_PATCH_KEYS)
          const updatedAt = new Date().toISOString()
          let updated: LLMPreset | undefined
          store.update((document) => ({
            ...document,
            presets: document.presets.map((preset) => {
              if (preset.id !== presetId) return preset
              updated = { ...preset, ...patch, id: preset.id, updatedAt }
              return updated
            })
          }))
          if (!updated) throw new Error('预设不存在')
          return { status: 'succeeded', capabilityId: item.id, summary: `已更新预设 ${updated.name}`, data: updated, affected: [], warnings: [], modifiesData: true }
        }
        if (item.id === 'settings.agent.preset.default') {
          const presetId = String(input.presetId)
          store.update((document) => {
            if (!document.presets.some((preset) => preset.id === presetId)) throw new Error('预设不存在')
            return { ...document, defaultPresetId: presetId }
          })
          return { status: 'succeeded', capabilityId: item.id, summary: `默认预设已切换为 ${store.getPreset(presetId).name}`, data: { presetId }, affected: [], warnings: [], modifiesData: true }
        }
        if (item.id === 'settings.agent.preset.duplicate') {
          const source = store.getPreset(String(input.presetId))
          const now = new Date().toISOString()
          const duplicate: LLMPreset = { ...structuredClone(source), id: crypto.randomUUID(), name: String(input.name), createdAt: now, updatedAt: now }
          store.update((document) => ({ ...document, presets: [...document.presets, duplicate] }))
          return { status: 'succeeded', capabilityId: item.id, summary: `已复制预设为 ${duplicate.name}`, data: duplicate, affected: [], warnings: [], modifiesData: true }
        }
        if (item.id === 'settings.agent.preset.delete') {
          const presetId = String(input.presetId)
          store.update((document) => {
            if (document.presets.length <= 1) throw new Error('至少保留一个模型预设')
            const presets = document.presets.filter((preset) => preset.id !== presetId)
            if (presets.length === document.presets.length) throw new Error('预设不存在')
            return {
              ...document,
              presets,
              defaultPresetId: document.defaultPresetId === presetId ? presets[0]!.id : document.defaultPresetId
            }
          })
          return { status: 'succeeded', capabilityId: item.id, summary: '模型预设已删除', data: { presetId }, affected: [], warnings: [], modifiesData: true }
        }
        if (item.id === 'settings.agent.provider.update') {
          const profileId = String(input.profileId)
          const patch = safePatch<ProviderProfile>(input.patch, PROFILE_PATCH_KEYS)
          const serialized = JSON.stringify(patch)
          if (/\bsk-[A-Za-z0-9_-]{8,}\b/.test(serialized)) throw new Error('Provider patch 不得包含 API Key')
          const current = store.getProfile(profileId)
          const holdsSecret = Boolean(
            current.secretRef && secrets.metadata(current.secretRef).configured
          ) || current.customHeaders.some((header) =>
            Boolean(header.secretRef && secrets.metadata(header.secretRef).configured)
          )
          if (holdsSecret && Object.keys(patch).some((key) => SECURITY_SENSITIVE_PROFILE_KEYS.has(key as keyof ProviderProfile))) {
            throw new Error('持有秘密的 Provider 不能由 Agent 修改端点、认证或请求头；请在设置页中由用户完成')
          }
          if (patch.customHeaders) {
            patch.customHeaders = patch.customHeaders.map((header) => ({
              id: header.id,
              name: header.name,
              secret: header.secret,
              value: header.secret ? undefined : header.value,
              secretRef: undefined
            }))
          }
          let updated: ProviderProfile | undefined
          store.update((document) => ({
            ...document,
            profiles: document.profiles.map((profile) => {
              if (profile.id !== profileId) return profile
              updated = { ...profile, ...patch, id: profile.id, secretRef: profile.secretRef, updatedAt: new Date().toISOString() }
              return updated
            })
          }))
          if (!updated) throw new Error('Provider 不存在')
          return { status: 'succeeded', capabilityId: item.id, summary: `已更新 Provider ${updated.name}`, data: { ...updated, secretRef: undefined }, affected: [], warnings: [], modifiesData: true }
        }
        if (item.id === 'settings.agent.models.list') {
          const profile = store.getProfile(String(input.profileId))
          const models = await client.listModels(profile)
          return { status: 'succeeded', capabilityId: item.id, summary: `Provider 返回 ${models.length} 个模型`, data: models, affected: [], warnings: [], modifiesData: false }
        }
        if (item.id === 'settings.agent.connection.test') {
          const profile = store.getProfile(String(input.profileId))
          const preset = store.getPreset(String(input.presetId))
          const report = await client.testConnection(profile, preset)
          return { status: 'succeeded', capabilityId: item.id, summary: report.ok ? 'Provider 连接测试通过' : `连接测试失败：${report.error?.message}`, data: report, affected: [], warnings: report.ok ? [] : [report.error?.message ?? '连接失败'], modifiesData: false }
        }
        throw new Error(`Agent 设置能力没有 handler：${item.id}`)
      }
    })
  }
  return registry
}
