// kep•ler 3D: сеть всегда новее кэша, а полный список приложения остаётся
// офлайн-резервом. pwa-assets.js меняется на каждом деплое GitHub Pages.

self.importScripts('./pwa-assets.js');

const build = self.KEPLER_PWA || { version: 'source', assets: ['./', './index.html', './app.js', './styles.css'] };
const CACHE_PREFIX = 'kepler-pwa-';
const CACHE = `${CACHE_PREFIX}${String(build.version).replace(/[^a-z0-9._-]/gi, '-').slice(0, 80)}`;

async function cacheResponse(request, response) {
  if (!response?.ok || response.type !== 'basic' || response.status === 206) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

async function fetchAndCache(request) {
  // Не используем HTTP-кэш GitHub Pages: при наличии сети берём именно
  // последнюю опубликованную версию, затем обновляем собственный офлайн-кэш.
  const response = await fetch(request, { cache: 'no-store' });
  await cacheResponse(request, response);
  return response;
}

async function networkFirst(request) {
  try {
    return await fetchAndCache(request);
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.match('./index.html') || await caches.match('./');
      if (shell) return shell;
    }
    throw error;
  }
}

async function cacheBuild() {
  const cache = await caches.open(CACHE);
  const assets = [...new Set(build.assets || [])];
  // Небольшие пачки не перегружают телефон сотнями одновременных запросов.
  // Ошибка любого обязательного файла прерывает установку: рабочий старый
  // кэш нельзя заменять неполной офлайн-копией новой версии.
  for (let at = 0; at < assets.length; at += 16) {
    const batch = assets.slice(at, at + 16);
    await Promise.all(batch.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
  }
}

self.addEventListener('install', (event) => {
  // При первом запуске worker активируется сам. При обновлении он остаётся
  // waiting, пока приложение не будет свёрнуто или закрыто.
  event.waitUntil(cacheBuild());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil((async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Одна скрытая вкладка не должна обновлять другую, в которой сейчас
      // чертят. Другие сайты на том же github.io сюда не относятся.
      const appWindows = windows.filter((client) => client.url.startsWith(self.registration.scope));
      // Неизвестное состояние считаем активным — безопаснее подождать.
      if (appWindows.some((client) => client.visibilityState !== 'hidden')) return;
      await self.skipWaiting();
    })());
    return;
  }
  if (event.data?.type !== 'CACHE_URLS' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const scope = new URL(self.registration.scope);
    const urls = [...new Set(event.data.urls)].map((value) => {
      try { return new URL(value, scope); } catch { return null; }
    }).filter((url) => url && url.origin === scope.origin && url.href.startsWith(scope.href));
    await Promise.allSettled(urls.map((url) => fetchAndCache(new Request(url.href, { cache: 'reload' }))));
  })());
});
