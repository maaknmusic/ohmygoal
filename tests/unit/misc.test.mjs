// Unit tests for js/identity.js, js/icebreakers.js and js/shield.js.
// Run: node --test /tmp/claude-0/-home-user-ohmygoal/80ecaa61-e063-55be-81f7-87bba82dfd45/scratchpad/unit/misc.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const identity = await import('file:///home/user/ohmygoal/js/identity.js');
const icebreakers = await import('file:///home/user/ohmygoal/js/icebreakers.js');
const shield = await import('file:///home/user/ohmygoal/js/shield.js');

/** Deterministic rand() from a seed (mulberry32). */
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

const GARBAGE = [undefined, null, 0, 1, NaN, -1, true, false, {}, [], [1, 2], () => 1, Symbol('x'), 10n, new Date(), /x/, { e: '🐼', h: 'x' }];

// =====================================================================
// identity.js
// =====================================================================

describe('identity: generateHandle', () => {
    test('shape: CamelCase words plus optional 0-99 number, at most 20 chars', () => {
        const rand = seeded(1);
        let withNumber = 0;
        let without = 0;
        for (let i = 0; i < 5000; i++) {
            const h = identity.generateHandle(rand);
            assert.match(h, /^[A-Z][a-z]+[A-Z][a-z]+(\d{1,2})?$/, h);
            assert.ok(h.length <= 20, h);
            if (/\d$/.test(h)) withNumber++; else without++;
        }
        assert.ok(withNumber > 1000 && without > 1000, `mix of numbered and plain: ${withNumber}/${without}`);
    });

    test('works with the default Math.random and is not constant', () => {
        const seen = new Set();
        for (let i = 0; i < 200; i++) seen.add(identity.generateHandle());
        assert.ok(seen.size > 100);
    });

    test('is deterministic for a given rand and survives edge-case rand() values', () => {
        assert.equal(identity.generateHandle(seeded(7)), identity.generateHandle(seeded(7)));
        for (const v of [0, 0.999999999, 1, -1, NaN, Infinity, 'x', null, undefined]) {
            const h = identity.generateHandle(() => v);
            assert.equal(typeof h, 'string');
            assert.ok(h.length > 0 && h.length <= 20, String(h));
        }
        assert.equal(typeof identity.generateHandle('nope'), 'string');
    });

    test('never produces a skipped number and every output survives sanitizeHandle unchanged', () => {
        const rand = seeded(99);
        for (let i = 0; i < 5000; i++) {
            const h = identity.generateHandle(rand);
            assert.doesNotMatch(h, /(69|88)$/);
            assert.equal(identity.sanitizeHandle(h), h);
        }
    });

    test('contains the flavour words from the brief', () => {
        const seen = new Set();
        const rand = seeded(5);
        for (let i = 0; i < 20000; i++) seen.add(identity.generateHandle(rand));
        const all = [...seen].join(' ');
        for (const w of ['Chai', 'Masala', 'Monsoon', 'Bindaas', 'Jugaad', 'Desi', 'Filmy', 'Tadka', 'Toofani', 'Panda', 'Mango', 'Peacock', 'Owl', 'Koala', 'Lotus', 'Comet']) {
            assert.ok(all.includes(w), w);
        }
    });
});

describe('identity: avatars', () => {
    test('generateAvatar gives an allowed emoji and an integer hue 0-359', () => {
        const rand = seeded(3);
        const emojis = new Set();
        for (let i = 0; i < 3000; i++) {
            const a = identity.generateAvatar(rand);
            assert.ok(identity.AVATAR_EMOJI.includes(a.e));
            assert.ok(Number.isInteger(a.h) && a.h >= 0 && a.h <= 359, String(a.h));
            assert.deepEqual(identity.sanitizeAvatar(a), a);
            emojis.add(a.e);
        }
        assert.equal(emojis.size, identity.AVATAR_EMOJI.length);
        assert.ok(identity.AVATAR_EMOJI.length >= 40);
        assert.equal(new Set(identity.AVATAR_EMOJI).size, identity.AVATAR_EMOJI.length);
    });

    test('generateAvatar default rand and extreme rand values', () => {
        assert.ok(identity.sanitizeAvatar(identity.generateAvatar()));
        assert.equal(identity.generateAvatar(() => 0).h, 0);
        assert.equal(identity.generateAvatar(() => 0.9999999).h, 359);
        assert.ok(identity.sanitizeAvatar(identity.generateAvatar(() => NaN)));
    });

    test('sanitizeAvatar accepts valid avatars and returns a fresh clean object', () => {
        const input = { e: '🐼', h: 120, extra: '<script>' };
        const out = identity.sanitizeAvatar(input);
        assert.deepEqual(out, { e: '🐼', h: 120 });
        assert.notEqual(out, input);
        assert.deepEqual(identity.sanitizeAvatar({ e: '🐼', h: 0 }), { e: '🐼', h: 0 });
        assert.deepEqual(identity.sanitizeAvatar({ e: '🐼', h: 359 }), { e: '🐼', h: 359 });
    });

    test('sanitizeAvatar rejects anything else without throwing', () => {
        for (const g of GARBAGE) assert.equal(identity.sanitizeAvatar(g), null);
        const bad = [
            { e: '💩', h: 10 }, { e: '🐼' }, { h: 10 }, { e: '🐼', h: -1 }, { e: '🐼', h: 360 },
            { e: '🐼', h: 1.5 }, { e: '🐼', h: '120' }, { e: '🐼', h: NaN }, { e: '🐼', h: Infinity },
            { e: '🐼🐼', h: 10 }, { e: ' 🐼', h: 10 }, { e: '<img src=x>', h: 10 }, { e: 5, h: 10 },
            { e: ['🐼'], h: 10 }, { e: '', h: 10 }, 'string', 42,
        ];
        for (const b of bad) assert.equal(identity.sanitizeAvatar(b), null, JSON.stringify(b));
    });

    test('avatarStyle returns a two-stop gradient from the hue', () => {
        assert.equal(identity.avatarStyle({ h: 200 }), 'linear-gradient(135deg, hsl(200 85% 62%), hsl(240 80% 52%))');
        assert.equal(identity.avatarStyle({ h: 340 }), 'linear-gradient(135deg, hsl(340 85% 62%), hsl(20 80% 52%))');
        assert.match(identity.avatarStyle({ h: 0 }), /^linear-gradient\(135deg, hsl\(0 85% 62%\), hsl\(40 80% 52%\)\)$/);
    });

    test('avatarStyle falls back to a default hue for bad input and never injects text', () => {
        const fallback = identity.avatarStyle({});
        assert.match(fallback, /^linear-gradient\(135deg, hsl\(\d+ 85% 62%\), hsl\(\d+ 80% 52%\)\)$/);
        for (const g of [...GARBAGE, { h: '); evil(' }, { h: 400 }, { h: -5 }]) {
            assert.match(identity.avatarStyle(g), /^linear-gradient\(135deg, hsl\(\d{1,3} 85% 62%\), hsl\(\d{1,3} 80% 52%\)\)$/);
        }
    });
});

