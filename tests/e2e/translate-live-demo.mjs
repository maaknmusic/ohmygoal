// Live translate in the chat, local demo mode (no Firebase; two pages of one browser context match each other).
// The on-device Translator / LanguageDetector are faked with an init script (window.__fake), so this tests the real engine,
// queue, UI and message protocol of the app without a server. The translateText callable is covered by tests/e2e/translate.mjs.
// Usage: NO_PROXY=localhost,127.0.0.1 NODE_PATH=/opt/node22/lib/node_modules node tests/e2e/translate-live-demo.mjs <scratch dir>
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2] || '/tmp';
fs.mkdirSync(SP, { recursive: true });
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
// Test-only hooks are added to a copy of app.js here; nothing like them ships. window.__free makes the demo behave like a free user.
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8')
  .replace('const isPremium = () => (premium ? premium.active : !premiumExpected);', 'const isPremium = () => (window.__free ? false : (premium ? premium.active : !premiumExpected));')
  .replace("if (!premium) { toast('Premium is available on the online version of the site.', true); return; }", "if (!premium && !window.__free) { toast('Premium is available on the online version of the site.', true); return; }")
  + '\nwindow.__t = { S, sendData, lt, translateEngine };\n';
if (!appSrc.includes('window.__free ? false')) throw new Error('the isPremium line changed: update the test rewrite');
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };

/** The browser's built-in translator, faked: Devanagari is Hindi, a few Spanish words are Spanish, the rest English. */
const FAKE = () => {
  const F = window.__fake = { calls: [], detects: 0, delay: 0, mode: 'ok' }; // mode: ok | throw (the translator fails) | none (no pair is available)
  const lang = t => (/[ऀ-ॿ]/.test(t) ? 'hi' : /\b(hola|gracias|cómo|estás|amigo)\b/i.test(t) ? 'es' : 'en');
  self.LanguageDetector = class {
    static async availability() { return 'available'; }
    static async create() { return new this(); }
    async detect(t) { F.detects++; return [{ detectedLanguage: lang(t), confidence: 0.95 }]; }
  };
  self.Translator = class {
    constructor(o) { this.o = o; }
    static async availability() { return F.mode === 'none' ? 'unavailable' : 'available'; }
    static async create(o) { return new this(o); }
    async translate(t) {
      F.calls.push([this.o.sourceLanguage, this.o.targetLanguage, t]);
      if (F.delay) await new Promise(r => setTimeout(r, F.delay));
      if (F.mode === 'throw') throw new Error('translator failed');
      return `[${this.o.sourceLanguage}>${this.o.targetLanguage}] ${t}`;
    }
  };
};
/** Records frames sent down the data channel (window.__sent) so tests can read exactly what was transmitted. */
const FRAME_HOOK = () => {
  window.__sent = [];
  const orig = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function (d) { try { window.__sent.push(typeof d === 'string' ? d : '[binary]'); } catch { /* ignore */ } return orig.call(this, d); };
};

async function setup({ viewport = { width: 1280, height: 800 }, colorScheme = 'dark', fake = true, mode = 'text' } = {}) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport, colorScheme, locale: 'en-US' });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  const requests = [];
  ctx.on('request', r => requests.push(r.url() + ' ' + (r.postData() || '')));
  await ctx.addInitScript(m => {
    if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5)); localStorage.setItem('ac.mode', JSON.stringify(m)); }
  }, mode);
  await ctx.addInitScript(FRAME_HOOK);
  if (fake) await ctx.addInitScript(FAKE);
  const open = async (name, { lang = '', free = false } = {}) => {
    const p = await ctx.newPage();
    p.name = name;
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load|net::|ERR_/.test(m.text())) errors.push(name + ' console: ' + m.text().slice(0, 200)); });
    if (free) await p.addInitScript(() => { window.__free = true; });
    await p.addInitScript(l => { if (l) localStorage.setItem('ac.lang', JSON.stringify(l)); else localStorage.removeItem('ac.lang'); }, lang); // pages of one context share localStorage: each loads with its own language
    await p.goto('http://localhost:8765/index.html');
    await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
    await p.fill('#nickInput', name); await p.check('#ageCheck');
    return p;
  };
  return { ctx, open, requests };
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 15000 }).then(() => true, () => false);
const text = (p, sel) => p.textContent(sel).then(t => t || '');
const connect = async (a, b) => { await a.click('#startBtn'); await b.click('#startBtn'); return (await live(a)) && (await live(b)); };
const frames = (p, type) => p.evaluate(t => window.__sent.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(f => f && f.t === t), type);
const fakeCalls = p => p.evaluate(() => window.__fake.calls.length);
const say = async (p, msg) => { await p.fill('#msgInput', msg); await p.press('#msgInput', 'Enter'); };
/** Sends raw frames from page `p` straight down its data channel (a peer that does not follow our own rules). */
const raw = (p, fr) => p.evaluate(list => { const dc = window.__t.S.session.dc; for (const f of list) dc.send(typeof f === 'string' ? f : JSON.stringify(f)); }, fr);
const sheetOpen = p => p.isVisible('#translateSheet');
const openSheet = async p => { await p.click('#translateBtn'); await p.waitForSelector('#translateSheet:not(.hidden)'); await p.waitForTimeout(450); /* the sheet's entrance animation */ };
/** The switches are visually hidden inputs inside labels: click the label like a finger would. */
const flip = async (p, id, on = true) => { if ((await p.isChecked('#' + id)) !== on) await p.locator(`#translateSheet label:has(#${id})`).click(); };
const external = reqs => reqs.filter(r => !/^http:\/\/(localhost|127\.0\.0\.1)/.test(r) && !/^(data|blob):/.test(r) && !/fonts\.g|country\.is|jsdelivr/.test(r));
const closeSheet = async p => { await p.click('#translateSheet .sheet-foot button'); await p.waitForSelector('#translateSheet', { state: 'hidden' }); };
const noOverflow = p => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.body.scrollWidth <= document.documentElement.clientWidth + 1);
const themeOf = (p, theme) => p.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
const HI = 'नमस्ते, आप कैसे हैं?';
const msgs = (p, who) => p.locator(`#messages .msg.${who}`);
const lastMsg = (p, who) => msgs(p, who).last();

