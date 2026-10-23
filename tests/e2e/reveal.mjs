// Mutual reveal: both must say yes before anything is shared; cards are plain text; early or hostile messages are ignored.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const appSrc = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8') + '\nwindow.__t = { S, sendData, offerReveal };\n';
const browser = await chromium.launch();
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
async function pair() {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(() => { localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5)); localStorage.setItem('ac.mode', '"text"'); });
  const open = async name => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(name + ': ' + e.message)); await p.goto('http://localhost:8765/index.html'); await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting'); await p.fill('#nickInput', name); await p.check('#ageCheck'); return p; };
  const a = await open('Aarav'), b = await open('Meera');
  await a.click('#startBtn'); await b.click('#startBtn');
  const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 15000 }).then(() => true, () => false);
  const ok = (await live(a)) && (await live(b));
  return { ctx, a, b, ok };
}
const text = (p, sel) => p.textContent(sel).then(t => (t || '').trim());
const raw = (p, frames) => p.evaluate(fr => { const dc = window.__t.S.session.dc; for (const f of fr) dc.send(JSON.stringify(f)); }, frames);
const aged = p => p.evaluate(() => { window.__t.S.session.startedAt -= 11 * 60000; });

{
  const { ctx, a, b, ok } = await pair();
  step('1a. match', ok);
  await a.waitForTimeout(300);
  await raw(b, [{ t: 'reveal', s: 'yes' }]);
  await a.waitForTimeout(400);
  step('1b. a "yes" before ten minutes is ignored', await a.locator('.reveal-card').count() === 0);
  await raw(b, [{ t: 'card', nick: 'Meera', bio: 'hi' }]);
  await a.waitForTimeout(300);
  step('1c. a card nobody agreed to is ignored', await a.locator('.profile-card').count() === 0);
  await aged(a); await aged(b);
  await a.evaluate(() => window.__t.offerReveal(window.__t.S.session));
  step('1d. after ten minutes the offer appears', await a.locator('.reveal-card').count() === 1 && /Swap profiles/.test(await text(a, '.reveal-card')));
  await a.click('.reveal-card >> text=Share profiles');
  await a.waitForSelector('#revealSheet:not(.hidden)');
  await a.fill('#revealBio', 'Pune. <b>Chai</b> over coffee.');
  await a.fill('#revealContact', 'https://t.me/aarav');
  await a.click('#revealShare');
  await a.waitForTimeout(500);
  step('1e. a link is not accepted as a contact (and the person is told)', /doesn.t look like a handle/.test(await text(a, '#toasts')));
  step('1f. after agreeing, A waits', /Waiting for them/.test(await text(a, '.reveal-card')));
  step('1g. B is asked, and told who asked', await b.locator('.reveal-card').count() === 1 && /Aarav would like to swap profiles/.test(await text(b, '.reveal-card')));
  step('1h. nothing is shown while only one has agreed', await a.locator('.profile-card').count() === 0 && await b.locator('.profile-card').count() === 0);
  await b.click('.reveal-card >> text=Share profiles');
  await b.fill('#revealBio', 'Delhi night owl');
  await b.fill('#revealContact', 'meera_k');
  await b.click('#revealShare');
  await a.waitForSelector('.profile-card', { timeout: 5000 }).catch(() => {});
  await b.waitForSelector('.profile-card', { timeout: 5000 }).catch(() => {});
  const ca = await text(a, '.profile-card'), cb = await text(b, '.profile-card');
  step('1i. when both said yes, each sees the other’s card', /Meera/.test(ca) && /Delhi night owl/.test(ca) && /Reach them: meera_k/.test(ca) && /Aarav/.test(cb), ca.slice(0, 100));
  step('1j. text is shown as text, never as markup', /<b>Chai<\/b>/.test(cb) && await b.locator('.profile-card b').count() === 0, cb);
  step('1k. no contact shows when the handle was rejected', !/Reach them/.test(cb));
  await raw(b, [{ t: 'card', nick: 'Impostor', bio: 'second card' }]);
  await a.waitForTimeout(300);
  step('1l. a second card is ignored', await a.locator('.profile-card').count() === 1 && !/Impostor/.test(await text(a, '#messages')));
  await ctx.close();
}
{
  const { ctx, a, b, ok } = await pair();
  step('2a. match', ok);
  await aged(a); await aged(b);
  await a.evaluate(() => window.__t.offerReveal(window.__t.S.session));
  await a.click('.reveal-card >> text=Not now');
  await b.waitForFunction(() => /rather keep chatting/.test(document.getElementById('messages').textContent), null, { timeout: 4000 }).catch(() => {});
  step('2b. "Not now" is passed on kindly and ends the offer', /rather keep chatting/.test(await text(b, '#messages')) && await a.locator('.reveal-card').count() === 0);
  await raw(b, [{ t: 'reveal', s: 'yes' }, { t: 'card', nick: 'Meera' }]);
  await a.waitForTimeout(400);
  step('2c. after a no, nothing more is accepted', await a.locator('.profile-card').count() === 0 && await a.locator('.reveal-card').count() === 0);
  await ctx.close();
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
