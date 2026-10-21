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
const fakeCheckout = `window.Razorpay = class { constructor(o) { this.o = o; this.h = {}; } on(e, f) { this.h[e] = f; } async open() {
  if (window.__failFirst) { this.h['payment.failed']?.({ error: { description: 'Card declined' } }); await new Promise(r => setTimeout(r, 300)); }
  const r = await fetch('http://127.0.0.1:7777/test/pay', { method: 'POST', body: JSON.stringify({ order_id: this.o.order_id }) }).then(r => r.json());
  window.__checkoutOpts = { key: this.o.key, amount: this.o.amount, currency: this.o.currency, description: this.o.description };
  this.o.handler(r); } };`;
const run = Date.now();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const logs = [];
async function device(name) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
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
  const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8') + '\nwindow.__test = { sendData, get session() { return S.session; } };';
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
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


const A = await device('Asha'), B = await device('Bilal'), C = await device('Chen');
const signIn = async p => { await p.click('#premiumBtn'); await p.click('#paywallCta'); await p.waitForFunction(() => /Signed in as/.test(document.getElementById('toasts').textContent), null, { timeout: 15000 }); await p.click('#paywallClose'); };
await signIn(A); await signIn(B); await signIn(C);
const uidOf = p => p.evaluate(async () => (await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js')).getAuth().currentUser.uid);
const [ua, ub, uc] = [await uidOf(A), await uidOf(B), await uidOf(C)];

// F1. Non-boolean premium flag is refused
const f1 = await sdk(A, ({ db, f, base, auth, tryIt }) => tryIt(() => f.setDoc(f.doc(db, ...base, 'queue', auth.currentUser.uid), { mode: 'text', premium: 'yes', genderFilter: 'any', countryFilter: 'any', ts: Date.now(), roomId: null })));
step('F1. queue entry with premium:"yes" refused', f1 !== 'ALLOWED', f1);

// F2. Blocked user can't claim; fake room claim refused; legit claim allowed
const f2 = await sdk(B, async ({ db, f, base, auth, tryIt, arg }) => {
  const me = auth.currentUser.uid, q = id => f.doc(db, ...base, 'queue', id);
  // B queues itself; A (victim) is queued with B in its block list (written by A below)
  await f.setDoc(q(me), { mode: 'text', interests: [], blocked: [], gender: 'x', country: '', genderFilter: 'any', countryFilter: 'any', premium: false, ts: Date.now(), roomId: null });
  return me;
});
await sdk(A, ({ db, f, base, auth, arg }) => f.setDoc(f.doc(db, ...base, 'queue', auth.currentUser.uid), { mode: 'text', interests: [], blocked: [arg], gender: 'x', country: '', genderFilter: 'any', countryFilter: 'any', premium: false, ts: Date.now(), roomId: null }), ub);
const claim = (p, target, { fakeRoom = false } = {}) => sdk(p, async ({ db, f, base, auth, tryIt, arg }) => {
  const me = auth.currentUser.uid;
  const roomRef = f.doc(f.collection(db, ...base, 'rooms'));
  return tryIt(() => f.runTransaction(db, async t => {
    await t.get(f.doc(db, ...base, 'queue', arg.target));
    t.update(f.doc(db, ...base, 'queue', arg.target), { roomId: arg.fakeRoom ? 'no-such-room' : roomRef.id, partnerId: me });
    if (!arg.fakeRoom) t.set(roomRef, { mode: 'text', users: [arg.target, me], created: f.serverTimestamp() });
  }));
}, { target, fakeRoom });
step('F2a. blocked user cannot claim their blocker', (await claim(B, ua)) !== 'ALLOWED');
// C queues and claims A with a fake room id -> refused; with a real room -> allowed
await sdk(C, ({ db, f, base, auth }) => f.setDoc(f.doc(db, ...base, 'queue', auth.currentUser.uid), { mode: 'text', interests: [], blocked: [], gender: 'x', country: '', genderFilter: 'any', countryFilter: 'any', premium: false, ts: Date.now(), roomId: null }));
step('F2b. claim pointing at a non-existent room refused', (await claim(C, ua, { fakeRoom: true })) !== 'ALLOWED');
step('F2c. legitimate claim (real room, not blocked) allowed', (await claim(C, ua)) === 'ALLOWED');
for (const p of [A, B, C]) await sdk(p, ({ db, f, base, auth }) => f.deleteDoc(f.doc(db, ...base, 'queue', auth.currentUser.uid)).catch(() => {}));

// F3. Friend consent bypass: A (attacker) pushes friend-req + friend-created; B never clicks Accept
await A.click('#startBtn'); await B.click('#startBtn');
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 20000 }).then(() => true, () => false);
await live(A); await live(B);
const pair = [ua, ub].sort().join('_');
await A.evaluate(u => window.__test.sendData({ t: 'friend-req', uid: u }), ua);
await sdk(A, ({ db, f, base, auth, arg }) => f.setDoc(f.doc(db, ...base, 'friendships', arg.pair), { users: arg.pair.split('_'), status: 'pending', requestedBy: auth.currentUser.uid, names: { [auth.currentUser.uid]: 'Asha' }, createdAt: Date.now() }), { pair });
await A.evaluate(p => window.__test.sendData({ t: 'friend-created', pairId: p }), pair);
await B.waitForTimeout(2500);
const status = await sdk(A, async ({ db, f, base, arg }) => (await f.getDoc(f.doc(db, ...base, 'friendships', arg))).data()?.status, pair);
step('F3. friendship NOT accepted without the victim clicking Accept', status === 'pending', status);

