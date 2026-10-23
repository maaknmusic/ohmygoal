// Group rooms in the local demo (tabs of one browser): joining, the mesh of connections, chat, leaving, blocking, reporting, room size.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8') + '\nwindow.__t = { S };\n';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
await ctx.addInitScript(() => { localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5)); });
const open = async name => {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(name + ': ' + e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting');
  await p.fill('#nickInput', name); await p.check('#ageCheck');
  return p;
};
const text = (p, sel) => p.textContent(sel).then(t => (t || '').trim());
const enter = async (p, topic, mode = 'voice') => {
  if (!(await p.isVisible('#groups'))) await p.click('#groupBtn');
  await p.waitForSelector('#groupTopics .group-topic');
  if (mode === 'video') await p.click('[data-gmode="video"]');
  await p.click(`#groupTopics .group-topic:has-text("${topic}")`);
};
const tiles = p => p.locator('#groupGrid .g-tile').count();
const connected = p => p.evaluate(() => [...document.querySelectorAll('#groupGrid .g-tile:not(.self)')].every(t => t.querySelector('.g-state').textContent === ''));

const a = await open('Aarav'), b = await open('Meera'), c = await open('Kabir'), d = await open('Dev');
await a.click('#groupBtn');
step('1a. the Group rooms button opens the lobby', await a.isVisible('#groupLobby') && !(await a.isVisible('#welcome')));
const topics = await a.locator('#groupTopics .group-topic b').allTextContents();
step('1b. twelve topics are offered, with the room size', topics.length === 12 && topics.includes('Cricket') && /Up to 8/.test(await text(a, '#groupTopics .group-topic')), String(topics.length));
await a.click('[data-gmode="video"]');
step('1c. video rooms say up to 4', /Up to 4/.test(await text(a, '#groupTopics .group-topic')));
await a.click('[data-gmode="voice"]');

await enter(a, 'Cricket');
await a.waitForSelector('#groupRoom:not(.hidden)', { timeout: 8000 });
step('2a. joining shows the room with your own tile', await tiles(a) === 1 && /Cricket · Voice/.test(await text(a, '#groupTitle')));
await enter(b, 'Cricket');
await b.waitForSelector('#groupRoom:not(.hidden)', { timeout: 8000 });
await a.waitForFunction(() => document.querySelectorAll('#groupGrid .g-tile').length === 2, null, { timeout: 8000 }).catch(() => {});
await b.waitForFunction(() => document.querySelectorAll('#groupGrid .g-tile').length === 2, null, { timeout: 8000 }).catch(() => {});
step('2b. the second person appears on both screens', await tiles(a) === 2 && await tiles(b) === 2 && /Meera/.test(await text(a, '#groupGrid')) && /Aarav/.test(await text(b, '#groupGrid')));
await a.waitForFunction(() => document.querySelector('#groupGrid .g-tile:not(.self) .g-state')?.textContent === '', null, { timeout: 15000 }).catch(() => {});
step('2c. they connect directly (the "Connecting…" label goes away)', await connected(a) && await connected(b));
await enter(c, 'Cricket');
await c.waitForSelector('#groupRoom:not(.hidden)', { timeout: 8000 });
await a.waitForFunction(() => document.querySelectorAll('#groupGrid .g-tile').length === 3, null, { timeout: 8000 }).catch(() => {});
step('2d. a third person joins: everyone sees three', await tiles(a) === 3 && await tiles(b) === 3 && await tiles(c) === 3, `${await tiles(a)}/${await tiles(b)}/${await tiles(c)}`);
await c.waitForFunction(() => [...document.querySelectorAll('#groupGrid .g-tile:not(.self) .g-state')].every(s => s.textContent === ''), null, { timeout: 20000 }).catch(() => {});
step('2e. the mesh is complete: every pair is connected', await connected(a) && await connected(b) && await connected(c));

await enter(d, 'Music');
await d.waitForSelector('#groupRoom:not(.hidden)', { timeout: 8000 });
await a.waitForTimeout(800);
step('3a. a different topic is a different room', await tiles(d) === 1 && await tiles(a) === 3);

// chat
await a.fill('#groupInput', 'hello <b>room</b>');
await a.press('#groupInput', 'Enter');
await b.waitForFunction(() => /hello/.test(document.getElementById('groupMessages').textContent), null, { timeout: 6000 }).catch(() => {});
await c.waitForFunction(() => /hello/.test(document.getElementById('groupMessages').textContent), null, { timeout: 6000 }).catch(() => {});
step('4a. a chat message reaches everyone in the room, as text', /Aarav/.test(await text(b, '#groupMessages')) && /<b>room<\/b>/.test(await text(c, '#groupMessages')) && await b.locator('#groupMessages b b').count() === 0);
step('4b. and not people in another room', !/hello/.test(await text(d, '#groupMessages')));
step('4c. your own message shows as yours', /You/.test(await text(a, '#groupMessages')));

// block
await a.locator('#groupGrid .g-tile:has-text("Meera") .g-more').click();
await a.click('.g-menu >> text=Block');
step('5a. blocking marks the tile and remembers the person', await a.locator('.g-tile.blocked').count() === 1 && (await a.evaluate(() => window.__t.S.blocked.size)) === 1);
await b.fill('#groupInput', 'can you hear me');
await b.press('#groupInput', 'Enter');
await c.waitForFunction(() => /can you hear me/.test(document.getElementById('groupMessages').textContent), null, { timeout: 6000 }).catch(() => {});
await a.waitForTimeout(500);
step('5b. a blocked person’s messages are not shown to you (others still see them)', /can you hear me/.test(await text(c, '#groupMessages')) && !/can you hear me/.test(await text(a, '#groupMessages')));

// report
await a.evaluate(() => { const t = window.__t.S.transport; const o = t.report; t.report = async p => { (window.__reports ||= []).push(p); return o(p); }; });
await a.locator('#groupGrid .g-tile:has-text("Kabir") .g-more').click();
await a.click('.g-menu >> text=Report');
await a.waitForSelector('#reportModal:not(.hidden)');
step('6a. Report opens the usual sheet naming that person', /Kabir/.test(await text(a, '#reportWho')));
await a.check('input[name="reason"][value="harassment"]');
await a.click('#reportSubmit');
await a.waitForTimeout(500);
const rep = (await a.evaluate(() => window.__reports || []))[0];
step('6b. the report names the person and the room', rep && rep.reason === 'harassment' && /^local-cricket-voice$/.test(rep.roomId) && typeof rep.partnerId === 'string', JSON.stringify(rep || {}));
step('6c. reporting from a room does not throw you into a search', (await a.evaluate(() => window.__t.S.phase)) === 'idle' && await a.isVisible('#groupRoom'));

// leaving
await c.click('#groupLeave');
await a.waitForFunction(() => document.querySelectorAll('#groupGrid .g-tile').length === 2, null, { timeout: 8000 }).catch(() => {});
await b.waitForFunction(() => document.querySelectorAll('#groupGrid .g-tile').length === 2, null, { timeout: 8000 }).catch(() => {});
step('7a. when someone leaves, their tile disappears for everyone', await tiles(a) === 2 && await tiles(b) === 2 && await c.isVisible('#groupLobby'));
await c.click('#groupBack');
step('7b. Back returns to the start screen', await c.isVisible('#welcome') && !(await c.isVisible('#groups')));
step('7c. the camera and microphone were released', await c.evaluate(() => window.__t.S.localStream === null));

// closing the tab without leaving
await b.close();
await a.waitForFunction(() => document.querySelectorAll('#groupGrid .g-tile').length === 1, null, { timeout: 10000 }).catch(() => {});
step('8a. someone who closes the tab is removed (goodbye signal or missed heartbeats)', await tiles(a) === 1, String(await tiles(a)));

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
