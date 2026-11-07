// The transaction ledger: one entry for every change to anyone's coins, host earnings, Premium or money paid, written in the SAME
// Firestore transaction as the change itself, so a balance can never move without its entry (and an entry never exists for a change that
// failed). Entries are only ever added, never edited or deleted. They live in the private tree (private/data/transactions), which no
// browser can read; the admin page shows them per person and as a CSV download.
//
// An entry describes one account's side of an event (a gift writes two: the sender's coins and the host's earnings). Fields:
//   at          time (ms)                         type      what happened (TYPES below)
//   uid         whose balance changed             other     the other person, if any
//   coins       change to the wallet's coins      balance   the wallet's coins after it (so the history can be checked step by step)
//   earned      change to a host's earnings       earnedBalance  the host's payable earnings after it
//   paise       money in rupees × 100 (purchases, refunds, payouts)
//   platform    coins the platform kept           ref       the order, session, room or payout it belongs to
//   by          'user', 'system', 'razorpay' or the admin's e-mail                    note      free text (gift name, plan, reason)
import { privateCol } from './common.js';

export const TYPES = Object.freeze([
    'purchase_coins', 'purchase_premium', 'tip',                 // money in (Razorpay)
    'daily_bonus',                                               // free coins
    'chat_gift', 'live_fee', 'private_seat', 'live_gift',        // coins spent
    'coin_gift_sent', 'coin_gift_received',                      // coins between people
    'host_earning',                                              // a host's share of a gift or private seat
    'payout_requested', 'payout_paid', 'payout_rejected',        // host money out
    'refund', 'dispute',                                         // money back to a buyer: what it bought is taken back
    'admin_coins', 'admin_premium',                              // changes made on the admin page
]);

const int = v => (Number.isInteger(v) ? v : 0);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The entry as stored: known fields only, numbers as integers, text cut to length. */
export function entry(e, now = Date.now()) {
    if (!TYPES.includes(e?.type)) throw new Error(`unknown transaction type ${e?.type}`);
    const out = { at: Number.isInteger(e.at) ? e.at : now, type: e.type, uid: str(e.uid, 128), by: str(e.by, 120) || 'user' };
    for (const k of ['coins', 'balance', 'earned', 'earnedBalance', 'paise', 'platform', 'bought', 'days']) if (e[k] !== undefined) out[k] = int(e[k]);
    for (const k of ['other', 'ref', 'note']) if (e[k]) out[k] = str(e[k], k === 'note' ? 200 : 128);
    return out;
}

/** Add an entry inside Firestore transaction `t`. */
export function record(t, e, now) {
    t.set(privateCol('transactions').doc(), entry(e, now));
}

/**
 * Check one person's entries (oldest first) step by step: every wallet entry must start from the balance the previous one ended with, and
 * likewise for host earnings. Returns the first break, or null. History from before the ledger existed has no entries, so the first entry
 * of each kind is taken as the starting point.
 */
export function firstBreak(entries) {
    let coins = null, earned = null;
    for (const e of entries) {
        if (Number.isInteger(e.coins) && Number.isInteger(e.balance)) {
            if (coins !== null && e.balance - e.coins !== coins) return { at: e.at, type: e.type, kind: 'coins', expected: coins, found: e.balance - e.coins };
            coins = e.balance;
        }
        if (Number.isInteger(e.earned) && Number.isInteger(e.earnedBalance)) {
            if (earned !== null && e.earnedBalance - e.earned !== earned) return { at: e.at, type: e.type, kind: 'earned', expected: earned, found: e.earnedBalance - e.earned };
            earned = e.earnedBalance;
        }
    }
    return null;
}
