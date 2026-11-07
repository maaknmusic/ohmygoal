// =====================================================================
// Live sessions: approved hosts open a small live room (it is a group room, see groups.js), people join, send gifts to the host,
// and a host can run a paid private session. All money moves here, in transactions, and the browser never decides a price or a share.
//
//   Anyone signed in with Google (and past the age check) can host: no application, no approval. You can suspend a host in the admin panel.
//   startLive      the host pays LIVE_START_FEE coins (the first session of each account is free) and a room opens: public (anyone joins free) or private (every guest pays PRIVATE_FEE coins).
//   joinLive       adds the caller to the room. A private session charges the guest once per session, in the same transaction that
//                  credits the host.
//   sendLiveGift   spends gift coins; the host gets HOST_SHARE_PCT of them, the rest is yours.
//   endLive        the host (or an admin) closes the room.
//   requestPayout  a host asks to be paid what they earned; you pay by hand (UPI or bank) and mark it paid in the admin panel.
// Money records (private tree, nobody but these functions can read or write them):
//   hosts/{uid}            name and status (active or suspended)   hostWallet/{uid}   { coins: owed to the host, pending, paidOut, lifetime }
//   hostLedger/{id}        every credit to a host          payouts/{id}       a payout request and how it ended
//   livePaid/{sid}_{uid}   a guest already paid for that private session (re-joining is free)
// =====================================================================
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db, publicCol, publicDoc, privateCol, privateDoc, callOpts } from './common.js';
import { ADMIN_EMAILS, requireAdmin } from './moderation.js';
import { bump, istDay, statsRef } from './stats.js';
import { cleanNick, cleanAvatar, CAPS, STALE_MS } from './groups.js';
import { GIFTS, GIFT_HOURLY_CAP, afterSpend } from './gifts.js';
import { record } from './ledger.js';

export const LIVE_START_FEE = 49;           // coins a host pays to open a session (kept by the platform)
export const PRIVATE_FEE = 200;             // coins each guest pays to join a private session
export const HOST_SHARE_PCT = 70;           // share of every gift and private fee that the host earns
export const COIN_VALUE_PAISE = 75;         // what one earned coin is worth when you pay the host (₹0.75)
export const MIN_PAYOUT_COINS = 300;        // smallest payout a host can ask for (about ₹225)
export const HOLD_DAYS = 7;                  // earnings can be paid out this many days after they were earned, so a refund or chargeback shows up first
export const MAX_SESSION_MS = 3 * 3600000;  // a session closes by itself after this
export const STARTS_PER_DAY = 12;
/** Rough running cost of one person in a live room for one hour, in paise (database writes and reads, plus an allowance for the video relay). Only used for the admin usage panel. */
export const INFRA_PAISE_PER_PARTICIPANT_HOUR = 50;
const HOUR = 3600000;
const DAY = 86400000;
const HOST_STALE_MS = 3 * 60000;            // a session whose host has not been heard from for this long is over
const MAX_TITLE = 60;
const SID = /^[A-Za-z0-9]{10,40}$/;
const UID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const walletRef = uid => privateDoc(`wallet/${uid}`);
const hostWalletRef = uid => privateDoc(`hostWallet/${uid}`);
const membersCol = sid => publicCol(`groups/${sid}/members`);
const asInt = v => (Number.isInteger(v) ? v : 0);

// ---------------------------------------------------------------- pure helpers (unit tested)

/** How a payment of `total` coins is shared: the host gets the share rounded down, the platform the rest, so no coin is lost or made. */
const wholeCoins = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
export function splitCoins(total) {
    const t = wholeCoins(total);
    const host = Math.floor((t * HOST_SHARE_PCT) / 100);
    return { host, platform: t - host };
}

/**
 * How `total` coins spent from `wallet` (a wallet document's data, before the spend) are shared. Only the part paid with BOUGHT coins earns
 * the host anything: free coins (the daily bonus, coins received as a gift) are spent first (see afterSpend) and go to the platform, so free
 * coins collected on many accounts can never be turned into a payout. `bought` is how many bought coins the payment used.
 */
export function earningSplit(wallet, total) {
    const t = wholeCoins(total);
    const bought = afterSpend(wallet, 0).bought - afterSpend(wallet, t).bought;
    const host = splitCoins(bought).host;
    return { host, platform: t - host, bought };
}

/**
 * Coins earned in the last HOLD_DAYS Indian days, which cannot be paid out yet. `recent` is the host wallet's map of day -> coins earned
 * that day (kept by creditHost). Never more than the balance, so a payout or a refund taken out of the balance is respected.
 */