// F4. The other person can re-send over a stale pending request
const f4 = await sdk(B, ({ db, f, base, auth, tryIt, arg }) => tryIt(() => f.setDoc(f.doc(db, ...base, 'friendships', arg), { users: arg.split('_'), status: 'pending', requestedBy: auth.currentUser.uid, names: { [auth.currentUser.uid]: 'Bilal' }, createdAt: Date.now() })), pair);
step('F4. other person can take over a stale pending request', f4 === 'ALLOWED', f4);

// F5. Malformed names refused
const f5 = await sdk(C, ({ db, f, base, auth, tryIt, arg }) => {
  const users = [auth.currentUser.uid, arg].sort();
  return tryIt(() => f.setDoc(f.doc(db, ...base, 'friendships', users.join('_')), { users, status: 'pending', requestedBy: auth.currentUser.uid, names: { [auth.currentUser.uid]: { evil: true } }, createdAt: Date.now() }));
}, ua);
step('F5. friendship with non-string name refused', f5 !== 'ALLOWED', f5);

// F10. Reports: only about someone you were in a room with
const roomId = await B.evaluate(() => window.__test.session?.roomId);
const rep = (p, reason, id) => sdk(p, ({ db, f, base, auth, tryIt, arg }) => tryIt(() => {
  const col = f.collection(db, ...base, 'reports');
  const data = { reporter: auth.currentUser.uid, reported: arg.ua, roomId: arg.roomId, reason: arg.reason, ts: f.serverTimestamp() };
  return arg.id === 'random' ? f.addDoc(col, data) : f.setDoc(f.doc(col, auth.currentUser.uid + '_' + arg.roomId + '_' + arg.reason), data);
}), { ua, roomId, reason, id });
const f10a = await rep(C, 'auto-nudity');
const f10b = await rep(B, 'spam');
step('F10. outsider cannot report; chat partner can', f10a !== 'ALLOWED' && f10b === 'ALLOWED', `${f10a} / ${f10b}`);
const f10c = await rep(B, 'harassment', 'random');
const f10d = await rep(B, 'spam');
step('F10b. a report under a made-up document id is refused, and a second identical report cannot overwrite the first', f10c === 'permission-denied' && f10d === 'permission-denied', `${f10c} / ${f10d}`);

// F12. Rooms cannot be forged: only a real queue claim (server time) or an accepted friendship creates one
const forge = (p, members, extra = {}, created = 'server') => sdk(p, ({ db, f, base, tryIt, arg }) => tryIt(() => f.setDoc(f.doc(f.collection(db, ...base, 'rooms')), { mode: 'text', users: arg.members, created: arg.created === 'server' ? f.serverTimestamp() : arg.created, ...arg.extra })), { members, extra, created });
const f12 = [await forge(C, [uc, ua]), await forge(C, [uc, ub], {}, Date.now() - 60000), await forge(C, [uc, ua], { friendship: [uc, ua].sort().join('_') }, Date.now()), await forge(C, [uc, uc])];
step('F12. a browser cannot create a room outside matchmaking: victim not queued, back-dated, fake friendship, self room', f12.every(x => x === 'permission-denied'), f12.join(','));

