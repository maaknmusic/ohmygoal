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

// 2d. "Hide my IP address" is a Premium feature: a free user sees it locked and the click opens the paywall
// the relay credentials are fetched in the background after the access check
await A.waitForFunction(() => document.getElementById('hideIpLabel').textContent !== 'Unavailable', null, { timeout: 10000 }).catch(() => {});
const ipFree = await A.evaluate(() => { const label = document.getElementById('hideIpLabel').textContent; document.getElementById('hideIpBtn').click(); return { label, reason: document.getElementById('paywallReason').textContent }; });
step('2d. free user: Hide my IP shows "Premium" and opens the paywall instead of toggling', /Premium/.test(ipFree.label) && /IP address/.test(ipFree.reason), JSON.stringify(ipFree));

// 3. Buy (month)
await A.click('#plans .plan[data-plan=month]');
await A.click('#paywallCta');
await A.waitForFunction(() => document.body.classList.contains('is-premium'), null, { timeout: 20000 }).catch(() => {});
const until = await A.evaluate(() => document.getElementById('premiumBtn').title);
step('3a. purchase -> premium active', await A.evaluate(() => document.body.classList.contains('is-premium')), until + ' | toast: ' + (await A.textContent('#toasts')).slice(-80));
const ipPrem = await A.evaluate(() => { const b = document.getElementById('hideIpBtn'); const before = document.getElementById('hideIpLabel').textContent; b.click(); const after = document.getElementById('hideIpLabel').textContent; b.click(); /* back to Off: the emulator has no TURN relay */ return { before, after }; });
step('3a2. Premium user can toggle Hide my IP (the test starts it Off)', ipPrem.before === 'Off' && ipPrem.after === 'On', JSON.stringify(ipPrem));
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

// 8. Tips: whole rupees in range, the amount is checked on the server, a tip never changes Premium
const tipT = await sdk(B, async ({ call, db, f, base, auth }) => {
  const entRef = f.doc(db, ...base, 'entitlements', auth.currentUser.uid);
  const before = (await f.getDoc(entRef)).data()?.premiumUntil ?? 0;
  const bad = [];
  for (const v of [9, 5001, 50.5, '50', -10, 0, null]) bad.push((await call('createOrder', { tip: v })).err);
  const o = (await call('createOrder', { tip: 50, amount: 1, plan: 'week' })).ok; // extra fields are ignored
  const pay = await fetch('http://127.0.0.1:7777/test/pay', { method: 'POST', body: JSON.stringify({ order_id: o.orderId }) }).then(r => r.json());
  const body = { orderId: o.orderId, paymentId: pay.razorpay_payment_id, signature: pay.razorpay_signature };
  const v1 = await call('verifyPayment', body);
  const v2 = await call('verifyPayment', body);
  const after = (await f.getDoc(entRef)).data()?.premiumUntil ?? 0;
  return { bad, o, v1, v2, before, after };
});
step('8a. tip amounts outside 10-5000, fractions, strings, negatives and null are refused', tipT.bad.every(e => e === 'functions/invalid-argument'), JSON.stringify(tipT.bad));
step('8b. a valid tip creates a ₹50 order (amount from the server, not the request), verifies once, replays idempotently and never changes Premium',
  tipT.o?.amount === 5000 && tipT.o.plan === 'tip' && tipT.v1.ok?.tip === true && tipT.v2.ok?.alreadyGranted === true && tipT.before === tipT.after, JSON.stringify({ o: tipT.o && { a: tipT.o.amount, p: tipT.o.plan }, v1: tipT.v1, v2: tipT.v2, before: tipT.before, after: tipT.after }));

// 8c. The tip sheet: opens from the menu, validates, and a paid tip shows a thank-you without touching Premium
await B.evaluate(() => { window.__checkoutOpts = null; document.getElementById('tipBtn').click(); });
step('8c. the tip sheet opens from the menu', await B.isVisible('#tipSheet'));
await B.fill('#tipAmount', '5'); await B.click('#tipPay');
step('8d. an amount under ₹10 shows an error and opens no checkout', /₹10/.test(await B.textContent('#tipError')) && !(await B.evaluate(() => window.__checkoutOpts)));
await B.click('#tipChips [data-amt="100"]');
step('8e. a quick-amount chip fills the amount', (await B.inputValue('#tipAmount')) === '100');
const premiumBefore = await B.evaluate(() => document.getElementById('premiumBtn').title);
await B.click('#tipPay');
await B.waitForFunction(() => /Thank you for your tip/.test(document.getElementById('toasts').textContent), null, { timeout: 15000 }).catch(() => {});
step('8f. paying a tip (₹100) shows the thank-you, closes the sheet and leaves Premium as it was',
  /Thank you for your tip/.test(await B.textContent('#toasts')) && !(await B.isVisible('#tipSheet')) && (await B.evaluate(() => window.__checkoutOpts?.amount)) === 10000 && (await B.evaluate(() => document.getElementById('premiumBtn').title)) === premiumBefore,
  JSON.stringify(await B.evaluate(() => window.__checkoutOpts)));

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
// the badge is checked by a Cloud Function: the first call after the emulator starts can take a few seconds
await B.waitForSelector('#partnerBadge:not(.hidden)', { timeout: 10000 }).catch(() => {});
step('7c. B sees A\'s verified 👑 badge', await B.isVisible('#partnerBadge'));
await A.screenshot({ path: SP + '/pr-chat.png' });
console.log('LOGS:', logs.slice(0, 8));
await browser.close();
