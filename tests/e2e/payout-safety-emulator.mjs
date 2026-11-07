// Payout safety against the emulators: the 7-day hold on host earnings, refunds and chargebacks taking back what a payment bought and
// pausing payouts to hosts paid by that buyer, the admin's warning signs on payout requests, and clearing a pause.
// Needs: auth/firestore/functions emulators (ADMIN_EMAILS includes boss@example.com, the webhook secret test_webhook_secret),
// node tests/e2e/mockrzp.mjs on :7777 and a static server on :8765.
import crypto from 'node:crypto';
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const browser = await chromium.launch();
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
const ctx = await browser.newContext({ serviceWorkers: 'block' });
await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
await ctx.route(/jsdelivr|fonts\.g|country\.is/, r => r.abort());
await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': '198.51.100.88' } }));
const page = await ctx.newPage();
await page.goto('http://localhost:8765/legal.html');

// ---- helpers in node: read and seed documents as the project owner
const FS_URL = 'http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/';
const base = 'artifacts/anon-connect';
const val = v => (v.integerValue !== undefined ? Number(v.integerValue) : v.stringValue !== undefined ? v.stringValue : v.booleanValue !== undefined ? v.booleanValue : v.nullValue !== undefined ? null : v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)])) : undefined);
const read = async path => { const r = await fetch(FS_URL + path, { headers: { Authorization: 'Bearer owner' } }); if (!r.ok) return null; return Object.fromEntries(Object.entries((await r.json()).fields || {}).map(([k, v]) => [k, val(v)])); };
const list = async path => {   // all pages (the emulator returns at most 150 documents at a time)
  const out = []; let token = '';
  do {
    const d = await (await fetch(FS_URL + path + '?pageSize=300' + (token ? '&pageToken=' + token : ''), { headers: { Authorization: 'Bearer owner' } })).json();
    for (const x of d.documents || []) out.push({ id: x.name.split('/').pop(), ...Object.fromEntries(Object.entries(x.fields || {}).map(([k, v]) => [k, val(v)])) });
    token = d.nextPageToken || '';
  } while (token);
  return out;
};
// coins are seeded as BOUGHT unless `bought` says otherwise: only bought coins earn a host money (functions/live.js earningSplit)
const seedCoins = (uid, coins, bought = coins) => fetch(FS_URL + `${base}/private/data/wallet/${uid}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { coins: { integerValue: String(coins) }, bought: { integerValue: String(bought) } } }) });
const seedHostCoins = (uid, coins) => fetch(FS_URL + `${base}/private/data/hostWallet/${uid}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { coins: { integerValue: String(coins) }, pending: { integerValue: '0' }, paidOut: { integerValue: '0' }, lifetime: { integerValue: String(coins) } } }) });

// ---- helpers in the page: sign in several people and call functions as them
await page.evaluate(async () => {
  const appM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const authM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  const f = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const stamp = Math.random().toString(36).slice(2, 8);
  const users = {};
  window.T = {
    stamp, users, f,
    async mk(name, { google = true, email } = {}) {
      const app = appM.initializeApp({ apiKey: 'fake-key', projectId: 'demo-ohmygoal', appId: '1:1:web:1', authDomain: 'demo-ohmygoal.firebaseapp.com' }, name + stamp + Math.random());
      const auth = authM.getAuth(app), db = f.getFirestore(app), fns = fnM.getFunctions(app, 'asia-south1');
      authM.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      f.connectFirestoreEmulator(db, '127.0.0.1', 8080);
      fnM.connectFunctionsEmulator(fns, '127.0.0.1', 5001);
      if (google) await authM.signInWithCredential(auth, authM.GoogleAuthProvider.credential(JSON.stringify({ sub: `g-${name}-${stamp}`, email: email || `${name}${stamp}@example.com`, email_verified: true })));
      else await authM.signInAnonymously(auth);
      const call = async (n, d) => { try { return { ok: (await fnM.httpsCallable(fns, n)(d)).data }; } catch (e) { return { err: e.code, msg: e.message }; } };
      const fp = (name + stamp).padEnd(32, 'f').slice(0, 32).replace(/[^a-f0-9]/g, 'a');
      await call('checkAccess', { fp });
      return (users[name] = { uid: auth.currentUser.uid, call, db, name });
    },
    base: ['artifacts', 'anon-connect', 'public', 'data'],
    async code(p) { try { await p; return 'ALLOWED'; } catch (e) { return e.code || String(e); } },
  };
});
const P = fn => page.evaluate(fn);
const mk = (name, o) => page.evaluate(([n, o2]) => window.T.mk(n, o2).then(u => u.uid), [name, o || {}]);
const call = (name, fn, data) => page.evaluate(([n, f, d]) => window.T.users[n].call(f, d), [name, fn, data]);


