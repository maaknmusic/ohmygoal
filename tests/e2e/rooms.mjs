// Come back: themed rooms (matching only within a room), streaks and levels, the mutual good-vibe card.
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

async function setup(mode = 'text', init = {}) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(([m, extra]) => {
    localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    localStorage.setItem('ac.mode', JSON.stringify(m));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem('ac.' + k, JSON.stringify(v));
  }, [mode, init]);
  const open = async (name, theme) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    await p.goto('http://localhost:8765/index.html');
    await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
    await p.fill('#nickInput', name); await p.check('#ageCheck');
    // tabs of one browser share localStorage, so each tab's room is set on its own page state
    if (theme !== undefined) await p.evaluate(t => { window.__t.S.theme = t; }, theme);
    return p;
  };
  return { ctx, open };
}
const live = (p, ms = 15000) => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: ms }).then(() => true, () => false);
const text = (p, sel) => p.textContent(sel).then(t => t || '');
const pickRoom = async (p, name) => { await p.click('#roomBtn'); await p.click(`#roomList .room-opt:has-text("${name}")`); };

// ------------------------------------------------------------- 1. choosing a room
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav');
  step('1a. the start card shows the room button with open chat by default', /Open chat/.test(await text(a, '#roomSummary')));
  await a.click('#roomBtn');
  const opts = await a.locator('#roomList .room-opt').evaluateAll(bs => bs.map(b => b.querySelector('b').textContent));
  step('1b. the sheet lists open chat plus the themes and the language exchange', opts.length === 8 && opts[0] === 'Open chat' && opts.includes('Cricket night') && opts.includes('Study hour'), opts.join());
  step('1c. each theme shows when it is busy (IST)', (await text(a, '#roomList')).match(/IST/g).length >= 6);
  await a.click('#roomList .room-opt:has-text("Cricket night")');
  step('1d. choosing a room updates the button and is remembered', /Cricket night/.test(await text(a, '#roomSummary')) && (await a.evaluate(() => JSON.parse(localStorage.getItem('ac.theme')))) === 'cricket');
  await a.reload();
  await a.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting');
  step('1e. it is still chosen after a reload', /Cricket night/.test(await text(a, '#roomSummary')));
  await ctx.close();
}
{
  const { ctx, open } = await setup('text', { theme: '<img src=x onerror=alert(1)>' });
  const a = await open('Aarav');
  const th = await a.evaluate(() => window.__t.S.theme);
  step('1f. an invalid stored room is treated as open chat', th === '' && /Open chat/.test(await text(a, '#roomSummary')), JSON.stringify(th));
  await ctx.close();
}

// ------------------------------------------------------------- 2. matching only inside a room
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav', 'cricket'), b = await open('Meera', ''), c = await open('Kabir', 'cricket');
  await a.click('#startBtn'); await b.click('#startBtn');
  step('2a. a room and open chat do not match each other', !(await live(a, 6000)) && !(await live(b, 1000)));
  await c.click('#startBtn');
  step('2b. two people in the same room do match', (await live(a, 12000)) && (await live(c, 4000)));
  step('2c. the match card names the room', /Room: Cricket night/.test(await text(a, '.match-card')), await text(a, '.match-card'));
  step('2d. the person in open chat is still waiting', !(await live(b, 500)));
  await ctx.close();
}
{
  // the quiet-room hint, and the way out
  const { ctx, open } = await setup('text');
  const a = await open('Aarav', 'study'), b = await open('Meera', '');
  await a.click('#startBtn'); await b.click('#startBtn');
  await a.waitForFunction(() => /Still looking in Study hour/.test(document.getElementById('messages').textContent), null, { timeout: 32000 }).catch(() => {});
  step('2e. after 25 seconds a quiet room offers to switch to open chat', /Still looking in Study hour/.test(await text(a, '#messages')) && await a.locator('#messages button:has-text("Switch to open chat")').count() === 1);
  await a.click('#messages button:has-text("Switch to open chat")');
  step('2f. switching drops the room and finds the person in open chat', (await live(a, 15000)) && (await live(b, 5000)) && (await a.evaluate(() => window.__t.S.theme)) === '');
  await ctx.close();
}