// ===================================================================== 1. free users get the Premium sheet
{
  const { ctx, open } = await setup();
  const a = await open('Aarav', { lang: 'en', free: true }), b = await open('Meera', { lang: 'hi' });
  step('1a. match', await connect(a, b));
  step('1b. the Live translate button is in the chat header, labelled, and enabled while connected', await a.isVisible('#translateBtn') && await a.isEnabled('#translateBtn') && /Live translate/.test(await a.getAttribute('#translateBtn', 'aria-label')), await a.getAttribute('#translateBtn', 'aria-label'));
  await a.click('#translateBtn');
  await a.waitForSelector('#paywall:not(.hidden)', { timeout: 3000 }).catch(() => {});
  step('1c. a free user who taps it gets the Premium sheet, not the settings', await a.isVisible('#paywall') && !(await sheetOpen(a)), '');
  step('1d. the Premium sheet says why', /Live translate/.test(await text(a, '#paywallReason')), await text(a, '#paywallReason'));
  step('1e. the paywall table lists Live translate as Premium only', await a.evaluate(() => [...document.querySelectorAll('#paywall .compare tr')].some(r => /Live translate/.test(r.textContent) && r.querySelector('td.no') && r.querySelector('td.yes'))));
  await a.keyboard.press('Escape');
  step('1f. the landing page lists it under "Premium adds"', await a.evaluate(() => [...document.querySelectorAll('.lp-col--prem li')].some(l => /Live translate/.test(l.textContent))));
  // the partner speaks Hindi: free users get no suggestion bar and nothing is translated
  await b.fill('#msgInput', HI); await b.press('#msgInput', 'Enter');
  await a.waitForSelector('#messages .msg.them', { timeout: 5000 });
  step('1g. free user: no suggestion bar, no translated line, no translator call', !(await a.isVisible('#trBar')) && (await a.locator('.translated').count()) === 0 && (await fakeCalls(a)) === 0);
  await ctx.close();
}

// ===================================================================== 2. the sheet: defaults, switches, availability
{
  const { ctx, open } = await setup();
  const a = await open('Aarav', { lang: 'en' }), b = await open('Meera');
  await connect(a, b);
  await openSheet(a);
  const st = await a.evaluate(() => ({ recv: document.getElementById('trRecv').checked, send: document.getElementById('trSend').checked, sendDisabled: document.getElementById('trSend').disabled, hint: document.getElementById('trSendHint').textContent, recvName: document.getElementById('trRecvName').textContent, remember: document.getElementById('trRemember').checked, focus: document.activeElement?.closest('#translateSheet') !== null }));
  step('2a. everything is off by default; the receive switch names my language', !st.recv && !st.send && !st.remember && st.recvName === 'English', JSON.stringify(st));
  step('2b. "what I type" is disabled while the partner has no language, and says why', st.sendDisabled && /partner has chosen a language/.test(st.hint), st.hint);
  step('2c. focus moved into the sheet', st.focus);
  const labels = await a.evaluate(() => ['trRecv', 'trSend', 'trRemember', 'trRecvTarget', 'trSendTarget'].map(id => document.getElementById(id).labels?.[0]?.textContent.trim().slice(0, 40)));
  step('2d. every control has a visible label', labels.every(Boolean), JSON.stringify(labels));
  step('2e. the sheet is a labelled dialog', await a.evaluate(() => { const s = document.getElementById('translateSheet'); return s.getAttribute('role') === 'dialog' && s.getAttribute('aria-modal') === 'true' && document.getElementById(s.getAttribute('aria-labelledby')).textContent.includes('Live translate'); }));
  const opts = await a.$$eval('#trRecvTarget option', os => os.map(o => o.value));
  step('2f. the target pickers list all 45 languages', opts.length === 45 && new Set(opts).size === 45, String(opts.length));
  const heights = await a.evaluate(() => ['trRecvTarget', 'trSendTarget'].map(id => document.getElementById(id).getBoundingClientRect().height).concat([...document.querySelectorAll('#translateSheet .toggle')].map(t => t.getBoundingClientRect().height)));
  step('2g. touch targets (selects, switch rows) are at least 44px', heights.every(x => x >= 43.5), heights.join(','));
  await a.keyboard.press('Escape');
  step('2h. Esc closes it and focus goes back to the button', !(await sheetOpen(a)) && (await a.evaluate(() => document.activeElement?.id)) === 'translateBtn');
  await ctx.close();
}

