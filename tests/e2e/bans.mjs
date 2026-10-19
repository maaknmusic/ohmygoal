// End-to-end tests for server-side bans, access passes, unban requests and the admin page.
// Needs: Firebase emulators (auth, firestore, functions with ADMIN_EMAILS), http.server on 8765.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`);
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8')
  + '\nwindow.__t = { finishAttempt, selfViolation, startSearch, get access() { return access; }, S };\n';
const adminSrc = fs.readFileSync('/home/user/ohmygoal/js/admin.js', 'utf8');
const patchedAdmin = adminSrc.replace('await authMod.signInWithPopup(auth, provider);',
  'await authMod.signInWithCredential(auth, authMod.GoogleAuthProvider.credential(window.__adminToken));');
if (patchedAdmin === adminSrc) throw new Error('admin.js patch did not apply');

await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-ohmygoal/databases/(default)/documents', { method: 'DELETE' });

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const logs = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };

// The emulator doesn't see a client IP, so add X-Forwarded-For the way Google's front end does in production.
const HOME_IP = '198.51.100.7';
async function context({ fp, xff = HOME_IP } = {}) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': xff } }));
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|fonts\.g|country\.is|razorpay/, r => r.abort());
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route('**/js/admin.js', r => r.fulfill({ body: patchedAdmin, contentType: 'text/javascript' }));
  // A different device: same IP (127.0.0.1), different fingerprint.
  if (fp) await ctx.route('**/js/fingerprint.js', r => r.fulfill({ body: `export const deviceFingerprint = async () => '${fp}';`, contentType: 'text/javascript' }));
  return ctx;
}

/** Opens the chat app. Resolves once the server's access answer has been applied. */
async function device(name, { fp, xff, mode = 'text', banned = false } = {}) {
  const ctx = await context({ fp, xff });
  await ctx.addInitScript(mode => {
    localStorage.setItem('ac.hideIp', 'false'); localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    localStorage.setItem('ac.ageConfirmed', 'true');
    localStorage.setItem('ac.mode', JSON.stringify(mode));
  }, mode);
  const p = await ctx.newPage();
  p.name = name;
  p.on('pageerror', e => logs.push(name + ' PAGEERR ' + e.message));
  p.on('console', m => { if (/PAGEERR|Uncaught|TypeError|ReferenceError/i.test(m.text())) logs.push(name + ': ' + m.text().slice(0, 200)); });
  await p.goto('http://localhost:8765/index.html');
  await p.fill('#nickInput', name);
  await p.waitForFunction(() => window.__t?.access?.status, null, { timeout: 30000 });
  if (banned) await p.waitForSelector('#banned:not(.hidden)', { timeout: 5000 }).catch(() => {});
  return p;
}

async function adminPage(email) {
  const ctx = await context();
  await ctx.addInitScript(email => {
    window.__adminToken = JSON.stringify({ sub: 'g-' + email, email, email_verified: true });
  }, email);
  const p = await ctx.newPage();
  p.on('pageerror', e => logs.push('admin PAGEERR ' + e.message));
  await p.goto('http://localhost:8765/admin.html');
  await p.waitForSelector('#signin:not(.hidden)', { timeout: 20000 });
  await p.click('#signInBtn');
  await p.waitForFunction(() => !document.getElementById('panel').classList.contains('hidden')
    || /admin/.test(document.getElementById('signinMsg').textContent) && !document.getElementById('signin').classList.contains('hidden')
       && document.getElementById('signinMsg').textContent.includes('isn’t'), null, { timeout: 20000 }).catch(() => {});
  return p;
}

