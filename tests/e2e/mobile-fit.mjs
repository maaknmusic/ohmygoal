// Phone fit, the way a real phone sees it: with mobile emulation a page that has anything wider than the screen makes the phone zoom the whole
// page out ("the page doesn't fit"), which a desktop-width check never shows. Checks every main screen at 320 to 430 px for anything that is
// wider than the screen and not inside its own scrolling box. Needs the emulators (for the Live tab) and a static server on :8765.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`);
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
let bad = 0;
const step = (n, ok, x = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); };

const probe = (W) => {
  const clipped = el => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) { const o = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(o.overflowX)) { const r = a.getBoundingClientRect(); if (r.right <= W + 1 && r.left >= -1) return true; } } return false; };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('.hidden')) continue;
    const bb = el.getBoundingClientRect(); if (!bb.width || !bb.height || el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    if ((bb.right > W + 1 || bb.left < -1) && !clipped(el)) out.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className?.baseVal ?? el.className).split(' ').slice(0, 2).join('.') + ` ${Math.round(bb.left)}..${Math.round(bb.right)}`);
  }
  return { iw: innerWidth, sw: document.documentElement.scrollWidth, out: [...new Set(out)].slice(0, 5) };
};

async function page(W, { url = 'index.html', routes = true } = {}) {
  const ctx = await b.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: W, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); await ctx.addInitScript(() => { try { localStorage.setItem('ac.safetyBrief', 'true'); } catch { /* storage off */ } });   // first-chat safety sheet: tests/e2e/safety-brief.mjs
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.route('http://127.0.0.1:5001/**', r => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': '198.51.100.' + (130 + (W % 100)) } }));
  await ctx.addInitScript(() => { localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5)); });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8765/' + url);
  return { p, ctx };
}
const fits = async (p, W, label) => { const r = await p.evaluate(probe, W); step(`${W}px ${label}`, r.sw <= W + 1 && r.iw === W && r.out.length === 0, JSON.stringify(r)); };

for (const W of [320, 360, 390, 430]) {
  { const { p, ctx } = await page(W); await p.waitForSelector('#startBtn'); await p.waitForTimeout(1200);
    await fits(p, W, 'start page');
    await p.fill('#nickInput', 'Tester'); await p.check('#ageCheck');
    await p.click('#groupBtn'); await p.waitForSelector('#groupLobby:not(.hidden)', { timeout: 10000 });
    await fits(p, W, 'group rooms');
    await p.click('[data-gtab="live"]'); await p.waitForSelector('#livePane .live-bar', { timeout: 15000 }); await p.waitForTimeout(500);
    await fits(p, W, 'live sessions tab (signed out)');
    await ctx.close(); }
  { const { p, ctx } = await page(W); await p.waitForSelector('#startBtn'); await p.waitForTimeout(800);
    await p.click('#menuBtn'); await p.waitForTimeout(500); await fits(p, W, 'menu sheet');
    await ctx.close(); }
  { const { p, ctx } = await page(W, { url: 'legal.html' }); await p.waitForTimeout(800); await fits(p, W, 'terms and policies'); await ctx.close(); }
  { const { p, ctx } = await page(W, { url: 'admin.html' }); await p.waitForSelector('#signin:not(.hidden), #panel:not(.hidden)', { timeout: 20000 }); await p.waitForTimeout(500); await fits(p, W, 'admin sign-in'); await ctx.close(); }
}
// ---- signed-in screens: the host panel on the Live tab, and every admin tab (tables, forms)
const friendsSrc = fs.readFileSync('/home/user/ohmygoal/js/friends.js', 'utf8');
const friendsPatched = friendsSrc.replace('if (user?.isAnonymous) await linkWithPopup(user, provider);', 'if (user?.isAnonymous) await this.authMod.linkWithCredential(user, GoogleAuthProvider.credential(window.__fakeIdToken));');
const adminSrc = fs.readFileSync('/home/user/ohmygoal/js/admin.js', 'utf8');
const adminPatched = adminSrc.replace('await authMod.signInWithPopup(auth, provider);', 'await authMod.signInWithCredential(auth, authMod.GoogleAuthProvider.credential(window.__adminToken));');
if (friendsPatched === friendsSrc || adminPatched === adminSrc) throw new Error('a patch did not apply');
for (const W of [320, 360]) {
  { const { p, ctx } = await page(W);
    await ctx.route('**/js/friends.js', r => r.fulfill({ body: friendsPatched, contentType: 'text/javascript' }));
    await ctx.addInitScript(() => { window.__fakeIdToken = JSON.stringify({ sub: 'google-fit-' + Date.now(), email: `fit${Date.now()}@example.com`, email_verified: true, name: 'Fit Test' }); });
    await p.reload(); await p.waitForSelector('#startBtn'); await p.waitForTimeout(800);
    await p.fill('#nickInput', 'Tester'); await p.check('#ageCheck');
    await p.click('#groupBtn'); await p.waitForSelector('#groupLobby:not(.hidden)', { timeout: 10000 });
    await p.click('[data-gtab="live"]'); await p.waitForSelector('#livePane .live-bar', { timeout: 15000 });
    await p.click('#livePane button:has-text("Sign in with Google")');
    await p.waitForSelector('#liveTitle', { timeout: 25000 }); await p.waitForTimeout(600);
    await fits(p, W, 'live tab: the host panel (go live form and earnings)');
    await ctx.close(); }
  { const { p, ctx } = await page(W, { url: 'admin.html' });
    await ctx.route('**/js/admin.js', r => r.fulfill({ body: adminPatched, contentType: 'text/javascript' }));
    await ctx.addInitScript(() => { window.__adminToken = JSON.stringify({ sub: 'g-boss', email: 'boss@example.com', email_verified: true }); });
    await p.reload(); await p.waitForSelector('#signin:not(.hidden)', { timeout: 20000 }); await p.click('#signInBtn'); await p.waitForSelector('#panel:not(.hidden)', { timeout: 20000 });
    for (const tab of ['dashboard', 'hosts', 'premium', 'payments', 'people', 'inbox', 'bans']) {
      await p.click(`#tabs button[data-tab="${tab}"]`); await p.waitForTimeout(1500);
      await fits(p, W, `admin: ${tab} tab`);
    }
    await ctx.close(); }
}
await b.close();
console.log(bad ? `${bad} FAILED` : 'ALL PASSED');
process.exit(bad ? 1 : 0);
