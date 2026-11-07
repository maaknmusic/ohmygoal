// Builds the search pages (plain HTML, readable without JavaScript, fast) and sitemap.xml from tools/seo/pages-*.mjs.
//   node tools/seo/build.mjs        (run after editing a page; the output is committed, Firebase Hosting serves it as is)
// Every page: its own title and description, canonical URL, Open Graph card, JSON-LD (WebPage, BreadcrumbList, FAQPage), links to
// the other pages, and a button into the app (in the page's language). The language pages are alternates of the home page
// (hreflang both ways, x-default = home); the English topic pages stand on their own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPICS } from './pages-en.mjs';
import { LANGS } from './pages-langs.mjs';

export const SITE = 'https://ohmygoal.app';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OG_IMAGE = `${SITE}/icons/og-card.png`;
const RTL = new Set(['ar']);

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Body text may hold a few inline tags written in the page files (<b>, <a href="/...">); everything else is escaped by the page author.
const rich = s => String(s);
const url = slug => `${SITE}/${slug ? slug + '/' : ''}`;

/** The hreflang cluster: the home page (English) and every language page. */
export function alternates() {
    return [{ lang: 'en', href: url('') }, ...LANGS.map(p => ({ lang: p.lang, href: url(p.slug) })), { lang: 'x-default', href: url('') }];
}

function jsonLd(page) {
    const graph = [
        {
            '@type': 'WebPage', '@id': url(page.slug) + '#page', url: url(page.slug), name: page.title, description: page.description,
            inLanguage: page.lang, isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': `${SITE}/#app` }, dateModified: page.updated,
        },
        {
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'OhMyGoal', item: url('') },
                { '@type': 'ListItem', position: 2, name: page.crumb || page.h1, item: url(page.slug) },
            ],
        },
    ];
    if (page.faq?.length) {
        graph.push({
            '@type': 'FAQPage', '@id': url(page.slug) + '#faq', inLanguage: page.lang,
            mainEntity: page.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '') } })),
        });
    }
    return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

function section(s) {
    const parts = [`<h2>${esc(s.h)}</h2>`];
    for (const p of s.p || []) parts.push(`<p>${rich(p)}</p>`);
    if (s.list) parts.push(`<ul>${s.list.map(li => `<li>${rich(li)}</li>`).join('')}</ul>`);
    if (s.steps) parts.push(`<ol>${s.steps.map(li => `<li>${rich(li)}</li>`).join('')}</ol>`);
    for (const p of s.after || []) parts.push(`<p>${rich(p)}</p>`);
    return `<section>${parts.join('\n')}</section>`;
}