// Direct SDK access inside a page (acts as that page's user, or as a brand-new user with `fresh`).
const sdk = (p, fn, arg) => p.evaluate(async ([src, arg]) => {
  const appM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const authM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  const f = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const setup = async a => {
    const auth = authM.getAuth(a), db = f.getFirestore(a), fns = fnM.getFunctions(a, 'asia-south1');
    if (a.name !== '[DEFAULT]') {
      authM.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      f.connectFirestoreEmulator(db, '127.0.0.1', 8080);
      fnM.connectFunctionsEmulator(fns, '127.0.0.1', 5001);
      await authM.signInAnonymously(auth);
    } else { try { fnM.connectFunctionsEmulator(fns, '127.0.0.1', 5001); } catch {} }
    const call = async (name, data) => { try { return { ok: (await fnM.httpsCallable(fns, name)(data)).data }; } catch (e) { return { err: e.code, msg: e.message }; } };
    return { auth, db, fns, call, uid: auth.currentUser.uid };
  };
  const me = await setup(appM.getApp());
  const fresh = () => setup(appM.initializeApp(appM.getApp().options, 'raw' + Math.random()));
  const base = ['artifacts', 'anon-connect', 'public', 'data'];
  const tryIt = async fn => { try { await fn(); return 'ALLOWED'; } catch (e) { return e.code; } };
  const queue = (who, mode = 'text') => tryIt(() => f.setDoc(f.doc(who.db, ...base, 'queue', who.uid), { mode, interests: [], blocked: [], ts: Date.now() }));
  return await (eval(src))({ me, fresh, f, base, tryIt, queue, arg });
}, [fn.toString(), arg]);

const bannedShown = p => p.isVisible('#banned');
const toastText = p => p.$$eval('#toasts .toast', ts => ts.map(t => t.textContent).join(' | '));
async function startText(p) {
  await p.click('.seg[data-mode=text]');
  await p.click('#startBtn');
}
const connected = p => p.waitForSelector('#msgInput:not([disabled])', { timeout: 25000 }).then(() => true, () => false);
async function leave(p) { if (await p.isVisible('#leaveBtn')) await p.click('#leaveBtn'); }
const item = (p, list, text) => p.locator(`#${list} .item`).filter({ hasText: text });

// ---------------------------------------------------------------- 1. baseline
const A = await device('Asha');
const B = await device('Bilal', { fp: 'b'.repeat(32) });
step('1a. visitor gets an access pass', await sdk(A, async ({ me, f, base }) => {
  const s = await f.getDoc(f.doc(me.db, ...base, 'access', me.uid));
  return s.exists() && s.data().until > Date.now();
}));
step('1b. normal visitors are allowed', !(await bannedShown(A)) && !(await bannedShown(B)) && (await A.evaluate(() => window.__t.access.status.allowed)));
const raw = await sdk(A, async ctx => {
  const u = await ctx.fresh();
  const before = await ctx.tryIt(() => ctx.f.setDoc(ctx.f.doc(u.db, ...ctx.base, 'queue', u.uid), { mode: 'text', interests: [], blocked: [], ts: Date.now() }));
  const room = await ctx.tryIt(() => ctx.f.addDoc(ctx.f.collection(u.db, ...ctx.base, 'rooms'), { mode: 'text', users: [u.uid, 'someone'], created: Date.now() }));
  const pass = await ctx.tryIt(() => ctx.f.setDoc(ctx.f.doc(u.db, ...ctx.base, 'access', u.uid), { until: Date.now() + 1e9, videoBanUntil: 0 }));
  await u.call('checkAccess', { fp: 'a'.repeat(32) });
  const after = await ctx.tryIt(() => ctx.f.setDoc(ctx.f.doc(u.db, ...ctx.base, 'queue', u.uid), { mode: 'text', interests: [], blocked: [], ts: Date.now() }));
  const voice = await ctx.queue(u, 'voice');
  const bogus = await ctx.queue(u, 'bogus');
  // Rooms only come from a real claim of a queued person (the same batch the app sends), so claim a second queued voice user.
  const v2 = await ctx.fresh();
  await v2.call('checkAccess', { fp: 'b'.repeat(32) });
  await ctx.queue(v2, 'voice');
  const v2q = ctx.f.doc(v2.db, ...ctx.base, 'queue', v2.uid);
  const voiceRef = ctx.f.doc(ctx.f.collection(u.db, ...ctx.base, 'rooms'));
  const voiceRoom = await ctx.tryIt(() => ctx.f.runTransaction(u.db, async t => {
    await t.get(ctx.f.doc(u.db, ...ctx.base, 'queue', v2.uid));
    t.update(ctx.f.doc(u.db, ...ctx.base, 'queue', v2.uid), { roomId: voiceRef.id, partnerId: u.uid });
    t.set(voiceRef, { mode: 'voice', users: [v2.uid, u.uid], created: ctx.f.serverTimestamp() });
  }));
  await ctx.f.deleteDoc(v2q).catch(() => {});
  await ctx.f.deleteDoc(ctx.f.doc(u.db, ...ctx.base, 'queue', u.uid));
  return { before, room, pass, after, voice, bogus, voiceRoom };
});
step('1c. no pass -> queue and room writes denied; pass is not client-writable', raw.before === 'permission-denied' && raw.room === 'permission-denied' && raw.pass === 'permission-denied', JSON.stringify(raw));
step('1d. after checkAccess the same user can queue', raw.after === 'ALLOWED');
step('1d2. voice is an accepted mode (queue + room) with a pass; unknown modes are refused', raw.voice === 'ALLOWED' && raw.voiceRoom === 'ALLOWED' && raw.bogus === 'permission-denied', JSON.stringify({ v: raw.voice, r: raw.voiceRoom, b: raw.bogus }));
await startText(A); await startText(B);
step('1e. two allowed users still match', await connected(A) && await connected(B));
await B.click('#reportBtn'); await B.check('input[name="reason"][value="sexual"]'); await B.click('#reportSubmit');
await B.waitForFunction(() => /report sent/.test(document.getElementById('toasts').textContent), null, { timeout: 10000 }).catch(() => {});
step('1f. report sent', /report sent/.test(await toastText(B)));
await leave(A); await leave(B);
const notBanned = await sdk(A, ({ me }) => me.call('requestUnban', { message: 'please unban me', fp: 'x'.repeat(32) }));
step('1g. unban request when not banned is refused', notBanned.err === 'functions/failed-precondition', JSON.stringify(notBanned));
const anonAdmin = await sdk(A, ({ me }) => me.call('admin', { action: 'overview' }));
step('1h. anonymous user calling admin -> permission-denied', anonAdmin.err === 'functions/permission-denied', JSON.stringify(anonAdmin));

