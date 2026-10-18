// =====================================================================
// Scam / personal-info shield for messages from strangers (India-focused).
// scanMessage() says what a message contains; maskContact() hides phone
// numbers, UPI ids and emails behind bullets for a "show anyway" toggle.
// Pure functions (no DOM). English, Hinglish and a little Devanagari.
// It is a nudge for the reader, not a security boundary: it leans towards
// warning, and anything it misses is still just text.
// =====================================================================

export const KINDS = Object.freeze(['phone', 'upi', 'social', 'link', 'email', 'money', 'explicit-ask']);

const MAX_LEN = 4000; // chat messages are short; longer input is cut here so scanning stays cheap
const MASK = '•';

// ---------- text preparation ----------

// Characters that show nothing: zero-width and bidi controls, variation selectors, tag characters, Hangul/Khmer/Mongolian
// fillers, the soft hyphen, control codes and the blank Braille cell. The Unicode property covers most of them.
const INVISIBLE_SET = String.raw`\p{Default_Ignorable_Code_Point}؜‎‏‪-‮⁦-⁩⠀￹-￻\u0000-\u0008\u000E-\u001F\u007F-\u009F`;
const INVISIBLE = new RegExp(`[${INVISIBLE_SET}]`, 'u');
const INVISIBLE_ALL = new RegExp(`[${INVISIBLE_SET}]`, 'gu');
// Accents, strike-through and keycap rings drawn over a letter or digit: skipped when scanning (n̶u̶d̶e̶s̶), left alone when masking.
const MARK = /[̀-ͯ⃐-⃿]/u;
const MARK_ALL = /[̀-ͯ⃐-⃿]/gu;

/** The text without invisible characters (zero-width, bidi and filler code points, control codes). */
export function stripInvisible(text) {
    return typeof text === 'string' ? text.replace(INVISIBLE_ALL, '') : '';
}

const ANY_DIGIT = /[\p{Nd}\p{No}]/u;
const DECIMAL = /^\p{Nd}$/u;
// Digits outside \p{Nd}: [first code point, last, value of the first] (superscript, subscript, circled, bracketed, dingbat).
const OTHER_DIGITS = [
    [0xB2, 0xB3, 2], [0xB9, 0xB9, 1], [0x2070, 0x2070, 0], [0x2074, 0x2079, 4], [0x2080, 0x2089, 0],
    [0x2460, 0x2468, 1], [0x2474, 0x247C, 1], [0x2488, 0x2490, 1], [0x24EA, 0x24EA, 0], [0x24F5, 0x24FD, 1], [0x24FF, 0x24FF, 0],
    [0x2776, 0x277E, 1], [0x2780, 0x2788, 1], [0x278A, 0x2792, 1],
    [0x1F100, 0x1F100, 0], [0x1F101, 0x1F10A, 0], [0x1F10B, 0x1F10B, 0], [0x1F10C, 0x1F10C, 0],
];
const digitValues = new Map(); // code point -> 0-9 (or -1); only digit-like code points get here, a few hundred at most

/** 0-9 for a decimal digit in any script, else -1. Every \p{Nd} block is a run of ten, so the offset into the run is the value. */
function digitValue(ch, c) {
    let v = digitValues.get(c);
    if (v !== undefined) return v;
    v = -1;
    if (DECIMAL.test(ch)) {
        let zero = c;
        while (DECIMAL.test(String.fromCodePoint(zero - 1))) zero--;
        v = (c - zero) % 10;
    } else {
        const row = OTHER_DIGITS.find(([lo, hi]) => c >= lo && c <= hi);
        if (row) v = row[2] + c - row[0];
    }
    digitValues.set(c, v);
    return v;
}

const ACCENTED = /[À-ɏḀ-ỿ]/u;

/** One character as the scanner reads it: any script's digits as ASCII, fancy-font and full-width forms as plain ones, accents off. */
function foldChar(ch, c) {
    if (c < 0x80) return ch;
    if (c === 0x2028 || c === 0x2029) return ' ';
    if (ANY_DIGIT.test(ch)) {
        const d = digitValue(ch, c);
        if (d >= 0) return String(d);
    }
    if (c >= 0x0900 && c <= 0x0DFF) return ch; // Indic scripts stay as typed; the patterns below are written against them
    let r = ch.normalize('NFKC');
    if (ACCENTED.test(r)) r = r.normalize('NFD').replace(MARK_ALL, '');
    return r;
}

/**
 * { src, norm, from, to }: src is the (cut) input and norm what gets scanned, with invisible characters dropped and the rest
 * folded. from[i] / to[i] give the stretch of src that norm[i] came from, so spans found in norm can be edited in src.
 */
function prepare(text) {
    if (typeof text !== 'string') return null;
    const src = text.slice(0, MAX_LEN);
    const from = [];
    const to = [];
    let norm = '';
    let at = 0;
    for (const ch of src) {
        const start = at;
        at += ch.length;
        const c = ch.codePointAt(0);
        let rep = ch;
        if (c >= 0x80 || c < 0x20 || c === 0x7F) {
            if (INVISIBLE.test(ch) || MARK.test(ch)) continue;
            rep = foldChar(ch, c);
        }
        for (let k = 0; k < rep.length; k++) {
            from.push(start);
            to.push(at);
        }
        norm += rep;
    }
    return { src, norm, from, to };
}

/** The stretch of src behind norm[s, e), including hidden characters that trail it (a keycap's variation selector and ring). */
function origRange(p, s, e) {
    let end = p.to[e - 1];
    const next = e < p.norm.length ? p.from[e] : p.src.length;
    if (next > end) end = next;
    return [p.from[s], end];
}

