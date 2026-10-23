// Interface languages (Hindi and the other Indian languages) and language-exchange matching.
// Local demo mode (two tabs of one browser context match each other).
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8') + '\nwindow.__t = { S, sendData };\n';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };

async function setup({ mode = 'text', locale, viewport = { width: 1280, height: 800 }, init = {} } = {}) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport, ...(locale ? { locale } : {}) });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(([m, extra]) => {
    localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    localStorage.setItem('ac.mode', JSON.stringify(m));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem('ac.' + k, JSON.stringify(v));
  }, [mode, init]);
  const open = async name => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    await p.goto('http://localhost:8765/index.html');
    await p.waitForSelector('#startBtn');
    await p.waitForTimeout(250);
    if (name) { await p.fill('#nickInput', name); await p.check('#ageCheck'); }
    return p;
  };
  return { ctx, open };
}
const text = (p, sel) => p.textContent(sel).then(t => (t || '').trim());
const live = (p, ms = 15000) => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: ms }).then(() => true, () => false);
const raw = (p, frames) => p.evaluate(fr => { const dc = window.__t.S.session.dc; for (const f of fr) dc.send(typeof f === 'string' ? f : JSON.stringify(f)); }, frames);
const setUi = async (p, code) => { await p.selectOption('#uiLang', code); await p.waitForFunction(c => document.documentElement.lang === c, code, { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(200); };

// ------------------------------------------------------------- 1. Hindi on the page
{
  const { ctx, open } = await setup();
  const a = await open('Aarav');
  step('1a. the language picker lists English plus nine Indian languages', await a.locator('#uiLang option').count() === 10);
  step('1b. English by default (the browser language is English)', (await text(a, '#startBtn')) === 'Start chatting' && (await a.evaluate(() => document.documentElement.lang)) === 'en');
  await setUi(a, 'hi');
  step('1c. choosing Hindi translates the start card', (await text(a, '#startBtn')) === 'चैटिंग शुरू करें' && /चैट शुरू करें/.test(await text(a, '#start')), await text(a, '#startBtn'));
  step('1d. the page language is set (for screen readers and fonts)', (await a.evaluate(() => document.documentElement.lang)) === 'hi');
  step('1e. placeholders and aria-labels are translated too', (await a.getAttribute('#tagInput', 'placeholder')) === 'संगीत, गेमिंग, यात्रा…' && (await a.getAttribute('#menuBtn', 'aria-label')) === 'मेन्यू');
  step('1f. the long landing text is translated', /रैंडम वीडियो और टेक्स्ट चैट/.test(await text(a, '.lp-sub')) && /सुरक्षा कोई ऐड-ऑन नहीं/.test(await a.textContent('#safety')));
  step('1g. the brand name stays as it is', (await text(a, '.brand-name')) === 'OhMyGoal');
  await a.reload();
  await a.waitForSelector('#startBtn');
  await a.waitForTimeout(500);
  step('1h. the choice is remembered after a reload', (await text(a, '#startBtn')) === 'चैटिंग शुरू करें' && (await a.inputValue('#uiLang')) === 'hi');
  await setUi(a, 'en');
  step('1i. switching back restores every English string', (await text(a, '#startBtn')) === 'Start chatting' && (await a.getAttribute('#tagInput', 'placeholder')) === 'music, gaming, travel…' && (await a.getAttribute('#menuBtn', 'aria-label')) === 'Menu' && !/चैट|सुरक्षा|प्रीमियम/.test(await a.textContent('#welcome')));
  step('1j. English was saved as a choice too (it is not overridden by the browser guess on the next visit)', (await a.evaluate(() => JSON.parse(localStorage.getItem('ac.uiLang')))) === 'en');
  await ctx.close();
}
{
  const { ctx, open } = await setup({ locale: 'hi-IN' });
  const a = await open('Aarav');
  step('1k. a Hindi browser gets Hindi the first time', (await text(a, '#startBtn')) === 'चैटिंग शुरू करें' && (await a.inputValue('#uiLang')) === 'hi');
  await ctx.close();
}
{
  const { ctx, open } = await setup({ locale: 'hi-IN', init: { uiLang: 'en' } });
  const a = await open('Aarav');
  step('1l. but a saved English choice wins over the browser', (await text(a, '#startBtn')) === 'Start chatting');
  await ctx.close();
}
{
  const { ctx, open } = await setup({ init: { uiLang: '<script>alert(1)</script>' } });
  const a = await open('Aarav');
  step('1m. a corrupted saved language falls back to English', (await text(a, '#startBtn')) === 'Start chatting' && (await a.inputValue('#uiLang')) === 'en');
  await ctx.close();
}

// ------------------------------------------------------------- 2. the app in Hindi, and what is never translated
{
  const { ctx, open } = await setup({ init: { uiLang: 'hi' } });
  const a = await open('Report'), b = await open('Meera');   // a nickname that happens to be a button label
  await a.click('#startBtn'); await b.click('#startBtn');
  step('2a. match', (await live(a)) && (await live(b)));
  await a.waitForTimeout(400);
  step('2b. chat notices appear in Hindi as they are added', /आप अब एक अजनबी से चैट कर रहे हैं/.test(await text(a, '#messages')), (await text(a, '#messages')).slice(0, 80));
  step('2c. the composer and buttons are in Hindi', (await a.getAttribute('#msgInput', 'placeholder')) === 'संदेश लिखें…' && (await a.getAttribute('#reportBtn', 'title')) === 'रिपोर्ट');
  await raw(b, [{ t: 'msg', text: 'Next' }, { t: 'msg', text: 'Report' }, { t: 'msg', text: 'Start chatting' }]);
  await a.waitForTimeout(500);
  const bubbles = await a.locator('.bubble').allTextContents();
  step('2d. a stranger’s messages are never translated, even when they equal a button label', bubbles.join('|') === 'Next|Report|Start chatting', bubbles.join('|'));
  step('2e. a nickname is never translated', (await text(a, '#partnerName')) === 'Meera' && (await text(b, '#partnerName')) === 'Report', `${await text(b, '#partnerName')}`);
  await a.click('#reportBtn');
  await a.waitForSelector('#reportModal:not(.hidden)');
  step('2f. sheets opened later are translated', /इस व्यक्ति की रिपोर्ट करें/.test(await text(a, '#reportModal')) && /नग्नता या यौन सामग्री/.test(await text(a, '#reasons')));
  await a.keyboard.press('Escape');
  await a.click('#leaveBtn');
  await a.waitForSelector('#welcome:not(.hidden)');
  await a.uncheck('#ageCheck');
  await a.click('#startBtn');
  await a.waitForFunction(() => /18\+/.test(document.getElementById('toasts').textContent), null, { timeout: 4000 }).catch(() => {});
  step('2g. toasts are translated', /आगे बढ़ने के लिए कृपया पुष्टि करें कि आप 18\+ हैं/.test(await text(a, '#toasts')), await text(a, '#toasts'));
  await ctx.close();
}

// ------------------------------------------------------------- 3. every language, on a phone
{
  const { ctx, open } = await setup({ viewport: { width: 360, height: 800 } });
  const a = await open('Aarav');
  const seen = new Set();
  for (const code of ['hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa']) {
    await setUi(a, code);
    const label = await text(a, '#startBtn');
    seen.add(label);
    const fit = await a.evaluate(() => ({ page: document.documentElement.scrollWidth <= innerWidth + 1, button: (() => { const b = document.getElementById('startBtn'); return b.scrollWidth <= b.clientWidth + 1; })(), card: (() => { const c = document.getElementById('start'); return c.scrollWidth <= c.clientWidth + 1; })() }));
    step(`3. ${code}: translated, and nothing overflows at 360 px`, label !== 'Start chatting' && fit.page && fit.button && fit.card, `${label} ${JSON.stringify(fit)}`);
  }
  step('3z. all nine labels are different words', seen.size === 9, [...seen].join(' / '));
  await ctx.close();
}

// ------------------------------------------------------------- 4. language exchange
const langx = async (p, lang, learn) => { await p.evaluate(([l, n]) => { const S = window.__t.S; S.theme = 'langx'; S.lang = l; S.learn = n; }, [lang, learn]); };
{
  const { ctx, open } = await setup();
  const a = await open('Aarav');
  await a.click('#roomBtn');
  await a.click('#roomList .room-opt:has-text("Language exchange")');
  step('4a. choosing Language exchange shows the two language pickers and keeps the sheet open', await a.isVisible('#langxForm') && await a.isVisible('#roomSheet'));
  await a.click('#roomSheet [data-sheet-close]');
  await a.click('#startBtn');
  await a.waitForSelector('#roomSheet:not(.hidden)', { timeout: 3000 }).catch(() => {});
  step('4b. starting without both languages explains and reopens the sheet instead of searching', /pick the language you speak/.test(await text(a, '#toasts')) && await a.isVisible('#roomSheet') && (await a.evaluate(() => window.__t.S.phase)) === 'idle');
  await a.selectOption('#speakSelect', 'hi');
  await a.selectOption('#learnSelect', 'hi');
  await a.click('#roomSheet [data-sheet-close]');
  await a.click('#startBtn');
  await a.waitForTimeout(500);
  step('4c. practising the language you speak is refused too', (await a.evaluate(() => window.__t.S.phase)) === 'idle');
  await ctx.close();
}
{
  const { ctx, open } = await setup();
  const a = await open('Aarav'), c = await open('Chitra'), b = await open('Ben'), d = await open('Dev');
  await langx(a, 'hi', 'en'); await langx(c, 'ta', 'fr'); await langx(b, 'en', 'hi'); await langx(d, 'ta', 'en');
  await a.click('#startBtn'); await c.click('#startBtn');
  step('4d. Hindi->English and Tamil->French do not fit', !(await live(a, 6000)) && !(await live(c, 500)));
  await b.click('#startBtn');
  step('4e. English->Hindi fits Hindi->English (each speaks what the other learns)', (await live(a, 12000)) && (await live(b, 4000)));
  step('4f. the match card shows what they practise', /Practising/.test(await text(a, '.match-card')) && /हिन्दी/.test(await text(a, '.match-card')) === false || /Practising/.test(await text(a, '.match-card')), await text(a, '.match-card'));
  step('4g. the Tamil->French person is still waiting', !(await live(c, 500)));
  await ctx.close();
}
{
  // both learning the same language also fits
  const { ctx, open } = await setup();
  const a = await open('Aarav'), d = await open('Dev');
  await langx(a, 'hi', 'en'); await langx(d, 'ta', 'en');
  await a.click('#startBtn'); await d.click('#startBtn');
  step('4h. two people who are both learning English meet to practise together', (await live(a, 15000)) && (await live(d, 4000)));
  await ctx.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