// ---------------------------------------------------------------- 2. under-age ban + private window
await A.evaluate(() => window.__t.finishAttempt(15));
await A.waitForSelector('#banned:not(.hidden)', { timeout: 15000 }).catch(() => {});
step('2a. under-age result -> ban screen', await bannedShown(A) && /under 18/.test(await A.textContent('#banReason')), await A.textContent('#banReason'));
step('2b. countdown shows ~24 h', /^2[34]h \d\dm$/.test(await A.textContent('#banCountdown')), await A.textContent('#banCountdown'));
step('2c. access pass revoked', await sdk(A, async ({ me, f, base }) => !(await f.getDoc(f.doc(me.db, ...base, 'access', me.uid))).exists()));
const C = await device('Private', { banned: true });
step('2d. private window (new account, same device + IP) -> banned at load', await bannedShown(C));
const D = await device('Phone', { fp: 'd'.repeat(32), banned: true });
step('2e. other device on the same IP -> banned (IP ban)', await bannedShown(D));
step('2e2. faking X-Forwarded-For doesn\'t help (the real address is appended last)', await bannedShown(await device('Spoof', { fp: '5'.repeat(32), xff: `9.9.9.9, ${HOME_IP}`, banned: true })));
step('2e4. a Google proxy address after the client is skipped', await bannedShown(await device('Proxy', { fp: '7'.repeat(32), xff: `${HOME_IP}, 35.191.3.4`, banned: true })));
step('2e5. same device, nearby address on the same network -> banned (device key)', await bannedShown(await device('Reconnect', { xff: '198.51.100.200', banned: true })));
step('2e6. same phone model elsewhere in the country (same fingerprint, far network) -> allowed', !(await bannedShown(await device('Twin', { xff: '192.0.2.60' }))));
step('2e3. a different network + different device -> allowed', !(await bannedShown(await device('Elsewhere', { fp: '6'.repeat(32), xff: '192.0.2.44' }))));
step('2f. banned user writing to the queue directly -> denied', await sdk(D, ctx => ctx.queue(ctx.me)) === 'permission-denied');
step('2g. start button stays blocked by the server even with local data cleared', await (async () => {
  await C.evaluate(() => { localStorage.clear(); });
  await C.reload();
  await C.waitForFunction(() => window.__t?.access?.status, null, { timeout: 30000 });
  return bannedShown(C);
})());
await D.fill('#appealMsg', 'I am 25, the room was dark');
await D.fill('#appealContact', 'phone@example.com');
await D.click('#appealSend');
await D.waitForSelector('#appealResult:not(.hidden)', { timeout: 15000 });
step('2h. unban request sent', /Request sent/.test(await D.textContent('#appealResult')), await D.textContent('#appealResult'));
await D.fill('#appealMsg', 'second try at asking');
await D.click('#appealSend');
await D.waitForFunction(() => /already/.test(document.getElementById('appealResult').textContent), null, { timeout: 15000 }).catch(() => {});
step('2i. second request from the same account -> "already open"', /already/.test(await D.textContent('#appealResult')));
step('2j. appeal form shown for under-age bans', await D.isVisible('#appealMsg'));

