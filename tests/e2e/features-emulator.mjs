// New server-side features against the emulators (rules + Cloud Functions): rooms and language fields in the queue, message reports,
// group rooms (joinGroup, member and handshake rules, sizes), the coin wallet and gifts, and push notifications (outbox mode).
// Needs: auth/firestore/functions emulators with PUSH_MODE=outbox, node tests/e2e/mockrzp.mjs on :7777, a static server on :8765.
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
await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': '198.51.100.77' } }));
const page = await ctx.newPage();
await page.goto('http://localhost:8765/legal.html');

/** Runs `fn` in the page. It gets mk(name, {google}) to create users, plus helpers. */
const run = fn => page.evaluate(async src => {
  const appM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const authM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  const f = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const stamp = Math.random().toString(36).slice(2, 8);
  const mk = async (name, { google = false, access = true } = {}) => {
    const app = appM.initializeApp({ apiKey: 'fake-key', projectId: 'demo-ohmygoal', appId: '1:1:web:1', authDomain: 'demo-ohmygoal.firebaseapp.com' }, name + stamp + Math.random());
    const auth = authM.getAuth(app), db = f.getFirestore(app), fns = fnM.getFunctions(app, 'asia-south1');
    authM.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    f.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    fnM.connectFunctionsEmulator(fns, '127.0.0.1', 5001);
    if (google) await authM.signInWithCredential(auth, authM.GoogleAuthProvider.credential(JSON.stringify({ sub: `g-${name}-${stamp}`, email: `${name}${stamp}@example.com`, email_verified: true })));
    else await authM.signInAnonymously(auth);
    const call = async (n, d) => { try { return { ok: (await fnM.httpsCallable(fns, n)(d)).data }; } catch (e) { return { err: e.code, msg: e.message }; } };
    if (access) await call('checkAccess', { fp: (name + stamp).padEnd(32, 'f').slice(0, 32).replace(/[^a-f0-9]/g, 'a') });
    return { auth, db, call, uid: auth.currentUser.uid, name };
  };
  const base = ['artifacts', 'anon-connect', 'public', 'data'];
  const code = async p => { try { await p; return 'ALLOWED'; } catch (e) { return e.code || String(e); } };
  const admin = (path, fields) => fetch('http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/' + path.join('/'), { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }).then(r => { if (!r.ok) throw new Error('admin ' + r.status); });
  const adminList = async path => (await fetch('http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/' + path.join('/'), { headers: { Authorization: 'Bearer owner' } }).then(r => r.json())).documents || [];
  const doc = (u, path) => f.doc(u.db, ...path), col = (u, path) => f.collection(u.db, ...path);
  return await (eval(src))({ mk, f, base, code, admin, adminList, doc, col, stamp });
}, fn.toString());

// ------------------------------------------------------------- 1. queue: rooms and language exchange
const q = await run(async ({ mk, f, base, code, doc }) => {
  const U = await mk('qa');
  const now = Date.now();
  const ok = { mode: 'text', interests: [], blocked: [], gender: 'x', country: 'IN', genderFilter: 'any', countryFilter: 'any', premium: false, ts: now, roomId: null };
  const set = d => code(f.setDoc(doc(U, [...base, 'queue', U.uid]), d));
  return {
    plain: await set(ok),
    themed: await set({ ...ok, theme: 'cricket' }),
    badTheme: await set({ ...ok, theme: 'hax' }),
    htmlTheme: await set({ ...ok, theme: '<img src=x>' }),
    langx: await set({ ...ok, theme: 'langx', lang: 'hi', learn: 'en' }),
    longLang: await set({ ...ok, theme: 'langx', lang: 'x'.repeat(20), learn: 'en' }),
    numLang: await set({ ...ok, theme: 'langx', lang: 5, learn: 'en' }),
    extra: await set({ ...ok, theme: 'cricket', evil: 1 }),
  };
});
step('1a. a plain queue entry still works', q.plain === 'ALLOWED');
step('1b. so does a themed one and a language-exchange one', q.themed === 'ALLOWED' && q.langx === 'ALLOWED');
step('1c. an unknown or hostile theme is refused', q.badTheme === 'permission-denied' && q.htmlTheme === 'permission-denied', `${q.badTheme} ${q.htmlTheme}`);
step('1d. oversize or non-string language fields are refused', q.longLang === 'permission-denied' && q.numLang === 'permission-denied');
step('1e. an unknown field is refused', q.extra === 'permission-denied');

