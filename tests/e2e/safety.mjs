// Visible safety: the 18+ chip, reporting one message (with its text), the repeat-flag card, the safety sheet.
// Local demo mode (two tabs of one browser context match each other).
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const src = fs.readFileSync('/home/user/ohmygoal/js/app.js', 'utf8');
const appSrc = src + '\nwindow.__t = { S, sendData };\n';
// A page that does not say it is age-checked (a client that skips the check, or an old version)
const NO_AGE = "...(AGE.enabled && ageVerified() ? { age: 'checked' } : {})";
if (!src.includes(NO_AGE)) throw new Error('hello no longer carries the age field the way this test expects');
const appNoAge = appSrc.replace(NO_AGE, '');
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };

async function setup(mode = 'text', bSrc = appSrc) {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
  await ctx.route('**/js/app.js', r => r.fulfill({ body: appSrc, contentType: 'text/javascript' }));
  await ctx.route(/jsdelivr|country\.is|fonts\.g/, r => r.abort());
  await ctx.addInitScript(m => {
    localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5));
    localStorage.setItem('ac.mode', JSON.stringify(m));
  }, mode);
  const logs = [];
  const open = async (name, own) => {
    const p = await ctx.newPage();
    if (own) await p.route('**/js/app.js', r => r.fulfill({ body: own, contentType: 'text/javascript' }));
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => logs.push(`${name}|${m.text()}`));
    await p.goto('http://localhost:8765/index.html');
    await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 15000 });
    await p.fill('#nickInput', name); await p.check('#ageCheck');
    return p;
  };
  return { ctx, open, logs };
}
const live = p => p.waitForFunction(() => !document.getElementById('msgInput').disabled, null, { timeout: 15000 }).then(() => true, () => false);
const text = (p, sel) => p.textContent(sel).then(t => t || '');
const connect = async (a, b) => { await a.click('#startBtn'); await b.click('#startBtn'); return (await live(a)) && (await live(b)); };
const raw = (p, frames) => p.evaluate(fr => { const dc = window.__t.S.session.dc; for (const f of fr) dc.send(typeof f === 'string' ? f : JSON.stringify(f)); }, frames);

// ------------------------------------------------------------- 1. the 18+ chip
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera', appNoAge);
  step('1a. match', await connect(a, b));
  await a.waitForTimeout(400);
  step('1b. the person whose device did not report an age check shows no chip to the other side', !(await a.isVisible('#partnerAge')));
  step('1c. a person whose device ran the check shows the chip to the other side', await b.isVisible('#partnerAge'));
  const title = await b.getAttribute('#partnerAge', 'title');
  step('1d. the chip says what it means (an estimate, not ID)', /on-device age check/.test(title) && /not an ID check/.test(title), title);
  step('1e. the match card says it too', /18\+ checked on their device/.test(await text(b, '.match-card')));
  await ctx.close();
}
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera');
  step('1f. match', await connect(a, b));
  step('1g. both sides show it when both ran the check', await a.isVisible('#partnerAge') && await b.isVisible('#partnerAge'));
  await a.click('#nextBtn'); await a.click('#nextBtn');
  await a.waitForTimeout(500);
  step('1h. the chip clears when the chat ends', !(await a.isVisible('#partnerAge')));
  await ctx.close();
}
{
  // only the exact word counts, whatever a modified client sends
  const { ctx, open } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera', appNoAge);
  await connect(a, b);
  await a.waitForTimeout(300);
  step('1i. no chip when the age field is missing', !(await a.isVisible('#partnerAge')));
  await ctx.close();
}

