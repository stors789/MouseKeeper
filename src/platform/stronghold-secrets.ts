import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { Stronghold, type Client, type Store } from '@tauri-apps/plugin-stronghold'

export interface PlatformSecretBackend {
  readonly supported: boolean
  unlock(password: string, refs: readonly string[]): Promise<Map<string, string>>
  set(ref: string, secret: string): Promise<void>
  remove(ref: string): Promise<void>
  lock(): Promise<void>
}

const CLIENT_NAME = 'mousekeeper-provider-secrets'

export class StrongholdSecretBackend implements PlatformSecretBackend {
  readonly supported = true
  #stronghold?: Stronghold
  #store?: Store

  async unlock(password: string, refs: readonly string[]): Promise<Map<string, string>> {
    if (!password) throw new Error('请输入原生凭据保险库口令')
    const vaultPath = await join(await appLocalDataDir(), 'mousekeeper-secrets.hold')
    const stronghold = await Stronghold.load(vaultPath, password)
    let client: Client
    try {
      client = await stronghold.loadClient(CLIENT_NAME)
    } catch {
      client = await stronghold.createClient(CLIENT_NAME)
      await stronghold.save()
    }
    this.#stronghold = stronghold
    this.#store = client.getStore()
    const values = new Map<string, string>()
    for (const ref of new Set(refs)) {
      const bytes = await this.#store.get(ref)
      if (bytes) values.set(ref, new TextDecoder().decode(bytes))
    }
    return values
  }

  async set(ref: string, secret: string): Promise<void> {
    if (!this.#store || !this.#stronghold) throw new Error('原生凭据保险库尚未解锁')
    await this.#store.insert(ref, Array.from(new TextEncoder().encode(secret)))
    await this.#stronghold.save()
  }

  async remove(ref: string): Promise<void> {
    if (!this.#store || !this.#stronghold) throw new Error('原生凭据保险库尚未解锁')
    await this.#store.remove(ref)
    await this.#stronghold.save()
  }

  async lock(): Promise<void> {
    await this.#stronghold?.unload()
    this.#stronghold = undefined
    this.#store = undefined
  }
}
