// Moves visitors from the old Firebase addresses (*.web.app, *.firebaseapp.com) to our own domain, but only once that domain really
// answers with our site: it first loads a small image from it, so a domain that is not connected yet (or shows an error page) never
// gets anyone sent to it. The admin page is not included, so signing in there keeps working on both addresses.
// A plain script (not a module) that runs as soon as it loads; the pure part is also exported for the tests.
(function (root) {
    var NEW_HOST = 'ohmygoal.app';

    /** Where to send this location, or null to stay: only from the old Firebase hosts, never with ?noredirect=1. */
    function moveTarget(loc, newHost) {
        newHost = newHost || NEW_HOST;
        var host = String(loc.hostname || '').toLowerCase();
        if (!/\.(web\.app|firebaseapp\.com)$/.test(host)) return null;
        if (/[?&]noredirect=1(&|$)/.test(loc.search || '')) return null;
        return 'https://' + newHost + (loc.pathname || '/') + (loc.search || '') + (loc.hash || '');
    }

    function run() {
        var to = moveTarget(root.location);
        if (!to) return;
        var done = false;
        var go = function () { if (!done) { done = true; root.location.replace(to); } };
        try { if (root.sessionStorage.getItem('ac.newHostOk') === '1') return go(); } catch (e) { /* storage blocked */ }
        var probe = new root.Image();
        probe.onload = function () { try { root.sessionStorage.setItem('ac.newHostOk', '1'); } catch (e) { /* ignore */ } go(); };
        probe.src = 'https://' + NEW_HOST + '/icons/icon-192.png?probe=' + Date.now();   // loads only if the new address serves our site
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = { moveTarget: moveTarget, NEW_HOST: NEW_HOST };
    else run();
})(typeof window !== 'undefined' ? window : globalThis);
