// "Tonight's rooms": themed chats. Everyone in a room has picked the same theme, so there is something to talk about from the first hello.
// The schedule says when each theme is at its busiest (in Indian Standard Time). Until the site is busy, every theme can be joined at any
// time (alwaysOpen), and the schedule only decides what is "featured" tonight.
//
// Pure functions: the app passes in the clock.

const IST_MS = 330 * 60000;
const DAY_MS = 86400000;
const HOUR_MS = 3600000;

/** days: 0 = Sunday ... 6 = Saturday (IST). from/to: hours on the clock; `to` may run past midnight (27 = 3 am the next day). */
export const THEMES = Object.freeze([
    Object.freeze({ id: 'study', name: 'Study hour', blurb: 'Quiet company while you work. Cameras optional.', windows: [{ days: [1, 2, 3, 4, 5], from: 20, to: 22 }, { days: [0], from: 19, to: 21 }] }),
    Object.freeze({ id: 'cricket', name: 'Cricket night', blurb: 'Match talk, hot takes and fantasy teams.', windows: [{ days: [3, 5, 6, 0], from: 19, to: 23 }] }),
    Object.freeze({ id: 'music', name: 'Music jam', blurb: 'Swap songs, artists and playlists.', windows: [{ days: [2, 4], from: 20, to: 23 }, { days: [6], from: 17, to: 20 }] }),
    Object.freeze({ id: 'latenight', name: 'Late-night talks', blurb: 'Deep chats for night owls.', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 23, to: 27 }] }),
    Object.freeze({ id: 'gaming', name: 'Game night', blurb: 'Find a partner for the games built into chat, or talk about yours.', windows: [{ days: [5, 6], from: 21, to: 25 }] }),
    Object.freeze({ id: 'chill', name: 'Sunday chill', blurb: 'No agenda, good vibes.', windows: [{ days: [6, 0], from: 16, to: 19 }] }),
    // Not a schedule but a way of matching: you speak one language and practise another, and meet someone who does the opposite.
    Object.freeze({ id: 'langx', name: 'Language exchange', blurb: 'Practise a language with someone who speaks it, while you help with theirs.' }),
]);

export const OPEN = Object.freeze({ id: '', name: 'Open chat', blurb: 'Anyone, about anything.' });
const BY_ID = new Map(THEMES.map(t => [t.id, t]));

/** A theme id from our list, or '' (open chat). Anything else (a typo, a hostile value) is open chat. */
export const themeId = v => (typeof v === 'string' && BY_ID.has(v) ? v : '');
export const themeById = id => BY_ID.get(id) || OPEN;
export const THEME_IDS = Object.freeze(THEMES.map(t => t.id));

/** IST clock parts for a timestamp. */
function ist(now) {
    const d = new Date(now + IST_MS);
    return { day: d.getUTCDay(), hour: d.getUTCHours() + d.getUTCMinutes() / 60, midnight: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_MS };
}

/** Whether the theme is in one of its busy windows at `now`. A window may run past midnight (to > 24): it belongs to the day it started on. */
export function isBusy(theme, now) {
    if (!theme?.windows) return false;
    const { day, hour } = ist(now);
    const weekHour = day * 24 + hour;
    return theme.windows.some(w => w.days.some(d => {
        const start = d * 24 + w.from, end = d * 24 + w.to;
        return (weekHour >= start && weekHour < end) || (weekHour + 168 >= start && weekHour + 168 < end); // the second test is Saturday night running into Sunday
    }));
}

/** The next time the theme becomes busy after `now` (ms), or null if it never does. */
export function nextBusy(theme, now) {
    if (!theme?.windows) return null;
    const { midnight } = ist(now);
    let best = null;
    for (let add = 0; add <= 8; add++) {
        const dayStart = midnight + add * DAY_MS;
        const weekday = new Date(dayStart + IST_MS).getUTCDay();
        for (const w of theme.windows) {
            if (!w.days.includes(weekday)) continue;
            const start = dayStart + w.from * HOUR_MS;
            if (start > now && (best === null || start < best)) best = start;
        }
    }
    return best;
}

/** Themes in their busy window right now, in list order. */
export const busyNow = now => THEMES.filter(t => isBusy(t, now));

/** The one to show first: a busy theme if there is one, else the one opening soonest. */
export function featured(now) {
    const busy = busyNow(now);
    if (busy.length) return { theme: busy[0], busy: true, at: now };
    let best = null;
    for (const t of THEMES) { const n = nextBusy(t, now); if (n !== null && (best === null || n < best.at)) best = { theme: t, busy: false, at: n }; }
    return best;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hour12 = h => { const x = h % 24; return `${x % 12 || 12} ${x < 12 ? 'am' : 'pm'}`; };
/** "Mon–Fri 8–10 pm IST" style text for the busy windows. */
export function scheduleText(theme) {
    if (!theme?.windows) return 'Any time';
    return theme.windows.map(w => {
        const days = w.days.length === 7 ? 'Every day' : w.days.slice().sort((a, b) => a - b).map(d => DAY_NAMES[d]).join(', ');
        return `${days} ${hour12(w.from)}–${hour12(w.to)} IST`;
    }).join(' · ');
}
