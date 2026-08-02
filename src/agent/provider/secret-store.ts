import type { SecretMetadata, SecretStoragePolicy } from './types'
import { isNativeApp } from '../../platform/runtime'
import { StrongholdSecretBackend, type PlatformSecretBackend } from '../../platform/stronghold-secrets'

const SESSION_PREFIX = 'mousekeeper:llm-secret:session:'
const LOCAL_PREFIX = 'mousekeeper:llm-secret:local:'

function masked(secret: string): string {
  const suffix = secret.slice(-4)
  return `••••${suffix}`
}

export class SecretStore {
  readonly #memory = new Map<string, string>()
  readonly #policies = new Map<string, SecretStoragePolicy>()
  #platformUnlocked = false

  constructor(
    private readonly session: Storage | undefined = globalThis.window?.sessionStorage,
    private readonly local: Storage | undefined = globalThis.window?.localStorage,
    private readonly native = isNativeApp(),
    private readonly platform: PlatformSecretBackend | undefined = native ? new StrongholdSecretBackend() : undefined
  ) {}

  get platformUnlocked(): boolean {
    return this.#platformUnlocked
  }

  set(ref: string, secret: string, policy: SecretStoragePolicy): SecretMetadata {
    if (!ref.trim()) throw new Error('secretRef 不能为空')
    if (!secret) throw new Error('API Key 不能为空')
    if (policy === 'platform') throw new Error('平台安全存储必须先解锁并异步保存')
    if (this.native && (policy === 'local' || policy === 'session')) {
      throw new Error('原生 App 禁止把 API Key 写入 Web Storage；请选择仅内存或平台加密保险库')
    }
    if (this.#policies.get(ref) === 'platform') {
      throw new Error('请先从平台加密保险库清除原凭据，再改为仅内存保存')
    }
    this.clear(ref)
    this.#policies.set(ref, policy)
    if (policy === 'local') this.local?.setItem(`${LOCAL_PREFIX}${ref}`, secret)
    else if (policy === 'session') this.session?.setItem(`${SESSION_PREFIX}${ref}`, secret)
    else this.#memory.set(ref, secret)
    return this.metadata(ref)
  }

  async unlockPlatform(password: string, refs: readonly string[]): Promise<void> {
    if (!this.native || !this.platform?.supported) throw new Error('当前运行环境不支持平台加密保险库')
    const values = await this.platform.unlock(password, refs)
    for (const [ref, secret] of values) {
      this.#memory.set(ref, secret)
      this.#policies.set(ref, 'platform')
    }
    this.#platformUnlocked = true
  }

  async setPlatform(ref: string, secret: string): Promise<SecretMetadata> {
    if (!ref.trim()) throw new Error('secretRef 不能为空')
    if (!secret) throw new Error('API Key 不能为空')
    if (!this.native || !this.platform?.supported) throw new Error('当前运行环境不支持平台加密保险库')
    if (!this.#platformUnlocked) throw new Error('请先解锁原生凭据保险库')
    await this.platform.set(ref, secret)
    this.session?.removeItem(`${SESSION_PREFIX}${ref}`)
    this.local?.removeItem(`${LOCAL_PREFIX}${ref}`)
    this.#memory.set(ref, secret)
    this.#policies.set(ref, 'platform')
    return this.metadata(ref)
  }

  async clearPlatform(ref: string): Promise<void> {
    if (!this.native || !this.platform?.supported || !this.#platformUnlocked) {
      throw new Error('请先解锁原生凭据保险库')
    }
    await this.platform.remove(ref)
    this.#memory.delete(ref)
    this.#policies.delete(ref)
  }

  async lockPlatform(): Promise<void> {
    const platformRefs = [...this.#policies.entries()]
      .filter(([, policy]) => policy === 'platform')
      .map(([ref]) => ref)
    await this.platform?.lock()
    for (const ref of platformRefs) {
      this.#memory.delete(ref)
      this.#policies.delete(ref)
    }
    this.#platformUnlocked = false
  }

  resolve(ref: string): string | undefined {
    return (
      this.#memory.get(ref) ??
      this.session?.getItem(`${SESSION_PREFIX}${ref}`) ??
      this.local?.getItem(`${LOCAL_PREFIX}${ref}`) ??
      undefined
    )
  }

  clear(ref: string): void {
    if (this.#policies.get(ref) === 'platform') {
      throw new Error('平台凭据必须通过已解锁的加密保险库清除')
    }
    this.#memory.delete(ref)
    this.session?.removeItem(`${SESSION_PREFIX}${ref}`)
    this.local?.removeItem(`${LOCAL_PREFIX}${ref}`)
    this.#policies.delete(ref)
  }

  metadata(ref: string): SecretMetadata {
    const secret = this.resolve(ref)
    const policy = this.#policies.get(ref) ??
      (this.local?.getItem(`${LOCAL_PREFIX}${ref}`) ? 'local' :
        this.session?.getItem(`${SESSION_PREFIX}${ref}`) ? 'session' : 'prompt')
    return {
      configured: Boolean(secret),
      masked: secret ? masked(secret) : undefined,
      policy,
      updatedAt: secret ? new Date().toISOString() : undefined,
      platformSupported: this.native && Boolean(this.platform?.supported)
    }
  }
}

export const secretStore = new SecretStore()
