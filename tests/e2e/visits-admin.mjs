// The visit log end to end (functions/visits.js, js/admin-visits.js): real visitors check in through checkAccess from given addresses
// (IPv4 and IPv6, set with X-Forwarded-For) with the browser's own address lookup (ipify, faked here); the admin sees them in the Visits
// tab with the approximate place (IPinfo, mocked by mockrzp.mjs), follows an address to every account on it, and bans from a row.
// Nobody else can read the log. Needs the emulators (ADMIN_EMAILS includes boss@example.com), mockrzp.mjs on :7777 and a static server on :8765.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`);
const adminSrc = fs.readFileSync('/home/user/ohmygoal/js/admin.js', 'utf8');
const patched = adminSrc.replace('await authMod.signInWithPopup(auth, provider);', 'await authMod.signInWithCredential(auth, authMod.GoogleAuthProvider.credential(window.__adminToken));');
if (patched === adminSrc) throw new Error('admin.js patch did not apply');
const browser = await chromium.launch();
const step = (n, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`);
const errors = [];
const stamp = Date.now() % 100000;
// Addresses unique to this run, so earlier runs never mix in.
const A4 = `49.36.${stamp % 250}.${7 + (stamp % 200)}`, A6 = `2401:4900:1c2a:${(stamp % 65000).toString(16)}::5`;
const C6 = `2401:4900:abcd:${(stamp % 65000).toString(16)}::9`, C4 = `106.200.${stamp % 250}.2`;
const UA = {
  asha: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  bilal: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chen: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
};
const ipinfoCalls = async () => (await (await fetch('http://127.0.0.1:7777/test/ipinfo-count')).json()).calls;

async function routes(ctx, { seen, v4, v6 }) {
  await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': seen } }));
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|fonts\.g|country\.is|googlesyndication/, r => r.abort());
  // the browser's own lookup of its addresses (ipify): an address, or none (a network without that protocol)
  await ctx.route('https://api4.ipify.org/**', r => (v4 ? r.fulfill({ body: JSON.stringify({ ip: v4 }), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } }) : r.abort()));
  await ctx.route('https://api6.ipify.org/**', r => (v6 ? r.fulfill({ body: JSON.stringify({ ip: v6 }), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } }) : r.abort()));
}

async function visitor(name, net) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', userAgent: UA[name], viewport: { width: 1280, height: 800 } });
  await routes(ctx, net);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(name + ': ' + e.message));
  const checked = p.waitForResponse(r => r.url().includes('/checkAccess'), { timeout: 30000 });
  await p.goto('http://localhost:8765/index.html');
  await checked;
  const uid = await p.evaluate(async () => {
    const app = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
    const authM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
    return authM.getAuth(app.getApp()).currentUser.uid;
  });
  return { p, ctx, uid };
}

const asha = await visitor('asha', { seen: A4, v4: A4, v6: A6 });     // IPv4 seen; the phone also reports its IPv6
const bilal = await visitor('bilal', { seen: A4, v4: A4, v6: '' });   // same Wi-Fi as Asha, no IPv6
const chen = await visitor('chen', { seen: C6, v4: C4, v6: C6 });     // IPv6 seen; reports its IPv4

// ---- nobody but the server can read the log
const peek = await asha.p.evaluate(async () => {
  const app = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const f = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const fnM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js');
  const a = app.getApp(); const db = f.getFirestore(a);
  const fns = fnM.getFunctions(a, 'asia-south1'); try { fnM.connectFunctionsEmulator(fns, '127.0.0.1', 5001); } catch {}
  const tryIt = async fn => { try { await fn(); return 'ALLOWED'; } catch (e) { return e.code; } };
  return {
    list: await tryIt(() => f.getDocs(f.collection(db, 'artifacts', 'anon-connect', 'private', 'data', 'visits'))),
    write: await tryIt(() => f.setDoc(f.doc(db, 'artifacts', 'anon-connect', 'private', 'data', 'visits', 'x'), { ip: '1.1.1.1' })),
    adminCall: await tryIt(() => fnM.httpsCallable(fns, 'admin')({ action: 'visits', q: '' })),
  };
});
step('1. a visitor cannot read or write the log, or ask the admin service for it', peek.list === 'permission-denied' && peek.write === 'permission-denied' && /permission-denied/.test(peek.adminCall), JSON.stringify(peek));

// ---- the place is saved into the row at visit time (onVisitWritten), read straight from the database
const FS = 'http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/artifacts/anon-connect/private/data/visits?pageSize=1000';
const rowsOf = async uid => {
  const j = await (await fetch(FS, { headers: { Authorization: 'Bearer owner' } })).json();
  const plain = v => (v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)])) : v.stringValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : v.booleanValue));
  return (j.documents || []).map(d => Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, plain(v)]))).filter(r => r.uid === uid);
};
let saved = [];
for (let i = 0; i < 30 && !(saved[0]?.g && saved[0]?.g6); i++) { await new Promise(r => setTimeout(r, 500)); saved = await rowsOf(asha.uid); }
const sg = saved[0] || {};
step('1b. just after the visit, the place of each address is saved in the row (seen and reported)',
  sg.g?.ip === A4 && sg.g.city === 'New Delhi' && sg.g.org === 'AS24560 Bharti Airtel' && sg.g6?.ip === A6 && sg.g6.city === 'Mumbai' && typeof sg.g.at === 'number', JSON.stringify({ g: sg.g, g6: sg.g6 }));
for (let i = 0; i < 30; i++) { const c = (await rowsOf(chen.uid))[0]; if (c?.g && c?.g4) break; await new Promise(r => setTimeout(r, 500)); }
const callsBeforeOpen = await ipinfoCalls();

// ---- the admin page
const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
await routes(ctx, { seen: '198.51.100.7', v4: '', v6: '' });
await ctx.route('**/js/admin.js', r => r.fulfill({ body: patched, contentType: 'text/javascript' }));
await ctx.addInitScript(() => { window.__adminToken = JSON.stringify({ sub: 'g-boss', email: 'boss@example.com', email_verified: true }); });
const p = await ctx.newPage();
p.on('pageerror', e => errors.push('admin: ' + e.message));
p.on('dialog', d => d.accept());
await p.goto('http://localhost:8765/admin.html');
await p.waitForSelector('#signin:not(.hidden)', { timeout: 20000 });
await p.click('#signInBtn');
await p.waitForSelector('#panel:not(.hidden)', { timeout: 20000 });
await p.click('#tabs button[data-tab="visits"]');
await p.waitForFunction(() => document.querySelectorAll('#visitsList .visit').length > 0, null, { timeout: 20000 }).catch(() => {});
const latest = await p.textContent('#visitsList');
step('2. the Visits tab opens on the latest visits', latest.includes(A4) && latest.includes(C6) && /The latest visits: \d+ rows/.test(latest), latest.slice(0, 200));
step('2b. opening the log uses the places saved at visit time: no new lookups', (await ipinfoCalls()) === callsBeforeOpen, `${callsBeforeOpen} -> ${await ipinfoCalls()}`);

const rowOf = (uid) => p.evaluate(u => [...document.querySelectorAll('#visitsList .visit')].map(x => x.innerText).find(t => t.includes(u.slice(0, 8))) || '', uid);
const a = await rowOf(asha.uid);
step('3. a row: IPv4 seen by the server, the IPv6 the phone reported, both with the place and network, and the device',
  a.includes(A4) && /IPV4|IPv4/i.test(a) && a.includes('seen by the server') && a.includes(A6) && a.includes('reported by the device')
  && a.includes('New Delhi, Delhi') && a.includes('Bharti Airtel') && a.includes('Mumbai, Maharashtra') && a.includes('Chrome 131 · Android 14 · Pixel 7') && /anonymous/i.test(a), a);
const c = await rowOf(chen.uid);
step('4. an IPv6 visitor: the IPv6 is what the server saw (full address, not cut to /64), the IPv4 is reported', c.includes(C6) && c.includes('seen by the server') && c.includes(C4) && c.includes('Edge 131 · Windows 10/11'), c);
const b = await rowOf(bilal.uid);
step('5. a reported address equal to the seen one is not listed twice; no IPv6 means none shown', b.includes(A4) && !b.includes('reported by the device') && b.includes('Safari 17 · iOS 17 · iPhone'), b);

// ---- follow an address: both accounts on the shared Wi-Fi
await p.fill('#visitsQuery', A4);
await p.click('#visitsForm button[type=submit]');
await p.waitForFunction(ip => document.getElementById('visitsList').textContent.includes(`Every visit from ${ip}`), A4, { timeout: 15000 });
const shared = await p.textContent('#visitsList');
step('6. searching the IP address finds both accounts that used it', /2 accounts/.test(shared) && shared.includes(asha.uid.slice(0, 8)) && shared.includes(bilal.uid.slice(0, 8)) && !shared.includes(chen.uid.slice(0, 8)), shared.slice(0, 160));
await p.fill('#visitsQuery', A6);
await p.click('#visitsForm button[type=submit]');
await p.waitForFunction(ip => document.getElementById('visitsList').textContent.includes(`Every visit from ${ip}`), A6, { timeout: 15000 });
step('7. searching a reported address finds it too', (await p.textContent('#visitsList')).includes(asha.uid.slice(0, 8)));

// ---- tap an account in a row: everything that account did
const callsBefore = await ipinfoCalls();
await p.locator('#visitsList .visit .linkish', { hasText: asha.uid.slice(0, 8) }).first().click();
await p.waitForFunction(() => /Every visit by account/.test(document.getElementById('visitsList').textContent), null, { timeout: 15000 });
step('8. tapping the account shows that account\'s visits', /1 account/.test(await p.textContent('#visitsList')));
step('9. places come from the cache the second time (no new lookups)', (await ipinfoCalls()) === callsBefore, `${callsBefore} -> ${await ipinfoCalls()}`);

// ---- the same visitor again in the same half hour: one row, counted
const again = asha.p.waitForResponse(r => r.url().includes('/checkAccess'), { timeout: 30000 });
await asha.p.reload();
await again;
await p.click('#visitsLatest');
await p.waitForFunction(() => /The latest visits/.test(document.getElementById('visitsList').textContent), null, { timeout: 15000 });
await p.waitForTimeout(500);
const rows = await p.evaluate(u => [...document.querySelectorAll('#visitsList .visit')].map(x => x.innerText).filter(t => t.includes(u.slice(0, 8))), asha.uid);
step('10. a second visit in the same half hour adds to the row ("2 check-ins") instead of a new row', rows.length === 1 && /2 check-ins/.test(rows[0]), JSON.stringify(rows).slice(0, 200));

// ---- ban from a row
const bansBefore = Number(await p.textContent('#countBans'));
const chenRow = p.locator('#visitsList .visit', { hasText: chen.uid.slice(0, 8) });
await chenRow.locator('button', { hasText: 'Ban 24 h' }).click();
await p.waitForFunction(n => Number(document.getElementById('countBans').textContent) > n, bansBefore, { timeout: 15000 }).catch(() => {});
step('11. "Ban 24 h" on a row bans that account, address and device', Number(await p.textContent('#countBans')) > bansBefore, `${bansBefore} -> ${await p.textContent('#countBans')}`);
const banned = chen.p.waitForResponse(r => r.url().includes('/checkAccess'), { timeout: 30000 });
await chen.p.reload();
const res = await (await banned).json().catch(() => ({}));
step('12. that visitor is turned away on their next visit', res?.result?.allowed === false, JSON.stringify(res).slice(0, 160));

await p.click('#visitsLatest');
await p.waitForTimeout(1500);
await p.locator('[data-view="visits"]').screenshot({ path: SP + '/visits-admin-desktop.png' });
await p.setViewportSize({ width: 375, height: 800 });
await p.waitForTimeout(300);
step('13. fits a phone (no sideways scroll)', await p.evaluate(() => document.documentElement.scrollWidth <= 376));
await p.screenshot({ path: SP + '/visits-admin.png', fullPage: false });
step('14. no page errors', !errors.length, errors.join('\n'));
await browser.close();
