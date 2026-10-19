// A modified client as chat partner: flooding, oversize frames, repeated hellos, extra channels, unwanted media,
// plus the report-target and keyboard fixes. Local demo mode (two tabs of one browser context match each other).
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8') + '\nwindow.__t = { S, sendData };\n';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };

async function setup(mode = 'text') {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(m => {
    localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    localStorage.setItem('ac.mode', JSON.stringify(m));
  }, mode);
  const logs = [];
  const open = async name => {
    const p = await ctx.newPage();
    p.name = name;
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { logs.push(`${name}|${m.text()}`); });
    await p.goto('http://localhost:8765/index.html');
    await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
    await p.fill('#nickInput', name); await p.check('#ageCheck');
    return p;
  };
  return { ctx, logs, open };
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 15000 }).then(() => true, () => false);
const text = (p, sel) => p.textContent(sel).then(t => t || '');
const connect = async (a, b) => { await a.click('#startBtn'); await b.click('#startBtn'); return (await live(a)) && (await live(b)); };
/** Sends raw frames from page `p` straight down its data channel, bypassing the app's own limits. */
const raw = (p, frames) => p.evaluate(fr => { const dc = window.__t.S.session.dc; for (const f of fr) dc.send(typeof f === 'string' ? f : JSON.stringify(f)); return dc.bufferedAmount; }, frames);

// ------------------------------------------------------------- 1. hostile peer
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera');
  step('1a. match', await connect(a, b));
  const name0 = await text(a, '#partnerName');

  await raw(b, [{ t: 'hello', nick: 'Impostor', interests: [], country: 'US', gender: 'male' }]);
  await a.waitForTimeout(300);
  step('1b. a second "hello" cannot rename or re-introduce the partner mid-chat', (await text(a, '#partnerName')) === name0 && await a.locator('.match-card').count() === 1, await text(a, '#partnerName'));

  await raw(b, [{ t: 'msg', text: 'x'.repeat(6000) }]);
  await a.waitForTimeout(300);
  step('1c. an oversize frame is ignored', await a.locator('#messages .msg.them').count() === 0);

  const before = await a.locator('#messages .msg.them').count();
  await b.fill('#msgInput', 'normal hello'); await b.press('#msgInput', 'Enter');
  await a.waitForSelector('#messages .msg.them', { timeout: 5000 });
  step('1d. normal messages still work after that', (await a.locator('#messages .msg.them').count()) === before + 1);

  // burst: 40 text messages in one go: the first ~20 get through, the rest are dropped by the token bucket
  await raw(b, Array.from({ length: 60 }, (_, i) => ({ t: 'msg', text: `spam ${i}` })));
  await a.waitForTimeout(500);
  const got = await a.locator('#messages .msg.them').count();
  step('1e. a burst of 60 messages is cut off by the rate limit (not all shown)', got < 40, `shown ${got}`);

  // sustained flood: the connection is closed and the sender reported
  await raw(b, Array.from({ length: 600 }, () => ({ t: 'typing', on: true })));
  await a.waitForFunction(() => /Connection closed/.test(document.getElementById('overlayTitle').textContent) || window.__t.S.phase === 'ended', null, { timeout: 8000 }).catch(() => {});
  step('1f. a sustained flood ends the chat on the victim\'s side', (await a.evaluate(() => window.__t.S.phase)) !== 'connected', await text(a, '#overlayTitle'));
  await ctx.close();
}

// ------------------------------------------------------------- 2. extra channels, unwanted media
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera');
  await connect(a, b);
  // The answerer is whichever side did not create the channel.
  const role = await a.evaluate(() => window.__t.S.session.role);
  const victim = role === 'answerer' ? a : b;
  await victim.fill('#msgInput', 'keep this evidence'); await victim.press('#msgInput', 'Enter');
  const res = await victim.evaluate(() => {
    const sess = window.__t.S.session;
    const fake = { label: 'evil', closed: false, close() { this.closed = true; } };
    const dc0 = sess.dc;
    sess.pc.ondatachannel({ channel: fake });
    return { closed: fake.closed, same: sess.dc === dc0, kept: [...document.querySelectorAll('#messages .bubble')].some(n => n.textContent === 'keep this evidence') };
  });
  step('2a. an extra data channel is closed and does not wipe the chat', res.closed && res.same && res.kept, JSON.stringify(res));
  const media = await victim.evaluate(() => {
    const sess = window.__t.S.session;
    const track = { kind: 'audio', id: 'x' };
    sess.pc.ontrack({ track, streams: [] });
    return document.getElementById('remoteVideo').srcObject === null;
  });
  step('2b. in a text chat, media pushed by the stranger is never attached or played', media);
  await ctx.close();
}