describe('identity: sanitizeHandle', () => {
    test('keeps ordinary names', () => {
        assert.equal(identity.sanitizeHandle('Rahul'), 'Rahul');
        assert.equal(identity.sanitizeHandle('ChaiPanda42'), 'ChaiPanda42');
        assert.equal(identity.sanitizeHandle('priya.s_99-x'), 'priya.s_99-x');
        assert.equal(identity.sanitizeHandle('राहुल शर्मा'), 'राहुल शर्मा');
        assert.equal(identity.sanitizeHandle('José Müller'), 'José Müller');
    });

    test('trims, collapses spaces and strips control characters', () => {
        assert.equal(identity.sanitizeHandle('   Rahul    Kumar   '), 'Rahul Kumar');
        assert.equal(identity.sanitizeHandle('a\t\n\r b'), 'a b');
        assert.equal(identity.sanitizeHandle('Ra\u0000hu\u0007l'), 'Rahul');
        assert.equal(identity.sanitizeHandle('Ra' + String.fromCharCode(0x200B, 0x202E) + 'hul'), 'Rahul');
        assert.equal(identity.sanitizeHandle('\u001b[31mred'), '31mred');
    });

    test('strips everything that is not a letter, number, space or . _ -', () => {
        assert.equal(identity.sanitizeHandle('<script>alert(1)</script>'), 'scriptalert1script');
        assert.equal(identity.sanitizeHandle('Rah@ul#$%^&*!'), 'Rahul');
        assert.equal(identity.sanitizeHandle('a😀b'), 'ab');
        assert.equal(identity.sanitizeHandle('name line'), 'name line');
    });

    test('limits to 20 characters', () => {
        assert.equal(identity.sanitizeHandle('A'.repeat(100)), 'A'.repeat(20));
        assert.equal(identity.sanitizeHandle('abcdefghij klmnopqrstuvwxyz'), 'abcdefghij klmnopqrs');
        assert.equal([...identity.sanitizeHandle('राहुल'.repeat(30))].length, 20);
        assert.equal(identity.sanitizeHandle('x'.repeat(10) + ' '.repeat(50) + 'y'.repeat(10)), 'xxxxxxxxxx yyyyyyyyy');
    });

    test('falls back to an empty string', () => {
        for (const g of GARBAGE) assert.equal(identity.sanitizeHandle(g), '');
        for (const s of ['', '   ', '!!!', '😀😀😀', '....', '-_-', ' . ', '\u0000\u0001', String.fromCharCode(0x3164, 0x200B)]) {
            assert.equal(identity.sanitizeHandle(s), '', JSON.stringify(s));
        }
    });

    test('limits stacked combining marks (Zalgo) and drops orphan marks', () => {
        const zalgo = 'a' + '́̂̃̄̅̆̇̈'.repeat(5);
        const out = identity.sanitizeHandle(zalgo);
        assert.ok([...out].length <= 4, out);
        assert.ok(out.normalize('NFD').startsWith('a'));
        assert.equal(identity.sanitizeHandle('́́hi'), 'hi');
    });

    test('is idempotent', () => {
        const rand = seeded(11);
        for (let i = 0; i < 300; i++) {
            let s = '';
            for (let j = 0; j < 12; j++) s += String.fromCodePoint(Math.floor(rand() * 0x3000));
            const once = identity.sanitizeHandle(s);
            assert.equal(identity.sanitizeHandle(once), once);
            assert.ok([...once].length <= 20);
        }
    });

    test('refuses six or more digits, invisible-only names, swear words and look-alikes of the service', () => {
        for (const h of ['123456', 'Rahul 123456', '১২৩৪৫৬', '①②③④⑤⑥', '9\u200B8\u200B7\u200B6\u200B5\u200B4', '9876543210']) assert.equal(identity.sanitizeHandle(h), '', h);
        for (const h of ['\u3164', '\u200B\u2060\uFE0F', '\u{E0041}\u{E0042}', ' \u00AD ']) assert.equal(identity.sanitizeHandle(h), '', JSON.stringify(h));
        for (const h of ['fuck', 'F*ck', 'sh1t', 'LundKing', 'madarchod', 'चूतिया']) assert.equal(identity.sanitizeHandle(h), '', h);
        for (const h of ['Admin', 'OhMyGoal Support', 'Moderator', 'Oh My Goal']) assert.equal(identity.sanitizeHandle(h), '', h);
        assert.equal(identity.sanitizeHandle('Ra\u3164hul\u200B'), 'Rahul');
        for (const h of ['Rahul1999', 'Class of 2024', 'Scunthorpe', 'Badminton', 'Dickens']) assert.equal(identity.sanitizeHandle(h), h, h);
    });

    test('huge input stays fast', () => {
        const t = Date.now();
        identity.sanitizeHandle('á'.repeat(200000));
        identity.sanitizeHandle(' '.repeat(1000000) + 'x');
        assert.ok(Date.now() - t < 500);
    });
});

// =====================================================================
// icebreakers.js
// =====================================================================