// ---------------------------------------------------------------- 3. admin page
const N = await adminPage('nobody@example.com');
step('3a. non-admin Google account -> "isn’t an admin"', /isn’t an admin/.test(await N.textContent('#signinMsg')) && !(await N.isVisible('#panel')), await N.textContent('#signinMsg'));
const nobodyCall = await N.evaluate(async () => {
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const appM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const fns = fnM.getFunctions(appM.getApp('admin'), 'asia-south1');
  try { await fnM.httpsCallable(fns, 'admin')({ action: 'unban', banIds: [] }); return 'ALLOWED'; } catch (e) { return e.code; }
});
step('3b. non-admin calling an admin action directly -> denied', nobodyCall === 'functions/permission-denied', nobodyCall);
const M = await adminPage('second@example.com'); // listed as "Second@Example.com": emails match case-insensitively
step('3c. admin signs in', await M.isVisible('#panel'));
step('3d. shows the IP the server sees', (await M.textContent('#meIp')) === HOME_IP, await M.textContent('#meIp'));
step('3e. open request listed', await M.textContent('#countRequests') === '1' && await item(M, 'requestList', 'I am 25').count() === 1);
step('3f. ban listed with what it covers', await (async () => {
  await M.click('[data-tab=bans]');
  const t = await M.textContent('#banList');
  return /Under-age result/.test(t) && /Covers: account, device, IP/.test(t) && !/60 min/.test(t);
})(), await M.textContent('#banList').then(t => t.slice(0, 200)));
step('3g. report listed', await (async () => { await M.click('[data-tab=reports]'); return /Nudity or sexual content/.test(await M.textContent('#reportList')); })());
await M.click('[data-tab=requests]');
await item(M, 'requestList', 'I am 25').getByRole('button', { name: 'Approve & whitelist IP' }).click();
await M.waitForFunction(() => document.getElementById('countRequests').textContent === '0', null, { timeout: 15000 }).catch(() => {});
step('3h. approve + whitelist', await M.textContent('#countRequests') === '0' && await M.textContent('#countWhitelist') === '1' && await M.textContent('#countBans') === '0',
  `${await M.textContent('#countRequests')} ${await M.textContent('#countWhitelist')} ${await M.textContent('#countBans')}`);
await D.click('#banRecheck');
await D.waitForSelector('#welcome:not(.hidden)', { timeout: 15000 }).catch(() => {});
step('3i. requester presses "Check again" -> back in', !(await bannedShown(D)) && await D.isVisible('#welcome'));
await A.click('#banRecheck');
await A.waitForSelector('#welcome:not(.hidden)', { timeout: 15000 }).catch(() => {});
step('3j. original account (request came from another window) is freed too', !(await bannedShown(A)));
await startText(A); await startText(D); // (not B: B blocked A when reporting them)
step('3k. unbanned user can chat again', await connected(A) && await connected(D));
await leave(A); await leave(D);

