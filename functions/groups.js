// =====================================================================
// Group rooms: joinGroup picks (or opens) a room with space for the topic and mode, and adds the caller as a member.
// The browser can't add itself to a room, so the size limit is real. After that the browser talks to Firestore directly:
//   groups/{gid}                 topic, mode, cap, created      (server-written)
//   groups/{gid}/members/{uid}   nick, avatar, ts               (server creates it; the member updates ts and deletes it to leave)
//   groups/{gid}/signals/{id}    WebRTC handshakes between two members (see firestore.rules)
// A member nobody has heard from for STALE_MS has left. Rooms that stay empty are removed when somebody next joins.
// =====================================================================
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, publicCol, publicDoc, privateDoc } from './common.js';
import { bump } from './stats.js';

export const TOPICS = Object.freeze(['cricket', 'music', 'bollywood', 'gaming', 'movies', 'travel', 'coding', 'study', 'anime', 'fitness', 'hindi', 'latenight']);
export const CAPS = Object.freeze({ voice: 8, video: 4 });
export const STALE_MS = 40000;
const JOIN_CAP = 20;                 // joins per account per hour
const HOUR = 3600000;
const CANDIDATES = 20;

/** A display name safe to store and show: printable, no control or bidi characters, 20 characters. */
export function cleanNick(v) {
    const s = typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) : '';
    return s || 'Guest';
}
/** The avatar shape the app uses ({ e, h } = emoji and hue), or null. Stored as given only if it has exactly that shape. */
export function cleanAvatar(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const e = typeof v.e === 'string' && v.e.length <= 8 && !/[<>&"'\u0000-\u001F]/.test(v.e) ? v.e : null;
    const h = Number.isFinite(v.h) ? Math.round(Math.min(360, Math.max(0, v.h))) : null;
    return e && h !== null ? { e, h } : null;
}

/** Which of the open rooms to join: the fullest one that still has space and doesn't already hold us (so rooms fill up instead of thinning out). */
export function pickGroup(rooms, uid, cap) {
    const open = rooms.filter(r => r.count < cap && !r.members.includes(uid));
    open.sort((a, b) => b.count - a.count || a.created - b.created);
    return open;
}

const membersCol = gid => publicCol(`groups/${gid}/members`);

async function freshMembers(gid, now) {
    const snap = await membersCol(gid).get();
    const fresh = [];
    const stale = [];
    for (const d of snap.docs) (typeof d.data().ts === 'number' && now - d.data().ts <= STALE_MS ? fresh : stale).push(d);
    // forget members who vanished without leaving
    for (const d of stale.slice(0, 10)) if (now - (d.data().ts || 0) > 3 * STALE_MS) d.ref.delete().catch(() => {});
    return fresh;
}

export const joinGroup = onCall(async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please reload the page.');
    const uid = request.auth.uid;
    const { topic, mode } = request.data || {};
    if (typeof topic !== 'string' || !TOPICS.includes(topic)) throw new HttpsError('invalid-argument', 'Unknown topic.');
    if (typeof mode !== 'string' || !Object.hasOwn(CAPS, mode)) throw new HttpsError('invalid-argument', 'Unknown room type.');
    const cap = CAPS[mode];

    const pass = (await publicDoc(`access/${uid}`).get()).data();
    if (typeof pass?.until !== 'number' || pass.until <= Date.now()) throw new HttpsError('permission-denied', 'Your access has expired. Please reload the page.');
    if (mode === 'video' && (pass.videoBanUntil || 0) > Date.now()) throw new HttpsError('permission-denied', 'Video is locked for now. Voice rooms are open.');

    const now = Date.now();
    const limitRef = privateDoc(`groupJoins/${uid}`);
    await db.runTransaction(async t => {
        const times = ((await t.get(limitRef)).data()?.times || []).filter(x => typeof x === 'number' && x > now - HOUR);
        if (times.length >= JOIN_CAP) throw new HttpsError('resource-exhausted', 'You’re joining rooms very quickly. Try again in a little while.');
        t.set(limitRef, { times: [...times, now] });
    });

    await bump('groupJoins'); await bump(`groupJoins_${mode}`);
    const member = { nick: cleanNick(request.data.nick), avatar: cleanAvatar(request.data.avatar), ts: now, joined: now };
    const found = await publicCol('groups').where('topic', '==', topic).where('mode', '==', mode).limit(CANDIDATES).get();
    const rooms = [];
    for (const g of found.docs) {
        const fresh = await freshMembers(g.id, now);
        if (fresh.length === 0 && now - (g.data().created || 0) > 10 * 60000) { g.ref.delete().catch(() => {}); continue; } // an abandoned room
        rooms.push({ id: g.id, count: fresh.length, members: fresh.map(d => d.id), created: g.data().created || 0 });
    }
    // already in one (a second tab or a reload): rejoin it instead of taking another seat
    const mine = rooms.find(r => r.members.includes(uid));
    if (mine) { await membersCol(mine.id).doc(uid).set(member); return { gid: mine.id, cap }; }

    for (const r of pickGroup(rooms, uid, cap).slice(0, 4)) {
        const ok = await db.runTransaction(async t => {
            const snap = await t.get(membersCol(r.id));
            const count = snap.docs.filter(d => typeof d.data().ts === 'number' && now - d.data().ts <= STALE_MS).length;
            if (count >= cap) return false;
            t.set(membersCol(r.id).doc(uid), member);
            return true;
        });
        if (ok) return { gid: r.id, cap };
    }
    const ref = publicCol('groups').doc();
    await ref.set({ topic, mode, cap, created: now });
    await membersCol(ref.id).doc(uid).set(member);
    return { gid: ref.id, cap };
});
