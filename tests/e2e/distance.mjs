// Approximate distance between chat partners: opt-in on both sides, coarse bands, nothing sent unless both agree.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8') + '\nwindow.__t = { S, sendData };\n';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
const MUMBAI = { latitude: 19.076, longitude: 72.8777 }, DELHI = { latitude: 28.6139, longitude: 77.209 }, PUNE = { latitude: 18.5204, longitude: 73.8567 };

async function setup(geo = MUMBAI, permissions = ['camera', 'microphone', 'geolocation']) {
  const ctx = await browser.newContext({ permissions, geolocation: geo, serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(() => { localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5)); localStorage.setItem('ac.mode', JSON.stringify('text')); });
  const requests = [];
  ctx.on('request', r => requests.push(r.url() + ' ' + (r.postData() || '')));
  const open = async name => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    await p.goto('http://localhost:8765/index.html');
    await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
    await p.fill('#nickInput', name); await p.check('#ageCheck');
    return p;
  };
  const optIn = async p => { await p.click('#prefsBtn'); await p.click('#prefsSheet label:has(#locCheck)'); await p.waitForTimeout(500); await p.keyboard.press('Escape'); };
  return { ctx, open, optIn, requests };
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 15000 }).then(() => true, () => false);
const text = (p, sel) => p.textContent(sel).then(t => t || '');

// ---------------------------------------------------------- 1. both opt in (Mumbai <-> Delhi)
{
  const { ctx, open, optIn, requests } = await setup(MUMBAI);
  const a = await open('Aarav'), b = await open('Meera');
  await optIn(a);
  step('1a. turning the toggle on asks for the location once and stays on', await a.evaluate(() => window.__t.S.loc) === true);
  await ctx.setGeolocation(DELHI);
  await optIn(b);
  await a.click('#startBtn'); await b.click('#startBtn');
  step('1b. match', (await live(a)) && (await live(b)));
  await a.waitForFunction(() => /📍/.test(document.getElementById('partnerSub').textContent), null, { timeout: 6000 }).catch(() => {});
  const ta = await text(a, '#partnerSub'), tb = await text(b, '#partnerSub');
  step('1c. both see a coarse distance band for Mumbai↔Delhi (about 1,100-1,200 km)', /about 1,[12]00 km away/.test(ta) && /about 1,[12]00 km away/.test(tb), `${ta} | ${tb}`);
  step('1d. the match card shows it too', /📍/.test(await text(a, '.match-card')), await text(a, '.match-card'));
  const ls = await a.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  step('1e. no coordinates or cell are ever written to storage (only the on/off choice)', !/19\.07|72\.87|28\.61|77\.2|"ac\.loc[a-z]*":"?\{/.test(ls) && /"ac\.loc":"true"/.test(ls), ls.slice(0, 160));
  step('1f. nothing location-like is sent to any server', !requests.some(r => /19\.07|72\.87|28\.61|77\.2/.test(r)), '');
  const leak = await a.evaluate(() => { const s = window.__t.S.session; return JSON.stringify({ c: s.partnerCell, d: s.distText }); });
  step('1g. only a grid cell + text are held in memory (no lat/lon)', !/lat|lon/i.test(leak), leak);
  await ctx.close();
}

// ---------------------------------------------------------- 2. one side only
{
  const { ctx, open, optIn } = await setup(MUMBAI);
  const a = await open('Aarav'), b = await open('Meera');
  await optIn(a);
  await a.click('#startBtn'); await b.click('#startBtn');
  await live(a); await live(b);
  await a.waitForTimeout(1200);
  step('2a. the person who opted in is told the other has not', /haven’t turned on distance/.test(await text(a, '.match-card')), await text(a, '.match-card'));
  const got = await b.evaluate(() => { const s = window.__t.S.session; return { cell: s.partnerCell ?? null, d: s.distText ?? null, loc: window.__t.S.loc }; });
  step('2b. the person who did not opt in never receives or shows a location', got.cell === null && got.d === null && got.loc === false, JSON.stringify(got));
  // unsolicited / forged location messages
  await b.evaluate(() => window.__t.sendData({ t: 'loc', x: 3000, y: 2000 }));
  await a.waitForTimeout(300);
  const spoof = await a.evaluate(() => window.__t.S.session.partnerCell ?? null);
  // A opted in but B never offered: a forged cell is still validated, and an in-range cell is accepted (opt-in data), a garbage one is not
  await b.evaluate(() => window.__t.sendData({ t: 'loc', x: 1e9, y: -5 }));
  await b.evaluate(() => window.__t.sendData({ t: 'loc', x: 3000, y: 2000, lat: 1 }));
  await b.evaluate(() => window.__t.sendData({ t: 'loc', x: '3000', y: 2000 }));
  await a.waitForTimeout(300);
  const after = await a.evaluate(() => window.__t.S.session.partnerCell ?? null);
  step('2c. garbage / extra-field / out-of-range location messages are rejected', spoof !== null ? JSON.stringify(after) === JSON.stringify(spoof) : after === null, JSON.stringify({ spoof, after }));
  await ctx.close();
}

// ---------------------------------------------------------- 3. permission denied
{
  const { ctx, open } = await setup(MUMBAI, ['camera', 'microphone']); // geolocation not granted
  const a = await open('Aarav');
  await a.click('#prefsBtn'); await a.click('#prefsSheet label:has(#locCheck)');
  await a.waitForFunction(() => /blocked|find your location|can.t share|too long/i.test(document.getElementById('toasts').textContent), null, { timeout: 12000 }).catch(() => {});
  step('3a. denied location turns the toggle back off with a clear message', (await a.isChecked('#locCheck')) === false && (await a.evaluate(() => window.__t.S.loc)) === false, await text(a, '#toasts'));
  await ctx.close();
}

// ---------------------------------------------------------- 4. nearby
{
  const { ctx, open, optIn } = await setup(MUMBAI);
  const a = await open('Aarav'), b = await open('Meera');
  await optIn(a); await ctx.setGeolocation(PUNE); await optIn(b);
  await a.click('#startBtn'); await b.click('#startBtn');
  await live(a); await live(b);
  await a.waitForFunction(() => /📍/.test(document.getElementById('partnerSub').textContent), null, { timeout: 6000 }).catch(() => {});
  step('4a. Mumbai↔Pune reads as a band (100-250 km), never an exact number', /(100–250 km away|about (1[0-9]{2}|2[0-4][0-9]) km away)/.test(await text(a, '#partnerSub')), await text(a, '#partnerSub'));
  await ctx.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
