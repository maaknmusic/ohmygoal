// =====================================================================
// Anonymous identity for strangers: a friendly handle and an emoji avatar.
// Pure functions (no DOM); anything received from the peer goes through
// sanitizeHandle() / sanitizeAvatar() before it is shown.
// =====================================================================

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

/** e.g. 'ChaiPanda42', 'MonsoonFox', 'BindaasOwl7'. */
export function generateHandle(rand = Math.random) {
    if (typeof rand !== 'function') rand = Math.random;
    let handle = pick(WORDS, rand) + pick(THINGS, rand);
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
    return typeof e === 'string' && EMOJI_SET.has(e) && isHue(h) ? { e, h } : null;
}

/**
 * A display name the peer chose: letters (any script), digits, spaces and . _ - only,
 * at most 20 characters. Returns '' when nothing usable is left (the app shows 'Stranger').
 */
export function sanitizeHandle(s) {
    if (typeof s !== 'string') return '';
    const clean = s.slice(0, 200).normalize('NFKC')
        .replace(/[ᅟᅠㅤﾠ]/g, '') // Hangul fillers: "letters" that render blank
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{M}\p{N} ._-]/gu, '')
        .replace(/(^|[^\p{L}\p{M}])\p{M}+/gu, '$1') // combining marks need a letter to sit on...
        .replace(/(\p{L}\p{M}{3})\p{M}+/gu, '$1') // ...and may not pile up (Zalgo text)
        .replace(/ {2,}/g, ' ')
        .trim();
    const out = [...clean].slice(0, MAX_HANDLE).join('').trim();
    return /[\p{L}\p{N}]/u.test(out) ? out : '';
}

/** CSS background for an avatar bubble: a two-stop gradient from its hue. */
export function avatarStyle(avatar) {
    const h = isHue(avatar?.h) ? avatar.h : DEFAULT_HUE;
    return `linear-gradient(135deg, hsl(${h} 85% 62%), hsl(${(h + 40) % 360} 80% 52%))`;
}
