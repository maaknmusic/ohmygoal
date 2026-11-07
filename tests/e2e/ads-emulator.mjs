// Ads (js/ads.js) in the real page against the emulators, with a fake AdSense script: the home ad for free users, the waiting-screen
// banner only while waiting, nothing for Premium members (not even the script), nothing in the local demo, no sideways scroll on a phone.
// Needs what premium.mjs needs (emulators, mockrzp, the firebase npm package in SP/fb, a static server on 8765).
import { createRequire } from 'module';
import fs from 'fs';
import crypto from 'crypto';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const FN = 'http://127.0.0.1:5001/demo-ohmygoal/asia-south1/';
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`)
  .replace(/ads: \{ client: '', slots: \{ home: '', waiting: '' \} \}/, "ads: { client: 'ca-pub-1234567890123456', slots: { home: '1111111111', waiting: '2222222222' } }");
if (!/ca-pub-1234567890123456/.test(cfg)) throw new Error('could not switch ads on in the test config');
const adScript = 'window.__adsScript = (window.__adsScript || 0) + 1; window.adsbygoogle = window.adsbygoogle || []; const p = window.adsbygoogle.push.bind(window.adsbygoogle); window.adsbygoogle.push = x => { window.__adsPushed = (window.__adsPushed || 0) + 1; return p(x); };';
const adRequests = {};
const fakeCheckout = `window.Razorpay = class { constructor(o) { this.o = o; } on() {} async open() {
  const r = await fetch('http://127.0.0.1:7777/test/pay', { method: 'POST', body: JSON.stringify({ order_id: this.o.order_id }) }).then(r => r.json());
  window.__checkoutOpts = { key: this.o.key, amount: this.o.amount, currency: this.o.currency, description: this.o.description };
  this.o.handler(r); } };`;
const run = Date.now();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const logs = [];
async function device(name) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(() => { try { localStorage.setItem('ac.safetyBrief', 'true'); } catch { /* storage off */ } });   // first-chat safety sheet: tests/e2e/safety-brief.mjs
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
  await ctx.route('https://checkout.razorpay.com/v1/checkout.js', r => r.fulfill({ body: fakeCheckout, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|fonts\.g|country\.is/, r => r.abort());
  await ctx.route(/pagead2\.googlesyndication\.com/, r => { adRequests[name] = (adRequests[name] || 0) + 1; return r.fulfill({ body: adScript, contentType: 'text/javascript' }); });
  await ctx.addInitScript(([n, run]) => {
    localStorage.setItem('ac.hideIp', 'false'); localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    window.__fakeIdToken = JSON.stringify({ sub: `g-${n}-${run}`, email: `${n.toLowerCase()}${run}@example.com`, email_verified: true });
  }, [name, run]);
  const real = fs.readFileSync('/home/user/ohmygoal/js/friends.js', 'utf8');
  await ctx.route('**/js/friends.js', r => r.fulfill({ body: real.replace('if (user?.isAnonymous) await linkWithPopup(user, provider);',
    'if (user?.isAnonymous) await this.authMod.linkWithCredential(user, GoogleAuthProvider.credential(window.__fakeIdToken));'), contentType: 'text/javascript' }));
  const p = await ctx.newPage();
  p.on('pageerror', e => logs.push(name + ' PAGEERR ' + e.message));
  p.on('console', m => { if (/permission|failed|error/i.test(m.text()) && !/Failed to load resource|nudity|face-api|signal listener/.test(m.text())) logs.push(name + ': ' + m.text().slice(0, 200)); });
  await p.goto('http://localhost:8765/index.html');
  await p.fill('#nickInput', name);
  await p.click('.seg[data-mode=text]'); await p.check('#ageCheck');
  await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 20000 });
  await p.waitForSelector('#premiumBtn:not(.hidden):not(.late)', { timeout: 10000 });
  return p;
}
const step = (n, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`);
// Direct SDK access inside a page (acts as an attacker with that page's user).
const sdk = (p, fn, arg) => p.evaluate(async ([src, arg]) => {
  const app = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const authM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  const f = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const a = app.getApp(); const auth = authM.getAuth(a); const db = f.getFirestore(a);
  const fns = fnM.getFunctions(a, 'asia-south1'); try { fnM.connectFunctionsEmulator(fns, '127.0.0.1', 5001); } catch {}
  const base = ['artifacts', 'anon-connect', 'public', 'data'];
  const call = async (name, data) => { try { return { ok: (await fnM.httpsCallable(fns, name)(data)).data }; } catch (e) { return { err: e.code }; } };
  const tryIt = async fn => { try { await fn(); return 'ALLOWED'; } catch (e) { return e.code; } };
  return await (eval(src))({ auth, db, f, base, call, tryIt, arg });
}, [fn.toString(), arg]);


const visible = (p, id) => p.evaluate(i => { const e = document.getElementById(i); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }, id);
const A = await device('Asha');

