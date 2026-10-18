// =====================================================================
// Anonymous identity for strangers: a friendly handle and an emoji avatar.
// Pure functions (no DOM); anything received from the peer goes through
// sanitizeHandle() / sanitizeAvatar() before it is shown.
// =====================================================================

import { scanMessage } from './shield.js';

const MAX_HANDLE = 20;
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

// Marks and fillers that show nothing but survive the character filter (variation selectors, blank Hangul and Khmer letters).
const BLANK = /[\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/gu;

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

/**
 * A display name the peer chose: letters (any script), digits, spaces and . _ - only,
 * at most 20 characters. Returns '' when nothing usable is left or the name trips the
 * scam shield (a phone number, Instagram id or link in a nickname); the app shows 'Stranger'.
 */
export function sanitizeHandle(s) {
    if (typeof s !== 'string') return '';
    const clean = s.slice(0, 200).normalize('NFKC')
        .replace(BLANK, '')
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{M}\p{N} ._-]/gu, '')
        .replace(/(^|[^\p{L}\p{M}])\p{M}+/gu, '$1') // combining marks need a letter to sit on...
        .replace(/(\p{L}\p{M}{3})\p{M}+/gu, '$1') // ...and may not pile up (Zalgo text)
        .replace(/ {2,}/g, ' ')
        .trim()
        .normalize('NFC'); // removed characters can leave a letter next to a mark it now composes with
    const out = [...clean].slice(0, MAX_HANDLE).join('').trim();
    return /[\p{L}\p{N}]/u.test(out) && !scanMessage(out).risky ? out : '';
}

/** CSS background for an avatar bubble: a two-stop gradient from its hue. */
export function avatarStyle(avatar) {
    const h = isHue(avatar?.h) ? avatar.h : DEFAULT_HUE;
    return `linear-gradient(135deg, hsl(${h} 85% 62%), hsl(${(h + 40) % 360} 80% 52%))`;
}