describe('icebreakers: data', () => {
    const { pickPrompts, LANGS, TAGS } = icebreakers;
    const everything = lang => pickPrompts({ interests: [...TAGS], lang, count: 20, rand: seeded(1) });

    test('LANGS is en and hi', () => {
        assert.deepEqual([...LANGS], ['en', 'hi']);
    });

    test('every tag from the brief exists and a pack is large enough (checked through pickPrompts)', () => {
        assert.deepEqual([...TAGS].sort(), ['anime', 'art', 'bollywood', 'books', 'coding', 'cricket', 'fitness', 'food', 'gaming', 'movies', 'music', 'study', 'tech', 'travel']);
        for (const lang of LANGS) {
            const general = new Set();
            for (let seed = 0; seed < 400; seed++) {
                for (const p of pickPrompts({ interests: [], lang, count: 20, rand: seeded(seed) })) general.add(p);
            }
            assert.ok(general.size >= 40, `${lang} general pack has ${general.size} prompts`);
            for (const tag of TAGS) {
                const seen = new Set();
                for (let seed = 0; seed < 100; seed++) {
                    for (const p of pickPrompts({ interests: [tag], lang, count: 8, rand: seeded(seed) })) seen.add(p);
                }
                const own = [...seen].filter(p => !general.has(p));
                assert.ok(own.length >= 8, `${lang}/${tag} has ${own.length} own prompts`);
            }
        }
    });

    test('Hindi prompts are Devanagari, English prompts are Latin', () => {
        for (const p of everything('hi')) assert.match(p, /[ऀ-ॿ]/, p);
        for (const p of everything('en')) assert.doesNotMatch(p, /[ऀ-ॿ]/, p);
    });

    test('includes This or That prompts', () => {
        const seen = new Set();
        for (let seed = 0; seed < 300; seed++) for (const p of pickPrompts({ lang: 'en', count: 20, rand: seeded(seed) })) seen.add(p);
        assert.ok(seen.has('Chai or coffee?'));
        const hi = new Set();
        for (let seed = 0; seed < 300; seed++) for (const p of pickPrompts({ lang: 'hi', count: 20, rand: seeded(seed) })) hi.add(p);
        assert.ok(hi.has('चाय या कॉफ़ी?'));
    });

    test('safe for work: no personal-info requests, dating or contact asks in any prompt', () => {
        const banned = /\b(address|phone number|mobile number|your number|whatsapp|insta|instagram|snap|snapchat|telegram|age|how old|photo of you|pic of you|selfie|girlfriend|boyfriend|single|crush|date|sexy|hot|kiss|nude|salary|religion|caste|password|otp|email|where do you live|where are you from|your name|real name)\b/i;
        const seen = new Set();
        for (const lang of LANGS) {
            for (let seed = 0; seed < 300; seed++) {
                for (const p of pickPrompts({ interests: [...TAGS], lang, count: 20, rand: seeded(seed) })) seen.add(p);
                for (const p of pickPrompts({ lang, count: 20, rand: seeded(seed) })) seen.add(p);
            }
        }
        assert.ok(seen.size > 300);
        for (const p of seen) {
            assert.doesNotMatch(p, banned, p);
            assert.ok(p.length > 5 && p.length < 120, p);
            assert.equal(p, p.trim());
        }
        assert.doesNotMatch([...seen].filter(p => /[ऀ-ॿ]/.test(p)).join('\n'), /((मोबाइल|फोन|फ़ोन)\s?नंबर|नंबर\s+(दो|दीजिए|भेजो|बताओ)|उम्र|इंस्टा|व्हाट्स|गर्लफ्रेंड|बॉयफ्रेंड|फोटो भेज|पता\s+(बताओ|बताइए|दो|भेजो))/);
    });

    test('prompts are unique across the whole library per language', () => {
        for (const lang of LANGS) {
            const all = [];
            for (let seed = 0; seed < 200; seed++) {
                all.push(...pickPrompts({ interests: [...TAGS], lang, count: 20, rand: seeded(seed) }));
                all.push(...pickPrompts({ lang, count: 20, rand: seeded(seed) }));
            }
            const seen = new Set(all);
            assert.ok(seen.size >= 40 + 14 * 8);
        }
    });
});

