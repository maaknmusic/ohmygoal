// Interface language: lookups, templates, whitespace, what is never translated, and that every language file is sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { UI_LANGS, RTL_LANGS, sanitizeUiLang, guessUiLang, compile, translate } from '/home/user/ohmygoal/js/i18n.js';

const load = async code => (await import(`/home/user/ohmygoal/js/i18n/${code}.js`)).default;

test('language codes: only listed codes, English otherwise', () => {
    assert.deepEqual(UI_LANGS.map(l => l.code), ['en', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'es', 'pt', 'ar', 'id', 'tr', 'ru', 'fr', 'de']);
    assert.ok(Object.isFrozen(UI_LANGS));
    for (const l of UI_LANGS) assert.ok(l.native);
    for (const code of ['hi', 'ta', 'en']) assert.equal(sanitizeUiLang(code), code);
    for (const bad of ['', 'xx', 'HI', 'hi-IN', '__proto__', 'constructor', null, undefined, 5, {}, ['hi']]) assert.equal(sanitizeUiLang(bad), 'en', String(bad));
});

test('the browser language picks the interface language', () => {
    assert.equal(guessUiLang(['hi-IN', 'en-US']), 'hi');
    assert.equal(guessUiLang(['en-US', 'hi']), 'en');
    assert.equal(guessUiLang(['ja-JP', 'ta']), 'ta');
    assert.equal(guessUiLang(['fr-FR']), 'fr');
    assert.equal(guessUiLang(['pt-BR', 'en']), 'pt');
    assert.equal(guessUiLang(['ar-EG']), 'ar');
    assert.equal(guessUiLang(['id-ID']), 'id');
    assert.equal(guessUiLang(['ja-JP', 'de']), 'de');
    assert.equal(guessUiLang(['ja-JP']), 'en');   // a language we do not have yet
    assert.equal(guessUiLang([]), 'en');
    assert.equal(guessUiLang(undefined), 'en');
    assert.equal(guessUiLang('hi'), 'en'); // not a list
});

test('translate: exact match, spacing kept, unknown stays, hostile input is safe', () => {
    const c = compile({ 'Start chatting': 'शुरू करें', 'Next': 'अगला' });
    assert.equal(translate(c, 'Start chatting'), 'शुरू करें');
    assert.equal(translate(c, '  Start   chatting \n'), '  शुरू करें \n');
    assert.equal(translate(c, 'start chatting'), 'start chatting');           // case matters: it is an exact table
    assert.equal(translate(c, 'Start chatting now'), 'Start chatting now');
    assert.equal(translate(c, ''), '');
    assert.equal(translate(c, '   '), '   ');
    assert.equal(translate(c, '__proto__'), '__proto__');
    assert.equal(translate(c, 'constructor'), 'constructor');
    assert.equal(translate(c, 'toString'), 'toString');
    assert.equal(translate(null, 'x'), 'x');
    assert.equal(translate(c, 5), 5);
    assert.equal(translate(c, undefined), undefined);
});

test('compile ignores junk entries, and a key called __proto__ is just a key', () => {
    const c = compile({ ok: 'fine', bad: 5, empty: '', [3]: 'x' });
    assert.equal(translate(c, 'ok'), 'fine');
    assert.equal(translate(c, 'bad'), 'bad');
    assert.equal(translate(c, 'empty'), 'empty');
    assert.equal(compile(null).exact.size, 0);
    assert.equal(compile({ '__proto__': 'x' }).exact.size, 0 + (Object.keys({ '__proto__': 'x' }).length ? 1 : 0));
});

test('templates: {} stands for a changing part, which is itself translated when known', () => {
    const c = compile({ 'Level up: you’re now {}.': 'लेवल अप: अब आप {} हैं।', 'Your {} is blocked.': 'आपका {} ब्लॉक है।', 'camera': 'कैमरा', '{}-day streak!': '{}-दिन की स्ट्रीक!' });
    assert.equal(translate(c, 'Level up: you’re now Regular.'), 'लेवल अप: अब आप Regular हैं।');
    assert.equal(translate(c, 'Your camera is blocked.'), 'आपका कैमरा ब्लॉक है।');
    assert.equal(translate(c, 'Your tent is blocked.'), 'आपका tent ब्लॉक है।');
    assert.equal(translate(c, '12-day streak!'), '12-दिन की स्ट्रीक!');
    // regex characters in a key are literal, not syntax
    const d = compile({ 'Price (₹10) + tax? {}': 'ok {}' });
    assert.equal(translate(d, 'Price (₹10) + tax? 5'), 'ok 5');
    assert.equal(translate(d, 'Price 10 tax 5'), 'Price 10 tax 5');
});