// ------------------------------------------------------------------------------------------------ 1. who can go live

const FN = 'http://127.0.0.1:5001/demo-ohmygoal/asia-south1/';
const MOCK = 'http://127.0.0.1:7777';
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const hook = async (payload, sign = true) => {
  const body = JSON.stringify(payload);
  const sig = sign ? crypto.createHmac('sha256', 'test_webhook_secret').update(body).digest('hex') : 'nope';
  const r = await fetch(FN + 'razorpayWebhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig }, body });
  return { status: r.status, text: await r.text() };
};
/** Buy something as `who` through the fake checkout; returns { orderId, paymentId }. */
const buy = async (who, data) => {
  const o = await call(who, 'createOrder', data);
  const pay = await post(MOCK + '/test/pay', { order_id: o.ok.orderId });
  const v = await call(who, 'verifyPayment', { orderId: o.ok.orderId, paymentId: pay.razorpay_payment_id, signature: pay.razorpay_signature });
  if (!v.ok) throw new Error('payment failed ' + JSON.stringify(v));
  return { orderId: o.ok.orderId, paymentId: pay.razorpay_payment_id };
};
const setHostWallet = (uid, coins, recent) => fetch(FS_URL + `${base}/private/data/hostWallet/${uid}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: {
  coins: { integerValue: String(coins) }, pending: { integerValue: '0' }, paidOut: { integerValue: '0' }, lifetime: { integerValue: String(coins) },
  recent: { mapValue: { fields: Object.fromEntries(Object.entries(recent).map(([d, n]) => [d, { integerValue: String(n) }])) } },
} }) });
const istDay = ms => new Date(ms + 330 * 60000).toISOString().slice(0, 10);

const boss = await page.evaluate(() => window.T.mk('boss', { email: 'boss@example.com' }).then(u => u.uid));
const hostUid = await mk('host'), buyer = await mk('buyer'), honest = await mk('honest'), prem = await mk('prem');

// ------------------------------------------------------------------------------------------------ 1. a buyer pays a host
const pack = await buy('buyer', { coins: 'coins500' });
const wb0 = await read(`${base}/private/data/wallet/${buyer}`);
step('1a. (setup) the buyer bought 500 coins', wb0?.coins === 500 && wb0.bought === 500, JSON.stringify(wb0));
const live = await call('host', 'startLive', { name: 'Riya', title: 'Evening songs', mode: 'voice', kind: 'public' });
const sid = live.ok?.sid;
await call('buyer', 'joinLive', { sid, nick: 'Buyer' });
for (let i = 0; i < 9; i++) await call('buyer', 'sendLiveGift', { sid, gift: 'fireworks' });   // 450 coins, the host earns 9 × 35 = 315
const hw1 = await read(`${base}/private/data/hostWallet/${hostUid}`);
step('1b. nine fireworks: the host earned 315 coins, all of them today', hw1?.coins === 315 && hw1.recent?.[istDay(Date.now())] === 315, JSON.stringify(hw1));

// ------------------------------------------------------------------------------------------------ 2. the 7-day hold
const my2 = await call('host', 'myHost', {});
step('2a. the host screen shows the 315 coins on hold for 7 days and 0 ready to pay out', my2.ok?.heldCoins === 315 && my2.ok.payableCoins === 0 && my2.ok.holdDays === 7, JSON.stringify([my2.ok?.heldCoins, my2.ok?.payableCoins]));
const p2 = await call('host', 'requestPayout', { details: 'riya@upi' });
step('2b. a payout of coins earned today is refused, and the message says why', p2.err === 'functions/failed-precondition' && /315 earned in the last 7 days are on hold/.test(p2.msg), p2.msg);
// earnings from 8 days ago are payable, 3 days ago still held
const old = istDay(Date.now() - 8 * 86400000), mid = istDay(Date.now() - 3 * 86400000);
await setHostWallet(hostUid, 600, { [old]: 400, [mid]: 200 });
const my2c = await call('host', 'myHost', {});
const p2c = await call('host', 'requestPayout', { details: 'riya@upi' });
const hw2 = await read(`${base}/private/data/hostWallet/${hostUid}`);
step('2c. coins earned 8 days ago can be paid (400), the 200 from 3 days ago stay on hold in the balance', my2c.ok?.payableCoins === 400 && my2c.ok.heldCoins === 200 && p2c.ok?.coins === 400 && hw2.coins === 200 && hw2.pending === 400, JSON.stringify([my2c.ok?.payableCoins, p2c.ok, hw2]));

// ------------------------------------------------------------------------------------------------ 3. the admin's warning signs
const adm = (await call('boss', 'adminHosts', { action: 'list' })).ok;
const req = adm.payouts.find(p => p.uid === hostUid && p.status === 'requested');
step('3a. the payout request shows who the earnings came from: one person, 100%, on the same IP address as the host',
  req?.risk?.earned30 === 315 && req.risk.top[0]?.uid === buyer && req.risk.top[0].pct === 100 && req.risk.top[0].sameIp === true
  && req.risk.warnings.some(w => /100% of the last 30 days/.test(w)) && req.risk.warnings.some(w => /same IP/.test(w)), JSON.stringify(req?.risk));
const pRow = adm.hosts.find(x => x.uid === hostUid);
step('3b. the host row shows the coins on hold', pRow?.held === 200, JSON.stringify(pRow));

// ------------------------------------------------------------------------------------------------ 4. a chargeback on the coin pack
const fakeHook = await hook({ event: 'payment.dispute.created', payload: { dispute: { entity: { id: 'disp_fake12345' } } } });
const forged = await hook({ event: 'refund.processed', payload: { refund: { entity: { payment_id: pack.paymentId } } } });   // signed, but nothing was refunded at Razorpay
const unsigned = await hook({ event: 'refund.processed', payload: { refund: { entity: { payment_id: pack.paymentId } } } }, false);
const wb4 = await read(`${base}/private/data/wallet/${buyer}`);
step('4a. an unsigned webhook is refused, and a signed one that Razorpay does not confirm changes nothing',
  unsigned.status === 400 && forged.text === 'not confirmed' && fakeHook.text === 'not confirmed' && wb4.coins === 50, JSON.stringify([unsigned, forged, fakeHook, wb4]));
const d = await post(MOCK + '/test/dispute', { payment_id: pack.paymentId });
const r4 = await hook({ event: 'payment.dispute.created', payload: { dispute: { entity: { id: d.id } } } });
const r4b = await hook({ event: 'payment.dispute.created', payload: { dispute: { entity: { id: d.id } } } });
const wb4b = await read(`${base}/private/data/wallet/${buyer}`);
const o4 = await read(`${base}/private/data/orders/${pack.orderId}`);
const h4 = await read(`${base}/private/data/hosts/${hostUid}`);
step('4b. the chargeback takes back the 50 coins left; the 450 already spent are recorded as unrecovered; a repeat changes nothing',
  r4.text === 'reversed' && r4b.text === 'nothing to reverse' && wb4b.coins === 0 && wb4b.bought === 0 && o4.status === 'disputed' && o4.reversedCoins === 500 && o4.unrecoveredCoins === 450, JSON.stringify([r4, r4b, wb4b, o4]));
step('4c. payouts are paused for the host the buyer paid', Boolean(h4.payoutHold) && h4.payoutHold.buyerUid === buyer && h4.payoutHold.orderId === pack.orderId, JSON.stringify(h4.payoutHold));
await call('boss', 'adminHosts', { action: 'payoutReject', id: req.id, note: 'chargeback' });
await setHostWallet(hostUid, 500, { [old]: 500 });
const p4 = await call('host', 'requestPayout', { details: 'riya@upi' });
const my4 = await call('host', 'myHost', {});
step('4d. a paused host cannot ask for a payout, and their screen says why', p4.err === 'functions/failed-precondition' && /paused/.test(p4.msg) && my4.ok?.payoutsPaused === true, p4.msg);
const adm4 = (await call('boss', 'adminHosts', { action: 'list' })).ok;
const log4 = (await list(`${base}/private/data/adminLog`)).find(l => l.what === 'payment-dispute' && l.details?.orderId === pack.orderId);
step('4e. the admin sees the pause on the host and the reversal in the admin log', adm4.hosts.find(x => x.uid === hostUid)?.payoutHold?.buyerUid === buyer && Boolean(log4), JSON.stringify(log4?.details));

// ------------------------------------------------------------------------------------------------ 5. clearing a pause
const nc = await call('host', 'adminHosts', { action: 'clearHold', uid: hostUid });
const c5 = await call('boss', 'adminHosts', { action: 'clearHold', uid: hostUid, note: 'checked: genuine fan' });
const c5b = await call('boss', 'adminHosts', { action: 'clearHold', uid: hostUid });
const p5 = await call('host', 'requestPayout', { details: 'riya@upi' });
step('5a. only an admin can clear a pause; after it the host can ask for a payout again; clearing twice is refused',
  nc.err === 'functions/permission-denied' && c5.ok?.ok === true && c5b.err === 'functions/failed-precondition' && p5.ok?.coins === 500, JSON.stringify([nc.err, c5, c5b.err, p5]));

// ------------------------------------------------------------------------------------------------ 6. a partial refund, and a Premium refund
const pack2 = await buy('honest', { coins: 'coins200' });
await post(MOCK + '/test/refund', { payment_id: pack2.paymentId, amount: 7450 });   // half of ₹149
const r6 = await hook({ event: 'refund.processed', payload: { refund: { entity: { payment_id: pack2.paymentId } } } });
const wh6 = await read(`${base}/private/data/wallet/${honest}`);
const hh6 = await read(`${base}/private/data/hosts/${hostUid}`);
step('6a. a half refund of an unspent 200-coin pack takes back 100 coins and pauses nobody (no host was paid)', r6.text === 'reversed' && wh6.coins === 100 && wh6.bought === 100 && !hh6.payoutHold, JSON.stringify([r6, wh6, hh6?.payoutHold]));
await post(MOCK + '/test/refund', { payment_id: pack2.paymentId, amount: 7450 });   // the rest
const r6b = await hook({ event: 'refund.processed', payload: { refund: { entity: { payment_id: pack2.paymentId } } } });
const wh6b = await read(`${base}/private/data/wallet/${honest}`);
step('6b. refunding the rest takes back the other 100', r6b.text === 'reversed' && wh6b.coins === 0, JSON.stringify([r6b, wh6b]));
const pr = await buy('prem', { plan: 'month' });
const e0 = await read(`${base}/public/data/entitlements/${prem}`);
await post(MOCK + '/test/refund', { payment_id: pr.paymentId });
const r6c = await hook({ event: 'refund.processed', payload: { refund: { entity: { payment_id: pr.paymentId } } } });
const e1 = await read(`${base}/public/data/entitlements/${prem}`);
step('6c. refunding a Premium pass ends it', e0.premiumUntil > Date.now() + 29 * 86400000 && r6c.text === 'reversed' && e1.premiumUntil <= Date.now() + 5000, JSON.stringify([e0, e1]));

console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
