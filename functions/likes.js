// =====================================================================
// "Good vibe" likes: after a chat you can like the stranger you were matched with.
//
// The count lives in artifacts/{appId}/public/data/reputation/{uid} (field `likes`) and is
// written ONLY here; firestore.rules let signed-in users read one doc by uid but never list or
// write. likeUser takes just a room id: the person being liked is always derived from the
// room, never sent by the client, so a caller can't like an arbitrary account.
//
// Abuse limits, kept in the private tree:
//   - one like per room per person, ever (likeLog)
//   - one like per (liker, liked) pair per 24 h (likePairs)
//   - at most 40 likes given and 80 received per account in any rolling 24 h (likeCounters)
// =====================================================================
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db, publicDoc, privateDoc, callOpts } from './common.js';
import { bump } from './stats.js';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MIN_ROOM_AGE_MS = 30000;   // a real conversation takes a moment...
const MAX_ROOM_AGE_MS = 2 * HOUR; // ...and the like button is for people who just talked
const GIVEN_CAP = 40;            // likes one account can give per 24 h
const RECEIVED_CAP = 80;         // likes one account can receive per 24 h (anti brigading / farming)

const ROOM_ID = /^[A-Za-z0-9]{10,40}$/;
// Both uids end up in document paths and room.users is client-written, so keep them path-safe.
const UID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** `created` is a Firestore Timestamp for matched rooms and a millisecond number for friend calls. */
function createdMs(created) {
    const ms = typeof created?.toMillis === 'function' ? created.toMillis() : created;
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

/** Timestamps from the last 24 h (a true rolling window, unlike a counter that resets at a fixed time). */
const recent = (times, now) => (Array.isArray(times) ? times : []).filter(t => typeof t === 'number' && t > now - DAY);

export const likeUser = onCall(callOpts(), async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please reload the page.');
    const uid = request.auth.uid;
    // Only `roomId` is read; any other field a client sends (a target uid, say) is ignored.
    const roomId = request.data?.roomId;
    if (typeof roomId !== 'string' || !ROOM_ID.test(roomId)) throw new HttpsError('invalid-argument', 'Unknown chat.');

    const [pass, room] = await db.getAll(publicDoc(`access/${uid}`), publicDoc(`rooms/${roomId}`));
    // Banned people have no pass (checkAccess / the admin ban delete it), so they can't like.
    const until = pass.data()?.until;
    if (typeof until !== 'number' || until <= Date.now()) {
        throw new HttpsError('permission-denied', 'Your access has expired. Please reload the page.');
    }
    // Same answer whether the room is missing or belongs to others, so room ids can't be probed.
    const users = room.data()?.users;
    if (!Array.isArray(users) || !users.includes(uid)) {
        throw new HttpsError('permission-denied', 'You can only like someone you chatted with.');
    }
    if (users.length !== 2 || users[0] === users[1] || !users.every(u => typeof u === 'string' && UID.test(u))) {
        throw new HttpsError('failed-precondition', 'That chat cannot be liked.');
    }
    const target = users[0] === uid ? users[1] : users[0];

    const created = createdMs(room.data().created);
    if (created === null) throw new HttpsError('failed-precondition', 'That chat cannot be liked.');
    const age = Date.now() - created;
    if (age < MIN_ROOM_AGE_MS) throw new HttpsError('failed-precondition', 'Chat a little longer before liking.');
    if (age > MAX_ROOM_AGE_MS) throw new HttpsError('failed-precondition', 'That chat ended too long ago to like.');

    const logRef = privateDoc(`likeLog/${roomId}_${uid}`);
    const pairRef = privateDoc(`likePairs/${uid}_${target}`);
    const givenRef = privateDoc(`likeCounters/given_${uid}`);
    const receivedRef = privateDoc(`likeCounters/received_${target}`);
    const repRef = publicDoc(`reputation/${target}`);

    const result = await db.runTransaction(async t => {
        const [log, pair, given, received, rep] = await t.getAll(logRef, pairRef, givenRef, receivedRef, repRef);
        if (log.exists) return { ok: true, already: true }; // retry / double tap: count once
        const now = Date.now();
        if (pair.exists && pair.data().at > now - DAY) {
            throw new HttpsError('already-exists', 'You already liked this person today.');
        }
        const sent = recent(given.data()?.times, now);
        if (sent.length >= GIVEN_CAP) throw new HttpsError('resource-exhausted', 'You have given a lot of likes today. Try again tomorrow.');
        const got = recent(received.data()?.times, now);
        if (got.length >= RECEIVED_CAP) throw new HttpsError('resource-exhausted', 'This person cannot receive more likes right now.');

        t.create(logRef, { roomId, from: uid, to: target, at: now });
        t.set(pairRef, { at: now });
        t.set(givenRef, { times: [...sent, now] });
        t.set(receivedRef, { times: [...got, now] });
        t.set(repRef, { likes: FieldValue.increment(1), updatedAt: now }, { merge: true });
        return { ok: true, likes: (rep.data()?.likes || 0) + 1 };
    });
    if (result?.ok && !result.already) await bump('likes');
    return result;
});
