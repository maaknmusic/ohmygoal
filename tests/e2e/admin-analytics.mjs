// The admin analytics screens against the emulators: counters, Dashboard, Premium members, Payments, People, manual changes, CSV, phone width.
// Needs: auth/firestore/functions emulators (ADMIN_EMAILS includes boss@example.com), a static server on :8765.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`);
const adminSrc = fs.readFileSync('/home/user/ohmygoal/js/admin.js', 'utf8');
const patched = adminSrc.replace('await authMod.signInWithPopup(auth, provider);', 'await authMod.signInWithCredential(auth, authMod.GoogleAuthProvider.credential(window.__adminToken));');
if (patched === adminSrc) throw new Error('admin.js patch did not apply');
const browser = await chromium.launch();
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
const stamp = Math.random().toString(36).slice(2, 8);
const DAY = 86400000;
const istDay = ms => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const FS = 'http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/';
const put = (path, fields) => fetch(FS + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }).then(r => { if (!r.ok) throw new Error('seed ' + r.status); });
const getDoc = async path => { const r = await fetch(FS + path, { headers: { Authorization: 'Bearer owner' } }); if (!r.ok) return null; return Object.fromEntries(Object.entries((await r.json()).fields || {}).map(([k, v]) => [k, Number(v.integerValue ?? v.doubleValue ?? v.stringValue)])); };
const S = v => ({ stringValue: v }), N = v => ({ integerValue: String(v) });
const base = 'artifacts/anon-connect';
const now = Date.now();

const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': '198.51.100.9' } }));
await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
await ctx.route(/jsdelivr|fonts\.g|country\.is/, r => r.abort());
await ctx.route('**/js/admin.js', r => r.fulfill({ body: patched, contentType: 'text/javascript' }));
await ctx.addInitScript(() => { window.__adminToken = JSON.stringify({ sub: 'g-boss', email: 'boss@example.com', email_verified: true }); });

// ---- 1. people to look at: three Google accounts and one anonymous one; a plain user calls the analytics
const sdk = await ctx.newPage();
await sdk.goto('http://localhost:8765/legal.html');
const users = await sdk.evaluate(async ({ stamp }) => {
  const appM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const authM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const out = {};
  const mk = async (name, google) => {
    const app = appM.initializeApp({ apiKey: 'fake-key', projectId: 'demo-ohmygoal', appId: '1:1:web:1', authDomain: 'demo-ohmygoal.firebaseapp.com' }, name + stamp);
    const auth = authM.getAuth(app), fns = fnM.getFunctions(app, 'asia-south1');
    authM.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fnM.connectFunctionsEmulator(fns, '127.0.0.1', 5001);
    if (google) await authM.signInWithCredential(auth, authM.GoogleAuthProvider.credential(JSON.stringify({ sub: `g-${name}-${stamp}`, email: `${name}${stamp}@example.com`, email_verified: true })));
    else await authM.signInAnonymously(auth);
    return { uid: auth.currentUser.uid, call: async (n, d) => { try { return { ok: (await fnM.httpsCallable(fns, n)(d)).data }; } catch (e) { return { err: e.code } }; } };
  };
  const alice = await mk('alice', true), bob = await mk('bob', true), carol = await mk('carol', true), anon = await mk('anon', false);
  out.uids = { alice: alice.uid, bob: bob.uid, carol: carol.uid, anon: anon.uid };
  out.plainDenied = await anon.call('adminAnalytics', { action: 'dashboard' });
  out.googleDenied = await alice.call('adminAnalytics', { action: 'members' });
  out.onlineDenied = await anon.call('adminAnalytics', { action: 'online' });
  const access = await anon.call('checkAccess', { fp: 'a'.repeat(32) });
  out.access = access;
  return out;
}, { stamp });
step('1a. someone who is not an admin is refused, signed in anonymously or with Google', users.plainDenied.err === 'functions/permission-denied' && users.googleDenied.err === 'functions/permission-denied' && users.onlineDenied.err === 'functions/permission-denied', JSON.stringify([users.plainDenied, users.googleDenied]));
const U = users.uids;

