// خدمة عاملة (PWA): الواجهة تُجلب من الشبكة أولًا (حتى تصل التحديثات فورًا)،
// والنسخة المخزّنة تُستخدم فقط عند انقطاع الاتصال. بيانات /api/ لا تُخزّن أبدًا.
const CACHE_NAME = 'alwan-alhayat-shell-v6';
const SHELL_FILES = ['/', '/index.html', '/styles.css', '/calc.js', '/qr.js', '/charts.js', '/js/core.js', '/js/clients.js', '/js/quotes.js', '/js/projects.js', '/js/stock.js', '/js/finance.js', '/js/admin.js', '/js/docs.js', '/logo.webp', '/manifest.json'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)); }
      return res;
    }).catch(() => caches.match(event.request, { ignoreSearch: true }).then((r) => r || caches.match('/index.html')))
  );
});