// Patterns without the g flag are used with test(); g patterns only with matchAll(), which keeps them stateless.
const rx = (source, flags = 'iu') => new RegExp(source, flags);
const anyOf = (list, text) => list.some(re => re.test(text));

// ---------- phone numbers ----------

// Up to three symbols, spaces or emoji between two digits (not a colon: 9:30 is a time).
const SEP = String.raw`[^\p{L}\p{N}:]{0,3}`;

// Optional +91 / 91 / 0 prefix (group 1), then ten digits starting 6-9 (group 2) with separators anywhere between them.
const MOBILE = new RegExp(String.raw`(?<!\d|\d[.\-])((?:(?:\+|00)[\s.\-]?)?\(?91\)?${SEP}0?|0[^\p{L}\p{N}:]?)?([6-9](?:${SEP}\d){9})(?!\d)`, 'gu');
const INTL = new RegExp(String.raw`(?<![\w+])\+\d{1,3}(?:${SEP}\d){8,13}(?!\d)`, 'gu');
const LONG_DIGITS = /(?<!\d|\d[.,])\d{10,}/gu;
const AMOUNT = /^\d{1,3}(?:,\d{2,3})+$/; // 8,000,000,000 is a sum, not a number to ring

// O or l between digits is somebody typing a 0 or a 1 ("98765O3210"); same length, so spans still line up.
const LOOKALIKE = /(?<=\d)[OolI]{1,3}(?=\d)/gu;
const lookalikeDigits = f => f.replace(LOOKALIKE, m => m.replace(/[Oo]/g, '0').replace(/[lI]/g, '1'));

