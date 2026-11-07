// The safety sheet shown once before the first voice or video chat (how blackmail / sextortion scams start and what to do), and the
// "Being blackmailed?" line in the safety sheet. Local demo mode; needs a static server on :8765 and NODE_PATH with playwright.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };

async function open(mode, lang) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(([m, l]) => {
    localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    localStorage.setItem('ac.mode', JSON.stringify(m));
    if (l) localStorage.setItem('ac.uiLang', JSON.stringify(l));
  }, [mode, lang || '']);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => !document.getElementById('startBtn').disabled, null, { timeout: 15000 });
  await p.check('#ageCheck');
  return { ctx, p };
}
const sheetOpen = p => p.isVisible('#safeFirstSheet');

// 1. video: the sheet comes first, every time until it is acknowledged
{
  const { ctx, p } = await open('video');
  await p.click('#startBtn');
  await p.waitForSelector('#safeFirstSheet:not(.hidden)', { timeout: 5000 }).catch(() => {});
  const txt = await p.textContent('#safeFirstSheet');
  step('1a. the first video chat starts with the safety sheet: never undress on camera, how blackmail starts, don’t pay, 1930 and cybercrime.gov.in',
    await sheetOpen(p) && /Never undress/.test(txt) && /threatens to share a recording/.test(txt) && /don’t pay/.test(txt) && /1930/.test(txt) && /cybercrime\.gov\.in/.test(txt), txt.slice(0, 120));
  const searching0 = await p.evaluate(() => !document.getElementById('chat').classList.contains('hidden'));
  step('1b. no chat starts while the sheet is open', !searching0);
  await p.click('#safeFirstSheet [data-sheet-close]');
  await p.click('#startBtn');
  step('1c. closing it without "I understand" shows it again on the next start', await p.waitForSelector('#safeFirstSheet:not(.hidden)', { timeout: 5000 }).then(() => true, () => false));
  await p.click('#safeFirstOk');
  const started = await p.waitForFunction(() => !document.getElementById('chat').classList.contains('hidden'), null, { timeout: 10000 }).then(() => true, () => false);
  step('1d. "I understand" closes it, remembers it and starts the chat', started && !(await sheetOpen(p)) && await p.evaluate(() => localStorage.getItem('ac.safetyBrief')) === 'true');
  await p.reload();
  await p.waitForFunction(() => !document.getElementById('startBtn').disabled, null, { timeout: 15000 });
  await p.check('#ageCheck').catch(() => {});
  await p.click('#startBtn');
  await p.waitForTimeout(800);
  step('1e. it is shown only once per device', !(await sheetOpen(p)));
  await ctx.close();
}

// 2. text chats skip it; voice gets it
{
  const t = await open('text');
  await t.p.click('#startBtn');
  await t.p.waitForTimeout(800);
  step('2a. a text chat starts without the sheet', !(await sheetOpen(t.p)));
  await t.ctx.close();
  const v = await open('voice');
  await v.p.click('#startBtn');
  step('2b. a voice chat gets it too', await v.p.waitForSelector('#safeFirstSheet:not(.hidden)', { timeout: 5000 }).then(() => true, () => false));
  await v.ctx.close();
}

// 3. the safety sheet has the "Being blackmailed?" steps, and both are translated
{
  const { ctx, p } = await open('video');
  const safety = await p.evaluate(() => document.getElementById('safetySheet')?.textContent || '');
  step('3a. the safety sheet explains what to do when blackmailed', /Being blackmailed\? Don’t pay/.test(safety) && /You are not in trouble for reporting/.test(safety));
  await ctx.close();
  const hi = await open('video', 'hi');
  await hi.p.click('#startBtn');
  await hi.p.waitForSelector('#safeFirstSheet:not(.hidden)', { timeout: 5000 }).catch(() => {});
  const ht = await hi.p.textContent('#safeFirstSheet');
  step('3b. in Hindi the sheet is in Hindi', /पहली चैट से पहले/.test(ht) && /कपड़े न उतारें/.test(ht) && /1930/.test(ht), ht.slice(0, 80));
  await hi.ctx.close();
}

step('4. no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
