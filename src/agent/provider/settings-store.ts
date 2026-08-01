import { createDefaultProviderSettings } from './defaults'
import type { LLMPreset, ProviderProfile, ProviderSettingsDocument } from './types'

export const PROVIDER_SETTINGS_STORAGE_KEY = 'mousekeeper:llm-provider-settings:v1'

type Listener = () => void

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isDocument(value: unknown): value is ProviderSettingsDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProviderSettingsDocument>
  return candidate.version === 1 && Array.isArray(candidate.profiles) && Array.isArray(candidate.presets) && typeof candidate.defaultPresetId === 'string'
}

export class ProviderSettingsStore {
  readonly #listeners = new Set<Listener>()
  #memory?: ProviderSettingsDocument

  constructor(private readonly storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage) {}

  get(): ProviderSettingsDocument {
    if (this.#memory) return clone(this.#memory)
    const raw = this.storage?.getItem(PROVIDER_SETTINGS_STORAGE_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (isDocument(parsed)) {
          this.#memory = parsed
          return clone(parsed)
        }
      } catch {
        // Invalid local preferences never block the rest of the application.
      }
    }
    this.#memory = createDefaultProviderSettings()
    return clone(this.#memory)
  }

  set(next: ProviderSettingsDocument): void {
    if (!isDocument(next)) throw new Error('LLM Provider 设置格式无效')
    if (!next.presets.some((preset) => preset.id === next.defaultPresetId)) {
      throw new Error('默认预设不存在')
    }
    const serialized = JSON.stringify(next)
    if (/\bsk-[A-Za-z0-9_-]{8,}\b/.test(serialized)) {
      throw new Error('Provider 设置不得包含 API Key')
    }
    this.#memory = clone(next)
    this.storage?.setItem(PROVIDER_SETTINGS_STORAGE_KEY, serialized)
    this.#listeners.forEach((listener) => listener())
  }

  update(mutator: (current: ProviderSettingsDocument) => ProviderSettingsDocument): ProviderSettingsDocument {
    const next = mutator(this.get())
    this.set({ ...next, updatedAt: new Date().toISOString() })
    return this.get()
  }

  getProfile(id: string): ProviderProfile {
    const profile = this.get().profiles.find((item) => item.id === id)
    if (!profile) throw new Error(`Provider 配置不存在：${id}`)
    return profile
  }

  getPreset(id?: string): LLMPreset {
    const settings = this.get()
    const preset = settings.presets.find((item) => item.id === (id ?? settings.defaultPresetId))
    if (!preset) throw new Error('模型预设不存在')
    return preset
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  exportWithoutSecrets(): string {
    return JSON.stringify(this.get(), null, 2)
  }

  importWithoutSecrets(serialized: string): ProviderSettingsDocument {
    const parsed: unknown = JSON.parse(serialized)
    if (!isDocument(parsed)) throw new Error('不是有效的 MouseKeeper LLM 配置')
    const sanitized = clone(parsed)
    sanitized.profiles = sanitized.profiles.map((profile) => ({
      ...profile,
      secretRef: undefined,
      customHeaders: profile.customHeaders.map((header) => ({
        ...header,
        secretRef: undefined,
        value: header.secret ? undefined : header.value
      }))
    }))
    this.set(sanitized)
    return this.get()
  }
}

export const providerSettingsStore = new ProviderSettingsStore()
