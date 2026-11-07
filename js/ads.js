// =====================================================================
// Ads (Google AdSense). Off until config.js `ads.client` is set (README "Ads").
// Two places only, never on top of a chat:
//   home     below the Start button on the welcome page
//   waiting  a small banner at the top of the chat panel while looking for someone and between chats (all modes). Not on the video
//            stage: there it would cover the call buttons and sit next to Stop, which invites accidental clicks.
// Premium members never see ads, and nothing is loaded until we know whether this person is Premium (so a Premium member never
// sees one flash up). The AdSense script is loaded once, after the page is ready, so it never slows down starting a chat.
// =====================================================================

const SCRIPT = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
export const AD_PLACES = Object.freeze(['home', 'waiting']);
const CLIENT = /^ca-pub-\d{10,20}$/;
const SLOT = /^\d{6,20}$/;

/** The ads settings from config.js, cleaned: { client, slots: { home, waiting } } or null when ads are off. */
export function adsConfig(cfg) {
    const client = String(cfg?.client || '').trim();
    if (!CLIENT.test(client)) return null;
    const slots = {};
    for (const p of AD_PLACES) { const s = String(cfg?.slots?.[p] || '').trim(); if (SLOT.test(s)) slots[p] = s; }
    return Object.keys(slots).length ? { client, slots } : null;
}

/** Whether an ad may be shown in `place` now. */
export function adAllowed({ config, place, premiumKnown, premium, live }) {
    return Boolean(config && live && premiumKnown && !premium && config.slots[place]);
}

/**
 * The ads controller. `boxes` maps a place to its container element (with a .ad-slot child). `live` is false in the local demo.
 * update({ premiumKnown, premium }) is called whenever the Premium state changes; show(place, on) when a screen opens or closes.
 */
export function createAds({ cfg, boxes, live, doc = document, win = window }) {
    const config = adsConfig(cfg);
    let premiumKnown = false, premium = false, loading = null, blocked = false;
    const filled = new Set();
    const wanted = Object.fromEntries(AD_PLACES.map(p => [p, p === 'home']));   // the home box shows whenever the welcome page does

    const load = () => (loading ||= new Promise((resolve, reject) => {
        const s = doc.createElement('script');
        s.async = true;
        s.crossOrigin = 'anonymous';
        s.src = `${SCRIPT}?client=${encodeURIComponent(config.client)}`;
        s.onload = resolve;
        s.onerror = reject;
        doc.head.appendChild(s);
    }));

    function fill(place) {
        if (filled.has(place)) return;
        const slot = boxes[place]?.querySelector('.ad-slot');
        if (!slot) return;
        filled.add(place);
        const ins = doc.createElement('ins');
        ins.className = 'adsbygoogle';
        ins.dataset.adClient = config.client;
        ins.dataset.adSlot = config.slots[place];
        if (place !== 'home') {
            // a small 320x100 banner, so it fits a phone without pushing the chat away
            Object.assign(ins.style, { display: 'inline-block', width: '320px', height: '100px' });
        } else {
            ins.style.display = 'block';
            ins.dataset.adFormat = 'auto';
            ins.dataset.fullWidthResponsive = 'true';
        }
        slot.appendChild(ins);
        load().then(() => { try { (win.adsbygoogle = win.adsbygoogle || []).push({}); } catch (e) { console.warn('ad', e); } })
            .catch(() => { blocked = true; render(); });   // blocked by an ad blocker or offline: just no ad, and no empty box
    }

    function render() {
        for (const place of AD_PLACES) {
            const box = boxes[place];
            if (!box) continue;
            const on = !blocked && wanted[place] && adAllowed({ config, place, premiumKnown, premium, live });
            box.classList.toggle('hidden', !on);
            if (on) fill(place);
        }
    }

    return {
        enabled: Boolean(config && live),
        update(state) { premiumKnown = state.premiumKnown !== false; premium = Boolean(state.premium); render(); },
        show(place, on) { if (place in wanted && wanted[place] !== Boolean(on)) { wanted[place] = Boolean(on); render(); } },
    };
}