// ===================================================================== 3. off = nothing is translated, nothing is sent anywhere
{
  const { ctx, open, requests } = await setup();
  const a = await open('Aarav', { lang: 'en' }), b = await open('Meera', { lang: 'hi' });
  await connect(a, b);
  await a.waitForSelector('#trBar .tr-bar-go', { timeout: 3000 });
  step('3a. a Premium user with a Hindi-speaking partner sees one slim suggestion', /Hindi speaker: turn on live translate\?/.test(await text(a, '#trBar')), await text(a, '#trBar'));
  await b.fill('#msgInput', HI); await b.press('#msgInput', 'Enter');
  await b.fill('#msgInput', 'second message बिना अनुवाद'); await b.press('#msgInput', 'Enter');
  await a.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 2);
  await a.fill('#msgInput', 'Hello, how are you?'); await a.press('#msgInput', 'Enter');
  await b.waitForSelector('#messages .msg.them');
  const bubbles = await a.$$eval('#messages .msg.them .bubble', ns => ns.map(n => n.textContent));
  step('3b. with the switches off the messages show exactly as sent, no extra line', bubbles[0] === HI && (await a.locator('.translated').count()) === 0 && (await b.locator('.translated').count()) === 0, bubbles.join(' | '));
  step('3c. the translator and the language detector were never called', (await fakeCalls(a)) === 0 && (await a.evaluate(() => window.__fake.detects)) === 0 && (await b.evaluate(() => window.__fake.detects)) === 0);
  const sent = await frames(a, 'msg');
  step('3d. what I sent is exactly what I typed (no orig / olang)', sent.length === 1 && sent[0].text === 'Hello, how are you?' && !('orig' in sent[0]) && !('olang' in sent[0]), JSON.stringify(sent));
  const ext = external(requests);
  step('3e. no request left the browser (demo mode)', ext.length === 0, ext.slice(0, 2).join(' | '));
  step('3f. the suggestion bar can be dismissed and does not come back in this chat', await (async () => { await a.click('#trBar .tr-bar-x'); await a.waitForTimeout(100); await b.fill('#msgInput', 'again'); await b.press('#msgInput', 'Enter'); await a.waitForTimeout(200); return !(await a.isVisible('#trBar')); })());
  await ctx.close();
}

// ===================================================================== 4. receiving
{
  const { ctx, open, requests } = await setup();
  const a = await open('Aarav', { lang: 'en' }), b = await open('Meera', { lang: 'hi' });
  await connect(a, b);
  await a.waitForSelector('#trBar .tr-bar-go');
  await openSheet(a);
  await flip(a, 'trRecv');
  step('4a. turning on "receive" shows the slim "on" bar and lights the header button', /Live translate on: messages into English/.test(await text(a, '#trBar')) && (await a.evaluate(() => document.getElementById('translateBtn').classList.contains('on'))), await text(a, '#trBar'));
  step('4a2. the send switch is enabled now that the partner language is known and differs', await a.isEnabled('#trSend'));
  await closeSheet(a);
  await b.fill('#msgInput', HI); await b.press('#msgInput', 'Enter');
  await a.waitForSelector('#messages .msg.them .tr-link', { timeout: 6000 });
  const m = lastMsg(a, 'them');
  step('4b. the message now reads in English', (await text(a, '#messages .msg.them .bubble')) === `[hi>en] ${HI}`, await text(a, '#messages .msg.them .bubble'));
  step('4c. the line under it says "🌐 Hindi → English"', /🌐 Hindi → English/.test(await text(a, '#messages .msg.them .translated')), await text(a, '#messages .msg.them .translated'));
  await m.locator('.tr-link').click();
  step('4d. "Show original" brings the sender\'s own words back, and the link flips', (await text(a, '#messages .msg.them .bubble')) === HI && /Show translation/.test(await text(a, '#messages .msg.them .tr-link')));
  await m.locator('.tr-link').click();
  step('4e. and back to the translation', /^\[hi>en\]/.test(await text(a, '#messages .msg.them .bubble')));
  const calls1 = await fakeCalls(a);
  await b.fill('#msgInput', 'Hello my friend'); await b.press('#msgInput', 'Enter');
  await a.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 2);
  await a.waitForTimeout(300);
  step('4f. a message already in my language gets no extra line and no translate call', (await msgs(a, 'them').nth(1).locator('.translated').count()) === 0 && (await fakeCalls(a)) === calls1 && (await text(a, '#messages .msg.them:nth-of-type(2) .bubble').catch(() => 'x')) !== null);
  for (const [name, t] of [['emoji-only', '😀😀🎉'], ['numbers only', '123456'], ['a long message (>400)', 'नमस्ते '.repeat(70)]]) {
    const before = await msgs(a, 'them').count();
    await b.fill('#msgInput', ''); await raw(b, [{ t: 'msg', text: t.slice(0, 500) }]);
    await a.waitForFunction(n => document.querySelectorAll('#messages .msg.them').length > n, before);
    await a.waitForTimeout(250);
    step(`4g. ${name}: shown as it is, not sent for translation`, (await lastMsg(a, 'them').locator('.translated').count()) === 0 && (await fakeCalls(a)) === calls1, '');
  }
  const before = await fakeCalls(a);
  await raw(b, [{ t: 'msg', text: 'पहली बात' }, { t: 'msg', text: 'पहली बात' }]);
  await a.waitForFunction(() => [...document.querySelectorAll('#messages .msg.them .bubble')].filter(n => n.textContent === '[hi>en] पहली बात').length === 2, null, { timeout: 5000 });
  step('4h. the same text twice is translated once (cache)', (await fakeCalls(a)) === before + 1, `${(await fakeCalls(a)) - before} calls`);
  const ext = external(requests);
  step('4i. on-device translation sends nothing to any server', ext.length === 0, ext.slice(0, 2).join(' | '));
  // pick another target language for this direction
  await openSheet(a);
  await a.selectOption('#trRecvTarget', 'es');
  step('4j. the receive target can be overridden (label follows)', (await text(a, '#trRecvName')) === 'Spanish', await text(a, '#trRecvName'));
  await closeSheet(a);
  await raw(b, [{ t: 'msg', text: 'एक और संदेश' }]);
  await a.waitForFunction(() => document.body.textContent.includes('[hi>es] एक और संदेश'), null, { timeout: 5000 }).catch(() => {});
  step('4k. the next message is translated into the chosen language', (await a.evaluate(() => window.__fake.calls.at(-1)?.slice(0, 2).join('>'))) === 'hi>es', await a.evaluate(() => JSON.stringify(window.__fake.calls.at(-1))));
  await ctx.close();
}