// F13. Signalling messages: only the four WebRTC kinds, bounded size, only members
const sig = (p, d) => sdk(p, ({ db, f, base, auth, tryIt, arg }) => tryIt(() => f.addDoc(f.collection(db, ...base, 'rooms', arg.roomId, 'signals'), { from: auth.currentUser.uid, ts: Date.now(), ...arg.d })), { roomId, d });
const f13 = {
  offer: await sig(B, { type: 'offer', data: { type: 'offer', sdp: 'v=0\r\n'.repeat(50) } }),
  cand: await sig(B, { type: 'candidate', data: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: null, sdpMLineIndex: 0, usernameFragment: 'abcd' } }),
  bye: await sig(B, { type: 'bye', data: null }),
  bigSdp: await sig(B, { type: 'offer', data: { type: 'offer', sdp: 'x'.repeat(20001) } }),
  badType: await sig(B, { type: 'chat', data: null }),
  extraKey: await sig(B, { type: 'bye', data: null, note: 'free storage' }),
  extraDataKey: await sig(B, { type: 'offer', data: { sdp: 'v=0', blob: 'x' } }),
  outsider: await sig(C, { type: 'bye', data: null }),
};
step('F13. valid offer / candidate / bye are allowed; oversize SDP, unknown type, extra fields and non-members are refused',
  ['offer', 'cand', 'bye'].every(k => f13[k] === 'ALLOWED') && ['bigSdp', 'badType', 'extraKey', 'extraDataKey', 'outsider'].every(k => f13[k] === 'permission-denied'), JSON.stringify(f13));

// F11. Presence with a far-future timestamp refused
const f11 = await sdk(C, ({ db, f, base, auth, tryIt }) => tryIt(() => f.setDoc(f.doc(db, ...base, 'presence', auth.currentUser.uid), { ts: Date.now() + 1e9 })));
step('F11. presence far in the future refused', f11 !== 'ALLOWED', f11);

// F14. Premium status is private; the badge check is a yes/no function that only answers about your chat partner
const f14 = await sdk(C, async ({ db, f, base, call, tryIt, arg }) => ({
  other: await tryIt(() => f.getDoc(f.doc(db, ...base, 'entitlements', arg.ub))),
  mine: await tryIt(() => f.getDoc(f.doc(db, ...base, 'entitlements', 'whoever-is-me-is-fine-but-not-others')).then(() => { throw Object.assign(new Error('x'), { code: 'ok-own-check-skipped' }); })),
  outsider: (await call('partnerPremium', { roomId: arg.roomId })).err,
}), { ub, roomId });
const f14b = await sdk(B, ({ call, arg }) => call('partnerPremium', { roomId: arg.roomId }), { roomId });
step('F14. another user\'s entitlement is unreadable; partnerPremium refuses a non-member and answers a member with only {premium}', f14.other === 'permission-denied' && f14.outsider === 'functions/permission-denied' && f14b.ok && Object.keys(f14b.ok).join() === 'premium', JSON.stringify({ f14, f14b }));

