// =====================================================================
// Live translate, client engine. No DOM, no globals of its own: everything it talks to is passed in, so it can be
// tested with fakes (tests/unit/translate.test.mjs) and nothing here is a test hook.
//
//   createEngine({ cloud, device })   translate({ text, target, source }) -> { text, source, target, same, via }
//   createDeviceProvider(globalThis)  the browser's on-device Translator / LanguageDetector (Chrome), or null
//
// Order of attempts for every request:
//   1. the in-memory cache (this page only, cleared per chat),
//   2. on the device (free and private: nothing leaves the phone), when the browser has the language pair,
//   3. `cloud`, a function that calls our translateText Cloud Function (Gemini on Vertex AI, text not stored).
// Requests run one at a time, at most MAX_PENDING waiting, never while the tab is hidden, and each attempt gives up
// after TIMEOUT_MS. The same text for the same target is asked once. Nothing here decides *whether* a message may be
// translated: callers only ask after the person turned Live translate on.
// =====================================================================
import { isLang, sanitizeLang, fromTag, toDeviceTags } from './languages.js';

export const MAX_TEXT = 400;       // what translateText accepts (1..400 characters)
export const MAX_ORIG = 500;       // longest chat message (the input's maxlength)
export const MAX_OUT = 1200;       // a translation longer than this is treated as a failure
export const MAX_PENDING = 8;
export const TIMEOUT_MS = 10000;
export const CACHE_SIZE = 200;
export const DETECT_MIN_CONFIDENCE = 0.5;
export const BACKOFF_MS = { 'quota-minute': 20000, 'quota-day': 3600000 };

/** kind: premium | auth | quota-minute | quota-day | invalid | toolong | unavailable | timeout | busy | cancelled | skip */
export class TranslateError extends Error {
    constructor(kind, message = '') {
        super(message || ERROR_TEXT[kind] || 'Translation failed.');
        this.name = 'TranslateError';
        this.kind = kind;
    }
}

export const ERROR_TEXT = Object.freeze({
    premium: 'Live translate is a Premium feature.',
    auth: 'Sign in with Google to use Live translate.',
    'quota-minute': 'Too many translations. Try again in a moment.',
    'quota-day': 'Daily translation limit reached.',
    invalid: 'This message can’t be translated.',
    toolong: `Too long to translate (${MAX_TEXT} characters at most).`,
    unavailable: 'Translation is unavailable right now.',
    timeout: 'Translation took too long.',
    busy: 'Too many messages are waiting to be translated.',
    cancelled: 'Translation cancelled.',
    skip: 'Nothing to translate.',
});

/** Firebase callable errors (code 'functions/...') and our own, as one TranslateError. */
export function classifyError(e) {
    if (e instanceof TranslateError) return e;
    const code = String(e?.code || '').replace(/^functions\//, '');
    switch (code) {
        case 'failed-precondition': return new TranslateError('premium');
        case 'unauthenticated': case 'permission-denied': return new TranslateError('auth');
        case 'resource-exhausted': return new TranslateError(/daily/i.test(String(e?.message || '')) ? 'quota-day' : 'quota-minute');
        case 'invalid-argument': return new TranslateError('invalid');
        default: return new TranslateError('unavailable');
    }
}

// ---------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------
// Control codes, zero-width space, bidi overrides/isolates and the BOM: nothing a translation needs, and the last two can
// make text appear to read differently from what it says. ZWJ/ZWNJ and the direction marks stay (emoji, Persian, Indic).
const NOISE = /[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}\u{200B}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{FEFF}]/gu;
export const cleanOutput = s => String(s).replace(/[\u{2028}\u{2029}]/gu, ' ').replace(NOISE, '').trim();

const URLS = /\b(?:https?:\/\/|www\.)\S+/gi;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTERS = /\p{L}/gu;
/** Does this text have words in it? Emoji, numbers, a bare link or a single letter are not worth a translation. */
export function worthTranslating(text) {
    if (typeof text !== 'string') return false;
    const t = text.replace(URLS, ' ');
    if (CJK.test(t)) return true;
    return (t.match(LETTERS) || []).length >= 2;
}

