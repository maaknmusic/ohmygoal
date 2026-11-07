// Who may pay, and how much (checked by createOrder in index.js before an order is made).
//
// - After a chargeback (reversals.js) the account AND the device it last used are blocked from buying (private/data/buyerBlocks), so the
//   same person cannot simply open a new account on the same phone. An admin can lift it (Admin → People).
// - Spending limits per 24 hours: low for accounts younger than NEW_ACCOUNT_DAYS (a stolen card is usually tried on a fresh account),
//   higher afterwards. Paid orders count, and so do orders opened in the last half hour that are not paid yet (so many checkouts opened at
//   once cannot get around the limit).
import { HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { privateCol, privateDoc } from './common.js';

export const NEW_ACCOUNT_DAYS = 7;
export const NEW_ACCOUNT_DAILY_PAISE = 100000;   // ₹1,000 a day for a new account
export const DAILY_PAISE = 1000000;               // ₹10,000 a day otherwise
const DAY = 86400000;

/** Paise already spent (or being paid) in the last 24 hours, from the person's orders. */
export function spentLastDay(orders, now) {
    return (orders || []).filter(o => (o.status === 'paid' && (o.paidAt || o.createdAt) > now - DAY) || (o.status === 'created' && o.createdAt > now - 30 * 60000))
        .reduce((a, o) => a + (Number.isInteger(o.amount) ? o.amount : 0), 0);
}

/** The 24-hour limit for an account created at `createdAt`. */
export const dailyLimitPaise = (createdAt, now) => (now - (createdAt || now) < NEW_ACCOUNT_DAYS * DAY ? NEW_ACCOUNT_DAILY_PAISE : DAILY_PAISE);

const rupees = p => '₹' + Math.floor(p / 100).toLocaleString('en-IN');

/** Throws a clear HttpsError if `uid` may not pay `amount` paise now. */
export async function buyerGate(uid, amount) {
    const now = Date.now();
    const client = (await privateDoc(`clients/${uid}`).get()).data() || {};
    const blocks = await Promise.all([privateDoc(`buyerBlocks/${uid}`).get(), client.fp ? privateDoc(`buyerBlocks/fp_${client.fp}`).get() : null]);
    if (blocks.some(b => b?.exists)) throw new HttpsError('permission-denied', 'Payments are blocked for this account after a disputed payment. Contact us if you think this is a mistake.');
    let createdAt = now;
    try { createdAt = Date.parse((await getAuth().getUser(uid)).metadata.creationTime) || now; } catch { /* unknown: treat as new */ }
    const limit = dailyLimitPaise(createdAt, now);
    const orders = await privateCol('orders').where('uid', '==', uid).limit(300).get();
    const spent = spentLastDay(orders.docs.map(d => d.data()), now);
    if (spent + amount > limit) {
        throw new HttpsError('resource-exhausted', limit === NEW_ACCOUNT_DAILY_PAISE
            ? `New accounts can spend up to ${rupees(limit)} a day for their first ${NEW_ACCOUNT_DAYS} days. You can spend ${rupees(Math.max(0, limit - spent))} more today.`
            : `You can spend up to ${rupees(limit)} a day. You can spend ${rupees(Math.max(0, limit - spent))} more today.`);
    }
}

/** Block buying for an account and the device it last used (after a chargeback). */
export async function blockBuyer(uid, reason, orderId, now = Date.now()) {
    const client = (await privateDoc(`clients/${uid}`).get()).data() || {};
    const doc = { uid, reason, orderId, at: now, fp: client.fp || '' };
    await privateDoc(`buyerBlocks/${uid}`).set(doc);
    if (client.fp) await privateDoc(`buyerBlocks/fp_${client.fp}`).set(doc);
}

/** Lift a block (admin). */
export async function unblockBuyer(uid) {
    const b = (await privateDoc(`buyerBlocks/${uid}`).get()).data();
    const client = (await privateDoc(`clients/${uid}`).get()).data() || {};
    await privateDoc(`buyerBlocks/${uid}`).delete();
    for (const fp of new Set([client.fp, b?.fp].filter(Boolean))) {
        const d = (await privateDoc(`buyerBlocks/fp_${fp}`).get()).data();
        if (d?.uid === uid) await privateDoc(`buyerBlocks/fp_${fp}`).delete();
    }
}