// ------------------------------------------------------------- 2. report one message
{
  const { ctx, open, logs } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera');
  step('2a. match', await connect(a, b));
  await a.evaluate(() => { const t = window.__t.S.transport; const orig = t.report; t.report = async p => { (window.__reports ||= []).push(p); return orig(p); }; });
  await raw(b, [{ t: 'msg', text: 'you are <b>ugly</b> & stupid ' + 'x'.repeat(400) }]);
  await a.waitForSelector('.msg.them .msg-report', { timeout: 5000 }).catch(() => {});
  step('2b. a message from the other person has a Report link; your own has none', await a.locator('.msg.them .msg-report').count() === 1 && await a.locator('.msg.me .msg-report').count() === 0);
  await a.locator('.msg.them .msg-report').click({ force: true });
  await a.waitForSelector('#reportModal:not(.hidden)', { timeout: 3000 }).catch(() => {});
  const ev = await text(a, '#reportEvidence');
  step('2c. the sheet shows exactly what will be sent, as plain text', /sent to moderators with your report/.test(ev) && ev.includes('<b>ugly</b>') && (await a.locator('#reportEvidence b').count()) === 0, ev.slice(0, 120));
  step('2d. the reason is preselected as harassment', await a.isChecked('input[name="reason"][value="harassment"]'));
  await a.click('#reportSubmit');
  await a.waitForTimeout(600);
  const rep = (await a.evaluate(() => window.__reports || []))[0];
  step('2e. the report carries the message text, cut to 300 characters, with the harassment reason', Boolean(rep) && rep.reason === 'harassment' && typeof rep.evidence === 'string' && rep.evidence.length === 300 && rep.evidence.startsWith('you are <b>ugly</b>'), JSON.stringify(rep || {}).slice(0, 120));
  await ctx.close();
}
{
  // a normal report has no evidence and goes back to the default reason
  const { ctx, open, logs } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera');
  await connect(a, b);
  await a.click('#reportBtn');
  await a.waitForSelector('#reportModal:not(.hidden)');
  step('2f. a plain report shows no evidence line and the default reason', !(await a.isVisible('#reportEvidence')) && await a.isChecked('input[name="reason"][value="sexual"]'));
  await ctx.close();
}

// ------------------------------------------------------------- 3. repeat flags
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera');
  step('3a. match', await connect(a, b));
  await raw(b, [{ t: 'msg', text: 'hello there' }, { t: 'msg', text: 'how are you' }]);
  await a.waitForTimeout(400);
  step('3b. friendly messages never raise the card', await a.locator('.flag-card').count() === 0);
  await raw(b, [{ t: 'msg', text: 'send me money on gpay 9876543210' }, { t: 'msg', text: 'you are a bitch' }]);
  await a.waitForTimeout(400);
  step('3c. two flagged messages are not enough', await a.locator('.flag-card').count() === 0);
  await raw(b, [{ t: 'msg', text: 'dm me on whatsapp 9123456789' }]);
  await a.waitForSelector('.flag-card', { timeout: 4000 }).catch(() => {});
  step('3d. the third flagged message offers to skip or report', await a.locator('.flag-card').count() === 1 && /Report & skip/.test(await text(a, '.flag-card')) && /Keep chatting/.test(await text(a, '.flag-card')));
  await raw(b, [{ t: 'msg', text: 'also fuck you' }, { t: 'msg', text: 'and another upi me@ybl' }]);
  await a.waitForTimeout(400);
  step('3e. it is offered once per chat', await a.locator('.flag-card').count() === 1);
  await a.click('.flag-card >> text=Keep chatting');
  step('3f. "Keep chatting" dismisses it and the chat goes on', await a.locator('.flag-card').count() === 0 && (await a.evaluate(() => window.__t.S.phase)) === 'connected');
  await ctx.close();
}
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav'), b = await open('Meera');
  await connect(a, b);
  await raw(b, [{ t: 'msg', text: 'ur an idiot, call 9876501234' }, { t: 'msg', text: 'pay me on gpay 9123456780' }, { t: 'msg', text: 'text me on telegram 9000000001' }]);
  await a.waitForSelector('.flag-card', { timeout: 4000 }).catch(() => {});
  await a.click('.flag-card >> text=Report & skip');
  await a.waitForSelector('#reportModal:not(.hidden)', { timeout: 3000 }).catch(() => {});
  step('3g. "Report & skip" opens the report sheet with that message attached', /sent to moderators/.test(await text(a, '#reportEvidence')));
  await ctx.close();
}

// ------------------------------------------------------------- 4. the safety sheet
{
  const { ctx, open } = await setup('text');
  const a = await open('Aarav');
  await a.click('#startBtn');
  await a.click('#menuBtn');
  await a.click('#menuSheet [data-sheet-open="safetySheet"]');
  await a.waitForSelector('#safetySheet:not(.hidden)', { timeout: 3000 }).catch(() => {});
  const t = await text(a, '#safetySheet');
  step('4a. the safety sheet explains the 18+ chip and single-message reports', /✓ 18\+/.test(t) && /not ID verification/.test(t) && /Report a single message/.test(t), t.slice(0, 80));
  await ctx.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
