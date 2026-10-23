// "My language" and Live translate, local demo mode (no Firebase): two pages of one browser context match each other.
// Section A: the language selector, localStorage, hello.lang, "Speaks ..." on the match card, hostile hello values.
// Usage: NO_PROXY=localhost,127.0.0.1 NODE_PATH=/opt/node22/lib/node_modules node tests/e2e/translate-demo.mjs <scratch dir>
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2] || '/tmp';
fs.mkdirSync(SP, { recursive: true });
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8') + '\nwindow.__t = { S, sendData };\n';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
const CODES = 'en hi bn ta te mr gu kn ml pa ur or as ne es fr de pt it nl ru uk pl tr ar fa he id ms th vi zh zh-TW ja ko sw fil el cs sv ro hu da fi nb'.split(' ');

/** Records every frame a page sends down its data channel (window.__sent) and lets a test rewrite them (window.__mutate). */
const FRAME_HOOK = () => {
  window.__sent = [];
  const orig = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function (d) {
    try { window.__sent.push(typeof d === 'string' ? d : '[binary]'); } catch { /* ignore */ }
    if (window.__mutate) { try { d = window.__mutate(d); } catch { /* ignore */ } }
    return orig.call(this, d);
  };
};

async function setup({ mode = 'text', viewport = { width: 1280, height: 800 }, locale = 'en-US', init = null, colorScheme = 'dark' } = {}) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport, locale, colorScheme });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  const requests = [];
  ctx.on('request', r => requests.push(r.url() + ' ' + (r.postData() || '')));
  await ctx.addInitScript(([m, ageUntil]) => {
    if (!sessionStorage.getItem('seeded')) { // only the first load: later loads must see what the app itself saved
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('ac.ageVerifiedUntil', String(ageUntil));
      localStorage.setItem('ac.uiLang', '"en"'); // the test reads English labels even when the browser language is Hindi
      localStorage.setItem('ac.mode', JSON.stringify(m));
    }
  }, [mode, Date.now() + 864e5]);
  await ctx.addInitScript(FRAME_HOOK);
  if (init) await ctx.addInitScript(init);
  const open = async (name, { fill = true } = {}) => {
    const p = await ctx.newPage();
    p.name = name;
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load|net::|ERR_/.test(m.text())) errors.push(name + ' console: ' + m.text().slice(0, 200)); });
    await p.goto('http://localhost:8765/index.html');
    await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
    if (fill) { await p.fill('#nickInput', name); await p.check('#ageCheck'); }
    return p;
  };
  return { ctx, open, requests };
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 15000 }).then(() => true, () => false);
const text = (p, sel) => p.textContent(sel).then(t => t || '');
const partnered = p => p.waitForFunction(() => window.__t.S.session?.partner, null, { timeout: 5000 }).then(() => true, () => false); // the greeting arrives just after the channel opens
const connect = async (a, b) => { await a.click('#startBtn'); await b.click('#startBtn'); return (await live(a)) && (await live(b)) && (await partnered(a)) && (await partnered(b)); };
const frames = (p, type) => p.evaluate(t => window.__sent.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(f => f && f.t === t), type);
const openPrefs = async p => { await p.click('#prefsBtn'); await p.waitForSelector('#prefsSheet:not(.hidden)'); await p.waitForTimeout(450); /* the sheet's entrance animation: sizes are final after it */ };
const closePrefs = async p => { await p.keyboard.press('Escape'); await p.waitForSelector('#prefsSheet', { state: 'hidden' }); };
const noOverflow = p => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const stored = (p, key) => p.evaluate(k => localStorage.getItem('ac.' + k), key);

