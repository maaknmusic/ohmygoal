// Quick rounds (local demo mode): the round is announced, a 10-second warning with the "+1 min" button pulsing, and at zero both
// people see "Time’s up" with how to turn rounds off, never "Stranger disconnected". Takes about 75 s (the round is a real minute).
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };

async function pair({ mode = 'text', viewport = { width: 1280, height: 800 }, mobile = false } = {}) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport, hasTouch: mobile, isMobile: mobile }); await ctx.addInitScript(() => { try { localStorage.setItem('ac.safetyBrief', 'true'); } catch { /* storage off */ } });   // first-chat safety sheet: tests/e2e/safety-brief.mjs
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(m => {
    localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    localStorage.setItem('ac.mode', JSON.stringify(m));
    localStorage.setItem('ac.interests', JSON.stringify(['cricket', 'music'])); localStorage.setItem('ac.timed', 'true');
  }, mode);
  const open = async name => {
    const p = await ctx.newPage();
    p.name = name;
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load|net::|ERR_/.test(m.text())) errors.push(name + ' console: ' + m.text().slice(0, 160)); });
    await p.goto('http://localhost:8765/index.html');
    await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
    await p.fill('#nickInput', name);
    await p.check('#ageCheck');
    return p;
  };
  return { ctx, a: await open('Aarav'), b: await open('Meera') };
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 15000 }).then(() => true, () => false);
const text = (p, sel) => p.textContent(sel).then(t => t || '');
const say = async (p, msg, twice = false) => { await p.fill('#msgInput', msg); await p.press('#msgInput', 'Enter'); if (twice) { await p.press('#msgInput', 'Enter'); } };
const connect = async (a, b) => { await a.click('#startBtn'); await b.click('#startBtn'); return (await live(a)) && (await live(b)); };

const { ctx, a, b } = await pair();
step('1. two people with Quick rounds on are matched', await connect(a, b));
await a.waitForTimeout(1500);
const sysText = p => p.evaluate(() => [...document.querySelectorAll('#messages .sys')].map(x => x.textContent).join(' | '));
step('2. both are told the chat is a 60-second round and how to keep talking', /Quick rounds: 60 s per chat\. You both tap “\+1 min”/.test(await sysText(a)) && /Quick rounds: 60 s per chat/.test(await sysText(b)), await sysText(a));
step('3. the round timer is shown', await a.isVisible('#round') && /^[01]:\d\d$/.test(await text(a, '#roundTime')), await text(a, '#roundTime'));
await a.waitForFunction(() => /10 seconds left/.test(document.getElementById('messages').textContent), null, { timeout: 70000 }).catch(() => {});
step('4a. with 10 seconds left both get a warning', /10 seconds left\. You both tap “\+1 min” to keep talking\./.test(await sysText(a)) && /10 seconds left/.test(await sysText(b)));
const pulse = await a.evaluate(() => getComputedStyle(document.getElementById('extendBtn')).animationName);
step('4b. ...and the "+1 min" button pulses', pulse === 'extendPulse' && await a.evaluate(() => document.getElementById('round').classList.contains('low')), pulse);
await a.waitForFunction(() => document.getElementById('chat').dataset.phase === 'ended', null, { timeout: 20000 }).catch(() => {});
await b.waitForFunction(() => document.getElementById('chat').dataset.phase === 'ended', null, { timeout: 5000 }).catch(() => {});
const end = async p => ({ title: await text(p, '#overlayTitle'), sub: await text(p, '#overlaySub'), sys: await sysText(p) });
const ea = await end(a), eb = await end(b);
const ok = e => e.title === '⏱ Time’s up' && /Quick rounds is on: each chat lasts 60 s unless you both tap “\+1 min”\. You can turn it off in the menu/.test(e.sub) && !/disconnected/i.test(e.title + e.sub + e.sys);
step('5. at zero BOTH see "Time’s up" and how to turn rounds off, not "Stranger disconnected"', ok(ea) && ok(eb), JSON.stringify([ea.title, eb.title, eb.sys.slice(-80)]));
await a.waitForFunction(() => document.getElementById('chat').dataset.phase !== 'ended', null, { timeout: 8000 }).catch(() => {});
step('6. then the next chat search starts by itself', ['searching', 'connecting', 'connected'].includes(await a.evaluate(() => document.getElementById('chat').dataset.phase)));
step('7. no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
await browser.close();
