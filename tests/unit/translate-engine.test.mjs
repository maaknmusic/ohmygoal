// Unit tests for the client-side Live translate engine (js/translate.js): queue, cache, de-duplication, time-outs, the hidden
// tab, limit errors, the on-device provider (with fake Translator / LanguageDetector objects) and the validation of chat
// messages that come from the other side. No browser, no network. Run: node --test tests/unit/translate-engine.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    createEngine, createDeviceProvider, TranslateError, classifyError, parseChatMessage, worthTranslating, cleanOutput,
    MAX_TEXT, MAX_ORIG, MAX_PENDING, TIMEOUT_MS, ERROR_TEXT,
} from '../../js/translate.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cp = n => String.fromCodePoint(n);
const kind = p => p.then(() => 'resolved', e => e.kind);

/** A cloud provider that records calls and answers with a deterministic "translation". */
function fakeCloud({ delay = 0, fail = null, source = 'hi' } = {}) {
    const calls = [];
    let active = 0, maxActive = 0;
    const fn = async req => {
        calls.push(req);
        active++; maxActive = Math.max(maxActive, active);
        try {
            if (delay) await sleep(delay);
            if (typeof fail === 'function') { const e = fail(req, calls.length); if (e) throw e; }
            return { text: `${req.target}:${req.text}`, source, target: req.target, same: false };
        } finally { active--; }
    };
    fn.calls = calls;
    Object.defineProperty(fn, 'maxActive', { get: () => maxActive });
    return fn;
}
const fnError = (code, message = '') => Object.assign(new Error(message || code), { code: 'functions/' + code });

describe('basics', () => {
    test('a request goes to the cloud and comes back in the agreed shape', async () => {
        const cloud = fakeCloud();
        const e = createEngine({ cloud });
        const r = await e.translate({ text: '  नमस्ते  ', target: 'en' });
        assert.deepEqual(r, { text: 'en:नमस्ते', source: 'hi', target: 'en', same: false, via: 'cloud' });
        assert.deepEqual(cloud.calls, [{ text: 'नमस्ते', target: 'en', source: 'auto' }], 'trimmed text, source defaults to auto');
    });
    test('same=true comes back with the original text and no translation', async () => {
        const e = createEngine({ cloud: async () => ({ text: 'ignored', source: 'en', target: 'en', same: true }) });
        const r = await e.translate({ text: 'hello', target: 'en' });
        assert.equal(r.same, true);
        assert.equal(r.text, 'hello');
    });
    test('no provider at all: unavailable', async () => {
        const e = createEngine({});
        assert.equal(e.hasCloud, false);
        assert.equal(e.hasDevice, false);
        assert.equal(await kind(e.translate({ text: 'hello', target: 'hi' })), 'unavailable');
    });
    test('bad input is refused before any provider is asked', async () => {
        const cloud = fakeCloud();
        const e = createEngine({ cloud });
        for (const bad of [
            { text: '', target: 'en' }, { text: '   ', target: 'en' }, { text: 5, target: 'en' }, { text: null, target: 'en' },
            { text: 'hi', target: 'xx' }, { text: 'hi', target: 'auto' }, { text: 'hi', target: 'EN' }, { text: 'hi', target: '__proto__' },
            { text: 'hi', target: 'en', source: 'xx' }, { text: 'hi', target: 'en', source: ['en'] },
        ]) assert.equal(await kind(e.translate(bad)), 'invalid', JSON.stringify(bad));
        assert.equal(await kind(e.translate({ text: 'x'.repeat(MAX_TEXT + 1), target: 'en' })), 'toolong');
        assert.equal(await kind(e.translate()), 'invalid');
        assert.equal(cloud.calls.length, 0);
        await e.translate({ text: 'x'.repeat(MAX_TEXT), target: 'en' }); // exactly at the limit is fine
        assert.equal(cloud.calls.length, 1);
    });
    test('an explicit source language is passed on, a bad answer shape is "unavailable"', async () => {
        const cloud = fakeCloud();
        const e = createEngine({ cloud });
        await e.translate({ text: 'hola', target: 'en', source: 'es' });
        assert.equal(cloud.calls[0].source, 'es');
        for (const answer of [null, undefined, {}, { text: 5 }, { text: '' }, { text: '   ' }, { text: 'x'.repeat(5000) }, 'text', []]) {
            const e2 = createEngine({ cloud: async () => answer });
            assert.equal(await kind(e2.translate({ text: 'hello', target: 'hi' })), 'unavailable', JSON.stringify(answer)?.slice(0, 40));
        }
    });
    test('a source code outside our list in the answer becomes "" and control / bidi characters are stripped', async () => {
        const e = createEngine({ cloud: async () => ({ text: `a${cp(0x202E)}b${cp(0)}c${cp(0x200B)}d${cp(0x2028)}e`, source: 'klingon', target: 'hi', same: false }) });
        const r = await e.translate({ text: 'hello', target: 'hi' });
        assert.equal(r.source, '');
        assert.equal(r.text, 'abcd e');
    });
    test('cleanOutput keeps ZWJ / ZWNJ / newlines / emoji and drops the dangerous ones', () => {
        assert.equal(cleanOutput(`  a${cp(0x200C)}b${cp(0x200D)}c\nd\te 👨‍👩‍👧${cp(0x2066)}${cp(0x2069)}${cp(0xFEFF)}  `), `a${cp(0x200C)}b${cp(0x200D)}c\nd\te 👨‍👩‍👧`);
        assert.equal(cleanOutput(`${cp(0x202A)}x${cp(0x202C)}${cp(7)}${cp(0x9F)}`), 'x');
    });
});

