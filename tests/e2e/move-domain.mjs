// The redirect from the old Firebase address to ohmygoal.app, in a real browser with both addresses simulated: it moves only when the
// new address really serves our site, keeps the path, and leaves the admin page and ?noredirect=1 alone. Static server on :8765.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const root = '/home/user/ohmygoal/';
const cfg = fs.readFileSync(root + 'config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const png = fs.readFileSync(root + 'icons/icon-192.png');
const mime = f => (f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : 'application/octet-stream');
const browser = await chromium.launch();
let bad = 0;
const step = (n, ok, x = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); };

/** The old address serves the real files; the new address behaves as `newHost` says. */
async function open(newHost, url) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const hits = [];
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.route('https://ohmygoal.web.app/**', r => {
    const u = new URL(r.request().url()); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    if (f === 'config.js') return r.fulfill({ body: cfg, contentType: 'text/javascript' });
    if (!fs.existsSync(root + f)) return r.fulfill({ status: 404, body: 'no' });
    return r.fulfill({ body: fs.readFileSync(root + f), contentType: mime(f) });
  });
  await ctx.route('https://ohmygoal.app/**', r => {
    const u = new URL(r.request().url()); hits.push(u.pathname);
    if (newHost === 'down') return r.abort();                                           // DNS or certificate not ready
    if (newHost === 'error-page') return r.fulfill({ status: 404, body: 'Site Not Found', contentType: 'text/html' });
    if (u.pathname === '/icons/icon-192.png') return r.fulfill({ body: png, contentType: 'image/png' });
    return r.fulfill({ body: '<!doctype html><title>NEW SITE</title>', contentType: 'text/html' });
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  return { p, ctx, hits };
}
const settle = p => p.waitForTimeout(1800);

{ const { p, ctx } = await open('ok', 'https://ohmygoal.web.app/?mode=video#start'); await settle(p);
  step('1. the new address works: the old one sends you there, keeping the query and the hash', p.url() === 'https://ohmygoal.app/?mode=video#start', p.url()); await ctx.close(); }
{ const { p, ctx } = await open('ok', 'https://ohmygoal.web.app/legal.html'); await settle(p);
  step('2. the legal page moves too, with its path', p.url() === 'https://ohmygoal.app/legal.html', p.url()); await ctx.close(); }
{ const { p, ctx } = await open('down', 'https://ohmygoal.web.app/'); await settle(p);
  step('3. the new address is not ready yet (no connection): you stay, and the site works', p.url().startsWith('https://ohmygoal.web.app/') && await p.locator('#startBtn').count() === 1, p.url()); await ctx.close(); }
{ const { p, ctx } = await open('error-page', 'https://ohmygoal.web.app/'); await settle(p);
  step('4. the new address answers with an error page instead of our site: you stay', p.url().startsWith('https://ohmygoal.web.app/') && await p.locator('#startBtn').count() === 1, p.url()); await ctx.close(); }
{ const { p, ctx, hits } = await open('ok', 'https://ohmygoal.web.app/?noredirect=1'); await settle(p);
  step('5. ?noredirect=1 keeps you on the old address and does not even check the new one', p.url().startsWith('https://ohmygoal.web.app/') && hits.length === 0, `${p.url()} ${hits}`); await ctx.close(); }
{ const { p, ctx, hits } = await open('ok', 'https://ohmygoal.web.app/admin.html'); await settle(p);
  step('6. the admin page is never moved', p.url() === 'https://ohmygoal.web.app/admin.html' && hits.length === 0, p.url()); await ctx.close(); }
{ const { p, ctx, hits } = await open('ok', 'https://ohmygoal.web.app/'); await settle(p);
  step('7. the probe asks only for the site icon (nothing private is sent)', hits.length >= 1 && hits.every(h => h === '/icons/icon-192.png' || h === '/'), hits.join(',')); await ctx.close(); }
{ const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  const p = await ctx.newPage(); await p.goto('http://localhost:8765/index.html'); await p.waitForSelector('#startBtn'); await settle(p);
  step('8. on localhost nothing moves', p.url() === 'http://localhost:8765/index.html', p.url()); await ctx.close(); }
await browser.close();
process.exit(bad ? 1 : 0);
