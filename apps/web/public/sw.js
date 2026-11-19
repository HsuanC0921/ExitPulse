// 直通型 Service Worker：只為了能安裝成 App，不快取任何檔案，避免畫面停在舊版。
// 換版時（sw.js 內容一變）：清空所有快取，並叫已開啟的畫面重新載入，確保沒有人停在舊版。
let replacing = false;
self.addEventListener('install', () => {
  replacing = !!self.registration.active;
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.clients.claim();
    if (replacing) {
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url).catch(() => undefined);
    }
  })());
});
