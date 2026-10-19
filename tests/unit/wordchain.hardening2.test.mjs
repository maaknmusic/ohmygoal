// Tests for the word chain refusing words that must not reach the board: swear words and anything the scam shield would flag.
// Run: node --test /tmp/claude-0/-home-user-ohmygoal/80ecaa61-e063-55be-81f7-87bba82dfd45/scratchpad/unit/wordchain.hardening2.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = 'file:///home/user/ohmygoal/js/games/';
const { default: wc, checkWord, HEARTS } = await import(ROOT + 'wordchain.js');
const { createGameSession } = await import(ROOT + 'engine.js');

function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        Object.values(o).forEach(deepFreeze);
    }
    return o;
}

/** A state in which `words` have been played, A first, the next player is whoever is due. */
function played(...words) {
    let st = wc.init({ first: 'A' });
    for (const word of words) st = wc.apply(st, st.turn, { word });
    return st;
}

const NOT_ALLOWED = { ok: false, word: '', reason: 'Not allowed' };

describe('wordchain: swear words are not allowed', () => {
    const FIRST = wc.init({});
    const SWEARS = ['fuck', 'Fuck', 'FUCK', 'fucking', 'motherfucker', 'shit', 'shitty', 'bullshit', 'bitch', 'bitches', 'cunt', 'dick', 'dickhead', 'cock', 'pussy', 'whore', 'slut', 'faggot', 'nigga', 'nigger',
        'retard', 'porn', 'pornography', 'nude', 'nudes', 'bastard', 'asshole', 'wanker', 'twat', 'fuuuuck', 'shiiiit', 'biiiitch', 'fuk', 'btch',
        'madarchod', 'maderchod', 'behenchod', 'bhenchod', 'bhosdike', 'bhosdi', 'chutiya', 'chutiye', 'gandu', 'gaandu', 'lund', 'lauda', 'randi', 'harami', 'haramkhor', 'bakchod', 'jhatu', 'bhadwa', 'mc', 'bc', 'bsdk', 'bkl',
        'मादरचोद', 'बहनचोद', 'चूतिया', 'गांडू', 'लंड', 'रंडी', 'हरामी', 'भोसड़ी'];
    for (const w of SWEARS) {
        test(`${JSON.stringify(w)} is refused as the first word`, () => {
            assert.deepEqual(checkWord(FIRST, w), NOT_ALLOWED);
        });
    }

    test('refusal wins over every other reason, so the word is never shown whatever else is wrong with it', () => {
        const st = played('apple'); // next word must start with e
        assert.deepEqual(checkWord(st, 'fuck'), NOT_ALLOWED, 'wrong first letter');
        assert.deepEqual(checkWord(played('fine', 'eagle', 'elbow'), 'whore'), NOT_ALLOWED, 'right first letter (w)');
        assert.deepEqual(checkWord(FIRST, 'fuck' + 'k'.repeat(30)), NOT_ALLOWED, 'too long');
        assert.deepEqual(checkWord(FIRST, 'mc'), NOT_ALLOWED, 'two letters');
        assert.deepEqual(checkWord(FIRST, '  FuCk  '), NOT_ALLOWED, 'spaces and case');
    });

    test('masked and leet spellings are not letters-only, so they are refused for that reason (and never echoed)', () => {
        for (const w of ['f*ck', 'sh1t', 'b!tch', 'f u c k', 'f.u.c.k', 'fu​ck', 'ｆｕｃｋ', '𝐟𝐮𝐜𝐤', 'fúck']) {
            const r = checkWord(FIRST, w);
            assert.equal(r.ok, false, w);
            assert.equal(r.word, '', w);
            assert.equal(r.reason, 'Letters only', w);
        }
    });
});

describe('wordchain: words that share contact details or ask for them are not allowed', () => {
    const FIRST = wc.init({});
    const REFUSED = ['callmeonwhatsapp', 'whatsappme', 'mywhatsapp', 'whatsapp', 'WhatsApp', 'instagram', 'instagrammer', 'snapchat', 'addmeonsnapchat', 'facebook', 'wechat', 'insta', 'fb', 'otp', 'cvv', 'ifsc', 'sext', 'sexting',
        'nsfw', 'horny', 'hookup', 'skype', 'viber', 'dtf', 'topless', 'aadhaar', 'aadhar', 'mpin'];
    for (const w of REFUSED) {
        test(`${JSON.stringify(w)} is refused`, () => assert.deepEqual(checkWord(FIRST, w), NOT_ALLOWED));
    }

    test('a refused word may be too short, too long or out of turn: still just "Not allowed", never echoed', () => {
        assert.deepEqual(checkWord(played('apple'), 'whatsapp'), NOT_ALLOWED);
        assert.deepEqual(checkWord(FIRST, 'callmeonwhatsappnowplease'), NOT_ALLOWED);
        assert.deepEqual(checkWord(FIRST, 'fb'), NOT_ALLOWED);
    });

    const EVERYDAY = ['snap', 'Snap', 'discord', 'messenger', 'telegram', 'photo', 'photos', 'pic', 'pics', 'pix', 'selfie', 'selfies'];
    for (const w of EVERYDAY) {
        test(`${JSON.stringify(w)} is an everyday word and stays playable`, () => {
            assert.deepEqual(checkWord(FIRST, w), { ok: true, word: w.toLowerCase(), reason: '' });
        });
    }
});

