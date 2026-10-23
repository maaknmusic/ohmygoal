// =====================================================================
// Push notifications for friends (Firebase Cloud Messaging, web push; also works inside the Android app).
//
// What is sent, and when:
//   - a friend request arrives, or yours is accepted
//   - a friend is calling you (the friendship document's `call` field is set)
//   - a friend sent you a message (the notification says who, never what: the text isn't shown on lock screens)
//   - a friend came online (only if THEY chose "tell my friends when I'm online" and YOU chose to hear it)
//
// Notifications are opt-in per device. Tokens live in the private tree (push/{uid}), so no client can read anyone's token.
// Every kind is rate limited per pair so a friend can't be used to spam you; nothing is ever sent to strangers.
//
// PUSH_MODE=outbox writes notifications to private/data/pushOutbox instead of sending them (used by the emulator tests).
// =====================================================================
import { logger } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten, onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineString } from 'firebase-functions/params';
import { getMessaging } from 'firebase-admin/messaging';
import { db, publicCol, publicDoc, privateDoc, privateCol, callOpts } from './common.js';

const PUSH_MODE = defineString('PUSH_MODE', { default: 'live' });

const MIN = 60000;
export const MAX_TOKENS = 5;                 // devices per account
export const GAP = Object.freeze({           // minimum time between two notifications of a kind for one pair
    request: 10 * MIN, accepted: 0, call: 20000, message: 2 * MIN, online: 6 * 60 * MIN,
});
const ANNOUNCE_GAP = 30 * MIN;               // how often one person can announce they are online
const MAX_FRIENDS_NOTIFIED = 50;

const UID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TOKEN = /^[A-Za-z0-9_:.\-]{20,4096}$/;

/** A token as stored, or null. */
export const cleanToken = v => (typeof v === 'string' && TOKEN.test(v) ? v : null);

/** A name safe to show in a notification: printable, no control or bidi characters, short. */
export function cleanName(v) {
    const s = typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 30) : '';
    return s || 'A friend';
}

/** Title, body and tag for a kind of notification. Never includes message text. */
export function compose(kind, name) {
    const who = cleanName(name);
    switch (kind) {
        case 'request': return { title: 'Friend request', body: `${who} wants to be your friend.`, tag: 'request' };
        case 'accepted': return { title: 'You’re friends', body: `${who} accepted your friend request.`, tag: 'accepted' };
        case 'call': return { title: `${who} is calling`, body: 'Open the app to answer the video call.', tag: 'call' };
        case 'message': return { title: who, body: 'Sent you a message.', tag: 'msg' };
        case 'online': return { title: `${who} is online`, body: 'Say hi, or start a video call.', tag: 'online' };
        default: return null;
    }
}

/** May a notification of this kind go out, given when the last one did? */
export const canSend = (kind, lastAt, now) => !(GAP[kind] > 0) || !(typeof lastAt === 'number') || now - lastAt >= GAP[kind];

const pushDoc = uid => privateDoc(`push/${uid}`);

/** Sends to every device of one person. Drops tokens the push service says are gone. Resolves to how many were sent. */
async function deliver(uid, payload, { urgent = false } = {}) {
    const snap = await pushDoc(uid).get();
    const tokens = (snap.data()?.tokens || []).map(t => t?.t).filter(Boolean);
    if (!tokens.length) return 0;
    if (PUSH_MODE.value() === 'outbox') {
        await privateCol('pushOutbox').add({ to: uid, payload, at: Date.now() });
        return tokens.length;
    }
    const res = await getMessaging().sendEachForMulticast({
        tokens,
        data: { title: payload.title, body: payload.body, tag: payload.tag, url: './' },
        webpush: { headers: { TTL: urgent ? '60' : '3600', Urgency: urgent ? 'high' : 'normal' } },
        android: { priority: urgent ? 'high' : 'normal', ttl: urgent ? 60000 : 3600000 },
    });
    const dead = [];
    res.responses.forEach((r, i) => {
        const code = r.error?.code || '';
        if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')) dead.push(tokens[i]);
    });
    if (dead.length) {
        await pushDoc(uid).set({ tokens: (snap.data().tokens || []).filter(t => !dead.includes(t.t)) }, { merge: true }).catch(() => {});
    }
    return res.successCount;
}

/** One notification, with the per-pair rate limit. */
async function notify(kind, toUid, fromUid, name, opts = {}) {
    if (!UID.test(toUid || '') || toUid === fromUid) return false;
    const limitRef = privateDoc(`pushSent/${toUid}_${fromUid}_${kind}`);
    const now = Date.now();
    const ok = await db.runTransaction(async t => {
        const last = (await t.get(limitRef)).data()?.at;
        if (!canSend(kind, last, now)) return false;
        t.set(limitRef, { at: now });
        return true;
    });
    if (!ok) return false;
    const msg = compose(kind, name);
    if (!msg) return false;
    try { return (await deliver(toUid, msg, opts)) > 0; } catch (e) { logger.warn('push failed', { kind, code: e?.code }); return false; }
}

