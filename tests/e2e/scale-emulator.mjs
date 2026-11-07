// Busy-site safeguards against the emulators: the random place in the matching queue (rules and a real match), the server-counted
// "people online" number (and the page falling back to counting itself), and the sharded daily chat counter.
// Needs what premium.mjs needs (emulators with functions/, the firebase npm package in SP/fb, a static server on 8765).
import { createRequire } from 'module';
import fs from 'fs';
import crypto from 'crypto';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const FN = 'http://127.0.0.1:5001/demo-ohmygoal/asia-south1/';
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`);
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
  await p.waitForSelector('#premiumBtn:not(.hidden)', { timeout: 10000 });
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

const FS = 'http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/';
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const base = 'artifacts/anon-connect';
const typed = v => (typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) });
const putDoc = (path, o) => fetch(FS + path, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typed(v)])) }) });
const num = v => Number(v?.integerValue ?? v?.doubleValue ?? 0);
const readDoc = async path => { const r = await fetch(FS + path, { headers: owner }); return r.ok ? (await r.json()).fields || {} : null; };
const shardSum = async (day, field) => {
  const r = await fetch(FS + `${base}/private/data/stats/${day}/shards?pageSize=100`, { headers: owner });
  return (r.ok ? (await r.json()).documents || [] : []).reduce((a, d) => a + num(d.fields?.[field]), 0);
};
const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const A = await device('Asha'), B = await device('Bilal');

// ---- 1. the queue rule: a random place in the queue is allowed, in the right format only
const entry = rk => ({ mode: 'text', interests: [], blocked: [], gender: 'x', country: '', genderFilter: 'any', countryFilter: 'any', premium: false, ts: Date.now(), roomId: null, ...(rk === undefined ? {} : { rk }) });
const rules = await sdk(A, async ({ db, f, base, auth, tryIt, arg }) => {
  const ref = f.doc(db, ...base, 'queue', auth.currentUser.uid);
  const out = {};
  for (const [k, rk] of Object.entries(arg)) { await f.deleteDoc(ref).catch(() => {}); out[k] = await tryIt(() => f.setDoc(ref, { mode: 'text', interests: [], blocked: [], gender: 'x', country: '', genderFilter: 'any', countryFilter: 'any', premium: false, ts: Date.now(), roomId: null, ...(rk === null ? {} : { rk }) })); }
  await f.deleteDoc(ref).catch(() => {});
  return out;
}, { good: 'text:0.123456', none: null, otherMode: 'video:0.123456', short: 'text:0.5', junk: 'text:0.123456;x', number: 0.5 });
step('1a. a queue entry with a random place in the right format is allowed (and one without, from older pages)', rules.good === 'ALLOWED' && rules.none === 'ALLOWED', JSON.stringify(rules));
step('1b. a random place for another mode, in the wrong format or not a string is refused', ['otherMode', 'short', 'junk', 'number'].every(k => rules[k] !== 'ALLOWED'), JSON.stringify(rules));

// ---- 2. a real match: the waiting person's entry has a random place, and two people meet
const chats0 = await shardSum(day, 'chats');
const main0 = num((await readDoc(`${base}/private/data/stats/${day}`))?.chats);
await A.click('#startBtn');
let qa = null;
for (let i = 0; i < 30 && !qa; i++) { qa = await sdk(A, async ({ db, f, base, auth }) => (await f.getDoc(f.doc(db, ...base, 'queue', auth.currentUser.uid))).data() || null); if (!qa) await new Promise(r => setTimeout(r, 300)); }
step('2a. a person waiting for a match has a random place in the queue', /^text:0\.\d{6}$/.test(qa?.rk || ''), JSON.stringify(qa));
await B.click('#startBtn');
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 25000 }).then(() => true, () => false);
step('2b. two people looking for a text chat are matched', (await live(A)) && (await live(B)));

// ---- 3. the chat counter goes to the shards, not the day document
let chats1 = chats0;
for (let i = 0; i < 30 && chats1 < chats0 + 1; i++) { await new Promise(r => setTimeout(r, 300)); chats1 = await shardSum(day, 'chats'); }
const main1 = num((await readDoc(`${base}/private/data/stats/${day}`))?.chats);
step('3. a new chat is counted in a shard of the day, and the day document is not written', chats1 >= chats0 + 1 && main1 === main0, JSON.stringify({ chats0, chats1, main0, main1 }));

// ---- 4. "people online": the page shows the server's count; pages cannot write it; an old count is ignored
const write = await sdk(A, ({ db, f, base, tryIt }) => tryIt(() => f.setDoc(f.doc(db, ...base, 'counters', 'online'), { count: 999999, at: Date.now() })));
step('4a. a page cannot write the online count', write !== 'ALLOWED', write);
await putDoc(`${base}/public/data/counters/online`, { count: 4242, at: Date.now() });
const C = await device('Chen');
await C.waitForFunction(() => document.getElementById('onlineChipCount').textContent.replace(/\D/g, '') === '4242', null, { timeout: 15000 }).catch(() => {});
step('4b. a fresh page shows the count the server saved', (await C.textContent('#onlineChipCount')).replace(/\D/g, '') === '4242', await C.textContent('#onlineChipCount'));
await putDoc(`${base}/public/data/counters/online`, { count: 4242, at: Date.now() - 10 * 60000 });
const D = await device('Dara');
await D.waitForTimeout(5000);
const shown = Number((await D.textContent('#onlineChipCount')).replace(/\D/g, ''));
step('4c. a count older than 6 minutes is ignored: the page counts the people online itself', shown >= 1 && shown !== 4242, String(shown));

// ---- 5. the once-a-minute count (functions/stats.js saveOnlineCount), run with the Admin SDK against the emulator
const { execFileSync } = await import('child_process');
let out5 = '';
try {
  out5 = execFileSync('node', ['-e', `import('./stats.js').then(async m => { const { publicDoc } = await import('./common.js'); const now = Date.now();
    const others = await publicDoc('presence/x').parent.get(); for (const d of others.docs) await d.ref.delete(); // only this check's users, so people leaving from earlier tests cannot change the number
    for (let i = 0; i < 3; i++) await publicDoc('presence/scale-' + now + '-' + i).set({ ts: now - i * 1000 });
    await publicDoc('presence/scale-old-' + now).set({ ts: now - 5 * 60000 });
    const r1 = await m.saveOnlineCount(now); const s = (await m.onlineRef().get()).data();
    const r2 = await m.saveOnlineCount(now + 30000); const s2 = (await m.onlineRef().get()).data();
    console.log(JSON.stringify({ n: r1.count, saved1: r1.saved, s, now, r2, s2 })); process.exit(0); })`], { cwd: SP + '/emu/functions', env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: 'demo-ohmygoal', APP_ID: 'anon-connect' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) { out5 = String(e.stdout || e.message); }
const r5 = (() => { try { return JSON.parse(out5.trim().split('\n').pop()); } catch { return null; } })();
step('5a. the server count includes everyone seen in the last 75 s (not older) and is saved for pages to read', r5 && r5.n >= 3 && r5.saved1 && r5.s?.count === r5.n && r5.s?.at === r5.now, out5.slice(0, 300));
step('5b. counting again half a minute later with the same number writes nothing', r5 && r5.r2?.saved === false && r5.r2?.count === r5.n && r5.s2?.at === r5.now, out5.slice(0, 300));

console.log('LOGS:', logs.slice(0, 8));
await browser.close();