/**
 * A chat message from the other side, validated. Everything is untrusted: text must be a non-empty string (cut at 500),
 * and the original travels only together with a language code from our list. Returns null when there is nothing to show.
 */
export function parseChatMessage(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.text !== 'string') return null;
    const text = msg.text.slice(0, MAX_ORIG);
    if (!text.trim()) return null;
    let orig = '', olang = '';
    if (typeof msg.orig === 'string' && isLang(msg.olang)) {
        const o = msg.orig.slice(0, MAX_ORIG);
        if (o.trim() && o.trim() !== text.trim()) { orig = o; olang = msg.olang; }
    }
    return { text, orig, olang };
}

// ---------------------------------------------------------------------
// On-device provider (Chrome's built-in Translator and LanguageDetector). Feature-detected; every call is allowed to
// fail, and the engine then asks the server instead.
// ---------------------------------------------------------------------
const hasUserActivation = g => {
    try { return g.navigator?.userActivation ? g.navigator.userActivation.isActive : true; } catch { return false; }
};

export function createDeviceProvider(g = globalThis) {
    const T = g?.Translator, D = g?.LanguageDetector;
    const canTranslate = Boolean(T) && typeof T.create === 'function' && typeof T.availability === 'function';
    const canDetect = Boolean(D) && typeof D.create === 'function';
    if (!canTranslate && !canDetect) return null;

    const pairs = new Map();      // 'hi>en' -> { tags, avail, at, translator, creating, progress }
    let detector = null, detectorBusy = null;
    const listeners = new Set();
    const notify = () => listeners.forEach(fn => { try { fn(); } catch { /* a listener must not break translation */ } });
    const pair = (src, tgt) => {
        const key = `${src}>${tgt}`;
        if (!pairs.has(key)) pairs.set(key, { tags: null, avail: '', at: 0, translator: null, creating: null, progress: 0 });
        return pairs.get(key);
    };

    /** 'available' | 'downloadable' | 'downloading' | 'unavailable' for a language pair. Never throws. */
    async function availability(src, tgt) {
        if (!canTranslate) return 'unavailable';
        const p = pair(src, tgt);
        if (p.translator) return 'available';
        if (p.avail === 'unavailable' && Date.now() - p.at < 5 * 60000) return 'unavailable';
        for (const s of toDeviceTags(src)) {
            for (const t of toDeviceTags(tgt)) {
                try {
                    const a = await T.availability({ sourceLanguage: s, targetLanguage: t });
                    if (a && a !== 'unavailable') { p.tags = [s, t]; p.avail = a; p.at = Date.now(); return a; }
                } catch { /* an unknown tag: try the next spelling */ }
            }
        }
        p.avail = 'unavailable'; p.at = Date.now();
        return 'unavailable';
    }

    /** Make (or reuse) the translator for a pair. `monitor` reports the model download. */
    function getTranslator(src, tgt) {
        const p = pair(src, tgt);
        if (p.translator) return Promise.resolve(p.translator);
        p.creating ||= (async () => {
            const tags = p.tags || [toDeviceTags(src)[0], toDeviceTags(tgt)[0]];
            p.progress = 0;
            const tr = await T.create({
                sourceLanguage: tags[0], targetLanguage: tags[1],
                monitor: m => m?.addEventListener?.('downloadprogress', e => { p.progress = Math.max(0, Math.min(1, Number(e?.loaded) || 0)); notify(); }),
            });
            p.translator = tr; p.avail = 'available'; p.progress = 1;
            notify();
            return tr;
        })().finally(() => { p.creating = null; notify(); });
        return p.creating;
    }

    function getDetector() {
        if (detector) return Promise.resolve(detector);
        detectorBusy ||= (async () => {
            let a = 'available';
            try { a = typeof D.availability === 'function' ? await D.availability() : 'available'; } catch { a = 'unavailable'; }
            if (a === 'unavailable') return null;
            // A model that still has to be downloaded can only be started from a tap; until then the server detects the language.
            if (a !== 'available' && !hasUserActivation(g)) return null;
            detector = await D.create();
            return detector;
        })().catch(() => null).finally(() => { detectorBusy = null; });
        return detectorBusy;
    }

    return {
        canTranslate, canDetect,
        availability,
        /** { lang, confidence } for the most likely language of `text` (lang is '' when it isn't one of ours), or null. */
        async detect(text, signal) {
            if (!canDetect) return null;
            const d = await getDetector();
            if (!d) return null;
            const res = await d.detect(text, signal ? { signal } : undefined);
            const top = Array.isArray(res) ? res[0] : null;
            if (!top || typeof top.detectedLanguage !== 'string') return null;
            return { lang: fromTag(top.detectedLanguage), confidence: Number(top.confidence) || 0 };
        },
        async translate(text, src, tgt, signal) {
            const tr = await getTranslator(src, tgt);
            return tr.translate(text, signal ? { signal } : undefined);
        },
        /** Start downloading a pair's model (Chrome only allows that right after a tap). Resolves to the new availability. */
        async prepare(src, tgt) {
            const a = await availability(src, tgt);
            if (a === 'available' || a === 'unavailable') return a;
            if (!hasUserActivation(g) && !pair(src, tgt).creating) return a;
            try { await getTranslator(src, tgt); return 'available'; } catch { return 'unavailable'; }
        },
        /** For the UI: 'unavailable' | 'downloading' (with progress 0..1) | 'ready' | 'idle'. */
        status(src, tgt) {
            const p = pairs.get(`${src}>${tgt}`);
            if (!p) return { state: 'idle', progress: 0 };
            if (p.translator) return { state: 'ready', progress: 1 };
            if (p.creating || p.avail === 'downloading') return { state: 'downloading', progress: p.progress };
            if (p.avail === 'unavailable') return { state: 'unavailable', progress: 0 };
            return { state: 'idle', progress: 0 };
        },
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        dispose() {
            for (const p of pairs.values()) { try { p.translator?.destroy?.(); } catch { /* ignore */ } }
            try { detector?.destroy?.(); } catch { /* ignore */ }
            pairs.clear(); detector = null; listeners.clear();
        },
    };
}

