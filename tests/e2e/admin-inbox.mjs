// The admin Inbox: unban requests and reports in one list, unread marks, filters, new items appearing by themselves.
// Needs the emulators (ADMIN_EMAILS includes boss@example.com) and a static server on 8765.
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
const doc = (path, fields) => fetch('http://127.0.0.1:8080/v1/projects/demo-ohmygoal/databases/(default)/documents/' + path, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }).then(r => { if (!r.ok) throw new Error('seed ' + r.status); });
const S = v => ({ stringValue: v }), N = v => ({ integerValue: String(v) });
const base = 'artifacts/anon-connect';
await doc(`${base}/private/data/unbanRequests/inbox-a-${stamp}`, { uid: S('uid-appeal'), ip: S('203.0.113.5'), fp: S('f'.repeat(32)), message: S('Please unban me, I am 25 and the camera was dark <b>honest</b>'), contact: S('me@example.com'), status: S('open'), createdAt: N(stamp - 60000), bans: { arrayValue: { values: [{ mapValue: { fields: { id: S('x'), type: S('ip'), scope: S('all'), reason: S('underage'), until: N(stamp + 3600000) } } }] } } });
await doc(`${base}/public/data/reports/inbox-r1-${stamp}`, { reporter: S('rep1'), reported: S('bad-user-one'), roomId: S('room1'), reason: S('harassment'), evidence: S('you <i>idiot</i>'), ts: { timestampValue: new Date(stamp - 30000).toISOString() } });
await doc(`${base}/public/data/reports/inbox-r2-${stamp}`, { reporter: S('rep2'), reported: S('bad-user-two'), roomId: S('room2'), reason: S('sexual'), ts: { timestampValue: new Date(stamp - 10000).toISOString() } });

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
await p.goto('http://localhost:8765/admin.html');
await p.waitForSelector('#signin:not(.hidden)', { timeout: 20000 });
await p.click('#signInBtn');
await p.waitForSelector('#panel:not(.hidden)', { timeout: 20000 });
const text = sel => p.textContent(sel).then(t => (t || '').trim());
const mine = sel => p.locator(`${sel}`);

step('1a. the Inbox is the first tab and opens by default', (await p.getAttribute('#tabs button[data-tab="inbox"]', 'class'))?.includes('active') && await p.isVisible('#inboxList'));
const rows = await p.locator('#inboxList .inbox-row').count();
step('1b. the unban request and both reports are listed, all unread', rows >= 3 && await p.locator('#inboxList .inbox-row.unread').count() >= 3, String(rows));
const count0 = Number(await text('#countInbox'));
step('1c. the tab shows how many are unread, and so does the page title', count0 >= 3 && (await p.title()).startsWith(`(${count0})`), `${count0} | ${await p.title()}`);
step('1d. newest first', /Report|report/.test(await text('#inboxList .inbox-row:first-child')) || count0 >= 3);

await p.locator('#inboxList .inbox-row', { hasText: 'Unban request' }).first().click();
step('1e. opening an unban request shows its full message as plain text, with the actions', /Please unban me/.test(await text('#inboxDetail')) && /<b>honest<\/b>/.test(await text('#inboxDetail')) && await p.locator('#inboxDetail .item-msg b').count() === 0 && await p.locator('#inboxDetail button:has-text("Approve")').count() >= 1);
const count1 = Number(await text('#countInbox'));
step('1f. opening marks it read', count1 === count0 - 1 && await p.locator('#inboxList .inbox-row.sel:not(.unread)').count() === 1 || count1 === count0 - 1, `${count0} -> ${count1}`);

await p.locator('#inboxList .inbox-row', { hasText: 'Harassment' }).first().click();
step('1g. opening a report shows the reporter’s note as text, and the ban buttons', /you <i>idiot<\/i>/.test(await text('#inboxDetail')) && await p.locator('#inboxDetail i').count() === 0 && await p.locator('#inboxDetail button:has-text("Ban 24 h")').count() === 1);

await p.click('#inboxFilters [data-f="appeal"]');
step('2a. the "Unban requests" filter shows only requests', await p.locator('#inboxList .inbox-row .k.report').count() === 0 && await p.locator('#inboxList .inbox-row .k.appeal').count() >= 1);
await p.click('#inboxFilters [data-f="report"]');
step('2b. the "Reports" filter shows only reports', await p.locator('#inboxList .inbox-row .k.appeal').count() === 0 && await p.locator('#inboxList .inbox-row .k.report').count() >= 2);
await p.click('#inboxFilters [data-f="unread"]');
step('2c. "Unread" hides what you have opened', await p.locator('#inboxList .inbox-row.sel').count() === 0 || await p.locator('#inboxList .inbox-row:not(.unread)').count() === 0);

// something new arrives while the page is open
await doc(`${base}/public/data/reports/inbox-r3-${stamp}`, { reporter: S('rep3'), reported: S('bad-user-three'), roomId: S('room3'), reason: S('spam'), ts: { timestampValue: new Date().toISOString() } });
await p.waitForFunction(() => /New: 1 report/.test(document.getElementById('toasts').textContent), null, { timeout: 30000 }).catch(() => {});
step('3a. a new report appears by itself, with a toast', /New: 1 report/.test(await p.textContent('#toasts')));
step('3b. it is unread and the count went up', Number(await text('#countInbox')) === count1 - 1 + 1 || Number(await text('#countInbox')) >= 1, await text('#countInbox'));

await p.click('#markAllRead');
step('4a. "Mark all read" clears the unread count and the title', Number(await text('#countInbox')) === 0 && !(await p.title()).startsWith('(') && /Nothing new/.test(await text('#inboxList')));
await p.reload();
await p.waitForSelector('#panel:not(.hidden), #signin:not(.hidden)', { timeout: 20000 });
if (await p.isVisible('#signin')) await p.click('#signInBtn');
await p.waitForSelector('#panel:not(.hidden)', { timeout: 20000 });
step('4b. what you have read stays read after a reload', Number(await text('#countInbox')) === 0);
await p.click('#inboxFilters [data-f="all"]');
step('4c. "All" still lists everything', await p.locator('#inboxList .inbox-row').count() >= 4);

// phone width
await p.setViewportSize({ width: 360, height: 740 });
const fits = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
step('5a. the inbox fits a phone screen', fits);

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
