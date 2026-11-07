// The search pages in a real browser (local demo mode): every page loads without errors or sideways scroll on a phone, its
// structured data parses, the app button opens the app in the page's language, and the home page links to all of them.
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8').replace(/firebase: \{[\s\S]*?\n    \},/, 'firebase: null,');
const slugs = fs.readdirSync('/home/user/ohmygoal').filter(d => fs.existsSync(`/home/user/ohmygoal/${d}/index.html`) && !['tests', 'tools', 'android', 'functions', 'node_modules'].includes(d));
const browser = await chromium.launch();
const errors = [];
const step = (n, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`);
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, serviceWorkers: 'block' });
await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
await ctx.route(/jsdelivr|country\.is|fonts\.g|googlesyndication/, r => r.abort());
const p = await ctx.newPage();
p.on('pageerror', e => errors.push(p.url() + ' ' + e.message));

// ---- 1. every page on a phone
const bad = [];
for (const s of slugs) {
  const res = await p.goto(`http://localhost:8765/${s}/`);
  const r = await p.evaluate(() => {
    let ld = 0; try { ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(x => JSON.parse(x.textContent)).length; } catch { ld = -1; }
    return { sw: document.documentElement.scrollWidth, iw: innerWidth, h1: document.querySelectorAll('h1').length, ld, cta: document.querySelector('.hero .btn')?.getAttribute('href') };
  });
  if (!res.ok() || r.sw > r.iw || r.h1 !== 1 || r.ld !== 1 || r.cta !== `/?lang=${s.length === 2 ? s : 'en'}`) bad.push({ s, status: res.status(), ...r });
}
step(`1. all ${slugs.length} search pages load, fit a phone, have one h1, valid structured data and the right app button`, slugs.length === 24 && bad.length === 0, JSON.stringify(bad.slice(0, 3)));

// ---- 2. the Hindi page's button opens the app in Hindi, and it stays Hindi on the next visit
await p.goto('http://localhost:8765/hi/');
await p.click('.hero .btn');
await p.waitForFunction(() => document.getElementById('uiLang')?.value === 'hi' && document.getElementById('startBtn')?.textContent !== 'Start chatting', null, { timeout: 15000 }).catch(() => {});
step('2a. "चैट शुरू करें" on /hi/ opens the app in Hindi', await p.evaluate(() => document.getElementById('uiLang').value) === 'hi' && !/^Start chatting$/.test(await p.textContent('#startBtn')), await p.textContent('#startBtn'));
await p.goto('http://localhost:8765/');
await p.waitForTimeout(1500);
step('2b. the choice is remembered on the next visit', await p.evaluate(() => document.getElementById('uiLang').value) === 'hi');
await p.goto('http://localhost:8765/?lang=xx');
await p.waitForTimeout(1500);
step('2c. an unknown ?lang is ignored', await p.evaluate(() => document.getElementById('uiLang').value) === 'hi');
await p.goto('http://localhost:8765/?lang=ta');
await p.waitForFunction(() => document.getElementById('uiLang')?.value === 'ta', null, { timeout: 15000 }).catch(() => {});
step('2d. ?lang=ta switches to Tamil', await p.evaluate(() => document.getElementById('uiLang').value) === 'ta');

// ---- 3. the home page: links to every search page, English names kept in other languages, structured data valid
const home = await p.evaluate(() => ({
  explore: [...document.querySelectorAll('.lp-foot-explore a')].map(a => a.getAttribute('href') + '|' + a.textContent),
  langs: [...document.querySelectorAll('.lp-foot-langs a')].map(a => a.getAttribute('href')),
  ld: JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'].length,
  alts: document.querySelectorAll('link[rel="alternate"][hreflang]').length,
}));
step('3a. the home footer links the 7 topic pages (kept in English) and the 17 language pages', home.explore.length === 7 && home.explore.includes('/omegle-alternative/|Omegle alternative') && home.langs.length === 17, JSON.stringify(home.explore.slice(0, 2)));
step('3b. the home page has its structured data and 19 language alternates', home.ld === 4 && home.alts === 19, JSON.stringify({ ld: home.ld, alts: home.alts }));
step('4. no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
await browser.close();
