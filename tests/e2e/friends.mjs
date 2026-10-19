import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`);
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const logs = [];
async function device(name) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 1280, height: 760 } });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|fonts\.g|country\.is/, r => r.abort());
  await ctx.addInitScript(([n]) => {
    localStorage.setItem('ac.hideIp', 'false'); localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    window.__fakeIdToken = JSON.stringify({ sub: 'google-' + n + '-' + Date.now(), email: n.toLowerCase() + Date.now() + '@example.com', email_verified: true, name: n + ' Real' });
  }, [name]);
  const real = fs.readFileSync('/home/user/ohmygoal/js/friends.js', 'utf8');
  const patched = real.replace('if (user?.isAnonymous) await linkWithPopup(user, provider);',
    'if (user?.isAnonymous) await this.authMod.linkWithCredential(user, GoogleAuthProvider.credential(window.__fakeIdToken));');
  if (patched === real) throw new Error('friends.js patch failed');
  await ctx.route('**/js/friends.js', r => r.fulfill({ body: patched, contentType: 'text/javascript' }));
  const p = await ctx.newPage();
  p.on('pageerror', e => logs.push(name + ' PAGEERR ' + e.message));
  p.on('console', m => { if (/permission|failed|error/i.test(m.text()) && !/Failed to load resource|nudity model|face-api/.test(m.text())) logs.push(name + ': ' + m.text().slice(0, 220)); });
  await p.goto('http://localhost:8765/index.html');
  await p.fill('#nickInput', name);
  await p.click('.seg[data-mode=video]'); await p.check('#ageCheck');
  await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 20000 });
  return p;
}
async function googleSignIn(page, trigger) {
  await trigger();
  await page.waitForFunction(() => /Signed in as/.test(document.getElementById('toasts').textContent), null, { timeout: 15000 })
    .catch(async e => { console.log('  toasts:', await page.textContent('#toasts'), logs); throw e; });
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 20000 });
const step = (n, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`);

const A = await device('Asha'), B = await device('Bilal');
await A.click('#startBtn'); await B.click('#startBtn');
await live(A); await live(B); step('1. matched via emulator', true);

// 2. Friend request with Google sign-in on both sides
await googleSignIn(A, () => A.click('#addFriendBtn'), 'asha@example.com', 'Asha Real');
await A.waitForFunction(() => document.getElementById('messages').textContent.includes('Friend request sent'), null, { timeout: 10000 });
await B.waitForSelector('.friend-banner', { timeout: 10000 });
step('2a. request sent, banner shown on B', true, await B.textContent('.friend-banner span'));
await googleSignIn(B, () => B.click('.friend-banner .btn-primary'), 'bilal@example.com', 'Bilal Real');
const friendsMsg = p => p.waitForFunction(() => document.getElementById('messages').textContent.includes('are now friends'), null, { timeout: 15000 }).then(() => true, () => false);
step('2b. both see "now friends"', (await friendsMsg(A)) && (await friendsMsg(B)));
await B.screenshot({ path: SP + '/fr-chat.png' });

// 3. Friends drawer + saved message
await A.click('#friendsBtn');
await A.waitForSelector('#friendList .friend', { timeout: 10000 });
step('3a. A friend list', true, (await A.textContent('#friendList')).trim());
await A.click('#friendList .friend');
await A.fill('#fcInput', 'Hi Bilal, saved message!'); await A.press('#fcInput', 'Enter');
await B.click('#friendsBtn'); await B.click('#friendList .friend', { timeout: 10000 });
const got = await B.waitForFunction(() => document.getElementById('fcMessages').textContent.includes('saved message'), null, { timeout: 10000 }).then(() => true, () => false);
step('3b. B receives stored friend message', got);
await B.waitForTimeout(800); console.log('drawer opacity:', await B.$eval('#drawer', d => getComputedStyle(d).opacity, ), 'bg:', await B.$eval('#drawer', d => getComputedStyle(d).backgroundColor)); await B.screenshot({ path: SP + '/fr-drawer.png' });

// 4. Leave random chat, then A video-calls B
await A.click('#drawerClose'); await B.click('#drawerClose'); await A.click('#leaveBtn'); await B.click('#leaveBtn');
await A.click('#friendsBtn').catch(() => {});
if (await A.isHidden('#drawer')) await A.click('#friendsBtn');
if (await A.isHidden('#friendChat')) await A.click('#friendList .friend');
await A.click('#fcCall');
await B.waitForSelector('#callModal:not(.hidden)', { timeout: 15000 });
step('4a. B gets incoming call', true, (await B.textContent('#callModal h3')).trim());
await B.screenshot({ path: SP + '/fr-ring.png' });
await B.click('#callAccept');
await live(A); await live(B);
await B.waitForTimeout(2000);
step('4b. call connected', true, `A sees "${await A.textContent('#partnerName')}", B sees "${await B.textContent('#partnerName')}", B video ${await B.evaluate(() => remoteVideo.videoWidth)}px, A button "${await A.textContent('#nextBtn')}"`);
await A.click('#nextBtn');
await B.waitForFunction(() => document.getElementById('overlayTitle').textContent === 'Call ended', null, { timeout: 10000 }).then(() => step('4c. hang up -> B sees "Call ended" (no auto-next)', true), () => step('4c. hang up', false, 'B overlay: ' + JSON.stringify(1)));

// 5. Security: an anonymous third user can't read or create friendships
const C = await device('Eve');
const sec = await C.evaluate(async () => {
  const app = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const auth = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  const f = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const a2 = app.initializeApp(APP_CONFIG.firebase, 'eve'); const au = auth.getAuth(a2); auth.connectAuthEmulator(au, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = f.getFirestore(a2); f.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const u = (await auth.signInAnonymously(au)).user.uid;
  const col = f.collection(db, 'artifacts', 'anon-connect', 'public', 'data', 'friendships');
  const res = {};
  try { await f.getDocs(f.query(col, f.where('users', 'array-contains', 'x'))); res.listOthers = 'ALLOWED'; } catch (e) { res.listOthers = e.code; }
  const users = [u, 'zzzz'].sort();
  try { await f.setDoc(f.doc(col, users.join('_')), { users, status: 'pending', requestedBy: u, names: {} }); res.anonCreate = 'ALLOWED'; } catch (e) { res.anonCreate = e.code; }
  return res;
});
step('5. anonymous user blocked', sec.listOthers !== 'ALLOWED' && sec.anonCreate !== 'ALLOWED', JSON.stringify(sec));
console.log('LOGS:', logs.slice(0, 10));
await browser.close();