describe('cache and de-duplication', () => {
    test('the same text for the same target is asked once; another target is a new question', async () => {
        const cloud = fakeCloud();
        const e = createEngine({ cloud });
        const a = await e.translate({ text: 'hello', target: 'hi' });
        const b = await e.translate({ text: 'hello', target: 'hi' });
        const c = await e.translate({ text: 'hello', target: 'ta' });
        assert.equal(a.via, 'cloud');
        assert.equal(b.via, 'cache');
        assert.equal(b.text, a.text);
        assert.equal(c.text, 'ta:hello');
        assert.equal(cloud.calls.length, 2);
    });
    test('requests that are in flight together share one call', async () => {
        const cloud = fakeCloud({ delay: 30 });
        const e = createEngine({ cloud });
        const [a, b, c] = await Promise.all([1, 2, 3].map(() => e.translate({ text: 'same', target: 'hi' })));
        assert.equal(cloud.calls.length, 1);
        assert.equal(a.text, b.text);
        assert.equal(b.text, c.text);
        assert.equal(e.pending, 0);
    });
    test('the cache is small: the oldest entries go first', async () => {
        const cloud = fakeCloud();
        const e = createEngine({ cloud, cacheSize: 3 });
        for (const t of ['a1', 'b2', 'c3', 'd4']) await e.translate({ text: t, target: 'hi' });
        await e.translate({ text: 'd4', target: 'hi' });
        assert.equal(cloud.calls.length, 4, 'd4 is still cached');
        await e.translate({ text: 'a1', target: 'hi' });
        assert.equal(cloud.calls.length, 5, 'a1 was evicted');
    });
    test('reset() forgets cached translations (a new chat starts)', async () => {
        const cloud = fakeCloud();
        const e = createEngine({ cloud });
        await e.translate({ text: 'hello', target: 'hi' });
        e.reset();
        const r = await e.translate({ text: 'hello', target: 'hi' });
        assert.equal(r.via, 'cloud');
        assert.equal(cloud.calls.length, 2);
    });
    test('a failure is not cached: the next try asks again', async () => {
        let n = 0;
        const cloud = fakeCloud({ fail: () => (++n === 1 ? fnError('unavailable') : null) });
        const e = createEngine({ cloud });
        assert.equal(await kind(e.translate({ text: 'hello', target: 'hi' })), 'unavailable');
        const r = await e.translate({ text: 'hello', target: 'hi' });
        assert.equal(r.via, 'cloud');
    });
});

