const CACHE_NAME = 'drone-app-v1';

const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/api.js',
  './js/app.js',
  './js/firebase-config.js',
  './js/firebase-init.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const CDN_SHELL = [
  'https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore-compat.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all([
        ...APP_SHELL.map((url) => cache.add(url).catch(() => {})),
        ...CDN_SHELL.map((url) => cache.add(new Request(url, { mode: 'no-cors' })).catch(() => {})),
      ])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// アプリ本体(自ドメイン)とFirebase SDKだけをキャッシュ対象にする。
// Firestore/認証APIへの通信は素通しし、Firestore自身のオフライン機能に任せる。
function isCacheable(url) {
  if (url.origin === self.location.origin) return true;
  return CDN_SHELL.includes(url.href);
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!isCacheable(url)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
