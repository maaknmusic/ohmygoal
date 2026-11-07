// The transaction ledger (functions/ledger.js): what an entry may hold, and the step-by-step check of a person's history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, entry, firstBreak } from '/home/user/ohmygoal/functions/ledger.js';

test('an entry keeps known fields only, as integers or short text, and refuses unknown types', () => {
    const e = entry({ type: 'live_gift', uid: 'u1', coins: -50, balance: 450, platform: 15, other: 'h1', ref: 'sid', note: 'fireworks', evil: 'x', at: 5 });
    assert.deepEqual(e, { at: 5, type: 'live_gift', uid: 'u1', by: 'user', coins: -50, balance: 450, platform: 15, other: 'h1', ref: 'sid', note: 'fireworks' });
    assert.equal(entry({ type: 'tip', uid: 'u', paise: 12.5, note: 'n'.repeat(500) }, 9).paise, 0);
    assert.equal(entry({ type: 'tip', uid: 'u', note: 'n'.repeat(500) }, 9).note.length, 200);
    assert.equal(entry({ type: 'tip', uid: 'u' }, 9).at, 9);
    assert.throws(() => entry({ type: 'free_money', uid: 'u' }));
    assert.ok(TYPES.includes('refund') && TYPES.includes('payout_paid') && TYPES.includes('admin_coins'));
});

test('firstBreak: a history adds up when each step starts where the previous one ended', () => {
    const ok = [
        { at: 1, type: 'purchase_coins', coins: 500, balance: 500 },
        { at: 2, type: 'live_gift', coins: -50, balance: 450 },
        { at: 3, type: 'host_earning', earned: 35, earnedBalance: 35 },
        { at: 4, type: 'payout_paid', paise: 2625 },                         // no balance fields: skipped
        { at: 5, type: 'daily_bonus', coins: 2, balance: 452 },
        { at: 6, type: 'payout_rejected', earned: 35, earnedBalance: 70 },
    ];
    assert.equal(firstBreak(ok), null);
    assert.equal(firstBreak([]), null);
    assert.equal(firstBreak([{ at: 1, type: 'live_gift', coins: -5, balance: 95 }]), null, 'history from before the ledger: the first entry is the start');
    const broken = [...ok, { at: 7, type: 'chat_gift', coins: -5, balance: 400 }];   // 452 - 5 should be 447
    assert.deepEqual(firstBreak(broken), { at: 7, type: 'chat_gift', kind: 'coins', expected: 452, found: 405 });
    assert.equal(firstBreak([{ at: 1, type: 'host_earning', earned: 3, earnedBalance: 3 }, { at: 2, type: 'host_earning', earned: 3, earnedBalance: 9 }]).kind, 'earned');
});