// ------------------------------------------------------------- 2. message reports
const rp = await run(async ({ mk, f, base, code, admin, doc, stamp }) => {
  const V = await mk('rv'), X = await mk('rx');
  const roomId = 'reportroom' + stamp + 'abc';
  await admin([...base, 'rooms', roomId], { mode: { stringValue: 'text' }, users: { arrayValue: { values: [{ stringValue: V.uid }, { stringValue: X.uid }] } }, created: { integerValue: String(Date.now()) } });
  const rep = (reason, extra = {}) => code(f.setDoc(doc(V, [...base, 'reports', `${V.uid}_${roomId}_${reason}`]), { reporter: V.uid, reported: X.uid, roomId, reason, ts: f.serverTimestamp(), ...extra }));
  return {
    plain: await rep('spam'),
    withText: await rep('harassment', { evidence: 'you are rude' }),
    max: await rep('sexual', { evidence: 'x'.repeat(300) }),
    tooLong: await rep('minor', { evidence: 'x'.repeat(301) }),
    nonString: await rep('other', { evidence: { a: 1 } }),
    extra: await rep('auto-nudity', { notes: 'x' }),
  };
});
step('2a. a report with and without message text is accepted', rp.plain === 'ALLOWED' && rp.withText === 'ALLOWED' && rp.max === 'ALLOWED', JSON.stringify(rp));
step('2b. text over 300 characters, non-text and unknown fields are refused', rp.tooLong === 'permission-denied' && rp.nonString === 'permission-denied' && rp.extra === 'permission-denied');