export function heldCoins(recent, balance, now) {
    const from = istDay(now - (HOLD_DAYS - 1) * DAY);
    let held = 0;
    if (recent && typeof recent === 'object') for (const [day, n] of Object.entries(recent)) if (day >= from && Number.isInteger(n) && n > 0) held += n;
    return Math.min(held, wholeCoins(balance));
}

/** The host wallet's `recent` map after `share` more coins were earned now: today's bucket grows, buckets older than the hold are dropped. */
export function recentAfter(recent, share, now) {
    const from = istDay(now - (HOLD_DAYS - 1) * DAY), today = istDay(now);
    const out = {};
    if (recent && typeof recent === 'object') for (const [day, n] of Object.entries(recent)) if (day >= from && Number.isInteger(n) && n > 0) out[day] = n;
    if (wholeCoins(share)) out[today] = (out[today] || 0) + wholeCoins(share);
    return out;
}

/** Earned coins in paise (₹1 = 100). */
export const coinsToPaise = coins => wholeCoins(coins) * COIN_VALUE_PAISE;

/** Printable text without control or direction characters, spaces collapsed, cut to `max`. */
export function cleanText(v, max) {
    return typeof v === 'string'
        ? v.replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
        : '';
}

/** Does this text try to move people off the platform (a link, e-mail, phone number or social handle)? */
export function looksLikeContact(text) {
    const t = String(text || '');
    return /https?:|www\.|\.(com|in|co|me|app|net|org|io|ly)\b|@\w|\b\+?\d[\d\s().-]{6,}\d\b|\b(whatsapp|telegram|insta(gram)?|snap(chat)?|upi|gpay|paytm|phonepe)\b/i.test(t);
}

/** A session title that can be shown to everyone: 3 to 60 plain characters, no way to contact the host off the platform. */
export function cleanTitle(v) {
    const t = cleanText(v, MAX_TITLE);
    if (t.length < 3) throw new HttpsError('invalid-argument', 'Give the session a title (at least 3 characters).');
    if (looksLikeContact(t)) throw new HttpsError('invalid-argument', 'A title can’t contain links, e-mail addresses, phone numbers or social handles.');
    return t;
}

/** Guests a private session can hold besides the host. */
export const maxGuestsFor = mode => (Object.hasOwn(CAPS, mode) ? CAPS[mode] - 1 : 0);

/** Is this session still running? (not ended, not past its limit, host heard from recently) */
export function sessionIsLive(g, hostSeenAt, now) {
    if (!g || g.status !== 'live') return false;
    if (typeof g.endsAt === 'number' && now >= g.endsAt) return false;
    const seen = Math.max(typeof hostSeenAt === 'number' ? hostSeenAt : 0, typeof g.created === 'number' ? g.created : 0);
    return now - seen <= HOST_STALE_MS;
}

// ---------------------------------------------------------------- shared helpers

function requireGoogle(request) {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
    if (request.auth.token.firebase?.sign_in_provider !== 'google.com') throw new HttpsError('failed-precondition', 'Sign in with Google to use live sessions.');
    return request.auth.uid;
}
async function requirePass(uid) {
    const pass = (await publicDoc(`access/${uid}`).get()).data();
    if (typeof pass?.until !== 'number' || pass.until <= Date.now()) throw new HttpsError('permission-denied', 'Your access has expired. Please reload the page.');
    return pass;
}
const sidOf = data => {
    const sid = data?.sid;
    if (typeof sid !== 'string' || !SID.test(sid)) throw new HttpsError('invalid-argument', 'Unknown session.');
    return sid;
};

/** Adds earnings for a host inside a transaction (the caller has already read `hw` = the host wallet document). */
function creditHost(t, hostUid, hw, share, entry, now) {
    const cur = hw || {};
    t.set(hostWalletRef(hostUid), {
        coins: asInt(cur.coins) + share, lifetime: asInt(cur.lifetime) + share, pending: asInt(cur.pending), paidOut: asInt(cur.paidOut),
        recent: recentAfter(cur.recent, share, now),
    }, { mergeFields: ['coins', 'lifetime', 'pending', 'paidOut', 'recent'] });
    t.set(privateCol('hostLedger').doc(), { hostUid, ...entry, hostShare: share, at: now });
    if (share) record(t, { at: now, type: 'host_earning', uid: hostUid, earned: share, earnedBalance: asInt(cur.coins) + share, other: entry.fromUid, ref: entry.sid, note: entry.gift || entry.type });
}