// Digits spelled out, in English, Hinglish or Devanagari ("nine eight seven ...", "nau aath saat ...").
const DIGIT_WORDS = 'zero|one|two|three|four|five|six|seven|eight|nine|ek|do|teen|char|chaar|paanch|panch|chhe|chhah|chheh|che|cheh|saat|aath|nau|shunya|sifar|शून्य|एक|दो|तीन|चार|पाँच|पांच|छह|छः|सात|आठ|नौ';
const DIGIT_TOKEN = new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}])(?:${DIGIT_WORDS}|\d)(?![\p{L}\p{M}\p{N}])`, 'giu');
const TIGHT_GAP = /^[\s,.\-]*$/; // between digits and digit words that follow each other
const MAX_FILLER = 12; // a few words may sit between two spelled digits ("nine, then eight")
const WINDOW = 64; // eight digit words inside this many characters read as a number

/** Runs of digit tokens { s, e, word } that look like a phone number: ten tight in a row, or eight words close together. */
function spelledChains(f) {
    const out = [];
    let chain = [];
    let run = 0;
    let best = 0;
    const flush = () => {
        const words = chain.filter(t => t.word);
        if (best >= 10 || words.some((t, i) => i + 7 < words.length && words[i + 7].e - t.s <= WINDOW)) out.push(chain);
        chain = [];
        best = 0;
    };
    for (const m of f.matchAll(DIGIT_TOKEN)) {
        const t = { s: m.index, e: m.index + m[0].length, word: m[0].length > 1 };
        const prev = chain[chain.length - 1];
        const gap = prev ? f.slice(prev.e, t.s) : '';
        if (prev && TIGHT_GAP.test(gap)) run++;
        else if (prev && prev.word && t.word && gap.length <= MAX_FILLER && !/\d/.test(gap)) run = 1;
        else {
            flush();
            run = 1;
        }
        chain.push(t);
        best = Math.max(best, run);
    }
    flush();
    return out;
}

/** [start, end] pairs for the digits of f[s, e). */
function digitUnits(f, s, e) {
    const units = [];
    for (let i = s; i < e; i++) {
        const c = f.charCodeAt(i);
        if (c >= 48 && c <= 57) units.push([i, i + 1]);
    }
    return units;
}

/** Non-overlapping phone spans { s, e, units }; units are the digits (or digit words) that masking replaces. */
function phoneSpans(norm) {
    const f = lookalikeDigits(norm);
    const spans = [];
    const add = (s, e, units) => {
        if (!spans.some(x => s < x.e && e > x.s)) spans.push({ s, e, units });
    };
    for (const m of f.matchAll(MOBILE)) {
        const body = m[2];
        if (AMOUNT.test(body) || body.split('/').length > 2) continue; // a sum, or dates and scores like 7/10, 8/10
        const e = m.index + m[0].length;
        add(m.index, e, digitUnits(f, e - body.length, e));
    }
    for (const m of f.matchAll(INTL)) add(m.index, m.index + m[0].length, digitUnits(f, m.index, m.index + m[0].length));
    for (const chain of spelledChains(f)) add(chain[0].s, chain[chain.length - 1].e, chain.map(t => [t.s, t.e]));
    for (const m of f.matchAll(LONG_DIGITS)) add(m.index, m.index + m[0].length, digitUnits(f, m.index, m.index + m[0].length));
    return spans;
}

// ---------- UPI ids and emails ----------

const UPI_HANDLES = [
    'okaxis', 'okhdfcbank', 'okicici', 'oksbi', 'okbizaxis', 'ybl', 'ibl', 'axl', 'apl', 'paytm', 'upi',
    'sbi', 'icici', 'hdfcbank', 'axisbank', 'axisb', 'pnb', 'boi', 'cnrb', 'barodampay', 'aubank', 'fbl',
    'ikwik', 'freecharge', 'airtel', 'jio', 'postbank', 'yesbank', 'yesg', 'rbl', 'idfcbank', 'idfcfirst',
    'kotak', 'pingpay', 'ptyes', 'pthdfc', 'ptsbi', 'ptaxis', 'abfspay', 'jupiteraxis', 'slice', 'waicici',
    'wahdfcbank', 'wasbi', 'waaxis', 'naviaxis', 'sliceaxis', 'fam', 'cmsidfc', 'dbs', 'federal', 'indus',
    'kmbl', 'sib', 'tmb', 'uboi', 'unionbank', 'united', 'utbi', 'ezeepay', 'ypay', 'okbizicici',
];
const BARE_UPI_HANDLES = 'okaxis|okhdfcbank|okicici|oksbi|ybl|ibl|axl|apl';

const LOCAL_BEFORE = String.raw`(?<![\w.%+\-])`;
const EMAIL = rx(String.raw`${LOCAL_BEFORE}[a-z0-9_][a-z0-9._%+\-]{0,63}@(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?![\w@\-])`, 'giu');
// name@handle with no dot after the handle; a dotted tail (name@okaxis.com) is an email instead.
const UPI = rx(String.raw`${LOCAL_BEFORE}[a-z0-9_][a-z0-9._\-]{0,48}@(?:${UPI_HANDLES.join('|')})(?![\w\-]|\.[a-z])`, 'giu');
const UPI_BARE = rx(String.raw`(?<![\w.%+\-@${MASK}])@(?:${BARE_UPI_HANDLES})(?![\w\-])`, 'giu');
// "name (at) gmail (dot) com", "name at gmail dot com"
const MAIL_PROVIDER = 'gmail|yahoo|outlook|hotmail|icloud|rediffmail|proton(?:mail)?|live';
const MAIL_TLD = 'com|in|co\\s*\\.?\\s*in|net|org';
const EMAIL_OBFUSCATED = [
    rx(String.raw`${LOCAL_BEFORE}[a-z0-9][a-z0-9._%+\-]{1,40}\s*(?:\(\s*at\s*\)|\[\s*at\s*\]|\{\s*at\s*\})\s*(?:${MAIL_PROVIDER})\s*(?:\(\s*dot\s*\)|\[\s*dot\s*\]|\bdot\b|\.)\s*(?:${MAIL_TLD})\b`, 'giu'),
    rx(String.raw`${LOCAL_BEFORE}[a-z0-9][a-z0-9._%+\-]{1,40}\s+at\s+(?:${MAIL_PROVIDER})\s*(?:\(\s*dot\s*\)|\[\s*dot\s*\]|\bdot\b)\s*(?:${MAIL_TLD})\b`, 'giu'),
];

/** Spans of emails and UPI ids: { s, e, kind: 'email' | 'upi' }. */
function addressSpans(f) {
    const spans = [];
    const collect = (re, kind) => {
        for (const m of f.matchAll(re)) spans.push({ s: m.index, e: m.index + m[0].length, kind });
    };
    collect(EMAIL, 'email');
    EMAIL_OBFUSCATED.forEach(re => collect(re, 'email'));
    collect(UPI, 'upi');
    collect(UPI_BARE, 'upi');
    return spans;
}

/** The text with the given spans blanked out, so an email's domain isn't also read as a link. */
function blank(f, spans) {
    let out = f;
    for (const { s, e } of spans) out = out.slice(0, s) + ' '.repeat(e - s) + out.slice(e);
    return out;
}

// ---------- links ----------

const TLDS = 'com|net|org|in|io|app|link|xyz|info|biz|shop|store|online|site|click|top|live|co|dev|tech';
const SHORTENERS = [
    'bit\\.ly', 't\\.co', 'goo\\.gl', 'wa\\.me', 't\\.me', 'telegram\\.me', 'ig\\.me', 'm\\.me', 'fb\\.me', 'youtu\\.be',
    'rb\\.gy', 'is\\.gd', 'cutt\\.ly', 'shorturl\\.at', 'ow\\.ly', 'buff\\.ly', 'discord\\.gg', 'linktr\\.ee',
    'instagr\\.am', 'lnkd\\.in', 'amzn\\.to', 'tiny\\.cc',
].join('|');
const DOMAIN_BEFORE = String.raw`(?<![\w@.\-])`;
const DOMAIN_AFTER = String.raw`(?![\w@\-])`;

const LINK = [
    rx(String.raw`(?:https?|ftp)://\S`),
    rx(String.raw`${DOMAIN_BEFORE}www\.[a-z0-9\-]+\.[a-z]{2,}`),
    rx(String.raw`${DOMAIN_BEFORE}(?:${SHORTENERS})${DOMAIN_AFTER}`),
    rx(String.raw`${DOMAIN_BEFORE}(?:[a-z0-9][a-z0-9\-]*\.)+(?:${TLDS})${DOMAIN_AFTER}`),
];

// ---------- social: moving to another app, sharing or asking for an id ----------

const APP = String.raw`(?:insta(?:gram)?|snap(?:chat)?|telegram|w(?:ha?|a)ts?\s?ap+|discord|facebook|fb|messenger|skype|wechat|viber)`;
const YOUR = String.raw`(?:your|ur|ure|tera|teri|tere|tumhara|tumhari|tumhare|aapka|aapki|aapke|apna|apni|apne)`;
const GIVE = String.raw`(?:send|share|give|drop|tell|gimme|show|bhejo|bhej|batao|bata|dedo|de|do|dijiye|dijie)`;
const HI_GIVE = String.raw`(?:do|dedo|de\s?do|de|dijiye|dijie|bhejo|bhej\s?do|bhej|batao|bata\s?do|bata|share|send|dena|den)`;
const NOT_A_HANDLE = 'not|so|too|very|really|always|never|just|also|the|an?|down|dead|full|slow|hanging|stuck|banned|blocked|off|on|working|crashing|amazing|awesome|great|good|bad|fine|ok|okay|broken|hacked|private|public|open|closed|active|useless|boring|fun|best|worst|my|your|all|only|still|now|here|there|this|that|it|what|why|how|no|yes';
const IDENT = String.raw`@?[a-z0-9_.]{3,30}`;
const PHONE_WORD = String.raw`(?:phone\s+|mobile\s+|cell\s+|contact\s+|whatsapp\s+)`;
const NUMBER = String.raw`(?:number|num|nmbr|nbr)`;
const NUMBER_GIVE = String.raw`(?:${HI_GIVE}|plz|pls|please)`;

