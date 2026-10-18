// =====================================================================
// Anonymous identity for strangers: a friendly handle and an emoji avatar.
// Pure functions (no DOM); anything received from the peer goes through
// sanitizeHandle() / sanitizeAvatar() before it is shown.
// =====================================================================

import { scanMessage, isProfane, stripInvisible } from './shield.js';

const MAX_HANDLE = 20;
const MAX_DIGITS = 5; // six or more digits in a nickname is a phone number or an id, whatever else is around them
const DEFAULT_HUE = 210;

// Kept to 8 + 9 letters at most, so word + word + two digits always fits in MAX_HANDLE.
// Colour words that could read as skin tone, and nouns that double as insults, are left out on purpose.
const WORDS = [
    'Chai', 'Masala', 'Monsoon', 'Bindaas', 'Jugaad', 'Desi', 'Filmy', 'Chill', 'Sunny', 'Rangeela',
    'Mast', 'Josh', 'Tadka', 'Toofani', 'Zen', 'Lucky', 'Cosmic', 'Pixel', 'Neon', 'Jolly',
    'Happy', 'Breezy', 'Dhamaal', 'Shanti', 'Haldi', 'Mirchi', 'Elaichi', 'Gulabi', 'Golden', 'Silver',
    'Misty', 'Starry', 'Groovy', 'Funky', 'Snazzy', 'Zippy', 'Peppy', 'Cheery', 'Swift', 'Brave',
    'Clever', 'Witty', 'Mellow', 'Cozy', 'Dreamy', 'Sparky', 'Turbo', 'Retro', 'Lunar', 'Solar',
    'Velvet', 'Tiny', 'Mighty', 'Royal', 'Nimbu', 'Jalebi', 'Kulfi', 'Rimjhim', 'Badal', 'Sitara',
    'Chatpata', 'Pista',
];

const THINGS = [
    'Panda', 'Tiger', 'Mango', 'Peacock', 'Owl', 'Koala', 'Lotus', 'Comet', 'Fox', 'Elephant',
    'Parrot', 'Myna', 'Koel', 'Sparrow', 'Dolphin', 'Turtle', 'Otter', 'Penguin', 'Falcon', 'Eagle',
    'Squirrel', 'Rabbit', 'Deer', 'Camel', 'Yak', 'Lion', 'Leopard', 'Cheetah', 'Rhino', 'Bulbul',
    'Zebra', 'Giraffe', 'Hedgehog', 'Firefly', 'Butterfly', 'Dragonfly', 'Mongoose', 'Gecko', 'Llama', 'Robin',
    'Heron', 'Swan', 'Kite', 'Patang', 'Diya', 'Rangoli', 'Sitar', 'Tabla', 'Dhol', 'Banyan',
    'Jasmine', 'Marigold', 'Moon', 'Star', 'Cloud', 'Meteor', 'Nebula', 'Pebble', 'Laddoo', 'Samosa',
    'Rocket', 'Koi',
];

const SKIP_NUMBERS = new Set([69, 88]); // innuendo / hate-symbol numbers

// Words that must not appear where a word and a thing meet (ToofaniGecko, SitaraPenguin); inside one word they are fine.
const SEAM = /nig|rape|tit|cum|sex|ass|mc|bc|fag|anal|anus|dick|boob|porn|slut|piss|poop|shit|fuck|chut|gand|lund|randi|bhos/g;

// Names that pose as the service or its staff would borrow trust from the stranger reading them ("Admin", "OhMyGoal Support").
const OFFICIAL = new Set(['admin', 'administrator', 'moderator', 'support', 'official', 'staff', 'helpdesk', 'verified', 'police', 'cybercell']);
const OFFICIAL_BRAND = /ohmygoal|customercare|cybercell|trustandsafety/;
const LEET_DIGITS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };

// Friendly animal and nature emoji, all single code points (no variation selectors).
export const AVATAR_EMOJI = Object.freeze([
    '🐼', '🐯', '🦊', '🦁', '🐨', '🐸', '🐰', '🐻', '🐧', '🦉',
    '🦚', '🦜', '🐢', '🐬', '🐳', '🦋', '🐝', '🐞', '🦄', '🐙',
    '🦒', '🐘', '🦓', '🦔', '🐱', '🐶', '🐹', '🦦', '🐠', '🦩',
    '🐥', '🌸', '🌻', '🌵', '🍀', '🌈', '⭐', '🌙', '🍉', '🥭',
    '🌊', '🍄', '🌴', '🌺', '🪐',
]);
const EMOJI_SET = new Set(AVATAR_EMOJI);