// ===================================================================== 5. sending
{
  const { ctx, open } = await setup();
  const a = await open('Aarav', { lang: 'en' }), b = await open('Meera', { lang: 'hi' });
  await connect(a, b);
  await a.waitForSelector('#trBar .tr-bar-go');
  await a.click('#trBar .tr-bar-go'); // one tap: both directions
  step('5a. the suggestion\'s one tap turned on both directions', /English ⇄ Hindi/.test(await text(a, '#trBar')), await text(a, '#trBar'));
  await say(a, 'Hello, how are you?');
  await b.waitForSelector('#messages .msg.them .tr-body', { timeout: 6000 });
  const f = (await frames(a, 'msg')).at(-1);
  step('5b. the frame carries the translation as text, my words as orig, and my language as olang', f?.text === '[en>hi] Hello, how are you?' && f?.orig === 'Hello, how are you?' && f?.olang === 'en', JSON.stringify(f));
  step('5c. my own bubble shows what I typed, with "Sent as Hindi" and the translation', (await text(a, '#messages .msg.me .bubble')) === 'Hello, how are you?' && /Sent as Hindi/.test(await text(a, '#messages .msg.me .translated')) && /\[en>hi\] Hello, how are you\?/.test(await text(a, '#messages .msg.me .translated')), await text(a, '#messages .msg.me .translated'));
  step('5d. the partner reads the translation, with the original underneath', (await text(b, '#messages .msg.them .bubble')) === '[en>hi] Hello, how are you?' && /Original · English/.test(await text(b, '#messages .msg.them .translated')) && /Hello, how are you\?/.test(await text(b, '#messages .msg.them .tr-body')), await text(b, '#messages .msg.them .translated'));
  // a message I type in the partner's language is sent as it is
  await say(a, HI);
  await b.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 2);
  const f2 = (await frames(a, 'msg')).at(-1);
  step('5e. text already in the partner\'s language is sent unchanged (no orig)', f2.text === HI && !('orig' in f2) && (await lastMsg(a, 'me').locator('.translated').count()) === 0, JSON.stringify(f2));
  // order is kept even when translations take a while
  await a.evaluate(() => { window.__fake.delay = 150; });
  for (const t of ['one one', 'two two', 'three three']) await say(a, t);
  await b.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 5, null, { timeout: 8000 });
  const order = (await frames(a, 'msg')).slice(-3).map(x => x.orig);
  step('5f. messages go out in the order they were typed', JSON.stringify(order) === JSON.stringify(['one one', 'two two', 'three three']), JSON.stringify(order));
  step('5g. emoji and numbers are sent as they are (no translation call)', await (async () => { const n = await fakeCalls(a); await say(a, '👍👍'); await b.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 6); return (await fakeCalls(a)) === n && !('orig' in (await frames(a, 'msg')).at(-1)); })());
  // send target override
  await a.evaluate(() => { window.__fake.delay = 0; });
  await openSheet(a);
  await a.selectOption('#trSendTarget', 'es');
  step('5h. the send target can be overridden (label follows)', (await text(a, '#trSendName')) === 'Spanish');
  await closeSheet(a);
  await a.waitForTimeout(4200); // the app's own limit: 6 messages in 4 seconds
  await say(a, 'Good morning');
  await b.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 7);
  const f3 = (await frames(a, 'msg')).at(-1);
  step('5i. the override decides the language it is translated into', f3.text === '[en>es] Good morning' && f3.orig === 'Good morning', JSON.stringify(f3));
  await ctx.close();
}