describe('the queue', () => {
    test('one request at a time, in the order they came', async () => {
        const cloud = fakeCloud({ delay: 5 });
        const e = createEngine({ cloud });
        const done = [];
        await Promise.all(['m1', 'm2', 'm3', 'm4'].map(t => e.translate({ text: t, target: 'hi' }).then(r => done.push(r.text))));
        assert.deepEqual(done, ['hi:m1', 'hi:m2', 'hi:m3', 'hi:m4']);
        assert.equal(cloud.maxActive, 1);
    });
    test(`at most ${MAX_PENDING} wait: the next one is turned away ("busy"), and room opens up as they finish`, async () => {
        assert.equal(MAX_PENDING, 8);
        const cloud = fakeCloud({ delay: 20 });
        const e = createEngine({ cloud });
        const all = Array.from({ length: 10 }, (_, i) => e.translate({ text: `msg ${i}`, target: 'hi' }));
        const outcomes = await Promise.all(all.map(kind));
        assert.deepEqual(outcomes.slice(0, 8), Array(8).fill('resolved'));
        assert.deepEqual(outcomes.slice(8), ['busy', 'busy']);
        assert.equal(cloud.calls.length, 8);
        assert.equal(await kind(e.translate({ text: 'later', target: 'hi' })), 'resolved');
    });
    test('priority "high" (what you are sending) goes ahead of waiting messages and is never turned away', async () => {
        const cloud = fakeCloud({ delay: 15 });
        const e = createEngine({ cloud, maxPending: 3 });
        const order = [];
        const a = e.translate({ text: 'in1', target: 'hi' }).then(() => order.push('in1'));
        const b = e.translate({ text: 'in2', target: 'hi' }).then(() => order.push('in2'));
        const c = e.translate({ text: 'in3', target: 'hi' }).then(() => order.push('in3'));
        assert.equal(await kind(e.translate({ text: 'in4', target: 'hi' })), 'busy');
        const out = e.translate({ text: 'mine', target: 'ta', priority: 'high' }).then(() => order.push('mine'));
        const out2 = e.translate({ text: 'mine2', target: 'ta', priority: 'high' }).then(() => order.push('mine2'));
        await Promise.all([a, b, c, out, out2]);
        assert.deepEqual(order, ['in1', 'mine', 'mine2', 'in2', 'in3'], 'the one already running finishes, then the high ones in order');
    });
    test('pending counts the running request and the waiting ones', async () => {
        const e = createEngine({ cloud: fakeCloud({ delay: 20 }) });
        const ps = ['x1', 'x2', 'x3'].map(t => e.translate({ text: t, target: 'hi' }));
        assert.equal(e.pending, 3);
        await Promise.all(ps);
        assert.equal(e.pending, 0);
    });
});

describe('time-out, reset and the hidden tab', () => {
    test('a provider that never answers times out; the queue moves on', async () => {
        assert.equal(TIMEOUT_MS, 10000);
        let first = true;
        const e = createEngine({ timeoutMs: 40, cloud: req => (first && (first = false, true) ? new Promise(() => {}) : Promise.resolve({ text: 'ok:' + req.text, source: 'hi', target: req.target, same: false })) });
        const slow = e.translate({ text: 'slow', target: 'en' });
        const next = e.translate({ text: 'next', target: 'en' });
        assert.equal(await kind(slow), 'timeout');
        assert.equal((await next).text, 'ok:next');
        assert.equal(e.pending, 0);
    });
    test('reset() cancels what is waiting and what is running', async () => {
        const e = createEngine({ cloud: fakeCloud({ delay: 60 }) });
        const run = e.translate({ text: 'running', target: 'hi' });
        const wait = e.translate({ text: 'waiting', target: 'hi' });
        await sleep(5);
        e.reset();
        assert.equal(await kind(run), 'cancelled');
        assert.equal(await kind(wait), 'cancelled');
        assert.equal(e.pending, 0);
        assert.equal((await e.translate({ text: 'fresh', target: 'hi' })).text, 'hi:fresh', 'works again afterwards');
    });
    test('nothing is sent while the tab is hidden; it all goes when the tab comes back', async () => {
        let visible = false;
        let wake = null;
        const cloud = fakeCloud();
        const e = createEngine({ cloud, isVisible: () => visible, onVisible: cb => { wake = cb; return () => {}; } });
        const p1 = e.translate({ text: 'one', target: 'hi' });
        const p2 = e.translate({ text: 'two', target: 'hi' });
        await sleep(30);
        assert.equal(cloud.calls.length, 0, 'hidden: not a single request');
        assert.equal(e.pending, 2);
        visible = true; wake();
        const rs = await Promise.all([p1, p2]);
        assert.deepEqual(rs.map(r => r.text), ['hi:one', 'hi:two']);
        assert.equal(cloud.calls.length, 2);
    });
    test('the time-out only starts when a request starts, not while the tab is hidden', async () => {
        let visible = false, wake = null;
        const e = createEngine({ cloud: fakeCloud(), timeoutMs: 20, isVisible: () => visible, onVisible: cb => { wake = cb; return () => {}; } });
        const p = e.translate({ text: 'patient', target: 'hi' });
        await sleep(80);
        visible = true; wake();
        assert.equal((await p).text, 'hi:patient');
    });
    test('dispose() cancels everything and refuses new work', async () => {
        const e = createEngine({ cloud: fakeCloud({ delay: 30 }) });
        const p = e.translate({ text: 'x1', target: 'hi' });
        e.dispose();
        assert.equal(await kind(p), 'cancelled');
        assert.equal(await kind(e.translate({ text: 'x2', target: 'hi' })), 'cancelled');
    });
});