// ---------------------------------------------------------------- 7. admin ban from a report
await M.click('#refreshBtn');
await M.click('[data-tab=reports]');
await M.locator('#reportList .item').first().getByRole('button', { name: 'Ban 24 h' }).click();
await M.waitForFunction(() => /Banned for 24 hours/.test(document.getElementById('toasts').textContent), null, { timeout: 15000 }).catch(() => {});
step('7a. admin bans the reported person', /Banned for 24 hours/.test(await toastText(M)));
await A.click('#startBtn');
await A.waitForSelector('#banned:not(.hidden)', { timeout: 20000 }).catch(() => {});
step('7b. their next search is refused and shows the ban screen', await bannedShown(A) && /moderator/.test(await A.textContent('#banReason')), await A.textContent('#banReason').catch(() => ''));
step('7c. IP is whitelisted, so another device on it is not banned', !(await bannedShown(await device('Laptop', { fp: 'f'.repeat(32) }))));
await M.click('[data-tab=bans]');
const reportBan = item(M, 'banList', 'Reported: Nudity');
step('7d. on a whitelisted IP the ban covers the account only', /Covers: account(?!,)/.test(await reportBan.locator('.kv').textContent()), await reportBan.locator('.kv').textContent());
await reportBan.getByRole('button', { name: 'Unban' }).click();
await M.waitForFunction(() => document.getElementById('countBans').textContent === '0', null, { timeout: 15000 }).catch(() => {});
await A.click('#banRecheck');
await A.waitForSelector('#welcome:not(.hidden)', { timeout: 15000 }).catch(() => {});
step('7e. admin unban from the ban list -> user is back', !(await bannedShown(A)));
await M.fill('#banTarget', '203.0.113.9'); await M.fill('#banNote', 'spam bot');
await M.click('#banForm button[type=submit]');
await M.waitForFunction(() => /203\.0\.113\.9/.test(document.getElementById('banList').textContent), null, { timeout: 15000 }).catch(() => {});
step('7f. ban by IP address from the form', /203\.0\.113\.9/.test(await M.textContent('#banList')) && /Covers: IP/.test(await M.textContent('#banList')));
await item(M, 'banList', '203.0.113.9').getByRole('button', { name: 'Unban' }).click();
await M.waitForFunction(() => !/203\.0\.113\.9/.test(document.getElementById('banList').textContent), null, { timeout: 15000 }).catch(() => {});
step('7g. and unban it', !/203\.0\.113\.9/.test(await M.textContent('#banList')));

// ---------------------------------------------------------------- 5. inconclusive age checks -> 15 min cooldown
const G_IP = '203.0.113.20';
const G = await device('Gita', { fp: 'a1'.repeat(16), xff: G_IP });
await G.evaluate(() => window.__t.finishAttempt(19));
await G.waitForFunction(() => /attempt/.test(document.getElementById('verifyResult').textContent), null, { timeout: 15000 }).catch(() => {});
const r1 = await G.textContent('#verifyResult');
await G.evaluate(() => window.__t.finishAttempt(19));
await G.waitForFunction(r1 => document.getElementById('verifyResult').textContent !== r1, r1, { timeout: 15000 }).catch(() => {});
const r2 = await G.textContent('#verifyResult');
step('5a. inconclusive results count down on the server', /2 attempts left/.test(r1) && /1 attempt left/.test(r2), `${r1.slice(-20)} / ${r2.slice(-20)}`);
await G.evaluate(() => window.__t.finishAttempt(19));
await G.waitForSelector('#banned:not(.hidden)', { timeout: 15000 }).catch(() => {});
step('5b. third inconclusive -> 15-minute cooldown screen', await bannedShown(G) && /1[45]:\d\d/.test(await G.textContent('#banCountdown')), await G.textContent('#banCountdown'));
step('5c. no appeal form for a short cooldown', !(await G.isVisible('#appealMsg')) && await G.isVisible('#banRecheck'));
const G2 = await device('Gita-private', { fp: 'a1'.repeat(16), xff: G_IP, banned: true });
step('5d. cooldown also holds in a private window', await bannedShown(G2));
step('5e. ... and after reconnecting to a nearby address', await bannedShown(await device('Gita-reconnect', { fp: 'a1'.repeat(16), xff: '203.0.113.99', banned: true })));

