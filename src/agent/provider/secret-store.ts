import type { SecretMetadata, SecretStoragePolicy } from './types'

const SESSION_PREFIX = 'mousekeeper:llm-secret:session:'
const LOCAL_PREFIX = 'mousekeeper:llm-secret:local:'

function masked(secret: string): string {
  const suffix = secret.slice(-4)
  return `••••${suffix}`
}

export class SecretStore {
  readonly #memory = new Map<string, string>()
  readonly #policies = new Map<string, SecretStoragePolicy>()

  constructor(
    private readonly session: Storage | undefined = globalThis.window?.sessionStorage,
    private readonly local: Storage | undefined = globalThis.window?.localStorage
  ) {}

  set(ref: string, secret: string, policy: SecretStoragePolicy): SecretMetadata {
    if (!ref.trim()) throw new Error('secretRef 不能为空')
    if (!secret) throw new Error('API Key 不能为空')
    if (policy === 'platform') throw new Error('当前 PWA 不支持平台安全存储')
    this.clear(ref)
    this.#policies.set(ref, policy)
    if (policy === 'local') this.local?.setItem(`${LOCAL_PREFIX}${ref}`, secret)
    else if (policy === 'session') this.session?.setItem(`${SESSION_PREFIX}${ref}`, secret)
    else this.#memory.set(ref, secret)
    return this.metadata(ref)
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
      platformSupported: false
    }
  }
}

export const secretStore = new SecretStore()
