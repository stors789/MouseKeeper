import { isTauri } from '@tauri-apps/api/core'

/** True only inside a Tauri IPC-enabled webview, never merely by user agent. */
export function isNativeApp(): boolean {
  return isTauri()
}

export type RuntimeKind = 'web' | 'tauri'

export function runtimeKind(): RuntimeKind {
  return isNativeApp() ? 'tauri' : 'web'
}
