// =====================================================================
// Gifting coins from one person to another. The scenario:
//   Asha bought 100 coins and gifts them to Bilal: the platform keeps 30 (COIN_GIFT_PLATFORM_PCT) and Bilal receives 70 coins he can SPEND
//   (gifts, private sessions...). They cannot be cashed out and cannot be gifted again.
// Guard rails, all enforced here and never in the browser:
//   - only coins that were bought can be gifted (the wallet's `bought` count; free daily coins and received gifts are not giftable)
//   - you can only gift someone you are with right now: in a one-to-one chat or in the same live session, so there is no way to send coins to a
//     stranger by user id, and nobody can discover another person's id
//   - both people need a Google account; 10 to 500 coins a gift, 1,000 coins a day and 20 gifts an hour per account
//   - every gift is written to a private log (coinGiftLog) and counted for the admin panel
// =====================================================================
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { db, publicDoc, publicCol, privateDoc, privateCol, callOpts } from './common.js';
import { bump, istDay } from './stats.js';
import { requireGoogle } from './wallet.js';
import { MAX_COINS, COIN_GIFT_MIN, COIN_GIFT_MAX, COIN_GIFT_DAILY_CAP, COIN_GIFT_PER_HOUR, coinGiftSplit } from './gifts.js';
import { STALE_MS } from './groups.js';

const HOUR = 3600000;
const ROOM_ID = /^[A-Za-z0-9]{10,40}$/;
const UID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const asInt = v => (Number.isInteger(v) && v > 0 ? v : 0);
const walletRef = uid => privateDoc(`wallet/${uid}`);

export const giftCoins = onCall(callOpts(), async request => {
    const uid = requireGoogle(request);
    const { to, roomId, sid } = request.data || {};
    const amount = request.data?.amount;
    if (!Number.isInteger(amount) || amount < COIN_GIFT_MIN || amount > COIN_GIFT_MAX) throw new HttpsError('invalid-argument', `You can gift ${COIN_GIFT_MIN} to ${COIN_GIFT_MAX} coins at a time.`);
    if (typeof to !== 'string' || !UID.test(to)) throw new HttpsError('invalid-argument', 'Choose who to gift.');
    if (to === uid) throw new HttpsError('invalid-argument', 'You cannot gift coins to yourself.');
    if ((typeof roomId === 'string') === (typeof sid === 'string')) throw new HttpsError('invalid-argument', 'Gift coins from a chat or a live session.');

    const pass = (await publicDoc(`access/${uid}`).get()).data();
    if (typeof pass?.until !== 'number' || pass.until <= Date.now()) throw new HttpsError('permission-denied', 'Your access has expired. Please reload the page.');
    const now = Date.now();

    // you can only gift someone you are with right now
    let context, ctxId, toNick = '', fromNick = '';
    if (typeof roomId === 'string') {
        if (!ROOM_ID.test(roomId)) throw new HttpsError('invalid-argument', 'Unknown chat.');
        const room = (await publicDoc(`rooms/${roomId}`).get()).data();
        const users = room?.users;
        if (!Array.isArray(users) || users.length !== 2 || !users.includes(uid) || !users.includes(to)) throw new HttpsError('permission-denied', 'You can only gift coins to someone you are chatting with.');
        const created = typeof room.created?.toMillis === 'function' ? room.created.toMillis() : room.created;
        if (!Number.isFinite(created) || now - created > 2 * HOUR) throw new HttpsError('failed-precondition', 'That chat ended too long ago.');
        context = 'chat'; ctxId = roomId;
    } else {
        if (!ROOM_ID.test(sid)) throw new HttpsError('invalid-argument', 'Unknown session.');
        const [g, me, them] = await db.getAll(publicDoc(`groups/${sid}`), publicDoc(`groups/${sid}/members/${uid}`), publicDoc(`groups/${sid}/members/${to}`));
        const fresh = d => typeof d.data()?.ts === 'number' && now - d.data().ts <= STALE_MS;
        if (g.data()?.live !== true || g.data()?.status !== 'live' || !me.exists || !them.exists || !fresh(me) || !fresh(them)) {
            throw new HttpsError('permission-denied', 'You can only gift coins to someone who is in the same live session as you.');
        }
        context = 'live'; ctxId = sid; toNick = them.data().nick || ''; fromNick = me.data().nick || '';
    }

    // the person must be able to use coins (a Google account): checked before any coin moves
    try {
        const u = await getAuth().getUser(to);
        if (!u.providerData.some(p => p.providerId === 'google.com')) throw new Error('not google');
    } catch (e) { throw new HttpsError('failed-precondition', 'That person needs to sign in with Google before they can receive coins.'); }

    const day = istDay(now);
    const limitRef = privateDoc(`coinGiftLimits/${uid}`);
    const { recipient, platform } = coinGiftSplit(amount);
    const out = await db.runTransaction(async t => {
        const [sw, rw, lim] = await Promise.all([t.get(walletRef(uid)), t.get(walletRef(to)), t.get(limitRef)]);
        const w = sw.data() || {}, coins = asInt(w.coins), bought = Math.min(asInt(w.bought), coins);
        if (amount > bought) {
            throw new HttpsError('failed-precondition', bought
                ? `Only coins you bought can be gifted. You can gift up to ${bought} coins now.`
                : 'Only coins you bought can be gifted. Free daily coins and coins you received cannot be gifted.');
        }
        const L = lim.data() || {};
        const sentToday = L.day === day ? asInt(L.total) : 0;
        const times = (Array.isArray(L.times) ? L.times : []).filter(x => typeof x === 'number' && x > now - HOUR);
        if (times.length >= COIN_GIFT_PER_HOUR) throw new HttpsError('resource-exhausted', 'That’s a lot of gifts for one hour. Try again later.');
        if (sentToday + amount > COIN_GIFT_DAILY_CAP) throw new HttpsError('resource-exhausted', `You can gift up to ${COIN_GIFT_DAILY_CAP} coins a day. You have ${COIN_GIFT_DAILY_CAP - sentToday} left today.`);
        const rc = asInt(rw.data()?.coins);
        if (rc + recipient > MAX_COINS) throw new HttpsError('failed-precondition', 'That person can’t hold that many coins.');
        t.set(walletRef(uid), { coins: coins - amount, bought: bought - amount }, { merge: true });
        t.set(walletRef(to), { coins: rc + recipient }, { merge: true });          // received coins are free coins: spendable, never giftable
        t.set(limitRef, { day, total: sentToday + amount, times: [...times, now] });
        t.set(privateCol('coinGiftLog').doc(), { from: uid, to, amount, recipient, platform, context, ctxId, at: now });
        if (context === 'live') t.set(publicCol(`groups/${sid}/events`).doc(), { kind: 'coins', amount: recipient, nick: fromNick, toNick, at: now });
        return { coins: coins - amount, giftable: bought - amount, leftToday: COIN_GIFT_DAILY_CAP - sentToday - amount };
    });
    await bump('coinGifts'); await bump('coinGiftCoins', amount); await bump('platformShareCoins', platform);
    return { ...out, recipient, platform };
});
