// Live sessions: the numbers (fees, the 70/30 split, payout value), what a title may contain, and when a session counts as running.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_START_FEE, PRIVATE_FEE, HOST_SHARE_PCT, COIN_VALUE_PAISE, MIN_PAYOUT_COINS, MAX_SESSION_MS, STARTS_PER_DAY, splitCoins, coinsToPaise, cleanText, cleanTitle, looksLikeContact, maxGuestsFor, sessionIsLive } from '/home/user/ohmygoal/functions/live.js';
import { GIFTS } from '/home/user/ohmygoal/functions/gifts.js';
import { CAPS } from '/home/user/ohmygoal/functions/groups.js';

test('the agreed numbers: 49 coins to go live, 200 coins for a private seat, the host keeps 70%', () => {
    assert.equal(LIVE_START_FEE, 49);
    assert.equal(PRIVATE_FEE, 200);
    assert.equal(HOST_SHARE_PCT, 70);
    assert.equal(MAX_SESSION_MS, 3 * 3600000);
    assert.ok(COIN_VALUE_PAISE > 0 && COIN_VALUE_PAISE <= 100);
    assert.equal(MIN_PAYOUT_COINS, 300);
    assert.ok(STARTS_PER_DAY >= 1);
});

test('splitCoins: 70% to the host rounded down, the rest to the platform, never a coin lost or made', () => {
    assert.deepEqual(splitCoins(200), { host: 140, platform: 60 });
    assert.deepEqual(splitCoins(100), { host: 70, platform: 30 });
    assert.deepEqual(splitCoins(5), { host: 3, platform: 2 });
    assert.deepEqual(splitCoins(0), { host: 0, platform: 0 });
    assert.deepEqual(splitCoins(1), { host: 0, platform: 1 });
    for (let n = 0; n <= 2000; n++) {
        const s = splitCoins(n);
        assert.equal(s.host + s.platform, n, String(n));
        assert.ok(s.host >= 0 && s.platform >= 0 && s.host <= n);
        assert.ok(s.host <= (n * 70) / 100 && s.host > (n * 70) / 100 - 1, `${n}: host share is 70% rounded down`);
    }
    for (const [name, price] of Object.entries(GIFTS)) assert.equal(splitCoins(price).host + splitCoins(price).platform, price, name);
});

test('splitCoins and coinsToPaise are safe with nonsense', () => {
    for (const bad of [-5, NaN, undefined, null, 'x', Infinity, {}, []]) {
        const s = splitCoins(bad);
        assert.ok(Number.isInteger(s.host) && Number.isInteger(s.platform) && s.host >= 0 && s.platform >= 0, String(bad));
        assert.ok(Number.isInteger(coinsToPaise(bad)) && coinsToPaise(bad) >= 0, String(bad));
    }
    assert.equal(coinsToPaise(1000), 1000 * COIN_VALUE_PAISE);
    assert.equal(coinsToPaise(2.9), 2 * COIN_VALUE_PAISE);
});

test('the platform never pays out more than it takes in: a gift sold at the cheapest pack rate covers the host share at the payout rate', () => {
    // cheapest rate: 500 coins for ₹349 = ₹0.698 a coin = 69.8 paise. The host gets 70% of the coins, each worth COIN_VALUE_PAISE.
    const paiseIn = 69.8, hostPaisePerCoinSpent = (HOST_SHARE_PCT / 100) * COIN_VALUE_PAISE;
    assert.ok(hostPaisePerCoinSpent < paiseIn, `${hostPaisePerCoinSpent} paise paid out per coin spent vs ${paiseIn} paise received`);
});

test('cleanText strips control and direction characters and cuts to length', () => {
    assert.equal(cleanText('  hello\u0000‮   world  ', 50), 'hello world');
    assert.equal(cleanText('x'.repeat(500), 20).length, 20);
    for (const bad of [null, undefined, 5, {}, []]) assert.equal(cleanText(bad, 10), '');
});

test('looksLikeContact catches links, e-mail, phone numbers and the usual apps, and lets ordinary titles through', () => {
    for (const bad of ['visit www.example.com', 'http://x.y', 'mail me a@b', 'call 98765 43210', '+91 9876543210', 'whatsapp me', 'my insta is cool', 'Telegram group', 'pay on GPay', 'UPI me', 'see example.com', 'chat on snapchat']) assert.equal(looksLikeContact(bad), true, bad);
    for (const ok of ['Cricket talk with Rahul', 'Morning chai and Hindi songs', 'Learn English together', 'Q&A: 5 tips for exams', 'Yoga at 6 am', 'Top 10 movies of 2024']) assert.equal(looksLikeContact(ok), false, ok);
});

test('cleanTitle accepts 3 to 60 plain characters and refuses the rest with a clear message', () => {
    assert.equal(cleanTitle('  Chai  pe   charcha '), 'Chai pe charcha');
    assert.equal(cleanTitle('x'.repeat(100)).length, 60);
    for (const bad of ['', '  ', 'ab', null, undefined, 5, 'call me 9876543210', 'find me on instagram']) assert.throws(() => cleanTitle(bad), e => e.code === 'invalid-argument', String(bad));
});

test('a private session holds the host plus 1 up to cap - 1 guests', () => {
    assert.equal(maxGuestsFor('voice'), CAPS.voice - 1);
    assert.equal(maxGuestsFor('video'), CAPS.video - 1);
    assert.equal(maxGuestsFor('nope'), 0);
    assert.equal(maxGuestsFor('__proto__'), 0);
});

test('sessionIsLive: running only while not ended, inside its time limit, and the host has been heard from lately', () => {
    const now = 1_700_000_000_000;
    const g = { status: 'live', created: now - 60000, endsAt: now + 3600000 };
    assert.equal(sessionIsLive(g, now - 10000, now), true);
    assert.equal(sessionIsLive(g, undefined, now), true, 'just created, the host has not sent a heartbeat yet');
    assert.equal(sessionIsLive({ ...g, status: 'ended' }, now, now), false);
    assert.equal(sessionIsLive({ ...g, endsAt: now - 1 }, now, now), false);
    assert.equal(sessionIsLive({ ...g, created: now - 3600000 }, now - 4 * 60000, now), false, 'host silent for over 3 minutes');
    assert.equal(sessionIsLive({ ...g, created: now - 3600000 }, now - 2 * 60000, now), true);
    for (const bad of [null, undefined, {}, 'x']) assert.equal(sessionIsLive(bad, now, now), false);
});
