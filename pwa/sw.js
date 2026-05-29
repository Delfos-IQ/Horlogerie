/**
 * sw.js — Service Worker v2
 * Uses relative paths so it works on any host (GitHub Pages subdir or custom domain)
 */

const CACHE = 'horlogerie-v3';

// All paths relative to the SW scope
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/storage.js',
  './js/api.js',
  './js/app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=DM+Sans:wght@300;400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.filter(u => !u.startsWith('https://fonts') && !u.startsWith('https://cdn'))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go network for Worker API calls
  if (url.hostname.includes('workers.dev') || url.hostname.includes('groq.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Cache-first for app shell, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
