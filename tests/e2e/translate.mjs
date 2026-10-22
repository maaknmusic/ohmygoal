// Live translate and the language profile against the Firebase emulators: the real translateText Cloud Function (talking to the mock Vertex AI
// in tests/e2e/mockrzp.mjs), the real `profiles` rules, real matching, a Google account (fake token, like premium.mjs) with a Premium pass.
//
// Needs the same setup as premium.mjs and translate-server.mjs (see tests/README.md):
//   - emulators: auth 9099, firestore 8080, functions 5001, started with the CURRENT functions/ and firestore.rules
//   - functions/.env.local in the emulator's copy of functions/ with   TRANSLATE_API=http://127.0.0.1:7777   (the function then talks to the mock)
//   - the CURRENT mock: node tests/e2e/mockrzp.mjs   (:7777; it answers Vertex AI generateContent as '[<target>] <message>', and fails on a message starting with FAIL)
//   - a static server on 8765 and the web SDK in <scratch>/fb  (npm i firebase@11.6.1)
// Run:  NO_PROXY=localhost,127.0.0.1 NODE_PATH=/opt/node22/lib/node_modules node tests/e2e/translate.mjs <scratch dir>
//
// Premium is written as a fixture through the emulator's admin REST API (as translate-server.mjs does); everything this test writes that way is
// deleted again at the end. Two people chat: A (Google account, Premium, English) and B (Google account, no Premium, Hindi). The browser has no built-in
// Translator here, so every translation goes through the server, which is what is under test.
import { createRequire } from 'module';
import fs from 'fs';
import crypto from 'crypto';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const APP = 'anon-connect';
const FS_REST = 'http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents';
const MOCK = 'http://127.0.0.1:7777';
const MAIN_IP = '192.0.2.233'; // this suite's own "network" for checkAccess (the emulator sees no client IP)
const RUN = crypto.randomBytes(4).toString('hex');
const mark = `zq${RUN}`;
let seq = 0;
const hi = () => `नमस्ते ${mark} ${++seq}`;           // Devanagari: the mock reports source 'hi'
const en = (label = 'Hello friend') => `${label} ${mark} ${++seq}`;

