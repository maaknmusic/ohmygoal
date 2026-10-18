// Word chain. Each word must start with the last letter of the previous word.
//
// Move: { word: string } or { timeout: true } (sent by the side on turn when its clock runs out).
// A bad word (too short/long, wrong letters, wrong first letter, already used) or a timeout costs
// a heart and passes the turn; the required letter stays. 3 hearts each, 0 hearts loses.
// Turn time starts at 20 s and shrinks by 1 s per round (two turns) down to 8 s.
//
// Scripts (kept simple, no mixing inside a word):
//   Latin: a-z, case-insensitive (stored lower-case). Last letter = last character.
//   Devanagari: base letters are independent vowels (U+0904-0914, U+0960-0961) and consonants
//   (U+0915-0939); everything else allowed is a mark (candrabindu, anusvara, visarga, nukta, matras,
//   virama, ...). Words are NFC-normalised. Last letter = last base character after dropping
//   trailing marks, e.g. गाना -> न, विद्या -> य, सम्राट् -> ट.
// Length is counted in characters (UTF-16 units; all allowed letters are in the BMP).

export const HEARTS = 3;
export const MIN_LENGTH = 2;
export const MAX_LENGTH = 24;
export const START_MS = 20000;
export const MIN_MS = 8000;
const MAX_RAW = 64; // anything longer is malformed, not just a bad word

const LATIN = /^[A-Za-z]+$/;
const DEVANAGARI = /^[ऄ-हॠॡ][ऄ-हॠॡऀ-ःऺ-ॏॢॣ]*$/;
const DEV_MARK = /[ऀ-ःऺ-ॏॢॣ]/;

const other = p => (p === 'A' ? 'B' : 'A');
const isPlayer = p => p === 'A' || p === 'B';
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function normalize(raw) {
    const w = String(raw).trim().normalize('NFC');
    return LATIN.test(w) ? w.toLowerCase() : w;
}

/** The letter the next word must start with. */
export function lastLetter(word) {
    let i = word.length - 1;
    while (i > 0 && DEV_MARK.test(word[i])) i--;
    return word[i];
}

/** Judge a word against the chain: { ok, word, reason }. `word` is normalised ('' if not even letters). */
export function checkWord(state, raw) {
    const word = normalize(raw);
    const letters = LATIN.test(word) || DEVANAGARI.test(word);
    const fail = reason => ({ ok: false, word: letters ? word : '', reason });
    if (!letters) return fail(word.length < MIN_LENGTH ? 'Too short' : 'Letters only');
    if (word.length < MIN_LENGTH) return fail('Too short');
    if (word.length > MAX_LENGTH) return fail('Too long');
    if (state.need && word[0] !== state.need) return fail(`Must start with ${state.need}`);
    if (state.words.includes(word)) return fail('Already used');
    return { ok: true, word, reason: '' };
}

function init({ first } = {}) {
    const f = first === 'B' ? 'B' : 'A';
    return { first: f, turn: f, hearts: { A: HEARTS, B: HEARTS }, words: [], need: null, turns: 0, last: null, winner: null };
}

function validMove(state, player, move) {
    if (!isPlayer(player) || state.winner !== null || player !== state.turn || !isObj(move)) return false;
    const keys = Object.keys(move);
    if (keys.length !== 1) return false;
    if (keys[0] === 'timeout') return move.timeout === true;
    return keys[0] === 'word' && typeof move.word === 'string' && move.word.length <= MAX_RAW;
}

function apply(state, player, move) {
    const timeout = move.timeout === true;
    const check = timeout ? { ok: false, word: '', reason: 'Time ran out' } : checkWord(state, move.word);
    const hearts = { ...state.hearts };
    if (!check.ok) hearts[player] -= 1;
    return {
        ...state, hearts,
        words: check.ok ? [...state.words, check.word] : state.words.slice(),
        need: check.ok ? lastLetter(check.word) : state.need,
        turn: other(player), turns: state.turns + 1,
        last: { player, word: check.word, ok: check.ok, timeout, reason: check.reason },
        winner: hearts[player] <= 0 ? other(player) : null,
    };
}

function status(state) {
    const over = state.winner !== null;
    let summary = state.need ? `Next word starts with ${state.need}` : 'Any word to start';
    if (over) summary = 'Out of hearts';
    return { over, winner: state.winner, turn: over ? null : state.turn, summary };
}

function timeLimitMs(state) {
    if (state.winner !== null) return null;
    return Math.max(MIN_MS, START_MS - 1000 * Math.floor(state.turns / 2));
}

export default {
    id: 'wordchain', name: 'Word Chain', emoji: '🔤', blurb: 'Start your word with their last letter.',
    players: 2, simultaneous: false, init, validMove, apply, status, timeLimitMs,
};
