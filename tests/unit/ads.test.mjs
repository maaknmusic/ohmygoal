// js/ads.js: when ads are on, where they show, and that Premium members and the demo never load anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adsConfig, adAllowed, createAds, AD_PLACES } from '../../js/ads.js';

const GOOD = { client: 'ca-pub-1234567890123456', slots: { home: '1111111111', waiting: '2222222222' } };

// A tiny stand-in for the DOM: just what js/ads.js touches.
function fakeDom() {
    const el = tag => {
        const classes = new Set();
        const node = {
            tag, children: [], dataset: {}, style: {}, className: '',
            classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) },
            appendChild(c) { this.children.push(c); return c; },
            querySelector(sel) { return sel === '.ad-slot' ? this.children.find(c => c.className === 'ad-slot') || null : null; },
        };
        return node;
    };
    const scripts = [];
    const doc = { createElement: el, head: { appendChild: s => { scripts.push(s); return s; } } };
    const box = () => { const b = el('div'); b.classList.add('hidden'); const s = el('div'); s.className = 'ad-slot'; b.appendChild(s); return b; };
    return { doc, scripts, boxes: { home: box(), waiting: box() } };
}
const shown = b => !b.classList.contains('hidden');
const tick = () => new Promise(r => setTimeout(r, 0));

test('adsConfig: off unless a real publisher id and at least one ad unit id are set', () => {
    assert.equal(adsConfig(undefined), null);
    assert.equal(adsConfig({ client: '', slots: { home: '1111111111' } }), null);
    assert.equal(adsConfig({ client: 'pub-123', slots: { home: '1111111111' } }), null);
    assert.equal(adsConfig({ client: 'ca-pub-1234567890123456', slots: {} }), null);
    assert.equal(adsConfig({ client: 'ca-pub-1234567890123456"><script>', slots: { home: '1111111111' } }), null);
    assert.deepEqual(adsConfig({ client: ' ca-pub-1234567890123456 ', slots: { home: '1111111111', waiting: 'x"y', other: '3333333333' } }),
        { client: 'ca-pub-1234567890123456', slots: { home: '1111111111' } });
    assert.deepEqual(adsConfig(GOOD).slots, { home: '1111111111', waiting: '2222222222' });
    assert.deepEqual(AD_PLACES, ['home', 'waiting']);
});

test('adAllowed: only on the live site, once the Premium state is known, never for Premium, only where a unit is set', () => {
    const config = adsConfig(GOOD);
    const base = { config, place: 'home', premiumKnown: true, premium: false, live: true };
    assert.equal(adAllowed(base), true);
    assert.equal(adAllowed({ ...base, premium: true }), false);
    assert.equal(adAllowed({ ...base, premiumKnown: false }), false);
    assert.equal(adAllowed({ ...base, live: false }), false);
    assert.equal(adAllowed({ ...base, config: null }), false);
    assert.equal(adAllowed({ ...base, config: adsConfig({ ...GOOD, slots: { home: '1111111111' } }), place: 'waiting' }), false);
});

test('createAds: nothing loads before the Premium state is known; then the home ad shows and the script loads once', async () => {
    const { doc, scripts, boxes } = fakeDom();
    const win = {};
    const ads = createAds({ cfg: GOOD, boxes, live: true, doc, win });
    assert.equal(ads.enabled, true);
    ads.update({ premiumKnown: false, premium: false });
    assert.ok(!shown(boxes.home) && !shown(boxes.waiting) && scripts.length === 0, 'nothing before the Premium state is known');
    ads.update({ premiumKnown: true, premium: false });
    assert.ok(shown(boxes.home) && !shown(boxes.waiting));
    assert.equal(scripts.length, 1);
    assert.match(scripts[0].src, /^https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-1234567890123456$/);
    assert.equal(scripts[0].async, true);
    const ins = boxes.home.querySelector('.ad-slot').children[0];
    assert.equal(ins.className, 'adsbygoogle');
    assert.deepEqual([ins.dataset.adClient, ins.dataset.adSlot, ins.dataset.adFormat], ['ca-pub-1234567890123456', '1111111111', 'auto']);
    scripts[0].onload(); await tick();
    assert.equal(win.adsbygoogle.length, 1, 'the ad was requested');
    // the waiting screen: shown while waiting, a fixed small banner, filled once however often it opens
    ads.show('waiting', true);
    assert.ok(shown(boxes.waiting));
    ads.show('waiting', false); ads.show('waiting', true);
    const w = boxes.waiting.querySelector('.ad-slot').children;
    assert.equal(w.length, 1);
    assert.deepEqual([w[0].style.width, w[0].style.height, w[0].dataset.adSlot], ['320px', '100px', '2222222222']);
    assert.equal(scripts.length, 1, 'the script is loaded only once');
    ads.show('waiting', false);
    assert.ok(!shown(boxes.waiting));
});