// ---------------------------------------------------------------- 4. whitelist
const E = await device('Esha', { fp: 'e'.repeat(32) });
await E.evaluate(() => window.__t.finishAttempt(15));
await E.waitForSelector('#banned:not(.hidden)', { timeout: 15000 }).catch(() => {});
step('4a. whitelisted IP: the account is still banned', await bannedShown(E));
step('4a2. ... but not the shared network or devices on it', !(await bannedShown(await device('Esha-private', { fp: 'e'.repeat(32) }))) && !(await bannedShown(await device('Tab', { fp: '9'.repeat(32) }))));
await M.click('#refreshBtn');
await M.click('[data-tab=whitelist]');
await item(M, 'whitelistList', HOME_IP).getByRole('button', { name: 'Remove' }).click();
await M.waitForFunction(() => document.getElementById('countWhitelist').textContent === '0', null, { timeout: 15000 }).catch(() => {});
step('4b. remove from whitelist', await M.textContent('#countWhitelist') === '0');
await M.click('[data-tab=bans]');
await item(M, 'banList', 'Age check failed').getByRole('button', { name: 'Unban' }).click();
await M.waitForFunction(() => document.getElementById('countBans').textContent === '0', null, { timeout: 15000 }).catch(() => {});
await G.click('#banRecheck');
await G.waitForSelector('#welcome:not(.hidden)', { timeout: 15000 }).catch(() => {});
step('4c. admin lifts the cooldown', !(await bannedShown(G)));
await M.click('[data-tab=whitelist]');
await M.fill('#wlIp', '2001:db8:aaaa:bbbb:1:2:3:4'); await M.fill('#wlNote', 'college');
await M.click('#whitelistForm button[type=submit]');
await M.waitForFunction(() => /2001:db8:aaaa:bbbb::\/64/.test(document.getElementById('whitelistList').textContent), null, { timeout: 15000 }).catch(() => {});
step('4d. IPv6 whitelisted as its /64', /2001:db8:aaaa:bbbb::\/64/.test(await M.textContent('#whitelistList')), await M.textContent('#whitelistList'));
const bad = await M.evaluate(async () => {
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const appM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const fns = fnM.getFunctions(appM.getApp('admin'), 'asia-south1');
  const call = async d => { try { await fnM.httpsCallable(fns, 'admin')(d); return 'ALLOWED'; } catch (e) { return e.code; } };
  return [await call({ action: 'whitelistAdd', ip: 'not-an-ip' }), await call({ action: 'unban', banIds: ['../../entitlements/x'] }).then(r => r)];
});
step('4e. invalid admin input is rejected / ignored', bad[0] === 'functions/invalid-argument' && bad[1] === 'ALLOWED', JSON.stringify(bad));

// ---------------------------------------------------------------- 6. nudity strikes -> video locked
const H = await device('Hari', { fp: 'c'.repeat(32), mode: 'video' });
for (let i = 1; i <= 2; i++) {
  await H.evaluate(() => window.__t.selfViolation({ safety: {}, ended: false }));
  await H.waitForFunction(i => document.getElementById('toasts').textContent.includes(`Strike ${i} of 3`), i, { timeout: 15000 }).catch(() => {});
}
step('6a. strikes counted on the server', (await toastText(H)).includes('Strike 2 of 3'), await toastText(H));
await H.evaluate(() => window.__t.selfViolation({ safety: {}, ended: false }));
await H.waitForFunction(() => /Video chat is locked/.test(document.getElementById('toasts').textContent), null, { timeout: 15000 }).catch(() => {});
step('6b. third strike -> video locked, switched to text', /Video chat is locked/.test(await toastText(H)) && await H.evaluate(() => window.__t.S.mode) === 'text');
const rulesVideo = await sdk(H, async ctx => [await ctx.queue(ctx.me, 'video'), await ctx.queue(ctx.me, 'text')]);
step('6c. rules: video queue denied, text allowed', rulesVideo[0] === 'permission-denied' && rulesVideo[1] === 'ALLOWED', JSON.stringify(rulesVideo));
const H2 = await device('Hari-private', { fp: 'c'.repeat(32), mode: 'video' });
step('6d. private window: starts in text mode, video refused', await H2.evaluate(() => window.__t.S.mode) === 'text' && !(await bannedShown(H2)));
await H2.click('.seg[data-mode=video]');
step('6e. picking video -> "locked" toast, stays text', await H2.evaluate(() => window.__t.S.mode) === 'text' && /locked until/.test(await toastText(H2)));

console.log(logs.length ? 'LOGS:\n' + logs.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-ohmygoal/databases/(default)/documents', { method: 'DELETE' });
process.exit(failures ? 1 : 0);
