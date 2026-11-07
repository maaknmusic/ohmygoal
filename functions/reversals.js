// Refunds and chargebacks (Razorpay webhook events refund.processed and payment.dispute.created).
//
// When money goes back to a buyer, what the payment bought is taken back: the coins of a coin pack (as many as are still in the wallet;
// the rest is recorded as unrecovered) or the days of a Premium pass. Hosts who received gifts or private-seat fees from that buyer in
// the last 30 days have their payouts paused (hosts/{uid}.payoutHold) until an admin has looked: the classic fraud is a stolen card
// buying coins, gifting them to the fraudster's own host account and cashing out before the chargeback arrives.
// Every reversal is idempotent per order (repeated webhooks change nothing) and is written to the admin log.
import { logger } from 'firebase-functions/v2';
import { db, privateCol, privateDoc, publicDoc } from './common.js';
import { walletDoc } from './wallet.js';

const DAY = 86400000;
const whole = v => (Number.isInteger(v) && v > 0 ? v : 0);

/** How many of an order's coins a refund of `refunded` paise (out of `amount`) takes back: proportional, rounded up, at most all of them. */
export function coinsDue(coins, amount, refunded) {
    if (!whole(coins) || !whole(amount) || !whole(refunded)) return 0;
    return Math.min(whole(coins), Math.ceil((whole(coins) * Math.min(whole(refunded), whole(amount))) / whole(amount)));
}

/** A wallet after `take` coins are taken back. Bought coins go first: they are what the refund paid for. */
export function walletAfterTakeBack(wallet, take) {
    const coins = whole(wallet?.coins);
    const t = Math.min(whole(take), coins);
    const left = coins - t;
    return { taken: t, coins: left, bought: Math.min(left, Math.max(0, whole(wallet?.bought) - t)) };
}

/**
 * Reverse a paid order. `reason` is 'refund' or 'dispute'; `refunded` is the total refunded so far in paise (a dispute counts as the whole
 * amount). Returns what happened, or null when there was nothing (more) to do.
 */
export async function reverseOrder(orderId, { reason, refunded, paymentId }) {
    const oRef = privateDoc(`orders/${orderId}`);
    const now = Date.now();
    const res = await db.runTransaction(async t => {
        const o = (await t.get(oRef)).data();
        if (!o || (o.status !== 'paid' && o.status !== 'refunded' && o.status !== 'disputed')) return null;
        const total = reason === 'dispute' ? whole(o.amount) : Math.min(whole(refunded), whole(o.amount));
        if (o.kind === 'coins') {
            const due = coinsDue(o.coins, o.amount, total) - whole(o.reversedCoins);
            if (due <= 0) return null;
            const wRef = walletDoc(o.uid);
            const w = (await t.get(wRef)).data() || {};
            const after = walletAfterTakeBack(w, due);
            t.set(wRef, { coins: after.coins, bought: after.bought }, { merge: true });
            t.update(oRef, { status: reason === 'dispute' ? 'disputed' : 'refunded', reversedAt: now, refundedPaise: total, reversedCoins: whole(o.reversedCoins) + due, unrecoveredCoins: whole(o.unrecoveredCoins) + (due - after.taken) });
            return { uid: o.uid, kind: 'coins', taken: after.taken, unrecovered: due - after.taken };
        }
        if (o.kind === 'tip') {
            if (o.reversedAt) return null;
            t.update(oRef, { status: reason === 'dispute' ? 'disputed' : 'refunded', reversedAt: now, refundedPaise: total });
            return { uid: o.uid, kind: 'tip' };
        }
        // a Premium pass: its days are removed (never below "now", so time from other passes is kept)
        if (o.reversedAt) return null;
        const eRef = publicDoc(`entitlements/${o.uid}`);
        const until = (await t.get(eRef)).data()?.premiumUntil || 0;
        const next = Math.max(now, until - whole(o.days) * DAY);
        if (until > now) t.set(eRef, { premiumUntil: next, updatedAt: now }, { merge: true });
        t.update(oRef, { status: reason === 'dispute' ? 'disputed' : 'refunded', reversedAt: now, refundedPaise: total });
        return { uid: o.uid, kind: 'premium', premiumUntil: next };
    });
    if (!res) return null;

    // Hosts who were paid with this buyer's coins recently: pause their payouts until an admin has checked.
    let paused = [];
    if (res.kind === 'coins') {
        const led = await privateCol('hostLedger').where('fromUid', '==', res.uid).limit(1000).get();
        const hosts = new Set(led.docs.map(d => d.data()).filter(e => typeof e.at === 'number' && e.at > now - 30 * DAY && whole(e.hostShare)).map(e => e.hostUid));
        paused = [...hosts];
        for (const h of paused) {
            await privateDoc(`hosts/${h}`).set({ payoutHold: { reason: `a ${reason === 'dispute' ? 'disputed' : 'refunded'} payment by a person who paid this host`, orderId, buyerUid: res.uid, at: now } }, { merge: true });
        }
    }
    await privateCol('adminLog').add({ at: now, by: 'razorpay', what: `payment-${reason}`, details: { orderId, paymentId: paymentId || '', ...res, pausedHosts: paused } });
    logger.info('Order reversed', { orderId, reason, ...res, pausedHosts: paused.length });
    return { ...res, pausedHosts: paused };
}
