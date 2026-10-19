// Tests for isProfane() in js/shield.js: what it catches (leet, stretched letters, masked letters, Hinglish, Devanagari, fancy fonts)
// and, as important, what it must leave alone (class, assistant, Scunthorpe, cocktail ... and ordinary Hindi words).
// Run: node --test /tmp/claude-0/-home-user-ohmygoal/80ecaa61-e063-55be-81f7-87bba82dfd45/scratchpad/unit/profanity.hardening2.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { isProfane, scanMessage } = await import('file:///home/user/ohmygoal/js/shield.js');
const identity = await import('file:///home/user/ohmygoal/js/identity.js');

const GARBAGE = [undefined, null, 0, 1, NaN, -1, true, false, {}, [], ['fuck'], () => 1, Symbol('x'), 10n, new Date(), /x/, new String('fuck'), Object.create(null),
    { toString() { throw new Error('boom'); } }];

describe('isProfane: what it catches', () => {
    const PLAIN = ['fuck', 'FUCK', 'Fuck you', 'what the fuck', 'fucking', 'fucker', 'motherfucker', 'clusterfuck', 'fuk', 'fuq', 'fck',
        'shit', 'Shit!', 'shitty', 'bullshit', 'dipshit', 'shithead', 'bitch', 'bitches', 'bitchy', 'sonofabitch', 'biatch', 'cunt', 'cunts', 'dick', 'dickhead', 'cock',
        'cocksucker', 'pussy', 'pussies', 'whore', 'slut', 'sluts', 'slutty', 'faggot', 'fag', 'nigga', 'nigger', 'niggas', 'retard', 'retarded', 'porn', 'pornhub',
        'pornography', 'nude', 'nudes', 'send nudes', 'bastard', 'asshole', 'arsehole', 'wanker', 'twat',
        'you are a bitch', 'hello you shitty person'];
    for (const t of PLAIN) test(`English: ${JSON.stringify(t)}`, () => assert.equal(isProfane(t), true));

    const LEET = ['f*ck', 'f**k', 'fu*k', 'f#ck', 'f%ck', 'ph*ck', 'phuck', 'fvck', 'sh1t', 'sh!t', 'sh*t', '$hit', '5h1t', 'sh1tty', 'b!tch', 'b1tch', 'bi7ch', 'b*tch', 'bitch!',
        'c*nt', 'c*nt', 'd1ck', 'd!ck', 'c0ck', 'c0cksucker', 'pu$$y', 'pu55y', 'pu**y', 'wh0re', 'wh*re', 'sl*t', 'slut', 'f4g', 'f4ggot', 'n1gger', 'n1gga', 'n*gger',
        'r3tard', 'p0rn', 'p*rn', 'nud3s', 'b4stard', '@sshole', 'a$$hole', 'w4nker', 'tw4t', 'FU*K', 'F*CK YOU'];
    for (const t of LEET) test(`leet and masked letters: ${JSON.stringify(t)}`, () => assert.equal(isProfane(t), true));

    const STRETCHED = ['fuuuuck', 'fuuck', 'fuckkkk', 'shiiiit', 'shhhit', 'biiiitch', 'bitccchhh', 'diiick', 'cuuunt', 'pusssssy', 'whoooore', 'sluuuut', 'ffffuck',
        'madarchoddd', 'chuuutiya', 'gaaandu', 'bhosdikeee'];
    for (const t of STRETCHED) test(`stretched letters: ${JSON.stringify(t)}`, () => assert.equal(isProfane(t), true));

    const SPACED = ['f u c k', 'f.u.c.k', 'f-u-c-k', 's h i t', 'b . i . t . c . h', 'f u c k i n g', 'c u n t', 's.h.1.t', 'f u * k'];
    for (const t of SPACED) test(`letters spread out: ${JSON.stringify(t)}`, () => assert.equal(isProfane(t), true));

    const HINGLISH = ['madarchod', 'maderchod', 'madrchod', 'madharchod', 'mc', 'MC', 'bc', 'behenchod', 'behnchod', 'bhenchod', 'benchod', 'bhosdike', 'bhosdi', 'bhosda', 'bhosad', 'bsdk', 'bkl',
        'mkc', 'chutiya', 'chutiye', 'chutia', 'chootiya', 'chutiyapa', 'chut', 'choot', 'gandu', 'gaandu', 'gaand', 'gand', 'lund', 'lauda', 'lawda', 'lavda', 'laude', 'randi', 'randwa', 'harami',
        'haraami', 'haramkhor', 'haramzada', 'haramzade', 'bakchod', 'bakchodi', 'jhant', 'jhaant', 'jhatu', 'bhadwa', 'bhadwe', 'bhadva', 'chudai', 'kuttiya', 'mad4rchod',
        'teri maa ki chut', 'abe chutiye', 'saale harami'];
    for (const t of HINGLISH) test(`Hinglish: ${JSON.stringify(t)}`, () => assert.equal(isProfane(t), true));

    const DEVANAGARI = ['मादरचोद', 'बहनचोद', 'भेनचोद', 'बकचोद', 'भोसड़ी', 'भोसडी', 'चूतिया', 'चुतिया', 'चूतिये', 'गांडू', 'गाँडू', 'गान्डू', 'लौड़ा', 'लौडा', 'लंड', 'लण्ड', 'रंडी', 'रण्डी', 'हरामी', 'हरामखोर',
        'हरामज़ादा', 'हरामजादा', 'झांट', 'भड़वा', 'भडवा', 'तू हरामी है', 'अबे चूतिया'];
    for (const t of DEVANAGARI) test(`Devanagari: ${JSON.stringify(t)}`, () => assert.equal(isProfane(t), true));

    test('fancy fonts, full-width letters and accents do not hide a swear word', () => {
        for (const t of ['𝐟𝐮𝐜𝐤', '𝒻𝓊𝒸𝓀', '𝕗𝕦𝕔𝕜', 'ｆｕｃｋ', 'ⓕⓤⓒⓚ', 'fúck', 'fück', 'ḟuck', 'f̶u̶c̶k̶', 'shit', '𝐛𝐢𝐭𝐜𝐡']) {
            assert.equal(isProfane(t), true, t);
        }
    });

    test('invisible characters inside a swear word do not hide it', () => {
        for (const ch of ['​', '‍', '⁠', 'ㅤ', '️', '͏', '­', '\u{E0041}', '؜', '‮']) {
            assert.equal(isProfane([...'fuck'].join(ch)), true, JSON.stringify(ch));
            assert.equal(isProfane([...'madarchod'].join(ch)), true, JSON.stringify(ch));
        }
    });

    test('swear words inside CamelCase and padded names (handles)', () => {
        for (const t of ['LundKing', 'DickMaster', 'xXshitXx', 'xXbitchXx', 'xxfuckxx', 'Fuck_You', 'big.dick.energy', 'ChutiyaBoy99', 'RandiRona', 'the_bitch', 'Harami-King']) {
            assert.equal(isProfane(t), true, t);
        }
    });

    test('a swear word anywhere in a longer text', () => {
        assert.equal(isProfane('hello there my friend, how are you doing today? you are such a bitch honestly'), true);
        assert.equal(isProfane('x '.repeat(1000) + 'fuck'), true);
        assert.equal(isProfane('abe ' + 'ok '.repeat(500) + ' madarchod'), true);
    });
});

