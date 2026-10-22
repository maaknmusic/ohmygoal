// The language list shared by the profile, the engine and the chat UI, and the helpers around it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LANGS, isLang, sanitizeLang, langName, langNative, langLabel, isRtl, fromTag, guessLang, toDeviceTags } from '/home/user/ohmygoal/js/languages.js';

const CODES = 'en hi bn ta te mr gu kn ml pa ur or as ne es fr de pt it nl ru uk pl tr ar fa he id ms th vi zh zh-TW ja ko sw fil el cs sv ro hu da fi nb'.split(' ');
const NAMES = 'English, Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Odia, Assamese, Nepali, Spanish, French, German, Portuguese, Italian, Dutch, Russian, Ukrainian, Polish, Turkish, Arabic, Persian, Hebrew, Indonesian, Malay, Thai, Vietnamese, Chinese (Simplified), Chinese (Traditional), Japanese, Korean, Swahili, Filipino, Greek, Czech, Swedish, Romanian, Hungarian, Danish, Finnish, Norwegian'.split(', ');

test('the list is exactly the 45 agreed codes, in order, with English and native names', () => {
    assert.equal(LANGS.length, 45);
    assert.deepEqual(LANGS.map(l => l.code), CODES);
    assert.deepEqual(LANGS.map(l => l.en), NAMES);
    assert.equal(new Set(LANGS.map(l => l.code)).size, 45);
    for (const l of LANGS) {
        assert.ok(l.native && typeof l.native === 'string', l.code);
        assert.ok(Object.isFrozen(l));
    }
    assert.equal(langNative('hi'), 'हिन्दी');
    assert.equal(langNative('bn'), 'বাংলা');
    assert.equal(langNative('ta'), 'தமிழ்');
    assert.equal(langNative('es'), 'Español');
});

test('the client list matches the server list when the server file exists', async t => {
    if (!fs.existsSync('/home/user/ohmygoal/functions/languages.js')) return t.skip('functions/languages.js not there');
    const server = await import('/home/user/ohmygoal/functions/languages.js').then(m => m.default || m, () => null).catch(() => null)
        || await import('/home/user/ohmygoal/functions/languages.js');
    const list = server.LANGS || server.default?.LANGS || server.default;
    assert.deepEqual(list.map(l => [l.code, l.en]), LANGS.map(l => [l.code, l.en]));
});

test('isLang / sanitizeLang accept only exact codes from the list', () => {
    for (const c of CODES) { assert.equal(isLang(c), true); assert.equal(sanitizeLang(c), c); }
    for (const bad of ['', 'EN', 'En', 'en-US', 'auto', 'xx', 'zh-tw', 'zh-CN', ' en', 'en ', 'constructor', '__proto__', 'toString', 'hasOwnProperty', null, undefined, 5, {}, [], ['en'], true, { toString: () => 'en' }]) {
        assert.equal(isLang(bad), false, String(bad));
        assert.equal(sanitizeLang(bad), '', String(bad));
    }
});

test('langName / langNative / langLabel', () => {
    assert.equal(langName('hi'), 'Hindi');
    assert.equal(langName('zh-TW'), 'Chinese (Traditional)');
    assert.equal(langName('nope'), '');
    assert.equal(langName({}), '');
    assert.equal(langNative('nope'), '');
    assert.equal(langLabel('hi'), 'हिन्दी · Hindi');
    assert.equal(langLabel('en'), 'English');
    assert.equal(langLabel('fil'), 'Filipino');
    assert.equal(langLabel('x'), '');
    assert.equal(isRtl('ar') && isRtl('he') && isRtl('fa') && isRtl('ur'), true);
    assert.equal(isRtl('en'), false);
});

test('fromTag maps BCP-47 and legacy tags to our codes', () => {
    const cases = {
        en: 'en', 'en-US': 'en', 'EN_gb': 'en', 'hi-IN': 'hi', 'pt-BR': 'pt', 'pt-PT': 'pt', 'es-419': 'es',
        zh: 'zh', 'zh-CN': 'zh', 'zh-Hans': 'zh', 'zh-Hans-CN': 'zh', 'zh-SG': 'zh',
        'zh-TW': 'zh-TW', 'zh-HK': 'zh-TW', 'zh-MO': 'zh-TW', 'zh-Hant': 'zh-TW', 'zh-Hant-TW': 'zh-TW',
        no: 'nb', nb: 'nb', 'nb-NO': 'nb', nn: 'nb', 'nn-NO': 'nb', tl: 'fil', fil: 'fil', 'fil-PH': 'fil', iw: 'he', he: 'he', in: 'id', id: 'id',
        'ur-PK': 'ur', 'ar-EG': 'ar', 'sw-KE': 'sw',
    };
    for (const [tag, code] of Object.entries(cases)) assert.equal(fromTag(tag), code, tag);
    for (const tag of ['', 'und', 'auto', 'xx', 'sr', 'ja-Latn', 'hi-Latn', 'ru-Latn', 'ar-Latn', 'zh-Latn', 'ko-Latn', null, undefined, 3, {}]) assert.equal(fromTag(tag), '', String(tag));
    assert.equal(fromTag('en-Latn'), 'en');
    assert.equal(fromTag('es-Latn'), 'es');
});

test('guessLang: the browser language as one of ours, English when there is no match', () => {
    assert.equal(guessLang('hi-IN'), 'hi');
    assert.equal(guessLang('en-GB'), 'en');
    assert.equal(guessLang('zh-TW'), 'zh-TW');
    assert.equal(guessLang('sr-RS'), 'en');
    assert.equal(guessLang(''), 'en');
    assert.equal(guessLang(undefined), 'en');
    assert.equal(guessLang(null), 'en');
    assert.equal(guessLang(['sr', 'ta-IN', 'en']), 'ta'); // first one we have
    assert.equal(guessLang([]), 'en');
    assert.equal(guessLang(['xx']), 'en');
});

test('device tags: spellings to try with the on-device APIs', () => {
    assert.deepEqual(toDeviceTags('en'), ['en']);
    assert.deepEqual(toDeviceTags('zh-TW'), ['zh-Hant']);
    assert.ok(toDeviceTags('he').includes('iw'));
    assert.ok(toDeviceTags('fil').includes('tl'));
    assert.ok(toDeviceTags('nb').includes('no'));
});