test('createAds: Premium members see no ads and load nothing; becoming Premium hides them', () => {
    const a = fakeDom();
    const adsP = createAds({ cfg: GOOD, boxes: a.boxes, live: true, doc: a.doc, win: {} });
    adsP.update({ premiumKnown: true, premium: true });
    adsP.show('waiting', true);
    assert.ok(!shown(a.boxes.home) && !shown(a.boxes.waiting) && a.scripts.length === 0);

    const b = fakeDom();
    const ads = createAds({ cfg: GOOD, boxes: b.boxes, live: true, doc: b.doc, win: {} });
    ads.update({ premiumKnown: true, premium: false });
    assert.ok(shown(b.boxes.home));
    ads.update({ premiumKnown: true, premium: true });
    assert.ok(!shown(b.boxes.home));
});

test('createAds: off in the demo and without config; an ad blocker leaves no empty box', async () => {
    for (const [cfg, live] of [[GOOD, false], [{ client: '' }, true], [undefined, true]]) {
        const { doc, scripts, boxes } = fakeDom();
        const ads = createAds({ cfg, boxes, live, doc, win: {} });
        ads.update({ premiumKnown: true, premium: false }); ads.show('waiting', true);
        assert.ok(!ads.enabled && !shown(boxes.home) && !shown(boxes.waiting) && scripts.length === 0, JSON.stringify([cfg, live]));
    }
    const { doc, scripts, boxes } = fakeDom();
    const ads = createAds({ cfg: GOOD, boxes, live: true, doc, win: {} });
    ads.update({ premiumKnown: true, premium: false });
    scripts[0].onerror(new Error('blocked')); await tick();
    ads.show('waiting', true);
    assert.ok(!shown(boxes.home) && !shown(boxes.waiting));
});

test('the page, config, ads.txt and Privacy Policy are wired up', () => {
    const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
    const html = read('index.html');
    assert.match(html, /id="adHome"><span class="ad-label">Advertisement<\/span><div class="ad-slot"><\/div>/);
    assert.match(html, /id="adWaiting"><span class="ad-label">Advertisement<\/span><div class="ad-slot"><\/div>/);
    // the waiting banner is in the chat panel (above the messages), not on the video stage
    assert.ok(html.indexOf('id="adWaiting"') > html.indexOf('id="gameDock"') && html.indexOf('id="adWaiting"') < html.indexOf('id="messages"'));
    assert.match(read('config.js'), /ads: \{ client: '', slots: \{ home: '', waiting: '' \} \}/);
    assert.match(read('ads.txt'), /^# ads\.txt/m);
    assert.match(read('legal.html'), /<b>Ads:<\/b>[^<]*Google AdSense[\s\S]*Premium members see no ads/);
    const app = read('js/app.js');
    assert.match(app, /ads\.show\('waiting', phase === 'searching' \|\| phase === 'ended'\)/);
    for (const l of ['hi', 'bn', 'ta', 'es', 'ar', 'de']) assert.match(read(`js/i18n/${l}.js`), /"Advertisement": "/, l);
});