describe('wordchain: innocent words are untouched', () => {
    const FIRST = wc.init({});
    const OK = ['class', 'classic', 'assistant', 'assassin', 'scunthorpe', 'cocktail', 'cockpit', 'peacock', 'hancock', 'dickens', 'shiitake', 'shitake', 'bitcoin', 'butter', 'bench', 'witch', 'beach', 'analysis',
        'therapist', 'cucumber', 'document', 'circumstance', 'essex', 'sussex', 'niger', 'nigeria', 'pass', 'grass', 'bass', 'mass', 'push', 'horn', 'duck', 'fact', 'fork', 'twin', 'twitter', 'country', 'ass', 'hell',
        'apple', 'eagle', 'elephant', 'tiger', 'rabbit', 'monsoon', 'chai', 'masala', 'cricket', 'goal', 'football', 'ohmygoal', 'mobile', 'message', 'photo', 'phone', 'number', 'whole', 'slot', 'slug', 'rich', 'which',
        'choti', 'chhota', 'ganda', 'gandhi', 'bhopal', 'bhosle', 'chutki', 'chutney', 'parachute', 'madhur', 'madras', 'madrid', 'lunch', 'laddu', 'randy', 'rand', 'haram', 'bhai', 'behen', 'dost', 'yaar', 'jhansi',
        'छोटी', 'गांधी', 'भारत', 'गाना', 'तारा', 'कमल', 'चोट', 'चूहा', 'हराम', 'गांडीव', 'लड्डू'];
    for (const w of OK) {
        test(`${JSON.stringify(w)} is playable`, () => {
            const r = checkWord(FIRST, w);
            assert.deepEqual(r, { ok: true, word: /^[A-Za-z]+$/.test(w) ? w.toLowerCase() : w.normalize('NFC'), reason: '' });
        });
    }
});

describe('wordchain: a refused word costs a heart like any invalid word, and is never kept', () => {
    test('apply(): a heart, the turn passes, the required letter stays, the word is not echoed or stored', () => {
        const st = deepFreeze(played('apple'));
        for (const w of ['fuck', 'whatsapp', 'callmeonwhatsapp', 'chutiya', 'चूतिया']) {
            const next = wc.apply(st, st.turn, { word: w });
            assert.deepEqual(next.hearts, { A: HEARTS, B: HEARTS - 1 }, w);
            assert.equal(next.need, 'e', w);
            assert.equal(next.turn, 'A', w);
            assert.deepEqual(next.words, ['apple'], w);
            assert.deepEqual(next.last, { player: 'B', word: '', ok: false, timeout: false, reason: 'Not allowed' }, w);
            assert.doesNotMatch(JSON.stringify(next), /chutiya|fuck|whatsapp|चूतिया/i, 'nothing offensive anywhere in the state');
        }
    });

    test('three refused words in a row lose the game', () => {
        let st = wc.init({ first: 'A' });
        st = wc.apply(st, 'A', { word: 'fuck' });
        st = wc.apply(st, 'B', { word: 'apple' });
        st = wc.apply(st, 'A', { word: 'shit' });
        assert.deepEqual(st.hearts, { A: 1, B: 3 });
        st = wc.apply(st, 'B', { word: 'eagle' });
        st = wc.apply(st, 'A', { word: 'instagram' });
        assert.equal(st.hearts.A, 0);
        assert.equal(st.winner, 'B');
        assert.deepEqual(wc.status(st), { over: true, winner: 'B', turn: null, summary: 'Out of hearts' });
    });

    test('a refused word does not change who may start the chain', () => {
        let st = wc.apply(wc.init({}), 'A', { word: 'fuck' });
        assert.equal(st.need, null);
        st = wc.apply(st, 'B', { word: 'kite' });
        assert.deepEqual([st.need, st.words], ['e', ['kite']]);
    });

    test('both sides reach the same state (the check is deterministic and pure)', () => {
        const moves = [['A', 'apple'], ['B', 'eagle'], ['A', 'fuck'], ['B', 'whatsapp'], ['A', 'elbow'], ['B', 'wolf'], ['A', 'snap'], ['B', 'photos'], ['A', 'sheep'], ['B', 'madarchod']];
        const run = () => moves.reduce((st, [p, word]) => (st.turn === p ? wc.apply(st, p, { word }) : st), wc.init({ first: 'A' }));
        const a = run();
        const b = run();
        assert.deepEqual(a, b);
        assert.ok(a.words.length >= 4, JSON.stringify(a.words));
    });

    test('checkWord leaves the state alone and gives the same answer every time', () => {
        const st = deepFreeze(played('apple', 'eagle'));
        for (let i = 0; i < 20; i++) {
            assert.deepEqual(checkWord(st, 'fuck'), NOT_ALLOWED);
            assert.deepEqual(checkWord(st, 'elbow'), { ok: true, word: 'elbow', reason: '' });
            assert.equal(checkWord(st, 'apple').reason, 'Must start with e');
            assert.equal(checkWord(st, 'eagle').reason, 'Already used');
        }
    });

    test('the other reasons still apply as before to words that are fine', () => {
        const st = played('apple');
        assert.equal(checkWord(st, 'tiger').reason, 'Must start with e');
        assert.equal(checkWord(played('apple', 'eagle'), 'eagle').reason, 'Already used');
        assert.equal(checkWord(st, 'e').reason, 'Too short');
        assert.equal(checkWord(st, 'e' + 'x'.repeat(24)).reason, 'Too long');
        assert.equal(checkWord(st, 'e1').reason, 'Letters only');
    });
});

