// Video reliability: adaptive quality limits, ICE restart, plain-language failures, camera fallbacks.
// Local demo mode (two tabs of one browser context match each other).
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8') + '\nwindow.__t = { S, sendData, applyVideoTier, restartIce, connectionLost };\n';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };

async function setup(mode = 'video', gumPatch = '') {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(([m, patch]) => {
    localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    localStorage.setItem('ac.mode', JSON.stringify(m));
    if (patch) new Function(patch)();
  }, [mode, gumPatch]);
  const open = async name => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    await p.goto('http://localhost:8765/index.html');
    await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
    await p.fill('#nickInput', name); await p.check('#ageCheck');
    return p;
  };
  return { ctx, open };
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 15000 }).then(() => true, () => false);
const text = (p, sel) => p.textContent(sel).then(t => t || '');
const connect = async (a, b) => { await a.click('#startBtn'); await b.click('#startBtn'); return (await live(a)) && (await live(b)); };
const enc = p => p.evaluate(() => { const e = window.__t.S.session.videoSender().getParameters().encodings[0]; return { maxBitrate: e.maxBitrate, scale: e.scaleResolutionDownBy, fps: e.maxFramerate }; });

// ------------------------------------------------------------- 1. quality limits, restart, failures
{
  const { ctx, open } = await setup('video');
  const a = await open('Aarav'), b = await open('Meera');
  step('1a. video match', await connect(a, b));
  const e0 = await enc(a);
  step('1b. a ceiling of 1.5 Mbit/s is set from the start', e0.maxBitrate === 1500000 && e0.scale === 1 && e0.fps === 30, JSON.stringify(e0));
  await a.waitForFunction(() => /Matched in/.test(document.getElementById('quality').title), null, { timeout: 8000 }).catch(() => {});
  const title = await a.getAttribute('#quality', 'title');
  step('1c. the quality chip reports round-trip time, video tier and the match time', /Round-trip time: \d+ ms/.test(title) && /Video: HD/.test(title) && /Matched in [\d.]+ s/.test(title), title);

  await a.evaluate(() => window.__t.applyVideoTier(window.__t.S.session, 3));
  const e3 = await enc(a);
  step('1d. tier 3 lowers bitrate, size and frame rate', e3.maxBitrate === 200000 && e3.scale === 3 && e3.fps === 15, JSON.stringify(e3));
  step('1e. the person is told once, in the chat', /Slow connection: video quality is lowered a lot/.test(await text(a, '#messages')));
  await a.evaluate(() => window.__t.applyVideoTier(window.__t.S.session, 1));
  const n = (await text(a, '#messages')).match(/Slow connection/g).length;
  step('1f. ... and not again on the next change', n === 1, String(n));
  await a.evaluate(() => window.__t.applyVideoTier(window.__t.S.session, 0));
  step('1g. tier 0 restores the full settings', (await enc(a)).maxBitrate === 1500000);

  // ICE restart: the caller asks for new routes; same call, new credentials
  const roles = await Promise.all([a, b].map(p => p.evaluate(() => window.__t.S.session.role)));
  const [caller, other] = roles[0] === 'offerer' ? [a, b] : [b, a];
  const ufrag = p => p.evaluate(() => window.__t.S.session.pc.localDescription.sdp.match(/a=ice-ufrag:(\S+)/)[1]);
  const before = await ufrag(caller);
  await caller.evaluate(() => window.__t.restartIce(window.__t.S.session));
  await caller.waitForFunction(old => window.__t.S.session.pc.localDescription.sdp.match(/a=ice-ufrag:(\S+)/)[1] !== old && window.__t.S.session.pc.signalingState === 'stable', before, { timeout: 8000 }).catch(() => {});
  const after = await ufrag(caller);
  step('1h. an ICE restart gets new credentials and the call carries on', after !== before && (await caller.evaluate(() => window.__t.S.session.pc.connectionState)) === 'connected', `${before} -> ${after}`);
  step('1i. the other side answered (it has the new credentials too)', await other.evaluate(a2 => window.__t.S.session.pc.remoteDescription.sdp.includes('a=ice-ufrag:' + a2), after));
  await caller.fill('#msgInput', 'still here');
  await caller.press('#msgInput', 'Enter');
  await other.waitForFunction(() => /still here/.test(document.getElementById('messages').textContent), null, { timeout: 8000 }).catch(() => {});
  step('1j. messages still flow after the restart', /still here/.test(await text(other, '#messages')));
  const spam = await caller.evaluate(() => { const s = window.__t.S.session; const before = s.restarts; s.restartAt = 0; window.__t.restartIce(s); s.restartAt = 0; window.__t.restartIce(s); s.restartAt = 0; window.__t.restartIce(s); return [before, s.restarts]; });
  step('1k. restarts are capped at three per chat', spam[1] === 3, JSON.stringify(spam));

  // the offline copy
  await a.evaluate(() => { Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }); window.__t.connectionLost(window.__t.S.session); });
  await a.waitForTimeout(300);
  step('1l. losing the connection while offline says "You’re offline"', /offline/i.test(await text(a, '#overlayTitle')), await text(a, '#overlayTitle'));
  await ctx.close();
}

// ------------------------------------------------------------- 2. never connected
{
  const { ctx, open } = await setup('video');
  const a = await open('Aarav'), b = await open('Meera');
  step('2a. video match', await connect(a, b));
  await a.evaluate(() => { const s = window.__t.S.session; s.opened = false; window.__t.connectionLost(s); });
  await a.waitForTimeout(300);
  step('2b. a connection that never came up says why, without jargon', /Couldn.t connect/.test(await text(a, '#overlayTitle')) && /blocking video calls/.test(await text(a, '#overlaySub')) && !/TURN/.test(await text(a, '#overlaySub')), await text(a, '#overlaySub'));
  await ctx.close();
}

// ------------------------------------------------------------- 3. camera and microphone problems
{
  const blocked = `const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }));`;
  const { ctx, open } = await setup('video', blocked);
  const a = await open('Aarav');
  await a.click('#startBtn');
  await a.waitForFunction(() => /blocked/.test(document.getElementById('toasts').textContent), null, { timeout: 8000 }).catch(() => {});
  const t = await text(a, '#toasts');
  step('3a. a blocked camera says how to unblock it and falls back to text chat', /camera is blocked.*site settings/.test(t) && /text chat/.test(t) && (await a.evaluate(() => window.__t.S.mode)) === 'text', t);
  await ctx.close();
}
{
  const noCam = `const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = c => (c && c.video ? Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' })) : real(c));`;
  const { ctx, open } = await setup('video', noCam);
  const a = await open('Aarav'), b = await open('Meera');
  step('3b. with no camera but a microphone, two people still connect (as a voice chat)', await connect(a, b));
  const modes = await Promise.all([a, b].map(p => p.evaluate(() => window.__t.S.mode)));
  step('3c. both ended up in voice mode, and were told why', modes.join() === 'voice,voice' && /No camera was found.*Switched to voice chat/.test(await text(a, '#toasts')), `${modes} | ${await text(a, '#toasts')}`);
  await ctx.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
