// Regression tests for the second review round of js/shield.js: invisible characters, every script's digits, wider separators,
// spelled-out numbers, masking that keeps the original text, isProfane, and speed on adversarial input.
// Run: node --test /tmp/claude-0/-home-user-ohmygoal/80ecaa61-e063-55be-81f7-87bba82dfd45/scratchpad/unit/shield.hardening2.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const shield = await import('file:///home/user/ohmygoal/js/shield.js');
const { scanMessage, maskContact, isProfane, stripInvisible } = shield;

const kindsOf = text => scanMessage(text).kinds;
const isPhone = text => kindsOf(text).includes('phone');
const clean = text => assert.deepEqual(scanMessage(text), { risky: false, kinds: [] }, JSON.stringify(text));
const digitsIn = s => (s.match(/\p{Nd}/gu) || []).length;
const NUMBER = '9876543210';

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

/** Fastest of a few runs, in ms: noise-proof, but a super-linear pattern still shows. */
function fastest(fn, runs = 4) {
    fn();
    let best = Infinity;
    for (let i = 0; i < runs; i++) {
        const t = performance.now();
        fn();
        best = Math.min(best, performance.now() - t);
    }
    return best;
}

// =====================================================================
// 1a. Invisible characters
// =====================================================================

// Every one of these showed nothing and split a number or a word apart before the Unicode-property class.
const HIDDEN = {
    cgj: 0x034F, arabicLetterMark: 0x061C, hangulChoseongFiller: 0x115F, hangulJungseongFiller: 0x1160, khmerVowelInherentAq: 0x17B4,
    khmerVowelInherentAa: 0x17B5, mongolianFvs1: 0x180B, mongolianFvs3: 0x180D, mongolianVowelSeparator: 0x180E, mongolianFvs4: 0x180F,
    hangulFiller: 0x3164, halfwidthHangulFiller: 0xFFA0, variationSelector1: 0xFE00, variationSelector16: 0xFE0F,
    deprecated206A: 0x206A, deprecated206F: 0x206F, tagLatinA: 0xE0041, tagCancel: 0xE007F, variationSelector17: 0xE0100,
    zeroWidthSpace: 0x200B, zwnj: 0x200C, zwj: 0x200D, lrm: 0x200E, rlm: 0x200F, lre: 0x202A, rlo: 0x202E, lri: 0x2066, pdi: 0x2069,
    wordJoiner: 0x2060, invisibleTimes: 0x2062, invisibleSeparator: 0x2063, softHyphen: 0x00AD, bom: 0xFEFF, brailleBlank: 0x2800,
    interlinearAnnotation: 0xFFF9, nul: 0x0000, escape: 0x001B, del: 0x007F, c1Control: 0x0085,
};