describe('wordchain: odd input never crashes checkWord', () => {
    test('a non-string word is just not letters', () => {
        const st = wc.init({});
        for (const raw of [undefined, null, 5, NaN, true, {}, [], ['apple'], () => 'apple', Symbol('s'), 10n, new Date(), /x/, new String('apple'), Object.create(null), { toString() { throw new Error('boom'); } }]) {
            const r = checkWord(st, raw);
            assert.deepEqual(r, { ok: false, word: '', reason: 'Letters only' });
        }
        assert.deepEqual(checkWord(st), { ok: false, word: '', reason: 'Letters only' });
    });

    test('a missing or odd state is treated as the start of a game', () => {
        for (const st of [undefined, null, {}, { words: 'apple' }, { need: null }, { words: null, need: undefined }, 5, 'x']) {
            assert.deepEqual(checkWord(st, 'apple'), { ok: true, word: 'apple', reason: '' });
            assert.deepEqual(checkWord(st, 'fuck'), NOT_ALLOWED);
        }
    });

    test('lone surrogates, control characters, huge strings and emoji', () => {
        const st = wc.init({});
        for (const raw of ['\uD800', 'a\uDC00', '\u0000', 'app\u0000le', '😀😀', 'a'.repeat(100000), '‮apple', '​', ' ', '', '\n', 'applé']) {
            const r = checkWord(st, raw);
            assert.equal(typeof r.ok, 'boolean');
            assert.equal(typeof r.word, 'string');
            assert.equal(typeof r.reason, 'string');
            if (!r.ok) assert.notEqual(r.reason, '');
        }
    });

    test('validMove still bounds the raw word before checkWord ever sees it', () => {
        const st = wc.init({ first: 'A' });
        assert.equal(wc.validMove(st, 'A', { word: 'a'.repeat(65) }), false);
        assert.equal(wc.validMove(st, 'A', { word: 5 }), false);
        assert.equal(wc.validMove(st, 'A', { word: 'fuck' }), true, 'a swear word is a well-formed move that costs a heart');
    });

    test('a long word is refused or accepted quickly', () => {
        const st = wc.init({});
        let best = Infinity;
        for (let i = 0; i < 4; i++) {
            const t = performance.now();
            for (const w of ['f'.repeat(64), 'fu'.repeat(32), 'b'.repeat(64), 'xX'.repeat(32), 'x'.repeat(64), 'ch'.repeat(32), 'a'.repeat(64), 'ह'.repeat(64)]) checkWord(st, w);
            best = Math.min(best, performance.now() - t);
        }
        assert.ok(best < 50, `${best.toFixed(1)} ms`);
    });
});

describe('wordchain: end to end through the game session', () => {
    function pair() {
        const queue = [];
        const sessions = {};
        const make = me => createGameSession({ me, send: m => queue.push([me === 'A' ? 'B' : 'A', structuredClone(m)]), onChange() {} });
        sessions.A = make('A');
        sessions.B = make('B');
        const settle = () => {
            while (queue.length) {
                const [to, msg] = queue.shift();
                sessions[to].receive(msg);
            }
        };
        return { sessions, settle };
    }

    test('both clients see the same hearts and neither stores a refused word', () => {
        const { sessions, settle } = pair();
        sessions.A.invite('wordchain');
        settle();
        sessions.B.accept();
        settle();
        assert.equal(sessions.A.state().phase, 'playing');
        const turn = () => (sessions.A.state().canMove ? sessions.A : sessions.B);
        assert.equal(turn().move({ word: 'fuck' }), true);
        settle();
        const a = sessions.A.state();
        const b = sessions.B.state();
        assert.deepEqual(a.state, b.state, 'identical on both sides');
        assert.deepEqual(a.state.words, []);
        assert.equal(a.state.last.word, '');
        assert.equal(a.state.last.reason, 'Not allowed');
        assert.equal(Math.min(a.state.hearts.A, a.state.hearts.B), HEARTS - 1);
        assert.equal(turn().move({ word: 'apple' }), true);
        settle();
        assert.deepEqual(sessions.A.state().state.words, ['apple']);
        assert.deepEqual(sessions.A.state().state, sessions.B.state().state);
        sessions.A.dispose();
        sessions.B.dispose();
    });
});
