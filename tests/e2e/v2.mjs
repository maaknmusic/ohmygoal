// End-to-end tests for the v2 chat features (local demo mode: two tabs of one browser context match each other).
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
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport, hasTouch: mobile, isMobile: mobile });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(m => {
    localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    localStorage.setItem('ac.mode', JSON.stringify(m));
    localStorage.setItem('ac.interests', JSON.stringify(['cricket', 'music']));
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

// ---------------------------------------------------------------- 1. start flow, identity, icebreakers
{
  const { ctx, a, b } = await pair();
  step('1a. handles are generated (not empty, ≤20 chars) when no nickname is typed', await (async () => {
    const c = await ctx.newPage(); await c.goto('http://localhost:8765/index.html');
    await c.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting');
    const v = await c.inputValue('#nickInput'); await c.close(); return v.length > 2 && v.length <= 20;
  })());
  const c2 = await ctx.newPage(); await c2.goto('http://localhost:8765/index.html');
  await c2.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting');
  const before = await c2.inputValue('#nickInput');
  await c2.click('#diceBtn');
  step('1b. dice re-rolls the handle', (await c2.inputValue('#nickInput')) !== before);
  await c2.uncheck('#ageCheck').catch(() => {});
  await c2.click('#startBtn');
  step('1c. Start without consent nudges instead of failing silently', /18\+/.test(await text(c2, '#toasts')) && await c2.isVisible('#welcome'));
  await c2.close();

  step('1d. two people match', await connect(a, b));
  step('1e. match card shows name + shared interests', (await text(a, '.match-card h4')) === 'Meera' && /cricket/.test(await text(a, '.match-card')) && /music/.test(await text(a, '.match-card')), await text(a, '.match-card'));
  step('1f. header shows partner name', (await text(a, '#partnerName')) === 'Meera');
  const chips = await a.locator('#icebreakers .ibreak').count();
  step('1g. three conversation starters offered', chips === 3, String(chips));
  const first = await a.locator('#icebreakers .ibreak').first().textContent();
  await a.locator('#icebreakers .ibreak').first().click();
  await b.waitForFunction(() => document.querySelectorAll('#messages .msg.them').length > 0, null, { timeout: 8000 }).catch(() => {});
  step('1h. tapping a starter sends it', (await text(b, '#messages .msg.them .bubble')) === first);
  step('1i. starters disappear after the first message', !(await a.isVisible('#icebreakers')) && !(await b.isVisible('#icebreakers')));

  // ---------------------------------------------------------------- 2. scam shield
  await say(a, 'send me your number? mine is 98765 43210 or insta @coolguy_99', true);
  await b.waitForSelector('.alert-card', { timeout: 8000 }).catch(() => {});
  const bubbleTxt = await text(b, '#messages .msg.them:last-of-type .bubble');
  step('2a. outgoing personal info asks for confirmation first (second Enter sends)', await b.locator('.alert-card').count() === 1);
  step('2b. partner\'s phone number is masked behind a heads-up card', !/98765 ?43210/.test(bubbleTxt) && /Heads up/.test(await text(b, '.alert-card')), bubbleTxt);
  await b.click('.alert-card >> text=Show anyway');
  step('2c. "Show anyway" reveals the original', /98765 43210/.test(await text(b, '#messages .msg.them:last-of-type .bubble')));
  await say(a, 'I scored 98 runs in 2024 and it cost ₹149');
  await b.waitForTimeout(400);
  step('2d. ordinary numbers do not trigger the shield', await b.locator('.alert-card').count() === 1);

  // ---------------------------------------------------------------- 3. games over the real data channel
  await a.click('#gamesBtnText');
  step('3a. picker lists the five games', await a.locator('.gc-tile').count() === 5);
  await a.click('.gc-tile:has-text("Tic-Tac-Toe")');
  await b.waitForSelector('.game-card >> text=invited you to play', { timeout: 8000 }).catch(() => {});
  step('3b. partner sees the invite', /invited you to play Tic-Tac-Toe/.test(await text(b, '.game-card')));
  await b.click('.game-card >> text=Accept');
  await a.waitForSelector('.ttt', { timeout: 8000 });
  // A moves first (inviter). A: 0,1,2 wins; B: 3,4.
  const mv = async (p, i) => { await p.locator('.ttt-cell').nth(i).click(); await p.waitForTimeout(250); };
  await mv(a, 0); await mv(b, 3); await mv(a, 1); await mv(b, 4); await mv(a, 2);
  await a.waitForSelector('.game-card >> text=Rematch', { timeout: 8000 });
  step('3c. tic-tac-toe plays to a win on both sides', /won/i.test(await text(a, '.gc-status')) && /won|lost|Meera/i.test(await text(b, '.gc-status')), `${await text(a, '.gc-status')} / ${await text(b, '.gc-status')}`);
  step('3d. result is posted into the chat', /Tic-Tac-Toe: you won/.test(await text(a, '#messages')) && /Aarav won/.test(await text(b, '#messages')));
  await a.click('.game-card >> text=Rematch'); await b.click('.game-card >> text=Accept rematch');
  await a.waitForSelector('.ttt .ttt-cell:not([disabled]), .ttt', { timeout: 8000 });
  step('3e. rematch starts a new board', await a.locator('.ttt-cell').count() === 9);
  await b.click('.gc-x'); // first tap only arms the quit
  await b.waitForTimeout(300);
  step('3e2. one tap on × does not forfeit a running game', /Quit\?/.test(await text(b, '.gc-x')) && !(await a.locator('.game-card >> text=Rematch').count()));
  await b.click('.gc-x'); // second tap quits
  await a.waitForSelector('.game-card >> text=Rematch', { timeout: 8000 });
  step('3f. quitting forfeits (other side wins)', /win/i.test(await text(a, '.gc-status')), await text(a, '.gc-status'));
  await a.click('.game-card >> text=Close');
  await b.click('.game-card >> text=Close');
  // Stone Paper Scissors: A stone, B scissors three times -> A wins
  await b.click('#gamesBtnText'); await b.click('.gc-tile:has-text("Stone Paper")');
  await a.click('.game-card >> text=Accept');
  for (let r = 0; r < 2; r++) {
    await b.waitForSelector('.gc-pick:not([disabled])', { timeout: 8000 });
    await b.click('.gc-pick[aria-label=Stone]'); await a.click('.gc-pick[aria-label=Scissors]');
    await b.waitForTimeout(600);
  }
  await b.waitForSelector('.game-card >> text=Rematch', { timeout: 8000 });
  step('3g. stone-paper-scissors commit-reveal resolves; stone beats scissors', /won/i.test(await text(b, '.gc-status')), await text(b, '.gc-status'));
  await a.click('.game-card >> text=Close'); await b.click('.game-card >> text=Close');
  // Word chain
  await a.click('#gamesBtnText'); await a.click('.gc-tile:has-text("Word Chain")');
  await b.click('.game-card >> text=Accept');
  await a.waitForSelector('.wc-form input:not([disabled])', { timeout: 8000 });
  await a.fill('.wc-form input', 'mango'); await a.press('.wc-form input', 'Enter');
  await b.waitForSelector('.wc-need b', { timeout: 8000 });
  step('3h. word chain: next word must start with the last letter', (await text(b, '.wc-need b')) === 'O', await text(b, '.wc-need'));
  await b.fill('.wc-form input', 'mango'); await b.press('.wc-form input', 'Enter');
  await b.waitForTimeout(400);
  step('3i. a wrong word costs a heart (shown to both)', /lost a heart/.test(await text(a, '.game-card')) && /lost a heart/.test(await text(b, '.game-card')), await text(a, '.game-card'));
  await a.click('.gc-x'); // quit
  await b.waitForSelector('.game-card >> text=Rematch', { timeout: 8000 }).catch(() => {});
  await b.click('.game-card >> text=Close').catch(() => {});
  await a.click('.game-card >> text=Close').catch(() => {});

  // ---------------------------------------------------------------- 5. end of chat
  await b.click('#leaveBtn');
  await a.waitForSelector('#endReportBtn:not(.hidden)', { timeout: 8000 });
  step('5a. partner left: end card with countdown, pause and report', /Next chat in/.test(await text(a, '#overlaySub')) && await a.isVisible('#endPauseBtn') && await a.isVisible('#endReportBtn'));
  await a.click('#endPauseBtn');
  await a.waitForTimeout(3500);
  step('5b. Pause stops the auto-next countdown', /Paused/.test(await text(a, '#overlaySub')) && await a.isVisible('#overlayNewBtn'));
  await a.click('#endReportBtn');
  step('5c. you can still report someone right after they disconnect', await a.isVisible('#reportModal'));
  await a.click('#reportSubmit');
  await a.waitForFunction(() => /report sent/i.test(document.getElementById('toasts').textContent), null, { timeout: 8000 }).catch(() => {});
  step('5d. report is sent and the search continues', /report sent/i.test(await text(a, '#toasts')));
  await ctx.close();
}

// ---------------------------------------------------------------- 4. reactions + menu (video)
{
  const { ctx, a, b } = await pair({ mode: 'video' });
  step('4a. video match', await connect(a, b));
  step('4b. Next is the big button on the video stage', await a.locator('#nextSlotStage #nextBtn').count() === 1);
  await a.click('#reactBtn');
  step('4c. reaction bar opens', await a.isVisible('#reactBar') && await a.locator('#reactBar button').count() === 6);
  await a.click('#reactBar button:nth-child(2)');
  await b.waitForSelector('.float-emoji', { timeout: 8000 }).catch(() => {});
  step('4d. reaction floats up on both screens', await a.locator('.float-emoji').count() >= 1 && await b.locator('.float-emoji').count() >= 1);
  await a.dblclick('#videoWrap');
  step('4e. double-tap sends a heart', true);
  await a.click('#gamesBtn');
  step('4f. games open as glass over the video on desktop', await a.isVisible('#gameStage') && !(await a.isVisible('#gameDock')));
  await a.click('.gc-x');
  // Esc inside a sheet closes the sheet, never skips the chat
  await a.click('#menuBtn');
  step('4g. menu opens as a sheet', await a.isVisible('#menuSheet'));
  await a.keyboard.press('Escape');
  step('4h. Esc closes the sheet and does not skip the chat', !(await a.isVisible('#menuSheet')) && (await text(a, '#nextBtn')) === 'Next');
  await a.click('#menuBtn');
  const theme0 = await a.getAttribute('html', 'data-theme');
  await a.click('#themeBtn');
  step('4i. theme toggle works from the menu', (await a.getAttribute('html', 'data-theme')) !== theme0);
  await a.click('#accentGrid .accent-opt:has-text("Monsoon")');
  step('4j. free accent applies', (await a.getAttribute('html', 'data-accent')) === 'monsoon');
  await a.click('#accentGrid .accent-opt:has-text("Holi")');
  step('4k. in local demo mode (everything unlocked) a Premium accent applies', (await a.getAttribute('html', 'data-accent')) === 'holi');
  await ctx.close();
}

// ---------------------------------------------------------------- 6. phone layout
for (const mode of ['video', 'text']) {
  const { ctx, a, b } = await pair({ mode, viewport: { width: 390, height: 844 }, mobile: true });
  const ok = await connect(a, b);
  step(`6a. [${mode}] connects on a phone`, ok);
  const m = await a.evaluate(() => {
    const r = id => { const e = document.getElementById(id); const b = e?.getBoundingClientRect(); return b && { x: b.x, y: b.y, w: b.width, h: b.height, vis: e.offsetParent !== null }; };
    return { overflow: document.documentElement.scrollWidth > innerWidth, topbar: getComputedStyle(document.querySelector('.topbar')).display, next: r('nextBtn'), msg: r('messages'), input: r('msgInput'), local: r('localVideo'), vh: innerHeight };
  });
  step(`6b. [${mode}] no horizontal overflow, top bar hidden in chat`, !m.overflow && m.topbar === 'none', JSON.stringify({ overflow: m.overflow, topbar: m.topbar }));
  step(`6c. [${mode}] Next is reachable and visible`, m.next?.vis && m.next.y + m.next.h <= m.vh && m.next.h >= 44, JSON.stringify(m.next));
  step(`6d. [${mode}] composer is at the bottom of the screen`, m.input.y + m.input.h > m.vh - 140, JSON.stringify(m.input));
  step(`6e. [${mode}] messages area has room (≥ 180px)`, m.msg.h >= 180, `h=${Math.round(m.msg.h)}`);
  await a.screenshot({ path: `${SP}/v2/phone-${mode}.png` });
  if (mode === 'text') {
    await a.click('#gamesBtnText');
    step('6f. [text] games button works on a phone and the card is inside the panel', await a.isVisible('#gameDock .gc-picker'));
    await a.screenshot({ path: `${SP}/v2/phone-text-games.png` });
  } else {
    await a.click('#gamesBtn');
    step('6f. [video] games dock under the video on a phone (not over the controls)', await a.isVisible('#gameDock .gc-picker') && !(await a.isVisible('#gameStage')));
    await a.screenshot({ path: `${SP}/v2/phone-video-games.png` });
  }
  await ctx.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