describe('shield round 2: invisible characters never split a number or a word', () => {
    for (const [name, code] of Object.entries(HIDDEN)) {
        const ch = String.fromCodePoint(code);
        test(`${name} (U+${code.toString(16).toUpperCase().padStart(4, '0')}) between every digit and every letter`, () => {
            const between = text => [...text].join(ch);
            assert.ok(isPhone(between(NUMBER)), 'a number split into single digits');
            assert.ok(isPhone('call ' + [...NUMBER].map((c, i) => (i % 2 ? c + ch : c)).join('')));
            assert.ok(kindsOf(between('send nudes')).includes('explicit-ask'));
            assert.ok(kindsOf(between('add me on snapchat')).includes('social'));
            assert.ok(kindsOf(between('rahul@gmail.com')).includes('email'));
            assert.ok(kindsOf(between('rahul@okaxis')).includes('upi'));
            const masked = maskContact(between(NUMBER));
            assert.ok(!isPhone(masked), JSON.stringify(masked));
            assert.doesNotMatch(masked.replace(/\P{Nd}/gu, ''), /765/, 'middle digits leaked');
        });
    }

    test('every default-ignorable code point is invisible to the scanner', () => {
        const dicp = /^\p{Default_Ignorable_Code_Point}$/u;
        let checked = 0;
        for (let c = 0; c <= 0x10FFFF; c += c < 0x20000 || c >= 0xE0000 ? 1 : 0x1000) {
            if (c >= 0xD800 && c <= 0xDFFF) continue;
            const ch = String.fromCodePoint(c);
            if (!dicp.test(ch)) continue;
            checked++;
            assert.equal(stripInvisible('a' + ch + 'b'), 'ab', `U+${c.toString(16)}`);
            assert.ok(isPhone(`98765${ch}43210`), `U+${c.toString(16)} split a number`);
        }
        assert.ok(checked > 350, `only ${checked} code points checked`);
    });

    test('stripInvisible keeps visible text, whitespace and emoji bases', () => {
        assert.equal(stripInvisible('a b\tc\nd'), 'a b\tc\nd');
        assert.equal(stripInvisible('Hello 😀 दुनिया'), 'Hello 😀 दुनिया');
        assert.equal(stripInvisible('x​y️z\u{E0041}'), 'xyz');
        assert.equal(stripInvisible(undefined), '');
        assert.equal(stripInvisible(42), '');
    });

    test('combining strike-through, accents and keycap rings do not hide words', () => {
        assert.ok(kindsOf('n̶u̶d̶e̶s̶').includes('explicit-ask'));
        assert.ok(kindsOf('ínstágram?').includes('social'));
        assert.ok(kindsOf('s̷e̷n̷d̷ ̷t̷h̷e̷ ̷o̷t̷p̷').includes('money'));
    });

    test('line and paragraph separators are whitespace, not glue', () => {
        for (const sep of [' ', ' ']) {
            assert.ok(kindsOf(`send${sep}nudes`).includes('explicit-ask'));
            assert.ok(kindsOf(`add${sep}me${sep}on${sep}snap`).includes('social'));
        }
    });
});

// =====================================================================
// 1b. Every Unicode decimal digit
// =====================================================================

/** All decimal-digit blocks (runs of ten) as the code point of their zero. */
function digitBlocks() {
    const blocks = [];
    const nd = /^\p{Nd}$/u;
    let run = -1;
    for (let c = 0x80; c <= 0x1FFFF; c++) {
        if (nd.test(String.fromCodePoint(c))) {
            if (run < 0) run = c;
        } else if (run >= 0) {
            for (let z = run; z < c; z += 10) blocks.push(z);
            run = -1;
        }
    }
    return blocks;
}
const BLOCKS = digitBlocks();