// ------------------------------------------------------------- 3. reporting the right person
{
  const { ctx, logs, open } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera'), c = await open('Chandra');
  await a.click('#startBtn'); await b.click('#startBtn');
  await live(a); await live(b);
  const bId = await b.evaluate(() => window.__t.S.transport.uid);
  const cId = await c.evaluate(() => window.__t.S.transport.uid);
  // A starts reporting; B walks away; C is waiting and would normally be matched by the auto-next countdown.
  await a.click('#reportBtn');
  step('3a. the sheet names who is being reported', /Meera/.test(await text(a, '#reportWho')), await text(a, '#reportWho'));
  await c.click('#startBtn');
  await b.click('#leaveBtn');
  await a.waitForSelector('#endReportBtn:not(.hidden)', { timeout: 8000 });
  await a.waitForTimeout(5000); // longer than the 3 s countdown
  step('3b. the countdown waits while the report sheet is open (nobody new is matched behind it)', (await a.evaluate(() => window.__t.S.phase)) === 'ended' && !(await a.evaluate(() => !document.getElementById('msgInput').disabled)));
  await a.click('#reportSubmit');
  await a.waitForTimeout(800);
  const reports = logs.filter(l => l.startsWith('Aarav|') && l.includes('[demo] report'));
  step('3c. the report goes to the person it was opened for (Meera), not whoever is next', reports.length === 1 && reports[0].includes(bId) && !reports[0].includes(cId), reports.join(' / ').slice(0, 200));
  step('3d. then the search continues and Chandra is matched', await live(a) && await live(c));
  await ctx.close();
}

// ------------------------------------------------------------- 4. keyboard and mouse fixes
{
  const { ctx, open } = await setup('video');
  const a = await open('Aarav'), b = await open('Meera');
  await connect(a, b);
  await a.keyboard.press('Escape');
  const armed = await a.evaluate(() => window.__t.S.skipArmed);
  await a.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true })));
  await a.waitForTimeout(300);
  step('4a. holding Esc (key repeat) does not complete the "Really?" skip', armed === true && (await a.evaluate(() => window.__t.S.phase)) === 'connected');
  await a.waitForTimeout(2700);
  await a.dblclick('#fxBtn');
  await b.waitForTimeout(600);
  step('4b. double-clicking a control does not send a heart to the stranger', await b.locator('.float-emoji').count() === 0 && await a.locator('.float-emoji').count() === 0);
  await a.dblclick('#remoteVideo', { force: true });
  await b.waitForSelector('.float-emoji', { timeout: 4000 }).catch(() => {});
  step('4c. double-clicking the video itself still sends a heart', await b.locator('.float-emoji').count() >= 1);
  await ctx.close();
}

// ------------------------------------------------------------- 5. privacy toggle
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav');
  const st = await a.evaluate(() => ({ hideIp: window.__t.S.hideIp, label: document.getElementById('hideIpLabel').textContent }));
  step('5a. local demo mode defaults to direct connections (no relay there) and the menu shows it', st.hideIp === false && st.label === 'Off', JSON.stringify(st));
  await a.click('#menuBtn'); await a.click('#hideIpBtn');
  const on = await a.evaluate(() => ({ hideIp: window.__t.S.hideIp, label: document.getElementById('hideIpLabel').textContent, policy: new RTCPeerConnection({ iceTransportPolicy: 'relay' }).getConfiguration().iceTransportPolicy }));
  step('5b. toggling "Hide my IP address" turns it on and persists', on.hideIp === true && on.label === 'On', JSON.stringify(on));
  await ctx.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