describe('icebreakers: pickPrompts', () => {
    const { pickPrompts } = icebreakers;
    const pool = (opts, n = 300) => {
        const s = new Set();
        for (let seed = 0; seed < n; seed++) for (const p of pickPrompts({ ...opts, rand: seeded(seed) })) s.add(p);
        return s;
    };

    test('defaults: three distinct English prompts', () => {
        const out = pickPrompts();
        assert.equal(out.length, 3);
        assert.equal(new Set(out).size, 3);
        out.forEach(p => assert.equal(typeof p, 'string'));
        assert.equal(pickPrompts({}).length, 3);
    });

    test('count is respected, capped, and bad counts fall back safely', () => {
        assert.equal(pickPrompts({ count: 1 }).length, 1);
        assert.equal(pickPrompts({ count: 7 }).length, 7);
        assert.equal(pickPrompts({ count: 0 }).length, 0);
        assert.equal(pickPrompts({ count: -4 }).length, 0);
        assert.equal(pickPrompts({ count: 2.9 }).length, 2);
        assert.equal(pickPrompts({ count: 100000 }).length, 20);
        assert.equal(pickPrompts({ count: NaN }).length, 3);
        assert.equal(pickPrompts({ count: 'many' }).length, 3);
        assert.equal(pickPrompts({ count: Infinity }).length, 3);
    });

    test('prefers shared-interest packs, then fills from general', () => {
        const cricket = pool({ interests: ['cricket'], count: 8, lang: 'en' });
        const generalOnly = pool({ interests: [], count: 20, lang: 'en' });
        const cricketOwn = [...cricket].filter(p => !generalOnly.has(p));
        assert.equal(cricketOwn.length, 8);
        for (let seed = 0; seed < 50; seed++) {
            const out = pickPrompts({ interests: ['cricket'], count: 3, rand: seeded(seed) });
            assert.ok(out.every(p => cricketOwn.includes(p)), 'all three come from the cricket pack');
            const nine = pickPrompts({ interests: ['cricket'], count: 12, rand: seeded(seed) });
            assert.equal(nine.length, 12);
            assert.equal(nine.filter(p => cricketOwn.includes(p)).length, 8, 'whole pack first, then general');
            assert.ok(nine.slice(0, 8).every(p => cricketOwn.includes(p)));
        }
    });

    test('several interests are woven together', () => {
        const music = pool({ interests: ['music'], count: 8 });
        const food = pool({ interests: ['food'], count: 8 });
        const general = pool({ interests: [], count: 20 });
        const musicOwn = [...music].filter(p => !general.has(p));
        const foodOwn = [...food].filter(p => !general.has(p));
        for (let seed = 0; seed < 50; seed++) {
            const out = pickPrompts({ interests: ['music', 'food'], count: 2, rand: seeded(seed) });
            assert.equal(out.filter(p => musicOwn.includes(p)).length, 1);
            assert.equal(out.filter(p => foodOwn.includes(p)).length, 1);
        }
    });

    test('synonyms and loose spellings map to tags', () => {
        const general = pool({ interests: [], count: 20 });
        const own = tag => [...pool({ interests: [tag], count: 8 })].filter(p => !general.has(p));
        const cases = {
            films: 'movies', film: 'movies', ipl: 'cricket', programming: 'coding', code: 'coding',
            songs: 'music', games: 'gaming', travelling: 'travel', foodie: 'food', gym: 'fitness',
            manga: 'anime', reading: 'books', painting: 'art', gadgets: 'tech', exams: 'study',
            IPL: 'cricket', ' Films ': 'movies', '#cricket': 'cricket', 'Hip Hop': 'music',
        };
        for (const [alias, tag] of Object.entries(cases)) {
            const target = own(tag);
            assert.equal(target.length, 8, tag);
            for (let seed = 0; seed < 20; seed++) {
                const out = pickPrompts({ interests: [alias], count: 3, rand: seeded(seed) });
                assert.ok(out.every(p => target.includes(p)), `${alias} -> ${tag}`);
            }
        }
    });

    test('unknown, duplicate and malformed interests are ignored', () => {
        const baseline = pickPrompts({ interests: [], count: 5, rand: seeded(4) });
        for (const interests of [['nonsense', 'xyz'], [null, 5, {}, []], 'cricket', null, undefined, 42, { 0: 'cricket' }, ['constructor', '__proto__', 'toString', 'hasOwnProperty']]) {
            assert.deepEqual(pickPrompts({ interests, count: 5, rand: seeded(4) }), baseline, JSON.stringify(interests));
        }
        const dup = pickPrompts({ interests: ['cricket', 'ipl', 'CRICKET', 'cricket'], count: 8, rand: seeded(4) });
        assert.equal(new Set(dup).size, 8);
        assert.equal(pickPrompts({ interests: Array(100000).fill('cricket'), count: 3 }).length, 3);
    });

    test('no duplicates, ever', () => {
        for (let seed = 0; seed < 200; seed++) {
            const out = pickPrompts({ interests: ['cricket', 'ipl', 'music', 'songs', 'food'], count: 20, lang: seed % 2 ? 'hi' : 'en', rand: seeded(seed) });
            assert.equal(new Set(out).size, out.length);
            assert.equal(out.length, 20);
        }
    });

    test('exclude: a Set or array of strings is avoided', () => {
        const first = pickPrompts({ interests: ['cricket'], count: 8, rand: seeded(1) });
        const exclude = new Set(first.slice(0, 5));
        const out = pickPrompts({ interests: ['cricket'], count: 8, exclude, rand: seeded(2) });
        assert.equal(out.length, 8);
        assert.ok(out.every(p => !exclude.has(p)));
        const out2 = pickPrompts({ interests: ['cricket'], count: 8, exclude: [...exclude], rand: seeded(2) });
        assert.deepEqual(out2, out);
        // excluding everything leaves nothing
        const all = pickPrompts({ interests: [...icebreakers.TAGS], count: 20, rand: seeded(3) });
        const seen = new Set();
        for (let round = 0; round < 40; round++) {
            for (const p of pickPrompts({ interests: [...icebreakers.TAGS], count: 20, exclude: seen, rand: seeded(round) })) seen.add(p);
        }
        assert.ok(seen.size >= 40 + 14 * 8 - 1 || all.length === 20);
        assert.deepEqual(pickPrompts({ interests: [...icebreakers.TAGS], count: 20, exclude: seen, rand: seeded(1) }).filter(p => seen.has(p)), []);
    });

    test('exclude runs out gracefully and bad exclude values are ignored', () => {
        const everything = new Set();
        for (let seed = 0; seed < 400; seed++) {
            for (const p of pickPrompts({ interests: [...icebreakers.TAGS], count: 20, rand: seeded(seed) })) everything.add(p);
            for (const p of pickPrompts({ count: 20, rand: seeded(seed) })) everything.add(p);
        }
        assert.deepEqual(pickPrompts({ interests: [...icebreakers.TAGS], count: 5, exclude: everything }), []);
        for (const exclude of [null, 'abc', 5, {}, undefined]) assert.equal(pickPrompts({ count: 3, exclude }).length, 3);
    });

    test('language: hi gives Devanagari, en gives Latin, locale-ish codes are understood', () => {
        for (const p of pickPrompts({ interests: ['cricket'], lang: 'hi', count: 10 })) assert.match(p, /[ऀ-ॿ]/);
        for (const p of pickPrompts({ interests: ['cricket'], lang: 'en', count: 10 })) assert.doesNotMatch(p, /[ऀ-ॿ]/);
        for (const lang of ['hi-IN', 'HI', ' hi ', 'hi_IN']) {
            for (const p of pickPrompts({ lang, count: 5 })) assert.match(p, /[ऀ-ॿ]/, lang);
        }
    });

    test('falls back to English for a missing language', () => {
        for (const lang of ['fr', 'xx', '', null, undefined, 5, {}, 'constructor', '__proto__', 'toString']) {
            const out = pickPrompts({ interests: ['music'], lang, count: 6 });
            assert.equal(out.length, 6, String(lang));
            out.forEach(p => assert.doesNotMatch(p, /[ऀ-ॿ]/, String(lang)));
        }
    });

    test('deterministic for a given rand, varied for different ones', () => {
        const a = pickPrompts({ interests: ['anime'], count: 5, rand: seeded(8) });
        const b = pickPrompts({ interests: ['anime'], count: 5, rand: seeded(8) });
        assert.deepEqual(a, b);
        const variants = new Set();
        for (let seed = 0; seed < 30; seed++) variants.add(pickPrompts({ interests: ['anime'], count: 3, rand: seeded(seed) }).join('|'));
        assert.ok(variants.size > 10);
    });

    test('tolerates a broken rand and garbage options', () => {
        for (const rand of [() => NaN, () => 1, () => -1, () => 'x', () => undefined, 'nope', null]) {
            const out = pickPrompts({ interests: ['music'], count: 4, rand });
            assert.equal(out.length, 4);
            assert.equal(new Set(out).size, 4);
        }
        for (const g of GARBAGE) assert.ok(Array.isArray(pickPrompts(g)));
        assert.ok(Array.isArray(pickPrompts('cricket')));
        assert.equal(pickPrompts(null).length, 3);
    });

    test('every returned prompt is a non-empty string', () => {
        for (let seed = 0; seed < 50; seed++) {
            for (const p of pickPrompts({ interests: ['bollywood', 'coding'], count: 20, lang: seed % 2 ? 'hi' : 'en', rand: seeded(seed) })) {
                assert.equal(typeof p, 'string');
                assert.ok(p.length > 0);
            }
        }
    });
});