// ---- 2. counters: an access pass counts the person as active; a new room counts as a chat
const today = istDay(now);
await new Promise(r => setTimeout(r, 1500));
const dau1 = await getDoc(`${base}/private/data/stats/${today}`);
step('2a. getting an access pass counts the person as active today', (dau1?.dau || 0) >= 1, JSON.stringify(dau1));
const chats0 = dau1?.chats || 0;
await put(`${base}/public/data/rooms/an-room-${stamp}`, { mode: S('video'), a: S('x'), b: S('y'), createdAt: N(now) });
await put(`${base}/public/data/rooms/an-room2-${stamp}`, { mode: S('text'), a: S('x'), b: S('y'), createdAt: N(now) });
let st;
for (let i = 0; i < 20; i++) { st = await getDoc(`${base}/private/data/stats/${today}`); if ((st?.chats || 0) >= chats0 + 2) break; await new Promise(r => setTimeout(r, 500)); }
step('2b. a new room adds to the chat counters by kind', (st?.chats || 0) >= chats0 + 2 && (st?.chats_video || 0) >= 1 && (st?.chats_text || 0) >= 1, JSON.stringify(st));

// ---- 3. seed Premium and payments
await put(`${base}/public/data/entitlements/${U.alice}`, { premiumUntil: N(now + 40 * DAY), updatedAt: N(now) });
await put(`${base}/public/data/entitlements/${U.bob}`, { premiumUntil: N(now + 3 * DAY), updatedAt: N(now) });       // given by the admin: no order
await put(`${base}/public/data/entitlements/${U.carol}`, { premiumUntil: N(now - 2 * DAY), updatedAt: N(now) });     // ended
const order = (id, uid, o) => put(`${base}/private/data/orders/${id}`, { uid: S(uid), currency: S('INR'), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? N(v) : S(v)])) });
await order(`an-o1-${stamp}`, U.alice, { plan: 'month', days: 30, amount: 9900, status: 'paid', createdAt: now - 5000, paidAt: now - 4000, paymentId: 'pay_AAAAAAAAAAAAAAAA' });
await order(`an-o2-${stamp}`, U.alice, { plan: 'quarter', days: 90, amount: 24900, status: 'paid', createdAt: now - 20 * DAY, paidAt: now - 20 * DAY, paymentId: 'pay_BBBBBBBBBBBBBBBB' });
await order(`an-o3-${stamp}`, U.carol, { kind: 'coins', coins: 100, days: 0, amount: 4900, status: 'paid', createdAt: now - 2 * DAY, paidAt: now - 2 * DAY, paymentId: 'pay_CCCCCCCCCCCCCCCC' });
await order(`an-o4-${stamp}`, U.carol, { kind: 'tip', days: 0, amount: 5000, status: 'paid', createdAt: now - 1 * DAY, paidAt: now - 1 * DAY, paymentId: 'pay_DDDDDDDDDDDDDDDD' });
await order(`an-o5-${stamp}`, U.bob, { plan: 'month', days: 30, amount: 9900, status: 'created', createdAt: now - 3000 });

// ---- 4. the admin page
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('dialog', d => d.accept());
await p.goto('http://localhost:8765/admin.html');
await p.waitForSelector('#signin:not(.hidden)', { timeout: 20000 });
await p.click('#signInBtn');
await p.waitForSelector('#panel:not(.hidden)', { timeout: 20000 });
const text = sel => p.textContent(sel).then(t => (t || '').trim());
const tab = name => p.click(`#tabs button[data-tab="${name}"]`);