const SOCIAL = [
    // "my id is x", "my insta id: x", "mera snap id hai"
    rx(String.raw`\b(?:my|mera|meri|mere)\s+(?:${APP}\s+)?(?:id|handle|user\s?name)\s*(?:is|hai|h\b|:|=|-)`),
    // "my insta is rahul_99" (but not "my whatsapp is not working")
    rx(String.raw`\b(?:my|mera|meri|mere)\s+${APP}(?:\s+(?:id|handle|user\s?name))?\s*(?:is|hai|h\b|:|=|-|–)\s*(?!(?:${NOT_A_HANDLE})\b)${IDENT}`),
    // "insta: rahul_99", "snap - priya99", "insta rahul_99"
    rx(String.raw`\b${APP}(?:\s+(?:id|handle|user\s?name))?\s*[:=]\s*${IDENT}`),
    rx(String.raw`\b${APP}(?:\s+(?:id|handle|user\s?name))?\s+[-–]\s+@?(?=[a-z0-9.]*[\d_])[a-z0-9_.]{3,30}`),
    rx(String.raw`\b${APP}\s+@?(?=[a-z0-9._]*[a-z])(?=[a-z0-9.]*[\d_])[a-z0-9_.]{3,30}\b`),
    // "add me on snap", "dm me on insta", "text me on whatsapp", "follow my insta"
    rx(String.raw`\b(?:add|follow|dm|text|message|msg|ping|call|contact|reach|find|search|hit|connect|talk|chat|join|invite)\s+(?:(?:to|with)\s+)?(?:me|us)\b(?:\W+\w+){0,3}?\W+${APP}`),
    rx(String.raw`\b(?:add|follow|check|visit|dm|msg|text|find|see)\s+(?:my|mera|meri)\s+${APP}`),
    rx(String.raw`\b(?:hmu|dm|pm)\s+(?:me\s+)?(?:on|at|via|in)\s+${APP}`),
    rx(String.raw`\b${YOUR}\s+(?:ig|tg|sc)(?:\s+id)?\b`),
    // "what's ur insta", "your snap id", "tumhara whatsapp"
    rx(String.raw`\b${YOUR}\s+${APP}\b(?!\s+(?:post|reel|stor|pic|photo|video|page|feed|profile|account|bio|dp))`),
    rx(String.raw`\b${GIVE}\s+(?:me\s+|mujhe\s+|us\s+)?(?:${YOUR}\s+)?${APP}\b`),
    // "do you have insta", "u on snap", "are you on telegram"
    rx(String.raw`\b(?:you|u|tum|aap)\s+(?:have|use|got|on)\s+(?:an?\s+)?${APP}\b`),
    // "lets shift to whatsapp", "move to telegram", "continue on insta", "video call on whatsapp"
    rx(String.raw`\b(?:shift|move|switch|continue)\w*\s+(?:\w+\s+){0,2}?(?:to|on|over\s+to|over|via|pe|par|per)\s+${APP}\b`),
    rx(String.raw`\b(?:let'?s|lets|can\s+we|should\s+we|shall\s+we|chalo|chalein|chalte)\s+(?:\w+\s+){0,2}?(?:on|pe|par|to|over|via)\s+${APP}\b`),
    rx(String.raw`\b(?:video\s?call|vc|call)\s+(?:\w+\s+){0,2}?(?:on|pe|par|per|via)\s+${APP}\b`),
    // Hinglish: "whatsapp pe aao", "insta pe chat karte hain", "insta id do", "instagram pe ho?"
    rx(String.raw`\b${APP}\s+(?:pe|par|per|p)\s+(?:\w+\s+){0,2}?(?:aao|aaiye|aajao|aa\s?jao|aaja|chalo|chal|chalte|chalein|baat|bat|chat|msg|message|text|bhej|bhejo|karo|kar|karte|krte|krna|karna|mil|milte|milo|add|follow|connect)\b`),
    rx(String.raw`\b${APP}\s+(?:pe|par|per)\s+(?:ho|ho\s+kya|active)\b`),
    rx(String.raw`\b${APP}(?:\s+(?:id|handle|user\s?name|number|no))?\s+${HI_GIVE}\b`),
    // Asking for a phone number: "number do", "give me your number", "tumhara number kya hai"
    rx(String.raw`\b(?:${NUMBER}|mobile(?:\s+(?:no|number))?|contact(?:\s+(?:no|number))?|phone(?:\s+(?:no|number))?)\s+${NUMBER_GIVE}\b`),
    rx(String.raw`\b${YOUR}\s+${PHONE_WORD}?${NUMBER}\b(?!\s+(?:one|1|two|2|is\s+up|of))`),
    rx(String.raw`\b(?:send|share|give|drop|tell|gimme|text|bhejo|batao)\s+(?:me\s+)?(?:${YOUR}\s+)?${PHONE_WORD}?${NUMBER}\b`),
    rx(String.raw`\bmy\s+(?:phone|mobile|cell|contact|whatsapp)\s+(?:${NUMBER}|no\b)`),
    // Asking for an email: "your email id", "mail id do"
    rx(String.raw`\b${YOUR}\s+(?:e-?mail|gmail|mail)(?:\s+id)?\b`),
    rx(String.raw`\b(?:e-?mail|gmail|mail)\s+id\s+${HI_GIVE}\b`),
    // "@rahul_99" (but not "@5pm", "@home", or a bare UPI handle)
    rx(String.raw`(?<![\w@.])@(?!(?:${BARE_UPI_HANDLES})(?![\w\-]))(?!(?:home|work|office|school|college|gym|lunch|dinner|least|most)\b)[a-z_][a-z0-9_.]{2,29}`),
    // Links straight to a chat app or profile
    rx(String.raw`${DOMAIN_BEFORE}(?:wa\.me|t\.me|telegram\.me|ig\.me|m\.me|fb\.me|discord\.gg|instagr\.am|(?:www\.)?(?:instagram|snapchat|facebook|telegram|discord|wechat|whatsapp)\.com)${DOMAIN_AFTER}`),
    // A message that is only an app name and filler: "insta?", "ur snap", "whatsapp hai?"
    rx(String.raw`^\W*(?:(?:id|handle|ur|your|u|you|hai|h|ka|ki|ke|kya|plz|pls|please|tera|tumhara|aapka|apna|mera|my|number|no|username|name|account|acc)\W+){0,2}${APP}(?:\W+(?:id|handle|ur|your|hai|h|ka|kya|plz|pls|please|username|name|account|acc|number|no))?\W*$`),
    // Devanagari
    rx(String.raw`(?:व्हाट्सऐप|व्हाट्सएप|व्हाट्सऍप|वॉट्सऐप|वॉट्सएप|व्हॉट्सऐप|व्हॉट्सएप|व्हाट्सअप|इंस्टाग्राम|इंस्टा|स्नैपचैट|टेलीग्राम)(?:\s+\S+){0,3}?\s+(?:आओ|आइए|आ\s?जाओ|चलो|बात|चैट|मैसेज|मेसेज|भेजो|भेज|दो|दीजिए|दीजिये|बताओ|आईडी|ऐड|फॉलो)`),
    rx(String.raw`(?:मोबाइल\s)?न[ंम]्?बर\s+(?:दो|दीजिए|दीजिये|भेजो|भेज\s?दो|बताओ|बता\s?दो|दे\s?दो|दे)`),
];

