// End-to-end tests for the "good vibe" like system (functions/likes.js + the reputation rules).
// Needs: Firebase emulators (auth 9099, firestore 8080, functions 5001), http.server on 8765.
// Run: node likes.mjs <scratchpad dir>        (VERBOSE=1 prints details for passing steps too)
// Shares the emulator with other suites, so it never wipes the database: every user is a fresh anonymous
// account and everything created here is removed again at the end (through the emulator's admin REST API).
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const APP = 'anon-connect';
const FS_REST = 'http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents';
const FN_URL = 'http://127.0.0.1:5001/demo-ohmygoal/asia-south1/';
const MAIN_IP = '192.0.2.218';
const BAN_IP = '192.0.2.219'; // the ban test uses its own network so other suites' IP / device bans are never touched
const BAN_FP = 'e7'.repeat(16);
const RUN = crypto.randomBytes(4).toString('hex');
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

let failures = 0, passed = 0;
const step = (n, ok, extra = '') => { if (ok) passed++; else failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${!ok || process.env.VERBOSE ? ' ' + extra : ''}`); };
const J = x => JSON.stringify(x);
const eq = (a, b) => J(a) === J(b);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- admin REST (bypasses rules, like the Admin SDK)
const pubPath = p => `artifacts/${APP}/public/data/${p}`;
const prvPath = p => `artifacts/${APP}/private/data/${p}`;
const enc = v => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isNaN(v) ? { doubleValue: 'NaN' } : !Number.isFinite(v) ? { doubleValue: v > 0 ? 'Infinity' : '-Infinity' } : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const dec = v => 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue : 'timestampValue' in v ? new Date(v.timestampValue) : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec)
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
const adminDel = p => fetch(`${FS_REST}/${p}`, { method: 'DELETE', headers: adminHeaders });
const adminList = async p => {
  const out = [];
  let token = '';
  do {
    const j = await (await fetch(`${FS_REST}/${p}?pageSize=300${token ? `&pageToken=${token}` : ''}`, { headers: adminHeaders })).json();
    for (const d of j.documents || []) out.push({ id: d.name.split('/').pop(), data: decFields(d.fields) });
    token = j.nextPageToken || '';
  } while (token);
  return out;
};
const rep = async uid => (await adminGet(pubPath(`reputation/${uid}`)))?.likes ?? null;
const rand = n => crypto.randomBytes(n).toString('hex').slice(0, n);
const mine = new Set();     // every uid (real or invented) used here
const myRooms = new Set();  // every room id created here
const fakeUid = () => { const u = `lk${RUN}${rand(14)}`; mine.add(u); return u; }; // a partner who never signs in (rules don't check the other room member)
const adminRoom = async (users, extra = {}, created = Date.now() - MIN) => {
  const id = rand(20);
  myRooms.add(id);
  await adminSet(pubPath(`rooms/${id}`), { mode: 'text', users, ...(created === 'missing' ? {} : { created }), ...extra });
  return id;
};

// Rooms are now only creatable by clients through a real queue claim or between accepted friends, so these tests write them
// through the admin API (like the matchmaking batch would) and the in-page `room()` calls back to this.
const tagRoom = async (members, c, extra = {}) => {
  const created = c === 'server' || c === 'ts-now' ? new Date() : c?.ts !== undefined ? new Date(c.ts) : c === 'nan' ? NaN : c === '-inf' ? -Infinity : c;
  return adminRoom(members, extra, created);
};

// ---------------------------------------------------------------- browser + in-page SDK
// Fail fast instead of hanging when an emulator is down or stuck.
for (const [name, url] of [['auth', 'http://127.0.0.1:9099/'], ['firestore', 'http://127.0.0.1:8080/'], ['functions', FN_URL]]) {
  await fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => { console.log(`FAIL the ${name} emulator is not reachable at ${url}`); process.exit(2); });
}
setTimeout(() => { console.log('FAIL watchdog: the run took longer than 25 minutes (an emulator stalled?)'); process.exit(3); }, 25 * MIN).unref();
const unauth = await fetch(FN_URL + 'likeUser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}' }).then(r => r.json()).catch(() => null);
if (unauth?.error?.status !== 'UNAUTHENTICATED') throw new Error('likeUser is not deployed in the emulator: ' + J(unauth));

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const logs = [];
async function context(xff) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block' });
  // The emulator doesn't see a client IP, so add X-Forwarded-For the way Google's front end does in production.
  await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': xff } }));
  await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|fonts\.g|country\.is|razorpay/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => logs.push('PAGEERR ' + e.message));
  // A real page from the local server (a fulfilled-by-route page would count as a non-local origin and Chrome would block the emulator calls).
  await page.goto('http://localhost:8765/legal.html');
  await page.exposeFunction('__tagRoom', tagRoom);
  return page;
}

// Runs `fn` inside the page with a toolbox: fresh anonymous users (`mk`, `named`) that call functions and use Firestore as themselves.
const sdk = (page, fn, arg) => page.evaluate(async ([src, arg]) => {
  const appM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const authM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  const f = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const base = ['artifacts', 'anon-connect', 'public', 'data'];
  const seen = (window.__seen ||= { uids: [], rooms: [] });
  const users = (window.__users ||= {});
  const opts = { apiKey: 'fake-key', projectId: 'demo-ohmygoal', appId: '1:1:web:1', authDomain: 'demo-ohmygoal.firebaseapp.com' };
  const tryIt = async fn => { try { await fn(); return 'ALLOWED'; } catch (e) { return e.code; } };
  // Values JSON can't carry, for the `created` field of a room.
  const created = c => c === 'server' ? f.serverTimestamp() : c === 'ts-now' ? f.Timestamp.now() : c === 'nan' ? NaN : c === '-inf' ? -Infinity
    : c?.ts !== undefined ? f.Timestamp.fromMillis(c.ts) : c;
  // pass:false = signed in but never asked for an access pass; signIn:false = not signed in at all.
  const mk = async ({ pass = true, signIn = true, fp } = {}) => {
    const app = appM.initializeApp(opts, 'u' + Math.random().toString(36).slice(2));
    const auth = authM.getAuth(app), db = f.getFirestore(app), fns = fnM.getFunctions(app, 'asia-south1');
    authM.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    f.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    fnM.connectFunctionsEmulator(fns, '127.0.0.1', 5001);
    if (signIn) { await authM.signInAnonymously(auth); seen.uids.push(auth.currentUser.uid); }
    const u = { app, auth, db, fns, uid: auth.currentUser?.uid };
    u.call = async (name, ...args) => {
      try { return { ok: (await fnM.httpsCallable(fns, name)(...args)).data }; } catch (e) { return { err: e.code, msg: e.message }; }
    };
    u.like = (...args) => u.call('likeUser', ...args);
    u.get = async (...p) => { try { const s = await f.getDoc(f.doc(db, ...p)); return s.exists() ? s.data() : null; } catch (e) { return 'ERR:' + e.code; } };
    u.room = async (members, c = Date.now() - 60000, extra = {}) => {
      const id = await window.__tagRoom(members, c, extra);
      seen.rooms.push(id);
      return id;
    };
    u.forge = (members, c, extra = {}) => tryIt(() => f.setDoc(f.doc(f.collection(db, ...base, 'rooms')), { mode: 'text', users: members, created: created(c), ...extra }));
    if (signIn && pass) await u.call('checkAccess', fp ? { fp } : {});
    return u;
  };
  const named = async (n, o) => (users[n] ||= await mk(o));
  return await (eval(src))({ mk, named, f, base, tryIt, authM, fnM, appM, seen, arg });
}, [fn.toString(), arg]);

// Node-side handles on named users living in a page.
const api = page => ({
  user: async (name, o) => { const uid = await sdk(page, ({ named, arg }) => named(arg.name, arg.o).then(u => u.uid), { name, o }); mine.add(uid); return uid; },
  like: (name, ...args) => sdk(page, ({ named, arg }) => named(arg.name).then(u => u.like(...arg.args)), { name, args }),
  call: (name, fn, ...args) => sdk(page, ({ named, arg }) => named(arg.name).then(u => u.call(arg.fn, ...arg.args)), { name, fn, args }),
  room: async (name, members, created) => {
    const id = await sdk(page, ({ named, arg }) => named(arg.name).then(u => u.room(arg.members, arg.created)), { name, members, created });
    myRooms.add(id);
    return id;
  },
  get: (name, ...p) => sdk(page, ({ named, arg }) => named(arg.name).then(u => u.get(...arg.p)), { name, p }),
  token: name => sdk(page, ({ named, arg }) => named(arg).then(u => u.auth.currentUser.getIdToken()), name),
});
const p = await context(MAIN_IP);
const pBan = await context(BAN_IP);
const T = api(p), TB = api(pBan);
// A like in a brand-new room between a named user and `partner` (any string: the rules don't check the other member).
const likeNew = async (name, partner, created) => { const r = await T.room(name, [(await uidOf(name)), partner], created); return { r, res: await T.like(name, { roomId: r }) }; };
const uids = {};
const uidOf = async name => uids[name] ||= await T.user(name);
const pub = (...p) => ['artifacts', APP, 'public', 'data', ...p];
const prv = (...p) => ['artifacts', APP, 'private', 'data', ...p];

try {
  // ---------------------------------------------------------------- 0. sign-in required
  const anon = await sdk(p, async ({ mk }) => (await mk({ signIn: false })).like({ roomId: 'abcdefghijklmnop' }));
  step('0a. unauthenticated call -> unauthenticated', anon.err === 'functions/unauthenticated', J(anon));

  // ---------------------------------------------------------------- 1. happy path
  const [A, B] = [await uidOf('A'), await uidOf('B')];
  const r1 = await T.room('A', [A, B]);
  const first = await T.like('A', { roomId: r1 });
  step('1a. like succeeds: exactly { ok: true, likes: 1 }', eq(first, { ok: { ok: true, likes: 1 } }), J(first));
  const repB = await adminGet(pubPath(`reputation/${B}`));
  step('1b. partner\'s reputation.likes is 1 and updatedAt is set; the liker got nothing', repB?.likes === 1 && typeof repB.updatedAt === 'number' && await rep(A) === null, J(repB));
  const [log, pair, gA, rB] = await Promise.all([adminGet(prvPath(`likeLog/${r1}_${A}`)), adminGet(prvPath(`likePairs/${A}_${B}`)),
    adminGet(prvPath(`likeCounters/given_${A}`)), adminGet(prvPath(`likeCounters/received_${B}`))]);
  step('1c. dedupe docs exist in the private tree (room log, pair, given / received windows)',
    log?.from === A && log.to === B && log.roomId === r1 && typeof pair?.at === 'number' && gA?.times.length === 1 && rB?.times.length === 1, J({ log, pair, gA, rB }));
  const reads = [await T.get('A', ...pub('reputation', B)), await T.get('B', ...pub('reputation', B)), await T.get('A', ...pub('reputation', A))];
  step('1d. both users can get the partner\'s count by uid; a doc that does not exist reads as empty', reads[0]?.likes === 1 && reads[1]?.likes === 1 && reads[2] === null, J(reads));

  const rules1 = await sdk(p, async ({ named, f, base, tryIt, arg }) => {
    const a = await named('A'), b = await named('B');
    const col = u => f.collection(u.db, ...base, 'reputation');
    const ref = (u, id) => f.doc(u.db, ...base, 'reputation', id);
    const priv = (u, ...p) => f.doc(u.db, 'artifacts', 'anon-connect', 'private', 'data', ...p);
    return {
      list: {
        aList: await tryIt(() => f.getDocs(col(a))),
        bList: await tryIt(() => f.getDocs(col(b))),
        query: await tryIt(() => f.getDocs(f.query(col(a), f.where('likes', '>', 0), f.limit(5)))),
        orderBy: await tryIt(() => f.getDocs(f.query(col(a), f.orderBy('likes', 'desc'), f.limit(5)))),
        count: await tryIt(() => f.getCountFromServer(col(a))),
      },
      writes: {
        aSelf: await tryIt(() => f.setDoc(ref(a, a.uid), { likes: 1000 })),
        aSelfMerge: await tryIt(() => f.setDoc(ref(a, a.uid), { likes: 1000, updatedAt: 1 }, { merge: true })),
        aOther: await tryIt(() => f.setDoc(ref(a, b.uid), { likes: 1000 })),
        aIncrement: await tryIt(() => f.updateDoc(ref(a, b.uid), { likes: f.increment(1000) })),
        aDelete: await tryIt(() => f.deleteDoc(ref(a, b.uid))),
        ownerSet: await tryIt(() => f.setDoc(ref(b, b.uid), { likes: 999 })),
        ownerUpdate: await tryIt(() => f.updateDoc(ref(b, b.uid), { likes: 999 })),
        ownerDelete: await tryIt(() => f.deleteDoc(ref(b, b.uid))),
        newDoc: await tryIt(() => f.setDoc(ref(a, 'someone' + Math.random()), { likes: 5 })),
        batch: await tryIt(async () => { const w = f.writeBatch(a.db); w.set(ref(a, a.uid), { likes: 1000 }); await w.commit(); }),
        transaction: await tryIt(() => f.runTransaction(a.db, async t => { t.update(ref(a, b.uid), { likes: 5000 }); })),
      },
      priv: {
        readLog: await tryIt(() => f.getDoc(priv(a, 'likeLog', `${arg.r1}_${a.uid}`))),
        readPair: await tryIt(() => f.getDoc(priv(a, 'likePairs', `${a.uid}_${b.uid}`))),
        readCounter: await tryIt(() => f.getDoc(priv(a, 'likeCounters', `given_${a.uid}`))),
        writeLog: await tryIt(() => f.setDoc(priv(a, 'likeLog', `${arg.r1}_${b.uid}`), { from: b.uid })),
        writeCounter: await tryIt(() => f.setDoc(priv(a, 'likeCounters', `given_${a.uid}`), { times: [] })),
        listLog: await tryIt(() => f.getDocs(f.collection(a.db, 'artifacts', 'anon-connect', 'private', 'data', 'likeLog'))),
      },
    };
  }, { r1 });
  step('1e. nobody can list, query, order or count the reputation collection', Object.values(rules1.list).every(v => v === 'permission-denied'), J(rules1.list));
  step('1f. no client write works: own doc, partner doc, +1000, increment, delete, new doc, batch, transaction (owner included)',
    Object.values(rules1.writes).every(v => v === 'permission-denied'), J(rules1.writes));
  step('1g. ... and the stored counts did not move', await rep(B) === 1 && await rep(A) === null);
  step('1h. the private tree (log, pairs, counters) is unreadable, unlistable and unwritable for clients', Object.values(rules1.priv).every(v => v === 'permission-denied'), J(rules1.priv));
  const signedOut = await sdk(p, async ({ mk, f, base, tryIt, arg }) => {
    const x = await mk({ signIn: false });
    return tryIt(() => f.getDoc(f.doc(x.db, ...base, 'reputation', arg)));
  }, B);
  step('1i. a signed-out visitor cannot read reputation', signedOut === 'permission-denied', signedOut);

  const replay = [await T.like('A', { roomId: r1 }), await T.like('A', { roomId: r1 })];
  step('1j. replaying the same room -> { ok: true, already: true }, no increment', replay.every(x => eq(x, { ok: { ok: true, already: true } })) && await rep(B) === 1, J(replay));
  const back = [await T.like('B', { roomId: r1 }), await T.like('B', { roomId: r1 })];
  step('1k. the partner can like back in the same room (one like per room per caller); their replay is idempotent too',
    eq(back[0], { ok: { ok: true, likes: 1 } }) && eq(back[1], { ok: { ok: true, already: true } }) && await rep(A) === 1, J(back));
  const r3 = await T.room('A', [A, B]);
  const second = [await T.like('A', { roomId: r3 }), await T.like('B', { roomId: r3 })];
  step('1l. a second room with the same partner within 24 h is refused (both directions); counts unchanged',
    second.every(x => x.err === 'functions/already-exists') && await rep(B) === 1 && await rep(A) === 1, J(second));
  const [C, D] = [await uidOf('C'), await uidOf('D')];
  const rCD = await T.room('C', [C, D]);
  const parallel = await Promise.all(Array.from({ length: 6 }, () => T.like('C', { roomId: rCD })));
  step('1m. six simultaneous likes for one room are counted exactly once', parallel.filter(x => x.ok?.likes === 1).length === 1
    && parallel.filter(x => x.ok?.already === true).length === 5 && await rep(D) === 1, J(parallel));

  // ---------------------------------------------------------------- 2. room age and the type of `created`
  const [Y, P, Q] = [await uidOf('Y'), await uidOf('P'), await uidOf('Q')];
  const rServer = await T.room('P', [P, Q], 'server'); // what real matchmaking writes; tried again at the end of the run
  const roomDoc = await adminGet(pubPath(`rooms/${rServer}`));
  const now = Date.now();
  const cases = {
    young5s: now - 5000, youngNow: now, youngTs: 'ts-now', youngTs10s: { ts: now - 10000 }, future: now + HOUR, futureTs: { ts: now + HOUR },
    old2h1m: now - 2 * HOUR - MIN, oldTs3h: { ts: now - 3 * HOUR }, oldYear: now - 365 * DAY, oldZero: 0, negative: -5,
    missing: 'missing', asString: String(now - 60000), asNull: null, asNaN: 'nan', asBool: true, asMap: { seconds: 5 }, asArray: [now - 60000], negInf: '-inf',
  };
  const out2 = {};
  for (const [k, c] of Object.entries(cases)) out2[k] = await T.like('Y', { roomId: await T.room('Y', [Y, fakeUid()], c) });
  out2.serverNow = await T.like('P', { roomId: rServer });
  const bad2 = Object.entries(out2).filter(([, r]) => r.err !== 'functions/failed-precondition');
  step(`2a. ${Object.keys(out2).length} bad rooms (<30 s, future, >2 h, missing / string / null / NaN / bool / map / array / -Infinity created) -> failed-precondition`, bad2.length === 0, J(bad2));
  step('2b. messages differ: young says to chat longer, old says the chat ended too long ago', /longer/i.test(out2.young5s.msg) && /too long/i.test(out2.old2h1m.msg), J([out2.young5s.msg, out2.old2h1m.msg]));
  step('2c. a real serverTimestamp room (stored as a Timestamp) is too young right after matching', roomDoc.created instanceof Date && out2.serverNow.err === 'functions/failed-precondition', J(roomDoc));
  step('2d. refused likes changed nothing', await rep(Q) === null && await rep(Y) === null);
  const [E, G, I] = [await uidOf('E'), await uidOf('G'), await uidOf('I')];
  const inside = [await T.like('E', { roomId: await T.room('E', [E, fakeUid()], Date.now() - 40000) }),
    await T.like('G', { roomId: await T.room('G', [G, fakeUid()], { ts: Date.now() - 119 * MIN }) }),
    await T.like('I', { roomId: await T.room('I', [I, fakeUid()], { ts: Date.now() - 32000 }) })];
  step('2e. just inside the window works: a number a bit over 30 s old, a Timestamp 119 min old, a Timestamp a bit over 30 s old', inside.every(x => x.ok?.likes === 1), J(inside));

  // ---------------------------------------------------------------- 3. the target is derived from the room
  const [X, Z, W, S] = [await uidOf('X'), await uidOf('Z'), await uidOf('W'), await uidOf('S')];
  const rXY = await T.room('X', [X, Y]);
  const rZW = await T.room('Z', [Z, W]);
  const notMember = [await T.like('Z', { roomId: rXY }), await T.like('Z', { roomId: rXY, toUid: Z, uid: Y, target: Z }), await T.like('Z', { roomId: 'a'.repeat(20) })];
  step('3a. a room that is not yours (also with a forged toUid), or does not exist -> the same permission-denied',
    notMember.every(r => r.err === 'functions/permission-denied') && notMember[0].msg === notMember[2].msg, J(notMember));
  const forged = await T.like('Z', { roomId: rZW, toUid: X, uid: X, target: X, to: X, from: Y, partner: Y, targetUid: X, recipient: X });
  step('3b. extra fields (toUid, uid, target, to, from, partner, ...) are ignored: only the room partner is liked, nobody else',
    forged.ok?.likes === 1 && await rep(W) === 1 && await rep(X) === null && await rep(Y) === null && await rep(Z) === null, J(forged));
  const selfRoom = await T.like('S', { roomId: await T.room('S', [S, S]) });
  step('3c. a room with yourself twice cannot be liked', selfRoom.err === 'functions/failed-precondition' && await rep(S) === null, J(selfRoom));
  const odd = {};
  for (const [k, other] of Object.entries({ slash: 'a/b/c/d', empty: '', dots: '..', dot: '.', long: 'u'.repeat(200), space: 'two words', reserved: '__x__', num: 5, nul: null, map: { a: 1 } })) {
    odd[k] = await T.like('S', { roomId: await T.room('S', [S, other]) });
  }
  const badOdd = Object.entries(odd).filter(([, r]) => r.err !== 'functions/failed-precondition');
  step('3d. rooms whose other member is not a plain uid (slash, empty, ".", "..", 200 chars, space, "__x__", number, null, map) -> failed-precondition, not 500', badOdd.length === 0, J(badOdd));
  const adm = {
    oneMember: await adminRoom([S]), threeMembers: await adminRoom([S, X, Y]), sameTwice: await adminRoom([S, S]), usersString: await adminRoom(S),
    usersMap: await adminRoom({ a: S, b: X }), usersNull: await adminRoom(null), usersEmpty: await adminRoom([]),
  };
  const admRes = {};
  for (const [k, id] of Object.entries(adm)) admRes[k] = (await T.like('S', { roomId: id })).err;
  const wantAdm = { oneMember: 'failed-precondition', threeMembers: 'failed-precondition', sameTwice: 'failed-precondition', usersString: 'permission-denied', usersMap: 'permission-denied', usersNull: 'permission-denied', usersEmpty: 'permission-denied' };
  step('3e. corrupt room documents (1 or 3 members, users not a list, null, empty) are refused cleanly', eq(admRes, Object.fromEntries(Object.entries(wantAdm).map(([k, v]) => [k, 'functions/' + v]))), J(admRes));
  step('3f. nobody was credited by any refused like', await rep(S) === null && await rep(X) === null);
  const roomNoCreated = await adminRoom([S, fakeUid()], {}, 'missing');
  step('3g. a room without `created` is refused', (await T.like('S', { roomId: roomNoCreated })).err === 'functions/failed-precondition');

  // ---------------------------------------------------------------- 4. access pass (bans)
  const NP = await T.user('NP', { pass: false }), EX = await uidOf('EX'), ST = await uidOf('ST'), PEER = await uidOf('PEER');
  const rNP = await adminRoom([NP, PEER]), rEX = await adminRoom([EX, PEER]), rST = await adminRoom([ST, PEER]);
  const npRes = await T.like('NP', { roomId: rNP });
  step('4a. a signed-in user who never got an access pass cannot like', npRes.err === 'functions/permission-denied' && await rep(PEER) === null, J(npRes));
  await adminSet(pubPath(`access/${EX}`), { until: Date.now() - 1000, videoBanUntil: 0 });
  step('4b. an expired access pass cannot like', (await T.like('EX', { roomId: rEX })).err === 'functions/permission-denied');
  await adminSet(pubPath(`access/${ST}`), { until: 'tomorrow', videoBanUntil: 0 });
  step('4c. a malformed pass (until is not a number) cannot like', (await T.like('ST', { roomId: rST })).err === 'functions/permission-denied');
  await adminDel(pubPath(`access/${ST}`));
  step('4d. a deleted pass (what a ban does) cannot like', (await T.like('ST', { roomId: rST })).err === 'functions/permission-denied' && await rep(PEER) === null);
  await adminSet(pubPath(`access/${EX}`), { until: Date.now() + HOUR, videoBanUntil: Date.now() + DAY });
  const exOk = await T.like('EX', { roomId: rEX });
  step('4e. the same user with a valid pass can like (the pass was the only difference; a video-only ban does not matter)', exOk.ok?.likes === 1 && await rep(PEER) === 1, J(exOk));

  // The real moderation flow, from a separate network so nobody else's IP / device bans are affected.
  const BN = await TB.user('BN', { fp: BAN_FP }), BPEER = await TB.user('BPEER');
  const rBN = await TB.room('BN', [BN, BPEER]);
  const passBefore = await TB.get('BN', ...pub('access', BN));
  const viol = await TB.call('BN', 'reportViolation', { type: 'underage', fp: BAN_FP });
  const passAfter = await TB.get('BN', ...pub('access', BN));
  const bannedLike = await TB.like('BN', { roomId: rBN });
  step('4f. a user banned through the real moderation flow loses the pass and cannot like', !!passBefore && viol.ok?.allowed === false && passAfter === null
    && bannedLike.err === 'functions/permission-denied' && await rep(BPEER) === null, J({ passBefore, viol, passAfter, bannedLike }));
  const bannedStillGets = await TB.like('BPEER', { roomId: rBN }); // the peer is not banned: the banned person can still be liked? (document behaviour)
  step('4g. a banned person can still be liked by their (unbanned) partner', bannedStillGets.ok?.likes === 1, J(bannedStillGets));

  // ---------------------------------------------------------------- 5. garbage input
  const U5 = await uidOf('U5');
  const inputs = {
    noArgs: [], nullData: [null], emptyObj: [{}], nullId: [{ roomId: null }], number: [{ roomId: 12345678901234 }], object: [{ roomId: { a: 1 } }],
    operator: [{ roomId: { $gt: '' } }], array: [{ roomId: ['abcdefghijklmnop'] }], bool: [{ roomId: true }], short: [{ roomId: 'abc' }], nine: [{ roomId: 'a'.repeat(9) }],
    fortyOne: [{ roomId: 'a'.repeat(41) }], kb5: [{ roomId: 'a'.repeat(5 * 1024) }], dotdot: [{ roomId: '../..' }], path: [{ roomId: 'rooms/abcdefghijklmnop' }],
    traversal: [{ roomId: '../../private/data/likeLog/abcdefghijklmnop' }], dash: [{ roomId: 'abcdefgh-ijklmnop' }], underscore: [{ roomId: 'abcdefgh_ijklmnop' }],
    unicode: [{ roomId: 'ééééééééééé' }], newline: [{ roomId: 'abcdefghijklmnop\n' }], leadingNewline: [{ roomId: '\nabcdefghijklmnop' }],
    space: [{ roomId: 'abcdefgh ijklmnop' }], nulByte: [{ roomId: 'abcdefghijklmnop\u0000' }], stringData: ['abcdefghijklmnop'], numberData: [5],
    arrayData: [['abcdefghijklmnop']], boolData: [false], wrongKeys: [{ roomID: 'abcdefghijklmnop', id: 'abcdefghijklmnop', room: 'abcdefghijklmnop' }],
    onlyTarget: [{ toUid: 'someone', uid: 'someone' }],
  };
  const out5 = {};
  for (const [k, args] of Object.entries(inputs)) out5[k] = (await T.like('U5', ...args)).err;
  const bad5 = Object.entries(out5).filter(([, c]) => c !== 'functions/invalid-argument');
  step(`5a. ${Object.keys(inputs).length} kinds of garbage (missing, null, object, array, bool, number, 5 KB, "../..", traversal, unicode, newline, NUL, wrong keys, string data, ...) -> invalid-argument`, bad5.length === 0, J(bad5));
  const token = await T.token('U5');
  const raw = async (body, h = {}) => {
    const r = await fetch(FN_URL + 'likeUser', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...h }, body });
    return { status: r.status, error: (await r.json().catch(() => null))?.error?.status };
  };
  const rawCases = {
    noData: await raw('{}'), nullData: await raw('{"data":null}'), arrayBody: await raw('[]'), notJson: await raw('not json'), emptyBody: await raw(''),
    stringData: await raw('{"data":"x"}'), hugeData: await raw(J({ data: { roomId: 'a'.repeat(200000) } })),
    deepData: await raw(J({ data: { roomId: { a: { a: { a: { a: {} } } } } } })), textPlain: await raw('{"data":{"roomId":"abcdefghijklmnop"}}', { 'Content-Type': 'text/plain' }),
    garbageToken: await raw('{"data":{"roomId":"abcdefghijklmnop"}}', { Authorization: 'Bearer nope' }), noToken: await raw('{"data":{"roomId":"abcdefghijklmnop"}}', { Authorization: '' }),
  };
  step('5b. hand-made HTTP requests (no data, array body, not JSON, empty, 200 KB, deeply nested, wrong content type, bad / missing token) all end in a 4xx',
    Object.values(rawCases).every(r => r.status >= 400 && r.status < 500), J(rawCases));
  step('5c. missing / null / string / huge data -> INVALID_ARGUMENT; a missing token -> UNAUTHENTICATED',
    ['noData', 'nullData', 'stringData', 'hugeData'].every(k => rawCases[k].error === 'INVALID_ARGUMENT') && rawCases.noToken.error === 'UNAUTHENTICATED', J(rawCases));
  step('5d. garbage created no like records', (await adminList(prvPath('likeLog'))).every(d => !/^(\.|abcdefghijklmnop|a{9})/.test(d.id)));

  // ---------------------------------------------------------------- 6. rolling windows and caps
  const rG = await uidOf('rG'), rH = await uidOf('rH');
  const given = (uid, times) => adminSet(prvPath(`likeCounters/given_${uid}`), { times });
  const fill = (n, at) => Array.from({ length: n }, (_, i) => at - i);
  const ago = ms => Date.now() - ms;
  await given(rG, fill(40, ago(25 * HOUR)));
  const g1 = await likeNew('rG', fakeUid());
  step('6a. likes older than 24 h no longer count toward the 40-a-day cap (rolling window), and are pruned', g1.res.ok?.likes === 1 && (await adminGet(prvPath(`likeCounters/given_${rG}`))).times.length === 1, J(g1.res));
  await given(rG, [...fill(39, ago(25 * HOUR)), ago(HOUR)]);
  const g2 = await likeNew('rG', fakeUid());
  step('6b. 39 old + 1 recent leaves room for exactly one more', g2.res.ok?.likes === 1 && (await adminGet(prvPath(`likeCounters/given_${rG}`))).times.length === 2, J(g2.res));
  await given(rG, fill(40, ago(HOUR)));
  const capPartner = fakeUid();
  const g3 = await likeNew('rG', capPartner);
  step('6c. 40 likes in the last 24 h -> resource-exhausted; the partner got nothing and no log was written',
    g3.res.err === 'functions/resource-exhausted' && await rep(capPartner) === null && !(await adminGet(prvPath(`likeLog/${g3.r}_${rG}`))) && !(await adminGet(prvPath(`likePairs/${rG}_${capPartner}`))), J(g3.res));
  await given(rG, fill(40, ago(24 * HOUR - 5000)));
  const g4 = await likeNew('rG', fakeUid());
  await given(rG, fill(40, ago(24 * HOUR + 5000)));
  const g5 = await likeNew('rG', fakeUid());
  step('6d. the cap lifts exactly at 24 h: 5 s before still blocks, 5 s after allows', g4.res.err === 'functions/resource-exhausted' && g5.res.ok?.likes === 1, J([g4.res, g5.res]));

  const peerP = fakeUid();
  const h1 = await likeNew('rH', peerP);
  const h2 = await likeNew('rH', peerP);
  await adminSet(prvPath(`likePairs/${rH}_${peerP}`), { at: ago(23 * HOUR) });
  const h3 = await likeNew('rH', peerP);
  await adminSet(prvPath(`likePairs/${rH}_${peerP}`), { at: ago(25 * HOUR) });
  const h4 = await likeNew('rH', peerP);
  step('6e. same partner: allowed once, refused (even in a new room) until 24 h have passed, then allowed again',
    h1.res.ok?.likes === 1 && h2.res.err === 'functions/already-exists' && h3.res.err === 'functions/already-exists' && h4.res.ok?.likes === 2, J([h1.res, h2.res, h3.res, h4.res]));

  const full = fakeUid();
  await adminSet(prvPath(`likeCounters/received_${full}`), { times: fill(80, ago(HOUR)) });
  await given(rG, []);
  const c1 = await likeNew('rG', full);
  step('6f. a person who received 80 likes in 24 h refuses more; the refusal used none of the caller\'s allowance',
    c1.res.err === 'functions/resource-exhausted' && await rep(full) === null && ((await adminGet(prvPath(`likeCounters/given_${rG}`)))?.times.length ?? 0) === 0, J(c1.res));
  await adminSet(prvPath(`likeCounters/received_${full}`), { times: fill(80, ago(25 * HOUR)) });
  const c2 = await likeNew('rG', full);
  step('6g. ... and their old likes age out of the window', c2.res.ok?.likes === 1 && (await adminGet(prvPath(`likeCounters/received_${full}`))).times.length === 1, J(c2.res));

  // Real calls: one caller, 40 different partners, then the 41st.
  const caller = await sdk(p, async ({ mk, arg }) => {
    const K = await mk();
    const results = [], partners = [];
    for (let i = 0; i < 41; i++) {
      const partner = `lk${arg.run}k${i}${Math.random().toString(36).slice(2, 12)}`;
      partners.push(partner);
      results.push((await K.like({ roomId: await K.room([K.uid, partner]) })));
    }
    return { K: K.uid, results, partners };
  }, { run: RUN });
  mine.add(caller.K); caller.partners.forEach(x => mine.add(x));
  const okCount = caller.results.slice(0, 40).filter(r => r.ok?.likes === 1).length;
  step('6h. one account: 40 likes to 40 different partners all work, the 41st is resource-exhausted and credits nobody',
    okCount === 40 && caller.results[40].err === 'functions/resource-exhausted' && await rep(caller.partners[40]) === null && await rep(caller.partners[39]) === 1, J({ okCount, last: caller.results[40] }));

  // Real calls: 80 different fresh accounts like one person (brigading / farming), the 81st is refused.
  const target = await T.user('TARGET');
  const t0 = Date.now();
  const brigade = await sdk(p, async ({ mk, named, arg }) => {
    const tgt = await named('TARGET');
    const totals = [];
    const errors = [];
    const one = async () => {
      const L = await mk();
      const r = await L.like({ roomId: await L.room([L.uid, tgt.uid]) });
      if (r.ok?.likes) totals.push(r.ok.likes); else errors.push(r);
      return L;
    };
    for (let i = 0; i < 80; i += 8) await Promise.all(Array.from({ length: 8 }, one));
    const extra = await mk();
    const refused = await extra.like({ roomId: await extra.room([extra.uid, tgt.uid]) });
    const refusedAgain = await extra.like({ roomId: await extra.room([extra.uid, tgt.uid]) });
    const other = 'lk' + arg.run + 'other' + Math.random().toString(36).slice(2, 12);
    const elsewhere = await extra.like({ roomId: await extra.room([extra.uid, other]) });
    return { totals, errors, refused, refusedAgain, elsewhere, other, own: await tgt.get(...['artifacts', 'anon-connect', 'public', 'data', 'reputation', tgt.uid]), extra: extra.uid };
  }, { run: RUN });
  mine.add(brigade.extra); mine.add(brigade.other);
  step(`6i. 80 different accounts like one person (${Math.round((Date.now() - t0) / 1000)} s): all succeed, running totals are exactly 1..80 even in parallel batches`,
    brigade.errors.length === 0 && eq([...brigade.totals].sort((a, b) => a - b), Array.from({ length: 80 }, (_, i) => i + 1)) && brigade.own?.likes === 80, J({ errors: brigade.errors.slice(0, 3), own: brigade.own }));
  step('6j. the 81st account is refused (resource-exhausted), also on retry with a new room; the cap is per target: that account can still like someone else',
    brigade.refused.err === 'functions/resource-exhausted' && brigade.refusedAgain.err === 'functions/resource-exhausted' && brigade.elsewhere.ok?.likes === 1 && await rep(target) === 80, J({ r: brigade.refused, a: brigade.refusedAgain, e: brigade.elsewhere }));

  // ---------------------------------------------------------------- 7. rooms can no longer be forged from a browser
  const [FA, VICTIM] = [await uidOf('FA'), await uidOf('VICTIM')];
  const forgedTry = await sdk(p, async ({ named, f, base, tryIt, arg }) => {
    const u = await named('FA');
    return {
      backdated: await u.forge([u.uid, arg.victim], Date.now() - 60000),
      server: await u.forge([u.uid, arg.victim], 'server'),
      friendship: await u.forge([u.uid, arg.victim], Date.now(), { friendship: 'a_b' }),
      selfRoom: await u.forge([u.uid, u.uid], 'server'),
    };
  }, { victim: VICTIM });
  step('7a. a browser cannot create a room with an arbitrary victim: back-dated, server-stamped without a queue claim, fake friendship, or self room are all permission-denied',
    Object.values(forgedTry).every(x => x === 'permission-denied'), J(forgedTry));

  // ---------------------------------------------------------------- 8. real serverTimestamp room, once it is old enough
  const wait = Math.max(0, 32000 - (Date.now() - now));
  if (wait) { console.log(`(waiting ${Math.ceil(wait / 1000)} s for the serverTimestamp room to reach 30 s)`); await sleep(wait); }
  const late = await T.like('P', { roomId: rServer });
  step('8a. the same serverTimestamp (Timestamp-typed) room works once it is >30 s old', eq(late, { ok: { ok: true, likes: 1 } }) && await rep(Q) === 1, J(late));
  const lateReplay = await T.like('P', { roomId: rServer });
  step('8b. ... and replays idempotently', eq(lateReplay, { ok: { ok: true, already: true } }) && await rep(Q) === 1, J(lateReplay));
} catch (e) {
  failures++;
  console.log('FAIL (test crashed): ' + (e?.stack || e));
}

// ---------------------------------------------------------------- privacy of the function's logs, then clean up
try {
  const emuDir = path.join(SP, 'emu');
  const logFile = fs.readdirSync(emuDir).filter(f => /^emu\d*\.log$/.test(f)).map(f => path.join(emuDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (logFile) {
    const text = fs.readFileSync(logFile, 'utf8');
    // The moderation function's own "ban" log line names the banned test user; every other uid must not appear at all.
    const leaked = [...mine].filter(u => u.length >= 20 && text.includes(u) && !(text.split('\n').filter(l => l.includes(u)).every(l => /"message":"ban"/.test(l))));
    step('9a. no uid appears in the emulator log (likeUser logs nothing personal)', leaked.length === 0, J({ file: path.basename(logFile), leaked: leaked.slice(0, 3) }));
  }
} catch (e) { console.log('(log check skipped: ' + e.message + ')'); }

try {
  for (const page of [p, pBan]) {
    const s = await sdk(page, ({ seen }) => seen);
    s.uids.forEach(u => mine.add(u)); s.rooms.forEach(r => myRooms.add(r));
  }
  // Also sweep leftovers of an earlier crashed run: accounts that used this test's two networks, rooms with them, and the invented partners they liked.
  for (const d of await adminList(prvPath('clients'))) if ([MAIN_IP, BAN_IP].includes(d.data.ip)) mine.add(d.id);
  for (const d of await adminList(pubPath('rooms'))) if (Array.isArray(d.data.users) && d.data.users.some(u => mine.has(u))) myRooms.add(d.id);
  for (const d of await adminList(prvPath('likePairs'))) if (mine.has(d.id.split('_')[0])) mine.add(d.id.split('_')[1]);
  const dels = [];
  for (const u of mine) {
    dels.push(pubPath(`access/${u}`), pubPath(`reputation/${u}`), prvPath(`clients/${u}`), prvPath(`likeCounters/given_${u}`), prvPath(`likeCounters/received_${u}`));
  }
  for (const r of myRooms) dels.push(pubPath(`rooms/${r}`));
  for (const d of await adminList(prvPath('likeLog'))) if (myRooms.has(d.id.split('_')[0])) dels.push(prvPath(`likeLog/${d.id}`));
  for (const d of await adminList(prvPath('likePairs'))) if (mine.has(d.id.split('_')[0])) dels.push(prvPath(`likePairs/${d.id}`));
  for (const d of await adminList(prvPath('bans'))) if (d.data.ip === BAN_IP || mine.has(d.data.uid)) dels.push(prvPath(`bans/${d.id}`));
  await Promise.all(dels.map(adminDel));
  const left = (await adminList(prvPath('likeLog'))).filter(d => myRooms.has(d.id.split('_')[0])).length
    + (await adminList(prvPath('likePairs'))).filter(d => mine.has(d.id.split('_')[0])).length;
  step(`9b. cleanup removed this run's ${mine.size} users and ${myRooms.size} rooms and their records; none left behind`, left === 0 && (await adminGet(pubPath(`reputation/${[...mine][0]}`))) === null);
} catch (e) { failures++; console.log('FAIL (cleanup crashed): ' + e); }

console.log(logs.length ? 'PAGE ERRORS:\n' + logs.join('\n') : 'no page errors');
console.log(`${passed} passed, ${failures} failed`);
console.log(failures ? 'FAILURES' : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
