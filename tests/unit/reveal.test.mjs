// Mutual reveal: nothing is accepted before both say yes, cards are sanitized, and a hostile peer can't push anything else in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REVEAL_AFTER_MS, BIO_MAX, CONTACT_MAX, sanitizeContact, sanitizeCard, buildCard, createReveal } from '/home/user/ohmygoal/js/reveal.js';

const good = { nick: 'MonsoonFox', avatar: { e: '🦊', h: 200 }, country: 'IN', lang: 'hi', learn: 'en', interests: ['cricket', 'music'], bio: 'Pune. Chai over coffee.', contact: 'priya_k' };

test('ten minutes', () => { assert.equal(REVEAL_AFTER_MS, 600000); });

test('contacts are handles, never links', () => {
    for (const ok of ['priya_k', '@priya.k', '+91 98765 43210', 'priya-k', 'प्रिया']) assert.equal(sanitizeContact(ok), ok, ok);
    for (const bad of ['', '   ', null, undefined, 5, 'https://t.me/x', 'www.x.com', 'x.com', 'me.me/x', '<b>x</b>', 'a//b', 'x'.repeat(10) + '\n<script>', {}, ['x']]) assert.equal(sanitizeContact(bad), '', String(bad));
    assert.equal(sanitizeContact('a'.repeat(100)).length, CONTACT_MAX);
});

test('a card keeps only known fields, cleaned', () => {
    const c = sanitizeCard({ ...good, bio: '  hi‮ there​  \n\n you  ' + 'x'.repeat(200), evil: '<script>', __proto__: { x: 1 } });
    assert.equal(c.nick, 'MonsoonFox');
    assert.equal(c.country, 'IN');
    assert.equal(c.lang, 'hi');
    assert.equal(c.learn, 'en');
    assert.deepEqual(c.interests, ['cricket', 'music']);
    assert.ok(c.bio.length <= BIO_MAX && c.bio.startsWith('hi there you'));
    assert.ok(!('evil' in c));
    assert.deepEqual(Object.keys(c).sort(), ['avatar', 'bio', 'contact', 'country', 'interests', 'lang', 'learn', 'nick']);
});

test('a card with bad fields loses them; one with no name is not a card', () => {
    const c = sanitizeCard({ nick: 'Ok', country: 'india', lang: 'xx', learn: '<>', interests: 'cricket', bio: 5, contact: 'https://x.y' });
    assert.deepEqual(c, { nick: 'Ok', avatar: c.avatar, country: '', lang: '', learn: '', interests: [], bio: '', contact: '' });
    assert.equal(sanitizeCard({ interests: ['a'] }), null);
    for (const bad of [null, undefined, 0, 'x', [], [good], true]) assert.equal(sanitizeCard(bad), null, String(bad));
    assert.equal(sanitizeCard({ nick: good.nick, interests: Array.from({ length: 50 }, (_, i) => 'i' + i) }).interests.length, 5);
});

test('buildCard carries the wire type', () => {
    const c = buildCard(good);
    assert.equal(c.t, 'card');
    assert.equal(c.contact, 'priya_k');
});

test('the dance: both must agree before any card is sent or accepted', () => {
    const a = createReveal();
    assert.equal(a.shouldSendCard(), false);
    assert.equal(a.onCard(buildCard(good)), null, 'a card before anyone agreed');
    assert.equal(a.iAgree(), 'send-yes');
    assert.equal(a.iAgree(), null, 'saying yes twice does nothing');
    assert.equal(a.shouldSendCard(), false, 'only I said yes');
    assert.equal(a.onCard(buildCard(good)), null, 'a card when only I said yes');
    assert.equal(a.onReveal({ s: 'yes' }), 'they-agreed');
    assert.equal(a.shouldSendCard(), true);
    assert.equal(a.shouldSendCard(), false, 'once');
    const card = a.onCard(buildCard(good));
    assert.equal(card.nick, 'MonsoonFox');
    assert.equal(a.onCard(buildCard(good)), null, 'a second card is ignored');
});

test('their yes before mine works the same way', () => {
    const a = createReveal();
    assert.equal(a.onReveal({ s: 'yes' }), 'they-agreed');
    assert.equal(a.shouldSendCard(), false);
    assert.equal(a.onCard(buildCard(good)), null);
    a.iAgree();
    assert.equal(a.shouldSendCard(), true);
    assert.ok(a.onCard(buildCard(good)));
});

test('a no ends it for good', () => {
    const a = createReveal();
    a.iAgree();
    assert.equal(a.onReveal({ s: 'no' }), 'they-declined');
    assert.equal(a.onReveal({ s: 'yes' }), null);
    assert.equal(a.shouldSendCard(), false);
    assert.equal(a.onCard(buildCard(good)), null);
    const b = createReveal();
    assert.equal(b.iDecline(), 'send-no');
    assert.equal(b.iDecline(), null);
    assert.equal(b.iAgree(), null);
    assert.equal(b.onReveal({ s: 'yes' }), null);
});

test('hostile reveal and card messages are ignored', () => {
    const a = createReveal();
    for (const bad of [null, undefined, 5, 'yes', [], {}, { s: 'maybe' }, { s: 'YES' }, { s: ['yes'] }, { s: { toString: () => 'yes' } }]) assert.equal(a.onReveal(bad), null, JSON.stringify(bad));
    a.iAgree(); a.onReveal({ s: 'yes' });
    assert.equal(a.onCard({ ...good, bio: 'x'.repeat(5000) }), null, 'oversize');
    assert.equal(a.onCard({ interests: ['a'] }), null, 'no name');
    assert.equal(a.onCard(null), null);
    const circular = {}; circular.self = circular;
    assert.equal(a.onCard(circular), null);
    assert.ok(a.onCard(good), 'a valid one still works after the bad ones');
});
