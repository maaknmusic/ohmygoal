// The languages Live translate and the native-language profile field understand.
//
// Keep this list EXACTLY in step with js/languages.js (the browser's copy, which adds each language's own name) and with
// the language list in the `profiles` block of firestore.rules: tests/unit checks the first, tests/e2e/translate-server.mjs the second.
// Codes are BCP-47 style: "zh" is Simplified Chinese, "zh-TW" is Traditional.
export const LANGS = Object.freeze([
    { code: 'en', en: 'English' },
    { code: 'hi', en: 'Hindi' },
    { code: 'bn', en: 'Bengali' },
    { code: 'ta', en: 'Tamil' },
    { code: 'te', en: 'Telugu' },
    { code: 'mr', en: 'Marathi' },
    { code: 'gu', en: 'Gujarati' },
    { code: 'kn', en: 'Kannada' },
    { code: 'ml', en: 'Malayalam' },
    { code: 'pa', en: 'Punjabi' },
    { code: 'ur', en: 'Urdu' },
    { code: 'or', en: 'Odia' },
    { code: 'as', en: 'Assamese' },
    { code: 'ne', en: 'Nepali' },
    { code: 'es', en: 'Spanish' },
    { code: 'fr', en: 'French' },
    { code: 'de', en: 'German' },
    { code: 'pt', en: 'Portuguese' },
    { code: 'it', en: 'Italian' },
    { code: 'nl', en: 'Dutch' },
    { code: 'ru', en: 'Russian' },
    { code: 'uk', en: 'Ukrainian' },
    { code: 'pl', en: 'Polish' },
    { code: 'tr', en: 'Turkish' },
    { code: 'ar', en: 'Arabic' },
    { code: 'fa', en: 'Persian' },
    { code: 'he', en: 'Hebrew' },
    { code: 'id', en: 'Indonesian' },
    { code: 'ms', en: 'Malay' },
    { code: 'th', en: 'Thai' },
    { code: 'vi', en: 'Vietnamese' },
    { code: 'zh', en: 'Chinese (Simplified)' },
    { code: 'zh-TW', en: 'Chinese (Traditional)' },
    { code: 'ja', en: 'Japanese' },
    { code: 'ko', en: 'Korean' },
    { code: 'sw', en: 'Swahili' },
    { code: 'fil', en: 'Filipino' },
    { code: 'el', en: 'Greek' },
    { code: 'cs', en: 'Czech' },
    { code: 'sv', en: 'Swedish' },
    { code: 'ro', en: 'Romanian' },
    { code: 'hu', en: 'Hungarian' },
    { code: 'da', en: 'Danish' },
    { code: 'fi', en: 'Finnish' },
    { code: 'nb', en: 'Norwegian' },
].map(l => Object.freeze(l)));

/** Membership is checked with a Set, never with object keys, so "__proto__" or "constructor" can never pass as a code. */
export const LANG_CODES = new Set(LANGS.map(l => l.code));

const NAMES = new Map(LANGS.map(l => [l.code, l.en]));

export const isLang = code => typeof code === 'string' && LANG_CODES.has(code);
/** English name of a code ('' for anything not on the list). */
export const langName = code => NAMES.get(code) || '';
