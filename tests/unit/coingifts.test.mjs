// Gifting coins: the 70/30 split, and which coins count as "bought" (the only ones that can be gifted) through every kind of spending.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COIN_GIFT_MIN, COIN_GIFT_MAX, COIN_GIFT_DAILY_CAP, COIN_GIFT_PER_HOUR, COIN_GIFT_PLATFORM_PCT, coinGiftSplit, afterSpend } from '/home/user/ohmygoal/functions/gifts.js';

test('the agreed numbers: 30% to the platform, 10 to 500 coins a gift, 1,000 a day', () => {
    assert.equal(COIN_GIFT_PLATFORM_PCT, 30);
    assert.equal(COIN_GIFT_MIN, 10);
    assert.equal(COIN_GIFT_MAX, 500);
    assert.equal(COIN_GIFT_DAILY_CAP, 1000);
    assert.ok(COIN_GIFT_PER_HOUR >= 1 && COIN_GIFT_MAX <= COIN_GIFT_DAILY_CAP);
});

test('coinGiftSplit: the recipient gets 70% rounded down, the platform the rest, never a coin lost or made', () => {
    assert.deepEqual(coinGiftSplit(100), { recipient: 70, platform: 30 });
    assert.deepEqual(coinGiftSplit(10), { recipient: 7, platform: 3 });
    assert.deepEqual(coinGiftSplit(500), { recipient: 350, platform: 150 });
    assert.deepEqual(coinGiftSplit(33), { recipient: 23, platform: 10 });
    for (let n = 0; n <= 1000; n++) {
        const s = coinGiftSplit(n);
        assert.equal(s.recipient + s.platform, n, String(n));
        assert.ok(s.recipient >= 0 && s.platform >= 0);
        assert.ok(s.platform >= (n * 30) / 100, `${n}: the platform never gets less than 30%`);
    }
    for (const bad of [-5, NaN, 'x', null, undefined, 2.5, {}]) assert.deepEqual(coinGiftSplit(bad), { recipient: 0, platform: 0 }, String(bad));
});

test('afterSpend: free coins are used first, so bought coins stay giftable as long as possible', () => {
    assert.deepEqual(afterSpend({ coins: 100, bought: 100 }, 30), { coins: 70, bought: 70 });        // all bought: spending reduces both
    assert.deepEqual(afterSpend({ coins: 100, bought: 40 }, 30), { coins: 70, bought: 40 });         // 60 free: the spend comes from the free coins
    assert.deepEqual(afterSpend({ coins: 100, bought: 40 }, 60), { coins: 40, bought: 40 });
    assert.deepEqual(afterSpend({ coins: 100, bought: 40 }, 80), { coins: 20, bought: 20 });         // free coins used up, bought coins start to go
    assert.deepEqual(afterSpend({ coins: 100, bought: 40 }, 100), { coins: 0, bought: 0 });
    assert.deepEqual(afterSpend({ coins: 50 }, 10), { coins: 40, bought: 0 });                       // old wallets have no "bought": nothing giftable
});

test('afterSpend never lets bought exceed coins, and copes with nonsense', () => {
    assert.deepEqual(afterSpend({ coins: 10, bought: 999 }, 4), { coins: 6, bought: 6 });
    for (const w of [null, undefined, {}, { coins: 'x' }, { coins: -3, bought: 5 }, { coins: NaN, bought: NaN }]) {
        const r = afterSpend(w, 5);
        assert.ok(Number.isInteger(r.bought) && r.bought >= 0, JSON.stringify(w));
        assert.ok(r.bought <= Math.max(0, r.coins), JSON.stringify(w));
    }
    for (let coins = 0; coins <= 60; coins += 7) for (let bought = 0; bought <= coins; bought += 5) for (let n = 0; n <= coins; n += 3) {
        const r = afterSpend({ coins, bought }, n);
        assert.equal(r.coins, coins - n);
        assert.ok(r.bought <= bought && r.bought <= r.coins && r.bought >= Math.max(0, bought - n));
    }
});

test('every place that spends coins keeps the bought count right (none writes a bare coins value)', () => {
    for (const f of ['wallet.js', 'live.js']) {
        const src = fs.readFileSync(`/home/user/ohmygoal/functions/${f}`, 'utf8');
        for (const m of src.matchAll(/t\.set\(walletRef\(uid\),[^\n]*/g)) {
            assert.ok(/afterSpend|bought/.test(m[0]) || /dailyDay/.test(m[0]), `${f}: ${m[0].slice(0, 90)}`);
        }
    }
});