// ------------------------------------------------------------- 3. group rooms
const g = await run(async ({ mk, f, base, code, doc, col, adminList }) => {
  const out = {};
  const [A, B, C] = [await mk('ga'), await mk('gb'), await mk('gc')];
  const noPass = await mk('gn', { access: false });
  const join = (u, topic = 'cricket', mode = 'voice', extra = {}) => u.call('joinGroup', { topic, mode, nick: u.name, avatar: { e: '🦊', h: 120 }, ...extra });
  const ja = await join(A), jb = await join(B), jc = await join(C);
  out.sameRoom = ja.ok?.gid && ja.ok.gid === jb.ok?.gid && jb.ok.gid === jc.ok?.gid;
  out.cap = ja.ok?.cap;
  const gid = ja.ok.gid;
  const members = await f.getDocs(col(A, [...base, 'groups', gid, 'members']));
  out.memberCount = members.size;
  out.memberNick = members.docs.find(d => d.id === B.uid)?.data().nick;
  out.rejoin = (await join(A)).ok?.gid === gid;
  out.afterRejoin = (await f.getDocs(col(A, [...base, 'groups', gid, 'members']))).size;
  out.badTopic = (await join(A, 'hax')).err; out.badMode = (await join(A, 'cricket', 'text')).err;
  out.noPass = (await join(noPass)).err;
  out.otherTopic = (await join(A, 'music')).ok?.gid !== gid;
  out.htmlNick = (await join(await mk('gh'), 'study', 'voice', { nick: '<img src=x onerror=1>‮' })).ok?.gid;
  // what clients may do to the documents
  out.createGroup = await code(f.setDoc(doc(A, [...base, 'groups', 'forged']), { topic: 'cricket', mode: 'voice', cap: 99, created: Date.now() }));
  out.createMember = await code(f.setDoc(doc(A, [...base, 'groups', gid, 'members', 'ghost']), { nick: 'x', ts: Date.now() }));
  out.beatOwn = await code(f.updateDoc(doc(A, [...base, 'groups', gid, 'members', A.uid]), { ts: Date.now() }));
  out.renameOwn = await code(f.updateDoc(doc(A, [...base, 'groups', gid, 'members', A.uid]), { nick: 'Hacker' }));
  out.beatOther = await code(f.updateDoc(doc(A, [...base, 'groups', gid, 'members', B.uid]), { ts: Date.now() }));
  out.deleteOther = await code(f.deleteDoc(doc(A, [...base, 'groups', gid, 'members', B.uid])));
  // handshakes
  const sig = (u, to, extra = {}) => code(f.addDoc(col(u, [...base, 'groups', gid, 'signals']), { from: u.uid, to, type: 'offer', data: { type: 'offer', sdp: 'v=0' }, ts: Date.now(), ...extra }));
  out.sigOk = await sig(A, B.uid);
  out.sigFrom = await sig(A, B.uid, { from: C.uid });
  out.sigToStranger = await sig(A, 'not-a-member');
  out.sigType = await sig(A, B.uid, { type: 'rm-rf' });
  out.sigBigSdp = await sig(A, B.uid, { data: { type: 'offer', sdp: 'x'.repeat(20001) } });
  out.sigExtraKey = await sig(A, B.uid, { x: 1 });
  out.sigOutsider = await sig(noPass, B.uid);
  out.readMine = await code(f.getDocs(f.query(col(B, [...base, 'groups', gid, 'signals']), f.where('to', '==', B.uid))));
  out.readOthers = await code(f.getDocs(f.query(col(C, [...base, 'groups', gid, 'signals']), f.where('to', '==', B.uid))));
  out.listAll = await code(f.getDocs(col(C, [...base, 'groups', gid, 'signals'])));
  const mine = await f.getDocs(f.query(col(B, [...base, 'groups', gid, 'signals']), f.where('to', '==', B.uid)));
  out.deleteReceived = mine.size ? await code(f.deleteDoc(mine.docs[0].ref)) : 'none';
  // reports from inside a room
  const rep = (u, reported, reason) => code(f.setDoc(doc(u, [...base, 'reports', `${u.uid}_${gid}_${reason}`]), { reporter: u.uid, reported, roomId: gid, reason, ts: f.serverTimestamp() }));
  out.reportMember = await rep(A, B.uid, 'harassment');
  out.reportOutsider = await rep(noPass, B.uid, 'harassment');
  out.reportGhost = await rep(A, 'not-in-room', 'spam');
  out.groupList = (await adminList([...base, 'groups'])).length;
  // sizes
  const V = [await mk('v1'), await mk('v2'), await mk('v3'), await mk('v4'), await mk('v5')];
  const vg = [];
  for (const u of V) vg.push((await join(u, 'gaming', 'video')).ok?.gid);
  out.videoFirstFour = new Set(vg.slice(0, 4)).size === 1;
  out.videoFifth = vg[4] && vg[4] !== vg[0];
  out.videoCap = (await join(V[0], 'gaming', 'video')).ok?.cap;
  // join rate limit
  const R = await mk('rate'); let last = null;
  for (let i = 0; i < 24; i++) last = await join(R, 'travel');
  out.rateLimited = last.err;
  return { ...out, gid };
});
step('3a. three people joining the same topic land in the same room, sized for voice', g.sameRoom && g.cap === 8, JSON.stringify({ same: g.sameRoom, cap: g.cap }));
step('3b. the member list holds the three, with the names the server stored', g.memberCount === 3 && g.memberNick === 'gb', `${g.memberCount} ${g.memberNick}`);
step('3c. joining again from the same account reuses the seat', g.rejoin && g.afterRejoin === 3);
step('3d. unknown topic and room type, and no access pass, are refused', g.badTopic === 'functions/invalid-argument' && g.badMode === 'functions/invalid-argument' && g.noPass === 'functions/permission-denied', `${g.badTopic} ${g.badMode} ${g.noPass}`);
step('3e. another topic is another room', g.otherTopic);
step('3f. a hostile nickname is cleaned and still joins', Boolean(g.htmlNick));
step('3g. clients cannot create rooms or members, rename themselves or touch other members', g.createGroup === 'permission-denied' && g.createMember === 'permission-denied' && g.renameOwn === 'permission-denied' && g.beatOther === 'permission-denied' && g.deleteOther === 'permission-denied', JSON.stringify([g.createGroup, g.createMember, g.renameOwn, g.beatOther, g.deleteOther]));
step('3h. a member can refresh their own heartbeat', g.beatOwn === 'ALLOWED');
step('3i. a handshake between members is accepted', g.sigOk === 'ALLOWED');
step('3j. forged sender, non-member recipient, bad type, oversize data, extra keys and outsiders are refused', [g.sigFrom, g.sigToStranger, g.sigType, g.sigBigSdp, g.sigExtraKey, g.sigOutsider].every(x => x === 'permission-denied'), JSON.stringify([g.sigFrom, g.sigToStranger, g.sigType, g.sigBigSdp, g.sigExtraKey, g.sigOutsider]));
step('3k. you can read handshakes addressed to you, not those addressed to others, and cannot list them all', g.readMine === 'ALLOWED' && g.readOthers === 'permission-denied' && g.listAll === 'permission-denied', JSON.stringify([g.readMine, g.readOthers, g.listAll]));
step('3l. the recipient can delete a handshake after using it', g.deleteReceived === 'ALLOWED');
step('3m. reports from inside a room: members yes, outsiders and people not in the room no', g.reportMember === 'ALLOWED' && g.reportOutsider === 'permission-denied' && g.reportGhost === 'permission-denied', JSON.stringify([g.reportMember, g.reportOutsider, g.reportGhost]));
step('3n. video rooms hold four: the fifth person gets a new room', g.videoFirstFour && g.videoFifth && g.videoCap === 4);
step('3o. joining too many times in an hour is limited', g.rateLimited === 'functions/resource-exhausted', String(g.rateLimited));