// =====================================================================
// shield.js
// =====================================================================

const { scanMessage, maskContact, KINDS } = shield;

/** Positive examples: [text, kinds that must all be reported]. */
const POSITIVE = [
    // phone
    ['9876543210', ['phone']],
    ['my number is 9876543210', ['phone']],
    ['+91 98765 43210', ['phone']],
    ['+91-9876543210', ['phone']],
    ['91 9876543210', ['phone']],
    ['09876543210', ['phone']],
    ['0 98765 43210 call me', ['phone']],
    ['98765-43210', ['phone']],
    ['98765.43210', ['phone']],
    ['987-654-3210', ['phone']],
    ['98 76 54 32 10', ['phone']],
    ['9 8 7 6 5 4 3 2 1 0', ['phone']],
    ['call me on 7012345678 after 6', ['phone']],
    ['reach 6000000001 anytime', ['phone']],
    ['mera no. 8123456789 hai', ['phone']],
    ['+1 415 555 2671', ['phone']],
    ['+44 7911 123456', ['phone']],
    ['12345678901', ['phone']],
    ['order 1234567890123', ['phone']],
    ['nine eight seven six five four three two one zero', ['phone']],
    ['nau aath saat chhe paanch char teen do ek shunya', ['phone']],
    ['९८७६५४३२१०', ['phone']],
    ['９８７６５４３２１０', ['phone']],
    ['me ' + '9876' + String.fromCharCode(0x200B) + '543210', ['phone']],
    ['(+91) 98765 43210', ['phone']],
    // round 2: disguises that used to slip through
    ['98765😀43210', ['phone']],
    ['9😀8😀7😀6😀5😀4😀3😀2😀1😀0', ['phone']],
    ['9*8*7*6*5*4*3*2*1*0', ['phone']],
    ['98765/43210', ['phone']],
    ['98765_43210', ['phone']],
    ['9 876543210', ['phone']],
    ['৯৮৭৬৫৪৩২১০', ['phone']],
    ['௯௮௭௬௫௪௩௨௧௦', ['phone']],
    ['๙๘๗๖๕๔๓๒๑๐', ['phone']],
    ['𝟗𝟖𝟕𝟔𝟓𝟒𝟑𝟐𝟏𝟎', ['phone']],
    ['⑨⑧⑦⑥⑤④③②①⓪', ['phone']],
    ['⁹⁸⁷⁶⁵⁴³²¹⁰', ['phone']],
    ['98765O3210', ['phone']],
    ['9876l43210', ['phone']],
    ['9\u3164876543210', ['phone']],
    ['98765\u034F43210', ['phone']],
    ['9\uFE0F8\uFE0F7\uFE0F6\uFE0F5\uFE0F4\uFE0F3\uFE0F2\uFE0F1\uFE0F0', ['phone']],
    ['9\u{E0041}876543\u{E0041}210', ['phone']],
    ['nine eight seven six five four three two', ['phone']],
    ['nau aath saat chhe paanch char teen do', ['phone']],
    ['नौ आठ सात छह पांच चार तीन दो एक शून्य', ['phone']],
    // upi
    ['rahul@okaxis', ['upi']],
    ['pay to priya.sharma@oksbi', ['upi', 'money']],
    ['my upi: raj_99@okhdfcbank', ['upi']],
    ['anu@okicici', ['upi']],
    ['sam@ibl', ['upi']],
    ['dev@axl', ['upi']],
    ['ria@apl', ['upi']],
    ['9876543210@ybl', ['upi', 'phone']],
    ['send to x@paytm', ['upi']],
    ['x@upi', ['upi']],
    ['@oksbi', ['upi']],
    ['id is @okhdfcbank.', ['upi']],
    ['name@okaxis.', ['upi']],
    // social
    ['what is your insta?', ['social']],
    ['whats ur insta id', ['social']],
    ['add me on snap', ['social']],
    ['add me on snapchat', ['social']],
    ['dm me on instagram', ['social']],
    ['follow me on insta', ['social']],
    ['text me on whatsapp', ['social']],
    ['ping me on telegram', ['social']],
    ['message me on whatsapp', ['social']],
    ['lets shift to whatsapp', ['social']],
    ['can we talk on telegram', ['social']],
    ['continue on whatsapp?', ['social']],
    ['move to telegram', ['social']],
    ['my id is rahul99', ['social']],
    ['my insta id is rahul_99', ['social']],
    ['my insta is rahul_99', ['social']],
    ['my snap: priya.s', ['social']],
    ['insta: rahul_99', ['social']],
    ['snap - priya99', ['social']],
    ['telegram @rahul_99', ['social']],
    ['@rahul_99', ['social']],
    ['wa.me/919876543210', ['social', 'link', 'phone']],
    ['t.me/rahul', ['social', 'link']],
    ['do you have insta?', ['social']],
    ['are you on snapchat', ['social']],
    ['give me your snap', ['social']],
    ['send insta', ['social']],
    ['insta?', ['social']],
    ['drop ur ig', ['social']],
    ['hmu on telegram', ['social']],
    ['whatsapp?', ['social']],
    ['ur snap', ['social']],
    ['give me your number', ['social']],
    ['can i get your number', ['social']],
    ['what is your phone number', ['social']],
    ['send your whatsapp number', ['social']],
    ['insta id do', ['social']],
    ['insta id dedo yaar', ['social']],
    ['whatsapp pe aao', ['social']],
    ['whatsapp pe baat karte hain', ['social']],
    ['snap pe add karo', ['social']],
    ['telegram pe chat karo', ['social']],
    ['mujhe whatsapp pe msg karo', ['social']],
    ['number do', ['social']],
    ['number bhejo', ['social']],
    ['apna number do na', ['social']],
    ['tumhara number kya hai', ['social']],
    ['tera whatsapp number bhej', ['social']],
    ['instagram id batao', ['social']],
    ['aapka insta kya hai', ['social']],
    ['your email id?', ['social']],
    ['mail id do', ['social']],
    ['व्हाट्सएप पर आओ', ['social']],
    ['नंबर दो', ['social']],
    // link
    ['check https://example.com/page', ['link']],
    ['http://evil.site/login', ['link']],
    ['www.google.com', ['link']],
    ['visit mysite.com/offer', ['link']],
    ['x.com/rahul', ['link']],
    ['bit.ly/3abcXYZ', ['link']],
    ['youtu.be/dQw4w9WgXcQ', ['link']],
    ['tinyurl.com/abc', ['link']],
    ['go to free-gifts.xyz now', ['link']],
    ['open flipkart.in', ['link']],
    ['instagram.com/rahul', ['link', 'social']],
    ['raj.dev.singh9@gmail.com and also see raj.dev', ['link', 'email']],
    // email
    ['mail me at rahul@gmail.com', ['email']],
    ['rahul.sharma99@yahoo.co.in', ['email']],
    ['a.b@outlook.com', ['email']],
    ['contact: foo_bar@company.org', ['email']],
    ['name+tag@proton.me', ['email']],
    ['rahul at gmail dot com', ['email']],
    ['rahul (at) gmail (dot) com', ['email']],
    ['raj[at]yahoo[dot]in', ['email']],
    ['RAHUL@GMAIL.COM', ['email']],
    ['rahul@okaxis.com', ['email']],
    // money
    ['send money please', ['money']],
    ['send me some money', ['money']],
    ['can you lend me cash', ['money']],
    ['I need money urgently', ['money']],
    ['pay me 500', ['money']],
    ['need money for recharge', ['money']],
    ['i need 500 rupees', ['money']],
    ['give me ur upi', ['money']],
    ['paytm karo', ['money']],
    ['gpay kar do', ['money']],
    ['phonepe karo na', ['money']],
    ['pay me on paytm', ['money']],
    ['what is your upi id', ['money']],
    ['send the otp', ['money']],
    ['tell me the OTP you got', ['money']],
    ['one time password aaya?', ['money']],
    ['gift card chahiye', ['money']],
    ['buy a google play gift card', ['money']],
    ['recharge kar do', ['money']],
    ['recharge karo yaar', ['money']],
    ['mera recharge khatam', ['money']],
    ['paise bhejo', ['money']],
    ['mujhe paise chahiye', ['money']],
    ['udhaar do', ['money']],
    ['share your upi pin', ['money']],
    ['cvv bata', ['money']],
    ['send me your account number', ['money']],
    ['earn Rs 5000 daily from home', ['money']],
    ['guaranteed returns, invest now', ['money']],
    ['ओटीपी बताओ', ['money']],
    ['पैसे भेजो', ['money']],
    // explicit-ask
    ['send pic', ['explicit-ask']],
    ['send ur pics', ['explicit-ask']],
    ['send me your photo', ['explicit-ask']],
    ['share a selfie', ['explicit-ask']],
    ['send nudes', ['explicit-ask']],
    ['nudes?', ['explicit-ask']],
    ['show me your body', ['explicit-ask']],
    ['pic bhejo', ['explicit-ask']],
    ['apni photo bhejo', ['explicit-ask']],
    ['selfie dikhao', ['explicit-ask']],
    ['pic do na', ['explicit-ask']],
    ['pic?', ['explicit-ask']],
    ['video call on whatsapp', ['explicit-ask', 'social']],
    ['lets do a video call on insta', ['explicit-ask']],
    ['video call karo', ['explicit-ask']],
    ['private video?', ['explicit-ask']],
    ['hot pics bhejo', ['explicit-ask']],
    ['cam to cam?', ['explicit-ask']],
    ['sexting?', ['explicit-ask']],
    ['wanna have sex', ['explicit-ask']],
    ['फोटो भेजो', ['explicit-ask']],
];

