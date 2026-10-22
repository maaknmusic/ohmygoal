// Reactions: original drawn sprites, tap and press-and-hold bursts, the Premium pack and a hostile peer.
// Local demo mode (two tabs of one browser context match each other, so everything is unlocked until a test says otherwise).
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
// A test handle on the app, and a switch for "this person is on the free plan" (the local demo is always unlocked otherwise).
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8')
  .replace('const isPremium = () => (premium ? premium.active : !premiumExpected);', 'const isPremium = () => (window.__free ? false : (premium ? premium.active : !premiumExpected));')
  .replace("function openPaywall(reason = 'menu') {", "function openPaywall(reason = 'menu') { (window.__paywalls ||= []).push(reason);")
  + '\nwindow.__t = { S, sendData };\n';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };

async function setup(mode = 'video', viewport = { width: 1280, height: 800 }, mobile = false) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport, hasTouch: mobile, isMobile: mobile });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(m => {
    localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    localStorage.setItem('ac.mode', JSON.stringify(m));
  }, mode);
  const open = async name => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load|net::|ERR_/.test(m.text())) errors.push(name + ' console: ' + m.text().slice(0, 160)); });
    await p.goto('http://localhost:8765/index.html');
    await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
    await p.fill('#nickInput', name); await p.check('#ageCheck');
    return p;
  };
  return { ctx, open };
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 15000 }).then(() => true, () => false);
const connect = async (a, b) => { await a.click('#startBtn'); await b.click('#startBtn'); return (await live(a)) && (await live(b)); };
const raw = (p, frames) => p.evaluate(fr => { const dc = window.__t.S.session.dc; for (const f of fr) dc.send(typeof f === 'string' ? f : JSON.stringify(f)); }, frames);
const floats = p => p.locator('.float-react').count();
/** Press and hold a reaction button for `ms` with the real mouse. */
async function hold(p, sel, ms) {
  const box = await p.locator(sel).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(ms);
  await p.mouse.up();
}

// ------------------------------------------------------------- 1. the bar, a tap, a hold
{
  const { ctx, open } = await setup('video');
  const a = await open('Aarav'), b = await open('Meera');
  step('1a. video match', await connect(a, b));
  await a.click('#reactBtn');
  const ids = await a.locator('#reactBar button').evaluateAll(bs => bs.map(x => x.dataset.react));
  step('1b. the bar offers 12 reactions', ids.length === 12 && new Set(ids).size === 12, ids.join());
  const art = await a.locator('#reactBar img').evaluateAll(is => is.every(i => i.src.startsWith('data:image/png') && i.naturalWidth >= 64));
  step('1c. they are drawn images (data URLs), not emoji text', art && !(await a.locator('#reactBar').innerText()).trim());
  step('1d. Premium items are marked, free ones are not', await a.locator('#reactBar .react-lock').count() === 6 && await a.locator('#reactBar button.pro').count() === 6);

  await a.click('#reactBar button[data-react="heart"]');
  await b.waitForSelector('.float-react', { timeout: 6000 }).catch(() => {});
  step('1e. a tap shows one sprite on both screens', (await floats(a)) === 1 && (await floats(b)) === 1, `${await floats(a)}/${await floats(b)}`);
  await a.waitForTimeout(3200);
  step('1f. sprites remove themselves when they finish', (await floats(a)) === 0 && (await floats(b)) === 0);

  await a.waitForTimeout(1000);
  await hold(a, '#reactBar button[data-react="fire"]', 1100);
  await b.waitForTimeout(900);
  const na = await floats(a), nb = await floats(b);
  step('1g. press and hold sends a burst: several sprites on both screens', na >= 4 && na <= 10 && nb === na, `${na}/${nb}`);
  const sprites = await b.locator('.float-react').evaluateAll(is => ({ sizes: new Set(is.map(i => i.style.width)).size, lefts: new Set(is.map(i => i.style.left)).size }));
  step('1h. a burst varies size and position', sprites.sizes >= 2 && sprites.lefts >= 2, JSON.stringify(sprites));

  await a.waitForTimeout(3300);
  await a.keyboard.press('Escape');
  await a.click('#reactBtn');
  await a.focus('#reactBar button[data-react="lotus"]');
  await a.keyboard.press('Enter');
  await b.waitForSelector('.float-react', { timeout: 6000 }).catch(() => {});
  step('1i. a keyboard press sends exactly one sprite', (await floats(a)) === 1 && (await floats(b)) === 1);
  await ctx.close();
}

// ------------------------------------------------------------- 2. the Premium pack
{
  const { ctx, open } = await setup('video');
  const a = await open('Aarav'), b = await open('Meera');
  await a.addInitScript(() => { window.__free = true; });
  await a.evaluate(() => { window.__free = true; });
  step('2a. video match', await connect(a, b));
  await a.click('#reactBtn');
  await a.click('#reactBar button[data-react="star"]');
  await a.waitForTimeout(500);
  step('2b. a free user tapping a Premium reaction is sent to Premium and nothing is sent', (await floats(a)) === 0 && (await floats(b)) === 0 && (await a.evaluate(() => window.__paywalls || [])).join() === 'reactions', `${await floats(a)}/${await floats(b)}`);
  await a.click('#reactBar button[data-react="heart"]');
  await b.waitForSelector('.float-react', { timeout: 6000 }).catch(() => {});
  step('2b2. the free six still work for a free user', (await floats(a)) === 1 && (await floats(b)) === 1);
  await a.waitForTimeout(3200);
  // a Premium user can send it, and a free user can still SEE what a Premium user sends
  await b.click('#reactBtn');
  await b.click('#reactBar button[data-react="rainbow"]');
  await a.waitForSelector('.float-react', { timeout: 6000 }).catch(() => {});
  step('2c. Premium reactions float on the free user\'s screen too', (await floats(a)) === 1 && (await floats(b)) === 1);
  await ctx.close();
}