describe('isProfane: what it must leave alone', () => {
    // The Scunthorpe problem: innocent words that contain a swear word's letters.
    const SCUNTHORPE = ['class', 'classic', 'classes', 'assistant', 'assassin', 'assess', 'assume', 'bass', 'bassist', 'grass', 'pass', 'password', 'mass', 'massive', 'scunthorpe', 'Scunthorpe',
        'cocktail', 'cockpit', 'cockroach', 'cockatoo', 'cockney', 'cocker', 'peacock', 'hancock', 'Hitchcock', 'woodcock', 'dickens', 'Dickens', 'Dickinson', 'Dickson', 'shiitake', 'shitake',
        'Shiite', 'shut', 'shot', 'shirt', 'shift', 'shin', 'hit', 'sit', 'bitcoin', 'bit', 'bitter', 'butter', 'batch', 'bench', 'witch', 'which', 'beach', 'rich', 'analysis', 'analyst',
        'therapist', 'cucumber', 'document', 'circumstance', 'Essex', 'Sussex', 'Middlesex', 'Niger', 'Nigeria', 'niggle', 'niggardly', 'pushing', 'push', 'puss',
        'pronto', 'prom', 'porous', 'portal', 'horn', 'born', 'corn', 'fact', 'fax', 'fog', 'fork', 'duck', 'dock', 'deck', 'dig', 'dog', 'wankel',
        'twin', 'twitter', 'twelve', 'retardant', 'bastille', 'nudge', 'nudge', 'cunning', 'country', 'countries', 'hello', 'helmet', 'ass', 'arse', 'hell', 'damn', 'crap', 'sex',
        'fugitive', 'fuse', 'Fukuoka', 'Fukushima', 'fuku', 'pharmacy', 'physics', 'phone', 'photo', 'whole', 'who', 'where', 'whorl', 'slug', 'slum', 'slush', 'slot', 'sluice'];
    for (const t of SCUNTHORPE) test(`leaves ${JSON.stringify(t)} alone`, () => assert.equal(isProfane(t), false));

    // Ordinary Hindi / Hinglish words that look like abuse to a naive matcher.
    const HINDI = ['choti', 'chhoti behen', 'chhota', 'chod do', 'chhod do yaar', 'chhut', 'chutti', 'chuti', 'chutki', 'chutney', 'chute', 'parachute', 'ganda', 'gandi', 'gandhi', 'Gandhi', 'gandagi',
        'haram', 'harambe', 'Harmeet', 'Bhosari', 'Bhosle', 'bhopal', 'bhosa', 'madhur', 'Madhavi', 'madan', 'madrid', 'madras', 'mad', 'madar', 'madad', 'behen', 'bhen', 'bhai', 'bakra', 'bakri', 'baat',
        'lunch', 'lunar', 'lunatic', 'launch', 'laundry', 'lauki', 'ladoo', 'laddu', 'ladka', 'randy', 'Randall', 'rand', 'randhir', 'kutta', 'kutte', 'kutiya', 'kuttu', 'jhat', 'jhatka', 'jhansi',
        'bhadaur', 'chudail', 'chuda', 'chudidar', 'dalal', 'saala', 'kamina', 'ullu', 'bhaiya', 'dost', 'yaar', 'bhojpuri',
        'bcc', 'mcq', 'mcdonalds', 'McDonald', 'MacBook', 'abc', 'bca', 'mca', 'bcom', 'mba', 'bsc', 'bks'];
    for (const t of HINDI) test(`leaves ${JSON.stringify(t)} alone`, () => assert.equal(isProfane(t), false));

    const DEV_OK = ['छोटी', 'छोटा', 'चोट', 'गांधी', 'गांडीव', 'गाना', 'राहुल', 'भारत', 'कलम', 'चुटकी', 'लड्डू', 'हराम', 'रंगोली', 'लंच', 'मादा', 'बहन', 'भाई', 'कुत्ता', 'हरा', 'चूहा', 'चूड़ी', 'गंदा', 'लौकी',
        'नमस्ते', 'आज मौसम बहुत अच्छा है', 'मेरा नाम राहुल है'];
    for (const t of DEV_OK) test(`leaves ${JSON.stringify(t)} alone`, () => assert.equal(isProfane(t), false));

    test('ordinary sentences, names and chat are clean', () => {
        for (const t of ['hello how are you', 'what is your favourite movie?', 'I love cricket and biryani', 'the class assistant went to Scunthorpe for a cocktail', 'Rahul', 'Priya Sharma', 'ChaiPanda42',
            'I scored 98 runs', 'kya haal hai bhai', 'mera naam Rahul hai', 'aaj match dekha kya?', 'Happy birthday!!!', 'wow!', 'what?!', 'ok...', 'cool :)', 'a b c d e f g', 'u r a b c', 'I am an ass',
            '', '   ', '****', '*', 'f***', 'f', 'fu', 'fc', 'fk', '!!!', '😀😀😀', 'x', 'xx', 'Alexx', 'ximenez', 'Maxx', '1234567890', 'bit characters', 'high bit characters', 'bitcharacters']) {
            assert.equal(isProfane(t), false, JSON.stringify(t));
        }
    });

    test('the shield stays out of it: a swear word is not a scam', () => {
        assert.deepEqual(scanMessage('what the fuck'), { risky: false, kinds: [] });
    });

    test('none of the names the app can generate is profane', () => {
        const names = new Set();
        for (let i = 0; i < 64; i++) {
            for (let j = 0; j < 64; j++) {
                const q = [(i + 0.5) / 64, (j + 0.5) / 64, 0.99];
                names.add(identity.generateHandle(() => q.shift() ?? 0.5));
            }
        }
        assert.ok(names.size > 3000, String(names.size));
        for (const name of names) assert.equal(isProfane(name), false, name);
    });
});