/** Negative examples: must report nothing at all. */
const NEGATIVE = [
    // numbers that are not phone numbers
    'I scored 98 runs',
    'call me at 10:30?',
    'born in 1999',
    'it costs ₹149',
    'version 2.0.1',
    'my email is my business',
    'Rs 500 is too much for that',
    'India made 245/3 in 40 overs',
    'the match starts at 7:30 pm',
    'happy 2024 bro',
    'the price is Rs. 1,50,000',
    'he scored 183 in 140 balls',
    'Kohli hit 100 off 52',
    'the temperature is 32.5 degrees',
    'pi is 3.14159265358979',
    'the IP was 192.168.100.200',
    'on 12-05-2024 we met',
    'the train number is 12951',
    'IPL 2025 final was epic',
    'my score was 6-4 6-3',
    'tickets cost 1500 each',
    'Dial 100 for police',
    'I am 21 years old',
    'the movie is 2h 30m long',
    'I need 2 hours to finish',
    'sets 6 4 3 2 1 5',
    'pick a number from 1 to 10',
    'my favourite number is 7',
    'what is your favourite number?',
    'your number one fan',
    'ek number yaar!',
    'roll number 45 hai mera',
    'one two three four five',
    // round 2: dates, times, sums, fractions and rhymes are not phone numbers
    'meet on 06/09/2024 8:30 pm',
    '7/10, 8/10, 9/10 and 6/10',
    'it costs ₹8,000,000,000',
    '2024-10-18 18:30:00',
    'one two three that is easy as one two three',
    'do ek do teen',
    'ek do teen char paanch chhe saat',
    'one cat, two dogs, three birds, four fish, five hens, six cows, seven ducks, eight geese',
    'तारीख १५ अगस्त १९४७',
    'x² + y² = z²',
    // chat that mentions apps, links-like text or money-ish words harmlessly
    'I watched it on Instagram yesterday',
    'Instagram reels are so addictive',
    'my whatsapp is not working',
    'I use Telegram for news channels',
    'Facebook is boring now',
    'snap out of it!',
    'whatsapp pe forward aaya tha',
    'insta pe reel dekhi kal',
    'I love instagram',
    'my id card was lost',
    'my idea is simple',
    'reach me at the gym',
    'follow me on this journey',
    'follow the cricket pages you like',
    'node.js is great',
    'Next.js or React?',
    'e.g. biryani, i.e. a rice dish',
    'meet @5pm near the gate',
    'I am @ home today',
    'I paid the bill yesterday',
    'time to pay attention',
    "I can't pay for that",
    'The OTT release is next week',
    'send me a message when you are free',
    'send me the song name',
    'photography is my hobby',
    'I love taking pics of sunsets',
    'pocket money was never enough',
    'paise bachane hain is mahine',
    'I need to recharge my batteries',
    'you need money to start a business like that',
    'I want to give paytm a try',
    'lets talk about movies',
    'what is the best biryani in Hyderabad?',
    'how was your day?',
    'what is your favourite movie?',
    'cricket is life 🏏',
    'happy birthday! 🎂',
    'mera naam Rahul hai',
    'kya haal hai bhai',
    'aaj match dekha kya?',
    'mujhe biryani pasand hai',
    'kal exam hai yaar',
    'ye gaana mast hai',
    'tum kahan se ho',
    'आज मौसम बहुत अच्छा है',
    'आपका पसंदीदा गाना कौन-सा है?',
    '',
    '   ',
    '😀😀😀',
];

