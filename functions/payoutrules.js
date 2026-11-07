// Rules for paying hosts real money (used by live.js): who the host is (KYC), where the money goes, how long earnings are held and how
// much can be paid out in a month. Pure helpers, unit tested; the Firestore side is in live.js.
//
// - Before a payout a host gives their legal name, PAN and ONE payout account (a UPI ID, or a bank account with IFSC) in that name.
//   An admin checks the name against the PAN and the UPI app / bank before marking the host verified; payouts are only paid then.
// - A PAN, a UPI ID and a bank account can each belong to one host only (stops one person or a mule account collecting for many).
// - New hosts' earnings are held longer, and payouts are capped per 30 days until an admin marks the host trusted.
import crypto from 'node:crypto';

export const HOLD_DAYS = 7;                    // earnings can be paid out this many days after they were earned
export const NEW_HOST_HOLD_DAYS = 14;          // ... or this many for a host who first went live less than NEW_HOST_DAYS ago
export const NEW_HOST_DAYS = 30;
export const MAX_HOLD_DAYS = Math.max(HOLD_DAYS, NEW_HOST_HOLD_DAYS);
export const MONTHLY_PAYOUT_CAP_PAISE = 1000000;   // ₹10,000 per 30 days unless the host is trusted

const DAY = 86400000;

/** How many days a host's earnings are held: longer for new hosts, the normal hold for trusted or established ones. */
export function holdDaysFor(host, now) {
    if (host?.trusted === true) return HOLD_DAYS;
    const first = Number.isInteger(host?.firstLiveAt) ? host.firstLiveAt : now;
    return now - first < NEW_HOST_DAYS * DAY ? NEW_HOST_HOLD_DAYS : HOLD_DAYS;
}

/** How much (paise) a host may still be paid in this 30-day window. `payouts` are their payout documents (requested or paid count). */
export function capLeftPaise(host, payouts, now) {
    if (host?.trusted === true) return Infinity;
    const used = (payouts || []).filter(p => (p.status === 'requested' || p.status === 'paid') && typeof p.at === 'number' && p.at > now - 30 * DAY)
        .reduce((a, p) => a + (Number.isInteger(p.paise) ? p.paise : 0), 0);
    return Math.max(0, MONTHLY_PAYOUT_CAP_PAISE - used);
}

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UPI = /^[a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9.-]{1,48}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^[0-9]{9,18}$/;
const NAME = /^[\p{L} .'-]{3,80}$/u;

/**
 * Check and normalise what a host typed. Returns { ok: true, kyc } or { ok: false, error } with a message for the host.
 * kyc = { name, pan, method: 'upi' | 'bank', upi?, account?, ifsc? }
 */
export function cleanKyc(input) {
    const name = String(input?.name ?? '').replace(/\s+/g, ' ').trim();
    const pan = String(input?.pan ?? '').replace(/\s+/g, '').toUpperCase();
    const method = input?.method === 'bank' ? 'bank' : input?.method === 'upi' ? 'upi' : '';
    if (!NAME.test(name)) return { ok: false, error: 'Enter your full name as it is on your PAN card.' };
    if (!PAN.test(pan)) return { ok: false, error: 'Enter a valid PAN (10 characters, like ABCDE1234F).' };
    if (method === 'upi') {
        const upi = String(input?.upi ?? '').trim().toLowerCase();
        if (!UPI.test(upi)) return { ok: false, error: 'Enter a valid UPI ID, like name@okaxis.' };
        return { ok: true, kyc: { name, pan, method, upi } };
    }
    if (method === 'bank') {
        const account = String(input?.account ?? '').replace(/\s+/g, '');
        const ifsc = String(input?.ifsc ?? '').replace(/\s+/g, '').toUpperCase();
        if (!ACCOUNT.test(account)) return { ok: false, error: 'Enter your bank account number (9 to 18 digits).' };
        if (!IFSC.test(ifsc)) return { ok: false, error: 'Enter a valid IFSC code, like HDFC0001234.' };
        return { ok: true, kyc: { name, pan, method, account, ifsc } };
    }
    return { ok: false, error: 'Choose how you want to be paid: UPI or bank transfer.' };
}

/** Keys that may belong to one host only: the PAN and the payout account. Hashed, so the index holds no readable details. */
export function kycKeys(kyc) {
    const h = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 40);
    return [{ kind: 'PAN', key: h('pan:' + kyc.pan) }, kyc.method === 'upi' ? { kind: 'UPI ID', key: h('upi:' + kyc.upi) } : { kind: 'bank account', key: h(`bank:${kyc.ifsc}:${kyc.account}`) }];
}

/** Where a payout goes, for the payout record and the admin: "UPI name@bank" or "Bank ••••1234 (HDFC0001234)". */
export function payTo(kyc) {
    return kyc.method === 'upi' ? `UPI ${kyc.upi}` : `Bank ••••${kyc.account.slice(-4)} (${kyc.ifsc})`;
}

/** What the host's own screen shows: the details with the PAN and account number partly hidden. */
export function kycForHost(kyc) {
    if (!kyc) return null;
    return {
        name: kyc.name, pan: kyc.pan ? kyc.pan.slice(0, 2) + '•••••' + kyc.pan.slice(7) : '', method: kyc.method, payTo: payTo(kyc),
        status: kyc.status || 'submitted', note: kyc.status === 'rejected' ? kyc.note || '' : '',
    };
}