describe('errors from the server', () => {
    test('callable error codes map to kinds, with the texts the server uses', () => {
        const k = e => classifyError(e).kind;
        assert.equal(k(fnError('failed-precondition', 'Live translate is a Premium feature.')), 'premium');
        assert.equal(k(fnError('unauthenticated')), 'auth');
        assert.equal(k(fnError('permission-denied')), 'auth');
        assert.equal(k(fnError('resource-exhausted', 'Too many translations. Try again in a moment.')), 'quota-minute');
        assert.equal(k(fnError('resource-exhausted', 'Daily translation limit reached.')), 'quota-day');
        assert.equal(k(fnError('invalid-argument')), 'invalid');
        assert.equal(k(fnError('unavailable', 'Translation is unavailable right now.')), 'unavailable');
        assert.equal(k(fnError('internal')), 'unavailable');
        assert.equal(k(new TypeError('Failed to fetch')), 'unavailable');
        assert.equal(k({ code: 'resource-exhausted', message: 'Daily limit' }), 'quota-day', 'codes without the functions/ prefix work too');
        const own = new TranslateError('timeout');
        assert.equal(classifyError(own), own);
        for (const key of Object.keys(ERROR_TEXT)) assert.ok(new TranslateError(key).message.length > 5);
    });
    test('after a limit error the server is left alone for a while (no hammering), and tried again afterwards', async () => {
        let t = 1000;
        const cloud = fakeCloud({ fail: (req, n) => (n === 1 ? fnError('resource-exhausted', 'Too many translations. Try again in a moment.') : null) });
        const e = createEngine({ cloud, now: () => t });
        assert.equal(await kind(e.translate({ text: 'one', target: 'hi' })), 'quota-minute');
        assert.equal(await kind(e.translate({ text: 'two', target: 'hi' })), 'quota-minute');
        assert.equal(cloud.calls.length, 1, 'the second request never reached the server');
        assert.equal(e.blocked.kind, 'quota-minute');
        t += 21000;
        assert.equal(e.blocked.until, 0);
        assert.equal((await e.translate({ text: 'two', target: 'hi' })).text, 'hi:two');
        assert.equal(cloud.calls.length, 2);
    });
    test('the daily limit blocks for an hour', async () => {
        let t = 0;
        const cloud = fakeCloud({ fail: () => fnError('resource-exhausted', 'Daily translation limit reached.') });
        const e = createEngine({ cloud, now: () => t });
        assert.equal(await kind(e.translate({ text: 'one', target: 'hi' })), 'quota-day');
        t += 30 * 60000;
        assert.equal(await kind(e.translate({ text: 'two', target: 'hi' })), 'quota-day');
        assert.equal(cloud.calls.length, 1);
        t += 31 * 60000;
        assert.equal(await kind(e.translate({ text: 'three', target: 'hi' })), 'quota-day');
        assert.equal(cloud.calls.length, 2, 'asked again after the hour');
    });
    test('premium / auth errors are passed on (the UI turns Live translate off); other errors are not blocking', async () => {
        const e = createEngine({ cloud: fakeCloud({ fail: () => fnError('failed-precondition', 'Live translate is a Premium feature.') }) });
        assert.equal(await kind(e.translate({ text: 'one', target: 'hi' })), 'premium');
        assert.equal(await kind(e.translate({ text: 'two', target: 'hi' })), 'premium');
        assert.equal(e.blocked.until, 0);
    });
});