describe('shield: scanMessage', () => {
    test('has at least 40 positive and 30 negative examples', () => {
        assert.ok(POSITIVE.length >= 40, String(POSITIVE.length));
        assert.ok(NEGATIVE.length >= 30, String(NEGATIVE.length));
    });

    test('result shape and kind names', () => {
        assert.deepEqual([...KINDS], ['phone', 'upi', 'social', 'link', 'email', 'money', 'explicit-ask']);
        assert.deepEqual(scanMessage('hello there'), { risky: false, kinds: [] });
        const r = scanMessage('call 9876543210 or mail a@b.com');
        assert.equal(r.risky, true);
        assert.deepEqual(r.kinds, ['phone', 'email']); // KINDS order, no duplicates
        assert.ok(r.kinds.every(k => KINDS.includes(k)));
    });

    for (const [text, kinds] of POSITIVE) {
        test(`flags ${JSON.stringify(text)} as ${kinds.join('+')}`, () => {
            const r = scanMessage(text);
            assert.equal(r.risky, true, JSON.stringify(r));
            for (const k of kinds) assert.ok(r.kinds.includes(k), `${k} missing from ${JSON.stringify(r.kinds)}`);
        });
    }

    for (const text of NEGATIVE) {
        test(`does not flag ${JSON.stringify(text)}`, () => {
            assert.deepEqual(scanMessage(text), { risky: false, kinds: [] });
        });
    }

    test('single-kind examples report exactly that kind', () => {
        const only = {
            'my number is 9876543210': ['phone'],
            'rahul@okaxis': ['upi'],
            'mail me at rahul@gmail.com': ['email'],
            'check https://example.com/page': ['link'],
            'send pic': ['explicit-ask'],
            'send the otp': ['money'],
            'add me on snap': ['social'],
            'www.google.com': ['link'],
            'rahul.sharma99@yahoo.co.in': ['email'],
        };
        for (const [text, kinds] of Object.entries(only)) assert.deepEqual(scanMessage(text).kinds, kinds, text);
    });

    test('an email is an email, not a link, UPI or social handle', () => {
        assert.deepEqual(scanMessage('rahul@gmail.com').kinds, ['email']);
        assert.deepEqual(scanMessage('rahul@okaxis').kinds, ['upi']);
        assert.deepEqual(scanMessage('a.b.c@gmail.com').kinds, ['email']);
    });

    test('mixed messages report several kinds in a stable order', () => {
        const r = scanMessage('add me on insta rahul_99, call 98765 43210, or mail rahul@gmail.com, send pic and paytm karo https://x.co/a');
        assert.deepEqual(r.kinds, ['phone', 'social', 'link', 'email', 'money', 'explicit-ask']);
    });

    test('case, spacing and full-width forms do not hide things', () => {
        assert.ok(scanMessage('SEND NUDES').kinds.includes('explicit-ask'));
        assert.ok(scanMessage('Add Me On SNAPCHAT').kinds.includes('social'));
        assert.ok(scanMessage('PAYTM   KARO').kinds.includes('money'));
        assert.ok(scanMessage('ｒａｈｕｌ＠ｇｍａｉｌ．ｃｏｍ').kinds.includes('email'));
        const zw = String.fromCharCode(0x200B);
        assert.ok(scanMessage('s' + zw + 'end n' + zw + 'udes').kinds.includes('explicit-ask'));
    });

    test('never throws on garbage and flags nothing for non-strings', () => {
        for (const g of GARBAGE) assert.deepEqual(scanMessage(g), { risky: false, kinds: [] });
        const weird = [
            '\u0000\u0001\u0002', '\uD800', 'a\uDC00b', '@'.repeat(500), '.'.repeat(500), '9'.repeat(500),
            '@@@@@@@', '://', 'http://', 'a@b', '@.', '+', '+++++', '()()()', '-'.repeat(300), '😀'.repeat(300),
            'x@' + 'a'.repeat(300), 'a'.repeat(300) + '@b.com', '1 '.repeat(300), 'one '.repeat(300),
        ];
        for (const w of weird) {
            const r = scanMessage(w);
            assert.equal(typeof r.risky, 'boolean');
            assert.ok(Array.isArray(r.kinds));
        }
    });

    test('is stateless: the same input gives the same answer over and over', () => {
        for (let i = 0; i < 20; i++) {
            for (const [text, kinds] of POSITIVE.slice(0, 40)) {
                const r = scanMessage(text);
                for (const k of kinds) assert.ok(r.kinds.includes(k), `${text} run ${i}`);
            }
        }
    });

    test('long and adversarial input stays fast', () => {
        const inputs = [
            '9 '.repeat(2000), 'a'.repeat(4000), '@'.repeat(4000), '. '.repeat(2000), 'a.'.repeat(2000),
            'one '.repeat(1000), '1,'.repeat(2000), 'insta '.repeat(600), ('x'.repeat(60) + '@').repeat(60),
            'my ' + ' '.repeat(3000) + 'id', 'send ' + 'me '.repeat(1000), 'a-'.repeat(2000) + '.com',
            '+91 '.repeat(1000), '98765 '.repeat(600), 'http://' + 'a'.repeat(3900),
        ];
        const t = Date.now();
        for (const s of inputs) {
            scanMessage(s);
            maskContact(s);
        }
        assert.ok(Date.now() - t < 3000, `took ${Date.now() - t}ms`);
    });
});

