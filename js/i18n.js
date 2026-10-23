// Interface language. English is the source: the page and the app are written in English, and a language file maps exact English
// strings to their translation. The translator walks the page, replaces text it knows, and keeps watching for new text (toasts,
// chat notices, sheets that are built later). Anything it does not know stays in English, so a partly translated language never breaks.
//
// Never translated: what other people wrote (chat bubbles, nicknames, friend names, friend chats) and form fields.
//
// Templates: a key with {} stands for a changing part ("{}-day streak!"). The captured parts are translated too when they are
// themselves known words ("camera", "microphone").

export const UI_LANGS = Object.freeze([
    Object.freeze({ code: 'en', native: 'English' }),
    Object.freeze({ code: 'hi', native: 'हिन्दी' }),
    Object.freeze({ code: 'bn', native: 'বাংলা' }),
    Object.freeze({ code: 'ta', native: 'தமிழ்' }),
    Object.freeze({ code: 'te', native: 'తెలుగు' }),
    Object.freeze({ code: 'mr', native: 'मराठी' }),
    Object.freeze({ code: 'gu', native: 'ગુજરાતી' }),
    Object.freeze({ code: 'kn', native: 'ಕನ್ನಡ' }),
    Object.freeze({ code: 'ml', native: 'മലയാളം' }),
    Object.freeze({ code: 'pa', native: 'ਪੰਜਾਬੀ' }),
]);
const CODES = new Set(UI_LANGS.map(l => l.code));

/** A language code we have a file for, or 'en'. */
export const sanitizeUiLang = v => (typeof v === 'string' && CODES.has(v) ? v : 'en');

/** The best match for the browser's languages ('hi-IN' -> 'hi'), or 'en'. */
export function guessUiLang(list) {
    for (const tag of Array.isArray(list) ? list : []) {
        const base = String(tag).toLowerCase().split('-')[0];
        if (CODES.has(base)) return base;
    }
    return 'en';
}

const FIELDS = 'textarea, input, select, option';
const SKIP = 'script, style, svg, .bubble, .translated, .meta, #fcMessages, .tag, [data-no-i18n], #partnerName, .match-card h4, .speaks, .shared-chips, #nickInput, .fc-item, .friend-name, #friendList';
const ATTRS = ['placeholder', 'title', 'aria-label'];
const norm = s => s.replace(/\s+/g, ' ').trim();
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Builds the lookups for one language file ({ English: translation }). */
export function compile(table) {
    const exact = new Map();
    const patterns = [];
    for (const [k, v] of Object.entries(table || {})) {
        if (typeof k !== 'string' || typeof v !== 'string' || !v) continue;
        if (k.includes('{}')) {
            const parts = k.split('{}').map(escRe);
            patterns.push({ re: new RegExp('^' + parts.join('(.+?)') + '$', 's'), out: v });
        } else exact.set(norm(k), v);
    }
    return { exact, patterns };
}

/** The translation of one string, or the string itself when unknown. Keeps leading and trailing spaces. */
export function translate(c, text) {
    if (!c || typeof text !== 'string') return text;
    const trimmed = norm(text);
    if (!trimmed) return text;
    const lead = text.match(/^\s*/)[0], tail = text.match(/\s*$/)[0];
    const hit = c.exact.get(trimmed);
    if (hit !== undefined) return lead + hit + tail;
    for (const p of c.patterns) {
        const m = p.re.exec(trimmed);
        if (!m) continue;
        let i = 0;
        return lead + p.out.replace(/\{\}/g, () => { const arg = m[++i] ?? ''; return c.exact.get(norm(arg)) ?? arg; }) + tail;
    }
    return text;
}

export function createI18n({ doc = document, loadTable }) {
    let lang = 'en';
    let c = null;
    let observer = null;
    const original = new WeakMap();   // text node -> its English text
    const shown = new WeakMap();      // text node -> the translation we put there (if the text changes to anything else, it is new text)
    const nodes = new Set();          // text nodes we changed (weak enough: pruned when detached)
    const skip = el => !el || el.closest?.(SKIP);
    const skipText = el => skip(el) || el.closest?.(FIELDS); // what is typed or chosen in a field is never translated, but its placeholder and label are

    function textNode(node) {
        if (!c || skipText(node.parentElement)) return;
        const cur = node.nodeValue;
        const orig = original.has(node) && shown.get(node) === cur ? original.get(node) : cur;
        const out = translate(c, orig);
        if (out !== orig) { original.set(node, orig); shown.set(node, out); nodes.add(node); if (cur !== out) node.nodeValue = out; }
    }
    function attrs(el) {
        if (!c || skip(el)) return;
        for (const a of ATTRS) {
            if (!el.hasAttribute?.(a)) continue;
            const key = 'i18nO' + a.replace(/(^|-)(.)/g, (_, __, ch) => ch.toUpperCase());
            const cur = el.getAttribute(a);
            const orig = el.dataset[key] ?? cur;
            const out = translate(c, orig);
            if (out !== orig) { el.dataset[key] = orig; if (cur !== out) el.setAttribute(a, out); }
        }
    }
    function tree(root) {
        if (!c || !root) return;
        if (root.nodeType === 3) return textNode(root);
        if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
        if (root.nodeType === 1 && skip(root)) return;
        const walker = doc.createTreeWalker(root, 4 | 1);
        for (let n = root.nodeType === 1 ? root : walker.nextNode(); n; n = walker.nextNode()) {
            if (n.nodeType === 3) textNode(n); else attrs(n);
        }
    }
    function restore() {
        for (const n of nodes) { const o = original.get(n); if (o !== undefined && n.isConnected && shown.get(n) === n.nodeValue) n.nodeValue = o; }
        nodes.clear();
        doc.querySelectorAll('[data-i18n-o-placeholder], [data-i18n-o-title], [data-i18n-o-aria-label]').forEach(el => {
            for (const a of ATTRS) {
                const key = 'i18nO' + a.replace(/(^|-)(.)/g, (_, __, ch) => ch.toUpperCase());
                if (el.dataset[key] !== undefined) { el.setAttribute(a, el.dataset[key]); delete el.dataset[key]; }
            }
        });
    }
    function watch() {
        observer ||= new MutationObserver(list => {
            for (const m of list) {
                if (m.type === 'childList') m.addedNodes.forEach(tree);
                else if (m.type === 'characterData') { if (shown.get(m.target) !== m.target.nodeValue) textNode(m.target); }
                else if (m.type === 'attributes') attrs(m.target);
            }
        });
        observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }

    return {
        get lang() { return lang; },
        /** Switches the interface language. Resolves to the language that is now showing ('en' if the file could not be loaded). */
        async set(code) {
            code = sanitizeUiLang(code);
            if (code === lang) return lang;
            let table = null;
            if (code !== 'en') {
                try { table = await loadTable(code); } catch (e) { console.warn('language file failed to load', code, e); code = 'en'; }
            }
            observer?.disconnect(); observer = null;
            restore();
            lang = code;
            c = table ? compile(table) : null;
            doc.documentElement.lang = lang;
            if (c) { tree(doc.body); watch(); }
            return lang;
        },
        /** For text built in code: the translation, or the English when there is none (or the language is English). */
        t(text) { return c ? translate(c, text) : text; },
    };
}
