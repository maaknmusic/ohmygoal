// The browser's copy of the live-session numbers matches the server's, and its text helpers behave.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '/home/user/ohmygoal/js/live.js';
import * as S from '/home/user/ohmygoal/functions/live.js';
import { GIFTS as CLIENT_GIFTS } from '/home/user/ohmygoal/js/stickers.js';
import { GIFTS as SERVER_GIFTS } from '/home/user/ohmygoal/functions/gifts.js';

test('fees, share and limits are the same in the browser and on the server', () => {
    assert.equal(C.LIVE_START_FEE, S.LIVE_START_FEE);
    assert.equal(C.PRIVATE_FEE, S.PRIVATE_FEE);
    assert.equal(C.HOST_SHARE_PCT, S.HOST_SHARE_PCT);
    assert.equal(C.MIN_PAYOUT_COINS, S.MIN_PAYOUT_COINS);
    assert.equal(C.MAX_TITLE, 60);
    assert.deepEqual(CLIENT_GIFTS.map(g => [g.id, g.coins]), Object.entries(SERVER_GIFTS));
});

test('hostShare is the same rounding as splitCoins for every price', () => {
    for (let n = 0; n <= 1000; n++) assert.equal(C.hostShare(n), S.splitCoins(n).host, String(n));
    assert.equal(C.hostShare(-4), 0);
    assert.equal(C.hostShare('x'), 0);
});

test('the browser and the server agree on what counts as contact details', () => {
    const samples = ['visit www.example.com', 'http://x.y', 'mail me a@b', 'call 98765 43210', '+91 9876543210', 'whatsapp me', 'my insta is cool', 'Telegram group', 'pay on GPay', 'see example.com', 'Cricket talk with Rahul', 'Morning chai and Hindi songs', 'Learn English together', 'Q&A: 5 tips for exams', 'Yoga at 6 am', 'Top 10 movies of 2024', 'Hindi songs night'];
    for (const t of samples) assert.equal(C.looksLikeContact(t), S.looksLikeContact(t), t);
});

test('titleProblem explains what is wrong and is empty for a good title', () => {
    assert.equal(C.titleProblem('Chai pe charcha'), '');
    assert.match(C.titleProblem('ab'), /at least 3/);
    assert.match(C.titleProblem('  '), /at least 3/);
    assert.match(C.titleProblem('call 9876543210 now'), /phone numbers/);
    assert.equal(C.titleProblem(undefined).length > 0, true);
});

test('rupees and seats read well', () => {
    assert.equal(C.rupees(60000), '₹600');
    assert.equal(C.rupees(12345678), '₹1,23,457');
    assert.equal(C.rupees('x'), '₹0');
    assert.equal(C.seatsText({ mode: 'video', kind: 'public', cap: 4, count: 2 }), 'Video · 2 of 4 in');
    assert.equal(C.seatsText({ mode: 'voice', kind: 'private', cap: 8, maxGuests: 2, count: 1 }), 'Voice · 1 of 3 in');
    assert.equal(C.seatsText({ mode: 'voice', kind: 'private', cap: 8, maxGuests: 2, count: 9 }), 'Voice · 3 of 3 in');
});
