// The language picker fits at 320, 360 and 390 px wide in every interface language. Static server on :8765.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const b = await chromium.launch(); let bad = 0;
for (const w of [320, 360, 390]) for (const code of ['en', 'hi', 'es', 'pt', 'ar', 'id', 'tr', 'ru', 'fr', 'de']) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 700 }, locale: code });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  const p = await ctx.newPage(); await p.goto('http://localhost:8765/index.html'); await p.waitForSelector('#startBtn'); await p.waitForTimeout(400);
  const r = await p.evaluate(() => { const s = document.getElementById('uiLang'); const bb = s.getBoundingClientRect(); const o = s.options[s.selectedIndex].text; return { sw: document.documentElement.scrollWidth, iw: innerWidth, clipped: s.scrollWidth > s.clientWidth + 1, right: Math.round(bb.right), left: Math.round(bb.left), text: o }; });
  const ok = r.sw <= r.iw + 1 && r.left >= 0 && r.right <= r.iw;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${w}px ${code} ${JSON.stringify(r)}`);
  await ctx.close();
}
await b.close(); process.exit(bad ? 1 : 0);
