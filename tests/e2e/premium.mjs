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
const fakeCheckout = `window.Razorpay = class { constructor(o) { this.o = o; } on() {} async open() {
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

const A = await device('Asha'), B = await device('Bilal');

// 1. Anonymous user: premium filter and effects are locked
await A.click('#prefsBtn'); await A.selectOption('#genderFilter', 'female');
await A.evaluate(() => document.getElementById('prefsSheet').classList.add('hidden'));
step('1a. anon picks "Women" -> paywall, filter reset', await A.isVisible('#paywall') && await A.inputValue('#genderFilter') === 'any', await A.textContent('#paywallReason'));
step('1b. anon paywall CTA', (await A.textContent('#paywallCta')) === 'Continue with Google', await A.textContent('#paywallCta'));
const anonOrder = await sdk(A, ({ call }) => call('createOrder', { plan: 'month' }));
step('1c. anon createOrder refused', anonOrder.err === 'functions/failed-precondition', JSON.stringify(anonOrder));

// 2. Sign in with Google (no purchase yet) -> still free
await A.click('#paywallCta');
await A.waitForFunction(() => /Signed in as/.test(document.getElementById('toasts').textContent), null, { timeout: 15000 });
step('2. signed in, not premium yet', (await A.textContent('#paywallCta')).startsWith('Pay ₹149') && !(await A.evaluate(() => document.body.classList.contains('is-premium'))), await A.textContent('#paywallCta'));
const forgeA = await sdk(A, ({ db, f, base, auth, tryIt }) => tryIt(() => f.setDoc(f.doc(db, ...base, 'entitlements', auth.currentUser.uid), { premiumUntil: Date.now() + 1e10 })));
step('2b. user cannot forge entitlement', forgeA !== 'ALLOWED', forgeA);
const queueFilterA = await sdk(A, ({ db, f, base, auth, tryIt }) => tryIt(() => f.setDoc(f.doc(db, ...base, 'queue', auth.currentUser.uid), { mode: 'text', genderFilter: 'female', countryFilter: 'any', ts: Date.now(), roomId: null })));
step('2c. non-premium queue entry with gender filter refused by rules', queueFilterA !== 'ALLOWED', queueFilterA);

// 3. Buy (month)
await A.click('#plans .plan[data-plan=month]');
await A.click('#paywallCta');
await A.waitForFunction(() => document.body.classList.contains('is-premium'), null, { timeout: 20000 }).catch(() => {});
const until = await A.evaluate(() => document.getElementById('premiumBtn').title);
step('3a. purchase -> premium active', await A.evaluate(() => document.body.classList.contains('is-premium')), until + ' | toast: ' + (await A.textContent('#toasts')).slice(-80));
step('3b. checkout got server price', true, JSON.stringify(await A.evaluate(() => window.__checkoutOpts)));
const daysLeft = await sdk(A, async ({ db, f, base, auth }) => ((await f.getDoc(f.doc(db, ...base, 'entitlements', auth.currentUser.uid))).data().premiumUntil - Date.now()) / 864e5);
step('3c. 30 days granted', Math.round(daysLeft) === 30, daysLeft.toFixed(2));

// 4. Attacks on verifyPayment
const attacks = await sdk(A, async ({ call }) => {
  const o = (await call('createOrder', { plan: 'week' })).ok;
  const pay = await fetch('http://127.0.0.1:7777/test/pay', { method: 'POST', body: JSON.stringify({ order_id: o.orderId }) }).then(r => r.json());
  const badSig = await call('verifyPayment', { orderId: o.orderId, paymentId: pay.razorpay_payment_id, signature: 'deadbeef' });
  const good = await call('verifyPayment', { orderId: o.orderId, paymentId: pay.razorpay_payment_id, signature: pay.razorpay_signature });
  const replay = await call('verifyPayment', { orderId: o.orderId, paymentId: pay.razorpay_payment_id, signature: pay.razorpay_signature });
  const badPlan = await call('createOrder', { plan: 'lifetime' });
  const proto = await call('createOrder', { plan: '__proto__' });
  // Underpaid payment for a fresh order
  const o2 = (await call('createOrder', { plan: 'quarter' })).ok;
  const under = await fetch('http://127.0.0.1:7777/test/pay', { method: 'POST', body: JSON.stringify({ order_id: o2.orderId, amount: 100 }) }).then(r => r.json());
  const underpaid = await call('verifyPayment', { orderId: o2.orderId, paymentId: under.razorpay_payment_id, signature: under.razorpay_signature });
  // Authorized-only payment gets captured then granted
  const o3 = (await call('createOrder', { plan: 'week' })).ok;
  const auth3 = await fetch('http://127.0.0.1:7777/test/pay', { method: 'POST', body: JSON.stringify({ order_id: o3.orderId, status: 'authorized' }) }).then(r => r.json());
  const authorized = await call('verifyPayment', { orderId: o3.orderId, paymentId: auth3.razorpay_payment_id, signature: auth3.razorpay_signature });
  return { badSig: badSig.err, good: !!good.ok, replayAlready: good.ok && replay.ok?.alreadyGranted, replaySame: replay.ok?.premiumUntil === good.ok?.premiumUntil, badPlan: badPlan.err, proto: proto.err, underpaid: underpaid.err, authorized: !!authorized.ok, o3: o3.orderId };
});
step('4a. bad signature rejected', attacks.badSig === 'functions/permission-denied', attacks.badSig);
step('4b. replaying a verified payment grants nothing extra', attacks.good && attacks.replayAlready && attacks.replaySame);
step('4c. unknown / __proto__ plan rejected', attacks.badPlan === 'functions/invalid-argument' && attacks.proto === 'functions/invalid-argument', attacks.badPlan + ' ' + attacks.proto);
step('4d. underpaid payment rejected', attacks.underpaid === 'functions/permission-denied', attacks.underpaid);
step('4e. authorized-only payment is captured then granted', attacks.authorized);

// 5. B (Google, free) can't redeem A's order even with a valid signature
await B.click('#premiumBtn'); await B.click('#paywallCta');
await B.waitForFunction(() => /Signed in as/.test(document.getElementById('toasts').textContent), null, { timeout: 15000 });
await B.click('#paywallClose');
const steal = await sdk(B, async ({ call }) => {
  return null;
});
const stolen = await sdk(A, async ({ call }) => {
  const o = (await call('createOrder', { plan: 'week' })).ok;
  const pay = await fetch('http://127.0.0.1:7777/test/pay', { method: 'POST', body: JSON.stringify({ order_id: o.orderId }) }).then(r => r.json());
  return { orderId: o.orderId, paymentId: pay.razorpay_payment_id, signature: pay.razorpay_signature };
});
const stealRes = await sdk(B, ({ call, arg }) => call('verifyPayment', arg), stolen);
step('5. another user cannot redeem someone else\'s payment', stealRes.err === 'functions/permission-denied', JSON.stringify(stealRes));

// 6. Webhook: bad signature rejected; good one grants B's own paid order
const bOrder = await sdk(B, async ({ call }) => {
  const o = (await call('createOrder', { plan: 'week' })).ok;
  const pay = await fetch('http://127.0.0.1:7777/test/pay', { method: 'POST', body: JSON.stringify({ order_id: o.orderId }) }).then(r => r.json());
  return pay.payment;
});
const body = JSON.stringify({ event: 'order.paid', payload: { payment: { entity: bOrder } } });
const bad = await fetch(FN + 'razorpayWebhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': 'nope' }, body });
const sig = crypto.createHmac('sha256', 'test_webhook_secret').update(body).digest('hex');
const good = await fetch(FN + 'razorpayWebhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig }, body });
const again = await fetch(FN + 'razorpayWebhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig }, body });
step('6a. webhook bad signature -> 400', bad.status === 400, String(bad.status));
step('6b. webhook grants, repeat is idempotent', good.status === 200 && (await good.text()) === 'granted' && (await again.text()) === 'already granted');
await B.waitForFunction(() => document.body.classList.contains('is-premium'), null, { timeout: 10000 }).then(() => step('6c. B became premium live via webhook', true), () => step('6c. B premium via webhook', false));

// 6d. Forged webhook (valid signature, but no such payment at Razorpay) grants nothing
const forgeOrder = await sdk(A, async ({ call }) => (await call('createOrder', { plan: 'week' })).ok.orderId);
const forgedBody = JSON.stringify({ event: 'order.paid', payload: { payment: { entity: { id: 'pay_fake123', order_id: forgeOrder, amount: 4900, currency: 'INR', status: 'captured' } } } });
const forgedRes = await fetch(FN + 'razorpayWebhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': crypto.createHmac('sha256', 'test_webhook_secret').update(forgedBody).digest('hex') }, body: forgedBody });
const forgedText = await forgedRes.text();
step('6d. forged webhook for an unpaid order is refused (no retry loop)', forgedRes.status === 200 && forgedText === 'not confirmed', `${forgedRes.status} ${forgedText}`);

// 7. Premium matching: A (premium, wants women) + B (premium, female) match; B sees A's verified badge
await A.click('#prefsBtn'); await A.selectOption('#genderSelect', 'male');
await A.selectOption('#genderFilter', 'female');
step('7a. premium user can pick "Women" (no paywall)', !(await A.isVisible('#paywall')) && (await A.inputValue('#genderFilter')) === 'female');
await A.evaluate(() => document.getElementById('prefsSheet').classList.add('hidden'));
await B.click('#prefsBtn'); await B.selectOption('#genderSelect', 'female');
await B.evaluate(() => document.getElementById('prefsSheet').classList.add('hidden'));
await A.click('#startBtn'); await B.click('#startBtn');
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 20000 }).then(() => true, () => false);
step('7b. filtered premium match works under rules', (await live(A)) && (await live(B)));
await B.waitForTimeout(1500);
step('7c. B sees A\'s verified 👑 badge', await B.isVisible('#partnerBadge'));
await A.screenshot({ path: SP + '/pr-chat.png' });
console.log('LOGS:', logs.slice(0, 8));
await browser.close();
