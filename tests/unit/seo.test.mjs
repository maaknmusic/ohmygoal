// The search pages (tools/seo/build.mjs): built output up to date, every page complete and unique, language alternates both ways,
// structured data valid, sitemap complete, internal links working.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { render, sitemap, alternates, homeBlocks, homeFaq, ALL, SITE } from '../../tools/seo/build.mjs';
import { TOPICS } from '../../tools/seo/pages-en.mjs';
import { LANGS } from '../../tools/seo/pages-langs.mjs';

const root = new URL('../../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');
const pages = ALL();
const htmlOf = p => read(`${p.slug}/index.html`);
const tag = (html, re) => (html.match(re) || [])[1];
const ldOf = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

test('the committed pages are exactly what the generator builds (run node tools/seo/build.mjs after editing)', () => {
    for (const { page, inCluster } of pages) assert.equal(htmlOf(page), render(page, { inCluster }), `${page.slug}/index.html is out of date`);
    const index = read('index.html');
    assert.equal(homeBlocks(index), index, 'index.html SEO blocks are out of date');
    const today = (read('sitemap.xml').match(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/) || [])[1];
    assert.equal(read('sitemap.xml'), sitemap(pages, today), 'sitemap.xml is out of date');
});

test('35 pages: 18 English topics and one per interface language (17)', () => {
    assert.equal(TOPICS.length, 18);
    const ui = read('js/i18n.js').match(/code: '([a-z]{2})'/g).map(s => s.slice(7, 9)).filter(c => c !== 'en');
    assert.deepEqual(LANGS.map(p => p.lang).sort(), ui.sort(), 'a page for every interface language');
});

test('every page has its own title and description of a sensible length, one h1, canonical to itself', () => {
    const titles = new Set(), descs = new Set();
    for (const { page } of pages) {
        const html = htmlOf(page);
        const title = tag(html, /<title>([^<]+)<\/title>/), desc = tag(html, /<meta name="description" content="([^"]+)">/);
        assert.ok(title && [...title].length <= 80 && /OhMyGoal/.test(title), `${page.slug} title: ${title}`);
        assert.ok(desc && [...desc].length >= 70 && [...desc].length <= 175, `${page.slug} description length ${desc && [...desc].length}`);
        assert.ok(!titles.has(title) && !descs.has(desc), `${page.slug} duplicates another page`);
        titles.add(title); descs.add(desc);
        assert.equal((html.match(/<h1>/g) || []).length, 1, page.slug);
        assert.equal(tag(html, /<link rel="canonical" href="([^"]+)">/), `${SITE}/${page.slug}/`);
        assert.match(html, new RegExp(`<html lang="${page.lang}"`));
        assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
        assert.match(html, /<meta property="og:image" content="https:\/\/ohmygoal\.app\/icons\/og-card\.png">/);
        assert.ok(html.split(/\s+/).length > 300, `${page.slug} has real content`);
    }
    assert.match(read('index.html'), /<title>OhMyGoal – Free Random Video Chat with Strangers \| Omegle Alternative<\/title>/);
});

test('language alternates (hreflang) go both ways: home and every language page list the same full set', () => {
    const expected = alternates().map(a => `<link rel="alternate" hreflang="${a.lang}" href="${a.href}">`);
    assert.equal(expected.length, 1 + LANGS.length + 1);
    assert.ok(expected.some(l => l.includes('hreflang="x-default" href="https://ohmygoal.app/"')));
    for (const p of LANGS) for (const l of expected) assert.ok(htmlOf(p).includes(l), `${p.slug} lacks ${l}`);
    for (const l of expected) assert.ok(read('index.html').includes(l), `index.html lacks ${l}`);
    for (const p of TOPICS) assert.doesNotMatch(htmlOf(p), /<link rel="alternate" hreflang=/, 'topic pages are not part of the language set');
    assert.match(htmlOf(LANGS.find(p => p.lang === 'ar')), /<html lang="ar" dir="rtl"/);
});

test('structured data parses and describes each page; the home FAQ data matches the FAQ on the page', () => {
    for (const { page } of pages) {
        const [ld] = ldOf(htmlOf(page));
        const types = ld['@graph'].map(n => n['@type']);
        assert.deepEqual(types, ['WebPage', 'BreadcrumbList', 'FAQPage'], page.slug);
        assert.equal(ld['@graph'][2].mainEntity.length, page.faq.length);
        for (const q of ld['@graph'][2].mainEntity) assert.ok(q.name && q.acceptedAnswer.text && !/<\w/.test(q.acceptedAnswer.text));
    }
    const index = read('index.html');
    const [home] = ldOf(index);
    assert.deepEqual(home['@graph'].map(n => n['@type']), ['WebSite', 'Organization', 'WebApplication', 'FAQPage']);
    const faq = homeFaq(index);
    assert.ok(faq.length >= 8);
    assert.equal(home['@graph'][3].mainEntity.length, faq.length);
    assert.equal(home['@graph'][3].mainEntity[0].name, 'Is it really free?');
    assert.equal(home['@graph'][2].isAccessibleForFree, true);
});

test('sitemap lists every page once, language pages with their alternates; robots.txt points to it', () => {
    const sm = read('sitemap.xml');
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    assert.equal(new Set(locs).size, locs.length);
    for (const want of [`${SITE}/`, `${SITE}/legal.html`, ...pages.map(({ page }) => `${SITE}/${page.slug}/`)]) assert.ok(locs.includes(want), want);
    assert.match(sm, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
    assert.match(read('robots.txt'), /^Sitemap: https:\/\/ohmygoal\.app\/sitemap\.xml$/m);
});

test('internal links point at pages that exist; the home footer links every page; the app button opens the page language', () => {
    const exists = href => { const p = href.replace(/^\//, '').replace(/#.*$/, ''); return p === '' || fs.existsSync(new URL(p.endsWith('/') ? p + 'index.html' : p, root)); };
    for (const { page } of pages) {
        const html = htmlOf(page);
        for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) if (!href.startsWith('/?')) assert.ok(exists(href), `${page.slug}: ${href}`);
        assert.ok(html.includes(`href="/?lang=${page.lang}"`), `${page.slug} button opens the app in ${page.lang}`);
    }
    const index = read('index.html');
    for (const { page } of pages) assert.ok(index.includes(`href="/${page.slug}/"`), `home links /${page.slug}/`);
    assert.match(index, /class="lp-foot-nav lp-foot-explore" aria-label="Explore" data-no-i18n/);
    const app = read('js/app.js');
    assert.match(app, /new URLSearchParams\(location\.search\)\.get\('lang'\)/);
    assert.match(read('firebase.json'), /"tools\/\*\*"/);
    assert.ok(fs.statSync(new URL('icons/og-card.png', root)).size > 20000);
});

test('comparison pages: a table that scrolls inside its own box, and the sources of every claim about other apps', () => {
    for (const slug of ['sites-like-omegle', 'ometv-alternative', 'monkey-alternative', 'chatroulette-alternative', 'azar-alternative']) {
        const html = read(`${slug}/index.html`);
        assert.match(html, /<div class="table-wrap" role="region" aria-label="[^"]+" tabindex="0"><table>/, slug);
        assert.match(html, /<section class="sources"><h2>Sources<\/h2>/, slug);
        assert.match(html, /Checked in November 2026/, slug);
        assert.match(html, /rel="noopener">/, slug);
    }
    assert.equal((read('sites-like-omegle/index.html').match(/<th scope="col"/g) || []).length, 6, 'all five services in the full table');
    assert.equal((read('ometv-alternative/index.html').match(/<th scope="col"/g) || []).length, 3, 'one service at a time on its own page');
});