// ============================================================== A1. the selector
{
  const { ctx, open } = await setup({ locale: 'hi-IN' });
  const a = await open('Aarav', { fill: false });
  await openPrefs(a);
  const opts = await a.$$eval('#langSelect option', os => os.map(o => o.value));
  step('A1a. the language select has a "not set" entry and exactly the 45 agreed languages', opts[0] === '' && JSON.stringify(opts.slice(1).sort()) === JSON.stringify([...CODES].sort()), `${opts.length} options`);
  const labels = await a.$$eval('#langSelect option', os => os.map(o => o.textContent));
  step('A1b. entries show the native name and the English name', labels.includes('हिन्दी · Hindi') && labels.includes('Español · Spanish') && labels.includes('தமிழ் · Tamil') && labels.includes('English'), labels.slice(0, 4).join(' | '));
  step('A1c. the label is associated with the select (accessible name "My language")', await a.evaluate(() => document.getElementById('langSelect').labels[0]?.textContent.trim()) === 'My language');
  step('A1d. nothing is saved until the person picks: the browser language (hi-IN) is only suggested', (await a.inputValue('#langSelect')) === '' && /हिन्दी · Hindi/.test(labels[0]) && (await stored(a, 'lang')) === null || (await stored(a, 'lang')) === '""', `${labels[0]} | stored=${await stored(a, 'lang')}`);
  step('A1e. a "Use <suggestion>" button is offered', (await a.isVisible('#langSuggest')) && /Use हिन्दी · Hindi/.test(await text(a, '#langSuggest')), await text(a, '#langSuggest'));
  const box = await a.locator('#langSelect').boundingBox();
  const bbox = await a.locator('#langSuggest').boundingBox();
  step('A1f. touch targets are at least 44px tall', box.height >= 44 && bbox.height >= 44, `${box.height} / ${bbox.height}`);
  await ctx.close();
}
{
  const { ctx, open } = await setup({ locale: 'sr-RS' });
  const a = await open('Aarav', { fill: false });
  await openPrefs(a);
  step('A1g. a browser language we do not have is suggested as English', /English/.test(await text(a, '#langSuggest')), await text(a, '#langSuggest'));
  await ctx.close();
}

// ============================================================== A2. persistence (localStorage only)
{
  const { ctx, open, requests } = await setup({ locale: 'hi-IN' });
  const a = await open('Aarav', { fill: false });
  await openPrefs(a);
  await a.selectOption('#langSelect', 'es');
  step('A2a. picking a language saves it in localStorage (ac.lang)', (await stored(a, 'lang')) === '"es"' && (await a.evaluate(() => window.__t.S.lang)) === 'es', await stored(a, 'lang'));
  step('A2b. the suggestion button goes away once a language is chosen', !(await a.isVisible('#langSuggest')));
  await a.reload();
  await a.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
  await openPrefs(a);
  step('A2c. it is still selected after a reload', (await a.inputValue('#langSelect')) === 'es' && (await a.evaluate(() => window.__t.S.lang)) === 'es');
  await a.selectOption('#langSelect', '');
  step('A2d. "Not set" can be chosen again', (await a.evaluate(() => window.__t.S.lang)) === '' && (await a.isVisible('#langSuggest')));
  await a.click('#langSuggest');
  step('A2e. "Use <suggestion>" saves the browser language', (await stored(a, 'lang')) === '"hi"' && (await a.inputValue('#langSelect')) === 'hi', await stored(a, 'lang'));
  // someone else's storage content must not break anything
  await a.evaluate(() => localStorage.setItem('ac.lang', JSON.stringify('<img src=x onerror=1>')));
  await a.reload();
  await a.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
  step('A2f. an invalid saved value is ignored', (await a.evaluate(() => window.__t.S.lang)) === '');
  await a.evaluate(() => localStorage.setItem('ac.lang', '{not json'));
  await a.reload();
  await a.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
  step('A2g. unreadable storage is ignored', (await a.evaluate(() => window.__t.S.lang)) === '');
  const ext = requests.filter(r => !/^http:\/\/(localhost|127\.0\.0\.1)/.test(r) && !/^(data|blob):/.test(r) && !/fonts\.g|country\.is|jsdelivr/.test(r)); // (those three are blocked by the test's own routes)
  step('A2h. anonymous: nothing about the profile goes to any server (no external requests at all in demo mode)', ext.length === 0, ext.slice(0, 3).join(' | ').slice(0, 200));
  await ctx.close();
}

// ============================================================== A3. hello carries the language; the match card shows it
{
  const { ctx, open } = await setup();
  const a = await open('Aarav'), b = await open('Meera');
  await openPrefs(a); await a.selectOption('#langSelect', 'hi'); await closePrefs(a);
  step('A3a. match', await connect(a, b));
  const helloA = (await frames(a, 'hello'))[0], helloB = (await frames(b, 'hello'))[0];
  step('A3b. hello carries lang when the person chose one', helloA?.lang === 'hi', JSON.stringify(helloA));
  step('A3c. hello has no lang field when nothing was chosen (the guess stays private)', helloB && !('lang' in helloB), JSON.stringify(helloB));
  step('A3d. the other side knows the partner language', (await b.evaluate(() => window.__t.S.session.partner.lang)) === 'hi' && (await a.evaluate(() => window.__t.S.session.partner.lang)) === '');
  step('A3e. match card: "Speaks हिन्दी"', (await text(b, '.match-card .speaks')) === 'Speaks हिन्दी', await text(b, '.match-card .speaks'));
  step('A3f. the native name is marked with its language (lang="hi") for fonts and screen readers', (await b.getAttribute('.match-card .speaks span', 'lang')) === 'hi');
  step('A3g. no "Speaks" line when the partner has no language', (await a.locator('.match-card .speaks').count()) === 0);
  step('A3h. the distance line (.where) is untouched by the new line', (await a.locator('.match-card .speaks').count()) === 0 && !/Speaks/.test(await text(b, '.match-card .where').catch(() => '')));
  await ctx.close();
}