const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`);
// Test-only hooks go into a copy of app.js here; nothing like them ships.
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8') + '\nwindow.__t = { S, sendData, lt, translateEngine };\n';
const friendsSrc = fs.readFileSync('/home/user/ohmygoal/js/friends.js', 'utf8');
const friendsPatched = friendsSrc.replace('if (user?.isAnonymous) await linkWithPopup(user, provider);',
  'if (user?.isAnonymous) await this.authMod.linkWithCredential(user, GoogleAuthProvider.credential(window.__fakeIdToken));');
if (friendsPatched === friendsSrc) throw new Error('friends.js patch failed');

let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
const J = x => JSON.stringify(x);

// ---------------------------------------------------------------- admin REST (bypasses the rules, like the Admin SDK)
const pubPath = p => `artifacts/${APP}/public/data/${p}`;
const prvPath = p => `artifacts/${APP}/private/data/${p}`;
const enc = v => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const dec = v => 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec)
  : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)])) : null;
const decFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));
const adminHeaders = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const adminSet = async (p, obj) => {
  const r = await fetch(`${FS_REST}/${p}`, { method: 'PATCH', headers: adminHeaders, body: J({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, enc(v)])) }) });
  if (!r.ok) throw new Error(`admin set ${p}: ${r.status} ${await r.text()}`);
};
const adminGet = async p => {
  const r = await fetch(`${FS_REST}/${p}`, { headers: adminHeaders });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`admin get ${p}: ${r.status}`);
  return decFields((await r.json()).fields);
};
const adminDel = p => fetch(`${FS_REST}/${p}`, { method: 'DELETE', headers: adminHeaders }).catch(() => {});
const vcount = async () => (await (await fetch(MOCK + '/test/vertex-count')).json()).calls;
const until = async (fn, ms = 8000, every = 150) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise(r => setTimeout(r, every)); } };

// ---------------------------------------------------------------- fail fast when the environment is not there
for (const [name, url] of [['auth', 'http://127.0.0.1:9099/'], ['firestore', 'http://127.0.0.1:8080/'], ['functions', 'http://127.0.0.1:5001/'], ['mock (Razorpay / Vertex)', MOCK + '/test/cf-count']]) {
  await fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => { console.log(`FAIL the ${name} emulator / mock is not reachable at ${url}`); process.exit(2); });
}
const probe = await fetch(MOCK + '/test/vertex-count').then(r => r.json()).catch(() => null);
if (typeof probe?.calls !== 'number') { console.log('FAIL the mock on :7777 has no Vertex route: restart it with the current tests/e2e/mockrzp.mjs'); process.exit(2); }

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const logs = [];
const created = [];  // documents written as fixtures: removed at the end
const toastLog = []; // every toast text, in order

/** One browser "device". token = the fake Google identity this device can sign in with. */
async function device(name, { lang = '', token = null, viewport = { width: 1280, height: 800 } } = {}) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport });
  const calls = [];
  await ctx.route('http://127.0.0.1:5001/**', r => { calls.push(r.request().url()); return r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': MAIN_IP } }); });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route('**/js/friends.js', r => r.fulfill({ body: friendsPatched, contentType: 'text/javascript' }));
  await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|fonts\.g|country\.is|razorpay/, r => r.abort());
  await ctx.addInitScript(([n, tok, l]) => {
    localStorage.setItem('ac.hideIp', 'false'); localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5)); localStorage.setItem('ac.mode', JSON.stringify('text'));
    if (l) localStorage.setItem('ac.lang', JSON.stringify(l));
    window.__fakeIdToken = tok || JSON.stringify({ sub: 'tr-' + n + '-' + Date.now() + Math.random(), email: n.toLowerCase() + Date.now() + '@example.com', email_verified: true });
  }, [name, token, lang]);
  const p = await ctx.newPage();
  p.calls = calls;
  p.on('pageerror', e => logs.push(name + ' PAGEERR ' + e.message));
  p.on('console', m => { if (/permission|failed|error/i.test(m.text()) && !/Failed to load resource|nudity model|face-api|signal listener/.test(m.text())) logs.push(name + ': ' + m.text().slice(0, 220)); });
  await p.goto('http://localhost:8765/index.html');
  await p.fill('#nickInput', name);
  await p.check('#ageCheck');
  await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 20000 });
  // keep every toast text (they disappear after 4 s)
  await p.evaluate(() => { window.__toasts = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => window.__toasts.push(n.textContent)))).observe(document.getElementById('toasts'), { childList: true }); });
  p.ctx = ctx;
  return p;
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 25000 }).then(() => true, () => false);
const text = (p, sel) => p.textContent(sel).then(t => t || '');
const toasts = p => p.evaluate(() => window.__toasts);
const uidOf = p => p.evaluate(async () => {
  const app = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const auth = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  return auth.getAuth(app.getApp()).currentUser?.uid || null;
});
const say = async (p, msg) => { await p.fill('#msgInput', msg); await p.press('#msgInput', 'Enter'); };
const raw = (p, fr) => p.evaluate(list => { const dc = window.__t.S.session.dc; for (const f of list) dc.send(typeof f === 'string' ? f : JSON.stringify(f)); }, fr);
const setLang = async (p, code) => { await p.click('#prefsBtn'); await p.selectOption('#langSelect', code); await p.keyboard.press('Escape'); await p.waitForSelector('#prefsSheet', { state: 'hidden' }); };
const profileOf = async uid => adminGet(pubPath(`profiles/${uid}`));
/** Text of `sub` (a selector inside the message, or '' for the message itself) in the newest message of one side. */
const lastText = (p, who, sub = '') => p.evaluate(([w, q]) => { const m = [...document.querySelectorAll(`#messages .msg.${w}`)].at(-1); const n = m && (q ? m.querySelector(q) : m); return n ? n.textContent : ''; }, [who, sub]);
const countOf = (p, who) => p.evaluate(w => document.querySelectorAll(`#messages .msg.${w}`).length, who);

const TOKEN_A = J({ sub: `tr-asha-${RUN}`, email: `asha${RUN}@example.com`, email_verified: true });
const A = await device('Asha', { lang: 'en', token: TOKEN_A });
const B = await device('Bilal', { lang: 'hi' });   // a Google account too, but without Premium
let uidA = null, uidB = null;

