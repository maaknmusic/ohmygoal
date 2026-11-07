// Gifting coins against the emulators: purchased-only, the 70/30 split, spend-only for the receiver, who you can gift (a chat partner or someone
// in the same live session), the limits, and that clients can never touch wallets. Needs the emulators and a static server on :8765.
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
await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': '198.51.100.77' } }));
const page = await ctx.newPage();
await page.goto('http://localhost:8765/legal.html');

const FS_URL = 'http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/';
const base = 'artifacts/anon-connect';
const val = v => (v.integerValue !== undefined ? Number(v.integerValue) : v.stringValue !== undefined ? v.stringValue : v.booleanValue);
const read = async path => { const r = await fetch(FS_URL + path, { headers: { Authorization: 'Bearer owner' } }); if (!r.ok) return null; return Object.fromEntries(Object.entries((await r.json()).fields || {}).map(([k, v]) => [k, val(v)])); };
const put = (path, fields) => fetch(FS_URL + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'object' ? { arrayValue: { values: v.map(x => ({ stringValue: x })) } } : { stringValue: String(v) }])) }) });
const wallet = (uid, coins, bought) => put(`${base}/private/data/wallet/${uid}`, { coins, ...(bought === undefined ? {} : { bought }) });

await page.evaluate(async () => {
  const appM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const authM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  const f = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const stamp = Math.random().toString(36).slice(2, 8);
  const users = {};
  window.T = {
    stamp, users, f,
    async mk(name, { google = true } = {}) {
      const app = appM.initializeApp({ apiKey: 'fake-key', projectId: 'demo-ohmygoal', appId: '1:1:web:1', authDomain: 'demo-ohmygoal.firebaseapp.com' }, name + stamp + Math.random());
      const auth = authM.getAuth(app), db = f.getFirestore(app), fns = fnM.getFunctions(app, 'asia-south1');
      authM.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      f.connectFirestoreEmulator(db, '127.0.0.1', 8080);
      fnM.connectFunctionsEmulator(fns, '127.0.0.1', 5001);
      if (google) await authM.signInWithCredential(auth, authM.GoogleAuthProvider.credential(JSON.stringify({ sub: `g-${name}-${stamp}`, email: `${name}${stamp}@example.com`, email_verified: true })));
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
const mk = (name, o) => page.evaluate(([n, o2]) => window.T.mk(n, o2).then(u => u.uid), [name, o || {}]);
const call = (name, fn, data) => page.evaluate(([n, f, d]) => window.T.users[n].call(f, d), [name, fn, data]);
const stamp = await page.evaluate(() => window.T.stamp);

const asha = await mk('asha'), bilal = await mk('bilal'), cara = await mk('cara'), anon = await mk('anon', { google: false }), stranger = await mk('stranger');
// a room document needs "created" as a number (millis) and users as a list: write it with typed fields
const putRoom = (id, a, b, created) => fetch(FS_URL + `${base}/public/data/rooms/${id}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { users: { arrayValue: { values: [{ stringValue: a }, { stringValue: b }] } }, mode: { stringValue: 'text' }, created: { integerValue: String(created) } } }) });
const rid = k => `gift${stamp}${k}`.padEnd(12, 'x').slice(0, 30);
const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const st0 = (await read(`${base}/private/data/stats/${day}`)) || {};

await putRoom(rid('ab'), asha, bilal, Date.now());
await putRoom(rid('ac'), asha, cara, Date.now());
await putRoom(rid('old'), asha, bilal, Date.now() - 3 * 3600000);
await putRoom(rid('xx'), stranger, cara, Date.now());

// ---- 1. the basics
await wallet(asha, 300, 100);          // 300 coins, of which 100 were bought
await wallet(bilal, 5, 0);
const g1 = await call('asha', 'giftCoins', { to: bilal, amount: 100, roomId: rid('ab') });
const wa = await read(`${base}/private/data/wallet/${asha}`), wb = await read(`${base}/private/data/wallet/${bilal}`);
step('1a. Asha gifts 100 bought coins: she pays 100, Bilal receives 70, the platform keeps 30', g1.ok?.recipient === 70 && g1.ok.platform === 30 && wa.coins === 200 && wb.coins === 75, JSON.stringify([g1.ok, wa, wb]));
step('1b. what Asha can still gift went down by 100, and Bilal’s received coins are not giftable', wa.bought === 0 && !(wb.bought > 0), JSON.stringify([wa, wb]));
const w2 = await call('bilal', 'getWallet', {});
step('1c. the wallet screen data: Bilal has 75 coins, none giftable', w2.ok?.coins === 75 && w2.ok.giftable === 0, JSON.stringify(w2.ok));
const g2 = await call('bilal', 'giftCoins', { to: asha, amount: 20, roomId: rid('ab') });
step('1d. received coins cannot be sent on (no chains)', g2.err === 'functions/failed-precondition' && /bought/.test(g2.msg), g2.msg);
const g3 = await call('asha', 'giftCoins', { to: bilal, amount: 50, roomId: rid('ab') });
step('1e. free coins are not giftable: with 200 coins and none bought, a gift is refused', g3.err === 'functions/failed-precondition' && /bought/.test(g3.msg), g3.msg);

// ---- 2. only bought coins; limits on size
await wallet(asha, 700, 600);
const small = await call('asha', 'giftCoins', { to: bilal, amount: 9, roomId: rid('ab') });
const big = await call('asha', 'giftCoins', { to: bilal, amount: 501, roomId: rid('ab') });
const frac = await call('asha', 'giftCoins', { to: bilal, amount: 10.5, roomId: rid('ab') });
const neg = await call('asha', 'giftCoins', { to: bilal, amount: -100, roomId: rid('ab') });
const str = await call('asha', 'giftCoins', { to: bilal, amount: '100', roomId: rid('ab') });
step('2a. below 10, above 500, fractions, negatives and text amounts are all refused', [small, big, frac, neg, str].every(r => r.err === 'functions/invalid-argument'), JSON.stringify([small.err, big.err, frac.err, neg.err, str.err]));
const w0 = await read(`${base}/private/data/wallet/${asha}`);
step('2b. the refused attempts cost nothing', w0.coins === 700 && w0.bought === 600);
const odd = await call('asha', 'giftCoins', { to: bilal, amount: 33, roomId: rid('ab') });
step('2c. an odd amount rounds the recipient down: 33 → 23 and 10 for the platform', odd.ok?.recipient === 23 && odd.ok.platform === 10, JSON.stringify(odd.ok));

// ---- 3. who you can gift
const me = await call('asha', 'giftCoins', { to: asha, amount: 10, roomId: rid('ab') });
const notMember = await call('asha', 'giftCoins', { to: stranger, amount: 10, roomId: rid('ab') });
const otherRoom = await call('asha', 'giftCoins', { to: cara, amount: 10, roomId: rid('xx') });
const noRoom = await call('asha', 'giftCoins', { to: bilal, amount: 10, roomId: rid('nothere') });
const oldRoom = await call('asha', 'giftCoins', { to: bilal, amount: 10, roomId: rid('old') });
const noCtx = await call('asha', 'giftCoins', { to: bilal, amount: 10 });
const bothCtx = await call('asha', 'giftCoins', { to: bilal, amount: 10, roomId: rid('ab'), sid: 'abcdefghijkl' });
step('3a. you cannot gift yourself, a stranger, a room you are not in, an unknown or an old chat, or without saying where', me.err === 'functions/invalid-argument' && notMember.err === 'functions/permission-denied' && otherRoom.err === 'functions/permission-denied' && noRoom.err === 'functions/permission-denied' && oldRoom.err === 'functions/failed-precondition' && noCtx.err === 'functions/invalid-argument' && bothCtx.err === 'functions/invalid-argument', JSON.stringify([me.err, notMember.err, otherRoom.err, noRoom.err, oldRoom.err, noCtx.err, bothCtx.err]));
const anonSend = await call('anon', 'giftCoins', { to: bilal, amount: 10, roomId: rid('ab') });
step('3b. an anonymous account cannot send', anonSend.err === 'functions/failed-precondition');
await putRoom(rid('aa'), asha, anon, Date.now());
const toAnon = await call('asha', 'giftCoins', { to: anon, amount: 10, roomId: rid('aa') });
const wAfter = await read(`${base}/private/data/wallet/${asha}`);
step('3c. a chat partner without a Google account cannot receive, and nothing moves', toAnon.err === 'functions/failed-precondition' && /Google/.test(toAnon.msg) && wAfter.coins === 700 - 33, JSON.stringify([toAnon.err, wAfter]));

// ---- 4. daily and hourly limits
await wallet(cara, 5000, 5000); await wallet(bilal, 0, 0);
await put(`${base}/private/data/coinGiftLimits/${cara}`, { day: 'x' });   // a clean day for Cara
await putRoom(rid('cb'), cara, bilal, Date.now());
let sent = 0, lastErr = null;
for (let i = 0; i < 3; i++) { const r = await call('cara', 'giftCoins', { to: bilal, amount: 400, roomId: rid('cb') }); if (r.ok) sent += 400; else { lastErr = r; break; } }
step('4a. the daily limit is 1,000 coins: 400 + 400 go through, the third 400 is refused and says how many are left', sent === 800 && lastErr?.err === 'functions/resource-exhausted' && /200 left/.test(lastErr.msg), JSON.stringify([sent, lastErr?.msg]));
const rest = await call('cara', 'giftCoins', { to: bilal, amount: 200, roomId: rid('cb') });
const over = await call('cara', 'giftCoins', { to: bilal, amount: 10, roomId: rid('cb') });
step('4b. the last 200 fit exactly; after that even 10 coins is refused for the day', rest.ok && over.err === 'functions/resource-exhausted');
await put(`${base}/private/data/coinGiftLimits/${cara}`, { day: 'x' });
await wallet(cara, 5000, 5000);
let count = 0, hourErr = null;
for (let i = 0; i < 22; i++) { const r = await call('cara', 'giftCoins', { to: bilal, amount: 10, roomId: rid('cb') }); if (r.ok) count++; else { hourErr = r; break; } }
step('4c. at most 20 gifts an hour', count === 20 && hourErr?.err === 'functions/resource-exhausted', JSON.stringify([count, hourErr?.err]));

// ---- 5. a recipient cannot hold more than the cap
await wallet(asha, 700, 700); await wallet(bilal, 99990, 0);
await put(`${base}/private/data/coinGiftLimits/${asha}`, { day: 'x' });
const cap = await call('asha', 'giftCoins', { to: bilal, amount: 100, roomId: rid('ab') });
step('5. a recipient who would go over the 100,000-coin limit is refused and the sender keeps the coins', cap.err === 'functions/failed-precondition' && (await read(`${base}/private/data/wallet/${asha}`)).coins === 700);

// ---- 6. bought coins are tracked through buying and spending
await wallet(asha, 100, 100);
const gb = await call('asha', 'getWallet', {});
step('6a. getWallet shows how many coins can be gifted', gb.ok?.giftable === 100);
await wallet(asha, 100, 40);                              // 60 free + 40 bought
await put(`${base}/public/data/rooms/${rid('ab')}`, { mode: 'text' });
await putRoom(rid('ab'), asha, bilal, Date.now());
await call('asha', 'sendGift', { roomId: rid('ab'), gift: 'rocket' });       // 20 coins, paid from the free ones first
const ws = await read(`${base}/private/data/wallet/${asha}`);
step('6b. spending a 20-coin gift uses free coins first: coins 80, bought stays 40', ws.coins === 80 && ws.bought === 40, JSON.stringify(ws));

// ---- 6c. inside a live session: both people must be in the room, right now
const sid = rid('live').slice(0, 20);
const live = (ts) => ({ nick: 'x', ts });
const putGroup = (id, fields) => fetch(FS_URL + `${base}/public/data/groups/${id}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
await putGroup(sid, { live: { booleanValue: true }, status: { stringValue: 'live' }, hostUid: { stringValue: bilal }, title: { stringValue: 'Test' }, created: { integerValue: String(Date.now()) } });
const member = (u, nick, ts) => fetch(FS_URL + `${base}/public/data/groups/${sid}/members/${u}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { nick: { stringValue: nick }, ts: { integerValue: String(ts) } } }) });
await member(asha, 'Asha', Date.now()); await member(bilal, 'Bilal', Date.now()); await member(stranger, 'Stranger', Date.now() - 5 * 60000);   // the stranger left five minutes ago
await wallet(asha, 300, 300); await wallet(bilal, 0, 0); await wallet(stranger, 0, 0);
await put(`${base}/private/data/coinGiftLimits/${asha}`, { day: 'x' });
const lg = await call('asha', 'giftCoins', { to: bilal, amount: 100, sid });
const lw = await read(`${base}/private/data/wallet/${bilal}`);
step('6c. in a live session a gift reaches the other person in the same session (70 of 100)', lg.ok?.recipient === 70 && lw.coins === 70, JSON.stringify([lg.ok, lw]));
const lstale = await call('asha', 'giftCoins', { to: stranger, amount: 10, sid });
const loutside = await call('asha', 'giftCoins', { to: cara, amount: 10, sid });
step('6d. someone who left the session (or never joined it) cannot be gifted through it', lstale.err === 'functions/permission-denied' && loutside.err === 'functions/permission-denied', JSON.stringify([lstale.err, loutside.err]));
const events = await page.evaluate(async ([s]) => { const T = window.T, u = T.users.asha; const snap = await T.f.getDocs(T.f.collection(u.db, ...T.base, 'groups', s, 'events')); return snap.docs.map(d => d.data()); }, [sid]);
step('6e. the room gets a small notice with the amount received and both nicknames, and no user ids', events.length === 1 && events[0].kind === 'coins' && events[0].amount === 70 && events[0].nick === 'Asha' && events[0].toNick === 'Bilal' && !JSON.stringify(events[0]).includes(asha), JSON.stringify(events));
await putGroup(sid, { live: { booleanValue: true }, status: { stringValue: 'ended' }, hostUid: { stringValue: bilal }, created: { integerValue: String(Date.now()) } });
const lend = await call('asha', 'giftCoins', { to: bilal, amount: 10, sid });
step('6f. once the session has ended, gifting through it is refused', lend.err === 'functions/permission-denied');

// ---- 7. clients cannot touch any of it
const sec = await page.evaluate(async ([a, b]) => {
  const T = window.T, f = T.f, u = T.users.asha;
  const D = (...p) => f.doc(u.db, ...p);
  const priv = ['artifacts', 'anon-connect', 'private', 'data'];
  const out = {};
  out.readLog = await T.code(f.getDocs(f.collection(u.db, ...priv, 'coinGiftLog')));
  out.readLimits = await T.code(f.getDoc(D(...priv, 'coinGiftLimits', a)));
  out.readWallet = await T.code(f.getDoc(D(...priv, 'wallet', a)));
  out.writeBought = await T.code(f.setDoc(D(...priv, 'wallet', a), { coins: 99999, bought: 99999 }));
  out.writeOther = await T.code(f.setDoc(D(...priv, 'wallet', b), { coins: 99999 }));
  return out;
}, [asha, bilal]);
step('7. a browser cannot read or write wallets, limits or the gift log', Object.values(sec).every(v => v === 'permission-denied'), JSON.stringify(sec));

// ---- 8. the log and the counters
const log = [];
for (let token = ''; ;) {
  const r = await (await fetch(FS_URL + `${base}/private/data/coinGiftLog?pageSize=300` + (token ? `&pageToken=${token}` : ''), { headers: { Authorization: 'Bearer owner' } })).json();
  for (const d of r.documents || []) log.push(Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, val(v)])));
  token = r.nextPageToken || ''; if (!token) break;
}
const mine = log.filter(l => l.from === asha && l.to === bilal && l.context === 'chat');
step('8a. every gift is in the private log with the full split', mine.some(l => l.amount === 100 && l.recipient === 70 && l.platform === 30) && mine.some(l => l.amount === 33 && l.recipient === 23 && l.platform === 10), JSON.stringify(mine.slice(-2)));
const st1 = await read(`${base}/private/data/stats/${day}`);
const d = k => (st1?.[k] || 0) - (st0[k] || 0);
step('8b. the admin counters: gifts, coins sent and the platform share', d('coinGifts') >= 4 && d('coinGiftCoins') >= 100 + 33 + 1000 + 200 && d('platformShareCoins') >= 30 + 10, JSON.stringify([d('coinGifts'), d('coinGiftCoins'), d('platformShareCoins')]));

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
