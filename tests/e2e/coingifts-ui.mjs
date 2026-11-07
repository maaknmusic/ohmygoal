// Gifting coins in two real browsers against the emulators: from a one-to-one chat (the "Send coins" button, with the 70% shown before sending)
// and from a live session (a person's menu). Needs the emulators and a static server on :8765.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`);
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
const stamp = Date.now();
const errors = [];
const FS_URL = 'http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/';
const base = 'artifacts/anon-connect';
const val = v => (v.integerValue !== undefined ? Number(v.integerValue) : v.stringValue);
const read = async path => { const r = await fetch(FS_URL + path, { headers: { Authorization: 'Bearer owner' } }); if (!r.ok) return null; return Object.fromEntries(Object.entries((await r.json()).fields || {}).map(([k, v]) => [k, val(v)])); };
const wallet = (uid, coins, bought) => fetch(FS_URL + `${base}/private/data/wallet/${uid}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { coins: { integerValue: String(coins) }, bought: { integerValue: String(bought) } } }) });
const uidOfEmail = async email => {
  let token = '';
  do {
    const r = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-ohmygoal/accounts:batchGet?maxResults=500' + (token ? '&nextPageToken=' + token : ''), { headers: { Authorization: 'Bearer owner' } })).json();
    const hit = (r.users || []).find(u => u.email === email);
    if (hit) return hit.localId;
    token = r.nextPageToken || '';
  } while (token);
  return undefined;
};

async function device(name, email) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|fonts\.g|country\.is/, r => r.abort());
  await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': '198.51.100.' + (100 + name.length) } }));
  await ctx.addInitScript(([n, e]) => {
    localStorage.setItem('ac.hideIp', 'false'); localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    localStorage.setItem('ac.mode', JSON.stringify('text'));
    window.__fakeIdToken = JSON.stringify({ sub: 'google-' + e, email: e, email_verified: true, name: n + ' Real' });
  }, [name, email]);
  const real = fs.readFileSync('/home/user/ohmygoal/js/friends.js', 'utf8');
  const patched = real.replace('if (user?.isAnonymous) await linkWithPopup(user, provider);', 'if (user?.isAnonymous) await this.authMod.linkWithCredential(user, GoogleAuthProvider.credential(window.__fakeIdToken));');
  if (patched === real) throw new Error('friends.js patch failed');
  await ctx.route('**/js/friends.js', r => r.fulfill({ body: patched, contentType: 'text/javascript' }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(name + ': ' + e.message));
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8765/index.html');
  await p.fill('#nickInput', name);
  await p.check('#ageCheck');
  await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 20000 });
  return p;
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 25000 });
const toastText = p => p.textContent('#toasts').then(t => t || '');

const aEmail = `asha${stamp}@example.com`, bEmail = `bilal${stamp}@example.com`;
const A = await device('Asha', aEmail), B = await device('Bilal', bEmail);

// ---- 1. a one-to-one chat
await A.click('#startBtn'); await B.click('#startBtn');
await live(A); await live(B);
step('1a. two people are matched in a chat', true);
// both sign in with Google (adding a friend triggers the sign-in), then Asha gets purchased coins
await A.click('#addFriendBtn');
await A.waitForFunction(() => /Signed in as/.test(document.getElementById('toasts').textContent), null, { timeout: 20000 });
await B.evaluate(() => document.getElementById('addFriendBtn').click());
await B.waitForFunction(() => /Signed in as/.test(document.getElementById('toasts').textContent) || document.querySelector('.friend-banner'), null, { timeout: 20000 }).catch(() => {});
const aUid = await uidOfEmail(aEmail);
let bUid = await uidOfEmail(bEmail);
if (!bUid) { await B.click('.friend-banner button, #addFriendBtn').catch(() => {}); await B.waitForTimeout(1500); bUid = await uidOfEmail(bEmail); }
step('1b. (setup) both have Google accounts', Boolean(aUid) && Boolean(bUid), JSON.stringify([Boolean(aUid), Boolean(bUid)]));
await wallet(aUid, 250, 200); await wallet(bUid, 0, 0);
await A.click('#stickerBtn');
await A.click('#tabGifts');
await A.waitForSelector('#sendCoinsBtn:visible', { timeout: 10000 });
step('1c. the Gifts tab has a "Send coins" button', true);
await A.click('#sendCoinsBtn');
await A.waitForSelector('#giftCoinsSheet:not(.hidden) #giftCoinsChoices button', { timeout: 15000 });
const choices = await A.locator('#giftCoinsChoices button').allTextContents();
step('1d. the dialog shows what the other person gets before sending (100 coins → 70) and that only bought coins can be sent', choices.some(c => /100 coins → .* gets 70/.test(c)) && /Only coins you bought/.test(await A.textContent('#giftCoinsSheet')) && /30%/.test(await A.textContent('#giftCoinsSheet')), choices.join(' | '));
const dis = await A.locator('#giftCoinsChoices button').evaluateAll(bs => bs.map(b => b.disabled));
step('1e. amounts above the 200 purchased coins are greyed out (500 off, 100 on)', dis[3] === true && dis[1] === false && /up to 200 coins/.test(await A.textContent('#giftCoinsHint')), JSON.stringify(dis));
await A.locator('#giftCoinsChoices button', { hasText: '100 coins' }).click();
await A.waitForFunction(() => /You sent 100 coins/.test(document.getElementById('toasts').textContent), null, { timeout: 20000 });
const wa = await read(`${base}/private/data/wallet/${aUid}`), wb = await read(`${base}/private/data/wallet/${bUid}`);
step('1f. Asha is told it went through; she paid 100, Bilal got 70', wa.coins === 150 && wa.bought === 100 && wb.coins === 70 && !(wb.bought > 0), JSON.stringify([wa, wb]));
await B.waitForFunction(() => /sent you coins/.test(document.getElementById('toasts').textContent), null, { timeout: 15000 });
step('1g. Bilal sees a notice that coins arrived', true);
await B.click('#stickerBtn'); await B.click('#tabGifts');
await B.click('#sendCoinsBtn');
await B.waitForSelector('#giftCoinsSheet:not(.hidden) #giftCoinsChoices button', { timeout: 15000 });
const bd = await B.locator('#giftCoinsChoices button').evaluateAll(bs => bs.map(b => b.disabled));
step('1h. Bilal cannot send on what he received: every amount is greyed out, with a clear message', bd.every(Boolean) && /no purchased coins/.test(await B.textContent('#giftCoinsHint')), JSON.stringify(bd));
await B.keyboard.press('Escape');

step('2. no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