// ------------------------------------------------------------- 3. a hostile peer
{
  const { ctx, open } = await setup('video');
  const a = await open('Aarav'), b = await open('Meera');
  step('3a. video match', await connect(a, b));
  await raw(b, [
    { t: 'react', e: '<img src=x onerror=alert(1)>' }, { t: 'react', e: '__proto__' }, { t: 'react', e: 'constructor' }, { t: 'react', e: 'toString' },
    { t: 'react', e: 42 }, { t: 'react', e: null }, { t: 'react', e: ['heart'] }, { t: 'react', e: { id: 'heart' } }, { t: 'react' },
    { t: 'react', e: '❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️❤️' }, { t: 'react', e: 'x'.repeat(5000) },
  ]);
  await a.waitForTimeout(700);
  step('3b. unknown, odd-typed and oversize reaction ids are ignored', (await floats(a)) === 0);
  step('3c. the chat is still alive after them', (await a.evaluate(() => window.__t.S.phase)) === 'connected');

  await raw(b, [{ t: 'react', e: '❤️' }]);
  await a.waitForSelector('.float-react', { timeout: 4000 }).catch(() => {});
  step('3d. the emoji an older version of the app sends still shows (as the new drawn heart)', (await floats(a)) === 1);
  await a.waitForTimeout(3300);

  await raw(b, [{ t: 'react', e: 'star', n: 9999 }]);
  await a.waitForTimeout(1500);
  const big = await floats(a);
  step('3e. a huge count is clamped to one burst (12)', big >= 1 && big <= 12, String(big));
  await a.waitForTimeout(3300);

  await raw(b, [{ t: 'react', e: 'fire', n: -5 }, { t: 'react', e: 'fire', n: 2.5 }, { t: 'react', e: 'fire', n: '8' }, { t: 'react', e: 'fire', n: NaN }]);
  await a.waitForTimeout(800);
  const odd = await floats(a);
  step('3f. a negative, fractional or string count counts as one', odd === 4, String(odd));
  await a.waitForTimeout(3300);

  await a.waitForTimeout(4200);
  await raw(b, Array.from({ length: 40 }, () => ({ t: 'react', e: 'gem', n: 12 })));
  await a.waitForTimeout(2200);
  const flood = await floats(a);
  step('3g. a flood of reactions is capped (30 sprites per 4 seconds), the page stays responsive', flood > 0 && flood <= 30, String(flood));
  step('3h. and the connection survives it', (await a.evaluate(() => window.__t.S.phase)) === 'connected');
  await ctx.close();
}

// ------------------------------------------------------------- 4. ending a chat clears everything
{
  const { ctx, open } = await setup('video');
  const a = await open('Aarav'), b = await open('Meera');
  step('4a. video match', await connect(a, b));
  await raw(b, [{ t: 'react', e: 'party', n: 12 }]);
  await a.waitForSelector('.float-react', { timeout: 4000 }).catch(() => {});
  await b.click('#nextBtn').catch(() => {});
  await b.click('#nextBtn').catch(() => {});
  await a.waitForFunction(() => window.__t.S.phase !== 'connected', null, { timeout: 8000 }).catch(() => {});
  await a.waitForTimeout(300);
  step('4b. when the chat ends nothing is left floating and the bar closes', (await floats(a)) === 0 && !(await a.isVisible('#reactBar')));
  await ctx.close();
}

// ------------------------------------------------------------- 5. phone: touch hold and a narrow bar
{
  const { ctx, open } = await setup('video', { width: 390, height: 780 }, true);
  const a = await open('Aarav'), b = await open('Meera');
  step('5a. video match on a phone', await connect(a, b));
  await a.tap('#reactBtn');
  const m = await a.evaluate(() => { const bar = document.getElementById('reactBar'); const r = bar.getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth, scrolls: bar.scrollWidth > bar.clientWidth, more: bar.classList.contains('more') }; });
  step('5b. the bar fits the screen and scrolls sideways to reach the pack', m.left >= 0 && m.right <= m.vw && m.scrolls && m.more, JSON.stringify(m));
  await a.evaluate(() => { document.getElementById('reactBar').scrollLeft = 9999; });
  await a.waitForTimeout(150);
  step('5c. scrolled to the end, the fade hint goes away', !(await a.evaluate(() => document.getElementById('reactBar').classList.contains('more'))));
  await a.evaluate(() => { document.getElementById('reactBar').scrollLeft = 0; });
  await a.waitForTimeout(150);
  await a.tap('#reactBar button[data-react="laugh"]');
  await b.waitForSelector('.float-react', { timeout: 6000 }).catch(() => {});
  step('5d. a tap works with touch', (await floats(b)) === 1);
  await ctx.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