// F15. Queue entries cannot carry huge list items; presence has no free-form field; nothing is writable under another app id
const q = (extra) => ({ mode: 'text', interests: [], blocked: [], gender: 'x', country: '', genderFilter: 'any', countryFilter: 'any', premium: false, ts: Date.now(), roomId: null, ...extra });
const f15 = await sdk(C, async ({ db, f, base, auth, tryIt }) => {
  const me = auth.currentUser.uid, qd = id => f.doc(db, ...base, 'queue', id);
  const out = {};
  out.bigInterests = await tryIt(() => f.setDoc(qd(me), { mode: 'text', interests: Array(5).fill('x'.repeat(100000)), blocked: [], gender: 'x', country: '', genderFilter: 'any', countryFilter: 'any', premium: false, ts: Date.now(), roomId: null }));
  out.bigBlocked = await tryIt(() => f.setDoc(qd(me), { mode: 'text', interests: [], blocked: Array(100).fill('y'.repeat(2000)), gender: 'x', country: '', genderFilter: 'any', countryFilter: 'any', premium: false, ts: Date.now(), roomId: null }));
  out.nonString = await tryIt(() => f.setDoc(qd(me), { mode: 'text', interests: [{ a: 1 }], blocked: [], gender: 'x', country: '', genderFilter: 'any', countryFilter: 'any', premium: false, ts: Date.now(), roomId: null }));
  out.normal = await tryIt(() => f.setDoc(qd(me), { mode: 'text', interests: ['cricket', 'music'], blocked: [], gender: 'x', country: 'IN', genderFilter: 'any', countryFilter: 'any', premium: false, ts: Date.now(), roomId: null }));
  await f.deleteDoc(qd(me)).catch(() => {});
  out.presenceBad = await tryIt(() => f.setDoc(f.doc(db, ...base, 'presence', me), { ts: Date.now(), status: 'x'.repeat(100000) }));
  out.presenceOk = await tryIt(() => f.setDoc(f.doc(db, ...base, 'presence', me), { ts: Date.now(), status: 'online' }));
  out.otherApp = await tryIt(() => f.setDoc(f.doc(db, 'artifacts', 'some-other-app', 'public', 'data', 'presence', me), { ts: Date.now() }));
  out.skewedClock = await tryIt(() => f.setDoc(f.doc(db, ...base, 'presence', me), { ts: Date.now() + 200000 })); // a phone clock ~3 minutes fast still works
  return out;
});
step('F15. oversized / non-string queue lists, free-form presence, other app ids refused; normal entries and a 3-minute-fast clock work',
  ['bigInterests', 'bigBlocked', 'nonString', 'presenceBad', 'otherApp'].every(k => f15[k] === 'permission-denied') && ['normal', 'presenceOk', 'skewedClock'].every(k => f15[k] === 'ALLOWED'), JSON.stringify(f15));

