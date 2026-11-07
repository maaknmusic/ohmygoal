// The transaction ledger against the emulators: every way coins, host earnings, Premium or money move leaves exactly one entry per side,
// in the same transaction, and each person's history adds up step by step (the admin's person view and the CSV export say so).
// Needs: the emulators (ADMIN_EMAILS includes boss@example.com, webhook secret test_webhook_secret), mockrzp on :7777, a static server on :8765.
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

const putRoom = (id, a, b) => fetch(FS_URL + `${base}/public/data/rooms/${id}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: {
  created: { integerValue: String(Date.now()) }, users: { arrayValue: { values: [{ stringValue: a }, { stringValue: b }] } },
} }) });
const txOf = async uid => (await list(`${base}/private/data/transactions`)).filter(t => t.uid === uid).sort((a, b) => a.at - b.at);

const boss = await page.evaluate(() => window.T.mk('boss', { email: 'boss@example.com' }).then(u => u.uid));
const host = await mk('host'), fan = await mk('fan'), pal = await mk('pal');
const stamp = await page.evaluate(() => window.T.stamp);
const room = `tx${stamp}room`.padEnd(12, 'x');
await putRoom(room, fan, pal);

// ------------------------------------------------------------------------------------------------ 1. every kind of movement
const pack = await buy('fan', { coins: 'coins500' });                                        // purchase_coins  +500
await call('fan', 'claimDaily', {});                                                       // daily_bonus     +2
await call('fan', 'sendGift', { roomId: room, gift: 'rose' });                             // chat_gift       -5
await call('fan', 'giftCoins', { to: pal, amount: 20, roomId: room });                     // coin_gift_sent  -20 / coin_gift_received +14
const t0 = await call('host', 'startLive', { name: 'Riya', title: 'Free first session', mode: 'voice', kind: 'public' });
await call('fan', 'joinLive', { sid: t0.ok.sid, nick: 'Fan' });
await call('fan', 'sendLiveGift', { sid: t0.ok.sid, gift: 'fireworks' });                  // live_gift -50 / host_earning +35
await seedCoins(host, 100);                                                                // (outside the app: not in the ledger; the next entry starts from it)
const t1 = await call('host', 'startLive', { name: 'Riya', title: 'A private one', mode: 'voice', kind: 'private', maxGuests: 2 });   // live_fee -49
await call('fan', 'joinLive', { sid: t1.ok.sid, nick: 'Fan' });                            // private_seat -200 / host_earning +140
await call('boss', 'adminAnalytics', { action: 'adjustCoins', uid: fan, delta: 7, note: 'goodwill' });       // admin_coins +7
await call('boss', 'adminAnalytics', { action: 'grantPremium', uid: pal, days: 3, note: 'contest' });       // admin_premium +3
await buy('pal', { tip: 25 });                                                             // tip ₹25
const prem = await buy('pal', { plan: 'week' });                                           // purchase_premium
// host payouts: make 400 of the 175 + 400 payable, ask, reject, ask again, pay
const old = istDay(Date.now() - 9 * 86400000), today = istDay(Date.now());
await setHostWallet(host, 575, { [old]: 400, [today]: 175 });
const r1 = await call('host', 'requestPayout', { details: 'riya@upi' });                    // payout_requested -400
await call('boss', 'adminHosts', { action: 'payoutReject', id: r1.ok.id, note: 'wrong UPI' });   // payout_rejected +400
const r2 = await call('host', 'requestPayout', { details: 'riya@okaxis' });                 // payout_requested -400
await call('boss', 'adminHosts', { action: 'payoutPaid', id: r2.ok.id, reference: 'UTR123456' });  // payout_paid ₹300
// a refund of the Premium pass and a chargeback on the coin pack
await post(MOCK + '/test/refund', { payment_id: prem.paymentId });
await hook({ event: 'refund.processed', payload: { refund: { entity: { payment_id: prem.paymentId } } } });   // refund
const d = await post(MOCK + '/test/dispute', { payment_id: pack.paymentId });
await hook({ event: 'payment.dispute.created', payload: { dispute: { entity: { id: d.id } } } });             // dispute

// ------------------------------------------------------------------------------------------------ 2. what the ledger says
const fanTx = await txOf(fan), palTx = await txOf(pal), hostTx = await txOf(host);
const types = l => l.map(t => t.type).join(',');
step('1a. the fan: bought, daily bonus, chat gift, coin gift, live gift, private seat, admin coins, chargeback, in order',
  types(fanTx) === 'purchase_coins,daily_bonus,chat_gift,coin_gift_sent,live_gift,private_seat,admin_coins,dispute', types(fanTx));
const wf = await read(`${base}/private/data/wallet/${fan}`);
step('1b. the fan’s coins: +500 +2 -5 -20 -50 -200 +7, then the chargeback takes back what is left; the last entry matches the wallet',
  fanTx.map(t => t.coins).join(',') === '500,2,-5,-20,-50,-200,7,-234' && fanTx.at(-1).balance === wf.coins && wf.coins === 0, JSON.stringify([fanTx.map(t => [t.coins, t.balance]), wf]));
step('1c. money, the platform’s share and the other person are recorded',
  fanTx[0].paise === 34900 && fanTx[0].ref === pack.orderId && fanTx[0].by === 'razorpay' && fanTx[2].platform === 5 && fanTx[2].other === pal && fanTx[3].platform === 6 && fanTx[3].other === pal
  && fanTx[4].other === host && fanTx[4].note === 'fireworks' && fanTx[4].platform === 15 && fanTx[6].by === 'boss@example.com' && fanTx[6].note === 'goodwill' && fanTx[7].paise === 34900,
  JSON.stringify(fanTx.map(t => [t.type, t.paise, t.platform, t.other ? 'o' : '', t.by])));
step('1d. the friend: received coins, admin Premium, tip, Premium bought, Premium refunded',
  types(palTx) === 'coin_gift_received,admin_premium,tip,purchase_premium,refund' && palTx[0].coins === 14 && palTx[0].other === fan && palTx[1].days === 3 && palTx[2].paise === 2500 && palTx[3].days === 7 && palTx[4].days === -7, JSON.stringify(palTx.map(t => [t.type, t.coins, t.days, t.paise])));
step('1e. the host: earnings from the gift and the seat, the go-live fee, the payout asked, rejected, asked again and paid',
  types(hostTx) === 'host_earning,live_fee,host_earning,payout_requested,payout_rejected,payout_requested,payout_paid'
  && hostTx[0].earned === 35 && hostTx[2].earned === 140 && hostTx[1].coins === -49 && hostTx[3].earned === -400 && hostTx[4].earned === 400 && hostTx[6].paise === 30000 && hostTx[6].note === 'UTR123456',
  JSON.stringify(hostTx.map(t => [t.type, t.coins, t.earned, t.paise])));

// ------------------------------------------------------------------------------------------------ 3. the admin's views
const look = (await call('boss', 'adminAnalytics', { action: 'user', q: `fan${stamp}@example.com` })).ok;
step('2a. the person view lists every transaction, newest first, and says the history adds up', look.transactions.length === 8 && look.transactions[0].type === 'dispute' && look.ledgerBreak === null, JSON.stringify(look.ledgerBreak));
// a balance changed behind the ledger's back is caught
await seedCoins(fan, 999);         // (this also clears the day's bonus marker, so the bonus below is a real second entry)
await call('fan', 'claimDaily', {});
await call('boss', 'adminAnalytics', { action: 'adjustCoins', uid: fan, delta: 1 });
const look2 = (await call('boss', 'adminAnalytics', { action: 'user', q: fan })).ok;
step('2b. a balance changed outside the app shows up as a break in the history', look2.ledgerBreak?.kind === 'coins' && look2.ledgerBreak.expected === 0 && look2.ledgerBreak.found === 999, JSON.stringify(look2.ledgerBreak));
const all = (await call('boss', 'adminAnalytics', { action: 'transactions', days: 1 })).ok;
const mine = all.transactions.filter(t => [fan, pal, host].includes(t.uid));
step('2c. the all-transactions download has every one of them', mine.length === (await txOf(fan)).length + palTx.length + hostTx.length && all.days === 1, `${mine.length}`);
const nope = await call('fan', 'adminAnalytics', { action: 'transactions', days: 30 });
const direct = await page.evaluate(async () => { const T = window.T; const u = Object.values(T.users)[1]; return T.code(T.f.getDocs(T.f.collection(u.db, 'artifacts', 'anon-connect', 'private', 'data', 'transactions'))); });
step('2d. nobody but an admin can read transactions', nope.err === 'functions/permission-denied' && direct === 'permission-denied', JSON.stringify([nope.err, direct]));

console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
