// =====================================================================
// Coins and gifts. A wallet is a private document (wallet/{uid}); clients cannot read or write it, only these functions can.
//   getWallet   -> { coins, dailyAvailable }
//   claimDaily  -> free coins once per Indian day (a little more for Premium)
//   sendGift    -> spends coins on a gift for the person you are chatting with. Only a room you are in and a recent one,
//                  the price comes from gifts.js, never from the browser, and the balance can't go below zero.
// Buying coins goes through the same Razorpay order flow as Premium (see index.js: createOrder with a `coins` pack).
// =====================================================================
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db, publicDoc, privateDoc } from './common.js';
import { bump } from './stats.js';
import { GIFTS, DAILY_COINS, DAILY_COINS_PREMIUM, GIFT_HOURLY_CAP, MAX_COINS } from './gifts.js';

const HOUR = 3600000;
const IST_MS = 330 * 60000;
const ROOM_ID = /^[A-Za-z0-9]{10,40}$/;
const UID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const walletRef = uid => privateDoc(`wallet/${uid}`);
const today = now => new Date(now + IST_MS).toISOString().slice(0, 10);

function requireGoogle(request) {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
    if (request.auth.token.firebase?.sign_in_provider !== 'google.com') throw new HttpsError('failed-precondition', 'Sign in with Google to use coins.');
    return request.auth.uid;
}

const isPremium = async uid => ((await publicDoc(`entitlements/${uid}`).get()).data()?.premiumUntil || 0) > Date.now();

export const getWallet = onCall(async request => {
    const uid = requireGoogle(request);
    const w = (await walletRef(uid).get()).data() || {};
    return { coins: Number.isInteger(w.coins) ? w.coins : 0, dailyAvailable: w.dailyDay !== today(Date.now()) };
});

export const claimDaily = onCall(async request => {
    const uid = requireGoogle(request);
    const bonus = (await isPremium(uid)) ? DAILY_COINS_PREMIUM : DAILY_COINS;
    const day = today(Date.now());
    return db.runTransaction(async t => {
        const w = (await t.get(walletRef(uid))).data() || {};
        const coins = Number.isInteger(w.coins) ? w.coins : 0;
        if (w.dailyDay === day) return { coins, gained: 0 };
        const next = Math.min(MAX_COINS, coins + bonus);
        t.set(walletRef(uid), { coins: next, dailyDay: day }, { merge: true });
        return { coins: next, gained: next - coins };
    });
});

export const sendGift = onCall(async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please reload the page.');
    const uid = requireGoogle(request);
    const { roomId, gift } = request.data || {};
    if (typeof roomId !== 'string' || !ROOM_ID.test(roomId)) throw new HttpsError('invalid-argument', 'Unknown chat.');
    if (typeof gift !== 'string' || !Object.hasOwn(GIFTS, gift)) throw new HttpsError('invalid-argument', 'Unknown gift.');
    const price = GIFTS[gift];

    const [pass, room] = await db.getAll(publicDoc(`access/${uid}`), publicDoc(`rooms/${roomId}`));
    const until = pass.data()?.until;
    if (typeof until !== 'number' || until <= Date.now()) throw new HttpsError('permission-denied', 'Your access has expired. Please reload the page.');
    const users = room.data()?.users;
    if (!Array.isArray(users) || users.length !== 2 || !users.includes(uid) || !users.every(u => typeof u === 'string' && UID.test(u))) {
        throw new HttpsError('permission-denied', 'You can only send a gift to someone you are chatting with.');
    }
    const created = typeof room.data().created?.toMillis === 'function' ? room.data().created.toMillis() : room.data().created;
    if (!Number.isFinite(created) || Date.now() - created > 2 * HOUR) throw new HttpsError('failed-precondition', 'That chat ended too long ago.');

    const now = Date.now();
    const result = await db.runTransaction(async t => {
        const w = (await t.get(walletRef(uid))).data() || {};
        const coins = Number.isInteger(w.coins) ? w.coins : 0;
        const sent = (Array.isArray(w.sent) ? w.sent : []).filter(x => typeof x === 'number' && x > now - HOUR);
        if (sent.length >= GIFT_HOURLY_CAP) throw new HttpsError('resource-exhausted', 'That’s a lot of gifts for one hour. Try again later.');
        if (coins < price) throw new HttpsError('failed-precondition', 'Not enough coins.');
        t.set(walletRef(uid), { coins: coins - price, sent: [...sent, now] }, { merge: true });
        t.set(privateDoc(`giftLog/${roomId}_${uid}_${now}`), { uid, roomId, gift, price, at: now });
        return { coins: coins - price };
    });
    await bump('gifts'); await bump('coinsSpent', price);
    return result;
});

/** Adds coins to a wallet (called when a coin-pack order is paid). Capped so a wallet can't grow without limit. */
export function addCoinsTx(t, uid, current, amount) {
    t.set(walletRef(uid), { coins: Math.min(MAX_COINS, (Number.isInteger(current) ? current : 0) + amount) }, { merge: true });
}
export const walletDoc = walletRef;
