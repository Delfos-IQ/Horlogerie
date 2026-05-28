/**
 * sw.js — Service Worker
 * Caches the app shell for offline use.
 * Photos and watch data live in localStorage (no fetch needed).
 */

const CACHE = 'horlogerie-v2';
const SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/storage.js',
  '/js/api.js',
  '/js/app.js',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network-first for API calls, cache-first for app shell
  const url = new URL(e.request.url);

  if (url.pathname.startsWith('/identify') || url.pathname.startsWith('/details')) {
    // Always go to network for Worker calls
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