export function render(page, { inCluster }) {
    const ui = page.ui;
    const appHref = `/?lang=${page.lang}`;
    const head = [
        '<!DOCTYPE html>',
        `<html lang="${page.lang}"${RTL.has(page.lang) ? ' dir="rtl"' : ''} data-theme="dark">`,
        '<head>',
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        `<title>${esc(page.title)}</title>`,
        `<meta name="description" content="${esc(page.description)}">`,
        `<link rel="canonical" href="${url(page.slug)}">`,
        ...(inCluster ? alternates().map(a => `<link rel="alternate" hreflang="${a.lang}" href="${a.href}">`) : []),
        '<meta name="theme-color" content="#090a12">',
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="OhMyGoal">',
        `<meta property="og:url" content="${url(page.slug)}">`,
        `<meta property="og:title" content="${esc(page.title)}">`,
        `<meta property="og:description" content="${esc(page.description)}">`,
        `<meta property="og:image" content="${OG_IMAGE}">`,
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        `<meta property="og:locale" content="${page.ogLocale}">`,
        '<meta name="twitter:card" content="summary_large_image">',
        '<link rel="icon" href="/icons/icon-192.png" type="image/png">',
        '<link rel="apple-touch-icon" href="/icons/icon-192.png">',
        '<link rel="manifest" href="/manifest.webmanifest">',
        "<script>try{var t=JSON.parse(localStorage.getItem('ac.theme'));document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')}catch(e){}</script>",
        '<link rel="stylesheet" href="/css/seo.css">',
        `<script type="application/ld+json">${jsonLd(page)}</script>`,
        '</head>',
    ];
    const related = [...TOPICS, ...LANGS].filter(p => p.slug !== page.slug);
    const topicLinks = TOPICS.filter(p => p.slug !== page.slug).map(p => `<a href="/${p.slug}/" lang="en">${esc(p.crumb)}</a>`).join('');
    const langLinks = [`<a href="/" lang="en" hreflang="en">English</a>`, ...LANGS.filter(p => p.slug !== page.slug).map(p => `<a href="/${p.slug}/" lang="${p.lang}" hreflang="${p.lang}">${esc(p.native)}</a>`)].join('');
    void related;
    const body = [
        '<body>',
        '<header class="top"><div class="wrap top-in">',
        `<a class="brand" href="/" aria-label="OhMyGoal home"><img src="/icons/icon-192.png" alt="" width="32" height="32">OhMyGoal</a>`,
        `<a class="btn btn-sm" href="${appHref}">${esc(ui.start)}</a>`,
        '</div></header>',
        '<main class="wrap">',
        `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">OhMyGoal</a><span aria-hidden="true">›</span><span>${esc(page.crumb || page.h1)}</span></nav>`,
        '<div class="hero">',
        `<h1>${esc(page.h1)}</h1>`,
        `<p class="lede">${rich(page.lede)}</p>`,
        `<p class="cta-row"><a class="btn" href="${appHref}">${esc(ui.start)} →</a><span class="note">${esc(ui.note)}</span></p>`,
        '</div>',
        ...(page.points ? [`<ul class="points">${page.points.map(([t, d]) => `<li><b>${esc(t)}</b><span>${rich(d)}</span></li>`).join('')}</ul>`] : []),
        ...page.sections.map(section),
        ...(page.faq?.length ? [`<section class="faq"><h2>${esc(ui.faq)}</h2>${page.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${rich(a)}</p></details>`).join('')}</section>`] : []),
        `<div class="cta-end"><p>${esc(ui.ready)}</p><a class="btn" href="${appHref}">${esc(ui.start)} →</a></div>`,
        `<nav class="more" aria-label="${esc(ui.more)}"><h2>${esc(ui.more)}</h2><div class="links">${topicLinks}</div><h2>${esc(ui.languages)}</h2><div class="links">${langLinks}</div></nav>`,
        '</main>',
        '<footer class="foot"><div class="wrap">',
        `<p>${esc(ui.footer)}</p>`,
        `<p class="foot-links"><a href="/legal.html#terms">${esc(ui.terms)}</a><a href="/legal.html#privacy">${esc(ui.privacy)}</a><a href="/legal.html#contact">${esc(ui.contact)}</a><a href="/safe-video-chat/" lang="en">Safety guide</a></p>`,
        `<p class="help">${rich(ui.help)}</p>`,
        '</div></footer>',
        '</body>',
        '</html>',
    ];
    return head.join('\n') + '\n' + body.join('\n') + '\n';
}

export function sitemap(pages, today) {
    const alt = alternates();
    const entry = (loc, lastmod, withAlt) => [
        '  <url>', `    <loc>${loc}</loc>`, `    <lastmod>${lastmod}</lastmod>`,
        ...(withAlt ? alt.map(a => `    <xhtml:link rel="alternate" hreflang="${a.lang}" href="${a.href}"/>`) : []),
        '  </url>',
    ].join('\n');
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
        entry(url(''), today, true),
        ...LANGS.map(p => entry(url(p.slug), p.updated, true)),
        ...TOPICS.map(p => entry(url(p.slug), p.updated, false)),
        entry(`${SITE}/legal.html`, today, false),
        '</urlset>',
        '',
    ].join('\n');
}

export const ALL = () => [...TOPICS.map(p => ({ page: p, inCluster: false })), ...LANGS.map(p => ({ page: p, inCluster: true }))];

/** The FAQ of the home page, read from index.html, so its structured data always matches what people see. */
export function homeFaq(html) {
    const sec = html.slice(html.indexOf('class="lp-faq'), html.indexOf('</div>', html.indexOf('class="lp-faq')));
    const out = [];
    const re = /<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g;
    for (let m; (m = re.exec(sec));) out.push([m[1].trim(), m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()]);
    return out;
}

/** The generated parts of index.html: hreflang alternates and JSON-LD in <head>, and the language links in the footer. */
export function homeBlocks(html) {
    const ld = {
        '@context': 'https://schema.org',
        '@graph': [
            { '@type': 'WebSite', '@id': `${SITE}/#website`, url: url(''), name: 'OhMyGoal', inLanguage: ['en', ...LANGS.map(p => p.lang)] },
            { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'OhMyGoal', url: url(''), logo: `${SITE}/icons/icon-512.png`, email: 'support@ohmygoal.app' },
            {
                '@type': 'WebApplication', '@id': `${SITE}/#app`, name: 'OhMyGoal', url: url(''), applicationCategory: 'SocialNetworkingApplication',
                operatingSystem: 'Any (web browser)', browserRequirements: 'Requires a modern browser with WebRTC', isAccessibleForFree: true,
                description: 'Random video, voice and text chat with strangers. Free, no sign-up, age-checked on your device, nudity blurred, never recorded. 18+ only.',
                offers: [{ '@type': 'Offer', price: '0', priceCurrency: 'INR', description: 'Chatting is free' }],
                publisher: { '@id': `${SITE}/#org` }, image: OG_IMAGE, inLanguage: ['en', ...LANGS.map(p => p.lang)],
            },
            { '@type': 'FAQPage', '@id': `${SITE}/#faq`, mainEntity: homeFaq(html).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
        ],
    };
    const head = [
        '<!-- seo:start (written by tools/seo/build.mjs: language alternates and structured data) -->',
        ...alternates().map(a => `    <link rel="alternate" hreflang="${a.lang}" href="${a.href}">`),
        `    <script type="application/ld+json">${JSON.stringify(ld)}</script>`,
        '    <!-- seo:end -->',
    ].join('\n');
    const langs = '<!-- seo:langs (written by tools/seo/build.mjs) -->' + LANGS.map(p => `<a href="/${p.slug}/" lang="${p.lang}" hreflang="${p.lang}">${esc(p.native)}</a>`).join('') + '<!-- seo:langs-end -->';
    return html
        .replace(/<!-- seo:start[\s\S]*?<!-- seo:end -->/, () => head)
        .replace(/<!-- seo:langs \(written[\s\S]*?<!-- seo:langs-end -->/, () => langs);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const indexPath = path.join(ROOT, 'index.html');
    fs.writeFileSync(indexPath, homeBlocks(fs.readFileSync(indexPath, 'utf8')));
    const today = new Date().toISOString().slice(0, 10);
    for (const { page, inCluster } of ALL()) {
        const dir = path.join(ROOT, page.slug);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'), render(page, { inCluster }));
    }
    fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap(ALL(), today));
    console.log(`built ${ALL().length} pages and sitemap.xml`);
}