/** A fake on-device provider with the same surface as createDeviceProvider(). */
function fakeDevice({ detect = () => ({ lang: 'hi', confidence: 0.9 }), availability = () => 'available', translate = (t, s, g) => `dev[${s}>${g}]${t}` } = {}) {
    const log = { detect: 0, availability: 0, translate: 0, prepare: [] };
    return {
        log,
        async detect(t) { log.detect++; return detect(t); },
        async availability(s, g) { log.availability++; return availability(s, g); },
        async translate(t, s, g) { log.translate++; return translate(t, s, g); },
        async prepare(s, g) { log.prepare.push(`${s}>${g}`); return 'downloading'; },
        dispose() { log.disposed = true; },
    };
}

describe('on-device first', () => {
    test('when the browser can translate the pair, nothing goes to the server', async () => {
        const cloud = fakeCloud();
        const device = fakeDevice();
        const e = createEngine({ cloud, device });
        const r = await e.translate({ text: 'नमस्ते', target: 'en' });
        assert.deepEqual(r, { text: 'dev[hi>en]नमस्ते', source: 'hi', target: 'en', same: false, via: 'device' });
        assert.equal(cloud.calls.length, 0);
    });
    test('a message already in the target language is not translated at all (same=true, no provider call)', async () => {
        const cloud = fakeCloud();
        const device = fakeDevice({ detect: () => ({ lang: 'en', confidence: 0.99 }) });
        const e = createEngine({ cloud, device });
        const r = await e.translate({ text: 'hello there', target: 'en' });
        assert.equal(r.same, true);
        assert.equal(r.via, 'device');
        assert.equal(device.log.translate, 0);
        assert.equal(cloud.calls.length, 0);
    });
    test('an unsure or unknown detection goes to the server (which detects the language itself)', async () => {
        for (const detect of [() => ({ lang: 'hi', confidence: 0.2 }), () => ({ lang: '', confidence: 0.99 }), () => null]) {
            const cloud = fakeCloud();
            const e = createEngine({ cloud, device: fakeDevice({ detect }) });
            const r = await e.translate({ text: 'kaise ho', target: 'en' });
            assert.equal(r.via, 'cloud');
            assert.equal(cloud.calls.length, 1);
        }
    });
    test('a model that still has to be downloaded: this message goes to the server, the download is started for the next', async () => {
        const cloud = fakeCloud();
        const device = fakeDevice({ availability: () => 'downloadable' });
        const e = createEngine({ cloud, device });
        const r = await e.translate({ text: 'नमस्ते', target: 'en' });
        assert.equal(r.via, 'cloud');
        assert.deepEqual(device.log.prepare, ['hi>en']);
    });
    test('an unsupported pair, a failing device and an empty device answer all fall back to the server', async () => {
        for (const device of [
            fakeDevice({ availability: () => 'unavailable' }),
            fakeDevice({ translate: () => { throw new Error('boom'); } }),
            fakeDevice({ translate: () => '   ' }),
            fakeDevice({ translate: () => 'x'.repeat(5000) }),
            fakeDevice({ detect: () => { throw new Error('detector crashed'); } }),
            fakeDevice({ availability: () => { throw new Error('no'); } }),
        ]) {
            const cloud = fakeCloud();
            const e = createEngine({ cloud, device });
            const r = await e.translate({ text: 'नमस्ते', target: 'en' });
            assert.equal(r.via, 'cloud');
        }
    });
    test('with the on-device engine only (no server), a language it cannot do is "unavailable"', async () => {
        const e = createEngine({ device: fakeDevice({ availability: () => 'unavailable' }) });
        assert.equal(await kind(e.translate({ text: 'नमस्ते', target: 'en' })), 'unavailable');
    });
    test('a known source skips detection', async () => {
        const device = fakeDevice({ detect: () => { throw new Error('should not be asked'); } });
        const e = createEngine({ device });
        const r = await e.translate({ text: 'hola', target: 'en', source: 'es' });
        assert.equal(r.text, 'dev[es>en]hola');
        assert.equal(device.log.detect, 0);
    });
    test('warm() asks the device to prepare a pair, and only for two different valid languages', async () => {
        const device = fakeDevice();
        const e = createEngine({ device });
        await e.warm('hi', 'en');
        await e.warm('hi', 'hi');
        await e.warm('xx', 'en');
        assert.deepEqual(device.log.prepare, ['hi>en']);
        assert.equal(await createEngine({}).warm('hi', 'en'), 'unavailable');
    });
    test('dispose() releases the device', () => {
        const device = fakeDevice();
        createEngine({ device }).dispose();
        assert.equal(device.log.disposed, true);
    });
});

