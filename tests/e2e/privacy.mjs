// Attacker-style privacy tests against the Firestore rules + Cloud Functions (emulator).
// A normal signed-in "attacker" account tries to read, list and write everything that holds other people's data.
// It never wipes the database (shared with other test runs).
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`);
const browser = await chromium.launch();
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };

const ctx = await browser.newContext({ serviceWorkers: 'block' });
await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
await ctx.route(/jsdelivr|fonts\.g|country\.is/, r => r.abort());
await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': '198.51.100.23' } }));
const page = await ctx.newPage();
await page.goto('http://localhost:8765/legal.html'); // any page of ours: we only need a same-origin context

/** Runs `fn` in the page with two fresh anonymous users: victim (V) and attacker (X). */
const run = fn => page.evaluate(async src => {
  const appM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const authM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  const f = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const mk = async name => {
    const app = appM.initializeApp({ apiKey: 'fake-key', projectId: 'demo-ohmygoal', appId: '1:1:web:1', authDomain: 'demo-ohmygoal.firebaseapp.com' }, name + Math.random());
    const auth = authM.getAuth(app), db = f.getFirestore(app), fns = fnM.getFunctions(app, 'asia-south1');
    authM.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    f.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    fnM.connectFunctionsEmulator(fns, '127.0.0.1', 5001);
    await authM.signInAnonymously(auth);
    const call = async (n, d) => { try { return { ok: (await fnM.httpsCallable(fns, n)(d)).data }; } catch (e) { return { err: e.code, msg: e.message }; } };
    return { auth, db, fns, call, uid: auth.currentUser.uid };
  };
  const V = await mk('victim'), X = await mk('attacker');
  const base = ['artifacts', 'anon-connect', 'public', 'data'];
  const priv = ['artifacts', 'anon-connect', 'private', 'data'];
  const code = async p => { try { await p; return 'ALLOWED'; } catch (e) { return e.code || String(e); } };
  const tools = { f, V, X, base, priv, code, doc: (u, path) => f.doc(u.db, ...path), col: (u, path) => f.collection(u.db, ...path) };
  return await (eval(src))(tools);
}, fn.toString());

// Victim legitimately sets up data: access pass, queue entry, presence, room with a friend-less partner, a report, signals.
const setup = await run(async ({ f, V, X, base, priv, code, doc, col }) => {
  const out = {};
  out.vAccess = (await V.call('checkAccess', { fp: 'f'.repeat(32) })).ok?.allowed;
  out.xAccess = (await X.call('checkAccess', { fp: 'e'.repeat(32) })).ok?.allowed;
  const roomId = 'privacyroom' + Math.random().toString(36).slice(2, 8);
  await f.setDoc(doc(V, [...base, 'queue', V.uid]), { mode: 'text', interests: ['secretinterest'], blocked: ['someone'], gender: 'female', country: 'IN', ts: Date.now() });
  await f.setDoc(doc(V, [...base, 'presence', V.uid]), { ts: Date.now(), status: 'online' });
  // Rooms can only be created through matchmaking now, so the fixture is written with the admin API (as the claim batch would).
  const admin = (path, fields) => fetch('http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/' + path.join('/'), { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }).then(r => { if (!r.ok) throw new Error('admin ' + r.status); });
  await admin([...base, 'rooms', roomId], { mode: { stringValue: 'text' }, users: { arrayValue: { values: [{ stringValue: V.uid }, { stringValue: 'third-party-uid' }] } }, created: { integerValue: String(Date.now()) } });
  await admin([...base, 'rooms', roomId, 'signals', 's1'], { from: { stringValue: V.uid }, type: { stringValue: 'candidate' }, data: { stringValue: '{"candidate":"candidate:1 1 udp 1 203.0.113.9 5000 typ srflx"}' } });
  out.roomId = roomId; out.vUid = V.uid; out.xUid = X.uid;
  return out;
});
step('0. fixtures created (both users have access passes)', setup.vAccess === true && setup.xAccess === true, JSON.stringify(setup));

const R = await page.evaluate(async ([vUid, roomId]) => {
  // re-use the exported helper from above is not possible across evaluate calls: rebuild minimal clients
  const appM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const authM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  const f = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const app = appM.initializeApp({ apiKey: 'fake-key', projectId: 'demo-ohmygoal', appId: '1:1:web:1', authDomain: 'demo-ohmygoal.firebaseapp.com' }, 'att' + Math.random());
  const auth = authM.getAuth(app), db = f.getFirestore(app), fns = fnM.getFunctions(app, 'asia-south1');
  authM.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  f.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  fnM.connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  await authM.signInAnonymously(auth);
  const me = auth.currentUser.uid;
  const call = async (n, d) => { try { return { ok: (await fnM.httpsCallable(fns, n)(d)).data }; } catch (e) { return { err: e.code, msg: e.message }; } };
  await call('checkAccess', { fp: 'd'.repeat(32) });
  const base = ['artifacts', 'anon-connect', 'public', 'data'], priv = ['artifacts', 'anon-connect', 'private', 'data'];
  const code = async p => { try { await p; return 'ALLOWED'; } catch (e) { return e.code || String(e); } };
  const get = path => code(f.getDoc(f.doc(db, ...path)));
  const list = path => code(f.getDocs(f.query(f.collection(db, ...path), f.limit(5))));
  const set = (path, data) => code(f.setDoc(f.doc(db, ...path), data));
  const del = path => code(f.deleteDoc(f.doc(db, ...path)));
  const upd = (path, data) => code(f.updateDoc(f.doc(db, ...path), data));
  const out = { me };
  // ---- private tree: nothing is reachable from a client
  for (const c of ['bans', 'clients', 'whitelist', 'unbanRequests', 'counters', 'adminLog', 'likeLog', 'likePairs']) {
    out[`list private/${c}`] = await list([...priv, c]);
    out[`get private/${c}/x`] = await get([...priv, c, 'x']);
    out[`set private/${c}/x`] = await set([...priv, c, 'x'], { a: 1 });
  }
  out['get private/clients/<victim>'] = await get([...priv, 'clients', vUid]);
  // ---- access passes
  out['get access/<victim>'] = await get([...base, 'access', vUid]);
  out['get access/<me> (own is allowed)'] = await get([...base, 'access', me]);
  out['set access/<me>'] = await set([...base, 'access', me], { until: Date.now() + 1e10, videoBanUntil: 0 });
  out['list access'] = await list([...base, 'access']);
  // ---- entitlements, reputation
  out['set entitlements/<me> (self grant premium)'] = await set([...base, 'entitlements', me], { premiumUntil: Date.now() + 1e11, updatedAt: Date.now() });
  out['list entitlements'] = await list([...base, 'entitlements']);
  out['set reputation/<me>'] = await set([...base, 'reputation', me], { likes: 9999 });
  out['list reputation'] = await list([...base, 'reputation']);
  // ---- victim's live data
  out['set queue/<victim>'] = await set([...base, 'queue', vUid], { mode: 'text', ts: Date.now() });
  out['delete queue/<victim>'] = await del([...base, 'queue', vUid]);
  out['update queue/<victim> hijack'] = await upd([...base, 'queue', vUid], { roomId: 'x', partnerId: me });
  out['set presence/<victim>'] = await set([...base, 'presence', vUid], { ts: Date.now(), status: 'online' });
  out['delete presence/<victim>'] = await del([...base, 'presence', vUid]);
  // ---- rooms and signalling (contains partners' network addresses)
  out['get rooms/<victim room>'] = await get([...base, 'rooms', roomId]);
  out['list rooms'] = await list([...base, 'rooms']);
  out['list rooms/<r>/signals'] = await list([...base, 'rooms', roomId, 'signals']);
  out['get rooms/<r>/signals/s1'] = await get([...base, 'rooms', roomId, 'signals', 's1']);
  out['create rooms/<r>/signals'] = await set([...base, 'rooms', roomId, 'signals', 'evil'], { from: me, type: 'bye' });
  out['create room with victim + extra fields'] = await set([...base, 'rooms', 'evilroom1'], { mode: 'text', users: [me, vUid], created: Date.now(), admin: true });
  // ---- friends and reports
  out['list friendships'] = await list([...base, 'friendships']);
  out['get friendships/<victim>_<x>'] = await get([...base, 'friendships', [vUid, me].sort().join('_')]);
  out['create friendship as anonymous (not Google)'] = await set([...base, 'friendships', [vUid, me].sort().join('_')], { users: [vUid, me].sort(), status: 'pending', requestedBy: me, names: { [vUid]: 'a', [me]: 'b' }, createdAt: Date.now() });
  out['list reports'] = await list([...base, 'reports']);
  out['get reports/x'] = await get([...base, 'reports', 'x']);
  out['report a non-partner'] = await set([...base, 'reports', 'rp1'], { reporter: me, reported: vUid, roomId: 'doesnotmatter', reason: 'spam', ts: Date.now() });
  // ---- what the (intentionally readable) queue/presence documents expose to any signed-in user
  const qs = await f.getDocs(f.query(f.collection(db, ...base, 'queue'), f.limit(50)));
  const qkeys = new Set(); qs.forEach(d => Object.keys(d.data()).forEach(k => qkeys.add(k)));
  out.queueFieldsVisible = [...qkeys].sort().join(',');
  const ps = await f.getDocs(f.query(f.collection(db, ...base, 'presence'), f.limit(50)));
  const pkeys = new Set(); ps.forEach(d => Object.keys(d.data()).forEach(k => pkeys.add(k)));
  out.presenceFieldsVisible = [...pkeys].sort().join(',');
  // ---- functions
  out['admin overview as non-admin'] = (await call('admin', { action: 'overview' })).err;
  out['admin ban as non-admin'] = (await call('admin', { action: 'ban', ip: '1.2.3.4', hours: 24 })).err;
  out['reportViolation garbage type'] = (await call('reportViolation', { type: '__proto__' })).err;
  out['requestUnban while not banned'] = (await call('requestUnban', { message: 'please let me in' })).err;
  out['createOrder anonymous'] = (await call('createOrder', { plan: 'month' })).err;
  out['verifyPayment forged'] = (await call('verifyPayment', { orderId: 'order_x', paymentId: 'pay_x', signature: 'deadbeef' })).err;
  return out;
}, [setup.vUid, setup.roomId]);

const denied = k => R[k] === 'permission-denied';
for (const c of ['bans', 'clients', 'whitelist', 'unbanRequests', 'counters', 'adminLog', 'likeLog', 'likePairs']) {
  step(`1. private/${c}: list, get and set are all denied`, denied(`list private/${c}`) && denied(`get private/${c}/x`) && denied(`set private/${c}/x`), `${R[`list private/${c}`]} ${R[`get private/${c}/x`]} ${R[`set private/${c}/x`]}`);
}
step('2a. another user\'s fingerprint/IP record is unreadable', denied('get private/clients/<victim>'));
step('2b. other users\' access passes are unreadable, own pass readable, cannot self-grant or list', denied('get access/<victim>') && R['get access/<me> (own is allowed)'] === 'ALLOWED' && denied('set access/<me>') && denied('list access'));
step('3a. cannot grant yourself Premium or list entitlements', denied('set entitlements/<me> (self grant premium)') && denied('list entitlements'));
step('3b. cannot write or list reputation (like counts)', denied('set reputation/<me>') && denied('list reputation'));
step('4a. cannot overwrite, delete or hijack the victim\'s queue entry', denied('set queue/<victim>') && denied('delete queue/<victim>') && denied('update queue/<victim> hijack'));
step('4b. cannot overwrite or delete the victim\'s presence', denied('set presence/<victim>') && denied('delete presence/<victim>'));
step('5a. rooms and their signalling (network addresses) are unreadable by non-members', denied('get rooms/<victim room>') && denied('list rooms') && denied('list rooms/<r>/signals') && denied('get rooms/<r>/signals/s1'));
step('5b. cannot inject signals into someone else\'s room or create rooms with extra fields', denied('create rooms/<r>/signals') && denied('create room with victim + extra fields'));
step('6a. friendships are private and anonymous accounts cannot create them', denied('list friendships') && denied('get friendships/<victim>_<x>') && denied('create friendship as anonymous (not Google)'));
step('6b. reports are write-only, and only about people you chatted with', denied('list reports') && denied('get reports/x') && denied('report a non-partner'));
step('7a. queue entries expose only the matching fields (no uid lists beyond blocked, no ip/fingerprint)', !/ip|fp|fingerprint|email|name|uid/i.test(R.queueFieldsVisible.replace(/blocked/g, '')), R.queueFieldsVisible);
step('7b. presence exposes only {ts,status}', R.presenceFieldsVisible === 'status,ts' || R.presenceFieldsVisible === 'ts' || R.presenceFieldsVisible === '', R.presenceFieldsVisible);
step('8a. admin actions refuse non-admins', R['admin overview as non-admin'] === 'functions/permission-denied' && R['admin ban as non-admin'] === 'functions/permission-denied');
step('8b. garbage / forged function calls are refused cleanly (never an internal error)', ['reportViolation garbage type', 'requestUnban while not banned', 'createOrder anonymous', 'verifyPayment forged'].every(k => R[k] && R[k] !== 'functions/internal'), JSON.stringify([R['reportViolation garbage type'], R['requestUnban while not banned'], R['createOrder anonymous'], R['verifyPayment forged']]));
console.log('queue blocked-list note: the "blocked" array in queue entries IS readable by other signed-in users (needed for matching). Fields visible:', R.queueFieldsVisible);
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