// ---------- money, payments, OTP, gift cards ----------

const PAY_APP = String.raw`(?:paytm|phone\s?pe|phonepe|g\s?pay|gpay|google\s?pay|bhim|upi|amazon\s?pay|paypal|mobikwik|freecharge)`;
const MONEY_WORD = String.raw`(?:money|cash|funds|amount|rupees|rupaye|rs\b\.?|₹|inr\b|dollars|bucks|payment|paisa|paise)`;

const PAY_VERB = /\b(?:pay|paying|payment|send|sending|transfer|bhej|bhejo|kar|karo)\b/i;

const MONEY = [
    // OTP and card or bank secrets
    rx(String.raw`\b(?:otp|o\.t\.p\.?|one[\s-]?time[\s-]?(?:password|pin|code)|verification\s+code|security\s+code|6[\s-]?digit\s+code)(?![a-z])`),
    rx(String.raw`\b(?:cvv|upi\s?pin|atm\s?pin|m-?pin|card\s+number|net\s?banking|ifsc|a{1,2}dh?a{1,2}r|pan\s+card|(?:bank\s+)?account\s+(?:number|no|details))\b`),
    // Gift cards and vouchers
    rx(String.raw`\b(?:gift\s?cards?|google\s?play\s?(?:cards?|codes?|vouchers?)|amazon\s+(?:gift|voucher|pay\s+balance)|itunes\s+cards?|steam\s+(?:cards?|wallet)|vouchers?\s+codes?)\b`),
    // "send money", "lend me some cash", "i need money"
    rx(String.raw`\b(?:send(?:ing)?|giv(?:e|ing)|lend(?:ing)?|transfer(?:ring)?|wire|spare|sponsor|donate)\s+(?:me\s+|us\s+)?(?:(?:some|a\s+little|a\s+few|few|urgent|urgently|little)\s+)?${MONEY_WORD}`),
    rx(String.raw`(?:\b(?:i|we|mujhe|mereko|mujhko)\s+|^\W*)(?:really\s+|urgently\s+|badly\s+)?(?:need|want|require|chahiye)\s+(?:some\s+|urgent\s+|urgently\s+)?(?:money|cash|funds|(?:₹|rs\.?|inr)\s*\d|\d[\d,]*\s*(?:rs\b|rupees|rupaye|rupay|₹))`),
    rx(String.raw`\b(?:money|cash|funds)\s+(?:transfer|urgently|help|chahiye|bhej|do\b|de\b|dedo)`),
    rx(String.raw`\b(?:pay|paying)\s+(?:me|us)\b`),
    rx(String.raw`\bpay(?:ment)?\s+(?:first|advance|upfront|in\s+advance)\b|\badvance\s+(?:payment|fee|amount)\b|\b(?:registration|processing|joining)\s+(?:fee|fees|charges?)\b|\bsecurity\s+deposit\b`),
    // Payment apps: "paytm karo", "gpay kar do", "pay me on paytm", "upi id"
    rx(String.raw`\b${PAY_APP}\s+(?:kar|kr|kra|karo|kro|bhej|send|id|number|no|qr|scan|link|request|dalo|daal)\w*`),
    rx(String.raw`\b(?:pay|send|transfer)\s+(?:\w+\s+){0,2}?(?:via|on|through|using|by|with|to|in)\s+${PAY_APP}\b`),
    rx(String.raw`\b(?:send|share|give|drop|tell|bhejo|batao)\s+(?:me\s+${YOUR}|me|${YOUR})\s+${PAY_APP}\b`),
    // Hinglish: "paise bhejo", "mujhe paise chahiye", "udhaar do"
    rx(String.raw`\b(?:paise|paisa|rupaye|rupay)\s+(?:bhej|bhijwa|do\b|de\b|dedo|de\s?do|chahiye|chahie|chaiye|transfer|send|dalo|daal)`),
    rx(String.raw`\b(?:mujhe|mereko|mujhko|mjhe|mjhko|mere\s+ko)\s+(?:kuch\s+|thode\s+)?(?:paise|paisa|rupaye|money|cash)\b`),
    rx(String.raw`\b(?:udhaar|udhar|udhaari|loan)\s+(?:do|de|dedo|chahiye|mil|milega|milegi|milenge)\b`),
    // Recharge begging: "recharge kar do"
    rx(String.raw`\brecharge\s*(?:kar|kr|krdo|kardo|karo|karwa|kra|plz|pls|please|do\b|dedo|de\b|karde|krde|kro)\w*`),
    rx(String.raw`\b(?:my|mera|meri|mere)\s+(?:phone\s+|mobile\s+|dth\s+|sim\s+)?recharge\b|\bfree\s+recharge\b`),
    // Typical bait
    rx(String.raw`\b(?:earn|make)\s+(?:up\s+to\s+)?(?:₹|rs\.?|inr|\$)\s?\d|\b(?:guaranteed|assured|fixed)\s+(?:profit|returns?|income)\b|\bdouble\s+(?:your\s+)?money\b|\binvest(?:ment)?\s+(?:plan|scheme|opportunity|tips?|app|group)\b|\bcrypto\s+(?:giveaway|trading\s+group|signals?)\b|\b(?:lottery|jackpot)\s+(?:winner|won|prize)\b`),
    // Devanagari
    rx(String.raw`ओटीपी|ओ\.?टी\.?पी|पैसे\s+(?:भेजो|भेज\s?दो|दो|दे|चाहिए)|(?:पेटीएम|फोनपे|गूगल\s?पे|जीपे)\s+(?:करो|कर\s?दो|कर\s?दे)`),
];