describe('shield round 2: digits of every script', () => {
    test('the Unicode data has the expected shape (a few dozen blocks of ten)', () => {
        assert.ok(BLOCKS.length >= 60, String(BLOCKS.length));
        for (const zero of [0x660, 0x6F0, 0x966, 0x9E6, 0xA66, 0xAE6, 0xB66, 0xBE6, 0xC66, 0xCE6, 0xD66, 0xE50, 0xED0, 0xF20, 0x1040, 0x17E0, 0x1810, 0xFF10, 0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6, 0x1E950]) {
            assert.ok(BLOCKS.includes(zero), `block at U+${zero.toString(16)}`);
        }
    });

    test('a number written in any script is a phone number, masked in that same script', () => {
        for (const zero of BLOCKS) {
            const d = n => String.fromCodePoint(zero + n);
            const num = [...NUMBER].map(c => d(+c)).join('');
            const label = `block U+${zero.toString(16).toUpperCase()}`;
            assert.ok(isPhone('call ' + num), label);
            assert.equal(maskContact('call ' + num + ' now'), 'call ' + d(9) + d(8) + '•••••' + d(2) + d(1) + d(0) + ' now', label);
        }
    });

    test('mixed scripts in one number still count as one number', () => {
        const mixed = ['৯', '8', '७', '६', '๕', '4', '٣', '2', '१', '0'].join('');
        assert.ok(isPhone(mixed));
        assert.equal(digitsIn(maskContact(mixed)), 5);
    });

    test('circled, bracketed, dingbat, superscript and subscript digits', () => {
        const forms = {
            circled: '⑨⑧⑦⑥⑤④③②①⓪', parenthesised: '⑼⑻⑺⑹⑸⑷⑶⑵⑴0', fullStop: '⒐⒏⒎⒍⒌⒋⒊⒉⒈0', negativeCircled: '❾❽❼❻❺❹❸❷❶⓿',
            sansCircled: '➈➇➆➅➄➃➂➁➀0', superscript: '⁹⁸⁷⁶⁵⁴³²¹⁰', subscript: '₉₈₇₆₅₄₃₂₁₀', doubleCircled: '⓽⓼⓻⓺⓹⓸⓷⓶⓵0',
            commaDigits: '🄊🄉🄈🄇🄆🄅🄄🄃🄂🄁',
        };
        for (const [name, num] of Object.entries(forms)) {
            assert.ok(isPhone(num), `${name}: ${num}`);
            const out = maskContact(num);
            assert.ok(!isPhone(out), `${name} still a phone after masking: ${out}`);
            assert.ok(out.includes('•'), name);
        }
    });

    test('keycap emoji digits, even with hidden characters between', () => {
        const keycap = [...NUMBER].map(c => c + '️⃣').join('');
        assert.ok(isPhone(keycap));
        const out = maskContact('call ' + keycap);
        assert.ok(!isPhone(out));
        assert.doesNotMatch(out, /[7654]/);
        assert.ok(out.startsWith('call 9'));
    });

    test('ordinary non-ASCII digits in everyday text are not phone numbers', () => {
        for (const t of ['म्यूट १२३ बजे', 'तारीख १५ अगस्त १९४७', 'মূল্য ৫০ টাকা', 'ราคา ๕๐๐ บาท', 'Rs ۵۰۰', 'x² + y² = z²', 'H₂O and CO₂', '① two ③']) clean(t);
    });
});

// =====================================================================
// 1c. Wider separators and look-alike letters
// =====================================================================

