// The eight world languages on the landing page: the browser language picks them, the page is translated, Arabic is right to left, no sideways scroll or errors on phone and desktop. Local demo mode; static server on :8765.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const b = await chromium.launch();
const codes = ['es', 'pt', 'ar', 'id', 'tr', 'ru', 'fr', 'de'];
let bad = 0; const step = (n, ok, x = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); };
for (const [label, vp] of [['phone', { width: 360, height: 740 }], ['desktop', { width: 1280, height: 800 }]]) {
  for (const code of codes) {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: vp, locale: code });
    await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
    await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8765/index.html');
    await p.waitForSelector('#startBtn'); await p.waitForTimeout(600);
    const info = await p.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, sel: document.getElementById('uiLang').value, sw: document.documentElement.scrollWidth, iw: innerWidth, start: document.getElementById('startBtn').textContent.trim(), h1: document.querySelector('h1')?.textContent.trim().slice(0, 50) }));
    step(`${label} ${code}: browser language picks it, page is translated`, info.lang === code && info.sel === code && info.start !== 'Start chatting', JSON.stringify(info));
    step(`${label} ${code}: direction ${code === 'ar' ? 'rtl' : 'ltr'}`, info.dir === (code === 'ar' ? 'rtl' : 'ltr'));
    step(`${label} ${code}: no sideways scroll`, info.sw <= info.iw + 1, `${info.sw}/${info.iw}`);
    step(`${label} ${code}: no page errors`, errs.length === 0, errs.join('|'));
    if (label === 'phone' || code === 'ar') void 0;
    await ctx.close();
  }
}
await b.close(); process.exit(bad ? 1 : 0);
