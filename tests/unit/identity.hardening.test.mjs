// Adversarial / regression tests for js/identity.js (each block failed before the matching fix).
// Run: node --test /tmp/claude-0/-home-user-ohmygoal/80ecaa61-e063-55be-81f7-87bba82dfd45/scratchpad/unit/identity.hardening.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const identity = await import('file:///home/user/ohmygoal/js/identity.js');

function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// =====================================================================
// Generated handles: no unfortunate words hiding where two words meet
// =====================================================================

/** Replays generateHandle with chosen rand() values: word, thing, then "no number". */
const handleFor = (r1, r2) => {
    const queue = [r1, r2, 0.99];
    return identity.generateHandle(() => queue.shift() ?? 0.5);
};

/** Every word and every thing the generator can produce, with a rand() value that selects each. */
function inventory() {
    const words = [];
    const things = [];
    const split = h => /^([A-Z][a-z]+)([A-Z][a-z]+)$/.exec(h);
    for (let i = 0; i < 4000; i++) {
        const r = (i + 0.5) / 4000;
        const [, word] = split(handleFor(r, 0));
        if (!words.some(w => w.name === word)) words.push({ name: word, r });
        const [, , thing] = split(handleFor(0, r));
        if (!things.some(t => t.name === thing)) things.push({ name: thing, r });
    }
    return { words, things };
}

describe('identity hardening: generated handles', () => {
    test('the inventory is what the module documents (two lists of about 60 words)', () => {
        const { words, things } = inventory();
        assert.ok(words.length >= 60 && things.length >= 60, `${words.length} x ${things.length}`);
    });

    test('no offensive string appears across the join of the two words', () => {
        const banned = [
            'nig', 'rape', 'tit', 'cum', 'sex', 'ass', 'mc', 'bc', 'fag', 'anal', 'anus', 'cock', 'dick', 'boob', 'butt',
            'porn', 'slut', 'piss', 'poop', 'shit', 'fuck', 'chut', 'gand', 'lund', 'randi', 'bhos',
        ];
        const { words, things } = inventory();
        const offenders = [];
        for (const w of words) {
            for (const t of things) {
                const handle = handleFor(w.r, t.r);
                assert.equal(handle.length <= 20, true);
                const text = handle.toLowerCase();
                const join = w.name.length; // position where the second word starts (the handle has no number here)
                for (const b of banned) {
                    for (let at = text.indexOf(b); at >= 0; at = text.indexOf(b, at + 1)) {
                        if (at < join && at + b.length > join) offenders.push(`${handle} (${b})`);
                    }
                }
            }
        }
        assert.deepEqual(offenders, []);
    });

    test('avoiding an awkward pairing never produces a duplicate-looking or invalid handle', () => {
        const rand = seeded(2024);
        for (let i = 0; i < 20000; i++) {
            const h = identity.generateHandle(rand);
            assert.match(h, /^[A-Z][a-z]+[A-Z][a-z]+(\d{1,2})?$/, h);
            assert.ok(h.length <= 20, h);
        }
    });

    test('every word and every thing is still reachable', () => {
        const { words, things } = inventory();
        const seen = new Set();
        const rand = seeded(9);
        for (let i = 0; i < 60000; i++) seen.add(identity.generateHandle(rand).replace(/\d+$/, ''));
        for (const w of words) assert.ok([...seen].some(h => h.startsWith(w.name)), w.name);
        for (const t of things) assert.ok([...seen].some(h => h.endsWith(t.name)), t.name);
    });
});

// =====================================================================
// sanitizeHandle: contact details smuggled in through the name
// =====================================================================

