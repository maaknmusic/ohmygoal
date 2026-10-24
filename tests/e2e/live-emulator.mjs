// Live sessions against the emulators (rules + Cloud Functions): applying and approval, the 49-coin start fee, public and private sessions,
// the 200-coin private seat, gifts to the host, the 70/30 split, kicks, ending, payouts, suspension and what clients can never touch.
// Needs: auth/firestore/functions emulators (ADMIN_EMAILS includes boss@example.com) and a static server on :8765.
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
const seedCoins = (uid, coins) => fetch(FS_URL + `${base}/private/data/wallet/${uid}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { coins: { integerValue: String(coins) } } }) });
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

const dayKey = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const st0 = (await read(`${base}/private/data/stats/${dayKey}`)) || {};
const boss = await page.evaluate(() => window.T.mk('boss', { email: 'boss@example.com' }).then(u => u.uid));
const hostUid = await mk('host'), g1 = await mk('g1'), g2 = await mk('g2'), g3 = await mk('g3'), g4 = await mk('g4'), anon = await mk('anon', { google: false });
const stamp = await P(() => window.T.stamp);

// ------------------------------------------------------------------------------------------------ 1. who can go live
const early = await call('anon', 'startLive', { title: 'Hindi songs', mode: 'voice', kind: 'public' });
const na = await call('g1', 'adminHosts', { action: 'list' });
step('1a. there is no application: but anonymous accounts cannot host, and the admin functions refuse non-admins', early.err === 'functions/failed-precondition' && na.err === 'functions/permission-denied', JSON.stringify([early.err, na.err]));
const my = await call('host', 'myHost', {});
step('1b. the host screen data shows the fixed numbers, an active status, and that the first session is free', my.ok?.status === 'active' && my.ok.startFee === 49 && my.ok.privateFee === 200 && my.ok.sharePct === 70 && my.ok.coins === 0 && my.ok.firstFree === true && my.ok.minPayoutCoins === 300, JSON.stringify(my.ok));
const t0 = await call('host', 'startLive', { name: 'Riya Live', title: 'Warm up session', mode: 'voice', kind: 'public' });
const w00 = await read(`${base}/private/data/wallet/${hostUid}`);
step('1c. the first session is free: it opens with no coins at all, and takes nothing', Boolean(t0.ok?.sid) && t0.ok.fee === 0 && (w00?.coins ?? 0) === 0, JSON.stringify(t0));
const my1 = await call('host', 'myHost', {});
const t0b = await call('host', 'startLive', { title: 'Second session', mode: 'voice', kind: 'public' });
step('1c2. from the second session on it costs 49 coins, and with none the host is told so', my1.ok.firstFree === false && t0b.err === 'functions/failed-precondition' && /49 coins/.test(t0b.msg), t0b.msg);
const u0 = (await call('boss', 'adminHosts', { action: 'list' })).ok.usage.today;
const approveTry = await call('boss', 'adminHosts', { action: 'decide', uid: hostUid, decision: 'approve' });
step('1d. approval no longer exists', approveTry.err === 'functions/invalid-argument');

// ------------------------------------------------------------------------------------------------ 3. going live
await seedCoins(hostUid, 1000);
const t2 = await call('host', 'startLive', { title: 'call me 9876543210', mode: 'voice', kind: 'public' });
const t3 = await call('host', 'startLive', { title: 'Hindi songs', mode: 'hologram', kind: 'public' });
const t4 = await call('host', 'startLive', { title: 'Hindi songs', mode: 'voice', kind: 'secret' });
const t5 = await call('host', 'startLive', { title: 'Hindi songs', mode: 'video', kind: 'private', maxGuests: 4 });
const t6 = await call('host', 'startLive', { title: 'Hindi songs', mode: 'video', kind: 'private', maxGuests: 0 });
step('3b. a title with a phone number, an unknown mode or kind, and a private session with too many or no guests are refused', [t2, t3, t4, t5, t6].every(r => r.err === 'functions/invalid-argument'), JSON.stringify([t2.err, t3.err, t4.err, t5.err, t6.err]));
const w0 = await read(`${base}/private/data/wallet/${hostUid}`);
step('3c. the refused attempts cost nothing', w0.coins === 1000);
const pub = await call('host', 'startLive', { name: 'Riya Live', title: 'Hindi songs night', mode: 'video', kind: 'public' });
const sid = pub.ok?.sid;
const w1 = await read(`${base}/private/data/wallet/${hostUid}`);
step('3d. a public session opens, costs exactly 49 coins, and holds the host plus 3 guests on video', Boolean(sid) && w1.coins === 951 && pub.ok.cap === 4, JSON.stringify(pub.ok));
const gdoc = await read(`${base}/public/data/groups/${sid}`);
const hmem = await read(`${base}/public/data/groups/${sid}/members/${hostUid}`);
step('3e. the session document says who hosts it; the host is its first member with a host mark set by the server', gdoc?.hostUid === hostUid && gdoc.kind === 'public' && gdoc.fee === 0 && gdoc.live === true && hmem?.host === true, JSON.stringify(gdoc));
const lv = await call('g1', 'listLive', {});
step('3f. everyone can see it in the live list, with no host user id or private data', lv.ok?.sessions.some(s => s.sid === sid && s.title === 'Hindi songs night' && s.kind === 'public' && s.count === 1 && s.hostName === 'Riya Live') && !JSON.stringify(lv.ok).includes(hostUid), JSON.stringify(lv.ok?.sessions[0]));

// ------------------------------------------------------------------------------------------------ 4. joining a public session
const j0 = await call('g1', 'joinLive', { sid: 'doesnotexist12345' });
const j1 = await call('g1', 'joinLive', { sid, nick: 'Asha' });
const j2 = await call('g2', 'joinLive', { sid, nick: '<b>Bilal</b>' });
const j3 = await call('g3', 'joinLive', { sid, nick: 'Chen' });
const j4 = await call('g4', 'joinLive', { sid, nick: 'Dev' });
step('4a. an unknown session is refused; three guests fit beside the host; the fifth person on a video session does not', j0.err === 'functions/not-found' && j1.ok && j2.ok && j3.ok && j4.err === 'functions/resource-exhausted', JSON.stringify([j0.err, j1.ok?.gid, j2.ok?.gid, j3.ok?.gid, j4.err]));
const m2 = await read(`${base}/public/data/groups/${sid}/members/${g2}`);
step('4b. a public session is free to join; nicknames are stored as plain text (no host mark)', j1.ok.charged === 0 && m2?.nick === '<b>Bilal</b>' && m2.host === undefined);
const g1w = await read(`${base}/private/data/wallet/${g1}`);
step('4c. nothing was taken from the guests', g1w === null || g1w.coins === undefined || g1w.coins === 0);
const j5 = await call('g1', 'joinLive', { sid, nick: 'Asha' });
step('4d. joining again (a reload) takes no second seat', Boolean(j5.ok));

// ------------------------------------------------------------------------------------------------ 5. gifts
await seedCoins(g1, 100);
const gf0 = await call('g1', 'sendLiveGift', { sid, gift: 'sword' });
const gf1 = await call('g1', 'sendLiveGift', { sid, gift: 'rose' });
const hw1 = await read(`${base}/private/data/hostWallet/${hostUid}`);
step('5a. an unknown gift is refused; a rose costs 5 coins and the host earns 3 (70% rounded down)', gf0.err === 'functions/invalid-argument' && gf1.ok?.coins === 95 && hw1?.coins === 3 && hw1.lifetime === 3, JSON.stringify([gf1.ok, hw1]));
const gf2 = await call('g1', 'sendLiveGift', { sid, gift: 'fireworks' });
const hw2 = await read(`${base}/private/data/hostWallet/${hostUid}`);
step('5b. fireworks: 50 coins, the host earns 35, the platform keeps 15', gf2.ok?.coins === 45 && hw2.coins === 38, JSON.stringify(hw2));
const led = await list(`${base}/private/data/hostLedger`);
const lf = led.find(l => l.gift === 'fireworks' && l.sid === sid);
step('5c. every credit is in the ledger with the whole split', lf?.total === 50 && lf.hostShare === 35 && lf.platformShare === 15 && lf.type === 'gift' && lf.hostUid === hostUid && led.filter(l => l.sid === sid).length === 2, JSON.stringify([lf, led.length, led.filter(l => l.sid === sid).length]));
const ev = await page.evaluate(async ([sid2]) => { const T = window.T; const u = T.users.g1; const snap = await T.f.getDocs(T.f.collection(u.db, ...T.base, 'groups', sid2, 'events')); return snap.docs.map(d => d.data()); }, [sid]);
step('5d. the room can read the gift events (who and what) to show an animation', ev.length === 2 && ev.some(e => e.gift === 'rose' && e.nick === 'Asha') && ev.every(e => e.kind === 'gift'), JSON.stringify(ev));
const gf3 = await call('host', 'sendLiveGift', { sid, gift: 'rose' });
const gf4 = await call('g2', 'sendLiveGift', { sid, gift: 'rose' });
step('5e. the host cannot gift themselves; a guest with no coins is told they need more', gf3.err === 'functions/invalid-argument' && gf4.err === 'functions/failed-precondition' && /coins/.test(gf4.msg));
await seedCoins(g3, 100000);
let capped = null;
for (let i = 0; i < 31; i++) { const r = await call('g3', 'sendLiveGift', { sid, gift: 'rose' }); if (r.err) { capped = { i, err: r.err }; break; } }
step('5f. gifts are limited to 30 an hour per person (the same cap as chat gifts)', capped?.i === 30 && capped.err === 'functions/resource-exhausted', JSON.stringify(capped));
const anonGift = await call('anon', 'sendLiveGift', { sid, gift: 'rose' });
step('5g. an anonymous (not Google) account cannot send gifts', anonGift.err === 'functions/failed-precondition');
const gifts3 = (await read(`${base}/private/data/hostWallet/${hostUid}`)).coins;
step('5h. the host balance is exactly the sum of 70% shares: 3 + 35 + 30 roses × 3', gifts3 === 3 + 35 + 90, String(gifts3));

// ------------------------------------------------------------------------------------------------ 6. private sessions
await seedCoins(g1, 500); await seedCoins(g2, 100); await seedCoins(g4, 700); await seedHostCoins(hostUid, 0);
const prv = await call('host', 'startLive', { title: 'One to one chat', mode: 'video', kind: 'private', maxGuests: 2 });
const psid = prv.ok?.sid;
const old = await read(`${base}/public/data/groups/${sid}`);
step('6a. starting another session closes the earlier one; a private session shows its fee and size', Boolean(psid) && old.status === 'ended' && prv.ok.maxGuests === 2, JSON.stringify(prv.ok));
const pj1 = await call('g1', 'joinLive', { sid: psid, nick: 'Asha' });
const w2 = await read(`${base}/private/data/wallet/${g1}`);
const hw3 = await read(`${base}/private/data/hostWallet/${hostUid}`);
step('6b. a guest pays 200 coins to enter: 140 to the host, 60 to the platform', pj1.ok?.charged === 200 && w2.coins === 300 && hw3.coins === 140, JSON.stringify([pj1.ok, w2, hw3]));
const pj1b = await call('g1', 'joinLive', { sid: psid, nick: 'Asha' });
const w2b = await read(`${base}/private/data/wallet/${g1}`);
step('6c. re-joining the same private session is free (reload, dropped connection)', pj1b.ok?.charged === 0 && w2b.coins === 300 && (await read(`${base}/private/data/hostWallet/${hostUid}`)).coins === 140);
const pj2 = await call('g2', 'joinLive', { sid: psid, nick: 'Bilal' });
const w3 = await read(`${base}/private/data/wallet/${g2}`);
step('6d. a guest with too few coins is refused and keeps what they have', pj2.err === 'functions/failed-precondition' && /200 coins/.test(pj2.msg) && w3.coins === 100, pj2.msg);
const pj4 = await call('g4', 'joinLive', { sid: psid, nick: 'Dev' });
await seedCoins(g3, 900);
const pj3 = await call('g3', 'joinLive', { sid: psid, nick: 'Chen' });
const w4 = await read(`${base}/private/data/wallet/${g3}`);
step('6e. two guests fit (as set); the third is refused before any coins move', pj4.ok?.charged === 200 && pj3.err === 'functions/resource-exhausted' && w4.coins === 900, JSON.stringify([pj3.err, w4]));
const hw4 = await read(`${base}/private/data/hostWallet/${hostUid}`);
step('6f. the host earned 140 + 140 = 280 from two private seats', hw4.coins === 280 && hw4.lifetime === 280);
const outsider = await call('g3', 'sendLiveGift', { sid: psid, gift: 'rose' });
const insider = await call('g1', 'sendLiveGift', { sid: psid, gift: 'rose' });
step('6g. only people in a private session can send it gifts', outsider.err === 'functions/permission-denied' && insider.ok, JSON.stringify([outsider.err, insider.ok]));
const kx = await call('g1', 'kickLive', { sid: psid, uid: g4 });
const k1 = await call('host', 'kickLive', { sid: psid, uid: g4 });
const mk4 = await read(`${base}/public/data/groups/${psid}/members/${g4}`);
const rj = await call('g4', 'joinLive', { sid: psid, nick: 'Dev' });
step('6h. only the host can remove someone; a removed guest is out and cannot come back (their coins stay spent)', kx.err === 'functions/permission-denied' && k1.ok && mk4 === null && rj.err === 'functions/permission-denied');

// ------------------------------------------------------------------------------------------------ 7. ending
const e1 = await call('g1', 'endLive', { sid: psid });
const e2 = await call('host', 'endLive', { sid: psid });
const afterEnd = await call('g3', 'joinLive', { sid: psid });
const giftEnd = await call('g1', 'sendLiveGift', { sid: psid, gift: 'rose' });
step('7a. only the host can end a session; after that nobody can join or send gifts', e1.err === 'functions/permission-denied' && e2.ok && afterEnd.err && giftEnd.err, JSON.stringify([afterEnd.err, giftEnd.err]));
const lv2 = await call('g1', 'listLive', {});
step('7b. an ended session leaves the live list', !lv2.ok.sessions.some(s => s.sid === psid || s.sid === sid));

// ------------------------------------------------------------------------------------------------ 8. payouts
await seedHostCoins(hostUid, 299);
const p0 = await call('host', 'requestPayout', { details: 'riya@upi' });
step('8a. a payout below 300 earned coins is refused and says why', p0.err === 'functions/failed-precondition' && /300/.test(p0.msg), p0.msg);
await seedHostCoins(hostUid, 800);
const p1 = await call('host', 'requestPayout', { details: 'x' });
const p2 = await call('host', 'requestPayout', { details: 'riya@upi (Riya Sharma)' });
const hw5 = await read(`${base}/private/data/hostWallet/${hostUid}`);
step('8b. a payout needs payment details; a valid request moves all earned coins to "pending" and shows the rupee value', p1.err === 'functions/invalid-argument' && p2.ok?.coins === 800 && p2.ok.paise === 800 * 75 && hw5.coins === 0 && hw5.pending === 800, JSON.stringify([p2.ok, hw5]));
const my2 = await call('host', 'myHost', {});
step('8c. the host dashboard shows the waiting payout', my2.ok.payouts[0]?.status === 'requested' && my2.ok.pendingCoins === 800 && my2.ok.coins === 0);
const adm = await call('boss', 'adminHosts', { action: 'list' });
const pay = adm.ok.payouts.find(p => p.id === p2.ok.id);
step('8d. the admin sees the payout with the host’s payment details and the amount in rupees', pay?.details === 'riya@upi (Riya Sharma)' && pay.paise === 60000 && pay.status === 'requested');
const pp0 = await call('boss', 'adminHosts', { action: 'payoutPaid', id: pay.id, reference: '' });
const pp1 = await call('g1', 'adminHosts', { action: 'payoutPaid', id: pay.id, reference: 'UPI123' });
const pp2 = await call('boss', 'adminHosts', { action: 'payoutPaid', id: pay.id, reference: 'UPI1234567890' });
const pp3 = await call('boss', 'adminHosts', { action: 'payoutPaid', id: pay.id, reference: 'UPI1234567890' });
const hw6 = await read(`${base}/private/data/hostWallet/${hostUid}`);
step('8e. marking it paid needs a payment reference and an admin; it works once; the host balance shows it as paid out', pp0.err === 'functions/invalid-argument' && pp1.err === 'functions/permission-denied' && pp2.ok && pp3.err === 'functions/failed-precondition' && hw6.pending === 0 && hw6.paidOut === 800, JSON.stringify(hw6));
await seedHostCoins(hostUid, 700);
const q1 = await call('host', 'requestPayout', { details: 'riya@upi' });
const rj1 = await call('boss', 'adminHosts', { action: 'payoutReject', id: q1.ok.id, note: 'name mismatch' });
const hw7 = await read(`${base}/private/data/hostWallet/${hostUid}`);
step('8f. a rejected payout gives the coins back to the host', rj1.ok && hw7.coins === 700 && hw7.pending === 0);

// ------------------------------------------------------------------------------------------------ 9. suspending a host
await seedCoins(hostUid, 500);
const live3 = await call('host', 'startLive', { title: 'Late night talk', mode: 'voice', kind: 'public' });
const sus = await call('boss', 'adminHosts', { action: 'decide', uid: hostUid, decision: 'suspend', note: 'complaints' });
const gone = await read(`${base}/public/data/groups/${live3.ok.sid}`);
const blocked = await call('host', 'startLive', { title: 'Late night talk', mode: 'voice', kind: 'public' });
step('9a. suspending a host closes their live session and stops them going live', sus.ok && gone.status === 'ended' && blocked.err === 'functions/permission-denied');
const back = await call('boss', 'adminHosts', { action: 'decide', uid: hostUid, decision: 'reinstate' });
const again = await call('host', 'startLive', { title: 'Late night talk', mode: 'voice', kind: 'public' });
step('9b. reinstating lets them host again', back.ok && again.ok?.sid);
const logs = (await list(`${base}/private/data/adminLog`)).map(l => l.what);
step('9c. every decision and payout is in the admin log', ['host-suspend', 'host-reinstate', 'payoutPaid', 'payoutReject'].every(k => logs.includes(k)), logs.join(','));

// ------------------------------------------------------------------------------------------------ 9d. what the admin sees
const adm2 = (await call('boss', 'adminHosts', { action: 'list' })).ok;
const hrow = adm2.hosts.find(x => x.uid === hostUid);
step('9d. the admin list shows the host with name, status and earnings, and what is live now', hrow?.name === 'Riya Live' && hrow.status === 'active' && hrow.coins === 700 && adm2.live.some(x => x.sid === again.ok.sid && x.hostName === 'Riya Live') && adm2.liveNow >= 1, JSON.stringify(hrow));
const u1 = adm2.usage.today;
const dd = k => u1[k] - u0[k];
step('9e. the usage numbers for the admin: starts, fees, private seats, gifts, the 70/30 split, sessions ended', dd('liveStarts') === 5 && dd('liveFreeStarts') === 1 && dd('liveFeeCoins') === 196 && dd('privateJoins') === 2 && dd('privateCoins') === 400 && dd('liveGifts') === 33 && dd('hostShareCoins') === 280 + 131 && dd('platformShareCoins') === 120 + 79 && dd('liveEnded') === 4 && dd('liveMinutes') >= 0 && dd('liveParticipantMinutes') >= 0, JSON.stringify(Object.fromEntries(Object.keys(u1).map(k => [k, dd(k)]))));
const endNow = await call('boss', 'adminHosts', { action: 'end', sid: again.ok.sid });
const ended = await read(`${base}/public/data/groups/${again.ok.sid}`);
step('9f. an admin can end any live session', endNow.ok && ended.status === 'ended' && ended.endReason === 'admin');

// ------------------------------------------------------------------------------------------------ 10. what a browser can never do
const sec = await page.evaluate(async ([sid2, host, g1id]) => {
  const T = window.T, f = T.f, u = T.users.g1;
  const D = (...p) => f.doc(u.db, ...p);
  const priv = ['artifacts', 'anon-connect', 'private', 'data'];
  const out = {};
  out.readHostWallet = await T.code(f.getDoc(D(...priv, 'hostWallet', host)));
  out.readHosts = await T.code(f.getDoc(D(...priv, 'hosts', host)));
  out.readPayouts = await T.code(f.getDocs(f.collection(u.db, ...priv, 'payouts')));
  out.readLedger = await T.code(f.getDocs(f.collection(u.db, ...priv, 'hostLedger')));
  out.readPaid = await T.code(f.getDoc(D(...priv, 'livePaid', `${sid2}_${g1id}`)));
  out.writeWallet = await T.code(f.setDoc(D(...priv, 'hostWallet', g1id), { coins: 999999 }));
  out.writeSession = await T.code(f.setDoc(D(...T.base, 'groups', sid2), { title: 'hacked', live: true, status: 'live' }));
  out.editSession = await T.code(f.updateDoc(D(...T.base, 'groups', sid2), { fee: 0, hostUid: g1id }));
  out.fakeMember = await T.code(f.setDoc(D(...T.base, 'groups', sid2, 'members', g1id), { nick: 'x', ts: Date.now(), host: true }));
  out.fakeGift = await T.code(f.addDoc(f.collection(u.db, ...T.base, 'groups', sid2, 'events'), { kind: 'gift', gift: 'fireworks', price: 50, nick: 'Asha', at: Date.now() }));
  out.deleteEvent = await T.code(f.deleteDoc(D(...T.base, 'groups', sid2, 'events', 'x')));
  out.selfHostMark = await T.code(f.updateDoc(D(...T.base, 'groups', sid2, 'members', g1id), { host: true }));
  return out;
}, [again.ok.sid, hostUid, g1]);
step('10. a browser cannot read host money, payouts or paid markers, and cannot write wallets, sessions, members, gifts or host marks', Object.values(sec).every(v => v === 'permission-denied'), JSON.stringify(sec));

// ------------------------------------------------------------------------------------------------ 11. numbers for the dashboard
const st = await read(`${base}/private/data/stats/${dayKey}`);
const d = k => (st?.[k] || 0) - (st0[k] || 0);
step('11. the daily counters record starts, start fees, private seats and gifts', d('liveStarts') === 4 && d('liveFeeCoins') === 196 && d('privateJoins') === 2 && d('privateCoins') === 400 && d('liveGifts') === 33 && d('liveGiftCoins') === 5 + 50 + 150 + 5, JSON.stringify(['liveStarts', 'liveFeeCoins', 'privateJoins', 'privateCoins', 'liveGifts', 'liveGiftCoins'].map(k => [k, d(k)])));

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
