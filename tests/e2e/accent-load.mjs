// The colour theme while the page loads (the script in index.html + syncProAccent in js/app.js): a Premium colour is never painted
// for someone who is not Premium and then swapped for the free one; free colours show from the first paint; a stale "was Premium"
// note corrects itself. Against the emulators (Premium answer from the real Premium code).
// Needs: emulators (auth, firestore, functions), the firebase npm package in SP/fb, a static server on 8765.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`);
const browser = await chromium.launch();
const step = (n, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`);
const logs = [];

async function load(saved) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(saved => {
    for (const [k, v] of Object.entries(saved)) localStorage.setItem('ac.' + k, JSON.stringify(v));
    // every colour the page ever shows, from before the first paint
    window.__accents = [];
    const note = () => { const a = document.documentElement.dataset.accent || 'rani'; if (window.__accents[window.__accents.length - 1] !== a) window.__accents.push(a); };
    new MutationObserver(note).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-accent'] });
    document.addEventListener('readystatechange', note);
  }, saved);
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|fonts\.g|country\.is|googlesyndication/, r => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', e => logs.push('PAGEERR ' + e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.waitForSelector('#premiumBtn:not(.hidden):not(.late)', { timeout: 20000 });
  await p.waitForTimeout(1500); // the Premium answer
  const r = await p.evaluate(() => ({ seen: window.__accents, now: document.documentElement.dataset.accent || 'rani', proUntil: JSON.parse(localStorage.getItem('ac.proUntil')), saved: JSON.parse(localStorage.getItem('ac.accent')) }));
  await ctx.close();
  return r;
}

const a = await load({ accent: 'chai' });
step('1. not Premium, Chai saved: the page never shows Chai (free colour from the first paint), and the choice is kept', !a.seen.includes('chai') && a.now === 'rani' && a.saved === 'chai' && a.proUntil === 0, JSON.stringify(a));
const b = await load({ accent: 'monsoon' });
step('2. a free colour (Monsoon) shows from the first paint and never changes', JSON.stringify(b.seen) === '["monsoon"]' && b.now === 'monsoon', JSON.stringify(b));
const c = await load({ accent: 'holi', proUntil: Date.now() + 864e5 });
step('3. "was Premium" noted but the Premium has gone: Holi first (expected), then the free colour, and the note is cleared', c.seen[0] === 'holi' && c.now === 'rani' && c.proUntil === 0 && c.saved === 'holi', JSON.stringify(c));
const d = await load({ accent: 'chai' });
step('4. after that, the next visit no longer flashes the Premium colour', !d.seen.includes('chai') && d.now === 'rani', JSON.stringify(d));
step('5. no page errors', !logs.length, logs.join('\n'));
await browser.close();