test('every language file is sound: strings only, no empty values, matching {} counts, no markup', async () => {
    for (const { code } of UI_LANGS) {
        if (code === 'en') continue;
        const t = await load(code);
        const entries = Object.entries(t);
        assert.ok(entries.length >= 100, `${code} has ${entries.length}`);
        for (const [k, v] of entries) {
            assert.equal(typeof k, 'string'); assert.equal(typeof v, 'string');
            assert.ok(v.trim().length > 0, `${code}: empty for ${k}`);
            assert.equal(k.split('{}').length, v.split('{}').length, `${code}: {} count differs for "${k}"`);
            assert.ok(!/<[a-z!/]/i.test(v), `${code}: markup in "${v}"`);
        }
    }
});

test('every language file also uses its own script for what it translates', async () => {
    const script = { hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, bn: /[ঀ-৿]/, ta: /[஀-௿]/, te: /[ఀ-౿]/, gu: /[઀-૿]/, kn: /[ಀ-೿]/, ml: /[ഀ-ൿ]/, pa: /[਀-੿]/ };
    for (const [code, re] of Object.entries(script)) {
        const t = await load(code);
        const sample = ['Start chatting', 'Next', 'Report', 'Find someone new', 'Send'].map(k => t[k]);
        for (const v of sample) assert.ok(v && re.test(v), `${code}: "${v}" is not in its script`);
    }
});

test('the other languages carry the same core keys, all taken from Hindi’s full table', async () => {
    const hi = await load('hi');
    const core = Object.keys(await load('bn'));
    for (const code of ['ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa']) assert.deepEqual(Object.keys(await load(code)), core, code);
    const missing = core.filter(k => !(k in hi));
    assert.deepEqual(missing, [], 'core keys that Hindi does not translate: ' + missing.join(' | '));
});

test('Hindi covers the page: every English string in the app’s start card and menus has an entry', async () => {
    const hi = await load('hi');
    for (const k of ['Start chatting', 'Find someone new', 'Block (never match again)', 'Report & skip', 'Send', 'Next', 'Safety & help', 'Hide my IP address', 'Choose a plan']) assert.ok(k in hi, k);
    // the strings the failure and progress modules produce
    const src = ['failures.js', 'progress.js'].map(f => fs.readFileSync(`/home/user/ohmygoal/js/${f}`, 'utf8')).join('\n');
    for (const k of ['Couldn’t connect', 'You’re offline', 'Matching failed', 'Chat for a minute to start a streak.']) { assert.ok(src.includes(k), 'source has ' + k); assert.ok(k in hi, 'Hindi has ' + k); }
});

const WORLD = ['es', 'pt', 'ar', 'id', 'tr', 'ru', 'fr', 'de'];

test('the eight world languages cover exactly the same strings as Hindi, each translated into something different', async () => {
    const hi = await load('hi');
    for (const code of WORLD) {
        const t = await load(code);
        assert.deepEqual(Object.keys(t), Object.keys(hi), `${code}: keys differ from Hindi's table`);
        let same = 0;
        for (const [k, v] of Object.entries(t)) if (v === k) same++;
        assert.ok(same < 120, `${code}: ${same} entries are left in English`); // names, key labels and the like stay as they are
    }
});

test('world languages use their own script, and brand and payment names are never translated away', async () => {
    const script = { ar: /[؀-ۿ]/, ru: /[Ѐ-ӿ]/ };
    for (const [code, re] of Object.entries(script)) {
        const t = await load(code);
        for (const k of ['Start chatting', 'Next', 'Report', 'Find someone new', 'Send']) assert.ok(re.test(t[k]), `${code}: "${t[k]}"`);
    }
    for (const code of WORLD) {
        const t = await load(code);
        for (const [k, v] of Object.entries(t)) {
            for (const word of ['Razorpay', 'UPI', 'OhMyGoal', 'Google', '1930']) if (k.includes(word)) assert.ok(v.includes(word), `${code}: "${word}" lost in "${k.slice(0, 50)}"`);
        }
        // the same fixed amounts survive (formats differ: 349 ₹, ₹5.000)
        for (const [k, v] of Object.entries(t)) for (const n of k.match(/₹\d[\d,]*\d|₹\d/g) || []) assert.ok(v.replace(/[.,\s\u00a0\u202f]/g, '').includes(n.slice(1).replace(/,/g, '')), `${code}: ${n} missing in "${v.slice(0, 60)}"`);
    }
});

test('Arabic is right to left, everything else left to right', () => {
    assert.deepEqual([...RTL_LANGS], ['ar']);
    assert.ok(Object.isFrozen(RTL_LANGS));
});
