// The admin Hosts tab against the emulators: the usage and margin table, what is live now (and ending it), hosts and their earnings,
// suspending and reinstating, and paying out. Needs the emulators (ADMIN_EMAILS includes boss@example.com) and a static server on :8765.
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
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
const stamp = Date.now();
const FS = 'http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/';
const base = 'artifacts/anon-connect';
const typed = v => (typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) });
const put = (path, fields) => fetch(FS + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typed(v)])) }) }).then(r => { if (!r.ok) throw new Error('seed ' + r.status); });
const val = v => (v.integerValue !== undefined ? Number(v.integerValue) : v.stringValue !== undefined ? v.stringValue : v.booleanValue);
const read = async path => { const r = await fetch(FS + path, { headers: { Authorization: 'Bearer owner' } }); if (!r.ok) return null; return Object.fromEntries(Object.entries((await r.json()).fields || {}).map(([k, v]) => [k, val(v)])); };

// ---- seed: one active host with earnings, one suspended host, a live session, a payout waiting, and today's counters
const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const before = (await read(`${base}/private/data/stats/${day}`)) || {};
const hA = `host-a-${stamp}`, hB = `host-b-${stamp}`, sid = `AdminHostsLive${stamp}`.slice(0, 30);
await put(`${base}/private/data/hosts/${hA}`, { status: 'active', name: `Riya ${stamp}`, email: `riya${stamp}@example.com`, lastLiveAt: stamp - 5000, firstLiveAt: stamp - 90000 });
await put(`${base}/private/data/hostWallet/${hA}`, { coins: 300, pending: 800, paidOut: 100, lifetime: 1200 });
await put(`${base}/private/data/hosts/${hB}`, { status: 'suspended', name: `Sam ${stamp}`, email: `sam${stamp}@example.com`, lastLiveAt: stamp - 99999 });
await put(`${base}/private/data/hostWallet/${hB}`, { coins: 10, pending: 0, paidOut: 0, lifetime: 10 });
await put(`${base}/public/data/groups/${sid}`, { topic: 'live', live: true, status: 'live', hostUid: hA, hostName: `Riya ${stamp}`, title: `Night talk ${stamp}`, mode: 'voice', cap: 8, kind: 'public', fee: 0, maxGuests: 7, created: Date.now(), endsAt: Date.now() + 3 * 3600000 });
const payId = `PayoutAdmin${stamp}`.slice(0, 30);
await put(`${base}/private/data/payouts/${payId}`, { uid: hA, coins: 800, paise: 60000, details: `riya${stamp}@upi (Riya Sharma)`, status: 'requested', at: Date.now() - 60000 });
await put(`${base}/private/data/stats/${day}`, { liveStarts: (before.liveStarts || 0) + 5, liveFeeCoins: (before.liveFeeCoins || 0) + 245, privateJoins: (before.privateJoins || 0) + 2, liveGifts: (before.liveGifts || 0) + 10, hostShareCoins: (before.hostShareCoins || 0) + 300, platformShareCoins: (before.platformShareCoins || 0) + 129, liveMinutes: (before.liveMinutes || 0) + 120, liveParticipantMinutes: (before.liveParticipantMinutes || 0) + 600, liveEnded: (before.liveEnded || 0) + 4, dau: before.dau || 0 });

const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': '198.51.100.7' } }));
await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
await ctx.route(/jsdelivr|fonts\.g|country\.is/, r => r.abort());
await ctx.route('**/js/admin.js', r => r.fulfill({ body: patched, contentType: 'text/javascript' }));
await ctx.addInitScript(() => { window.__adminToken = JSON.stringify({ sub: 'g-boss', email: 'boss@example.com', email_verified: true }); });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('dialog', d => d.accept());
await p.goto('http://localhost:8765/admin.html');
await p.waitForSelector('#signin:not(.hidden)', { timeout: 20000 });
await p.click('#signInBtn');
await p.waitForSelector('#panel:not(.hidden)', { timeout: 20000 });
const text = sel => p.textContent(sel).then(t => (t || '').trim());