// ---------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------
const defaultVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
const defaultOnVisible = cb => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', cb);
    return () => document.removeEventListener('visibilitychange', cb);
};

/**
 * cloud:  async ({ text, target, source }) => { text, source, target, same }   (the translateText callable's data), or null
 * device: createDeviceProvider(...) or null
 */
export function createEngine({
    cloud = null, device = null,
    timeoutMs = TIMEOUT_MS, maxPending = MAX_PENDING, cacheSize = CACHE_SIZE,
    isVisible = defaultVisible, onVisible = defaultOnVisible,
    now = Date.now, backoffMs = BACKOFF_MS,
} = {}) {
    const queue = [];
    const inflight = new Map();     // key -> promise (queued or running): the same request is asked once
    const cache = new Map();        // key -> result, oldest first
    let running = null;
    let blocked = { until: 0, kind: '' };
    let disposed = false;

    const keyOf = (text, target, source) => `${source}\u0000${target}\u0000${text}`;
    const remember = (key, res) => {
        cache.set(key, res);
        while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
    };

    /** The device's answer (a result) or null when the server should be asked. */
    async function viaDevice({ text, target, source }, signal) {
        if (!device) return null;
        try {
            let src = source === 'auto' ? '' : source;
            if (!src) {
                const d = await device.detect(text, signal);
                if (!d || !d.lang || d.confidence < DETECT_MIN_CONFIDENCE) return null; // not sure: let the server decide
                src = d.lang;
            }
            if (src === target) return { text, source: src, target, same: true, via: 'device' };
            const a = await device.availability(src, target);
            if (a === 'downloadable' || a === 'downloading') { device.prepare(src, target).catch(() => {}); return null; }
            if (a !== 'available') return null;
            const out = cleanOutput(await device.translate(text, src, target, signal));
            if (!out || out.length > MAX_OUT) return null;
            return { text: out, source: src, target, same: false, via: 'device' };
        } catch (e) {
            if (signal?.aborted) throw e;
            return null;
        }
    }

    async function viaCloud({ text, target, source }) {
        if (!cloud) throw new TranslateError('unavailable', 'Translation is unavailable in this browser.');
        if (blocked.until > now()) throw new TranslateError(blocked.kind);
        let data;
        try {
            data = await cloud({ text, target, source });
        } catch (e) {
            const err = classifyError(e);
            if (backoffMs[err.kind]) blocked = { until: now() + backoffMs[err.kind], kind: err.kind };
            throw err;
        }
        const out = typeof data?.text === 'string' ? cleanOutput(data.text) : '';
        if (data?.same === true) return { text, source: sanitizeLang(data.source), target, same: true, via: 'cloud' };
        if (!out || out.length > MAX_OUT) throw new TranslateError('unavailable');
        return { text: out, source: sanitizeLang(data.source), target, same: false, via: 'cloud' };
    }

    async function attempt(item) {
        const ac = new AbortController();
        item.abort = ac;
        let timer;
        const limit = new Promise((_, reject) => {
            timer = setTimeout(() => { ac.abort(); reject(new TranslateError('timeout')); }, timeoutMs);
            ac.signal.addEventListener('abort', () => reject(item.cancelled ? new TranslateError('cancelled') : new TranslateError('timeout')), { once: true });
        });
        try {
            const work = (async () => (await viaDevice(item.req, ac.signal)) || (await viaCloud(item.req)))();
            work.catch(() => {}); // a late failure after the timeout is of no interest
            return await Promise.race([work, limit]);
        } finally {
            clearTimeout(timer);
        }
    }

    function pump() {
        if (running || disposed || !queue.length || !isVisible()) return;
        const item = queue.shift();
        running = item;
        // Free the slot before anyone is told, so `pending` and the de-duplication are exact the moment a promise settles.
        const settle = done => { inflight.delete(item.key); running = null; done(); pump(); };
        attempt(item).then(
            res => settle(() => { remember(item.key, res); item.resolve(res); }),
            err => settle(() => item.reject(classifyError(err))),
        );
    }
    const stopWatching = onVisible(() => { if (isVisible()) pump(); });

    return {
        hasCloud: Boolean(cloud),
        hasDevice: Boolean(device),
        device,
        get pending() { return queue.length + (running ? 1 : 0); },
        /** When the server is being left alone after a limit error: { until, kind } (until = 0 when not). */
        get blocked() { return blocked.until > now() ? { ...blocked } : { until: 0, kind: '' }; },

        /**
         * Translate one message. Rejects with a TranslateError (see `kind`). priority 'high' (the message you are sending)
         * goes ahead of incoming ones and is not turned away when the queue is full.
         */
        translate({ text, target, source = 'auto', priority = 'normal' } = {}) {
            if (disposed) return Promise.reject(new TranslateError('cancelled'));
            const t = typeof text === 'string' ? text.trim() : '';
            if (!t || !isLang(target) || (source !== 'auto' && !isLang(source))) return Promise.reject(new TranslateError('invalid'));
            if (t.length > MAX_TEXT) return Promise.reject(new TranslateError('toolong'));
            const key = keyOf(t, target, source);
            if (cache.has(key)) { const hit = cache.get(key); cache.delete(key); cache.set(key, hit); return Promise.resolve({ ...hit, via: 'cache' }); }
            if (inflight.has(key)) return inflight.get(key);
            if (priority !== 'high' && queue.length + (running ? 1 : 0) >= maxPending) return Promise.reject(new TranslateError('busy'));
            const item = { key, req: { text: t, target, source }, abort: null, cancelled: false };
            const promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; });
            inflight.set(key, promise);
            if (priority === 'high') {
                let i = 0;
                while (i < queue.length && queue[i].high) i++;
                item.high = true;
                queue.splice(i, 0, item);
            } else queue.push(item);
            pump();
            return promise;
        },

        /** Drop everything waiting or running and forget cached translations (a new chat starts). */
        reset() {
            for (const item of queue.splice(0)) { inflight.delete(item.key); item.reject(new TranslateError('cancelled')); }
            if (running) { running.cancelled = true; running.abort?.abort(); }
            cache.clear();
        },

        /** Start preparing the on-device model for a pair (call from a tap: Chrome only downloads then). */
        async warm(source, target) {
            if (!device || !isLang(source) || !isLang(target) || source === target) return 'unavailable';
            try { return await device.prepare(source, target); } catch { return 'unavailable'; }
        },

        dispose() { disposed = true; this.reset(); stopWatching(); device?.dispose?.(); },
    };
}