/** Fake Chrome built-ins: a global object carrying Translator / LanguageDetector. */
function fakeBrowser({ pairs = { 'hi>en': 'available' }, detected = [{ detectedLanguage: 'hi', confidence: 0.97 }], detectorAvailability = 'available', active = true, tags = null } = {}) {
    const log = { created: [], translated: [], availability: [], detectorCreated: 0, destroyed: 0 };
    class Translator {
        static async availability(o) {
            log.availability.push(`${o.sourceLanguage}>${o.targetLanguage}`);
            if (tags && !(tags.includes(o.sourceLanguage) && tags.includes(o.targetLanguage))) throw new RangeError('unsupported language tag');
            return pairs[`${o.sourceLanguage}>${o.targetLanguage}`] || 'unavailable';
        }
        static async create(o) {
            const t = new Translator();
            t.o = o;
            log.created.push(`${o.sourceLanguage}>${o.targetLanguage}`);
            const listeners = [];
            o.monitor?.({ addEventListener: (n, f) => listeners.push([n, f]) });
            for (const [, f] of listeners) { f({ loaded: 0.25 }); f({ loaded: 1 }); }
            return t;
        }
        async translate(text) { log.translated.push(text); return `T(${this.o.sourceLanguage}>${this.o.targetLanguage}):${text}`; }
        destroy() { log.destroyed++; }
    }
    class LanguageDetector {
        static async availability() { return detectorAvailability; }
        static async create() { log.detectorCreated++; return new LanguageDetector(); }
        async detect() { return detected; }
        destroy() { log.destroyed++; }
    }
    return { g: { Translator, LanguageDetector, navigator: { userActivation: { isActive: active } } }, log };
}