/** A person can host unless an admin suspended them. Returns their host record (or an empty one for a first-timer). */
async function hostGate(uid) {
    const h = (await privateDoc(`hosts/${uid}`).get()).data() || {};
    if (h.status === 'suspended') throw new HttpsError('permission-denied', 'Hosting is paused for your account. Contact us if you think this is a mistake.');
    return h;
}

/**
 * Ends a session once (a second call does nothing) and records how much it was used: minutes live, minutes people spent in it.
 * Returns true when this call is the one that ended it.
 */
async function closeSession(sid, now, reason) {
    const ref = publicDoc(`groups/${sid}`);
    const g = await db.runTransaction(async t => {
        const s = (await t.get(ref)).data();
        if (!s || s.live !== true || s.status !== 'live') return null;
        t.update(ref, { status: 'ended', endedAt: now, endReason: reason });
        return s;
    });
    if (!g) return false;
    try {
        const members = await membersCol(sid).get();
        const end = Math.min(now, typeof g.endsAt === 'number' ? g.endsAt : now);
        const minutes = Math.max(0, Math.round((end - (g.created || end)) / 60000));
        let people = 0;
        for (const d of members.docs) {
            const m = d.data();
            people += Math.max(0, Math.round((Math.min(typeof m.ts === 'number' ? m.ts : end, end) - (typeof m.joined === 'number' ? m.joined : end)) / 60000));
        }
        await bump('liveEnded'); await bump('liveMinutes', minutes); await bump('liveParticipantMinutes', people);
    } catch (e) { /* the numbers are only for the admin panel */ }
    return true;
}

// ---------------------------------------------------------------- hosts

export const myHost = onCall(callOpts(), async request => {
    const uid = requireGoogle(request);
    const [h, w, pays, live] = await Promise.all([
        privateDoc(`hosts/${uid}`).get(), hostWalletRef(uid).get(),
        privateCol('payouts').where('uid', '==', uid).limit(20).get(), publicCol('groups').where('hostUid', '==', uid).limit(10).get(),
    ]);
    const host = h.data() || {};
    const wallet = w.data() || {};
    const now = Date.now();
    const active = live.docs.find(d => sessionIsLive(d.data(), now, now)); // a session still inside its time limit
    const coins = asInt(wallet.coins);
    const held = heldCoins(wallet.recent, coins, now);
    return {
        status: host.status === 'suspended' ? 'suspended' : 'active', name: host.name || '',
        heldCoins: held, payableCoins: coins - held, holdDays: HOLD_DAYS, payoutsPaused: Boolean(host.payoutHold),
        coins, pendingCoins: asInt(wallet.pending), paidOutCoins: asInt(wallet.paidOut), lifetimeCoins: asInt(wallet.lifetime),
        paise: coinsToPaise(coins), coinPaise: COIN_VALUE_PAISE, minPayoutCoins: MIN_PAYOUT_COINS,
        startFee: LIVE_START_FEE, privateFee: PRIVATE_FEE, sharePct: HOST_SHARE_PCT,
        activeSid: active?.id || null, firstFree: !host.firstLiveAt,
        payouts: pays.docs.map(d => ({ id: d.id, coins: d.data().coins, paise: d.data().paise, status: d.data().status, at: d.data().at, paidAt: d.data().paidAt || 0, reference: d.data().status === 'paid' ? d.data().reference || '' : '' }))
            .sort((a, b) => b.at - a.at).slice(0, 10),
    };
});

// ---------------------------------------------------------------- sessions

