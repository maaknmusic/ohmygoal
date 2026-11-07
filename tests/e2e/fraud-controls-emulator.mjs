// Fraud controls against the emulators: host verification (name, PAN, one payout account per host), the longer hold and the monthly cap
// for new hosts, trusted hosts, blocking a buyer and their device after a chargeback, daily limits for new buyers, and the admin's
// warnings when a host's payout account or device changed. Needs the emulators (ADMIN_EMAILS includes boss@example.com, webhook secret
// test_webhook_secret), node tests/e2e/mockrzp.mjs on :7777 and a static server on :8765.
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

const patch = (path, fields) => fetch(FS_URL + path + '?' + Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&'), { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'boolean' ? { booleanValue: v } : { integerValue: String(v) }])) }) });
const DAY = 86400000;

const boss = await page.evaluate(() => window.T.mk('boss', { email: 'boss@example.com' }).then(u => u.uid));
const h1 = await mk('h1'), h2 = await mk('h2');
const stamp = await page.evaluate(() => window.T.stamp);
const run = String(Date.now()).slice(-6);   // PANs and accounts must be new each run: each can belong to one host only
const letters = run.replace(/./g, c => 'ABCDEFGHIJ'[c]);
const pan = n => `${letters.slice(0, 4)}${n}${run.slice(-4)}Z`;
const PAN1 = pan('A'), PAN2 = pan('B'), ACCOUNT = '90' + run + '1234';
await call('h1', 'startLive', { name: 'Riya', title: 'Becoming a host', mode: 'voice', kind: 'public' });
await call('h2', 'startLive', { name: 'Kabir', title: 'Becoming a host', mode: 'voice', kind: 'public' });

// ------------------------------------------------------------------------------------------------ 1. host verification
await setHostWallet(h1, 2000, { [istDay(Date.now() - 20 * DAY)]: 2000 });
const noKyc = await call('h1', 'requestPayout', {});
step('1a. no payout without payout details', noKyc.err === 'functions/failed-precondition' && /PAN/.test(noKyc.msg), noKyc.msg);
const bad = await call('h1', 'saveHostKyc', { name: 'Riya Sharma', pan: 'NOTAPAN', method: 'upi', upi: 'riya@okaxis' });
const ok1 = await call('h1', 'saveHostKyc', { name: 'Riya Sharma', pan: PAN1.toLowerCase(), method: 'upi', upi: `riya${stamp}@okaxis` });
step('1b. a wrong PAN is refused with a clear message; good details are saved, masked for the host', bad.err === 'functions/invalid-argument' && /PAN/.test(bad.msg) && ok1.ok?.kyc?.status === 'submitted' && ok1.ok.kyc.pan === PAN1.slice(0, 2) + '•••••' + PAN1.slice(7), JSON.stringify([bad.msg, ok1.ok?.kyc]));
const samePan = await call('h2', 'saveHostKyc', { name: 'Kabir Rao', pan: PAN1, method: 'upi', upi: `kabir${stamp}@okaxis` });
const sameUpi = await call('h2', 'saveHostKyc', { name: 'Kabir Rao', pan: PAN2, method: 'upi', upi: `riya${stamp}@okaxis` });
step('1c. another host cannot use the same PAN or the same UPI ID', samePan.err === 'functions/already-exists' && /PAN/.test(samePan.msg) && sameUpi.err === 'functions/already-exists' && /UPI ID/.test(sameUpi.msg), JSON.stringify([samePan.msg, sameUpi.msg]));
const p1 = await call('h1', 'requestPayout', {});
const pay1 = await read(`${base}/private/data/payouts/${p1.ok?.id}`);
step('1d. with details saved the host can ask; the payout goes to the saved UPI ID in their name', p1.ok?.coins === 2000 && pay1.details === `UPI riya${stamp}@okaxis` && pay1.payName === 'Riya Sharma', JSON.stringify([p1, pay1]));
const early = await call('boss', 'adminHosts', { action: 'payoutPaid', id: p1.ok.id, reference: 'UTR0001' });
const list1 = (await call('boss', 'adminHosts', { action: 'list' })).ok;
const row1 = list1.hosts.find(x => x.uid === h1);
step('1e. the admin cannot mark it paid before verifying, and sees the full PAN and UPI ID to check', early.err === 'functions/failed-precondition' && /verify/i.test(early.msg) && row1.kyc.pan === PAN1 && row1.kyc.payTo === `UPI riya${stamp}@okaxis`, early.msg);
const rejNoNote = await call('boss', 'adminHosts', { action: 'kycReject', uid: h1 });
await call('boss', 'adminHosts', { action: 'kycReject', uid: h1, note: 'The UPI name is different' });
const my1 = await call('h1', 'myHost', {});
step('1f. rejecting needs a reason, and the host sees it', rejNoNote.err === 'functions/invalid-argument' && my1.ok.kyc.status === 'rejected' && my1.ok.kyc.note === 'The UPI name is different', JSON.stringify(my1.ok.kyc));
await call('h1', 'saveHostKyc', { name: 'Riya Sharma', pan: PAN1, method: 'bank', account: ACCOUNT, ifsc: 'HDFC0001234' });
const list2 = (await call('boss', 'adminHosts', { action: 'list' })).ok;
const req2 = list2.payouts.find(p => p.id === p1.ok.id);
step('1g. changing the payout account resets the check and warns the admin next to the payout', list2.hosts.find(x => x.uid === h1).kyc.status === 'submitted' && req2.risk.warnings.some(w => /payout account was changed 0 day/.test(w)), JSON.stringify(req2.risk.warnings));
const freed = await call('h2', 'saveHostKyc', { name: 'Kabir Rao', pan: PAN2, method: 'upi', upi: `riya${stamp}@okaxis` });
step('1h. the old UPI ID is free again once its owner moved to a bank account', freed.ok?.ok === true, JSON.stringify(freed));
await call('boss', 'adminHosts', { action: 'kycVerify', uid: h1 });
const paid = await call('boss', 'adminHosts', { action: 'payoutPaid', id: p1.ok.id, reference: 'UTR0001' });
step('1i. after verifying, the payout can be marked paid', paid.ok?.ok === true, JSON.stringify(paid));

// ------------------------------------------------------------------------------------------------ 2. new hosts: longer hold and a monthly cap
await setHostWallet(h2, 20000, { [istDay(Date.now() - 10 * DAY)]: 20000 });
const my2 = await call('h2', 'myHost', {});
const p2 = await call('h2', 'requestPayout', {});
step('2a. a new host’s earnings from 10 days ago are still on hold (14 days)', my2.ok.holdDays === 14 && my2.ok.heldCoins === 20000 && p2.err === 'functions/failed-precondition' && /14 days/.test(p2.msg), JSON.stringify([my2.ok.holdDays, my2.ok.heldCoins, p2.msg]));
await setHostWallet(h2, 20000, { [istDay(Date.now() - 16 * DAY)]: 20000 });
const p2b = await call('h2', 'requestPayout', {});
const w2 = await read(`${base}/private/data/hostWallet/${h2}`);
step('2b. at most ₹10,000 per 30 days: 13,333 coins are paid out, the rest stays with the host', p2b.ok?.coins === 13333 && p2b.ok.paise === 999975 && w2.coins === 6667, JSON.stringify([p2b, w2]));
await call('boss', 'adminHosts', { action: 'kycVerify', uid: h2 });
await call('boss', 'adminHosts', { action: 'payoutPaid', id: p2b.ok.id, reference: 'UTR0002' });
const p2c = await call('h2', 'requestPayout', {});
step('2c. the next request in the same 30 days is refused with the limit explained', p2c.err === 'functions/failed-precondition' && /limit for new hosts/.test(p2c.msg), p2c.msg);
const nt = await call('h2', 'adminHosts', { action: 'trust', uid: h2 });
await call('boss', 'adminHosts', { action: 'trust', uid: h2, note: 'known creator' });
const p2d = await call('h2', 'requestPayout', {});
const my2d = await call('h2', 'myHost', {});
step('2d. only an admin can mark a host trusted; a trusted host has no monthly limit and a 7-day hold', nt.err === 'functions/permission-denied' && p2d.ok?.coins === 6667 && my2d.ok.trusted === true && my2d.ok.holdDays === 7 && my2d.ok.capLeftPaise === null, JSON.stringify([p2d, my2d.ok.holdDays]));

// ------------------------------------------------------------------------------------------------ 3. a host who switched devices
const fpNew = 'feedfacefeedfacefeedfacefeedface';
await page.evaluate(async fp => { await window.T.users.h1.call('checkAccess', { fp }); }, fpNew);
await setHostWallet(h1, 400, { [istDay(Date.now() - 20 * DAY)]: 400 });
const p3 = await call('h1', 'requestPayout', {});
const list3 = (await call('boss', 'adminHosts', { action: 'list' })).ok;
const req3 = list3.payouts.find(p => p.id === p3.ok?.id);
step('3a. a payout asked from a new device shows a warning to the admin', req3?.risk?.warnings.some(w => /different device 0 day/.test(w)), JSON.stringify(req3?.risk?.warnings));

// ------------------------------------------------------------------------------------------------ 4. buyers
const cheat = await mk('cheat'), friend = await mk('friend');
const t1 = await buy('cheat', { tip: 900 });
const over = await call('cheat', 'createOrder', { tip: 200 });
step('4a. a new account can spend ₹1,000 a day: ₹900 works, ₹200 more is refused with the amount left', Boolean(t1.orderId) && over.err === 'functions/resource-exhausted' && /₹100 more/.test(over.msg), over.msg);
const small = await call('cheat', 'createOrder', { tip: 50 });
step('4b. a smaller amount inside the limit still works', Boolean(small.ok?.orderId), JSON.stringify(small));
const d = await post(MOCK + '/test/dispute', { payment_id: t1.paymentId });
await hook({ event: 'payment.dispute.created', payload: { dispute: { entity: { id: d.id } } } });
const after = await call('cheat', 'createOrder', { tip: 10 });
step('4c. after a chargeback the account cannot pay at all', after.err === 'functions/permission-denied' && /blocked/.test(after.msg), after.msg);
// the same device, a fresh account: blocked too
const cheatClient = await read(`${base}/private/data/clients/${cheat}`);
const alt = await mk('alt');
await page.evaluate(async fp => { await window.T.users.alt.call('checkAccess', { fp }); }, cheatClient.fp);
const altTry = await call('alt', 'createOrder', { tip: 10 });
const friendTry = await call('friend', 'createOrder', { tip: 10 });
step('4d. a new account on the same device is blocked too; other people are not', altTry.err === 'functions/permission-denied' && Boolean(friendTry.ok?.orderId), JSON.stringify([altTry.err, friendTry.err]));
const look = (await call('boss', 'adminAnalytics', { action: 'user', q: cheat })).ok;
await call('boss', 'adminAnalytics', { action: 'unblockBuyer', uid: cheat, note: 'bank confirmed it was a mistake' });
const again = await call('cheat', 'createOrder', { tip: 10 });
const altAgain = await call('alt', 'createOrder', { tip: 10 });
step('4e. the admin sees the block and can lift it, for the account and its device', look.buyingBlocked?.reason === 'chargeback' && Boolean(again.ok?.orderId) && Boolean(altAgain.ok?.orderId), JSON.stringify([look.buyingBlocked, again.err, altAgain.err]));

console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
