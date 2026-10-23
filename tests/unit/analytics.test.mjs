// Admin analytics: the Indian calendar days, which orders count as what, and the revenue sums.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lastDays, orderKind, summarizeOrders } from '/home/user/ohmygoal/functions/analytics.js';
import { istDay } from '/home/user/ohmygoal/functions/stats.js';

const NOON = Date.parse('2026-03-15T06:30:00Z'); // 12:00 in India
const DAY = 86400000;

test('lastDays: n Indian days, oldest first, ending today', () => {
    const d = lastDays(5, NOON);
    assert.equal(d.length, 5);
    assert.equal(d[4], istDay(NOON));
    assert.deepEqual(d, ['2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15']);
    assert.deepEqual(lastDays(1, NOON), ['2026-03-15']);
});

test('lastDays follows the Indian date, not UTC: 00:30 IST is still yesterday in UTC', () => {
    const justAfterMidnightIst = Date.parse('2026-03-14T19:00:00Z'); // 00:30 on the 15th in India
    assert.equal(lastDays(2, justAfterMidnightIst)[1], '2026-03-15');
});

test('orderKind: old orders without a kind are Premium; only known kinds are kept', () => {
    assert.equal(orderKind({}), 'premium');
    assert.equal(orderKind({ kind: 'coins' }), 'coins');
    assert.equal(orderKind({ kind: 'tip' }), 'tip');
    for (const bad of [null, undefined, { kind: 'gift' }, { kind: '__proto__' }, { kind: ['tip'] }]) assert.equal(orderKind(bad), 'premium');
});

test('summarizeOrders: only paid orders count, split by kind, day and window', () => {
    const days = lastDays(30, NOON);
    const orders = [
        { status: 'paid', amount: 9900, days: 30, paidAt: NOON - 1000 },                              // today, Premium
        { status: 'paid', amount: 4900, kind: 'coins', coins: 100, paidAt: NOON - 3 * DAY },          // 3 days ago
        { status: 'paid', amount: 2000, kind: 'tip', paidAt: NOON - 20 * DAY },                       // 20 days ago: in the month, not the week
        { status: 'paid', amount: 19900, days: 90, paidAt: NOON - 100 * DAY },                        // outside the chart and the month
        { status: 'created', amount: 99900, days: 365, createdAt: NOON },                             // never paid
        { status: 'paid', amount: 'x', paidAt: NOON },                                                // nonsense amount
    ];
    const r = summarizeOrders(orders, days, NOON);
    assert.deepEqual(r.total, { premium: 99 + 199, coins: 49, tip: 20 });
    assert.equal(r.window.today, 99);
    assert.equal(r.window.week, 99 + 49);
    assert.equal(r.window.month, 99 + 49 + 20);
    assert.equal(r.window.all, 99 + 49 + 20 + 199);
    assert.equal(r.perDay[days[29]].premium, 99);
    assert.equal(r.perDay[days[26]].coins, 49);
    assert.equal(r.perDay[days[9]].tip, 20);
    assert.deepEqual(r.byPlan, { '30 days': 1, '90 days': 1 });
    assert.equal(Object.keys(r.perDay).length, 30);
});

test('summarizeOrders with nothing is all zeros', () => {
    const r = summarizeOrders([], lastDays(7, NOON), NOON);
    assert.deepEqual(r.total, { premium: 0, coins: 0, tip: 0 });
    assert.deepEqual(r.window, { today: 0, week: 0, month: 0, all: 0 });
    assert.deepEqual(r.byPlan, {});
});
