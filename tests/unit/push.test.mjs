// Push notifications: what is said, what is accepted as a token, and the per-pair limits. (The delivery itself is tested in the emulator.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanToken, cleanName, compose, canSend, GAP, MAX_TOKENS } from '/home/user/ohmygoal/functions/push.js';

test('tokens: only plausible push tokens are stored', () => {
    const good = 'f'.repeat(30) + ':APA91b' + 'x'.repeat(100);
    assert.equal(cleanToken(good), good);
    for (const bad of ['', 'short', null, undefined, 5, {}, [], 'a b'.repeat(10), '<script>'.repeat(5), 'x'.repeat(5000), `${good}\n`, '../'.repeat(20)]) assert.equal(cleanToken(bad), null, String(bad).slice(0, 20));
    assert.equal(MAX_TOKENS, 5);
});

test('names are cleaned before they reach a lock screen', () => {
    assert.equal(cleanName('Priya'), 'Priya');
    assert.equal(cleanName('  Priya  '), 'Priya');
    assert.equal(cleanName('x'.repeat(100)).length, 30);
    assert.equal(cleanName('a‮b​c\n\td'), 'abcd');
    for (const bad of ['', '   ', null, undefined, 5, {}, '​​']) assert.equal(cleanName(bad), 'A friend');
});

test('every notification says who, never what: no message text is ever part of one', () => {
    for (const kind of ['request', 'accepted', 'call', 'message', 'online']) {
        const m = compose(kind, 'Priya');
        assert.ok(m.title && m.body && m.tag, kind);
        assert.ok((m.title + m.body).includes('Priya'), kind);
        assert.ok(m.title.length <= 80 && m.body.length <= 140);
    }
    assert.equal(compose('message', 'Priya').body, 'Sent you a message.');
    assert.equal(compose('nope', 'x'), null);
    assert.equal(compose('__proto__', 'x'), null);
    assert.equal(compose('call', 'x'.repeat(500)).title.length <= 80, true);
});

test('rate limits per kind: calls fast, messages slower, online notices rare', () => {
    const t = 1_000_000_000;
    assert.equal(canSend('message', undefined, t), true);
    assert.equal(canSend('message', t - 1000, t), false);
    assert.equal(canSend('message', t - GAP.message, t), true);
    assert.equal(canSend('online', t - 5 * 3600000, t), false);
    assert.equal(canSend('online', t - 6 * 3600000, t), true);
    assert.equal(canSend('call', t - 5000, t), false);
    assert.equal(canSend('call', t - 21000, t), true);
    assert.equal(canSend('accepted', t - 1, t), true);   // no limit: it can only happen once per friendship
    assert.equal(canSend('request', 'garbage', t), true); // a corrupted record doesn't block someone forever
    assert.ok(GAP.online > GAP.message && GAP.message > GAP.call);
});