await p.waitForFunction(() => Number(document.getElementById('countHosts').textContent) >= 1, null, { timeout: 15000 }).catch(() => {});
step('1a. there is a Hosts tab, and its badge counts the payouts waiting', await p.locator('#tabs button[data-tab="hosts"]').count() === 1 && Number(await text('#countHosts')) >= 1);
await p.click('#tabs button[data-tab="hosts"]');
await p.waitForSelector('#hostsBody .tile', { timeout: 20000 });
step('1b. the tiles: live now, hosts, payouts to make, what you owe hosts', /Live now/.test(await text('#hostsBody .tiles')) && /Payouts to make/.test(await text('#hostsBody .tiles')) && /You owe hosts/.test(await text('#hostsBody .tiles')));
const table = await text('#hostsBody table');
step('1c. the usage table has Today, 7 days and 30 days with income, owed to hosts, estimated cost and margin', /Today/.test(table) && /7 days/.test(table) && /30 days/.test(table) && /Your income/.test(table) && /Est\. cost/.test(table) && /Margin/.test(table), table.slice(0, 200));
step('1d. the explanation says how income and cost are worked out', /49-coin start fees plus your 30%/.test(await text('#hostsBody')) && /per person per hour/.test(await text('#hostsBody')));
step('2a. the live session is listed with its title, host and an End button', new RegExp(`Night talk ${stamp}`).test(await text('#hostsBody')) && await p.locator('#hostsBody button:has-text("End this session")').count() >= 1);
step('3a. hosts are listed with status, earnings in coins and rupees, and what is waiting', (await text('#hostsBody')).includes(`Riya ${stamp}`) && (await text('#hostsBody')).includes(`Sam ${stamp}`) && /300 coins · ₹225/.test(await text('#hostsBody')) && /800 coins · ₹600/.test(await text('#hostsBody')));
step('4a. the payout shows who to pay, how much, and where', (await text('#hostsBody')).includes(`riya${stamp}@upi (Riya Sharma)`) && /₹600/.test(await text('#hostsBody')) && /To pay/.test(await text('#hostsBody')));

// end the live session
await p.locator('#hostsBody .item', { hasText: `Night talk ${stamp}` }).locator('button:has-text("End this session")').click();
await p.waitForFunction(id => !document.getElementById('hostsBody').textContent.includes(id), `Night talk ${stamp}`, { timeout: 15000 }).catch(() => {});
step('2b. ending a session from here closes it', (await read(`${base}/public/data/groups/${sid}`)).status === 'ended' && !(await text('#hostsBody')).includes(`Night talk ${stamp}`));

// suspend and reinstate
const rowA = p.locator('#hostsBody .item', { hasText: `Riya ${stamp}` }).filter({ hasText: 'Owed to host' });
await rowA.locator('button:has-text("Suspend")').click();
await p.waitForFunction(n => [...document.querySelectorAll('#hostsBody .item')].some(i => i.textContent.includes(n) && /Suspended/.test(i.textContent) && /Reinstate/.test(i.textContent)), `Riya ${stamp}`, { timeout: 15000 }).catch(() => {});
step('3b. suspending a host shows "Suspended" and a Reinstate button; it is saved', (await read(`${base}/private/data/hosts/${hA}`)).status === 'suspended' && await rowA.locator('button:has-text("Reinstate")').count() === 1);
await rowA.locator('button:has-text("Reinstate")').click();
await p.waitForFunction(n => [...document.querySelectorAll('#hostsBody .item')].some(i => i.textContent.includes(n) && /Active/.test(i.textContent) && !/Reinstate/.test(i.textContent)), `Riya ${stamp}`, { timeout: 15000 }).catch(() => {});
step('3c. reinstating makes them active again', (await read(`${base}/private/data/hosts/${hA}`)).status === 'active');

// payout: a reference is required
const pay = p.locator('#hostsBody .item', { hasText: `riya${stamp}@upi` });
await pay.locator('button:has-text("Mark as paid")').click();
step('4b. marking a payout paid without a reference is refused with a message', /reference of the payment/.test(await p.textContent('#toasts')) && (await read(`${base}/private/data/payouts/${payId}`)).status === 'requested');
await pay.locator('input').fill(`UPI${stamp}`);
await pay.locator('button:has-text("Mark as paid")').click();
for (let i = 0; i < 30 && (await read(`${base}/private/data/payouts/${payId}`)).status !== 'paid'; i++) await new Promise(r => setTimeout(r, 300));
const wA = await read(`${base}/private/data/hostWallet/${hA}`);
step('4c. with a reference it is marked paid: the host’s pending coins move to paid out', (await read(`${base}/private/data/payouts/${payId}`)).status === 'paid' && wA.pending === 0 && wA.paidOut === 900, JSON.stringify(wA));

// phone width
await p.setViewportSize({ width: 360, height: 740 });
const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
step('5. on a phone the Hosts tab does not scroll sideways (tables scroll inside their own box)', w.sw <= w.iw + 1, JSON.stringify(w));
step('6. no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
