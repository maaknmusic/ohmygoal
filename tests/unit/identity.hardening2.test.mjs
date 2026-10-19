// Regression tests for sanitizeHandle() in js/identity.js, second review round: numbers in nicknames, invisible characters,
// profanity and look-alikes of the service's own name.
// Run: node --test /tmp/claude-0/-home-user-ohmygoal/80ecaa61-e063-55be-81f7-87bba82dfd45/scratchpad/unit/identity.hardening2.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const identity = await import('file:///home/user/ohmygoal/js/identity.js');
const { scanMessage } = await import('file:///home/user/ohmygoal/js/shield.js');
const { sanitizeHandle, generateHandle } = identity;

const digitCount = s => (s.match(/\p{N}/gu) || []).length;

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

describe('sanitizeHandle round 2: numbers in a nickname', () => {
    test('six or more digits anywhere make the handle unusable', () => {
        for (const h of ['123456', 'Rahul 123456', 'a1b2c3d4e5f6', 'x1x2x3x4x5x6', '1 2 3 4 5 6', 'Rahul19990101', '000000', 'A_1_2_3_4_5_6', '1.2.3.4.5.6', 'Priya-654321-x']) {
            assert.equal(sanitizeHandle(h), '', h);
        }
    });

    test('five digits or fewer are fine (years, jersey numbers, the generator\'s own suffix)', () => {
        for (const h of ['Rahul1999', 'Rahul19990', '12345', 'ChaiPanda42', 'Kohli18', 'CSK2024', 'Player 7', 'a1b2c3d4e5']) {
            assert.equal(sanitizeHandle(h), h, h);
        }
    });

    test('digits of every script count, as do circled, superscript and mathematical digits', () => {
        for (const h of ['१२३४५६', '৯৮৭৬৫৪৩২১০', '௧௨௩௪௫௬', '๑๒๓๔๕๖', '١٢٣٤٥٦', '１２３４５６', '𝟏𝟐𝟑𝟒𝟓𝟔', '①②③④⑤⑥', '¹²³⁴⁵⁶', '₁₂₃₄₅₆', 'Ra१२३hul४५६']) {
            assert.equal(sanitizeHandle(h), '', h);
        }
        assert.equal(sanitizeHandle('Rahul१२३'), 'Rahul१२३', 'three digits are fine in any script');
    });

    test('digits hidden between invisible characters or symbols still count', () => {
        assert.equal(sanitizeHandle('9​8​7​6​5​4'), '');
        assert.equal(sanitizeHandle('9ㅤ876⁠543'), '');
        assert.equal(sanitizeHandle('9!8@7#6$5%4^3'), '');
        assert.equal(sanitizeHandle('Rahul️1️2️3️4️5️6'), '');
    });

    test('the digits that count are the ones that would be shown', () => {
        const kept = sanitizeHandle('abcdefghijklmnopqrs12 3456');
        assert.equal(kept, 'abcdefghijklmnopqrs1', 'only one digit fits in 20 characters');
        assert.equal(digitCount(kept), 1);
    });

    test('a phone number or UPI id in a nickname is gone, in any script or disguise', () => {
        for (const h of ['9876543210', '98765 43210', '+91 98765 43210', '98765-43210', '९८७६५४३२१०', '৯৮৭৬৫৪৩২১০', '９８７６５４３２１０', '9️⃣8️⃣7️⃣6️⃣5️⃣4️⃣3️⃣2️⃣1️⃣0️⃣', '9.8.7.6.5.4.3.2.1.0', '9_8_7_6_5_4_3_2_1_0',
            '9​8​7​6​5​4​3​2​1​0', 'rahul phone 98765 43210', 'insta rahul_99', 'snap priya99', 'rahul at gmail dot com', 'add me on snap']) {
            assert.equal(sanitizeHandle(h), '', JSON.stringify(h));
        }
    });

    test('digits spelled out in words are caught on the full text, not only on the 20 characters shown', () => {
        assert.equal(sanitizeHandle('nine eight seven six five four three two one zero'), '');
        assert.equal(sanitizeHandle('nau aath saat chhe paanch char teen do ek shunya'), '');
        assert.equal(sanitizeHandle('nine eight seven six five four three two'), '');
        assert.equal(sanitizeHandle('one two three'), 'one two three');
    });
});

