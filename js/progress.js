// Streaks and levels. A small record kept on this device (it is cosmetic: nothing in the app depends on it for safety or access).
// A chat counts once it has lasted a minute, so skipping through people doesn't earn anything.
// Days are counted in Indian Standard Time so "today" means the same for everyone the site is built for.
//
// Pure functions: the app passes in the clock and stores the result.

export const LEVELS = Object.freeze([
    Object.freeze({ id: 'newcomer', name: 'Newcomer', xp: 0 }),
    Object.freeze({ id: 'regular', name: 'Regular', xp: 60 }),
    Object.freeze({ id: 'social', name: 'Social', xp: 180 }),
    Object.freeze({ id: 'connector', name: 'Connector', xp: 400 }),
    Object.freeze({ id: 'star', name: 'Star', xp: 800 }),
    Object.freeze({ id: 'legend', name: 'Legend', xp: 1600 }),
]);

export const MIN_CHAT_SECONDS = 60;
export const XP_PER_CHAT = 10;        // plus one per minute, up to MAX_MINUTE_XP
export const MAX_MINUTE_XP = 20;
export const MAX_XP_PER_DAY = 150;    // a day's worth: more chats still count for the streak, not for points
const IST_MS = 330 * 60000;
const DAY_MS = 86400000;
const MAX_XP = 1000000;

/** The calendar day in India, 'YYYY-MM-DD'. */
export const dayKey = ms => new Date(ms + IST_MS).toISOString().slice(0, 10);
const prevDay = key => dayKey(Date.parse(key + 'T00:00:00Z') - DAY_MS + IST_MS);

export const emptyProgress = () => ({ v: 1, xp: 0, chats: 0, minutes: 0, streak: 0, best: 0, last: '', today: { day: '', xp: 0 } });

const int = (v, max) => (Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Anything read back from storage: unknown shapes and out-of-range numbers become a clean record. */
export function sanitizeProgress(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyProgress();
    const last = typeof raw.last === 'string' && DAY.test(raw.last) ? raw.last : '';
    const t = raw.today && typeof raw.today === 'object' ? raw.today : {};
    const streak = last ? int(raw.streak, 3660) : 0;
    return {
        v: 1,
        xp: int(raw.xp, MAX_XP),
        chats: int(raw.chats, 1e6),
        minutes: int(raw.minutes, 1e7),
        streak,
        best: Math.max(streak, int(raw.best, 3660)),
        last,
        today: { day: typeof t.day === 'string' && DAY.test(t.day) ? t.day : '', xp: int(t.xp, MAX_XP_PER_DAY) },
    };
}

export function levelFor(xp) {
    const v = int(xp, MAX_XP);
    let index = 0;
    for (let i = 0; i < LEVELS.length; i++) if (v >= LEVELS[i].xp) index = i;
    const level = LEVELS[index], next = LEVELS[index + 1] || null;
    return { index, level, next, toNext: next ? next.xp - v : 0, fraction: next ? (v - level.xp) / (next.xp - level.xp) : 1 };
}

/** The streak as it stands now: it survives until the end of the day after the last chat, then it is gone. */
export function streakNow(p, now) {
    const today = dayKey(now);
    if (!p.last) return { streak: 0, doneToday: false, atRisk: false };
    if (p.last === today) return { streak: p.streak, doneToday: true, atRisk: false };
    if (p.last === prevDay(today)) return { streak: p.streak, doneToday: false, atRisk: p.streak > 0 };
    return { streak: 0, doneToday: false, atRisk: false };
}

/**
 * A chat just ended after `seconds`. Returns the new record and what happened ('streak' with the new length, 'level' with the new level).
 * @returns {{progress: object, events: Array<{type: string, value: any}>, gained: number}}
 */
export function recordChat(prev, seconds, now) {
    const p = sanitizeProgress(prev);
    if (!(seconds >= MIN_CHAT_SECONDS)) return { progress: p, events: [], gained: 0 };
    const today = dayKey(now);
    const events = [];
    const before = levelFor(p.xp).index;

    const sameDay = p.today.day === today;
    const room = Math.max(0, MAX_XP_PER_DAY - (sameDay ? p.today.xp : 0));
    const gained = Math.min(room, XP_PER_CHAT + Math.min(MAX_MINUTE_XP, Math.floor(seconds / 60)));
    p.xp = Math.min(MAX_XP, p.xp + gained);
    p.today = { day: today, xp: (sameDay ? p.today.xp : 0) + gained };
    p.chats += 1;
    p.minutes = Math.min(1e7, p.minutes + Math.floor(seconds / 60));

    if (p.last !== today) {
        p.streak = p.last === prevDay(today) ? Math.min(3660, p.streak + 1) : 1;
        p.last = today;
        p.best = Math.max(p.best, p.streak);
        events.push({ type: 'streak', value: p.streak });
    }
    const after = levelFor(p.xp).index;
    if (after > before) events.push({ type: 'level', value: LEVELS[after] });
    return { progress: p, events, gained };
}

/** One line for the start screen. */
export function progressLine(p, now) {
    const s = streakNow(p, now);
    if (s.streak === 0) return 'Chat for a minute to start a streak.';
    if (s.doneToday) return s.streak === 1 ? 'Streak started. Come back tomorrow to keep it.' : `${s.streak}-day streak. See you tomorrow!`;
    return `${s.streak}-day streak. Chat for a minute today to keep it going.`;
}