// ---------- explicit asks: pictures, private video, sexual talk ----------

const PIC = String.raw`(?:pics?|pix|photos?|photu|selfies?|selfi|dp|nudes?)`;

const EXPLICIT = [
    // "send pic", "send me ur photos", "share your selfie", "show me your body"
    rx(String.raw`\b(?:send|share|show|drop|give|upload|dikhao|dikha|bhejo|bhej)\s+(?:me\s+|us\s+|mujhe\s+)?(?:(?:your|ur|ure|a|an|some|apni|apna|tumhari|teri|tera)\s+)?(?:(?:real|own|latest|recent|hot|sexy|full|private)\s+)*(?:${PIC}|body)\b`),
    // "pic bhejo", "photo do", "selfie dikhao"
    rx(String.raw`\b${PIC}\s+(?:bhej|bhejo|do|dedo|de|dikhao|dikha|send|share|kar|karo)\b`),
    rx(String.raw`\b(?:can|may|could)\s+(?:i|we)\s+see\s+(?:your|ur)\s+(?:face|pic|pics|photo|photos|body|selfie)`),
    rx(String.raw`^\W*${PIC}\W*$`),
    // Nudes and sexual talk
    rx(String.raw`\bnudes?\b|\bnsfw\b|\bsexting\b|\bsext\b|\bsex\s?chat\b|\bhorny\b|\bhook\s?up\b|\bone\s+night\s+stand\b|\bdtf\b|\btopless\b`),
    rx(String.raw`\b(?:wanna|want\s+to|let'?s|lets)\s+(?:have\s+)?sex\b`),
    rx(String.raw`\b(?:show|send|dikhao|dikha|bhejo)\s+(?:me\s+)?(?:(?:your|ur|apni|apna)\s+)?(?:boobs|tits|pussy|dick|cock|ass|bum|panties|bra|thighs|figure)\b`),
    // Private video: "private video", "hot pics", "video call on whatsapp", "cam to cam"
    rx(String.raw`\b(?:hot|sexy|spicy|bold|private|naughty|intimate|adult)\s+(?:pics?|photos?|videos?|vids?|chat|call|show|content)\b`),
    rx(String.raw`\b(?:video|vdo|vid)\s?call\s+(?:\w+\s+){0,2}?(?:on|pe|par|per|via|over)\s+${APP}\b`),
    rx(String.raw`\b(?:video|vdo|vid)\s?call\s+(?:kar|karo|kro|karna|karein|karenge|kar\s?lo|krlo|chalo|chale|chalein)\b`),
    rx(String.raw`\bcam\s?(?:to|2)\s?cam\b|\bc2c\b`),
    // Devanagari
    rx(String.raw`(?:फोटो|फ़ोटो|पिक|तस्वीर)\s+(?:भेजो|भेज\s?दो|दिखाओ|दो)`),
];

// ---------- scanning ----------

/**
 * What a stranger's message contains. kinds is a subset of KINDS (in that order):
 * phone, upi, social, link, email, money, explicit-ask. Never throws; non-strings are clean.
 */
export function scanMessage(text) {
    const p = prepare(text);
    if (!p) return { risky: false, kinds: [] };
    const f = p.norm;
    const addresses = addressSpans(f);
    const rest = blank(f, addresses); // links, handles and the like are judged without the emails and UPI ids
    const found = {
        phone: phoneSpans(f).length > 0,
        upi: addresses.some(a => a.kind === 'upi'),
        social: anyOf(SOCIAL, rest),
        link: anyOf(LINK, rest),
        email: addresses.some(a => a.kind === 'email'),
        money: anyOf(MONEY, rest) || (addresses.some(a => a.kind === 'upi') && PAY_VERB.test(rest)),
        'explicit-ask': anyOf(EXPLICIT, rest),
    };
    const kinds = KINDS.filter(k => found[k]);
    return { risky: kinds.length > 0, kinds };
}