// F16. Dead queue entries: anyone can clear one nobody refreshed for 3 minutes, but not a live one; a stale target cannot be claimed into a room
const admin = (path, fields) => `fetch('http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/${path}', { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: ${JSON.stringify(fields)} }) })`;
const f16 = await sdk(C, async ({ db, f, base, auth, tryIt }) => {
  const adminPut = (id, ts) => fetch(`http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/artifacts/anon-connect/public/data/queue/${id}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { mode: { stringValue: 'text' }, ts: { integerValue: String(ts) }, interests: { arrayValue: {} }, blocked: { arrayValue: {} }, gender: { stringValue: 'x' }, country: { stringValue: '' }, genderFilter: { stringValue: 'any' }, countryFilter: { stringValue: 'any' }, premium: { booleanValue: false } } }) });
  const me = auth.currentUser.uid, qd = id => f.doc(db, ...base, 'queue', id);
  const out = {};
  await adminPut('zz-stale-victim', Date.now() - 400000);
  await adminPut('zz-fresh-victim', Date.now());
  await adminPut('zz-semi-stale', Date.now() - 120000); // 2 min old: too old to claim, too fresh to clear
  await f.setDoc(qd(me), { mode: 'text', interests: [], blocked: [], gender: 'x', country: '', genderFilter: 'any', countryFilter: 'any', premium: false, ts: Date.now(), roomId: null });
  out.deleteFresh = await tryIt(() => f.deleteDoc(qd('zz-fresh-victim')));
  out.deleteSemi = await tryIt(() => f.deleteDoc(qd('zz-semi-stale')));
  const claim = async target => { const ref = f.doc(f.collection(db, ...base, 'rooms')); return tryIt(() => f.runTransaction(db, async t => { await t.get(qd(target)); t.update(qd(target), { roomId: ref.id, partnerId: me }); t.set(ref, { mode: 'text', users: [target, me], created: f.serverTimestamp() }); })); };
  out.claimSemiStale = await claim('zz-semi-stale');
  out.claimFresh = await claim('zz-fresh-victim');
  out.deleteStale = await tryIt(() => f.deleteDoc(qd('zz-stale-victim')));
  // (a searching client in the test may already have cleared that dead entry itself: then it is gone, which is the point)
  out.staleGone = (await fetch('http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/artifacts/anon-connect/public/data/queue/zz-stale-victim', { headers: { Authorization: 'Bearer owner' } })).status === 404;
  await f.deleteDoc(qd(me)).catch(() => {});
  await f.deleteDoc(qd('zz-fresh-victim')).catch(() => {});
  await fetch('http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/artifacts/anon-connect/public/data/queue/zz-semi-stale', { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  return out;
});
step('F16. a live queue entry cannot be deleted by others, a 3-minute-dead one can; a target not refreshed for a minute cannot be claimed into a room, a live one can',
  f16.deleteFresh === 'permission-denied' && f16.deleteSemi === 'permission-denied' && (f16.deleteStale === 'ALLOWED' || f16.staleGone) && f16.staleGone && f16.claimSemiStale === 'permission-denied' && f16.claimFresh === 'ALLOWED', JSON.stringify(f16));

// F18. Relay credentials: short-lived, only the browser-safe fields, no port-53 URLs, one shared credential, never without a login
const f18 = await sdk(B, async ({ call }) => ({ b: await call('turnCredentials', {}) }));
const f18c = await sdk(C, async ({ call }) => ({ c: await call('turnCredentials', {}) }));
const rel = f18.b.ok?.iceServers?.[0];
const f18anon = await fetch('http://127.0.0.1:5001/demo-ohmygoal/asia-south1/turnCredentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}' }).then(r => r.json()).catch(() => null);
step('F18. turnCredentials: signed-in person with a pass gets a short-lived TURN credential (no :53 URLs, TTL 3-4 h), shared between people; no login = refused',
  Boolean(rel) && rel.urls.some(u => /^turn:/.test(u)) && rel.urls.some(u => /^turns:/.test(u)) && !rel.urls.some(u => /:53(\?|$)/.test(u)) && Object.keys(rel).sort().join() === 'credential,urls,username'
  && f18.b.ok.ttl > 3 * 3600 - 120 && f18.b.ok.ttl <= 4 * 3600 && f18c.c.ok?.iceServers?.[0]?.username === rel.username && f18anon?.error?.status === 'UNAUTHENTICATED',
  JSON.stringify({ rel: rel && { u: rel.username, n: rel.urls.length }, ttl: f18.b.ok?.ttl, same: f18c.c.ok?.iceServers?.[0]?.username === rel.username, anon: f18anon?.error?.status }));

// F17. Reports need server time (so junk timestamps can't pin the admin list); removing a friend can clear the saved chat
const f17 = await sdk(B, async ({ db, f, base, auth, tryIt, arg }) => {
  const rep = async ts => { try { await f.setDoc(f.doc(f.collection(db, ...base, 'reports'), auth.currentUser.uid + '_' + arg.roomId + '_other'), { reporter: auth.currentUser.uid, reported: arg.ua, roomId: arg.roomId, reason: 'other', ts: ts === 'server' ? f.serverTimestamp() : ts }); return 'ALLOWED'; } catch (e) { return e.code + ' ' + String(e.message).slice(0, 80) + ' ' + auth.currentUser.uid.slice(0, 4) + ' ' + arg.roomId.slice(0, 4); } };
  return { junk: await rep('zzz'), map: await rep({}), client: await rep(Date.now()), server: await rep('server') };
}, { ua, roomId });
step('F17a. a report with a junk / client-chosen timestamp is refused; with server time it is accepted', /^permission-denied/.test(f17.junk) && /^permission-denied/.test(f17.map) && /^permission-denied/.test(f17.client) && f17.server === 'ALLOWED', JSON.stringify(f17));
const pairAB = [ua, ub].sort().join('_');
const f17b = await sdk(A, async ({ db, f, base, auth, tryIt, arg }) => {
  const fr = f.doc(db, ...base, 'friendships', arg.pair);
  // (the pair is friends here from F3/F4 only if accepted: make it accepted through B's accept path first)
  const out = {};
  const st = (await f.getDoc(fr)).data()?.status;
  out.status = st;
  return out;
}, { pair: pairAB });
await sdk(A, ({ db, f, base, auth, arg }) => f.updateDoc(f.doc(db, ...base, 'friendships', arg), { status: 'accepted', acceptedAt: Date.now(), ['names.' + auth.currentUser.uid]: 'Asha' }), pairAB).catch(() => {}); // B took over the request in F4, so A accepts
const f17c = await sdk(A, async ({ db, f, base, auth, tryIt, arg }) => {
  const fr = f.doc(db, ...base, 'friendships', arg.pair);
  const out = {};
  out.send = await tryIt(() => f.addDoc(f.collection(fr, 'messages'), { from: auth.currentUser.uid, text: 'hello friend', ts: Date.now() }));
  const snap = await f.getDocs(f.collection(fr, 'messages'));
  out.before = snap.size;
  const batch = f.writeBatch(db); snap.docs.forEach(d => batch.delete(d.ref));
  out.deleteMsgs = await tryIt(() => batch.commit());
  out.after = (await f.getDocs(f.collection(fr, 'messages'))).size;
  out.removeFriend = await tryIt(() => f.deleteDoc(fr));
  return out;
}, { pair: pairAB });
const f17d = await sdk(C, async ({ db, f, base, tryIt, arg }) => tryIt(() => f.deleteDoc(f.doc(db, ...base, 'friendships', arg.pair, 'messages', 'nonexistent'))), { pair: pairAB });
step('F17b. a friend can clear the saved chat and then remove the friendship; an outsider cannot delete friend messages', f17c.send === 'ALLOWED' && f17c.before >= 1 && f17c.deleteMsgs === 'ALLOWED' && f17c.after === 0 && f17c.removeFriend === 'ALLOWED' && f17d === 'permission-denied', JSON.stringify({ f17c, f17d }));

await A.click('#leaveBtn'); await B.click('#leaveBtn');

// F7. Checkout: first attempt fails, retry succeeds in the same checkout -> still verified
await C.evaluate(() => { window.__failFirst = true; });
await C.click('#premiumBtn'); await C.click('#paywallCta');
const f7 = await C.waitForFunction(() => document.body.classList.contains('is-premium'), null, { timeout: 20000 }).then(() => true, () => false);
step('F7. failed-then-successful payment in one checkout is verified', f7);

// F9. A Premium user's saved Premium effect survives a reload
await C.evaluate(() => localStorage.setItem('ac.fx', JSON.stringify({ background: 'sunset', mask: 'none', filter: 'none' })));
await C.reload();
await C.waitForFunction(() => document.body.classList.contains('is-premium'), null, { timeout: 20000 }).catch(() => {});
await C.waitForTimeout(1000);
const fx = await C.evaluate(() => localStorage.getItem('ac.fx'));
step('F9. saved Premium effect kept after reload', /sunset/.test(fx) && await C.$eval('#fxBtn', b => b.classList.contains('on')), fx);

// F8. Order rate limit (10/hour)
const f8 = await sdk(B, async ({ call }) => { const r = []; for (let i = 0; i < 11; i++) r.push((await call('createOrder', { plan: 'week' })).err || 'ok'); return r; });
step('F8. 11th order within an hour is refused', f8.slice(0, 10).every(x => x === 'ok') && f8[10] === 'functions/resource-exhausted', f8.join(','));

// F6. Cancelling an outgoing friend call stops the ringing (make A and C friends first via the rules)
const pairAC = [ua, uc].sort().join('_');
await sdk(A, ({ db, f, base, auth, arg }) => f.setDoc(f.doc(db, ...base, 'friendships', arg), { users: arg.split('_'), status: 'pending', requestedBy: auth.currentUser.uid, names: { [auth.currentUser.uid]: 'Asha' }, createdAt: Date.now() }), pairAC);
await sdk(C, ({ db, f, base, auth, arg }) => f.updateDoc(f.doc(db, ...base, 'friendships', arg), { status: 'accepted', acceptedAt: Date.now(), ['names.' + auth.currentUser.uid]: 'Chen' }), pairAC);
await A.click('#friendsBtn'); await A.click('#friendList .friend', { timeout: 10000 });
await A.click('#fcCall');
const rang = await C.waitForSelector('#callModal:not(.hidden)', { timeout: 15000 }).then(() => true, () => false);
await A.click('#leaveBtn');
const stopped = await C.waitForSelector('#callModal.hidden', { state: 'attached', timeout: 10000 }).then(() => true, () => false);
step('F6. cancelled friend call stops ringing', rang && stopped, `rang=${rang} stopped=${stopped}`);

console.log('LOGS:', logs.slice(0, 8));
await browser.close();
