// Host verification, payout limits (functions/payoutrules.js) and buyer limits (functions/buyerrules.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_DAYS, NEW_HOST_HOLD_DAYS, MONTHLY_PAYOUT_CAP_PAISE, holdDaysFor, capLeftPaise, cleanKyc, kycKeys, payTo, kycForHost } from '/home/user/ohmygoal/functions/payoutrules.js';
import { NEW_ACCOUNT_DAILY_PAISE, DAILY_PAISE, spentLastDay, dailyLimitPaise } from '/home/user/ohmygoal/functions/buyerrules.js';

const DAY = 86400000, now = Date.UTC(2026, 10, 7, 6);

test('new hosts are held 14 days, established or trusted ones 7', () => {
    assert.equal(holdDaysFor({ firstLiveAt: now - 5 * DAY }, now), NEW_HOST_HOLD_DAYS);
    assert.equal(holdDaysFor({}, now), NEW_HOST_HOLD_DAYS);
    assert.equal(holdDaysFor({ firstLiveAt: now - 40 * DAY }, now), HOLD_DAYS);
    assert.equal(holdDaysFor({ firstLiveAt: now - 1 * DAY, trusted: true }, now), HOLD_DAYS);
});

test('payouts are capped at ₹10,000 per 30 days unless the host is trusted', () => {
    assert.equal(MONTHLY_PAYOUT_CAP_PAISE, 1000000);
    const pays = [{ status: 'paid', paise: 300000, at: now - 3 * DAY }, { status: 'requested', paise: 200000, at: now - DAY }, { status: 'rejected', paise: 900000, at: now - DAY }, { status: 'paid', paise: 900000, at: now - 40 * DAY }];
    assert.equal(capLeftPaise({}, pays, now), 500000);
    assert.equal(capLeftPaise({ trusted: true }, pays, now), Infinity);
    assert.equal(capLeftPaise({}, [{ status: 'paid', paise: 2000000, at: now }], now), 0);
});

test('payout details: PAN, UPI and bank formats are checked and normalised', () => {
    const u = cleanKyc({ name: '  Mayank   Gupta ', pan: 'abcde1234f', method: 'upi', upi: ' Mayank@OKAXIS ' });
    assert.deepEqual(u, { ok: true, kyc: { name: 'Mayank Gupta', pan: 'ABCDE1234F', method: 'upi', upi: 'mayank@okaxis' } });
    const b = cleanKyc({ name: 'Riya Sharma', pan: 'ABCDE1234F', method: 'bank', account: '1234 5678 9012', ifsc: 'hdfc0001234' });
    assert.deepEqual(b.kyc, { name: 'Riya Sharma', pan: 'ABCDE1234F', method: 'bank', account: '123456789012', ifsc: 'HDFC0001234' });
    for (const bad of [{ name: 'R', pan: 'ABCDE1234F', method: 'upi', upi: 'a@b' }, { name: 'Riya', pan: '12345ABCDE', method: 'upi', upi: 'riya@okaxis' },
        { name: 'Riya', pan: 'ABCDE1234F', method: 'upi', upi: 'not-a-upi' }, { name: 'Riya', pan: 'ABCDE1234F', method: 'bank', account: '12', ifsc: 'HDFC0001234' },
        { name: 'Riya', pan: 'ABCDE1234F', method: 'bank', account: '123456789', ifsc: 'HDFC1001234' }, { name: 'Riya', pan: 'ABCDE1234F', method: 'cash' }, { name: '<b>x</b>', pan: 'ABCDE1234F', method: 'upi', upi: 'r@ok' }]) {
        assert.equal(cleanKyc(bad).ok, false, JSON.stringify(bad));
    }
});

test('each PAN and payout account gives one key; keys hide the details; what the host sees is masked', () => {
    const k = cleanKyc({ name: 'Riya Sharma', pan: 'ABCDE1234F', method: 'upi', upi: 'riya@okaxis' }).kyc;
    const keys = kycKeys(k);
    assert.deepEqual(keys.map(x => x.kind), ['PAN', 'UPI ID']);
    assert.ok(keys.every(x => /^[0-9a-f]{40}$/.test(x.key) && !x.key.includes('ABCDE')));
    assert.notEqual(kycKeys({ ...k, upi: 'other@okaxis' })[1].key, keys[1].key);
    assert.equal(payTo(k), 'UPI riya@okaxis');
    assert.equal(payTo({ method: 'bank', account: '123456789012', ifsc: 'HDFC0001234' }), 'Bank ••••9012 (HDFC0001234)');
    assert.deepEqual(kycForHost({ ...k, status: 'verified' }), { name: 'Riya Sharma', pan: 'AB•••••34F', method: 'upi', payTo: 'UPI riya@okaxis', status: 'verified', note: '' });
    assert.equal(kycForHost(null), null);
});

test('buyers: ₹1,000 a day for the first 7 days, ₹10,000 after; paid and just-opened orders count', () => {
    assert.equal(dailyLimitPaise(now - 2 * DAY, now), NEW_ACCOUNT_DAILY_PAISE);
    assert.equal(dailyLimitPaise(now - 30 * DAY, now), DAILY_PAISE);
    const orders = [
        { status: 'paid', amount: 34900, paidAt: now - 3600000 }, { status: 'paid', amount: 14900, paidAt: now - 2 * DAY },
        { status: 'created', amount: 4900, createdAt: now - 60000 }, { status: 'created', amount: 34900, createdAt: now - 3600000 },
    ];
    assert.equal(spentLastDay(orders, now), 34900 + 4900);
    assert.equal(spentLastDay([], now), 0);
});