export const startLive = onCall(callOpts(), async request => {
    const uid = requireGoogle(request);
    const pass = await requirePass(uid);
    const host = await hostGate(uid);
    const { mode, kind } = request.data || {};
    if (typeof mode !== 'string' || !Object.hasOwn(CAPS, mode)) throw new HttpsError('invalid-argument', 'Choose voice or video.');
    if (kind !== 'public' && kind !== 'private') throw new HttpsError('invalid-argument', 'Choose a public or a private session.');
    if (mode === 'video' && (pass.videoBanUntil || 0) > Date.now()) throw new HttpsError('permission-denied', 'Video is locked for now. You can host a voice session.');
    const title = cleanTitle(request.data?.title);
    const cap = CAPS[mode];
    let maxGuests = cap - 1;
    if (kind === 'private') {
        maxGuests = request.data?.maxGuests === undefined ? 1 : request.data.maxGuests;
        if (!Number.isInteger(maxGuests) || maxGuests < 1 || maxGuests > cap - 1) throw new HttpsError('invalid-argument', `A private ${mode} session can have 1 to ${cap - 1} guests.`);
    }
    const now = Date.now();
    // the name people see: what the host typed, else the name they used before, else "Host"
    const typed = cleanNick(request.data?.name);
    const hostName = typed !== 'Guest' ? typed : host.name || 'Host';
    const hostAvatar = cleanAvatar(request.data?.avatar) || host.avatar || null;
    // one live session at a time: close any earlier one
    const mine = await publicCol('groups').where('hostUid', '==', uid).limit(20).get();
    for (const d of mine.docs) if (d.data().status === 'live') await closeSession(d.id, now, 'replaced');

    const sid = publicCol('groups').doc().id;
    let fee = LIVE_START_FEE;
    const limitRef = privateDoc(`liveStarts/${uid}`);
    await db.runTransaction(async t => {
        const [lim, w, hostSnap] = await Promise.all([t.get(limitRef), t.get(walletRef(uid)), t.get(privateDoc(`hosts/${uid}`))]);
        const times = (lim.data()?.times || []).filter(x => typeof x === 'number' && x > now - DAY);
        if (times.length >= STARTS_PER_DAY) throw new HttpsError('resource-exhausted', 'You have started a lot of sessions today. Try again tomorrow.');
        const firstTime = !hostSnap.data()?.firstLiveAt;       // an account's first session is free
        fee = firstTime ? 0 : LIVE_START_FEE;
        const coins = asInt(w.data()?.coins);
        if (coins < fee) throw new HttpsError('failed-precondition', `Going live costs ${LIVE_START_FEE} coins. You have ${coins}. Add coins first.`);
        if (fee) {
            t.set(walletRef(uid), afterSpend(w.data(), fee), { merge: true });
            record(t, { at: now, type: 'live_fee', uid, coins: -fee, balance: coins - fee, platform: fee, ref: sid });
        }
        t.set(limitRef, { times: [...times, now] });
        t.set(publicDoc(`groups/${sid}`), {
            topic: 'live', live: true, status: 'live', hostUid: uid, hostName, hostAvatar, title, mode, cap, kind,
            fee: kind === 'private' ? PRIVATE_FEE : 0, maxGuests, created: now, endsAt: now + MAX_SESSION_MS,
        });
        t.set(membersCol(sid).doc(uid), { nick: hostName, avatar: hostAvatar, ts: now, joined: now, host: true });
        t.set(privateDoc(`hosts/${uid}`), { status: host.status || 'active', name: hostName, avatar: hostAvatar, email: request.auth.token.email || '', lastLiveAt: now, firstLiveAt: host.firstLiveAt || now }, { merge: true });
        if (fee) t.set(privateCol('liveFees').doc(), { hostUid: uid, sid, coins: fee, at: now });
    });
    await bump('liveStarts'); if (fee) await bump('liveFeeCoins', fee); else await bump('liveFreeStarts');
    return { sid, cap, kind, maxGuests, fee };
});

export const joinLive = onCall(callOpts(), async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please reload the page.');
    const uid = request.auth.uid;
    const sid = sidOf(request.data);
    await requirePass(uid);
    const now = Date.now();
    const gRef = publicDoc(`groups/${sid}`);
    const member = { nick: cleanNick(request.data?.nick), avatar: cleanAvatar(request.data?.avatar), ts: now, joined: now };

    const out = await db.runTransaction(async t => {
        const gSnap = await t.get(gRef);
        const g = gSnap.data();
        if (!g || g.live !== true) throw new HttpsError('not-found', 'That session is not open any more.');
        const [members, kicked, paid, guestWallet, hostWallet] = await Promise.all([
            t.get(membersCol(sid)), t.get(privateDoc(`liveKicks/${sid}_${uid}`)), t.get(privateDoc(`livePaid/${sid}_${uid}`)),
            t.get(walletRef(uid)), t.get(hostWalletRef(g.hostUid)),
        ]);
        const fresh = members.docs.filter(d => typeof d.data().ts === 'number' && now - d.data().ts <= STALE_MS);
        const hostDoc = members.docs.find(d => d.id === g.hostUid);
        if (!sessionIsLive(g, hostDoc?.data().ts, now)) throw new HttpsError('failed-precondition', 'That session has ended.');
        if (kicked.exists) throw new HttpsError('permission-denied', 'The host removed you from this session.');
        const isHost = uid === g.hostUid;
        const already = fresh.some(d => d.id === uid);
        const guests = fresh.filter(d => d.id !== g.hostUid).length;
        if (!already) {
            if (fresh.length >= g.cap) throw new HttpsError('resource-exhausted', 'This session is full.');
            if (g.kind === 'private' && !isHost && guests >= g.maxGuests) throw new HttpsError('resource-exhausted', 'This private session is full.');
        }
        let charged = 0, hostShare = 0;
        if (g.kind === 'private' && !isHost && !paid.exists) {
            const coins = asInt(guestWallet.data()?.coins);
            if (coins < g.fee) throw new HttpsError('failed-precondition', `This private session costs ${g.fee} coins. You have ${coins}.`);
            const { host: share, platform, bought } = earningSplit(guestWallet.data(), g.fee);
            t.set(walletRef(uid), afterSpend(guestWallet.data(), g.fee), { merge: true });
            record(t, { at: now, type: 'private_seat', uid, coins: -g.fee, balance: coins - g.fee, platform, other: g.hostUid, ref: sid });
            creditHost(t, g.hostUid, hostWallet.data(), share, { type: 'private', fromUid: uid, sid, total: g.fee, boughtCoins: bought, platformShare: platform }, now);
            t.set(privateDoc(`livePaid/${sid}_${uid}`), { uid, sid, coins: g.fee, at: now });
            charged = g.fee; hostShare = share;
        }
        if (isHost) member.host = true;
        t.set(membersCol(sid).doc(uid), member);
        return { cap: g.cap, kind: g.kind, charged, hostShare, host: isHost, title: g.title, mode: g.mode, hostUid: g.hostUid };
    });
    const { hostShare, ...reply } = out;
    if (out.charged) {
        await bump('privateJoins'); await bump('privateCoins', out.charged); await bump('hostShareCoins', hostShare); await bump('platformShareCoins', out.charged - hostShare);
    }
    return { gid: sid, ...reply };
});

