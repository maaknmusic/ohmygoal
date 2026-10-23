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
import { FieldValue } from 'firebase-admin/firestore';
import { privateDoc } from './common.js';

const IST_MS = 330 * 60000;
export const istDay = ms => new Date(ms + IST_MS).toISOString().slice(0, 10);
export const statsRef = day => privateDoc(`stats/${day}`);

const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;

/** Adds n to a counter for today. Never throws. */
export async function bump(field, n = 1, now = Date.now()) {
    if (!FIELD.test(field) || !Number.isFinite(n)) return;
    try { await statsRef(istDay(now)).set({ [field]: FieldValue.increment(n) }, { merge: true }); }
    catch (e) { logger.warn('stat failed', { field, code: e?.code }); }
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