describe('sanitizeHandle round 2: invisible characters', () => {
    const HIDDEN = [0x034F, 0x061C, 0x115F, 0x1160, 0x17B4, 0x17B5, 0x180B, 0x180C, 0x180D, 0x180E, 0x180F, 0x3164, 0xFFA0, 0xFE00, 0xFE0F, 0x206A, 0x206F, 0xE0041, 0xE007F, 0xE0100, 0x200B, 0x200C,
        0x200D, 0x200E, 0x200F, 0x202A, 0x202E, 0x2060, 0x2066, 0x2069, 0x00AD, 0xFEFF, 0x2800, 0xFFF9, 0x0000, 0x001B, 0x007F, 0x0085];
    for (const code of HIDDEN) {
        const ch = String.fromCodePoint(code);
        test(`U+${code.toString(16).toUpperCase().padStart(4, '0')} is dropped, and a handle made only of it is empty`, () => {
            assert.equal(sanitizeHandle('Ra' + ch + 'hul'), 'Rahul');
            assert.equal(sanitizeHandle(ch), '');
            assert.equal(sanitizeHandle(ch.repeat(50)), '');
            assert.equal(sanitizeHandle(' ' + ch + ' ' + ch + ' '), '');
            assert.equal(sanitizeHandle('a' + ch.repeat(30) + 'b'), 'ab');
            assert.equal(sanitizeHandle([...'Rahul'].join(ch)), 'Rahul');
        });
    }

    test('only invisible or whitespace characters make an empty handle', () => {
        for (const h of ['', ' ', '   ', '\t\n\r', ' ', '  ', '　', '​ ​', 'ㅤㅤㅤ', '️', '\u{E0020}\u{E0041}', '  ', '\u0000\u0001\u0002']) {
            assert.equal(sanitizeHandle(h), '', JSON.stringify(h));
        }
    });

    test('invisible characters cannot be used to split a phone number or a word the shield knows', () => {
        assert.equal(sanitizeHandle('9ㅤ876543210'), '');
        assert.equal(sanitizeHandle('i​nsta rahul_99'), '');
        assert.equal(sanitizeHandle('f‍u‍c‍k'), '');
        assert.equal(sanitizeHandle('Adㅤmin'), '');
    });

    test('handles come out free of invisible characters and idempotent', () => {
        const rand = seeded(77);
        const pool = ['a', 'B', 'ह', 'é', '1', ' ', '.', '-', '_', '​', 'ㅤ', '️', '⁠', '\u{E0041}', '😀', '́', 'x', 'K'];
        for (let i = 0; i < 2000; i++) {
            let s = '';
            for (let j = 0; j < 4 + Math.floor(rand() * 30); j++) s += pool[Math.floor(rand() * pool.length)];
            const once = sanitizeHandle(s);
            assert.doesNotMatch(once, /[\p{Default_Ignorable_Code_Point}\p{Cc}]/u, JSON.stringify(s));
            assert.equal(sanitizeHandle(once), once, JSON.stringify(s));
            assert.ok([...once].length <= 20);
            assert.ok(digitCount(once) <= 5);
            assert.equal(scanMessage(once).risky, false);
        }
    });
});

describe('sanitizeHandle round 2: profanity', () => {
    test('swear words are refused, in the disguises people use', () => {
        for (const h of ['Fuck', 'F*ck', 'fuck123', 'fuuuck', 'sh1t', 'B!tch', 'bitch', 'dick', 'Dick Head', 'cunt', 'whore', 'slut', 'f.u.c.k', 'f u c k', 'LundKing', 'DickMaster', 'xXshitXx', 'xXbitchXx',
            'chutiya', 'Chutiya_Boy', 'madarchod', 'MC', 'BC', 'bhosdike', 'gaandu', 'Harami', 'randi', 'बहनचोद', 'चूतिया', 'हरामी', '𝐟𝐮𝐜𝐤', 'ｆｕｃｋ', 'f​uck', 'pornhub', 'nigga', 'retard']) {
            assert.equal(sanitizeHandle(h), '', h);
        }
    });

    test('innocent names that contain the same letters are fine', () => {
        for (const h of ['Class of 2024', 'Assistant', 'Scunthorpe', 'Cocktail', 'Dickens', 'Hancock', 'Shiitake', 'McDonald', 'Badminton', 'Bhosle', 'Chutki', 'Gandhi', 'Madhur', 'Choti', 'Priya Sharma',
            'Rahul', 'राहुल शर्मा', 'José Müller', 'Niger', 'Bitcoin', 'Analyst', 'Therapist', 'Harmeet', 'Chandni', 'Chetan', 'Mandira', 'Randhir', 'Lucknow', 'Bhopal']) {
            assert.equal(sanitizeHandle(h), h, h);
        }
    });

    test('profanity in the part beyond 20 characters is judged too (the full name is what the sender chose)', () => {
        assert.equal(sanitizeHandle('A'.repeat(30) + ' fuck'), '');
    });
});

