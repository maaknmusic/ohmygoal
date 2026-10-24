// Live sessions, the parts the browser shares with the server. The REAL prices and shares are in functions/live.js (the server charges and
// pays); these copies only let the screens say what something costs, and a test keeps them equal.
export const LIVE_START_FEE = 49;      // coins a host pays to open a session
export const PRIVATE_FEE = 200;        // coins each guest pays to join a private session
export const HOST_SHARE_PCT = 70;      // share of gifts and private fees the host earns
export const MIN_PAYOUT_COINS = 300;
export const MAX_TITLE = 60;

/** Same rule as the server: does this text try to move people off the platform (a link, e-mail, phone number or social handle)? */
export function looksLikeContact(text) {
    const t = String(text || '');
    return /https?:|www\.|\.(com|in|co|me|app|net|org|io|ly)\b|@\w|\b\+?\d[\d\s().-]{6,}\d\b|\b(whatsapp|telegram|insta(gram)?|snap(chat)?|upi|gpay|paytm|phonepe)\b/i.test(t);
}

/** Why this title can't be used (shown under the field), or '' when it is fine. The server checks again. */
export function titleProblem(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length < 3) return 'Give the session a title (at least 3 characters).';
    if (looksLikeContact(t)) return 'A title can’t contain links, e-mail addresses, phone numbers or social handles.';
    return '';
}

/** ₹ text for an amount in paise, in the Indian grouping. */
export const rupees = paise => '₹' + Math.round((Number(paise) || 0) / 100).toLocaleString('en-IN');

/** What the host keeps of a payment of `coins` (rounded down, as on the server). */
export const hostShare = coins => Math.floor((Math.max(0, Math.floor(Number(coins) || 0)) * HOST_SHARE_PCT) / 100);

/** A short line about a live session for a card: "Video · 2 of 4 seats". */
export function seatsText(s) {
    const total = s.kind === 'private' ? s.maxGuests + 1 : s.cap;
    return `${s.mode === 'video' ? 'Video' : 'Voice'} · ${Math.min(s.count, total)} of ${total} in`;
}