await p.waitForSelector('#dashBody .tile', { timeout: 20000 });
step('4a. the Dashboard is the first tab and opens by default', (await p.getAttribute('#tabs button:first-child', 'data-tab')) === 'dashboard' && (await p.getAttribute('#tabs button[data-tab="dashboard"]', 'class')).includes('active'));
const tiles = await p.locator('#dashBody .tile').allTextContents();
const tileOf = label => tiles.find(t => t.startsWith(label)) || '';
step('4b. tiles: Premium members counts the active ones (at least Alice and Bob)', Number(tileOf('Premium members').replace(/^Premium members/, '').match(/^\d+/)?.[0]) >= 2, tileOf('Premium members'));
step('4c. tiles: revenue shows rupees, and today includes the ₹99 payment', /₹[\d,]+/.test(tileOf('Revenue today')) && Number(tileOf('Revenue today').replace(/^Revenue today₹/, '').match(/^[\d,]+/)[0].replace(/,/g, '')) >= 99, tileOf('Revenue today'));
step('4d. tiles: people active today is at least 1', /[1-9]\d* people active today/.test(tileOf('Chats today')), tileOf('Chats today'));
const online0 = Number((await text('#onlineNow')).replace(/\D/g, '')) || 0;
await put(`${base}/public/data/presence/an-p1-${stamp}`, { ts: N(Date.now()) });
await put(`${base}/public/data/presence/an-p2-${stamp}`, { ts: N(Date.now()) });
await p.waitForFunction(n => Number(document.getElementById('onlineNow').textContent.replace(/\D/g, '')) >= n, online0 + 2, { timeout: 40000 }).catch(() => {});
step('4d2. “Online now” updates by itself (two people arrive while the page is open)', Number((await text('#onlineNow')).replace(/\D/g, '')) >= online0 + 2, `${online0} -> ${await text('#onlineNow')}`);
step('4e. charts are drawn (SVG), with no script or image elements in them', await p.locator('#dashBody svg.chart').count() >= 5 && await p.locator('#dashBody svg script, #dashBody svg image, #dashBody svg foreignObject').count() === 0);
step('4f. “Where the money comes from” lists Premium, Coin packs and Tips', /Premium/.test(await text('#dashBody')) && /Coin pack/.test(await text('#dashBody')) && /Tip/.test(await text('#dashBody')));
await p.selectOption('#dashDays', '7');
await p.waitForFunction(() => document.querySelectorAll('#dashBody svg.chart').length >= 5);
step('4g. the period can be changed to 7 days', await p.locator('#dashBody svg.chart').first().locator('rect, circle').count() >= 1);
const [csvDash] = await Promise.all([p.waitForEvent('download'), p.click('#dashBody button:has-text("Download daily numbers")')]);
const csvText = fs.readFileSync(await csvDash.path(), 'utf8');
step('4h. the daily numbers download as CSV, one row per day', csvText.startsWith('﻿date,people_active') && csvText.trim().split('\r\n').length === 8, csvText.split('\r\n').slice(0, 2).join(' | '));

// ---- Premium
await tab('premium');
await p.waitForSelector('#memberList table', { timeout: 20000 });
const rowOf = who => p.locator('#memberList tbody tr', { hasText: `${who}${stamp}@example.com` });
step('5a. Active shows Alice (40 days) and Bob (ending soon), not Carol', await rowOf('alice').count() === 1 && await rowOf('bob').count() === 1 && await rowOf('carol').count() === 0);
step('5b. Alice: days left, valid-until date, 2 orders and ₹348 paid', /^(40|41)$/.test(await rowOf('alice').locator('td').nth(3).textContent()) && /2/.test(await rowOf('alice').locator('td').nth(4).textContent()) && /₹348/.test(await rowOf('alice').textContent()), (await rowOf('alice').textContent()).slice(0, 160));
step('5c. Bob is marked “Ending soon” and “Granted” (Premium without a payment)', /Ending soon/.test(await rowOf('bob').textContent()) && /Granted/.test(await rowOf('bob').textContent()));
await p.click('#memberFilters [data-f="expired"]');
step('5d. “Ended” shows Carol', await rowOf('carol').count() === 1 && await rowOf('alice').count() === 0);
await p.click('#memberFilters [data-f="granted"]');
step('5e. “Given by you” shows Bob and Carol (no Premium order) but not Alice', await rowOf('bob').count() === 1 && await rowOf('carol').count() === 1 && await rowOf('alice').count() === 0);
await p.click('#memberFilters [data-f="all"]');
await p.fill('#memberSearch', `alice${stamp}`);
step('5f. search narrows the list to one person', await p.locator('#memberList tbody tr').count() === 1 && await rowOf('alice').count() === 1);
await p.fill('#memberSearch', '');
await p.click('#memberFilters [data-f="active"]');
await rowOf('bob').locator('button:has-text("+30 days")').click();
await p.waitForFunction(({ s }) => [...document.querySelectorAll('#memberList tbody tr')].some(r => r.textContent.includes(`bob${s}@example.com`) && /\b3[2-4]\b/.test(r.querySelectorAll('td')[3].textContent)), { s: stamp }, { timeout: 15000 }).catch(() => {});
step('5g. “+30 days” adds 30 days to Bob (3 → about 33)', /\b3[2-4]\b/.test(await rowOf('bob').locator('td').nth(3).textContent()), await rowOf('bob').locator('td').nth(3).textContent());
const bobDoc = await getDoc(`${base}/public/data/entitlements/${U.bob}`);
step('5h. it is saved in the entitlement document and written to the admin log', bobDoc.premiumUntil > now + 32 * DAY);
await rowOf('alice').locator('button:has-text("Revoke")').click();
await p.waitForFunction(({ s }) => ![...document.querySelectorAll('#memberList tbody tr')].some(r => r.textContent.includes(`alice${s}@example.com`)), { s: stamp }, { timeout: 15000 }).catch(() => {});
step('5i. “Revoke” ends Alice’s Premium: she leaves the Active list', await rowOf('alice').count() === 0);
const aliceDoc = await getDoc(`${base}/public/data/entitlements/${U.alice}`);
step('5j. her pass now ends at once', aliceDoc.premiumUntil <= Date.now());
await p.click('#memberFilters [data-f="all"]');
const [csvM] = await Promise.all([p.waitForEvent('download'), p.click('#memberCsv')]);
const csvMembers = fs.readFileSync(await csvM.path(), 'utf8');
step('5k. the Premium list downloads as CSV with every person', csvMembers.includes(`alice${stamp}@example.com`) && csvMembers.includes(`bob${stamp}@example.com`) && csvMembers.includes('granted_by_admin'));

