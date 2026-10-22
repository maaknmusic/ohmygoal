// =====================================================================
// Languages offered for "My language" and Live translate. Pure data + helpers (no DOM), shared by the profile,
// the translation engine and the chat UI. The same 45 codes are accepted by the translateText Cloud Function
// (functions/languages.js); a unit test keeps the two lists identical.
//   code   what travels over the data channel, in the profile document and to translateText
//   en     English name (used in labels like "Hindi → English")
//   native the language's own name in its own script (used in pickers and "Speaks हिन्दी")
// =====================================================================

export const LANGS = Object.freeze([
    ['en', 'English', 'English'],
    ['hi', 'Hindi', 'हिन्दी'],
    ['bn', 'Bengali', 'বাংলা'],
    ['ta', 'Tamil', 'தமிழ்'],
    ['te', 'Telugu', 'తెలుగు'],
    ['mr', 'Marathi', 'मराठी'],
    ['gu', 'Gujarati', 'ગુજરાતી'],
    ['kn', 'Kannada', 'ಕನ್ನಡ'],
    ['ml', 'Malayalam', 'മലയാളം'],
    ['pa', 'Punjabi', 'ਪੰਜਾਬੀ'],
    ['ur', 'Urdu', 'اردو'],
    ['or', 'Odia', 'ଓଡ଼ିଆ'],
    ['as', 'Assamese', 'অসমীয়া'],
    ['ne', 'Nepali', 'नेपाली'],
    ['es', 'Spanish', 'Español'],
    ['fr', 'French', 'Français'],
    ['de', 'German', 'Deutsch'],
    ['pt', 'Portuguese', 'Português'],
    ['it', 'Italian', 'Italiano'],
    ['nl', 'Dutch', 'Nederlands'],
    ['ru', 'Russian', 'Русский'],
    ['uk', 'Ukrainian', 'Українська'],
    ['pl', 'Polish', 'Polski'],
    ['tr', 'Turkish', 'Türkçe'],
    ['ar', 'Arabic', 'العربية'],
    ['fa', 'Persian', 'فارسی'],
    ['he', 'Hebrew', 'עברית'],
    ['id', 'Indonesian', 'Bahasa Indonesia'],
    ['ms', 'Malay', 'Bahasa Melayu'],
    ['th', 'Thai', 'ไทย'],
    ['vi', 'Vietnamese', 'Tiếng Việt'],
    ['zh', 'Chinese (Simplified)', '简体中文'],
    ['zh-TW', 'Chinese (Traditional)', '繁體中文'],
    ['ja', 'Japanese', '日本語'],
    ['ko', 'Korean', '한국어'],
    ['sw', 'Swahili', 'Kiswahili'],
    ['fil', 'Filipino', 'Filipino'],
    ['el', 'Greek', 'Ελληνικά'],
    ['cs', 'Czech', 'Čeština'],
    ['sv', 'Swedish', 'Svenska'],
    ['ro', 'Romanian', 'Română'],
    ['hu', 'Hungarian', 'Magyar'],
    ['da', 'Danish', 'Dansk'],
    ['fi', 'Finnish', 'Suomi'],
    ['nb', 'Norwegian', 'Norsk'],
].map(([code, en, native]) => Object.freeze({ code, en, native })));

const BY_CODE = new Map(LANGS.map(l => [l.code, l]));

/** True for a code from the list above (and nothing else: not 'auto', not other casings, not non-strings). */
export const isLang = code => typeof code === 'string' && BY_CODE.has(code);

/** A code from the list, or '' for anything else. Use on everything that comes from storage or a peer. */
export const sanitizeLang = code => (isLang(code) ? code : '');

/** English name ('Hindi'), or '' when the code is not in the list. */
export const langName = code => BY_CODE.get(code)?.en || '';

/** The language's own name ('हिन्दी'), or ''. */
export const langNative = code => BY_CODE.get(code)?.native || '';

/** 'हिन्दी · Hindi' for pickers ('English' alone when both names are the same). */
export function langLabel(code) {
    const l = BY_CODE.get(code);
    if (!l) return '';
    return l.native === l.en ? l.en : `${l.native} · ${l.en}`;
}

/** Languages written right to left (for dir attributes). */
export const isRtl = code => ['ar', 'fa', 'he', 'ur'].includes(code);

// Languages normally written in a script other than Latin.
const NON_LATIN = new Set(['hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'ur', 'or', 'as', 'ne', 'ru', 'uk', 'ar', 'fa', 'he', 'th', 'zh', 'zh-TW', 'ja', 'ko', 'el']);

// BCP-47 tags (and a few legacy ones) -> our codes.
const TAG_ALIASES = { no: 'nb', nn: 'nb', nb: 'nb', tl: 'fil', fil: 'fil', iw: 'he', in: 'id', jw: 'id' };

/**
 * Map any language tag ('en-US', 'zh-Hant-TW', 'no', 'tl', 'iw') to a code from the list, or '' when it has none.
 * Traditional Chinese is zh-TW / zh-HK / zh-MO / zh-Hant; every other zh tag is Simplified.
 */
export function fromTag(tag) {
    if (typeof tag !== 'string') return '';
    const t = tag.trim().replace(/_/g, '-').toLowerCase();
    if (!t || t === 'und' || t === 'auto') return '';
    const [base, ...rest] = t.split('-');
    if (base === 'zh') {
        if (rest.includes('latn')) return ''; // pinyin
        const traditional = rest.includes('hant') || rest.some(p => ['tw', 'hk', 'mo'].includes(p));
        if (rest.includes('hans') && !rest.includes('hant')) return 'zh';
        return traditional ? 'zh-TW' : 'zh';
    }
    const code = TAG_ALIASES[base] || base;
    if (!isLang(code)) return '';
    // Romanised text ('hi-Latn': Hindi in English letters) isn't the language as written in its own script: unknown.
    if (rest.includes('latn') && NON_LATIN.has(code)) return '';
    return code;
}

/** The browser's language as one of ours, 'en' when we have no match. Accepts a tag or a list of tags (navigator.languages). */
export function guessLang(tagOrList) {
    const list = Array.isArray(tagOrList) ? tagOrList : [tagOrList];
    for (const tag of list) {
        const code = fromTag(tag);
        if (code) return code;
    }
    return 'en';
}

// What the browser's on-device Translator / LanguageDetector may call the same languages, most likely first. A tag the
// browser doesn't know just reports "unavailable", and the request goes to our server instead.
const DEVICE_TAGS = { 'zh-TW': ['zh-Hant'], nb: ['no', 'nb'], fil: ['fil', 'tl'], he: ['he', 'iw'] };
/** Our code -> the tags to try with the on-device APIs. */
export const toDeviceTags = code => DEVICE_TAGS[code] || [code];