export const endLive = onCall(callOpts(), async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please reload the page.');
    const sid = sidOf(request.data);
    const ref = publicDoc(`groups/${sid}`);
    const g = (await ref.get()).data();
    if (!g || g.live !== true) throw new HttpsError('not-found', 'Unknown session.');
    if (g.hostUid !== request.auth.uid) throw new HttpsError('permission-denied', 'Only the host can end a session.');
    await closeSession(sid, Date.now(), 'host');
    return { ok: true };
});

export const kickLive = onCall(callOpts(), async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please reload the page.');
    const sid = sidOf(request.data);
    const target = request.data?.uid;
    if (typeof target !== 'string' || !UID.test(target)) throw new HttpsError('invalid-argument', 'Unknown person.');
    const g = (await publicDoc(`groups/${sid}`).get()).data();
    if (!g || g.live !== true) throw new HttpsError('not-found', 'Unknown session.');
    if (g.hostUid !== request.auth.uid) throw new HttpsError('permission-denied', 'Only the host can remove someone.');
    if (target === g.hostUid) throw new HttpsError('invalid-argument', 'You cannot remove yourself.');
    await privateDoc(`liveKicks/${sid}_${target}`).set({ sid, uid: target, at: Date.now() });
    await membersCol(sid).doc(target).delete();
    return { ok: true };
});

export const listLive = onCall(callOpts(), async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please reload the page.');
    const now = Date.now();
    const snap = await publicCol('groups').where('live', '==', true).where('status', '==', 'live').limit(60).get();
    const out = [];
    for (const d of snap.docs) {
        const g = d.data();
        const members = await membersCol(d.id).get();
        const hostDoc = members.docs.find(m => m.id === g.hostUid);
        if (!sessionIsLive(g, hostDoc?.data().ts, now)) {
            if (now - (hostDoc?.data().ts || g.created || 0) > HOST_STALE_MS * 2) closeSession(d.id, now, 'stale').catch(() => {});
            continue;
        }
        const fresh = members.docs.filter(m => typeof m.data().ts === 'number' && now - m.data().ts <= STALE_MS).length;
        out.push({
            sid: d.id, title: g.title, hostName: g.hostName, hostAvatar: g.hostAvatar || null, mode: g.mode, kind: g.kind, fee: g.fee || 0,
            cap: g.cap, maxGuests: g.maxGuests, count: fresh, full: fresh >= g.cap || (g.kind === 'private' && fresh - 1 >= g.maxGuests), created: g.created, mine: g.hostUid === request.auth.uid,
        });
    }
    out.sort((a, b) => b.created - a.created);
    return { sessions: out, giftSharePct: HOST_SHARE_PCT };
});

// ---------------------------------------------------------------- gifts

