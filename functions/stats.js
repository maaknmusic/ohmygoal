// =====================================================================
// Daily counters for the admin dashboard. One small document per Indian calendar day in the private tree (stats/YYYY-MM-DD),
// bumped from the places things happen. Nothing here can fail a user's request: every call swallows its own errors.
//   dau            distinct accounts that got an access pass that day (one marker document per account per day)
//   chats          one-to-one chats started (a room was created), chats_video / chats_voice / chats_text, friendCalls
//   groupJoins     group room joins, groupJoins_voice / groupJoins_video
//   likes, gifts, coinsSpent
// =====================================================================
import { logger } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue } from 'firebase-admin/firestore';
import { privateDoc, publicDoc, publicCol } from './common.js';

const IST_MS = 330 * 60000;
export const istDay = ms => new Date(ms + IST_MS).toISOString().slice(0, 10);
export const statsRef = day => privateDoc(`stats/${day}`);

const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;

// One document can only take about one write a second. The counters bumped for every chat, join and visitor (HOT) are spread over
// SHARDS small documents under the day (stats/YYYY-MM-DD/shards/N), which readStats adds back together. The rest stay on the day.
export const SHARDS = 20;
export const HOT = /^(chats|friendCalls|dau|groupJoins)/;
const shardsOf = day => statsRef(day).collection('shards');

/** Adds n to a counter for today. Never throws. */
export async function bump(field, n = 1, now = Date.now()) {
    if (!FIELD.test(field) || !Number.isFinite(n)) return;
    const day = istDay(now);
    const ref = HOT.test(field) ? shardsOf(day).doc(String(Math.floor(Math.random() * SHARDS))) : statsRef(day);
    try { await ref.set({ [field]: FieldValue.increment(n) }, { merge: true }); }
    catch (e) { logger.warn('stat failed', { field, code: e?.code }); }
}

/** Adds counters together: { a: 1 } + { a: 2, b: 1 } = { a: 3, b: 1 }. Non-numbers are kept from the first that has them. */
export function addCounters(...docs) {
    const out = {};
    for (const d of docs) for (const [k, v] of Object.entries(d || {})) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = (typeof out[k] === 'number' ? out[k] : 0) + v;
        else if (!(k in out)) out[k] = v;
    }
    return out;
}

/** The counters of each day in `days` (YYYY-MM-DD), the day document and its shards added together, in the same order. */
export async function readStats(days) {
    return Promise.all(days.map(async day => {
        const [main, shards] = await Promise.all([statsRef(day).get(), shardsOf(day).get()]);
        return addCounters(main.data(), ...shards.docs.map(d => d.data()));
    }));
}

/** Counts this account as active today, once. */
export async function markActive(uid, now = Date.now()) {
    if (typeof uid !== 'string' || !uid) return;
    try {
        await privateDoc(`dau/${istDay(now)}_${uid}`).create({ at: now });
        await bump('dau', 1, now);
    } catch { /* already counted today (or a stat failure): nothing to do */ }
}

export const onRoomCreated = onDocumentCreated('artifacts/anon-connect/public/data/rooms/{roomId}', async event => {
    const d = event.data?.data();
    if (!d) return;
    if (d.friendship) return bump('friendCalls');
    await bump('chats');
    if (['video', 'voice', 'text'].includes(d.mode)) await bump(`chats_${d.mode}`);
});

// ---------------------------------------------------------------------
// "People online". Every open page refreshes its presence document (js/transport.js); online = refreshed within the window.
// Counting is done here once a minute and saved in counters/online, which pages read (one document read), instead of every page
// running its own count query every half minute (which with thousands online costs many reads per count).
// ---------------------------------------------------------------------
export const PRESENCE_WINDOW_MS = 75000;
export const onlineRef = () => publicDoc('counters/online');

/** Counts the people online now and saves the number. Returns it. */
export async function saveOnlineCount(now = Date.now()) {
    const count = (await publicCol('presence').where('ts', '>', now - PRESENCE_WINDOW_MS).count().get()).data().count;
    await onlineRef().set({ count, at: now });
    return count;
}

export const countOnline = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 60, maxInstances: 1, retryCount: 0 }, async () => {
    try { await saveOnlineCount(); } catch (e) { logger.warn('online count failed', { message: e?.message }); }
});
