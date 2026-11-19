/*
 * DeepSeek Chat 的 Service Worker（纯静态资源，构建时原样复制，无需打包）。
 * 策略：导航请求走网络优先（尽快拿到新版本页面），同源静态资源走缓存优先 + 后台更新；
 * 仅处理同源 GET，API 请求（跨源或流式）一律直连，不做任何缓存。
 */
const CACHE = 'deepseek-chat-static-v1'

self.addEventListener('install', (event) => {
  // 安装即激活；app shell 的预缓存在 activate 里做（需要拿到最新 index.html 引用的资源清单）
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) {
          await caches.delete(key)
        }
      }
      await self.clients.claim()
      await precacheShell()
    })()
  )
})

/**
 * 预缓存 app shell：以最新 index.html 引用到的同源静态资源为准提前入缓存。
 * 懒加载 chunk（设置弹窗、公式、图表、语言包）只有加载过才有缓存，
 * 没有这一步，离线打开时对应功能会失败。单个资源失败不阻塞其余缓存。
 */
async function precacheShell() {
  const cache = await caches.open(CACHE)
  let response
  try {
    response = await fetch('index.html', { cache: 'no-cache' })
  } catch {
    return
  }
  if (!response.ok) {
    return
  }
  const html = await response.text()
  const urls = new Set()
  for (const match of html.matchAll(/(?:src|href)="(static\/[^"]+)"/g)) {
    urls.add(match[1])
  }
  await Promise.all(
    [...urls].map((url) =>
      fetch(url)
        .then((res) => (res.ok ? cache.put(url, res) : undefined))
        .catch(() => undefined)
    )
  )
}

/** 缓存优先 + 后台更新；无缓存时直接走网络 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => undefined)
  return cached ?? (await refresh) ?? Response.error()
}

/** 网络优先：拿到新页面则回填缓存，离线或失败时回退缓存 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await cache.match(request)
    return cached ?? Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') {
    return
  }
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    return
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }
  event.respondWith(staleWhileRevalidate(request))
})