// ---- 1. a free user: the home ad shows under the start box, and the AdSense script loads once
await A.waitForFunction(() => !document.getElementById('adHome').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
const homeIns = await A.evaluate(() => { const i = document.querySelector('#adHome ins.adsbygoogle'); return i && { client: i.dataset.adClient, slot: i.dataset.adSlot, format: i.dataset.adFormat }; });
step('1a. a free user sees the home ad box with the Advertisement label', await visible(A, 'adHome') && /Advertisement/.test(await A.textContent('#adHome')));
step('1b. it asks AdSense for the home ad unit, and the script is loaded once', JSON.stringify(homeIns) === JSON.stringify({ client: 'ca-pub-1234567890123456', slot: '1111111111', format: 'auto' }) && adRequests.Asha === 1 && await A.evaluate(() => window.__adsPushed) === 1, JSON.stringify([homeIns, adRequests]));
step('1c. the waiting-screen ad is not shown on the welcome page', !(await visible(A, 'adWaiting')));

// ---- 2. waiting for a match: the small banner shows; once the chat starts it is gone
await A.click('#startBtn');
await A.waitForFunction(() => document.getElementById('chat').dataset.phase === 'searching', null, { timeout: 15000 }).catch(() => {});
await A.waitForTimeout(500);
const wIns = await A.evaluate(() => { const i = document.querySelector('#adWaiting ins.adsbygoogle'); return i && { slot: i.dataset.adSlot, w: i.style.width, h: i.style.height }; });
step('2a. while looking for someone to text, the 320x100 waiting banner shows at the top of the chat panel', await visible(A, 'adWaiting') && JSON.stringify(wIns) === JSON.stringify({ slot: '2222222222', w: '320px', h: '100px' }), JSON.stringify(wIns));
const B = await device('Bilal');
await B.click('#startBtn');
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 25000 }).then(() => true, () => false);
step('2b. two people still get matched', (await live(A)) && (await live(B)));
step('2c. during the chat there is no ad', !(await visible(A, 'adWaiting')) && !(await visible(B, 'adWaiting')));
step('2d. the script was still loaded only once per page', adRequests.Asha === 1, JSON.stringify(adRequests));

// ---- 3. a Premium member: no ad boxes and no AdSense script at all
const C = await device('Chen');
await C.click('#prefsBtn'); await C.selectOption('#genderFilter', 'female');
await C.evaluate(() => document.getElementById('prefsSheet').classList.add('hidden'));
await C.click('#paywallCta');
await C.waitForFunction(() => /Signed in as/.test(document.getElementById('toasts').textContent), null, { timeout: 15000 }).catch(() => {});
const cUid = await sdk(C, ({ auth }) => auth.currentUser.uid);
await fetch(`http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/artifacts/anon-connect/public/data/entitlements/${cUid}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { premiumUntil: { integerValue: String(Date.now() + 30 * 864e5) }, updatedAt: { integerValue: String(Date.now()) } } }) });
await C.waitForFunction(() => document.body.classList.contains('is-premium'), null, { timeout: 15000 }).catch(() => {});
step('3a. becoming Premium hides the ad straight away', await C.evaluate(() => document.body.classList.contains('is-premium')) && !(await visible(C, 'adHome')));
const before3 = adRequests.Chen || 0;
await C.reload(); await C.waitForTimeout(6000);
step('3b. a Premium member who opens the site sees no ads and the AdSense script is never loaded', await C.evaluate(() => document.body.classList.contains('is-premium')) && !(await visible(C, 'adHome')) && (adRequests.Chen || 0) === before3, JSON.stringify({ before3, now: adRequests.Chen }));
await C.click('#startBtn'); await C.waitForTimeout(1500);
step('3c. nor while waiting for a match', !(await visible(C, 'adWaiting')) && (adRequests.Chen || 0) === before3);

// ---- 3d. a voice chat: the banner sits on the stage, under the spinner
const V = await device('Vani');
await V.click('.seg[data-mode=voice]');
await V.click('#startBtn');
await V.waitForFunction(() => document.getElementById('chat').dataset.phase === 'searching', null, { timeout: 15000 }).catch(() => {});
await V.waitForTimeout(500);
const vb = await V.evaluate(() => { const a = document.getElementById('adWaiting').getBoundingClientRect(), s = document.getElementById('videoWrap').getBoundingClientRect(); return { onStage: a.top < s.bottom && a.bottom > s.top && a.left < s.right && a.right > s.left }; });
step('3d. while looking for someone to talk to (voice), the banner shows in the chat panel, not on the stage', await visible(V, 'adWaiting') && !vb.onStage, JSON.stringify(vb));
await V.click('#leaveBtn').catch(() => {});

// ---- 4. a phone: the home ad does not make the page scroll sideways
const P = await browser.newContext({ viewport: { width: 360, height: 740 }, serviceWorkers: 'block' });
await P.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
await P.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
await P.route(/jsdelivr|fonts\.g|country\.is/, r => r.abort());
await P.route(/pagead2\.googlesyndication\.com/, r => r.fulfill({ body: adScript + "document.querySelectorAll('ins.adsbygoogle').forEach(i => { i.style.height = '250px'; i.style.width = '100%'; });", contentType: 'text/javascript' }));
const ph = await P.newPage();
await ph.goto('http://localhost:8765/index.html');
await ph.waitForFunction(() => !document.getElementById('adHome').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
const sw = await ph.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
step('4. on a phone the home ad fits: no sideways scroll', await visible(ph, 'adHome') && sw.sw <= sw.iw, JSON.stringify(sw));

// ---- 5. the local demo (no Firebase): no ads
const D = await browser.newContext({ serviceWorkers: 'block' });
let demoAds = 0;
await D.route('**/config.js', r => r.fulfill({ body: cfg.replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,'), contentType: 'text/javascript' }));
await D.route(/jsdelivr|fonts\.g|country\.is/, r => r.abort());
await D.route(/pagead2\.googlesyndication\.com/, r => { demoAds++; return r.fulfill({ body: adScript, contentType: 'text/javascript' }); });
const dp = await D.newPage();
await dp.goto('http://localhost:8765/index.html'); await dp.waitForTimeout(4000);
step('5. the local demo shows no ads and loads no ad script', !(await visible(dp, 'adHome')) && demoAds === 0, String(demoAds));

console.log('LOGS:', logs.slice(0, 8));
await browser.close();
