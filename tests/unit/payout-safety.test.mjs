// The 7-day hold on host earnings (functions/live.js) and taking back what a refunded payment bought (functions/reversals.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_DAYS, heldCoins, recentAfter } from '/home/user/ohmygoal/functions/live.js';
import { MAX_HOLD_DAYS } from '/home/user/ohmygoal/functions/payoutrules.js';
import { coinsDue, walletAfterTakeBack } from '/home/user/ohmygoal/functions/reversals.js';

const DAY = 86400000;
const now = Date.UTC(2026, 10, 7, 6, 0);            // 7 Nov 2026, 11:30 in India
const ist = ms => new Date(ms + 330 * 60000).toISOString().slice(0, 10);

test('earnings are held for 7 Indian days, today included', () => {
    assert.equal(HOLD_DAYS, 7);
    const recent = { [ist(now)]: 100, [ist(now - 6 * DAY)]: 40, [ist(now - 7 * DAY)]: 1000, '2020-01-01': 5 };
    assert.equal(heldCoins(recent, 5000, now), 140);
    assert.equal(heldCoins(recent, 90, now), 90, 'never more than the balance');
    for (const bad of [undefined, null, 'x', { [ist(now)]: -5 }, { [ist(now)]: 'lots' }]) assert.equal(heldCoins(bad, 500, now), 0);
});

test('recentAfter adds to today and drops days older than the longest hold (14 days for new hosts)', () => {
    assert.equal(MAX_HOLD_DAYS, 14);
    assert.equal(heldCoins({ [ist(now - 10 * DAY)]: 9 }, 100, now, 14), 9);
    const r = recentAfter({ [ist(now - 20 * DAY)]: 7, [ist(now - 2 * DAY)]: 3, [ist(now)]: 4 }, 10, now);
    assert.deepEqual(r, { [ist(now - 2 * DAY)]: 3, [ist(now)]: 14 });
    assert.deepEqual(recentAfter(undefined, 0, now), {});
    assert.ok(Object.keys(recentAfter(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [ist(now - i * DAY), 1])), 1, now)).length <= MAX_HOLD_DAYS, 'the map stays small');
});

test('coinsDue: a refund takes back coins in proportion, rounded up, never more than the pack', () => {
    assert.equal(coinsDue(200, 14900, 14900), 200);
    assert.equal(coinsDue(200, 14900, 7450), 100);
    assert.equal(coinsDue(60, 4900, 1), 1);
    assert.equal(coinsDue(60, 4900, 999999), 60);
    for (const bad of [0, -1, NaN, undefined, 'x']) { assert.equal(coinsDue(60, 4900, bad), 0); assert.equal(coinsDue(bad, 4900, 4900), 0); }
});

test('walletAfterTakeBack: takes what is there, bought coins first, never below zero', () => {
    assert.deepEqual(walletAfterTakeBack({ coins: 500, bought: 500 }, 500), { taken: 500, coins: 0, bought: 0 });
    assert.deepEqual(walletAfterTakeBack({ coins: 50, bought: 50 }, 500), { taken: 50, coins: 0, bought: 0 });
    assert.deepEqual(walletAfterTakeBack({ coins: 300, bought: 100 }, 60), { taken: 60, coins: 240, bought: 40 });
    assert.deepEqual(walletAfterTakeBack({ coins: 300, bought: 10 }, 60), { taken: 60, coins: 240, bought: 0 });
    assert.deepEqual(walletAfterTakeBack(undefined, 60), { taken: 0, coins: 0, bought: 0 });
});