describe('shield round 2: separators between the digits of a number', () => {
    const SEPARATORS = ['', ' ', '-', '.', '*', '_', '|', '~', '/', ',', ';', '•', '·', '😀', '⭐', '❤️', ' - ', ' * ', '--', '...', '😀😀', '😀 😀', ' 🙂 ', '#', '=', '→', '+', '\\'];

    test('any run of up to three symbols, spaces or emoji between digit groups', () => {
        for (const sep of SEPARATORS) {
            for (const cut of [[5, 5], [2, 2, 2, 2, 2], [3, 3, 4], [1, 9], [9, 1], [4, 3, 3]]) {
                let p = 0;
                const text = cut.map(n => NUMBER.slice(p, (p += n))).join(sep);
                assert.ok(isPhone(text), JSON.stringify(text));
                const out = maskContact(text);
                assert.ok(!isPhone(out), `${JSON.stringify(text)} -> ${JSON.stringify(out)}`);
                assert.ok(digitsIn(out) <= 5, `${JSON.stringify(text)} -> ${JSON.stringify(out)}`);
            }
        }
    });

    test('single digits split by emoji or symbols', () => {
        for (const sep of ['😀', '*', '_', '•', ' ❤️ ', '-', '.', ' ', '😀😀😀']) {
            const text = [...NUMBER].join(sep);
            assert.ok(isPhone(text), JSON.stringify(text));
            assert.ok(!isPhone(maskContact(text)), text);
        }
    });

    test('a first digit apart from the rest, and prefixes with odd separators', () => {
        for (const t of ['9 876543210', '9 8 76543210', '9-876543210', '+91 😀 98765 43210', '+91(98765)43210', '+91 (98765) 43210', '(98) 765-43210', '0 😀 9876543210', '91 • 98765 • 43210']) {
            assert.ok(isPhone(t), t);
            assert.ok(!isPhone(maskContact(t)), `${t} -> ${maskContact(t)}`);
        }
    });

    test('international numbers with wide separators', () => {
        for (const t of ['+44 7911 123456', '+1 (415) 555-2671', '+49-30-123456-78', '+1 415 😀 555 😀 2671', '+61 4 1234 5678']) assert.ok(isPhone(t), t);
    });

    test('O and l between digits are zeros and ones', () => {
        for (const t of ['98765O3210', '9876543O10', '98765o3210', '9876l43210', '9876I43210', '9O8O7O6O5O4O3O2O1O0', '9876OO3210', '9l8l7l6l5l4']) {
            assert.ok(isPhone(t), t);
            assert.ok(!isPhone(maskContact(t)), `${t} -> ${maskContact(t)}`);
        }
        assert.equal(maskContact('call 98765O3210'), 'call 98•••••210');
    });

    test('O and l that are not between digits stay letters', () => {
        for (const t of ['Oct 9876543 ol', 'hello 98765 old', 'lol 1 O 2 l', 'room 5l', 'COOL 7 OK', 'I 9 8 7 6 5 l']) clean(t);
    });

    test('dates, times, scores, sums and fractions are not phone numbers', () => {
        const OK = [
            'meet on 06/09/2024 8:30 pm', '9/10/2024 18:30 sharp', '7/10, 8/10, 9/10 and 6/10', 'score 6-3 6-4 7-5', 'rated 9.5/10 and 8.5/10 and 7/10',
            'it costs ₹8,000,000,000', 'it costs $9,999,999,999', 'Rs. 9,99,99,999', '₹7,000 ₹8,000 ₹9,000', 'price 999 899 799 699', 'the IP is 98.138.253.109',
            '2024-10-18 18:30:00', '18:30:45', 'v9.8.7.6.5', 'room 7 8 9 10', 'IND 285/4 vs AUS 283/10', 'we met at 6:45 and 8:15 and 9:30 or 7:00',
            'sets 6 4 3 2 1 5', 'pick 1 2 3 4 5 6 7 8', 'a 1 b 2 c 3 d 4 e 5 f 6', 'ISBN 978-3-16-148410-0', 'PIN 560001', '4111 1111 1111 1111',
            'we won 3-0 and then 2-1 and 4-4', '😀😀😀😀😀😀😀😀😀😀', '1 apple 2 mango 3 grapes 4 pears 5 figs 6 limes 7 kiwis 8 dates 9 plums 10 nuts',
        ];
        for (const t of OK) {
            clean(t);
            assert.equal(maskContact(t), t);
        }
    });
});

// =====================================================================
// 1d. Spelled-out numbers
// =====================================================================