describe('shield: maskContact', () => {
    test('masks Indian mobile numbers, keeping the first two and last three digits', () => {
        assert.equal(maskContact('9876543210'), '98•••••210');
        assert.equal(maskContact('call 9876543210 now'), 'call 98•••••210 now');
        assert.equal(maskContact('+91 98765 43210'), '+91 98••• ••210');
        assert.equal(maskContact('+91-9876543210'), '+91-98•••••210');
        assert.equal(maskContact('98765-43210'), '98•••-••210');
        assert.equal(maskContact('09876543210'), '098•••••210');
        assert.equal(maskContact('987-654-3210'), '98•-•••-•210');
    });

    test('masks long digit runs and spelled-out numbers', () => {
        assert.equal(maskContact('id 12345678901 ok'), 'id 12••••••901 ok');
        const spelled = maskContact('nine eight seven six five four three two one zero');
        assert.ok(spelled.startsWith('nine eight '));
        assert.ok(spelled.endsWith(' two one zero'));
        assert.ok(spelled.includes('•'));
        assert.doesNotMatch(spelled, /seven|six|five|four|three/);
    });

    test('masks full-width and Devanagari digits too', () => {
        assert.equal(maskContact('९८७६५४३२१०'), '९८•••••२१०');
    });

    test('masks UPI ids, keeping the handle', () => {
        assert.equal(maskContact('pay rahul@okaxis please'), 'pay ra•••@okaxis please');
        assert.equal(maskContact('priya.sharma@oksbi'), 'pr••••••••••@oksbi');
        assert.equal(maskContact('ab@ybl'), 'a•@ybl');
        assert.equal(maskContact('x@upi'), '•@upi');
        assert.equal(maskContact('9876543210@ybl'), '98••••••••@ybl');
    });

    test('masks emails, keeping the domain', () => {
        assert.equal(maskContact('mail rahul@gmail.com'), 'mail ra•••@gmail.com');
        assert.equal(maskContact('rahul.sharma99@yahoo.co.in'), 'ra••••••••••••@yahoo.co.in');
        assert.equal(maskContact('a@b.com'), '•@b.com');
        assert.equal(maskContact('abc@b.com'), 'a••@b.com');
        assert.equal(maskContact('9876543210@gmail.com'), '98••••••••@gmail.com');
    });

    test('masks obfuscated emails', () => {
        const out = maskContact('write to rahul at gmail dot com ok');
        assert.ok(out.startsWith('write to ra'));
        assert.ok(out.endsWith(' ok'));
        assert.doesNotMatch(out, /gmail|rahul/);
    });

    test('masks several things in one message and leaves the rest alone', () => {
        const out = maskContact('Call 98765 43210 or rahul@gmail.com, UPI: sam@ybl. Cricket at 10:30, score 245/3!');
        assert.equal(out, 'Call 98••• ••210 or ra•••@gmail.com, UPI: s••@ybl. Cricket at 10:30, score 245/3!');
    });

    test('a phone number glued to a UPI id is masked as one', () => {
        const out = maskContact('98765 43210@ybl');
        assert.equal(out, '98•••••••••@ybl');
    });

    test('leaves harmless text exactly as it was', () => {
        for (const text of NEGATIVE.filter(t => !/\d{10}/.test(t))) assert.equal(maskContact(text), text, text);
        assert.equal(maskContact('hello'), 'hello');
        assert.equal(maskContact(''), '');
        assert.equal(maskContact('@oksbi'), '@oksbi');
        assert.equal(maskContact('Hello 😀 दुनिया'), 'Hello 😀 दुनिया');
    });

    test('never leaks the middle digits or the name part of what it masks', () => {
        for (const [text] of POSITIVE) {
            const kinds = scanMessage(text).kinds;
            if (!kinds.includes('phone') && !kinds.includes('email') && !kinds.includes('upi')) continue;
            if (/(^|\s)@ok/.test(text)) continue; // a bare handle has nothing personal to hide
            const out = maskContact(text);
            assert.notEqual(out, text.replace(/[​]/g, ''), `unchanged: ${text}`);
            assert.doesNotMatch(out, /98765|76543|65432|54321|43210/, out);
        }
    });

    test('masking removes the contact details, so a masked message is no longer flagged for them', () => {
        for (const text of ['call 9876543210', 'mail rahul@gmail.com', 'pay rahul@okaxis', '+91 98765 43210 or 09876543210', 'x@paytm and y@upi']) {
            const kinds = scanMessage(maskContact(text)).kinds;
            for (const k of ['phone', 'email', 'upi']) assert.ok(!kinds.includes(k), `${k} still found in ${maskContact(text)}`);
        }
    });

    test('is idempotent and returns strings for any input without throwing', () => {
        for (const [text] of POSITIVE) {
            const once = maskContact(text);
            assert.equal(typeof once, 'string');
            assert.equal(maskContact(once), once, text);
        }
        for (const g of GARBAGE) assert.equal(maskContact(g), '');
        assert.equal(typeof maskContact('\uD800 9876543210 \uDC00'), 'string');
    });

    test('keeps the length of the visible text reasonable', () => {
        const out = maskContact('9'.repeat(3000));
        assert.ok(out.length <= 4000);
        assert.ok(out.startsWith('99•'));
    });
});