// ===================================================================== 6. failures: send the original, say so; retry on receive
{
  const { ctx, open } = await setup();
  const a = await open('Aarav', { lang: 'en' }), b = await open('Meera', { lang: 'hi' });
  await connect(a, b);
  await a.waitForSelector('#trBar .tr-bar-go');
  await a.click('#trBar .tr-bar-go');
  await a.evaluate(() => { window.__fake.mode = 'throw'; });
  await say(a, 'Can you read this?');
  await b.waitForSelector('#messages .msg.them', { timeout: 6000 });
  const f = (await frames(a, 'msg')).at(-1);
  step('6a. when translation fails the original text is sent unchanged', f?.text === 'Can you read this?' && !('orig' in f), JSON.stringify(f));
  step('6b. and my bubble says so inline', /not translated/i.test(await text(a, '#messages .msg.me .translated')) && /unavailable/i.test(await text(a, '#messages .msg.me .translated')), await text(a, '#messages .msg.me .translated'));
  step('6c. the partner just sees the message, nothing odd', (await text(b, '#messages .msg.them .bubble')) === 'Can you read this?' && (await b.locator('.translated').count()) === 0);
  await raw(b, [{ t: 'msg', text: HI }]);
  await a.waitForSelector('#messages .msg.them .translated.failed', { timeout: 6000 });
  step('6d. a message that could not be translated stays readable as sent, with a Retry link', (await text(a, '#messages .msg.them:last-of-type .bubble')) !== '' && /Not translated/.test(await text(a, '#messages .msg.them .translated')) && (await a.locator('#messages .msg.them .tr-link', { hasText: 'Retry' }).count()) === 1, await text(a, '#messages .msg.them .translated'));
  await a.evaluate(() => { window.__fake.mode = 'ok'; });
  await a.locator('#messages .msg.them .tr-link', { hasText: 'Retry' }).click();
  await a.waitForFunction(() => /Hindi → English/.test(document.querySelector('#messages .msg.them .translated')?.textContent || ''), null, { timeout: 6000 });
  step('6e. Retry translates it once the engine works again', /^\[hi>en\]/.test(await text(a, '#messages .msg.them .bubble')));
  // an engine with no pair at all
  await openSheet(a); await a.selectOption('#trSendTarget', 'ta'); await closeSheet(a); // a pair the translator has not been used for yet
  await a.evaluate(() => { window.__fake.mode = 'none'; });
  await say(a, 'Another one');
  await b.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 2);
  step('6f. "no language pack for this pair" also falls back to sending the original', !('orig' in (await frames(a, 'msg')).at(-1)));
  await ctx.close();
}

// ===================================================================== 7. queue limits, the hidden tab
{
  const { ctx, open } = await setup();
  const a = await open('Aarav', { lang: 'en' }), b = await open('Meera', { lang: 'hi' });
  await connect(a, b);
  await a.waitForSelector('#trBar .tr-bar-go');
  await a.click('#trBar .tr-bar-go');
  await a.evaluate(() => { window.__fake.delay = 300; });
  await raw(b, Array.from({ length: 12 }, (_, i) => ({ t: 'msg', text: `संदेश संख्या ${i + 1}` })));
  await a.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 12);
  await a.waitForFunction(() => document.querySelectorAll('#messages .msg.them .translated.failed').length >= 1, null, { timeout: 4000 }).catch(() => {});
  const busy = await a.locator('#messages .msg.them .translated.failed').count();
  step('7a. a burst of 12 messages: at most 8 wait, the rest get a "too many waiting" line with Retry', busy === 4, `${busy} turned away`);
  step('7b. the turned-away ones keep their original text readable', (await a.$$eval('#messages .msg.them .translated.failed', ns => ns.every(n => /waiting/.test(n.textContent) && n.querySelector('.tr-link')))));
  await a.waitForFunction(() => document.querySelectorAll('#messages .msg.them .bubble').length && [...document.querySelectorAll('#messages .msg.them .bubble')].filter(n => n.textContent.startsWith('[hi>en]')).length === 8, null, { timeout: 8000 });
  step('7c. the 8 queued ones are translated one after the other', (await fakeCalls(a)) === 8, String(await fakeCalls(a)));
  await a.locator('#messages .msg.them .tr-link', { hasText: 'Retry' }).first().click();
  await a.waitForFunction(() => [...document.querySelectorAll('#messages .msg.them .bubble')].filter(n => n.textContent.startsWith('[hi>en]')).length === 9, null, { timeout: 5000 });
  step('7d. Retry on one of them works once there is room', true);
  // hidden tab
  await a.evaluate(() => { window.__fake.delay = 0; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  const n0 = await fakeCalls(a);
  await raw(b, [{ t: 'msg', text: 'छुपा हुआ टैब' }]);
  await a.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 13);
  await a.waitForTimeout(500);
  step('7e. nothing is translated while the tab is hidden', (await fakeCalls(a)) === n0);
  await a.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await a.waitForFunction(() => document.body.textContent.includes('[hi>en] छुपा हुआ टैब'), null, { timeout: 5000 }).catch(() => {});
  step('7f. it is translated as soon as the tab is back', (await fakeCalls(a)) === n0 + 1);
  await ctx.close();
}