describe('shield round 2: numbers spelled out in words', () => {
    const FOUND = [
        'nine eight seven six five four three two',
        'Nine Eight Seven Six Five Four Three Two One Zero',
        'NINE EIGHT SEVEN SIX FIVE FOUR THREE TWO',
        'nine, eight, seven, six, five, four, three, two',
        'nine-eight-seven-six-five-four-three-two',
        'my number is nine eight seven six five four three two one zero',
        'nine eight seven and six five four then three two',
        'nau aath saat chhe paanch char teen do',
        'nau aath saat chhe paanch char teen do ek shunya',
        'nau aath saat che panch chaar teen do ek sifar',
        'नौ आठ सात छह पांच चार तीन दो एक शून्य',
        'nine eight seven six five 4 3 2 1 0',
        '9 eight 7 six 5 four 3 two 1 zero',
        'ek ek ek ek ek ek ek ek',
        'nine nine nine nine nine nine nine nine',
        'n​ine eight seven six five four three two',
        '𝐧𝐢𝐧𝐞 𝐞𝐢𝐠𝐡𝐭 𝐬𝐞𝐯𝐞𝐧 𝐬𝐢𝐱 𝐟𝐢𝐯𝐞 𝐟𝐨𝐮𝐫 𝐭𝐡𝐫𝐞𝐞 𝐭𝐰𝐨',
    ];
    for (const t of FOUND) {
        test(`flags ${JSON.stringify(t)}`, () => {
            assert.ok(isPhone(t));
            const out = maskContact(t);
            assert.ok(out.includes('•'), out);
            assert.ok(!isPhone(out), out);
            assert.equal(maskContact(out), out, 'idempotent');
        });
    }

    test('masking keeps the first two and last three words, and everything else as written', () => {
        assert.equal(maskContact('nine eight seven six five four three two'), 'nine eight • • • four three two');
        assert.equal(maskContact('call nine eight seven six five four three two one zero now'), 'call nine eight • • • • • two one zero now');
        assert.equal(maskContact('nau aath saat chhe paanch char teen do ek shunya'), 'nau aath • • • • • do ek shunya');
        assert.equal(maskContact('nine, eight, seven, six, five, four, three, two'), 'nine, eight, •, •, •, four, three, two');
    });

    const FINE = [
        'one two three that is easy as one two three', 'do ek do teen', 'ek do teen char', 'one two three four five', 'one two three four five six seven',
        'one cat, two dogs, three birds, four fish, five hens, six cows, seven ducks, eight geese', 'I have one thing to do and two things to do and three more things to do',
        'do you do what you do', 'तीन चार', 'ek number yaar', 'I do not know what to do, do you?', 'six seven eight nine', 'the one and only two',
        'one of the two or three four-wheelers', 'teen char din baad aana', 'saat baje milte hain', 'nau baje ka show aath baje khatam',
    ];
    for (const t of FINE) test(`does not flag ${JSON.stringify(t)}`, () => { clean(t); assert.equal(maskContact(t), t); });

    test('seven digit words are below the line, eight are over it', () => {
        assert.ok(!isPhone('nine eight seven six five four three'));
        assert.ok(isPhone('nine eight seven six five four three two'));
    });

    test('eight words spread over a whole paragraph are not a number', () => {
        clean('one fine day, a very long time ago, two friends walked three miles, to buy four apples, five pears, six figs, seven plums and eight limes');
    });
});

// =====================================================================
// Masking keeps the original text
// =====================================================================