export const sendLiveGift = onCall(callOpts(), async request => {
    const uid = requireGoogle(request);
    const sid = sidOf(request.data);
    const gift = request.data?.gift;
    if (typeof gift !== 'string' || !Object.hasOwn(GIFTS, gift)) throw new HttpsError('invalid-argument', 'Unknown gift.');
    await requirePass(uid);
    const price = GIFTS[gift];
    const now = Date.now();
    const gRef = publicDoc(`groups/${sid}`);
    const nickGiven = typeof request.data?.nick === 'string' ? cleanNick(request.data.nick) : '';

    const res = await db.runTransaction(async t => {
        const gSnap = await t.get(gRef);
        const g = gSnap.data();
        if (!g || g.live !== true) throw new HttpsError('not-found', 'That session is not open any more.');
        const [members, wSnap, hw, paid] = await Promise.all([t.get(membersCol(sid)), t.get(walletRef(uid)), t.get(hostWalletRef(g.hostUid)), t.get(privateDoc(`livePaid/${sid}_${uid}`))]);
        const hostDoc = members.docs.find(m => m.id === g.hostUid);
        if (!sessionIsLive(g, hostDoc?.data().ts, now)) throw new HttpsError('failed-precondition', 'That session has ended.');
        if (uid === g.hostUid) throw new HttpsError('invalid-argument', 'You cannot send a gift to yourself.');
        const mineDoc = members.docs.find(m => m.id === uid);
        // a private session's gifts come only from people who are in it
        if (g.kind === 'private' && !mineDoc && !paid.exists) throw new HttpsError('permission-denied', 'Only guests of this private session can send gifts.');
        const w = wSnap.data() || {};
        const coins = asInt(w.coins);
        const sent = (Array.isArray(w.sent) ? w.sent : []).filter(x => typeof x === 'number' && x > now - HOUR);
        if (sent.length >= GIFT_HOURLY_CAP) throw new HttpsError('resource-exhausted', 'That’s a lot of gifts for one hour. Try again later.');
        if (coins < price) throw new HttpsError('failed-precondition', 'Not enough coins.');
        const { host: share, platform, bought } = earningSplit(w, price);
        t.set(walletRef(uid), { ...afterSpend(w, price), sent: [...sent, now] }, { merge: true });
        record(t, { at: now, type: 'live_gift', uid, coins: -price, balance: coins - price, platform, other: g.hostUid, ref: sid, note: gift });
        creditHost(t, g.hostUid, hw.data(), share, { type: 'gift', fromUid: uid, sid, gift, total: price, boughtCoins: bought, platformShare: platform }, now);
        t.set(publicCol(`groups/${sid}/events`).doc(), { kind: 'gift', gift, price, nick: mineDoc?.data().nick || nickGiven || 'Someone', at: now });
        return { coins: coins - price, hostShare: share };
    });
    await bump('liveGifts'); await bump('liveGiftCoins', price); await bump('hostShareCoins', res.hostShare); await bump('platformShareCoins', price - res.hostShare);
    return { coins: res.coins };
});

// ---------------------------------------------------------------- payouts

export const requestPayout = onCall(callOpts(), async request => {
    const uid = requireGoogle(request);
    const host = await hostGate(uid);
    if (host.payoutHold) throw new HttpsError('failed-precondition', 'Payouts are paused for your account while we check a refunded or disputed payment. Contact us if you have questions.');
    const details = cleanText(request.data?.details, 120);
    if (details.length < 5) throw new HttpsError('invalid-argument', 'Tell us where to pay you: your UPI ID or bank account details.');
    const now = Date.now();
    const id = privateCol('payouts').doc().id;
    const out = await db.runTransaction(async t => {
        const w = (await t.get(hostWalletRef(uid))).data() || {};
        const balance = asInt(w.coins);
        const held = heldCoins(w.recent, balance, now);
        const coins = balance - held;      // what was earned more than HOLD_DAYS days ago
        if (coins < MIN_PAYOUT_COINS) {
            throw new HttpsError('failed-precondition', held
                ? `You can ask for a payout from ${MIN_PAYOUT_COINS} coins. ${coins} of your coins can be paid now; ${held} earned in the last ${HOLD_DAYS} days are on hold until then.`
                : `You can ask for a payout from ${MIN_PAYOUT_COINS} earned coins. You have ${coins}.`);
        }
        const open = await t.get(privateCol('payouts').where('uid', '==', uid).where('status', '==', 'requested').limit(1));
        if (!open.empty) throw new HttpsError('already-exists', 'You already have a payout waiting.');
        t.set(hostWalletRef(uid), { coins: held, pending: asInt(w.pending) + coins }, { merge: true });
        record(t, { at: now, type: 'payout_requested', uid, earned: -coins, earnedBalance: held, paise: coinsToPaise(coins), ref: id });
        t.set(privateDoc(`payouts/${id}`), { uid, coins, paise: coinsToPaise(coins), details, status: 'requested', at: now, name: '' });
        return { coins, paise: coinsToPaise(coins) };
    });
    return { id, ...out };
});