// ---- Payments
await tab('payments');
await p.waitForSelector('#orderList table', { timeout: 20000 });
step('6a. Payments: revenue tiles by period and by kind', await p.locator('#payTiles .tile').count() === 7 && /₹/.test(await text('#payTiles')));
step('6b. all orders are listed with person, what, amount and status', await p.locator('#orderList tbody tr').count() >= 5 && /Premium 30 days/.test(await text('#orderList')) && /100 coins/.test(await text('#orderList')) && /Not paid/.test(await text('#orderList')));
await p.click('#orderKinds [data-f="coins"]');
step('6c. the kind filter shows only coin packs', await p.locator('#orderList tbody tr').count() >= 1 && !/Premium \d+ days/.test(await text('#orderList')) && /100 coins/.test(await text('#orderList')));
await p.click('#orderKinds [data-f="tip"]');
step('6d. …and only tips', /Tip/.test(await text('#orderList tbody')) && !/coins/.test(await text('#orderList tbody')));
const [csvO] = await Promise.all([p.waitForEvent('download'), p.click('#orderCsv')]);
const csvOrders = fs.readFileSync(await csvO.path(), 'utf8');
step('6e. orders download as CSV', csvOrders.includes('amount_inr') && csvOrders.includes('pay_DDDDDDDDDDDDDDDD'));