describe('shield round 2: masking edits the original text', () => {
    test('emoji, variation selectors, joiners and accents survive untouched', () => {
        const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
        const text = `${family} ❤️ ☎️ 👍🏽 café क्‍ष call ${NUMBER} ok ☺️`;
        assert.equal(maskContact(text), `${family} ❤️ ☎️ 👍🏽 café क्‍ष call 98•••••210 ok ☺️`);
    });

    test('hidden characters outside the masked parts are left alone', () => {
        assert.equal(maskContact('a‍b️ c ⁠' + NUMBER), 'a‍b️ c ⁠98•••••210');
        assert.equal(maskContact('‮abc ' + NUMBER + '‏'), '‮abc 98•••••210‏');
    });

    test('numbers split by hidden characters are masked completely, hidden characters inside masked digits go with them', () => {
        const text = [...NUMBER].join('⁠');
        const out = maskContact(text);
        assert.ok(!isPhone(out));
        assert.equal(out.replace(/⁠/g, ''), '98•••••210');
    });

    test('text with no contact details comes back unchanged, byte for byte', () => {
        for (const s of ['a‍b', '‮abc', 'é', 'x y', 'ﬃ', '① two', 'ｆｕｌｌ ｗｉｄｔｈ', '𝐛𝐨𝐥𝐝 𝐭𝐞𝐱𝐭', 'тест', '❤️👍🏽', 'n̶o̶t̶h̶i̶n̶g̶', 'क्‍ष', '\uD800', 'á']) {
            assert.equal(maskContact(s), s, JSON.stringify(s));
        }
    });

    test('addresses are masked from the original even with hidden characters inside', () => {
        const out = maskContact('mail ra​hul@gm⁠ail.com now');
        assert.equal(out, 'mail ra•••@gmail.com now');
        assert.equal(maskContact('pay raㅤhul@okaxis'), 'pay ra•••@okaxis');
    });

    test('a masked message no longer shows the number, and masking again changes nothing', () => {
        const rand = seeded(2024);
        const pick = list => list[Math.floor(rand() * list.length)];
        const seps = ['', ' ', '-', '.', '*', '😀', ' • ', '_', '--', '|', '⭐ '];
        const zeros = [0x30, 0x660, 0x6F0, 0x966, 0x9E6, 0xA66, 0xBE6, 0xE50, 0xFF10, 0x1D7CE, 0x1D7D8, 0x1D7F6];
        const hidden = ['', '', '', '​', '⁠', 'ㅤ', '️', '͏', '\u{E0041}'];
        const prefixes = ['', '', '+91 ', '91-', '0', '(+91) ', '+91 😀 '];
        const lead = ['call ', 'my number is ', '📞 ', '', 'hey 😀 ', 'whatsapp me on '];
        for (let i = 0; i < 1500; i++) {
            let d = pick(['6', '7', '8', '9']);
            while (d.length < 10) d += Math.floor(rand() * 10);
            const zero = pick(zeros);
            const sep = pick(seps);
            const cut = pick([[10], [5, 5], [3, 3, 4], [2, 2, 2, 2, 2], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [4, 3, 3]]);
            let p = 0;
            const groups = cut.map(n => [...d.slice(p, (p += n))].map(c => String.fromCodePoint(zero + +c) + pick(hidden)).join(''));
            const text = pick(lead) + pick(prefixes) + groups.join(sep) + pick([' ok', '', ' 👍']);
            assert.ok(isPhone(text), `not flagged: ${JSON.stringify(text)}`);
            const out = maskContact(text);
            assert.notEqual(out, text, `unmasked: ${JSON.stringify(text)}`);
            assert.ok(!isPhone(out), `still a phone: ${JSON.stringify(out)} (from ${JSON.stringify(text)})`);
            const left = [...out].filter(c => /\p{Nd}/u.test(c)).length;
            assert.ok(left <= 5 + (text.match(/^.*?(?:\+91|91|\(\+91\)|0)/) ? 2 : 0), `too many digits kept: ${JSON.stringify(out)}`);
            assert.equal(maskContact(out), out, `not idempotent: ${JSON.stringify(out)}`);
        }
    });
});

// =====================================================================
// 4. Speed on adversarial input
// =====================================================================

