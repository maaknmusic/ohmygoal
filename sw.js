// Service worker: makes the app installable and lets the shell open offline.
// Network-first, so users always get the latest version when online.
const CACHE = 'anon-connect-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'js/app.js', 'js/transport.js', 'js/geo.js', 'js/effects.js', 'js/safety.js', 'js/friends.js', 'js/premium.js',
    'legal.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const req = event.request;
    // Only same-origin GETs; Firebase, CDNs and media are never cached here.
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
    event.respondWith(
        fetch(req)
            .then(res => {
                if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
                return res;
            })
            .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
    );
});