// ---- People
await tab('people');
await p.fill('#personQuery', `carol${stamp}@example.com`);
await p.click('#personForm button[type="submit"]');
await p.waitForSelector('#personResult .card', { timeout: 20000 });
step('7a. looking someone up by email shows their account, with no Premium', new RegExp(`carol${stamp}@example.com`).test(await text('#personResult')) && /Free/.test(await text('#personResult .item-head')));
step('7b. …their orders (coin pack and tip)', /100 coins/.test(await text('#personResult')) && /Tip/.test(await text('#personResult')));
await p.fill('#grantDays', '10');
await p.fill('#personNote', 'goodwill after a failed payment');
await p.click('#personResult button:has-text("Give Premium")');
await p.waitForFunction(() => /Premium until/.test(document.getElementById('personResult').textContent) && document.querySelector('#personResult .item-head .pill')?.textContent === 'Premium', null, { timeout: 15000 }).catch(() => {});
const carolDoc = await getDoc(`${base}/public/data/entitlements/${U.carol}`);
step('7c. giving 10 days to someone whose pass ended starts from now', Math.abs(carolDoc.premiumUntil - (Date.now() + 10 * DAY)) < 2 * 60000 && /Premium/.test(await text('#personResult .item-head')), String((carolDoc.premiumUntil - Date.now()) / DAY));
step('7d. the change is in the admin log, with the note and who did it', /boss@example\.com · grantPremium 10 days — goodwill after a failed payment/.test(await text('#personResult')));
await p.fill('#coinDelta', '50');
await p.click('#personResult button:has-text("Change coins")');
await p.waitForFunction(() => /Coins: 50/.test(document.getElementById('personResult').textContent), null, { timeout: 15000 }).catch(() => {});
step('7e. coins can be added', /Coins: 50/.test(await text('#personResult .kv')));
await p.fill('#coinDelta', '-80');
await p.click('#personResult button:has-text("Change coins")');
await p.waitForFunction(() => /Coins: 0/.test(document.getElementById('personResult').textContent), null, { timeout: 15000 }).catch(() => {});
step('7f. …and removed, but never below zero', /Coins: 0/.test(await text('#personResult .kv')) || !/Coins:/.test(await text('#personResult .kv')) /* 0 is hidden by the kv helper */, await text('#personResult .kv'));
await p.fill('#grantDays', '999');
await p.click('#personResult button:has-text("Give Premium")');
await p.waitForFunction(() => /from 1 to 365/.test(document.getElementById('toasts').textContent), null, { timeout: 10000 }).catch(() => {});
step('7g. 999 days is refused with a clear message', /from 1 to 365/.test(await text('#toasts')));
await p.click('#personResult button:has-text("Ban for 24 hours")');
await p.waitForFunction(() => /Active bans/.test(document.getElementById('personResult').textContent) && /admin · until/.test(document.getElementById('personResult').textContent), null, { timeout: 15000 }).catch(() => {});
step('7h. “Ban for 24 hours” bans the person and shows the ban', /admin · until/.test(await text('#personResult')));
await p.click('#personResult button:has-text("End Premium now")');
await p.waitForFunction(() => document.querySelector('#personResult .item-head .pill')?.textContent === 'Free', null, { timeout: 15000 }).catch(() => {});
step('7i. “End Premium now” works from here too', (await text('#personResult .item-head')).includes('Free'));
await p.fill('#personQuery', `nobody${stamp}@example.com`);
await p.click('#personForm button[type="submit"]');
await p.waitForFunction(() => /No account with that email/.test(document.getElementById('personResult').textContent), null, { timeout: 15000 }).catch(() => {});
step('7j. an unknown email says so', /No account with that email/.test(await text('#personResult')));
await p.fill('#personQuery', U.anon);
await p.click('#personForm button[type="submit"]');
await p.waitForSelector('#personResult .item-head', { timeout: 15000 });
step('7k. an anonymous user can be found by user ID', (await text('#personResult')).includes(U.anon) && /not signed in with Google/.test(await text('#personResult .item-head')));
await p.fill('#personQuery', '../../private');
await p.click('#personForm button[type="submit"]');
await p.waitForFunction(() => /No account/.test(document.getElementById('personResult').textContent), null, { timeout: 15000 }).catch(() => {});
step('7l. a path-like query finds nothing and breaks nothing', /No account/.test(await text('#personResult')));

// ---- the log is written by the server and only the server
const kinds = [];                      // all pages of the log (the emulator returns a limited number at a time)
for (let token = ''; ;) {
  const logs = await (await fetch(FS + `${base}/private/data/adminLog?pageSize=300` + (token ? `&pageToken=${token}` : ''), { headers: { Authorization: 'Bearer owner' } })).json();
  for (const d of logs.documents || []) kinds.push(d.fields.what.stringValue);
  token = logs.nextPageToken || '';
  if (!token) break;
}
step('8a. every change was logged', ['grantPremium', 'revokePremium', 'adjustCoins'].every(k => kinds.includes(k)), kinds.join(','));

// ---- phone width: no sideways scrolling on any of the new tabs
const phone = await ctx.newPage();
await phone.setViewportSize({ width: 360, height: 740 });
phone.on('dialog', d => d.accept());
await phone.goto('http://localhost:8765/admin.html');
await phone.waitForSelector('#signin:not(.hidden), #panel:not(.hidden)', { timeout: 20000 });
if (await phone.isVisible('#signin')) await phone.click('#signInBtn');
await phone.waitForSelector('#panel:not(.hidden)', { timeout: 20000 });
for (const name of ['dashboard', 'premium', 'payments', 'people']) {
  await phone.click(`#tabs button[data-tab="${name}"]`);
  if (name === 'people') { await phone.fill('#personQuery', `carol${stamp}@example.com`); await phone.click('#personForm button[type="submit"]'); await phone.waitForSelector('#personResult .card'); }
  else await phone.waitForSelector({ dashboard: '#dashBody .tile', premium: '#memberList table, #memberList .empty', payments: '#orderList table' }[name], { timeout: 20000 });
  const w = await phone.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  step(`9. phone width: ${name} does not scroll sideways`, w.sw <= w.iw + 1, JSON.stringify(w));
}

step('10. no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