describe('createDeviceProvider (feature detection and the browser APIs)', () => {
    test('null when the browser has neither API; partial support still works', () => {
        assert.equal(createDeviceProvider({}), null);
        assert.equal(createDeviceProvider(undefined), null);
        assert.equal(createDeviceProvider({ Translator: {} }), null, 'an object without create/availability is not an API');
        const d = createDeviceProvider({ LanguageDetector: fakeBrowser().g.LanguageDetector });
        assert.equal(d.canDetect, true);
        assert.equal(d.canTranslate, false);
    });
    test('translates through one cached Translator per language pair', async () => {
        const { g, log } = fakeBrowser();
        const d = createDeviceProvider(g);
        assert.equal(await d.availability('hi', 'en'), 'available');
        assert.equal(await d.translate('नमस्ते', 'hi', 'en'), 'T(hi>en):नमस्ते');
        await d.translate('दूसरा', 'hi', 'en');
        assert.deepEqual(log.created, ['hi>en'], 'created once');
        assert.deepEqual(log.translated, ['नमस्ते', 'दूसरा']);
        assert.equal(await d.availability('en', 'hi'), 'unavailable');
        assert.equal(d.status('hi', 'en').state, 'ready');
        assert.equal(d.status('en', 'hi').state, 'unavailable');
        assert.equal(d.status('fr', 'de').state, 'idle');
    });
    test('detect() maps the browser\'s tags to our codes; romanised and unknown languages are "" (the server decides)', async () => {
        for (const [tag, want] of [['hi', 'hi'], ['en', 'en'], ['zh-Hant', 'zh-TW'], ['he', 'he'], ['iw', 'he'], ['no', 'nb'], ['tl', 'fil'], ['hi-Latn', ''], ['sr', ''], ['und', '']]) {
            const { g } = fakeBrowser({ detected: [{ detectedLanguage: tag, confidence: 0.8 }] });
            const r = await createDeviceProvider(g).detect('x');
            assert.equal(r.lang, want, tag);
            assert.equal(r.confidence, 0.8);
        }
        const none = createDeviceProvider(fakeBrowser({ detected: [] }).g);
        assert.equal(await none.detect('x'), null);
        const junk = createDeviceProvider(fakeBrowser({ detected: [{ confidence: 1 }] }).g);
        assert.equal(await junk.detect('x'), null);
    });
    test('the language detector is not downloaded without a tap', async () => {
        const quiet = fakeBrowser({ detectorAvailability: 'downloadable', active: false });
        assert.equal(await createDeviceProvider(quiet.g).detect('x'), null);
        assert.equal(quiet.log.detectorCreated, 0);
        const tapped = fakeBrowser({ detectorAvailability: 'downloadable', active: true });
        assert.equal((await createDeviceProvider(tapped.g).detect('x')).lang, 'hi');
        const gone = fakeBrowser({ detectorAvailability: 'unavailable' });
        assert.equal(await createDeviceProvider(gone.g).detect('x'), null);
    });
    test('prepare() starts the download only after a tap and reports progress', async () => {
        const quiet = fakeBrowser({ pairs: { 'hi>en': 'downloadable' }, active: false });
        const dq = createDeviceProvider(quiet.g);
        assert.equal(await dq.prepare('hi', 'en'), 'downloadable');
        assert.deepEqual(quiet.log.created, []);
        const tapped = fakeBrowser({ pairs: { 'hi>en': 'downloadable' }, active: true });
        const d = createDeviceProvider(tapped.g);
        let changes = 0;
        d.onChange(() => changes++);
        assert.equal(await d.prepare('hi', 'en'), 'available');
        assert.deepEqual(tapped.log.created, ['hi>en']);
        assert.ok(changes >= 2, 'progress events reach the UI');
        assert.equal(d.status('hi', 'en').state, 'ready');
        assert.equal(await d.availability('hi', 'en'), 'available');
        assert.equal(await createDeviceProvider(fakeBrowser({ pairs: {} }).g).prepare('hi', 'en'), 'unavailable');
    });
    test('a language the browser spells differently is found under its other tag (he/iw, fil/tl, zh-TW/zh-Hant, nb/no)', async () => {
        const he = fakeBrowser({ pairs: { 'iw>en': 'available' }, tags: ['iw', 'en'] });
        const d = createDeviceProvider(he.g);
        assert.equal(await d.availability('he', 'en'), 'available');
        assert.equal(await d.translate('שלום', 'he', 'en'), 'T(iw>en):שלום');
        const zh = createDeviceProvider(fakeBrowser({ pairs: { 'en>zh-Hant': 'available' } }).g);
        assert.equal(await zh.availability('en', 'zh-TW'), 'available');
        const nb = createDeviceProvider(fakeBrowser({ pairs: { 'en>no': 'available' } }).g);
        assert.equal(await nb.availability('en', 'nb'), 'available');
    });
    test('an API that throws is "unavailable", never an exception out of availability()', async () => {
        const g = { Translator: { availability: async () => { throw new Error('nope'); }, create: async () => { throw new Error('nope'); } } };
        const d = createDeviceProvider(g);
        assert.equal(await d.availability('hi', 'en'), 'unavailable');
        assert.equal(await d.prepare('hi', 'en'), 'unavailable');
    });
    test('dispose() destroys what it made', async () => {
        const { g, log } = fakeBrowser();
        const d = createDeviceProvider(g);
        await d.translate('x', 'hi', 'en');
        await d.detect('x');
        d.dispose();
        assert.equal(log.destroyed, 2);
    });
    test('end to end: the engine on top of the browser built-ins', async () => {
        const { g, log } = fakeBrowser();
        const cloud = fakeCloud();
        const e = createEngine({ cloud, device: createDeviceProvider(g) });
        const r = await e.translate({ text: 'नमस्ते', target: 'en' });
        assert.equal(r.via, 'device');
        assert.equal(r.text, 'T(hi>en):नमस्ते');
        assert.equal(cloud.calls.length, 0);
        assert.equal(log.translated.length, 1);
    });
});