describe('sanitizeHandle round 2: names that pose as the service or its staff', () => {
    test('official-sounding names are refused', () => {
        for (const h of ['Admin', 'admin', 'ADMIN', 'Admin123', 'admin_99', 'Adm1n', '4dmin', 'Rahul Admin', 'AdminRahul', 'Administrator', 'Moderator', 'Mod3rator', 'Support', 'Support Team', 'OhMyGoal Support',
            'Official', 'Official.Account', 'Staff', 'Staff Member', 'Helpdesk', 'Verified', 'Police', 'Delhi Police', 'Cyber Cell', 'Customer Care', 'OhMyGoal', 'Oh My Goal', 'oh_my_goal', 'ohmyg0al', 'OHMYGOAL TEAM',
            'ｏｈｍｙｇｏａｌ', 'O​h​M​y​G​o​a​l', 'Trust and Safety']) {
            assert.equal(sanitizeHandle(h), '', h);
        }
    });

    test('names that merely contain those letters are fine', () => {
        for (const h of ['Badminton', 'Administration', 'Unofficial', 'Staffordshire', 'Supporter', 'Admiral', 'Goalkeeper', 'Goal Hunter', 'Oh My', 'My Goal', 'Modern', 'Moderate', 'Mod', 'Team India', 'Safety Pin']) {
            assert.equal(sanitizeHandle(h), h, h);
        }
    });
});

describe('sanitizeHandle round 2: what stays the same', () => {
    test('every generated name passes unchanged (all word and thing pairs, with and without a number)', () => {
        const names = new Set();
        for (let i = 0; i < 64; i++) {
            for (let j = 0; j < 64; j++) {
                for (const tail of [0.99, 0.1]) {
                    for (const n of [0, 0.5, 0.995]) {
                        const q = [(i + 0.5) / 64, (j + 0.5) / 64, tail, n];
                        names.add(generateHandle(() => q.shift() ?? 0.5));
                    }
                }
            }
        }
        assert.ok(names.size > 3500, String(names.size));
        for (const name of names) assert.equal(sanitizeHandle(name), name, name);
    });

    test('generateHandle with random seeds always passes', () => {
        const rand = seeded(5);
        for (let i = 0; i < 20000; i++) {
            const h = generateHandle(rand);
            assert.equal(sanitizeHandle(h), h, h);
        }
    });

    test('the old rules still hold', () => {
        assert.equal(sanitizeHandle('   Rahul    Kumar   '), 'Rahul Kumar');
        assert.equal(sanitizeHandle('A'.repeat(100)), 'A'.repeat(20));
        assert.equal(sanitizeHandle('Rah@ul#$%^&*!'), 'Rahul');
        assert.equal(sanitizeHandle('राहुल शर्मा'), 'राहुल शर्मा');
        for (const g of [undefined, null, 5, {}, [], ['Rahul'], Symbol('x'), 10n]) assert.equal(sanitizeHandle(g), '');
    });

    test('hostile long input is cut and stays fast', () => {
        const inputs = ['9 '.repeat(100000), 'f*'.repeat(100000), '​'.repeat(100000) + 'x', 'ab'.repeat(100000), 'xX'.repeat(100000), '\u{E0041}'.repeat(100000), 'nine '.repeat(50000), 'LundKing'.repeat(20000)];
        let best = Infinity;
        for (let run = 0; run < 3; run++) {
            const t = performance.now();
            for (const s of inputs) sanitizeHandle(s);
            best = Math.min(best, performance.now() - t);
        }
        assert.ok(best < 300, `${best.toFixed(1)} ms for ${inputs.length} inputs`);
    });
});
