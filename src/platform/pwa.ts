import { isNativeApp } from './runtime'

export function registerPwaServiceWorker(): void {
  if (isNativeApp() || !import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('MouseKeeper Service Worker registration failed', error)
    })
  })
}