try {
  // ============================================================ 1. the profile: anonymous people never write one, Google accounts do
  uidA = await uidOf(A); uidB = await uidOf(B);
  await new Promise(r => setTimeout(r, 2500));
  step('1a. an anonymous person with a language chosen has no profile document', (await profileOf(uidA)) === null && (await profileOf(uidB)) === null);
  await A.click('#premiumBtn'); await A.click('#paywallCta');
  await A.waitForFunction(() => /Signed in as/.test(document.getElementById('toasts').textContent), null, { timeout: 15000 });
  await A.click('#paywallClose');
  const doc = await until(() => profileOf(uidA), 8000);
  created.push(pubPath(`profiles/${uidA}`));
  step('1b. after the Google sign-in the profile is created from the values on the device', !!doc && doc.lang === 'en' && doc.nick === (await A.evaluate(() => window.__t.S.nick)) && Array.isArray(doc.interests) && typeof doc.updatedAt === 'number', J(doc));
  step('1c. it holds exactly the agreed fields', !!doc && Object.keys(doc).every(k => ['lang', 'nick', 'avatar', 'interests', 'gender', 'updatedAt'].includes(k)) && Number.isInteger(doc.avatar?.h) && typeof doc.avatar?.e === 'string', Object.keys(doc || {}).join(','));
  await setLang(A, 'es');
  const changed = await until(async () => (await profileOf(uidA))?.lang === 'es', 8000);
  step('1d. a later edit is saved to the account (after a short pause)', changed);
  await setLang(A, 'en');
  step('1e. and the next one too', await until(async () => (await profileOf(uidA))?.lang === 'en', 8000));
  await A.click('#prefsBtn');
  await A.fill('#tagInput', 'chess'); await A.press('#tagInput', 'Enter');
  await A.keyboard.press('Escape');
  step('1f. interests follow', await until(async () => (await profileOf(uidA))?.interests?.includes('chess'), 8000));
  step('1g. B (still anonymous) has no profile yet', (await profileOf(uidB)) === null);
  await B.click('#premiumBtn'); await B.click('#paywallCta');
  await B.waitForFunction(() => /Signed in as/.test(document.getElementById('toasts').textContent), null, { timeout: 15000 });
  await B.click('#paywallClose');
  const docB = await until(() => profileOf(uidB), 8000);
  created.push(pubPath(`profiles/${uidB}`));
  step('1g2. B\'s Google sign-in creates B\'s profile with Hindi', !!docB && docB.lang === 'hi', J(docB));

  // a second device with the same Google account gets the account's values
  const A2 = await device('Asha2', { token: TOKEN_A });
  await A2.evaluate(async () => {
    const app = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
    const auth = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
    await auth.signInWithCredential(auth.getAuth(app.getApp()), auth.GoogleAuthProvider.credential(window.__fakeIdToken));
  });
  const got = await until(() => A2.evaluate(() => window.__t.S.lang === 'en' && window.__t.S.interests.includes('chess')), 10000);
  step('1h. signing in on another device loads language, nickname and interests from the account', got && (await A2.evaluate(() => window.__t.S.nick)) === (await profileOf(uidA)).nick && (await A2.inputValue('#nickInput')) === (await profileOf(uidA)).nick && (await A2.evaluate(() => localStorage.getItem('ac.lang'))) === '"en"', await A2.evaluate(() => JSON.stringify({ lang: window.__t.S.lang, nick: window.__t.S.nick, tags: window.__t.S.interests })));
  step('1i. that device left the document as it was (nothing overwritten)', (await profileOf(uidA)).lang === 'en');
  await A2.ctx.close();

  // ============================================================ 2. Premium: the pass is a fixture; the UI follows the entitlement document
  await adminSet(pubPath(`entitlements/${uidA}`), { premiumUntil: Date.now() + 24 * 3600 * 1000, updatedAt: Date.now() });
  created.push(pubPath(`entitlements/${uidA}`));
  await A.waitForFunction(() => document.body.classList.contains('is-premium'), null, { timeout: 15000 });
  step('2a. A is Premium', true);

  // ============================================================ 3. a chat across languages through the real function
  await A.click('#startBtn'); await B.click('#startBtn');
  step('3a. A and B match', (await live(A)) && (await live(B)));
  await A.waitForSelector('#trBar .tr-bar-go', { timeout: 8000 });
  step('3b. the match card says "Speaks हिन्दी" and A is offered Live translate', (await text(A, '.match-card .speaks')) === 'Speaks हिन्दी' && /Hindi speaker/.test(await text(A, '#trBar')), await text(A, '#trBar'));
  // B is a free Google user: Live translate is not offered, the button leads to the Premium sheet, and the server refuses on its own
  const bEngine = await B.evaluate(() => window.__t.translateEngine.translate({ text: 'hello there', target: 'hi' }).then(() => 'translated', e => e.kind));
  await B.click('#translateBtn');
  await B.waitForSelector('#paywall:not(.hidden)', { timeout: 3000 }).catch(() => {});
  step('3b2. a free Google user: no suggestion bar, the button opens the Premium sheet, and the function itself says it is a Premium feature', !(await B.isVisible('#trBar')) && (await B.isVisible('#paywall')) && /Live translate/.test(await text(B, '#paywallReason')) && bEngine === 'premium', `${bEngine}`);
  await B.keyboard.press('Escape');
  // off: nothing goes to the server
  const v0 = await vcount();
  const t0 = A.calls.filter(u => /translateText/.test(u)).length;
  await B.fill('#msgInput', hi()); await B.press('#msgInput', 'Enter');
  await A.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 1);
  await A.waitForTimeout(800);
  step('3c. with Live translate off no request for translation leaves A, and the message is shown as sent', (await vcount()) === v0 && A.calls.filter(u => /translateText/.test(u)).length === t0 && (await A.locator('.translated').count()) === 0);
  // warm the function (a cold start can take longer than the browser's 10 s limit) with a text of our own
  await A.evaluate(text => window.__t.translateEngine.translate({ text, target: 'hi' }).catch(() => null), en('warm up'));
  await A.click('#trBar .tr-bar-go');
  step('3d. one tap turns on both directions', /English ⇄ Hindi/.test(await text(A, '#trBar')), await text(A, '#trBar'));
  // receive
  const v1 = await vcount();
  const incoming = hi();
  await B.fill('#msgInput', incoming); await B.press('#msgInput', 'Enter');
  await A.waitForSelector('#messages .msg.them .tr-link', { timeout: 15000 });
  const bubble = await lastText(A, 'them', '.bubble');
  step('3e. a message in Hindi reads in English (the server answered), with the Hindi → English line', bubble === `[en] ${incoming}` && /Hindi → English/.test(await lastText(A, 'them', '.translated')), bubble);
  step('3f. exactly one provider call was made for it', (await vcount()) === v1 + 1, `${(await vcount()) - v1}`);
  await B.fill('#msgInput', incoming); await B.press('#msgInput', 'Enter'); // the same text again
  await A.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 3);
  await A.waitForTimeout(600);
  step('3g. the same text again is not translated again (client cache)', (await vcount()) === v1 + 1);
  // send
  const outgoing = en();
  await say(A, outgoing);
  await B.waitForSelector('#messages .msg.them .tr-body', { timeout: 15000 });
  const bBubble = await lastText(B, 'them', '.bubble');
  step('3h. B receives the translation, with A\'s original underneath', bBubble === `[hi] ${outgoing}` && (await lastText(B, 'them', '.tr-body')).includes(outgoing) && /Original · English/.test(await lastText(B, 'them', '.translated')), bBubble);
  step('3i. A\'s own message shows what A typed plus "Sent as Hindi"', (await lastText(A, 'me', '.bubble')) === outgoing && /Sent as Hindi/.test(await lastText(A, 'me', '.translated')));
  await A.screenshot({ path: SP + '/translate-chat-a.png' });
  await B.screenshot({ path: SP + '/translate-chat-b.png' });

  // ============================================================ 4. failures
  await B.fill('#msgInput', 'FAIL ' + hi()); await B.press('#msgInput', 'Enter');
  await A.waitForSelector('#messages .translated.failed', { timeout: 15000 });
  step('4a. a provider failure: the message stays readable and says it was not translated, with Retry', /Not translated: Translation is unavailable right now\./.test(await text(A, '#messages .translated.failed')) && (await A.locator('#messages .translated.failed .tr-link').count()) === 1, await text(A, '#messages .translated.failed'));
  await say(A, 'FAIL ' + en());
  await B.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 2, null, { timeout: 15000 });
  const lastFrameText = await lastText(B, 'them', '.bubble');
  step('4b. when sending fails the original goes out unchanged, and A\'s bubble says so', lastFrameText.startsWith('FAIL ') && (await lastText(B, 'them', '.translated')) === '' && /not translated/i.test(await lastText(A, 'me', '.translated')), lastFrameText);

  // ============================================================ 5. fair-use limits reach the person once, and the server is left alone
  await adminSet(prvPath(`translateLimits/${uidA}`), { times: Array.from({ length: 30 }, (_, i) => Date.now() - 2000 - i * 100) });
  created.push(prvPath(`translateLimits/${uidA}`));
  const v2 = await vcount();
  await A.evaluate(() => { window.__toasts.length = 0; });
  await B.fill('#msgInput', hi()); await B.press('#msgInput', 'Enter');
  await A.waitForFunction(() => /Too many translations/.test([...document.querySelectorAll('#messages .msg.them')].at(-1)?.querySelector('.translated')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  step('5a. the per-minute limit: the line says "Too many translations. Try again in a moment." and a toast tells the person', /Too many translations\. Try again in a moment\./.test(await lastText(A, 'them', '.translated')) && (await toasts(A)).some(t => /Too many translations/.test(t)), J(await toasts(A)));
  await B.fill('#msgInput', hi()); await B.press('#msgInput', 'Enter');
  await A.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 6);
  await A.waitForTimeout(500);
  step('5b. a second message while limited: no second toast and no call to the provider', (await toasts(A)).filter(t => /Too many translations/.test(t)).length === 1 && (await vcount()) === v2, J(await toasts(A)));

  // ============================================================ 6. Premium ends in the middle of the chat
  await adminSet(pubPath(`entitlements/${uidA}`), { premiumUntil: Date.now() - 1000, updatedAt: Date.now() });
  await A.waitForFunction(() => !document.body.classList.contains('is-premium'), null, { timeout: 15000 });
  await A.waitForTimeout(300);
  step('6a. Live translate turns itself off: bar gone, button not lit, a toast says why', !(await A.isVisible('#trBar')) && !(await A.evaluate(() => document.getElementById('translateBtn').classList.contains('on'))) && (await toasts(A)).some(t => /needs Premium/.test(t)), J(await toasts(A)));
  const v3 = await vcount();
  await B.waitForTimeout(4300); // the app allows 6 sent messages per 4 s: let B's earlier burst age out
  await B.fill('#msgInput', hi()); await B.press('#msgInput', 'Enter');
  await say(A, en());
  await A.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 7);
  await A.waitForTimeout(500);
  step('6b. afterwards nothing is translated, either way', (await vcount()) === v3 && (await lastText(A, 'them', '.translated')) === '');
  await A.click('#translateBtn');
  await A.waitForSelector('#paywall:not(.hidden)', { timeout: 3000 }).catch(() => {});
  step('6c. the button now leads to the Premium sheet', (await A.isVisible('#paywall')) && /Live translate/.test(await text(A, '#paywallReason')));
  await A.keyboard.press('Escape');

  // ============================================================ 7. the hostile partner cannot make the server work or leak
  await raw(B, [{ t: 'msg', text: 'hello', orig: 'x', olang: 'xx' }, { t: 'msg', text: 5 }, { t: 'msg', text: 'ok', orig: 'पहली', olang: 'hi' }]);
  await A.waitForTimeout(600);
  step('7. invalid frames from the partner never reach the provider (Premium is off here anyway) and break nothing', (await vcount()) === v3);
} catch (e) {
  step('the run did not finish: ' + (e?.message || e).toString().split('\n')[0], false);
  console.log(e?.stack?.split('\n').slice(0, 4).join('\n'));
} finally {
  for (const p of created) await adminDel(p);
  console.log(logs.length ? 'PAGE LOGS:\n' + [...new Set(logs)].slice(0, 12).join('\n') : 'no page errors');
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exit(failures ? 1 : 0);
}
