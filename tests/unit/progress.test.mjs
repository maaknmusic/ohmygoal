// Streaks and levels: a chat counts after a minute, days are Indian days, the streak survives one day, storage is distrusted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, MIN_CHAT_SECONDS, MAX_XP_PER_DAY, dayKey, emptyProgress, sanitizeProgress, levelFor, streakNow, recordChat, progressLine } from '/home/user/ohmygoal/js/progress.js';

const ist = (y, mo, d, h = 12, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const D = (d, h) => ist(2026, 10, d, h);

test('days roll over at midnight in India', () => {
    assert.equal(dayKey(ist(2026, 10, 21, 0, 0)), '2026-10-21');
    assert.equal(dayKey(ist(2026, 10, 21, 23, 59)), '2026-10-21');
    assert.equal(dayKey(ist(2026, 10, 22, 0, 0)), '2026-10-22');
});

test('a chat shorter than a minute counts for nothing', () => {
    const r = recordChat(emptyProgress(), MIN_CHAT_SECONDS - 1, D(21, 12));
    assert.deepEqual(r.progress, emptyProgress());
    assert.deepEqual(r.events, []);
    assert.equal(r.gained, 0);
    for (const bad of [NaN, -5, undefined, null, 'x']) assert.equal(recordChat(emptyProgress(), bad, D(21, 12)).gained, 0, String(bad));
});

test('the first real chat starts a streak and earns points', () => {
    const r = recordChat(emptyProgress(), 90, D(21, 12));
    assert.equal(r.progress.streak, 1);
    assert.equal(r.progress.last, '2026-10-21');
    assert.equal(r.progress.chats, 1);
    assert.equal(r.progress.minutes, 1);
    assert.equal(r.gained, 11);                      // 10 + one minute
    assert.deepEqual(r.events, [{ type: 'streak', value: 1 }]);
});

test('more chats the same day add points but not streak days', () => {
    let p = recordChat(emptyProgress(), 120, D(21, 10)).progress;
    const r = recordChat(p, 120, D(21, 20));
    assert.equal(r.progress.streak, 1);
    assert.deepEqual(r.events.filter(e => e.type === 'streak'), []);
    assert.equal(r.progress.xp, 24);
});

test('consecutive days grow the streak; a gap of a whole day resets it to 1; best is remembered', () => {
    let p = emptyProgress();
    for (const d of [21, 22, 23]) p = recordChat(p, 100, D(d, 12)).progress;
    assert.equal(p.streak, 3);
    p = recordChat(p, 100, D(25, 12)).progress;           // skipped the 24th
    assert.equal(p.streak, 1);
    assert.equal(p.best, 3);
});

test('the streak survives until the end of the next day, then it is gone (without writing anything)', () => {
    const p = recordChat(recordChat(emptyProgress(), 100, D(21, 12)).progress, 100, D(22, 12)).progress;
    assert.deepEqual(streakNow(p, D(22, 20)), { streak: 2, doneToday: true, atRisk: false });
    assert.deepEqual(streakNow(p, D(23, 8)), { streak: 2, doneToday: false, atRisk: true });
    assert.deepEqual(streakNow(p, D(24, 8)), { streak: 0, doneToday: false, atRisk: false });
    assert.deepEqual(streakNow(emptyProgress(), D(21, 1)), { streak: 0, doneToday: false, atRisk: false });
});

test('month and year boundaries do not break the day maths', () => {
    let p = recordChat(emptyProgress(), 100, ist(2026, 10, 31, 12)).progress;
    p = recordChat(p, 100, ist(2026, 11, 1, 12)).progress;
    assert.equal(p.streak, 2);
    p = recordChat(emptyProgress(), 100, ist(2026, 12, 31, 12)).progress;
    p = recordChat(p, 100, ist(2027, 1, 1, 12)).progress;
    assert.equal(p.streak, 2);
});

test('points per chat are capped, and so is a day', () => {
    assert.equal(recordChat(emptyProgress(), 3600 * 5, D(21, 12)).gained, 30);
    let p = emptyProgress(), total = 0;
    for (let i = 0; i < 40; i++) { const r = recordChat(p, 3600, D(21, 12)); p = r.progress; total += r.gained; }
    assert.equal(total, MAX_XP_PER_DAY);
    assert.equal(p.chats, 40);                            // they still count as chats
    p = recordChat(p, 3600, D(22, 12)).progress;          // a new day starts fresh
    assert.equal(p.today.xp, 30);
});

test('levels: thresholds, progress to the next, and a level-up event', () => {
    assert.equal(levelFor(0).level.id, 'newcomer');
    assert.equal(levelFor(59).level.id, 'newcomer');
    assert.equal(levelFor(60).level.id, 'regular');
    assert.equal(levelFor(60).fraction, 0);
    assert.equal(levelFor(120).fraction, 0.5);
    assert.equal(levelFor(99999).level.id, 'legend');
    assert.equal(levelFor(99999).next, null);
    assert.equal(levelFor(99999).fraction, 1);
    assert.equal(levelFor(-5).level.id, 'newcomer');
    assert.equal(levelFor(NaN).level.id, 'newcomer');
    for (let i = 1; i < LEVELS.length; i++) assert.ok(LEVELS[i].xp > LEVELS[i - 1].xp);
    const near = { ...emptyProgress(), xp: 55 };
    const r = recordChat(near, 100, D(21, 12));
    assert.deepEqual(r.events.find(e => e.type === 'level').value.id, 'regular');
});

test('stored data is distrusted', () => {
    for (const bad of [null, undefined, 5, 'x', [], [1, 2]]) assert.deepEqual(sanitizeProgress(bad), emptyProgress());
    const s = sanitizeProgress({ xp: 'lots', chats: -3, minutes: Infinity, streak: 1e9, best: NaN, last: 'yesterday', today: 'x', extra: '<script>' });
    assert.deepEqual(s, { ...emptyProgress(), xp: 0 });
    assert.equal(sanitizeProgress({ xp: 1e12, last: '2026-10-21', streak: 1e9 }).xp, 1000000);
    assert.equal(sanitizeProgress({ last: '2026-10-21', streak: 1e9 }).streak, 3660);
    assert.ok(!('extra' in sanitizeProgress({ extra: 1 })));
    assert.equal(sanitizeProgress({ streak: 7, last: '' }).streak, 0);   // a streak with no last day is nonsense
});

test('the start-screen line', () => {
    assert.match(progressLine(emptyProgress(), D(21, 12)), /start a streak/);
    const one = recordChat(emptyProgress(), 100, D(21, 12)).progress;
    assert.match(progressLine(one, D(21, 20)), /Streak started/);
    const two = recordChat(one, 100, D(22, 12)).progress;
    assert.match(progressLine(two, D(22, 20)), /2-day streak\. See you tomorrow/);
    assert.match(progressLine(two, D(23, 9)), /Chat for a minute today to keep it going/);
    assert.match(progressLine(two, D(25, 9)), /start a streak/);
});