function requireGoogle(request) {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
    if (request.auth.token.firebase?.sign_in_provider !== 'google.com') throw new HttpsError('failed-precondition', 'Sign in with Google to get friend notifications.');
    return request.auth.uid;
}

export const registerPush = onCall(callOpts(), async request => {
    const uid = requireGoogle(request);
    const token = cleanToken(request.data?.token);
    if (!token) throw new HttpsError('invalid-argument', 'Not a valid notification token.');
    const ref = pushDoc(uid);
    await db.runTransaction(async t => {
        const cur = (await t.get(ref)).data() || {};
        const tokens = (cur.tokens || []).filter(x => x?.t && x.t !== token);
        tokens.push({ t: token, at: Date.now() });
        await t.set(ref, {
            tokens: tokens.slice(-MAX_TOKENS),
            friendOnline: request.data?.friendOnline === true,   // hear when a friend who shares it comes online
            shareOnline: request.data?.shareOnline === true,     // let friends hear that I come online
        }, { merge: true });
    });
    return { ok: true };
});

export const unregisterPush = onCall(callOpts(), async request => {
    const uid = requireGoogle(request);
    const ref = pushDoc(uid);
    const token = cleanToken(request.data?.token);
    await db.runTransaction(async t => {
        const cur = (await t.get(ref)).data();
        if (!cur) return;
        t.set(ref, { tokens: token ? (cur.tokens || []).filter(x => x?.t !== token) : [], ...(token ? {} : { shareOnline: false, friendOnline: false }) }, { merge: true });
    });
    return { ok: true };
});

/** "I'm online": tell friends who asked to hear it, if I chose to share it. At most once every 30 minutes. */
export const announceOnline = onCall(callOpts(), async request => {
    const uid = requireGoogle(request);
    const mine = (await pushDoc(uid).get()).data();
    if (!mine?.shareOnline) return { sent: 0 };
    const now = Date.now();
    const gateRef = privateDoc(`pushAnnounce/${uid}`);
    const go = await db.runTransaction(async t => {
        const last = (await t.get(gateRef)).data()?.at;
        if (typeof last === 'number' && now - last < ANNOUNCE_GAP) return false;
        t.set(gateRef, { at: now });
        return true;
    });
    if (!go) return { sent: 0 };
    const snap = await publicCol('friendships').where('users', 'array-contains', uid).where('status', '==', 'accepted').limit(MAX_FRIENDS_NOTIFIED).get();
    let sent = 0;
    for (const d of snap.docs) {
        const f = d.data();
        const other = (f.users || []).find(u => u !== uid);
        if (!other) continue;
        const theirs = (await pushDoc(other).get()).data();
        if (!theirs?.friendOnline) continue;
        if (await notify('online', other, uid, f.names?.[uid])) sent++;
    }
    return { sent };
});

const FRIENDSHIP = 'artifacts/anon-connect/public/data/friendships/{pairId}';

export const onFriendshipWritten = onDocumentWritten(FRIENDSHIP, async event => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after || !Array.isArray(after.users)) return;
    const name = uid => after.names?.[uid];
    if (!before && after.status === 'pending') {
        const to = after.users.find(u => u !== after.requestedBy);
        await notify('request', to, after.requestedBy, name(after.requestedBy));
    } else if (before?.status === 'pending' && after.status === 'accepted') {
        const accepter = after.users.find(u => u !== after.requestedBy);
        await notify('accepted', after.requestedBy, accepter, name(accepter));
    } else if (after.status === 'accepted' && after.call?.from && after.call.from !== before?.call?.from
        && typeof after.call.ts === 'number' && Date.now() - after.call.ts < 60000) {
        const to = after.users.find(u => u !== after.call.from);
        await notify('call', to, after.call.from, name(after.call.from), { urgent: true });
    }
});

export const onFriendMessage = onDocumentCreated(`${FRIENDSHIP}/messages/{msgId}`, async event => {
    const m = event.data?.data();
    if (!m || typeof m.from !== 'string') return;
    const f = (await publicDoc(`friendships/${event.params.pairId}`).get()).data();
    if (!f || f.status !== 'accepted' || !f.users?.includes(m.from)) return;
    const to = f.users.find(u => u !== m.from);
    await notify('message', to, m.from, f.names?.[m.from]);
});
