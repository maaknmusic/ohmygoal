// Stickers (free) and gifts (coins, online only): sending, receiving, hostile messages, the picker.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8') + '\nwindow.__t = { S, sendData };\n';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
async function pair(mode = 'text') {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(m => { localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5)); localStorage.setItem('ac.mode', JSON.stringify(m)); }, mode);
  const open = async name => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(name + ': ' + e.message)); await p.goto('http://localhost:8765/index.html'); await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting'); await p.fill('#nickInput', name); await p.check('#ageCheck'); return p; };
  const a = await open('Aarav'), b = await open('Meera');
  await a.click('#startBtn'); await b.click('#startBtn');
  const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 15000 }).then(() => true, () => false);
  return { ctx, a, b, ok: (await live(a)) && (await live(b)) };
}
const text = (p, sel) => p.textContent(sel).then(t => (t || '').trim());
const raw = (p, frames) => p.evaluate(fr => { const dc = window.__t.S.session.dc; for (const f of fr) dc.send(JSON.stringify(f)); }, frames);

{
  const { ctx, a, b, ok } = await pair();
  step('1a. match', ok);
  step('1b. the sticker button is on in a chat', !(await a.locator('#stickerBtn').isDisabled()));
  await a.click('#stickerBtn');
  const n = await a.locator('#stickerGrid .sticker-item').count();
  step('1c. the picker shows the eight free stickers as drawn images', n === 8 && await a.locator('#stickerGrid img').evaluateAll(is => is.every(i => i.src.startsWith('data:image/png'))));
  await a.click('#stickerGrid .sticker-item:nth-child(1)');
  await b.waitForSelector('.sticker-msg', { timeout: 5000 }).catch(() => {});
  step('1d. a sticker shows on both screens and closes the picker', await a.locator('.msg.me.sticker-msg img').count() === 1 && await b.locator('.msg.them.sticker-msg img').count() === 1 && !(await a.isVisible('#stickerPop')));
  await a.click('#stickerBtn'); await a.click('#tabGifts');
  const gifts = await a.locator('#stickerGrid .sticker-item small').allTextContents();
  step('1e. the Gifts tab shows eight gifts with coin prices', gifts.join() === '5,8,10,15,20,30,40,50' && await a.isVisible('#giftFoot'), gifts.join());
  await a.click('#stickerGrid .sticker-item:nth-child(1)');
  await a.waitForTimeout(400);
  step('1f. in the offline demo a gift explains and sends nothing', /online version/.test(await text(a, '#toasts')) && await b.locator('.sticker-msg').count() === 1);
  await a.keyboard.press('Escape');
  step('1g. Escape closes the picker', !(await a.isVisible('#stickerPop')));

  await raw(a, [{ t: 'sticker', id: 'rose' }, { t: 'sticker', id: '__proto__' }, { t: 'sticker', id: '<img src=x onerror=alert(1)>' }, { t: 'sticker', id: ['chai'] }, { t: 'sticker' }, { t: 'gift', id: 'chai' }, { t: 'gift', id: 'nope' }]);
  await b.waitForTimeout(500);
  step('1h. unknown, mismatched and malformed stickers/gifts are ignored', await b.locator('.sticker-msg').count() === 1);
  await raw(a, [{ t: 'gift', id: 'crown' }]);
  await b.waitForSelector('.sticker-msg:nth-of-type(2), .sticker-msg ~ .sticker-msg', { timeout: 4000 }).catch(() => {});
  step('1i. a gift from the other person shows with who sent it', /Aarav sent you a Crown/.test(await text(b, '#messages')));
  await raw(a, Array.from({ length: 30 }, () => ({ t: 'gift', id: 'rose' })));
  await b.waitForTimeout(700);
  step('1j. a gift storm is capped at twenty', await b.locator('.sticker-msg').count() <= 22);
  step('1k. the chat survives all of it', (await b.evaluate(() => window.__t.S.phase)) === 'connected');
  await ctx.close();
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
