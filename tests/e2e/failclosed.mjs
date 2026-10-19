import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8') + '\nwindow.__t = { S, sendData };\n';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
async function pair(fx) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone', 'geolocation'], geolocation: { latitude: 19.07, longitude: 72.87 }, serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g|storage\.googleapis|mediapipe/, r => r.abort()); // the effect models cannot load
  await ctx.addInitScript(f => { localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5)); localStorage.setItem('ac.mode', JSON.stringify('video')); if (f) localStorage.setItem('ac.fx', JSON.stringify(f)); }, fx);
  const open = async n => { const p = await ctx.newPage(); await p.goto('http://localhost:8765/index.html'); await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 }); await p.fill('#nickInput', n); await p.check('#ageCheck'); return p; };
  return { ctx, a: await open('Aarav'), b: await open('Meera') };
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 25000 }).then(() => true, () => false);
const remoteVideoTracks = p => p.evaluate(() => (document.getElementById('remoteVideo').srcObject?.getVideoTracks().length) || 0);

// 1. a mask is selected but the effect models cannot load: no video is sent (fail closed)
{
  const { ctx, a, b } = await pair({ background: 'none', mask: 'dog', filter: 'none' });
  await a.click('#startBtn'); await b.click('#startBtn');
  step('1a. chat still connects', (await live(a)) && (await live(b)));
  await b.waitForTimeout(2500);
  step('1b. the partner of someone whose mask failed to load receives no video track (never the raw face)', (await remoteVideoTracks(b)) === 0 && (await remoteVideoTracks(a)) === 0, `${await remoteVideoTracks(a)}/${await remoteVideoTracks(b)}`);
  await ctx.close();
}
// 2. no effects: video flows as usual
{
  const { ctx, a, b } = await pair(null);
  await a.click('#startBtn'); await b.click('#startBtn');
  await live(a); await live(b);
  await b.waitForTimeout(2500);
  step('2. without effects both sides receive video', (await remoteVideoTracks(a)) === 1 && (await remoteVideoTracks(b)) === 1, `${await remoteVideoTracks(a)}/${await remoteVideoTracks(b)}`);
  await ctx.close();
}
// 4. choosing a mask in the middle of a chat that then fails to load stops the video (it does not switch to the plain camera)
{
  const { ctx, a, b } = await pair(null);
  await a.click('#startBtn'); await b.click('#startBtn');
  await live(a); await live(b);
  await a.waitForTimeout(1500);
  const before = await a.evaluate(() => window.__t.S.session.pc.getSenders().filter(s => s.track?.kind === 'video').length);
  await a.click('#fxBtn');
  await a.click('#fxPanel .fx-opts[data-kind=mask] button[data-id=dog]');
  await a.waitForFunction(() => /couldn.t load/i.test(document.getElementById('toasts').textContent), null, { timeout: 15000 }).catch(() => {});
  await a.waitForTimeout(800);
  const after = await a.evaluate(() => window.__t.S.session.pc.getSenders().filter(s => s.track?.kind === 'video').length);
  step('4a. mid-chat mask failure: the video sender is emptied (before 1, after 0), matching the on-screen message', before === 1 && after === 0, `${before}->${after}`);
  await a.click('#fxPanel .fx-opts[data-kind=mask] button[data-id=none]');
  await a.waitForTimeout(1500);
  const resumed = await a.evaluate(() => window.__t.S.session.pc.getSenders().filter(s => s.track?.kind === 'video').length);
  step('4b. choosing "None" resumes sending the camera', resumed === 1, String(resumed));
  await ctx.close();
}
// 5. the signalling is never lost when a mask is saved: the chat connects and both sides can talk
{
  const { ctx, a, b } = await pair({ background: 'none', mask: 'dog', filter: 'none' });
  await a.click('#startBtn'); await b.click('#startBtn');
  const ok = (await live(a)) && (await live(b));
  await a.fill('#msgInput', 'hi there'); await a.press('#msgInput', 'Enter');
  await b.waitForSelector('#messages .msg.them', { timeout: 6000 }).catch(() => {});
  step('5. with a saved mask the chat still connects and messages flow (no lost offer)', ok && (await b.locator('#messages .msg.them').count()) === 1);
  await ctx.close();
}
// 3. distance toggled on then off while the position fix is pending stays off
{
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block' });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(() => { localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    navigator.geolocation.getCurrentPosition = ok => setTimeout(() => ok({ coords: { latitude: 19.07, longitude: 72.87, accuracy: 50 }, timestamp: Date.now() }), 1500); });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8765/index.html');
  await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
  await p.click('#prefsBtn'); await p.click('#prefsSheet label:has(#locCheck)'); await p.waitForTimeout(200);
  await p.click('#prefsSheet label:has(#locCheck)'); // off again while the fix is pending
  await p.waitForTimeout(2500);
  const st = await p.evaluate(() => ({ loc: window.__t.S.loc, stored: localStorage.getItem('ac.loc'), checked: document.getElementById('locCheck').checked }));
  step('3. ticking then unticking distance while the fix is pending leaves it off everywhere', st.loc === false && st.stored !== 'true' && st.checked === false, JSON.stringify(st));
  await ctx.close();
}
console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