describe('isProfane: robustness', () => {
    test('returns false for anything that is not a string, and never throws', () => {
        for (const g of GARBAGE) assert.equal(isProfane(g), false);
    });

    test('is stateless and repeatable', () => {
        for (let i = 0; i < 30; i++) {
            assert.equal(isProfane('fuck'), true);
            assert.equal(isProfane('class'), false);
            assert.equal(isProfane('f*ck sh1t'), true);
        }
    });

    test('lone surrogates, huge code points and odd mixes never throw', () => {
        for (const t of ['\uD800', '\uDC00\uD800', 'a\uD83Db', '\u{10FFFF}', '\u{E0001}', 'fu\uD800ck', '\u0000fuck', 'fuck\u0000', 'a'.repeat(10000), '́'.repeat(5000), '*'.repeat(5000)]) {
            assert.equal(typeof isProfane(t), 'boolean');
        }
    });

    test('only the first 4000 characters are read', () => {
        assert.equal(isProfane('a '.repeat(2500) + 'fuck'), false);
        assert.equal(isProfane('a '.repeat(1900) + 'fuck'), true);
    });

    test('masked-out text (all symbols) is censoring, not a word', () => {
        for (const t of ['*****', '#####', '%%%%', '**', '*a*', '_*_']) assert.equal(isProfane(t), false, t);
    });
});