// ------------------------------------------------------------- 3. streaks and levels
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera');
  await a.click('#startBtn'); await b.click('#startBtn');
  step('3a. match', (await live(a)) && (await live(b)));
  step('3b. a new person starts with no streak', /start a streak/.test(await text(a, '#progressLine')));
  await a.click('#nextBtn'); await a.click('#nextBtn');           // a chat of a few seconds
  await a.waitForTimeout(500);
  const none = await a.evaluate(() => localStorage.getItem('ac.progress'));
  step('3c. a chat shorter than a minute counts for nothing', none === null, String(none));
  await ctx.close();
}
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera');
  await a.click('#startBtn'); await b.click('#startBtn');
  await live(a); await live(b);
  await a.evaluate(() => { window.__t.S.session.startedAt -= 130000; });   // pretend the chat has lasted two minutes
  await a.click('#nextBtn'); await a.click('#nextBtn');
  await a.waitForTimeout(600);
  const pr = await a.evaluate(() => JSON.parse(localStorage.getItem('ac.progress')));
  step('3d. a chat of two minutes starts a streak and earns points', pr && pr.streak === 1 && pr.chats === 1 && pr.xp === 12, JSON.stringify(pr));
  await a.click('#leaveBtn');
  await a.waitForSelector('#welcome:not(.hidden)');
  step('3e. the start card shows it', /Streak started/.test(await text(a, '#progressLine')) && /Level 1 · Newcomer/.test(await text(a, '#levelName')), await text(a, '#progressLine'));
  const w = await a.evaluate(() => document.getElementById('levelFill').style.width);
  step('3f. the level bar moves', parseInt(w) > 0 && parseInt(w) < 100, w);
  await ctx.close();
}
{
  // tampered storage is cleaned up, not trusted
  const { ctx, open } = await setup('text', { progress: { xp: 1e15, streak: 'lots', chats: -4, last: 'tomorrow', evil: '<b>x</b>' } });
  const a = await open('Aarav');
  const pr = await a.evaluate(() => window.__t.S.progress);
  step('3g. nonsense in storage becomes a clean record', pr.streak === 0 && pr.chats === 0 && pr.xp === 1000000 && !('evil' in pr), JSON.stringify(pr));
  step('3h. and the level shows the top rank without breaking the layout', /Level 6 · Legend/.test(await text(a, '#levelName')) && (await a.evaluate(() => document.getElementById('levelFill').style.width)) === '100%');
  await ctx.close();
}

// ------------------------------------------------------------- 4. mutual good vibes
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera');
  await a.click('#startBtn'); await b.click('#startBtn');
  await live(a); await live(b);
  await a.evaluate(() => { window.__t.S.session.startedAt -= 40000; });
  await b.evaluate(() => { window.__t.S.session.startedAt -= 40000; });
  await a.click('#likeBtn');
  step('4a. one good vibe alone shows no card', await a.locator('.mutual-card').count() === 0);
  await b.waitForFunction(() => /sent you a good vibe/.test(document.getElementById('messages').textContent), null, { timeout: 5000 }).catch(() => {});
  step('4b. the other person is told', /sent you a good vibe/.test(await text(b, '#messages')));
  step('4c. no card for them yet either (they have not sent one)', await b.locator('.mutual-card').count() === 0);
  await b.click('#likeBtn');
  await b.waitForSelector('.mutual-card', { timeout: 5000 }).catch(() => {});
  await a.waitForSelector('.mutual-card', { timeout: 5000 }).catch(() => {});
  step('4d. when both have sent one, both are offered to add each other', await a.locator('.mutual-card').count() === 1 && await b.locator('.mutual-card').count() === 1 && /Add them as a friend/.test(await text(a, '.mutual-card')));
  await a.click('.mutual-card >> text=Not now');
  step('4e. "Not now" dismisses it', await a.locator('.mutual-card').count() === 0);
  await ctx.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