// ===================================================================== 8. the message protocol: hostile frames, shield on both texts
{
  const { ctx, open } = await setup();
  const a = await open('Aarav', { lang: 'en' }), b = await open('Meera', { lang: 'hi' });
  await connect(a, b);
  const count = () => msgs(a, 'them').count();
  const sendRaw = async frs => { const n = await count(); await raw(b, frs); await a.waitForTimeout(350); return (await count()) - n; };

  step('8a. a valid translated message shows the text and the original', await (async () => { const d = await sendRaw([{ t: 'msg', text: 'Hello friend', orig: 'नमस्ते दोस्त', olang: 'hi' }]); return d === 1 && /Original · Hindi/.test(await text(a, '#messages .msg.them:last-of-type .translated')) && /नमस्ते दोस्त/.test(await text(a, '#messages .msg.them:last-of-type .translated')); })());
  const badLangs = ['xx', 'EN', 'zh-tw', 'auto', '__proto__', 'constructor', '', null, 5, ['en'], { a: 1 }, true, ' en', '<img src=x onerror=alert(1)>'];
  let leaked = 0;
  for (const v of badLangs) { const n = await sendRaw([{ t: 'msg', text: 'plain ' + String(typeof v), orig: 'secret original', olang: v }]); if (n !== 1 || (await lastMsg(a, 'them').locator('.translated').count()) !== 0) leaked++; }
  step(`8b. ${badLangs.length} invalid olang values: the message is shown, the original is dropped`, leaked === 0, `leaked ${leaked}`);
  let wrong = 0;
  for (const v of [5, null, ['x'], { a: 1 }, true, '', '   ']) { const n = await sendRaw([{ t: 'msg', text: 'ok ' + JSON.stringify(v), orig: v, olang: 'hi' }]); if (n !== 1 || (await lastMsg(a, 'them').locator('.translated').count()) !== 0) wrong++; }
  step('8c. non-string or empty orig is dropped', wrong === 0, `wrong ${wrong}`);
  let shown = 0;
  for (const v of [5, null, {}, ['a'], true, '', '   ']) shown += await sendRaw([{ t: 'msg', text: v }]);
  step('8d. a non-string or empty text shows nothing at all', shown === 0, `shown ${shown}`);
  const big = await sendRaw([{ t: 'msg', text: 'x'.repeat(5000) }]);
  step('8e. an oversize frame (>4096) is ignored', big === 0);
  const longTexts = await sendRaw([{ t: 'msg', text: 'a'.repeat(900), orig: 'b'.repeat(900), olang: 'hi' }]);
  const lens = await a.evaluate(() => { const m = [...document.querySelectorAll('#messages .msg.them')].at(-1); return [m.querySelector('.bubble').textContent.length, m.querySelector('.tr-body')?.textContent.length]; });
  step('8f. text and original are cut at 500 characters', longTexts === 1 && lens[0] === 500 && lens[1] === 500, JSON.stringify(lens));
  // markup is text
  await sendRaw([{ t: 'msg', text: '<img src=x onerror=window.__pwned=1>', orig: '<script>window.__pwned=2</script><b>x</b>', olang: 'hi' }]);
  step('8g. markup in text and original is shown as text, never as elements', await a.evaluate(() => { const m = [...document.querySelectorAll('#messages .msg.them')].at(-1); return !window.__pwned && !m.querySelector('img, script, b') && m.querySelector('.bubble').textContent.startsWith('<img') && m.querySelector('.tr-body').textContent.startsWith('<script>'); }));
  // shield on both texts
  await sendRaw([{ t: 'msg', text: 'Hello friend', orig: 'call me on 9876543210 please', olang: 'hi' }]);
  const m1 = lastMsg(a, 'them');
  step('8h. a risky ORIGINAL triggers the heads-up card, and the original is blurred and masked', (await m1.locator('.alert-card').count()) === 1 && (await m1.locator('.tr-body.masked').count()) === 1 && !/9876543210/.test(await text(a, '#messages .msg.them:last-of-type .tr-body')), await text(a, '#messages .msg.them:last-of-type .tr-body'));
  step('8i. the (benign) text is masked too until the person decides', (await m1.locator('.bubble.masked').count()) === 1);
  await m1.locator('.alert-card button', { hasText: 'Show anyway' }).click();
  step('8j. "Show anyway" reveals both', (await m1.locator('.masked').count()) === 0 && /9876543210/.test(await text(a, '#messages .msg.them:last-of-type .tr-body')) && (await text(a, '#messages .msg.them:last-of-type .bubble')) === 'Hello friend');
  await sendRaw([{ t: 'msg', text: 'send me your upi id abc@okaxis', orig: 'नमस्ते', olang: 'hi' }]);
  const m2 = lastMsg(a, 'them');
  step('8k. a risky TEXT with a benign original is masked as before', (await m2.locator('.alert-card').count()) === 1 && (await m2.locator('.bubble.masked').count()) === 1 && (await m2.locator('.tr-body.masked').count()) === 1);
  step('8l. a normal message from a partner with unknown extra fields is unaffected', (await sendRaw([{ t: 'msg', text: 'fine', lang: 'hi', evil: { a: 1 }, olang: 'hi' }])) === 1);
  // hostile peer cannot make me translate or send anything: no switches on = no calls, whatever the frames say
  step('8m. none of this made the translator run (switches were off)', (await fakeCalls(a)) === 0);
  await ctx.close();
}