describe('shield round 2: adversarial 4000-character inputs', () => {
    const N = 4000;
    const rep = (s, n = N) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
    const INPUTS = {
        'digits and spaces': rep('9 8 7 6 '), 'digits and dashes': rep('9-'), 'digits and emoji': rep('9😀'), 'digits and stars': rep('9***'),
        'digits and four stars': rep('9****'), 'long digit run': rep('9'), 'digit groups': rep('98765 43210 '), 'plus 91': rep('+91 '), 'plus 1': rep('+1 '),
        'dates': rep('06/09/2024 8:30 '), 'sums': rep('8,000,000,000 '), 'O and l': rep('9O1l'), 'only O': rep('O'), 'digits then letter': rep('9876543210a'),
        'letters': rep('a'), 'f run': rep('f'), 'fu run': rep('fu'), 'ph run': rep('ph'), 'b run': rep('b'), 'bi run': rep('bi'), 'ch run': rep('ch'), 'p run': rep('p'),
        'at signs': rep('@'), 'a@': rep('a@'), 'a@b.': rep('a@b.'), 'emoji': rep('😀'), 'invisible': rep('​'), 'digit and invisible': rep('9​'),
        'tag characters': rep('\u{E0041}'), 'strike-through': rep('a̶'), 'zalgo': 'a' + rep('́̂̃', N - 1), 'stars': rep('*'),
        'f stars k': 'f' + rep('*', N - 2) + 'k', 'ff stars': 'ff' + rep('*', N - 2), 'leet': rep('5h1t '), 'bangs': rep('!'), 'pluses': rep('+'),
        'single letters': rep('a '), 'f u c k': rep('f u c k '), 'one': rep('one '), 'nine': rep('nine '), 'do': rep('do '), 'ek do teen': rep('ek do teen '),
        'words and filler': rep('one cat two dog '), 'spaces': rep(' '), 'dots': rep('.'), 'mixed digits': rep('९৯𝟗⑨'), 'math digits': rep('𝟗𝟖'),
        'devanagari': rep('हहह '), 'long devanagari': rep('ह'), 'camel': rep('aB'), 'camel words': rep('LundKing'), 'insta': rep('insta '),
        'send me': rep('send me your '), 'long labels': rep('a'.repeat(63) + '.'), 'url': 'http://' + rep('a', N - 7), 'nfkc': rep('ﬃ㎏℡'), 'lone surrogate': rep('\uD83D'),
        'folds to 18 letters each': rep('\uFDFA'), 'folds to 18 letters, with digits': rep('\uFDFA9'), 'folds to 18 letters, spaced': rep('\uFDFA '),
    };

    test('scanMessage and maskContact finish well under 50 ms on every one', () => {
        for (const [name, text] of Object.entries(INPUTS)) {
            assert.equal(text.length, N, name);
            const scan = fastest(() => scanMessage(text));
            const mask = fastest(() => maskContact(text));
            assert.ok(scan < 50, `scanMessage(${name}) took ${scan.toFixed(1)} ms`);
            assert.ok(mask < 50, `maskContact(${name}) took ${mask.toFixed(1)} ms`);
        }
    });

    test('isProfane finishes well under 50 ms on every one', () => {
        for (const [name, text] of Object.entries(INPUTS)) {
            const t = fastest(() => isProfane(text));
            assert.ok(t < 50, `isProfane(${name}) took ${t.toFixed(1)} ms`);
        }
    });

    test('characters that fold into many (U+FDFA becomes 18 letters) are cut like any other long input', () => {
        const text = '\uFDFA'.repeat(5000);
        const out = maskContact(text);
        assert.ok(text.startsWith(out), 'the output is a prefix of the input');
        assert.ok(out.length >= 200 && out.length < 1000, String(out.length));
        const tail = '\uFDFA'.repeat(300) + ' 9876543210';
        assert.equal(digitsIn(maskContact(tail + tail + tail)), 0, 'whatever follows the cut-off is dropped, never passed through unmasked');
    });

    test('text past 4000 characters is dropped from the masked output, so nothing unscanned is ever shown', () => {
        assert.ok(maskContact('a'.repeat(4000) + ' call 9876543210') === 'a'.repeat(3800), 'the cut also takes the last 200 characters');
        for (let at = 3600; at <= 4100; at += 7) {
            const out = maskContact('a'.repeat(at) + ' 9876543210 ' + 'b'.repeat(300));
            assert.ok(digitsIn(out) <= 5 && !out.includes('76543'), `${at}: a number cut in half must not stay half visible`);
        }
        assert.ok(maskContact('a'.repeat(3700) + ' 9876543210') === 'a'.repeat(3700) + ' 98•••••210', 'text under the cut-off is untouched');
        assert.ok(isPhone('a'.repeat(3950) + ' 9876543210'), 'scanning still looks at the whole 4000');
    });

    test('input far past the cut-off is cut, not scanned', () => {
        const t = fastest(() => { scanMessage('9 '.repeat(200000)); isProfane('f*'.repeat(200000)); });
        assert.ok(t < 100, `${t.toFixed(1)} ms`);
    });
});