// ---------- masking ----------

/** The name part of an email or UPI id: keeps one or two characters and ends in bullets, so the result isn't an address any more. */
function maskLocal(local) {
    const keep = local.length >= 4 ? 2 : local.length >= 2 ? 1 : 0;
    return local.slice(0, keep) + MASK.repeat(local.length - keep);
}

function maskAddress(span) {
    const at = span.lastIndexOf('@');
    if (at === 0) return span; // a bare handle like @oksbi has nothing personal in it
    if (at > 0) return maskLocal(span.slice(0, at)) + span.slice(at);
    return span.slice(0, 2) + MASK.repeat(Math.max(0, span.length - 2)); // "name at gmail dot com"
}

/** Phone numbers, UPI ids and emails partially hidden (98•••••210, ra•••@okaxis) for a "show anyway" toggle. */
export function maskContact(text) {
    const p = prepare(text);
    if (!p) return '';
    const spans = [
        ...phoneSpans(p.norm).map(x => ({ s: x.s, e: x.e, units: x.units, address: false })),
        ...addressSpans(p.norm).map(x => ({ s: x.s, e: x.e, units: [], address: true })),
    ].sort((a, b) => a.s - b.s || b.e - a.e);

    // Overlapping finds (a phone number inside a UPI id) become one span, treated as an address.
    const merged = [];
    for (const span of spans) {
        const last = merged[merged.length - 1];
        if (last && span.s < last.e) {
            last.e = Math.max(last.e, span.e);
            last.address ||= span.address;
        } else {
            merged.push({ ...span });
        }
    }

    // Edit the text as it was typed: only the masked digits, words and addresses change, never emoji or hidden characters elsewhere.
    let out = '';
    let pos = 0;
    const put = (s, e, replacement) => {
        const [from, to] = origRange(p, s, e);
        out += p.src.slice(pos, from) + replacement;
        pos = Math.max(pos, to);
    };
    for (const m of merged) {
        if (m.address) {
            put(m.s, m.e, maskAddress(p.norm.slice(m.s, m.e)));
            continue;
        }
        // keep the first two and last three digits (or digit words): 98•••••210
        m.units.forEach(([s, e], k) => {
            if (k >= 2 && k < m.units.length - 3) put(s, e, MASK);
        });
    }
    return out + p.src.slice(pos);
}

// ---------- profanity ----------

