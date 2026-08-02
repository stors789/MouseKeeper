import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { isNativeApp } from './runtime'

export type PlatformFetch = typeof fetch

/** Native HTTP avoids WebView CORS while the PWA keeps browser fetch semantics. */
export const platformFetch: PlatformFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (isNativeApp()) return tauriFetch(input, init)
  return globalThis.fetch(input, init)
}