/** Random index below n; tolerates a rand() that returns garbage. */
function pickIndex(n, rand) {
    const r = Number(rand());
    return Number.isFinite(r) ? Math.min(n - 1, Math.max(0, Math.floor(r * n))) : 0;
}

const pick = (list, rand) => list[pickIndex(list.length, rand)];
const isHue = h => Number.isInteger(h) && h >= 0 && h < 360;

/** True when the two words, written together, spell one of the SEAM words across the join. */
function awkward(word, thing) {
    const joined = (word + thing).toLowerCase();
    for (const m of joined.matchAll(SEAM)) {
        if (m.index < word.length && m.index + m[0].length > word.length) return true;
    }
    return false;
}

/** e.g. 'ChaiPanda42', 'MonsoonFox', 'BindaasOwl7'. */
export function generateHandle(rand = Math.random) {
    if (typeof rand !== 'function') rand = Math.random;
    const word = pick(WORDS, rand);
    let i = pickIndex(THINGS.length, rand);
    for (let tries = 0; tries < THINGS.length && awkward(word, THINGS[i]); tries++) i = (i + 1) % THINGS.length;
    let handle = word + THINGS[i];
    if (rand() < 0.6) {
        let n = pickIndex(100, rand);
        if (SKIP_NUMBERS.has(n)) n++;
        handle += n;
    }
    return handle.slice(0, MAX_HANDLE);
}

/** { e: emoji, h: hue 0-359 } */
export function generateAvatar(rand = Math.random) {
    if (typeof rand !== 'function') rand = Math.random;
    return { e: pick(AVATAR_EMOJI, rand), h: pickIndex(360, rand) };
}

/** An avatar received from the peer, or null if it isn't one we could have generated. */
export function sanitizeAvatar(x) {
    if (!x || typeof x !== 'object') return null;
    const { e, h } = x;
    return typeof e === 'string' && EMOJI_SET.has(e) && isHue(h) ? { e, h: h + 0 } : null; // + 0 turns -0 into 0
}

/** True for a name that poses as the service or its staff: whole words only (Admin, Admin2, RahulAdmin, Adm1n; not Badminton). */
function impersonates(name) {
    const readDigits = t => t.replace(/[013457]/g, d => LEET_DIGITS[d]);
    const words = name.split(/[ ._-]+|(?<=\p{Ll})(?=\p{Lu})/u).map(w => w.toLowerCase());
    if (words.some(w => OFFICIAL.has(readDigits(w)) || OFFICIAL.has(w.replace(/\d+/g, '')))) return true;
    return OFFICIAL_BRAND.test(readDigits(name.toLowerCase()).replace(/[^a-z]/g, ''));
}

/**
 * A display name the peer chose: letters (any script), digits, spaces and . _ - only, at most 20 characters, with every
 * invisible character dropped. Returns '' when nothing usable is left, when the name carries six or more digits, trips the
 * scam shield (a phone number, Instagram id or link in a nickname), swears, or poses as the service or its staff; the app
 * shows 'Stranger'. The full text is judged as well as the 20 characters that would be shown.
 */
export function sanitizeHandle(s) {
    if (typeof s !== 'string') return '';
    const clean = stripInvisible(s.slice(0, 200).normalize('NFKC'))
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{M}\p{N} ._-]/gu, '')
        .replace(/(^|[^\p{L}\p{M}])\p{M}+/gu, '$1') // combining marks need a letter to sit on...
        .replace(/(\p{L}\p{M}{3})\p{M}+/gu, '$1') // ...and may not pile up (Zalgo text)
        .replace(/ {2,}/g, ' ')
        .trim()
        .normalize('NFC'); // removed characters can leave a letter next to a mark it now composes with
    const out = [...clean].slice(0, MAX_HANDLE).join('').trim();
    if (!/[\p{L}\p{N}]/u.test(out) || (out.match(/\p{N}/gu) || []).length > MAX_DIGITS) return '';
    for (const text of out === clean ? [out] : [out, clean]) {
        if (scanMessage(text).risky || isProfane(text) || impersonates(text)) return '';
    }
    return out;
}

/** CSS background for an avatar bubble: a two-stop gradient from its hue. */
export function avatarStyle(avatar) {
    const h = isHue(avatar?.h) ? avatar.h : DEFAULT_HUE;
    return `linear-gradient(135deg, hsl(${h} 85% 62%), hsl(${(h + 40) % 360} 80% 52%))`;
}
