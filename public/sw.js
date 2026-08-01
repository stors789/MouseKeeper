const CACHE_NAME = 'mousekeeper-shell-v4'
const APP_SHELL = [
  '/',
  '/index.html',
  '/asset-manifest.json',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/pwa-192x192.png',
  '/pwa-512x512.png'
]

function offlineResponse() {
  return new Response('MouseKeeper is offline and this resource is not cached.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}

function isCacheableStaticRequest(request) {
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false
  return (
    url.pathname.startsWith('/assets/') ||
    APP_SHELL.includes(url.pathname)
  )
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  await cache.addAll(APP_SHELL)

  const manifestResponse = await cache.match('/asset-manifest.json')
  if (!manifestResponse) {
    throw new Error('Unable to cache the production asset manifest')
  }
  const manifest = await manifestResponse.json()
  if (!Array.isArray(manifest.assets)) {
    throw new Error('Production asset manifest is invalid')
  }
  await cache.addAll(manifest.assets)

  const indexResponse = await fetch('/index.html', { cache: 'no-store' })
  if (!indexResponse.ok) {
    throw new Error(`Unable to cache app shell: ${indexResponse.status}`)
  }
  const html = await indexResponse.clone().text()
  await cache.put('/index.html', indexResponse)
  const builtAssets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
        (match) => match[1]
      )
    )
  ]
  if (builtAssets.length > 0) {
    await cache.addAll(builtAssets)
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('mousekeeper-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(async () => (await caches.match('/index.html')) ?? offlineResponse())
    )
    return
  }

  if (!isCacheableStaticRequest(event.request)) return

  event.respondWith(
    caches
      .match(event.request)
      .then((cached) => {
        const network = fetch(event.request)
          .then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone()
              void caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(event.request, copy))
            }
            return response
          })
          .catch(() => cached ?? offlineResponse())

        return cached ?? network
      })
  )
})