// ============================================================== A4. hostile hello.lang values
{
  const hostile = ['EN', 'xx', '<img src=x onerror=alert(1)>', 123, { a: 1 }, ['es'], 'zh-tw', 'auto', '__proto__', 'constructor', null, true, 'es\u0000', ' es', 'e'.repeat(3000)];
  const { ctx, open } = await setup();
  const a = await open('Aarav'), b = await open('Meera');
  // B rewrites its own hello before it leaves, one hostile value per chat (a second hello is ignored by the receiver)
  let bad = 0, shown = 0, checked = 0;
  for (const value of hostile) {
    await b.evaluate(v => { window.__mutate = d => { const m = JSON.parse(d); if (m.t === 'hello') { m.lang = v; return JSON.stringify(m); } return d; }; }, value);
    if (!(await connect(a, b))) { bad++; break; }
    const lang = await a.evaluate(() => window.__t.S.session.partner.lang);
    checked++;
    if (lang !== '') bad++;
    if ((await a.locator('.match-card .speaks').count()) !== 0) shown++;
    // next chat
    await a.click('#nextBtn'); await a.click('#nextBtn');
    await b.waitForFunction(() => document.getElementById('msgInput').disabled, null, { timeout: 15000 }).catch(() => {});
    await b.waitForFunction(() => document.getElementById('startBtn') || true);
    // both sides go back to searching: B was told "stranger disconnected" and auto-searches again after 3 s; A is searching already
    await a.waitForFunction(() => window.__t.S.phase === 'searching', null, { timeout: 8000 }).catch(() => {});
    await b.waitForFunction(() => window.__t.S.phase === 'searching' || window.__t.S.phase === 'connecting' || window.__t.S.phase === 'connected', null, { timeout: 10000 }).catch(() => {});
    // let the pair re-form on its own (auto-next), but do not wait forever
    if (!(await live(a))) { await a.click('#overlayNewBtn').catch(() => {}); }
    await a.click('#leaveBtn').catch(() => {}); await b.click('#leaveBtn').catch(() => {});
    await a.waitForSelector('#welcome:not(.hidden)', { timeout: 5000 }).catch(() => {});
    await b.waitForSelector('#welcome:not(.hidden)', { timeout: 5000 }).catch(() => {});
  }
  step(`A4a. ${hostile.length} hostile hello.lang values (wrong case, unknown, HTML, numbers, objects, arrays, huge) all end up as "no language"`, bad === 0 && checked === hostile.length, `checked ${checked}, bad ${bad}`);
  step('A4b. none of them produces a "Speaks" line', shown === 0, `shown ${shown}`);
  await ctx.close();
}

// ============================================================== A5. the prefs sheet at phone width and desktop, light and dark
for (const [name, viewport] of [['phone', { width: 360, height: 740 }], ['narrow', { width: 320, height: 640 }], ['desktop', { width: 1280, height: 800 }]]) {
  for (const scheme of ['dark', 'light']) {
    const { ctx, open } = await setup({ viewport, colorScheme: scheme, locale: 'hi-IN', init: s => localStorage.setItem('ac.theme', JSON.stringify(s)) && 0 });
    const a = await open('Aarav', { fill: false });
    await a.evaluate(s => { document.documentElement.dataset.theme = s; }, scheme);
    await openPrefs(a);
    await a.locator('#langSelect').scrollIntoViewIfNeeded();
    await a.waitForTimeout(350);
    const file = `${SP}/prefs-lang-${name}-${scheme}.png`;
    await a.screenshot({ path: file });
    step(`A5. prefs sheet (${name}, ${scheme}): no horizontal overflow, select and hint inside the sheet`, await noOverflow(a) && await a.evaluate(() => { const r = document.getElementById('langSelect').getBoundingClientRect(); const s = document.querySelector('#prefsSheet .sheet').getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1; }), file);
    await ctx.close();
  }
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