// ===================================================================== 9. translating a risky message keeps it masked in both views
{
  const { ctx, open } = await setup();
  const a = await open('Aarav', { lang: 'en' }), b = await open('Meera', { lang: 'hi' });
  await connect(a, b);
  await a.waitForSelector('#trBar .tr-bar-go');
  await openSheet(a); await flip(a, 'trRecv'); await closeSheet(a);
  await raw(b, [{ t: 'msg', text: 'मेरा नंबर 9876543210 है, पैसे भेजो' }]);
  await a.waitForSelector('#messages .msg.them .alert-card', { timeout: 5000 });
  await a.waitForFunction(() => document.querySelector('#messages .msg.them .tr-link'), null, { timeout: 5000 }).catch(() => {});
  const m = lastMsg(a, 'them');
  step('9a. a scam-looking message is masked even after it was translated (original and translation)', (await m.locator('.bubble.masked').count()) === 1 && !/9876543210/.test(await text(a, '#messages .msg.them .bubble')), await text(a, '#messages .msg.them .bubble'));
  await m.locator('.tr-link').click().catch(() => {});
  step('9b. "show original" does not unmask it', (await m.locator('.bubble.masked').count()) === 1 && !/9876543210/.test(await text(a, '#messages .msg.them .bubble')));
  await m.locator('.alert-card button', { hasText: 'Show anyway' }).click();
  step('9c. "Show anyway" reveals whichever version is shown', /9876543210/.test(await text(a, '#messages .msg.them .bubble')) && (await m.locator('.bubble.masked').count()) === 0);
  await ctx.close();
}

// ===================================================================== 10. per chat, remembered choice, Premium lapse
{
  const { ctx, open } = await setup();
  const a = await open('Aarav', { lang: 'en' }), b = await open('Meera', { lang: 'hi' });
  await connect(a, b);
  await a.waitForSelector('#trBar .tr-bar-go');
  await a.click('#trBar .tr-bar-go');
  step('10a. on in this chat; nothing is stored (default: not remembered)', (await a.evaluate(() => localStorage.getItem('ac.translate'))) === null);
  await a.click('#nextBtn'); await a.click('#nextBtn'); // Next, twice (the second press confirms)
  await a.waitForFunction(() => window.__t.S.phase !== 'connected', null, { timeout: 8000 });
  step('10b. leaving the chat switches it off and removes the bar', !(await a.isVisible('#trBar')) && (await a.evaluate(() => window.__t.lt.state.recv === false && window.__t.lt.state.send === false)));
  await a.click('#leaveBtn'); await b.click('#leaveBtn');
  await a.waitForSelector('#welcome:not(.hidden)'); await b.waitForSelector('#welcome:not(.hidden)');
  step('10c. the next chat starts with it off', await connect(a, b) && !(await a.evaluate(() => window.__t.lt.state.recv)));
  await openSheet(a); await flip(a, 'trRecv'); await flip(a, 'trRemember');
  step('10d. "Remember my choice" stores {recv, send} in ac.translate', (await a.evaluate(() => localStorage.getItem('ac.translate'))) === '{"recv":true,"send":false}', await a.evaluate(() => localStorage.getItem('ac.translate')));
  await flip(a, 'trSend');
  step('10e. and keeps it up to date', (await a.evaluate(() => localStorage.getItem('ac.translate'))) === '{"recv":true,"send":true}');
  await closeSheet(a);
  await a.click('#leaveBtn'); await b.click('#leaveBtn');
  await a.waitForSelector('#welcome:not(.hidden)'); await b.waitForSelector('#welcome:not(.hidden)');
  await connect(a, b);
  step('10f. a new chat starts with the remembered choice', await a.evaluate(() => window.__t.lt.state.recv === true && window.__t.lt.state.send === true), await a.evaluate(() => JSON.stringify(window.__t.lt.state)));
  await b.fill('#msgInput', HI); await b.press('#msgInput', 'Enter');
  await a.waitForSelector('#messages .msg.them .tr-link', { timeout: 6000 });
  step('10g. and it translates right away', /^\[hi>en\]/.test(await text(a, '#messages .msg.them .bubble')));
  // Premium ends (or the person signs out) in the middle of the chat
  const n = await fakeCalls(a);
  await a.evaluate(() => { window.__free = true; window.__t.lt.enforce(); });
  await a.waitForTimeout(150);
  step('10h. losing Premium mid-chat turns Live translate off: bar gone, button not lit, a toast says why', !(await a.isVisible('#trBar')) && !(await a.evaluate(() => document.getElementById('translateBtn').classList.contains('on'))) && /needs Premium/.test(await text(a, '#toasts')), await text(a, '#toasts'));
  await raw(b, [{ t: 'msg', text: 'अब अनुवाद नहीं' }]);
  await a.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 2);
  await say(a, 'plain again');
  await b.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length === 1);
  const last = (await frames(a, 'msg')).at(-1);
  step('10i. afterwards nothing is translated in either direction', (await fakeCalls(a)) === n && last.text === 'plain again' && !('orig' in last));
  await a.click('#translateBtn');
  await a.waitForSelector('#paywall:not(.hidden)', { timeout: 3000 }).catch(() => {});
  step('10j. and the button leads to the Premium sheet again', await a.isVisible('#paywall') && /Live translate/.test(await text(a, '#paywallReason')));
  await ctx.close();
}

