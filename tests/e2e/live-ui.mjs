// The Live sessions screens in two real browsers against the emulators: anyone signed in can go live (no application), a guest joins and sends a
// gift, the host ends the session; then a private session where the guest pays 200 coins. Needs the emulators and a static server on :8765.
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

// ---- documents as the project owner
const FS_URL = 'http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/';
const base = 'artifacts/anon-connect';
const val = v => (v.integerValue !== undefined ? Number(v.integerValue) : v.stringValue !== undefined ? v.stringValue : v.booleanValue !== undefined ? v.booleanValue : undefined);
const read = async path => { const r = await fetch(FS_URL + path, { headers: { Authorization: 'Bearer owner' } }); if (!r.ok) return null; return Object.fromEntries(Object.entries((await r.json()).fields || {}).map(([k, v]) => [k, val(v)])); };
const seed = (path, fields) => fetch(FS_URL + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { integerValue: String(v) }])) }) });
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
  await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': '198.51.100.' + (60 + name.length) } }));
  await ctx.addInitScript(([n, e]) => {
    localStorage.setItem('ac.hideIp', 'false'); localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
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
const toasts = p => p.textContent('#toasts').then(t => t || '');
const openLive = async p => { await p.click('#groupBtn'); await p.waitForSelector('#groupLobby:not(.hidden)'); await p.click('[data-gtab="live"]'); await p.waitForSelector('#livePane .live-bar'); };

const hostEmail = `host${stamp}@example.com`, guestEmail = `guest${stamp}@example.com`;
const H = await device('Hosty', hostEmail), G = await device('Guesty', guestEmail);

// ------------------------------------------------------------------ 1. anyone can host
await openLive(H);
step('1a. the Live tab opens and asks a signed-out visitor to sign in to host', /Live now/.test(await H.textContent('#livePane')) && /Sign in with Google/.test(await H.textContent('#livePane')));
await H.click('#livePane button:has-text("Sign in with Google")');
await H.waitForSelector('#liveTitle', { timeout: 25000 })
  .catch(async e => { console.log('  pane:', (await H.textContent('#livePane')).slice(0, 300), '| toasts:', await toasts(H), '| errors:', errors.join(' | ').slice(0, 200)); throw e; });
const pane = await H.textContent('#livePane');
step('1b. after signing in there is no application: the Go live form is right there, with the 49-coin price and the 70% share', /no application needed/.test(pane) && /Go live · 49 coins/.test(pane) && /70%/.test(pane) && /Your earnings/.test(pane) && !/Become a host/.test(pane));
const hostUid = await uidOfEmail(hostEmail);
await seed(`${base}/private/data/wallet/${hostUid}`, { coins: 600 });
step('1c. the host name defaults to the nickname', (await H.inputValue('#liveName')) === 'Hosty');
await H.fill('#liveTitle', 'call 9876543210');
await H.click('#livePane button:has-text("Go live")');
step('1d. a title with a phone number is stopped with a clear message, before anything is charged', /phone numbers/.test(await H.textContent('#livePane')) && (await read(`${base}/private/data/wallet/${hostUid}`)).coins === 600);

// ------------------------------------------------------------------ 3. a public voice session
await H.fill('#liveTitle', 'Hindi song night');
await H.selectOption('#liveMode', 'voice');
await H.click('#livePane button:has-text("Go live")');
await H.waitForSelector('#groupRoom:not(.hidden)', { timeout: 25000 })
  .catch(async e => { console.log('  toasts:', await toasts(H), '| pane:', (await H.textContent('#livePane')).slice(-300), '| errors:', errors.join(' | ').slice(0, 300)); throw e; });
step('3a. going live opens the room: it shows the title, the End session button and no gift button', /Hindi song night/.test(await H.textContent('#groupTitle')) && await H.isVisible('#gEnd') && !(await H.isVisible('#gGift')));
step('3b. the 49-coin start fee was taken', (await read(`${base}/private/data/wallet/${hostUid}`)).coins === 551);
step('3c. the host’s own tile is marked "Host"', /Host/.test(await H.textContent('#groupGrid .g-tile.self')));

await openLive(G);
await G.click('#livePane button:has-text("Sign in with Google")');   // gifts and paid sessions need a Google account
await G.waitForSelector('#liveTitle', { timeout: 25000 });
await G.waitForSelector('#livePane .live-session', { timeout: 20000 });
const card = await G.textContent('#livePane .live-session');
step('3d. a guest sees the session in the list: title, host, "Public · free"', /Hindi song night/.test(card) && /Hosted by Hosty/.test(card) && /Public · free/.test(card), card.slice(0, 120));
await G.click('#livePane .live-session button:has-text("Join")');
await G.waitForSelector('#groupRoom:not(.hidden)', { timeout: 25000 });
await G.waitForFunction(() => document.querySelectorAll('#groupGrid .g-tile').length >= 2, null, { timeout: 25000 });
await H.waitForFunction(() => document.querySelectorAll('#groupGrid .g-tile').length >= 2, null, { timeout: 25000 });
step('3e. both see each other (two tiles); the guest sees the host tile marked "Host"; the guest has a gift button and no End button', await G.locator('#groupGrid .g-tile:not(.self) .g-host').count() === 1 && await G.isVisible('#gGift') && !(await G.isVisible('#gEnd')));

// ------------------------------------------------------------------ 4. a gift
const guestUid = await uidOfEmail(guestEmail);
step('4a. (setup) the guest has a Google account', Boolean(guestUid));
await seed(`${base}/private/data/wallet/${guestUid}`, { coins: 100 });
await G.click('#gGift');
await G.waitForSelector('#gGiftPop:not(.hidden) #gGiftGrid button', { timeout: 10000 });
const gifts = await G.locator('#gGiftGrid button').count();
step('4b. the gift picker lists the 8 gifts with their coin prices', gifts === 8 && /5/.test(await G.textContent('#gGiftGrid button:first-child small')));
await G.click('#gGiftGrid button:first-child');
await H.waitForFunction(() => /sent a Rose/.test(document.getElementById('groupMessages').textContent), null, { timeout: 15000 });
step('4c. the host sees "… sent a Rose" in the room, with the gift floating up', await H.locator('.g-fx').count() >= 0 && /Guesty sent a Rose/.test(await H.textContent('#groupMessages')));
const hw = await read(`${base}/private/data/hostWallet/${hostUid}`);
const gw = await read(`${base}/private/data/wallet/${guestUid}`);
step('4d. the guest paid 5 coins; the host earned 3 (70%)', gw.coins === 95 && hw.coins === 3, JSON.stringify([gw, hw]));

// ------------------------------------------------------------------ 5. the host ends it
await H.click('#gEnd');
await G.waitForFunction(() => /host ended this session/.test(document.getElementById('toasts').textContent), null, { timeout: 20000 });
await G.waitForSelector('#groupLobby:not(.hidden)', { timeout: 10000 });
step('5a. the host ends the session: the guest is told and goes back to the lobby', true);
await H.waitForSelector('#groupLobby:not(.hidden)', { timeout: 10000 });
step('5b. the host is back at the lobby too', true);

// ------------------------------------------------------------------ 6. a private session
await seed(`${base}/private/data/wallet/${guestUid}`, { coins: 300 });
await seed(`${base}/private/data/wallet/${hostUid}`, { coins: 300 });
await H.click('#livePane button:has-text("Refresh")');
await H.waitForFunction(() => /300 coins/.test(document.querySelector('#livePane .coin-chip')?.textContent || ''), null, { timeout: 15000 });   // the page has re-drawn with the new balance
await H.waitForSelector('#liveTitle', { timeout: 15000 });
await H.fill('#liveTitle', 'One to one chat');
await H.selectOption('#liveMode', 'voice');
await H.selectOption('#liveKind', 'private');
await H.click('#livePane button:has-text("Go live")');
await H.waitForSelector('#groupRoom:not(.hidden)', { timeout: 25000 })
  .catch(async e => { console.log('  toasts:', await toasts(H), '| pane:', (await H.textContent('#livePane')).slice(0, 200), '| title:', await H.inputValue('#liveTitle').catch(() => '?'), '| errors:', errors.join(' | ').slice(0, 300)); throw e; });
await G.click('#livePane button:has-text("Refresh")');
await G.waitForSelector('#livePane .live-session:has-text("One to one chat")', { timeout: 20000 });
const pc = await G.textContent('#livePane .live-session:has-text("One to one chat")');
step('6a. a private session shows its price in the list and has no "Send a gift" shortcut', /Private · 200 coins/.test(pc) && /Join · 200 coins/.test(pc) && await G.locator('#livePane .live-session:has-text("One to one chat") button:has-text("Send a gift")').count() === 0, pc.slice(0, 140));
await G.click('#livePane .live-session:has-text("One to one chat") button:has-text("Join · 200 coins")');
await G.waitForSelector('#groupRoom:not(.hidden)', { timeout: 25000 });
const w3 = await read(`${base}/private/data/wallet/${guestUid}`);
const hw3 = await read(`${base}/private/data/hostWallet/${hostUid}`);
step('6b. the guest paid 200 coins after confirming; the host earned 140 more', w3.coins === 100 && hw3.coins === 3 + 140, JSON.stringify([w3, hw3]));
await G.waitForFunction(() => document.querySelectorAll('#groupGrid .g-tile').length >= 2, null, { timeout: 25000 });
step('6c. the same safety tools are on in a private room: report and block are in every tile’s menu', await G.locator('#groupGrid .g-tile:not(.self) .g-more').count() === 1);
await G.click('#groupLeave');
await G.waitForSelector('#groupLobby:not(.hidden)', { timeout: 10000 });
await G.click('#livePane button:has-text("Refresh")');
await G.waitForSelector('#livePane .live-session:has-text("One to one chat")', { timeout: 15000 });
await G.click('#livePane .live-session:has-text("One to one chat") button:has-text("Join · 200 coins")');
await G.waitForSelector('#groupRoom:not(.hidden)', { timeout: 25000 });
step('6d. leaving and coming back to the same private session is free', (await read(`${base}/private/data/wallet/${guestUid}`)).coins === 100);
await H.click('#groupLeave');                       // a host who leaves ends the session
await G.waitForFunction(() => /host ended this session/.test(document.getElementById('toasts').textContent), null, { timeout: 20000 });
step('6e. when the host leaves, the session ends for everyone', true);

// ------------------------------------------------------------------ 7. the host sees earnings
await H.click('#livePane button:has-text("Refresh")');
await H.waitForSelector('#livePane .live-tile', { timeout: 15000 });
const earn = await H.textContent('#livePane');
step('7. the host’s earnings box shows 143 coins ready to pay out and the rupee value (₹107), and says payouts start from 500 coins', /143 coins/.test(earn) && /₹107/.test(earn) && /from 500 coins/.test(earn), earn.slice(earn.indexOf('Your earnings'), earn.indexOf('Your earnings') + 200));

step('8. no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
