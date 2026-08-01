import { describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '../application'
import { ProviderClient } from './provider/client'
import { ProviderSettingsStore } from './provider/settings-store'
import { SecretStore } from './provider/secret-store'
import { registerAgentSettingsCapabilities } from './settings-capabilities'

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>()
  get length() { return this.#values.size }
  clear() { this.#values.clear() }
  getItem(key: string) { return this.#values.get(key) ?? null }
  key(index: number) { return [...this.#values.keys()][index] ?? null }
  removeItem(key: string) { this.#values.delete(key) }
  setItem(key: string, value: string) { this.#values.set(key, value) }
}

function setup() {
  const storage = new MemoryStorage()
  const session = new MemoryStorage()
  const local = new MemoryStorage()
  const store = new ProviderSettingsStore(storage)
  const secrets = new SecretStore(session, local)
  const registry = registerAgentSettingsCapabilities(
    new CapabilityRegistry(), store, secrets, new ProviderClient(secrets)
  )
  const execute = (id: string, input: Record<string, unknown>) => registry.execute(id, input, {
    actor: 'llm', commandRunId: 'run', operationId: crypto.randomUUID()
  })
  return { execute, local, registry, secrets, session, storage, store }
}

describe('Agent settings capabilities', () => {
  it('returns secret metadata without returning the API key', async () => {
    const { execute, secrets, store } = setup()
    const profile = store.get().profiles[0]!
    secrets.set('primary', 'not-a-standard-secret-value', 'session')
    store.update((document) => ({
      ...document,
      profiles: document.profiles.map((item) => item.id === profile.id ? { ...item, secretRef: 'primary' } : item)
    }))

    const result = await execute('settings.agent.get', {})
    const serialized = JSON.stringify(result.data)
    expect(serialized).not.toContain('not-a-standard-secret-value')
    expect(serialized).not.toContain('"secretRef":"primary"')
    expect(serialized).toContain('"configured":true')
  })

  it('blocks endpoint changes when a provider holds a secret', async () => {
    const { execute, secrets, store } = setup()
    const profile = store.get().profiles[0]!
    secrets.set('primary', 'private-key', 'session')
    store.update((document) => ({
      ...document,
      profiles: document.profiles.map((item) => item.id === profile.id ? { ...item, secretRef: 'primary' } : item)
    }))

    await expect(execute('settings.agent.provider.update', {
      profileId: profile.id,
      patch: { baseUrl: 'https://attacker.invalid/v1' }
    })).rejects.toThrow('持有秘密')
    expect(store.getProfile(profile.id).baseUrl).not.toContain('attacker')
  })

  it('strips secret values and references from Agent header patches', async () => {
    const { execute, store } = setup()
    const profile = store.get().profiles[0]!
    await execute('settings.agent.provider.update', {
      profileId: profile.id,
      patch: { customHeaders: [{ id: 'h1', name: 'X-Secret', secret: true, value: 'raw-secret', secretRef: 'primary' }] }
    })
    expect(store.getProfile(profile.id).customHeaders[0]).toEqual({
      id: 'h1', name: 'X-Secret', secret: true, value: undefined, secretRef: undefined
    })
  })

  it('rejects raw secret-header values in non-secret settings storage', () => {
    const { store } = setup()
    const document = store.get()
    document.profiles[0]!.customHeaders = [{ id: 'h', name: 'X-Key', secret: true, value: 'plain-key' }]
    expect(() => store.set(document)).toThrow('秘密请求头')
  })

  it('updates, duplicates, selects and deletes presets', async () => {
    const { execute, store } = setup()
    const preset = store.getPreset()
    await execute('settings.agent.preset.update', { presetId: preset.id, patch: { model: 'model-next', maxToolRounds: 9 } })
    const duplicated = await execute('settings.agent.preset.duplicate', { presetId: preset.id, name: '复核预设' })
    const duplicateId = (duplicated.data as { id: string }).id
    await execute('settings.agent.preset.default', { presetId: duplicateId })
    expect(store.getPreset().name).toBe('复核预设')
    await execute('settings.agent.preset.delete', { presetId: duplicateId })
    expect(store.get().presets.some((item) => item.id === duplicateId)).toBe(false)
    expect(store.getPreset(preset.id).model).toBe('model-next')
  })

  it('rejects fields outside the public preset patch surface', async () => {
    const { execute, store } = setup()
    await expect(execute('settings.agent.preset.update', {
      presetId: store.getPreset().id,
      patch: { id: 'replaced' }
    })).rejects.toThrow('不允许修改')
  })

  it('exports and imports configuration without secret references', () => {
    const { store } = setup()
    const document = store.get()
    document.profiles[0]!.secretRef = 'private-ref'
    document.profiles[0]!.customHeaders = [{ id: 'h', name: 'X-Key', secret: true, secretRef: 'header-ref' }]
    store.set(document)
    const importedStore = new ProviderSettingsStore(new MemoryStorage())
    const imported = importedStore.importWithoutSecrets(store.exportWithoutSecrets())
    expect(imported.profiles[0]!.secretRef).toBeUndefined()
    expect(imported.profiles[0]!.customHeaders[0]!.secretRef).toBeUndefined()
  })

  it('keeps a stable React snapshot until settings change', () => {
    const { store } = setup()
    const first = store.snapshot()
    expect(store.snapshot()).toBe(first)
    store.update((document) => ({ ...document, defaultPresetId: document.presets[1]!.id }))
    expect(store.snapshot()).not.toBe(first)
  })
})