// Look-alike digits and symbols read as the letter they imitate; * # % ^ ? stand for any one letter (f*ck) and become '_'.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '*': '_', '#': '_', '%': '_', '^': '_', '?': '_' };
const readLeet = t => t.replace(/[0-9@$!|+*#%^?]/g, c => LEET[c] ?? c);
const TOKEN = /[\p{L}\p{M}\p{N}@$!|+*#%^?]+/gu;
const SYMBOL = /[@$!|+*#%^?]/u;

/** The word without the symbols hugging its ends ("shit!!" -> "shit"); a loop, since an end-anchored pattern is quadratic on long runs. */
function trimSymbols(t) {
    let a = 0;
    let b = t.length;
    while (a < b && SYMBOL.test(t[a])) a++;
    while (b > a && SYMBOL.test(t[b - 1])) b--;
    return t.slice(a, b);
}
const MAX_TOKEN = 32; // longer than any word listed here; keeps the quantifier-heavy patterns cheap on junk

// Judged on whole words so that class, assistant, Scunthorpe, cocktail, shiitake and Dickens stay innocent. Only stems that no
// ordinary word contains are matched inside a word (SUB) or at its start (PREFIX). `+` allows stretched letters (fuuuck),
// [x_] lets a * # % stand in for a letter (f*ck, sh*t). Latin spellings of Hindi abuse included; "chod", "gand"-less "ganda",
// "choti", "chutti" (holiday), "bhosari" (a place), "haram" and the like are deliberately not in the lists.
const BAD_SUB = [
    String.raw`(?:f+|ph+)[uv_]*c+k`, // fuck, fck, f*ck, phuck, motherfucker
    String.raw`f+[uv]+_+k`, // fu*k
];
const BAD_PREFIX = [
    String.raw`(?:(?:so|su)nofa)?b+(?:[i_]+a?|ea)t+c+h`, // bitch, biatch, b*tch, bitchy, sonofabitch
    String.raw`p+[o_]+r+n`, // porn, porno, pornography, pornhub
    String.raw`m+[a_]*d+h*[ae_]*r+c+h+[o_]+d+`, // madarchod, maderchod, madharchod
    String.raw`b+[aeih_]*n+c+h+[o_]+d+`, // behenchod, bhenchod, benchod
    String.raw`bh+[o_]+n?s+[a_]?d`, // bhosdi, bhosdike, bhosad
    String.raw`b+a+k+ch+o+d`, // bakchod, bakchodi
    String.raw`h+a+r+a+m+(?:i+|zad|zaad|khor)`, // harami, haramzada, haramkhor
];
const BAD_WHOLE = [
    String.raw`(?:bull|horse|dip|ape|bat|holy|chicken)?sh+[i_]+t+(?:s|y|ier|iest|ing|ed|head|face|faced|hole|bag|show|storm|post|load|er)?`,
    String.raw`sh[i_]te`,
    String.raw`d+[i_]+c+k+(?:s|head|heads|face|wad|ish)?`,
    String.raw`c+[o_]+c+k+(?:s|sucker|suckers|sucking|head|blocker)?`,
    String.raw`c+[u_]+n+t+(?:s|y|ish)?`,
    String.raw`p+[u_]+s{2,}(?:y+|ie|ies)`,
    String.raw`p+u+_{1,2}y+`,
    String.raw`wh+[o_]+r+e+(?:s|d|house|monger|ish)?`,
    String.raw`sl+[u_]+t+(?:s|y|ier|iest|ish)?`,
    String.raw`f+a+g+(?:s|g?ots?|gy)?`,
    String.raw`n+[i_]+g{2,}(?:a|as|ah|ahs|er|ers|uh|az|ar)`,
    String.raw`r+e+t+a+r+d+(?:s|ed)?`,
    String.raw`n+u+d+e+s?`,
    String.raw`b+a+s+t+a+r+d+s?`,
    String.raw`(?:a+s{2,}|a+r+s+e+)h+o+l+e+s?`,
    String.raw`w+a+n+k+(?:e+r+s?|ing)?`,
    String.raw`t+w+a+t+s?`,
    String.raw`f+[uv]+[kq]+(?:e?r|in|ing|ed|s)?`, // fuk, fuq, fuking
    String.raw`f+_{1,2}k+(?:ing|er|ed|s)?`, // f*k
    // Hinglish
    String.raw`mc|bc|mkc|bsdk|bhsdk|bkl`,
    String.raw`ch(?:u+|oo+)t+(?:i+y+[aeou]*(?:pa|pan|panti)?|i+a+|iye)?`, // chut, chutiya, chootiya (not chutti, chute, chhut)
    String.raw`g+a+n+d+(?:u+|fat|marau?)?`,
    String.raw`l+u+n+d+s?`,
    String.raw`l+a+[uvw]+d+[aeu]+`,
    String.raw`r+a+n+d+(?:i+|wa|we|ya)`,
    String.raw`jh+a+n+t+[ueo]*|jh+a+t+u+`,
    String.raw`bh+a+d+[vw]+[aeiu]+`,
    String.raw`ch+u+d+(?:ai|wa|asi|ayi)`,
    String.raw`ku+t{2,}i+y+a+`,
];
const SUB_RX = new RegExp(BAD_SUB.join('|'), 'u');
const PREFIX_RX = new RegExp(`^(?:${BAD_PREFIX.join('|')})`, 'u');
const WHOLE_RX = new RegExp(`^(?:${BAD_WHOLE.join('|')})$`, 'u');
const LONG_RX = /fuck|bitch/u;

// Devanagari: nukta dots dropped, chandrabindu read as anusvara, n/ṇ + virama + ḍ as anusvara (लण्ड = लंड), then whole words.
const devanagari = t => t.replace(/़/g, '').replace(/ँ/g, 'ं').replace(/[णन]्(?=ड)/g, 'ं');
const DEV_WORDS = new Set([
    'मादरचोद', 'बहनचोद', 'भेनचोद', 'बकचोद', 'भोसड़ी', 'भोसड़ीके', 'भोसड़ा', 'चूतिया', 'चुतिया', 'चूतिये', 'चुतिये', 'चूत', 'चुत',
    'गांडू', 'गांड', 'लौड़ा', 'लंड', 'रंडी', 'हरामी', 'हरामखोर', 'हरामज़ादा', 'हरामज़ादे', 'झांट', 'भड़वा',
].map(devanagari));
const DEV_COMPOUND = /^(?:मादर|बहन|भेन|बक)चोद/u;

/** One word, already lower-cased and with look-alike symbols read as letters. */
function badWord(v) {
    if (v.length < 2) return false;
    if (/\p{Script=Devanagari}/u.test(v)) {
        const d = devanagari(v);
        return DEV_WORDS.has(d) || DEV_COMPOUND.test(d);
    }
    if (v.length > MAX_TOKEN) return LONG_RX.test(v.replace(/(.)\1+/gu, '$1').replace(/_/g, '')); // junk: collapse stretched letters first
    if (v.replace(/_/g, '').length < 2) return false; // **** is censoring, not a word
    return SUB_RX.test(v) || PREFIX_RX.test(v) || WHOLE_RX.test(v);
}

/** A word as typed, with and without the symbols hugging its ends ("shit!", "$hit"), and its CamelCase parts (LundKing). */
function profaneToken(t) {
    const lower = t.toLowerCase();
    if (badWord(readLeet(lower)) || badWord(readLeet(trimSymbols(lower)))) return true;
    if (!/\p{Ll}\p{Lu}/u.test(t)) return false;
    return t.split(/(?<=\p{Ll})(?=\p{Lu})/u).some(part => part.length >= 3 && badWord(readLeet(part.toLowerCase())));
}

/**
 * True when the text contains a swear word: English, and Hindi in Latin letters or Devanagari. Works on whole words, so innocent
 * words that merely contain one (class, cocktail, Scunthorpe) pass; copes with f*ck, sh1t, b!tch, fuuuck, "f u c k" and fancy fonts.
 * It is a conservative list, not a complete one. Never throws; non-strings are clean.
 */
export function isProfane(text) {
    const p = prepare(text);
    if (!p) return false;
    const seen = new Set();
    const test = t => {
        if (seen.has(t)) return false;
        seen.add(t);
        return profaneToken(t);
    };
    let run = ''; // one-character words in a row: "f u c k", "b.i.t.c.h"
    let runEnd = -1;
    for (const m of p.norm.matchAll(TOKEN)) {
        const t = m[0];
        if (t.length === 1 && (run === '' || m.index - runEnd <= 3)) {
            run += t;
            runEnd = m.index + 1;
            continue;
        }
        if (run.length >= 3 && test(run)) return true;
        run = t.length === 1 ? t : '';
        runEnd = m.index + t.length;
        if (t.length > 1 && test(t)) return true;
    }
    return run.length >= 3 && test(run);
}