// ---------------------------------------------------------------- admin

/**
 * Warning signs for a payout request, shown to the admin before paying: who the host's earnings of the last 30 days came from, and whether
 * a big giver used the same network (IP address) or device as the host (one person gifting to their own second account, often with a stolen
 * card). Only signs: the admin decides.
 */
export async function payoutRisk(hostUid, now) {
    const led = await privateCol('hostLedger').where('hostUid', '==', hostUid).limit(2000).get();
    const by = new Map();
    let total = 0;
    for (const d of led.docs) {
        const e = d.data();
        if (typeof e.at !== 'number' || e.at < now - 30 * DAY || !asInt(e.hostShare)) continue;
        total += e.hostShare;
        by.set(e.fromUid, (by.get(e.fromUid) || 0) + e.hostShare);
    }
    const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const clients = top.length ? await db.getAll(privateDoc(`clients/${hostUid}`), ...top.map(([u]) => privateDoc(`clients/${u}`))) : [];
    const me = clients[0]?.data() || {};
    const givers = top.map(([uid, coins], i) => {
        const c = clients[i + 1]?.data() || {};
        return { uid, coins, pct: total ? Math.round((coins * 100) / total) : 0, sameIp: Boolean(me.ip && c.ip === me.ip), sameDevice: Boolean(me.fp && c.fp === me.fp) };
    });
    const warnings = [];
    if (givers[0] && givers[0].pct >= 60 && total >= 100) warnings.push(`${givers[0].pct}% of the last 30 days' earnings came from one person`);
    if (givers.some(g => g.sameIp)) warnings.push('a giver used the same IP address as the host');
    if (givers.some(g => g.sameDevice)) warnings.push('a giver used the same device as the host');
    return { earned30: total, givers: givers.length, top: givers, warnings };
}