describe('identity hardening: sanitizeHandle and contact details', () => {
    const SMUGGLED = [
        '9876543210', 'Call 98765 43210', '+91 98765 43210', 'Priya 9876543210', 'nine eight seven six five four three two one zero',
        'insta rahul_99', 'snap priya99', 'add me on snap', 'my id is rahul99', 'dm me on insta',
        'free-gifts.xyz', 'www.evil.com', 'wa.me 9876543210', 'rahul at gmail dot com',
        'Send Nudes', 'nudes', 'Paytm Karo', 'Free Recharge', 'OTP', 'Pic Bhejo',
        'Rahul 9​876543210', 'Rah\u{1F600}ul 98765\u{1F600}43210',
    ];
    for (const name of SMUGGLED) {
        test(`${JSON.stringify(name)} is not shown`, () => {
            assert.equal(identity.sanitizeHandle(name), '');
        });
    }

    const FINE = [
        'Rahul', 'Priya Sharma', 'Amit_99', 'Neha.K', 'Sam-21', 'ChaiPanda42', 'MonsoonFox', 'राहुल शर्मा', 'José Müller', 'Anu 10',
        'Rohan 2002', 'Cricket Fan', 'Mr. Bean', 'Kohli18', 'Dhoni 07', 'Sachin 10 Fan', 'Aarav', 'Tiny Tim', 'Free Bird',
        'Kavya', 'Ravi Kumar', 'Dr Strange', 'Star Boy 7', 'Night Owl', 'Cool_Guy', 'Mango Lassi', 'Zen', 'Maya99', 'Arjun_K',
    ];
    for (const name of FINE) {
        test(`${JSON.stringify(name)} is kept`, () => {
            assert.equal(identity.sanitizeHandle(name), name);
        });
    }

    test('a name that is only fine after clean-up is judged on what would be shown', () => {
        assert.equal(identity.sanitizeHandle('Rahul<script>'), 'Rahulscript');
        assert.equal(identity.sanitizeHandle('Rah@ul'), 'Rahul');
        assert.equal(identity.sanitizeHandle('9876\u{1F600}543\u{1F600}210'), '');
    });

    test('every generated handle survives untouched', () => {
        const { words, things } = inventory();
        for (const w of words) {
            for (const t of things) {
                const h = handleFor(w.r, t.r);
                assert.equal(identity.sanitizeHandle(h), h);
            }
        }
        const rand = seeded(77);
        for (let i = 0; i < 5000; i++) {
            const h = identity.generateHandle(rand);
            assert.equal(identity.sanitizeHandle(h), h);
        }
    });

    test('still idempotent, bounded and clean on random unicode', () => {
        const rand = seeded(31337);
        for (let i = 0; i < 1500; i++) {
            let s = '';
            const n = Math.floor(rand() * 40);
            for (let j = 0; j < n; j++) {
                const r = rand();
                s += r < 0.4 ? String.fromCharCode(32 + Math.floor(rand() * 95))
                    : r < 0.55 ? String.fromCodePoint(0x0900 + Math.floor(rand() * 0x80))
                    : r < 0.65 ? String.fromCodePoint(0x0300 + Math.floor(rand() * 0x70))
                    : r < 0.75 ? String.fromCodePoint(0x1D7CE + Math.floor(rand() * 50))
                    : String.fromCodePoint(Math.floor(rand() * 0x30000));
            }
            const once = identity.sanitizeHandle(s);
            assert.equal(identity.sanitizeHandle(once), once, JSON.stringify(s));
            assert.ok([...once].length <= 20);
            assert.equal(once, once.trim());
            assert.doesNotMatch(once, /[^\p{L}\p{M}\p{N} ._-]/u);
            assert.doesNotMatch(once, / {2}/);
        }
    });
});

// =====================================================================
// sanitizeHandle: invisible marks
// =====================================================================

describe('identity hardening: invisible marks in names', () => {
    test('variation selectors, joiners and blank fillers are dropped', () => {
        const hidden = ['️', '︎', '͏', '឴', '឵', '᠋', '᠌', '᠍', '\u{E0100}', 'ㅤ', 'ﾠ', 'ᅟ', 'ᅠ', '⠀'];
        for (const h of hidden) {
            assert.equal(identity.sanitizeHandle('Rahul' + h), 'Rahul', `U+${h.codePointAt(0).toString(16)}`);
            assert.equal(identity.sanitizeHandle('Ra' + h + 'hul'), 'Rahul', `U+${h.codePointAt(0).toString(16)}`);
            assert.equal(identity.sanitizeHandle(h.repeat(5)), '', `U+${h.codePointAt(0).toString(16)}`);
        }
    });

    test('two names that differ only by invisible marks become the same name', () => {
        assert.equal(identity.sanitizeHandle('Rahul️️'), identity.sanitizeHandle('Rahul'));
        assert.equal(identity.sanitizeHandle('R͏ahul'), identity.sanitizeHandle('Rahul'));
    });

    test('real combining marks and Indic scripts are kept', () => {
        assert.equal(identity.sanitizeHandle('José'), 'José');
        assert.equal(identity.sanitizeHandle('José'), 'José');
        assert.equal(identity.sanitizeHandle('कृष्णा'), 'कृष्णा');
        assert.equal(identity.sanitizeHandle('ਪੰਜਾਬੀ'), 'ਪੰਜਾਬੀ');
        assert.equal(identity.sanitizeHandle('தமிழ்'), 'தமிழ்');
    });
});

// =====================================================================
// sanitizeAvatar / avatarStyle
// =====================================================================

describe('identity hardening: avatars', () => {
    test('a negative zero hue is normalised to zero', () => {
        const out = identity.sanitizeAvatar(JSON.parse('{"e":"\u{1F43C}","h":-0}'));
        assert.ok(Object.is(out.h, 0), String(Object.is(out.h, -0)));
        assert.equal(identity.avatarStyle(out), 'linear-gradient(135deg, hsl(0 85% 62%), hsl(40 80% 52%))');
    });

    test('hostile keys never reach the result', () => {
        const parsed = JSON.parse('{"e":"\u{1F43C}","h":3,"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"toString":"x"}');
        const out = identity.sanitizeAvatar(parsed);
        assert.deepEqual(Object.keys(out), ['e', 'h']);
        assert.equal(Object.getPrototypeOf(out), Object.prototype);
        assert.equal({}.polluted, undefined);
        assert.equal(JSON.stringify(out), '{"e":"\u{1F43C}","h":3}');
    });

    test('avatarStyle is stable for hostile input', () => {
        const re = /^linear-gradient\(135deg, hsl\(\d{1,3} 85% 62%\), hsl\(\d{1,3} 80% 52%\)\)$/;
        for (const bad of [{ h: 1e21 }, { h: -1 }, { h: 359.5 }, { h: '12' }, { h: [12] }, { h: { valueOf: () => 12 } }, { h: 2 ** 31 }, { h: -0 }, Object.create(null)]) {
            assert.match(identity.avatarStyle(bad), re);
        }
    });
});