describe('chat messages from the other side', () => {
    test('a plain message', () => {
        assert.deepEqual(parseChatMessage({ t: 'msg', text: 'hello' }), { text: 'hello', orig: '', olang: '' });
    });
    test('a translated message carries its original and the original\'s language', () => {
        assert.deepEqual(parseChatMessage({ t: 'msg', text: 'Hello', orig: 'नमस्ते', olang: 'hi' }), { text: 'Hello', orig: 'नमस्ते', olang: 'hi' });
        assert.deepEqual(parseChatMessage({ t: 'msg', text: 'Hello', orig: 'Hola', olang: 'zh-TW' }).olang, 'zh-TW');
    });
    test('text must be a non-empty string; everything else is dropped', () => {
        for (const bad of [null, undefined, 5, 'x', [], {}, { t: 'msg' }, { text: 5 }, { text: null }, { text: {} }, { text: ['a'] }, { text: '' }, { text: '   \n' }, { text: true }]) {
            assert.equal(parseChatMessage(bad), null, JSON.stringify(bad));
        }
    });
    test(`text and original are cut at ${MAX_ORIG} characters`, () => {
        const m = parseChatMessage({ text: 'a'.repeat(6000), orig: 'b'.repeat(6000), olang: 'hi' });
        assert.equal(m.text.length, MAX_ORIG);
        assert.equal(m.orig.length, MAX_ORIG);
    });
    test('hostile orig / olang values: the original is dropped, the message itself stays', () => {
        const hostile = [
            { orig: 'x', olang: undefined }, { orig: 'x', olang: '' }, { orig: 'x', olang: 'xx' }, { orig: 'x', olang: 'EN' }, { orig: 'x', olang: 'zh-tw' },
            { orig: 'x', olang: 'auto' }, { orig: 'x', olang: '__proto__' }, { orig: 'x', olang: 'constructor' }, { orig: 'x', olang: ['en'] }, { orig: 'x', olang: { a: 1 } },
            { orig: 'x', olang: 5 }, { orig: 'x', olang: null }, { orig: 'x', olang: 'en ' }, { orig: 'x', olang: '<img src=x onerror=alert(1)>' },
            { orig: 5, olang: 'en' }, { orig: null, olang: 'en' }, { orig: ['x'], olang: 'en' }, { orig: { toString: () => 'x' }, olang: 'en' }, { orig: '', olang: 'en' }, { orig: '   ', olang: 'en' },
            { orig: 'same', olang: 'en', text: 'same' },
        ];
        for (const extra of hostile) {
            const m = parseChatMessage({ t: 'msg', text: 'same', ...extra });
            assert.ok(m, JSON.stringify(extra));
            assert.equal(m.text, 'same');
            assert.equal(m.orig, '', JSON.stringify(extra));
            assert.equal(m.olang, '', JSON.stringify(extra));
        }
    });
    test('unknown fields are ignored, and the result never carries them', () => {
        const m = parseChatMessage({ text: 'hi', orig: 'नमस्ते', olang: 'hi', evil: '<script>', __proto__: { text: 'proto' } });
        assert.deepEqual(Object.keys(m).sort(), ['olang', 'orig', 'text']);
    });
});

describe('worthTranslating', () => {
    test('words yes; emoji, numbers, a lone letter or a bare link no', () => {
        for (const yes of ['hello', 'ok', 'नमस्ते', 'こ', '你', '안', 'how are you? 😀', 'visit https://example.com today']) assert.equal(worthTranslating(yes), true, yes);
        for (const no of ['', ' ', '😀😀', '12345', '+91 98765 43210', 'k', '!!!', 'https://example.com/a/b', 'www.example.com', 5, null, undefined, {}, ['hello']]) assert.equal(worthTranslating(no), false, String(no));
    });
});
