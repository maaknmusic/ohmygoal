// Service worker: makes the app installable and lets the shell open offline.
// Network-first, so users always get the latest version when online.
const CACHE = 'anon-connect-v17';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'js/app.js', 'js/transport.js', 'js/geo.js', 'js/effects.js', 'js/masks.js', 'js/mask-art.js', 'js/mask-kit.js', 'js/reactions.js', 'js/adaptive.js', 'js/rooms.js', 'js/i18n.js', 'js/appcheck.js', 'js/reveal.js', 'js/stickers.js', 'js/groups.js', 'js/groupui.js', 'js/push.js', 'js/i18n/hi.js', 'js/progress.js', 'js/failures.js', 'js/backgrounds.js', 'js/matte.js', 'js/matte-gl.js', 'js/safety.js', 'js/friends.js', 'js/premium.js',
    'js/cloud.js', 'js/access.js', 'js/fingerprint.js', 'js/ui.js', 'js/audio-meter.js', 'js/location.js', 'js/identity.js', 'js/icebreakers.js', 'js/shield.js', 'js/landing.js', 'js/languages.js', 'js/profile.js', 'js/translate.js', 'js/livetranslate.js',
    'js/games/index.js', 'js/games/engine.js', 'js/games/ui.js', 'js/games/tictactoe.js', 'js/games/rps.js', 'js/games/connect4.js', 'js/games/handcricket.js', 'js/games/wordchain.js',
    'css/landing.css', 'css/chat.css', 'css/translate.css',
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

// ---- Friend notifications (see functions/push.js). The payload is data-only; we build the notification here. ----
self.addEventListener('push', event => {
    let d = {};
    try { const j = event.data ? event.data.json() : {}; d = j.data || j.notification || j || {}; } catch { /* not JSON: show a generic one */ }
    const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max) : '');
    const title = text(d.title, 80) || 'OhMyGoal';
    event.waitUntil(self.registration.showNotification(title, {
        body: text(d.body, 140),
        tag: text(d.tag, 40) || 'friend',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        data: { url: './' },
        renotify: true,
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    // Only ever open this site, whatever the payload says.
    const target = new URL('./', self.registration.scope);
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        const open = list.find(c => new URL(c.url).origin === target.origin);
        return open ? open.focus() : self.clients.openWindow(target.href);
    }));
});
