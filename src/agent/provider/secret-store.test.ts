import { ProviderSettingsStore } from './settings-store'
import { SecretStore } from './secret-store'
import type { PlatformSecretBackend } from '../../platform/stronghold-secrets'

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

class FakePlatformBackend implements PlatformSecretBackend {
  readonly supported = true
  readonly values = new Map<string, string>()
  unlock(_password: string, refs: readonly string[]) {
    return Promise.resolve(new Map([...this.values].filter(([ref]) => refs.includes(ref))))
  }
  set(ref: string, secret: string) { this.values.set(ref, secret); return Promise.resolve() }
  remove(ref: string) { this.values.delete(ref); return Promise.resolve() }
  lock() { return Promise.resolve() }
}

describe('native secret persistence boundary', () => {
  it('rejects Web Storage policies in native mode', () => {
    const session = new MemoryStorage()
    const local = new MemoryStorage()
    const store = new SecretStore(session, local, true, new FakePlatformBackend())

    expect(() => store.set('provider-a', 'not-a-real-secret', 'local')).toThrow('禁止')
    expect(() => store.set('provider-a', 'not-a-real-secret', 'session')).toThrow('禁止')
    expect(session.length).toBe(0)
    expect(local.length).toBe(0)
  })

  it('persists platform secrets only through the encrypted backend', async () => {
    const session = new MemoryStorage()
    const local = new MemoryStorage()
    const backend = new FakePlatformBackend()
    const store = new SecretStore(session, local, true, backend)

    await store.unlockPlatform('test-vault-password', ['provider-a'])
    await store.setPlatform('provider-a', 'test-key-redacted')

    expect(store.resolve('provider-a')).toBe('test-key-redacted')
    expect(backend.values.get('provider-a')).toBe('test-key-redacted')
    expect([...session.values.values(), ...local.values.values()]).not.toContain('test-key-redacted')
    expect(store.metadata('provider-a')).toMatchObject({ policy: 'platform', platformSupported: true })
  })

  it('does not put API key material in provider configuration exports', () => {
    const storage = new MemoryStorage()
    const settings = new ProviderSettingsStore(storage)
    const document = settings.get()
    document.profiles[0]!.secretRef = 'provider-a'
    settings.set(document)
    const exported = settings.exportWithoutSecrets()

    expect(exported).not.toContain('test-key-redacted')
    expect(exported).not.toContain('provider-a')
    expect(exported).not.toContain('secretRef')
    expect([...storage.values.values()]).not.toContain('test-key-redacted')
  })

  it('rejects secrets embedded in ordinary provider parameters', () => {
    const settings = new ProviderSettingsStore(new MemoryStorage())
    const document = settings.get()
    document.presets[0]!.providerParameters = { api_key: 'test-key-redacted' }

    expect(() => settings.set(document)).toThrow('不得包含 API Key')
  })
})