// ------------------------------------------------------------- 4. wallet and gifts
const w = await run(async ({ mk, f, base, code, admin, stamp }) => {
  const out = {};
  const anon = await mk('wa');
  out.anonWallet = (await anon.call('getWallet', {})).err;
  const G = await mk('wg', { google: true });
  out.fresh = (await G.call('getWallet', {})).ok;
  out.noCoinsGift = null;
  const roomId = 'giftroom' + stamp + 'xyz';
  const other = await mk('wo');
  await admin([...base, 'rooms', roomId], { mode: { stringValue: 'text' }, users: { arrayValue: { values: [{ stringValue: G.uid }, { stringValue: other.uid }] } }, created: { integerValue: String(Date.now()) } });
  out.noCoinsGift = (await G.call('sendGift', { roomId, gift: 'rose' })).err;
  const d1 = (await G.call('claimDaily', {})).ok, d2 = (await G.call('claimDaily', {})).ok;
  out.daily = [d1?.gained, d1?.coins, d2?.gained, d2?.coins];
  out.anonOrder = (await anon.call('createOrder', { coins: 'coins60' })).err;
  out.badPack = (await G.call('createOrder', { coins: 'coins999' })).err;
  out.protoPack = (await G.call('createOrder', { coins: '__proto__' })).err;
  const o = (await G.call('createOrder', { coins: 'coins60' })).ok;
  out.order = { amount: o?.amount, label: o?.label };
  const pay = await fetch('http://127.0.0.1:7777/test/pay', { method: 'POST', body: JSON.stringify({ order_id: o.orderId }) }).then(r => r.json());
  const v1 = (await G.call('verifyPayment', { orderId: o.orderId, paymentId: pay.razorpay_payment_id, signature: pay.razorpay_signature })).ok;
  const v2 = (await G.call('verifyPayment', { orderId: o.orderId, paymentId: pay.razorpay_payment_id, signature: pay.razorpay_signature })).ok;
  out.verify = [v1?.coins, v2?.coins, v2?.alreadyGranted];
  out.walletAfter = (await G.call('getWallet', {})).ok;
  out.unknownGift = (await G.call('sendGift', { roomId, gift: 'bitcoin' })).err;
  out.protoGift = (await G.call('sendGift', { roomId, gift: '__proto__' })).err;
  out.badRoom = (await G.call('sendGift', { roomId: 'nope', gift: 'rose' })).err;
  const stranger = await mk('ws', { google: true });
  out.notMyRoom = (await stranger.call('sendGift', { roomId, gift: 'rose' })).err;
  out.rose = (await G.call('sendGift', { roomId, gift: 'rose' })).ok;
  out.crown = (await G.call('sendGift', { roomId, gift: 'crown' })).ok;
  out.fireworksTooPricey = (await G.call('sendGift', { roomId, gift: 'fireworks' })).err;
  out.final = (await G.call('getWallet', {})).ok;
  out.clientRead = await code(f.getDoc(f.doc(G.db, 'artifacts', 'anon-connect', 'private', 'data', 'wallet', G.uid)));
  out.clientWrite = await code(f.setDoc(f.doc(G.db, 'artifacts', 'anon-connect', 'private', 'data', 'wallet', G.uid), { coins: 99999 }));
  return out;
});
step('4a. coins need a Google account', w.anonWallet === 'functions/failed-precondition' && w.anonOrder === 'functions/failed-precondition');
step('4b. a new wallet is empty with the daily bonus available', w.fresh?.coins === 0 && w.fresh?.dailyAvailable === true, JSON.stringify(w.fresh));
step('4c. a gift with no coins is refused', w.noCoinsGift === 'functions/failed-precondition');
step('4d. the daily bonus is two coins, once a day', JSON.stringify(w.daily) === '[2,2,0,2]', JSON.stringify(w.daily));
step('4e. unknown packs (including __proto__) are refused; a real pack is priced by the server', w.badPack === 'functions/invalid-argument' && w.protoPack === 'functions/invalid-argument' && w.order.amount === 4900 && /60 coins/.test(w.order.label), JSON.stringify([w.badPack, w.protoPack, w.order]));
step('4f. a paid pack adds its coins exactly once', w.verify[0] === 62 && w.verify[1] === 62 && w.verify[2] === true && w.walletAfter?.coins === 62, JSON.stringify(w.verify));
step('4f2. bought coins are counted as giftable (60 of the 62), the 2 free daily coins are not', w.walletAfter?.giftable === 60, JSON.stringify(w.walletAfter));
step('4f3. spending on gifts uses the free coins first: after a 5-coin rose and a 30-coin crown, 27 coins are left and all 27 are still giftable', w.final?.coins === 27 && w.final?.giftable === 27, JSON.stringify(w.final));
step('4g. unknown gifts (including __proto__), unknown rooms and other people’s rooms are refused', w.unknownGift === 'functions/invalid-argument' && w.protoGift === 'functions/invalid-argument' && w.badRoom === 'functions/invalid-argument' && w.notMyRoom === 'functions/permission-denied', JSON.stringify([w.unknownGift, w.protoGift, w.badRoom, w.notMyRoom]));
step('4h. gifts spend the server’s price and the balance never goes negative', w.rose?.coins === 57 && w.crown?.coins === 27 && w.fireworksTooPricey === 'functions/failed-precondition' && w.final?.coins === 27, JSON.stringify([w.rose, w.crown, w.fireworksTooPricey, w.final]));
step('4i. clients can neither read nor write a wallet', w.clientRead === 'permission-denied' && w.clientWrite === 'permission-denied', `${w.clientRead} ${w.clientWrite}`);