// ===================================================================== 11. phones: More sheet, the bar, no overflow; screenshots
for (const scheme of ['dark', 'light']) {
  for (const [name, viewport] of [['phone', { width: 360, height: 740 }], ['narrow', { width: 320, height: 640 }]]) {
    const { ctx, open } = await setup({ viewport, colorScheme: scheme });
    const a = await open('Aarav', { lang: 'en' }), b = await open('Meera', { lang: 'hi' });
    await themeOf(a, scheme); await themeOf(b, scheme);
    await connect(a, b);
    await a.waitForSelector('#trBar .tr-bar-go');
    const tag = `${name}-${scheme}`;
    if (name === 'phone') {
      step(`11a. (${tag}) the header button is not in the crowded phone header`, !(await a.isVisible('#translateBtn')));
      await a.screenshot({ path: `${SP}/live-${tag}-suggest.png` });
      await a.click('#chatMoreBtn');
      await a.waitForSelector('#moreSheet:not(.hidden)');
      const item = a.locator('#moreSheet [data-proxy="translateBtn"]');
      step(`11b. (${tag}) the "This chat" sheet has Live translate with its state`, (await item.isVisible()) && (await text(a, '#translateMoreLabel')) === 'Off', await text(a, '#translateMoreLabel'));
      await a.waitForTimeout(500);
      await a.screenshot({ path: `${SP}/live-${tag}-more.png` });
      await item.click();
      await a.waitForSelector('#translateSheet:not(.hidden)');
      step(`11c. (${tag}) it opens the settings sheet`, await sheetOpen(a));
      await a.waitForTimeout(500);
      await flip(a, 'trRecv'); await flip(a, 'trSend');
      await a.waitForTimeout(400);
      await a.screenshot({ path: `${SP}/live-${tag}-sheet.png` });
      step(`11d. (${tag}) the sheet fits: no horizontal overflow, controls inside the sheet`, await noOverflow(a) && await a.evaluate(() => { const s = document.querySelector('#translateSheet .sheet').getBoundingClientRect(); return [...document.querySelectorAll('#translateSheet select, #translateSheet .toggle')].every(n => { const r = n.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1; }); }));
      await a.click('#translateSheet .sheet-foot button');
    } else {
      await a.click('#trBar .tr-bar-go');
    }
    await raw(b, [{ t: 'msg', text: HI }, { t: 'msg', text: 'Hello friend', orig: 'नमस्ते दोस्त', olang: 'hi' }]);
    await say(a, 'How was your day today, my friend?');
    await a.waitForFunction(() => document.querySelectorAll('#messages .tr-link').length >= 1 && document.querySelectorAll('#messages .msg.me .tr-body').length >= 1, null, { timeout: 6000 }).catch(() => {});
    await a.waitForTimeout(300);
    step(`11e. (${tag}) chat with the bar, translated lines and the sent version: no horizontal overflow`, await noOverflow(a));
    await a.screenshot({ path: `${SP}/live-${tag}-chat.png` });
    const bar = await a.evaluate(() => { const r = document.getElementById('trBar').getBoundingClientRect(); return { h: r.height, inside: r.left >= 0 && r.right <= innerWidth }; });
    step(`11f. (${tag}) the bar is slim (one or two lines) and inside the screen`, bar.inside && bar.h <= 70, JSON.stringify(bar));
    const targets = await a.evaluate(() => [...document.querySelectorAll('#trBar button')].map(b => { const r = b.getBoundingClientRect(); return Math.round(r.height); }));
    step(`11g. (${tag}) bar buttons are at least 36px tall (44px tap area)`, targets.every(x => x >= 36), targets.join(','));
    await ctx.close();
  }
}

// ===================================================================== 12. desktop screenshots, both themes
for (const scheme of ['dark', 'light']) {
  const { ctx, open } = await setup({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
  const a = await open('Aarav', { lang: 'en' }), b = await open('Meera', { lang: 'hi' });
  await themeOf(a, scheme); await themeOf(b, scheme);
  await connect(a, b);
  await a.waitForSelector('#trBar .tr-bar-go');
  await a.screenshot({ path: `${SP}/live-desktop-${scheme}-suggest.png` });
  await openSheet(a); await flip(a, 'trRecv'); await flip(a, 'trSend');
  await a.waitForTimeout(500);
  await a.screenshot({ path: `${SP}/live-desktop-${scheme}-sheet.png` });
  await closeSheet(a);
  await raw(b, [{ t: 'msg', text: HI }, { t: 'msg', text: 'Hello friend', orig: 'नमस्ते दोस्त', olang: 'hi' }]);
  await say(a, 'How was your day today, my friend?');
  await a.waitForFunction(() => document.querySelectorAll('#messages .tr-link').length >= 1 && document.querySelectorAll('#messages .msg.me .tr-body').length >= 1, null, { timeout: 6000 }).catch(() => {});
  await a.waitForTimeout(300);
  await a.screenshot({ path: `${SP}/live-desktop-${scheme}-chat.png` });
  step(`12. (desktop ${scheme}) chat with translations renders, no overflow`, await noOverflow(a));
  await ctx.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