export const adminHosts = onCall(callOpts({ secrets: [ADMIN_EMAILS], timeoutSeconds: 60 }), async request => {
    const email = requireAdmin(request);
    const { action } = request.data || {};
    const now = Date.now();
    const log = (what, details) => privateCol('adminLog').add({ at: now, by: email, what, details: details || {} });
    const uidOf = () => { const u = request.data?.uid; if (typeof u !== 'string' || !UID.test(u)) throw new HttpsError('invalid-argument', 'Unknown user.'); return u; };
    const note = () => cleanText(request.data?.note, 200);

    switch (action) {
        case 'list': {
            const days = Array.from({ length: 30 }, (_, i) => istDay(now - (29 - i) * DAY));
            const [hosts, pays, live, statDocs] = await Promise.all([
                privateCol('hosts').limit(500).get(), privateCol('payouts').orderBy('at', 'desc').limit(100).get(),
                publicCol('groups').where('live', '==', true).where('status', '==', 'live').limit(60).get(), db.getAll(...days.map(statsRef)),
            ]);
            const wallets = hosts.docs.length ? await db.getAll(...hosts.docs.map(d => hostWalletRef(d.id))) : [];
            const wmap = new Map(wallets.map(w => [w.ref.id, w.data() || {}]));
            const rows = hosts.docs.map(d => {
                const h = d.data(), w = wmap.get(d.id) || {};
                return { uid: d.id, status: h.status === 'suspended' ? 'suspended' : 'active', payoutHold: h.payoutHold || null, held: heldCoins(w.recent, asInt(w.coins), now), name: h.name || '', email: h.email || '', firstLiveAt: h.firstLiveAt || 0, lastLiveAt: h.lastLiveAt || 0, note: h.note || '', coins: asInt(w.coins), pending: asInt(w.pending), paidOut: asInt(w.paidOut), lifetime: asInt(w.lifetime) };
            }).sort((a, b) => b.lastLiveAt - a.lastLiveAt);
            const FIELDS = ['liveStarts', 'liveFeeCoins', 'privateJoins', 'privateCoins', 'liveGifts', 'liveGiftCoins', 'hostShareCoins', 'platformShareCoins', 'liveEnded', 'liveMinutes', 'liveParticipantMinutes', 'liveFreeStarts', 'coinGifts', 'coinGiftCoins'];
            const sum = (from, to) => Object.fromEntries(FIELDS.map(f => [f, statDocs.slice(from, to).reduce((a, d) => a + asInt(d.data()?.[f]), 0)]));
            const sessions = live.docs.filter(d => sessionIsLive(d.data(), now, now)).map(d => ({ sid: d.id, title: d.data().title, hostName: d.data().hostName, mode: d.data().mode, kind: d.data().kind, created: d.data().created }));
            return {
                hosts: rows, coinPaise: COIN_VALUE_PAISE, minPayoutCoins: MIN_PAYOUT_COINS, infraPaise: INFRA_PAISE_PER_PARTICIPANT_HOUR,
                payouts: await Promise.all(pays.docs.map(async d => ({ id: d.id, ...d.data(), ...(d.data().status === 'requested' ? { risk: await payoutRisk(d.data().uid, now) } : {}) }))),
                live: sessions, liveNow: sessions.length,
                usage: { today: sum(29, 30), d7: sum(23, 30), d30: sum(0, 30) },
            };
        }
        case 'decide': {
            const uid = uidOf();
            const decision = request.data?.decision;
            if (decision !== 'suspend' && decision !== 'reinstate') throw new HttpsError('invalid-argument', 'Unknown decision.');
            const ref = privateDoc(`hosts/${uid}`);
            const h = (await ref.get()).data() || {};
            if (decision === 'suspend' && h.status === 'suspended') throw new HttpsError('failed-precondition', 'That person is already suspended.');
            if (decision === 'reinstate' && h.status !== 'suspended') throw new HttpsError('failed-precondition', 'Only a suspended host can be reinstated.');
            await ref.set({ status: decision === 'suspend' ? 'suspended' : 'active', decidedAt: now, decidedBy: email, note: note() }, { merge: true });
            if (decision === 'suspend') {
                const mine = await publicCol('groups').where('hostUid', '==', uid).limit(20).get();
                for (const d of mine.docs) if (d.data().status === 'live') await closeSession(d.id, now, 'suspended');
            }
            await log(`host-${decision}`, { uid, note: note() });
            return { ok: true, status: decision === 'suspend' ? 'suspended' : 'active' };
        }
        case 'clearHold': {
            const uid = uidOf();
            const ref = privateDoc(`hosts/${uid}`);
            if (!(await ref.get()).data()?.payoutHold) throw new HttpsError('failed-precondition', 'Payouts are not paused for that host.');
            await ref.update({ payoutHold: FieldValue.delete() });
            await log('host-clear-hold', { uid, note: note() });
            return { ok: true };
        }
        case 'payoutPaid': case 'payoutReject': {
            const id = request.data?.id;
            if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(id)) throw new HttpsError('invalid-argument', 'Unknown payout.');
            const reference = cleanText(request.data?.reference, 80);
            if (action === 'payoutPaid' && reference.length < 3) throw new HttpsError('invalid-argument', 'Enter the UPI or bank reference of the payment you made.');
            const ref = privateDoc(`payouts/${id}`);
            await db.runTransaction(async t => {
                const p = (await t.get(ref)).data();
                if (!p) throw new HttpsError('not-found', 'Unknown payout.');
                if (p.status !== 'requested') throw new HttpsError('failed-precondition', 'That payout was already handled.');
                const w = (await t.get(hostWalletRef(p.uid))).data() || {};
                if (action === 'payoutPaid') {
                    t.set(hostWalletRef(p.uid), { pending: Math.max(0, asInt(w.pending) - p.coins), paidOut: asInt(w.paidOut) + p.coins }, { merge: true });
                    t.update(ref, { status: 'paid', paidAt: now, paidBy: email, reference });
                    record(t, { at: now, type: 'payout_paid', uid: p.uid, paise: p.paise, ref: id, by: email, note: reference });
                } else {
                    t.set(hostWalletRef(p.uid), { pending: Math.max(0, asInt(w.pending) - p.coins), coins: asInt(w.coins) + p.coins }, { merge: true }); // the coins go back to the host
                    t.update(ref, { status: 'rejected', paidAt: now, paidBy: email, reference: note() });
                    record(t, { at: now, type: 'payout_rejected', uid: p.uid, earned: p.coins, earnedBalance: asInt(w.coins) + p.coins, ref: id, by: email, note: note() });
                }
            });
            await log(action, { id, reference: reference || note() });
            return { ok: true };
        }
        case 'end': {
            const sid = sidOf(request.data);
            const g = (await publicDoc(`groups/${sid}`).get()).data();
            if (g?.live !== true) throw new HttpsError('not-found', 'Unknown session.');
            await closeSession(sid, now, 'admin');
            await log('live-end', { sid });
            return { ok: true };
        }
        default: throw new HttpsError('invalid-argument', 'Unknown action.');
    }
});