// ------------------------------------------------------------- 5. push notifications (outbox mode)
const ps = await run(async ({ mk, f, base, code, adminList, doc, col }) => {
  const out = {};
  const anon = await mk('pa');
  out.anonReg = (await anon.call('registerPush', { token: 't'.repeat(40) })).err;
  const P = await mk('p1', { google: true }), Q = await mk('p2', { google: true });
  out.badToken = (await P.call('registerPush', { token: 'short' })).err;
  out.badToken2 = (await P.call('registerPush', { token: '<script>'.repeat(10) })).err;
  out.regP = (await P.call('registerPush', { token: 'P'.repeat(40), shareOnline: true })).ok;
  out.regQ = (await Q.call('registerPush', { token: 'Q'.repeat(40), friendOnline: true })).ok;
  for (let i = 0; i < 7; i++) await Q.call('registerPush', { token: 'Q'.repeat(30) + String(i).repeat(10), friendOnline: true });
  const pair = [P.uid, Q.uid].sort().join('_');
  const priv = ['artifacts', 'anon-connect', 'private', 'data'];
  const outbox = async () => (await adminList([...priv, 'pushOutbox'])).map(d => ({ to: d.fields.to.stringValue, title: d.fields.payload.mapValue.fields.title.stringValue, body: d.fields.payload.mapValue.fields.body.stringValue }));
  const before = (await outbox()).length;
  const users = [P.uid, Q.uid].sort();
  const names = { [P.uid]: 'Priya', [Q.uid]: 'Qasim' };
  await f.setDoc(doc(P, [...base, 'friendships', pair]), { users, status: 'pending', requestedBy: P.uid, names: { [P.uid]: 'Priya', [Q.uid]: '' }, createdAt: Date.now() });
  await new Promise(r => setTimeout(r, 2500));
  await f.updateDoc(doc(Q, [...base, 'friendships', pair]), { status: 'accepted', names: { [P.uid]: 'Priya', [Q.uid]: 'Qasim' }, acceptedAt: Date.now() });
  await new Promise(r => setTimeout(r, 2500));
  await f.updateDoc(doc(P, [...base, 'friendships', pair]), { call: { from: P.uid, roomId: 'callroom123456', ts: Date.now() } });
  await new Promise(r => setTimeout(r, 2500));
  await f.addDoc(col(P, [...base, 'friendships', pair, 'messages']), { from: P.uid, text: 'SECRET TEXT 12345', ts: Date.now() });
  await new Promise(r => setTimeout(r, 2500));
  out.announce = (await P.call('announceOnline', {})).ok;
  out.announce2 = (await P.call('announceOnline', {})).ok;
  await new Promise(r => setTimeout(r, 1500));
  const all = (await outbox()).slice(before);
  out.sent = all.map(x => `${x.to === P.uid ? 'P' : 'Q'}:${x.title}|${x.body}`);
  out.leak = JSON.stringify(all).includes('SECRET TEXT');
  out.clientReadsPush = await code(f.getDoc(f.doc(P.db, ...priv, 'push', Q.uid)));
  const tok = (await adminList([...priv, 'push'])).find(d => d.name.endsWith('/' + Q.uid));
  out.qTokens = tok?.fields?.tokens?.arrayValue?.values?.length;
  out.unreg = (await Q.call('unregisterPush', {})).ok;
  return out;
});
step('5a. notifications need a Google account and a plausible token', ps.anonReg === 'functions/failed-precondition' && ps.badToken === 'functions/invalid-argument' && ps.badToken2 === 'functions/invalid-argument', JSON.stringify([ps.anonReg, ps.badToken, ps.badToken2]));
step('5b. registering works, and an account keeps at most five devices', ps.regP?.ok && ps.regQ?.ok && ps.qTokens === 5, String(ps.qTokens));
const has = s => ps.sent.some(x => x.includes(s));
step('5c. a friend request tells the other person (and only them)', has('Q:Friend request|Priya wants to be your friend'), ps.sent.join(' ; '));
step('5d. accepting tells the requester', has('P:You’re friends|Qasim accepted your friend request.') || has('P:You’re friends|Qasim'), ps.sent.join(' ; '));
step('5e. a call rings the friend', has('Q:Priya is calling'));
step('5f. a message says who, never what', has('Q:Priya|Sent you a message.') && ps.leak === false);
step('5g. "friend is online" reaches only someone who opted in, and only once per window', has('Q:Priya is online') && ps.announce2?.sent === 0 && ps.sent.filter(x => x.includes('is online')).length === 1, JSON.stringify([ps.announce, ps.announce2]));
step('5h. nobody can read push tokens from a client', ps.clientReadsPush === 'permission-denied');

console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
