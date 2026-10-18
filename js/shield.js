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

const INVISIBLE = /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const FOLDABLE = /[\uFF01-\uFF5E\u0660-\u0669\u06F0-\u06F9\u0966-\u096F]/g;

/** Full-width ASCII and Arabic/Devanagari digits -> plain ASCII, one code unit for one. */
function foldChar(c) {
    const n = c.charCodeAt(0);
    if (n >= 0xFF01) return String.fromCharCode(n - 0xFEE0);
    if (n >= 0x0966) return String.fromCharCode(48 + n - 0x0966);
    if (n >= 0x06F0) return String.fromCharCode(48 + n - 0x06F0);
    return String.fromCharCode(48 + n - 0x0660);
}

/** { clean, folded } with equal length (so spans found in folded text apply to clean), or null for non-strings. */
function prepare(text) {
    if (typeof text !== 'string') return null;
    const clean = text.slice(0, MAX_LEN).replace(INVISIBLE, '');
    return { clean, folded: clean.replace(FOLDABLE, foldChar) };
}

// Patterns without the g flag are used with test(); g patterns only with matchAll(), which keeps them stateless.
const rx = (source, flags = 'iu') => new RegExp(source, flags);
const anyOf = (list, text) => list.some(re => re.test(text));

// ---------- phone numbers ----------

// Optional +91 / 91 / 0 prefix (group 1), then ten digits starting 6-9 (group 2) with spaces, dots or dashes between.
const MOBILE = /(?<!\d|\d[.\-])((?:(?:\+|00)[\s.\-]?)?\(?91\)?[\s.\-]{0,2}0?|0[\s.\-]?)?([6-9]\d(?:[\s.\-]{0,2}\d){8})(?!\d)/gu;
const INTL = /(?<![\w+])\+\d{1,3}(?:[\s.\-()]{0,3}\d){8,13}(?!\d)/gu;
const LONG_DIGITS = /(?<!\d|\d[.,])\d{10,}/gu;

// Ten or more single digits spelled out, in English or Hinglish ("nine eight seven ...").
const DIGIT_WORDS = 'zero|one|two|three|four|five|six|seven|eight|nine|ek|do|teen|char|chaar|paanch|panch|chhe|chhah|saat|aath|nau|shunya|sifar';
const SPELLED = rx(String.raw`(?<![a-z\d])(?:(?:${DIGIT_WORDS}|\d)(?![a-z\d])[\s,.\-]*){10,}`, 'giu');

/** Non-overlapping phone spans { s, e, from }; `from` is where the number proper starts (after +91 etc.). */
function phoneSpans(f) {
    const spans = [];
    const add = (s, e, from = s) => {
        if (!spans.some(x => s < x.e && e > x.s)) spans.push({ s, e, from });
    };
    for (const m of f.matchAll(MOBILE)) add(m.index, m.index + m[0].length, m.index + (m[1] ? m[1].length : 0));
    for (const m of f.matchAll(INTL)) add(m.index, m.index + m[0].length);
    for (const m of f.matchAll(SPELLED)) add(m.index, m.index + m[0].replace(/[\s,.\-]+$/, '').length);
    for (const m of f.matchAll(LONG_DIGITS)) add(m.index, m.index + m[0].length);
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
    const f = p.folded;
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

const UNIT = /\p{Nd}|[a-z]+/giu; // one digit in any script, or one spelled-out digit word

/** Keeps the first two and last three digits (or spelled-out digit words) and bullets out the rest: 98•••••210. */
function maskUnits(s, skip = 0) {
    const body = s.slice(skip);
    const total = (body.match(UNIT) || []).length;
    let i = 0;
    return s.slice(0, skip) + body.replace(UNIT, u => {
        const k = i++;
        return k < 2 || k >= total - 3 ? u : MASK;
    });
}

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
        ...phoneSpans(p.folded).map(x => ({ s: x.s, e: x.e, from: x.from, address: false })),
        ...addressSpans(p.folded).map(x => ({ s: x.s, e: x.e, from: x.s, address: true })),
    ].sort((a, b) => a.s - b.s || b.e - a.e);

    // Overlapping finds (a phone number inside a UPI id) become one span, treated as an address.
    const merged = [];
    for (const span of spans) {
        const last = merged[merged.length - 1];
        if (last && span.s < last.e) {
            last.e = Math.max(last.e, span.e);
            last.address ||= span.address;
            last.from = last.s;
        } else {
            merged.push({ ...span });
        }
    }

    let out = '';
    let pos = 0;
    for (const m of merged) {
        const piece = p.clean.slice(m.s, m.e);
        out += p.clean.slice(pos, m.s) + (m.address ? maskAddress(piece) : maskUnits(piece, m.from - m.s));
        pos = m.e;
    }
    return out + p.clean.slice(pos);
}
