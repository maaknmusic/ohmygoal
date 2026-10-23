// Mutual reveal. After ten minutes of chatting, either person can offer to swap profiles. Nothing is shared unless BOTH say yes,
// and what is shared is a small card the sender wrote or chose: name, avatar, country, languages, interests, a short bio and an
// optional contact handle. Pure functions: the app sends and shows the messages, this decides what they are allowed to contain.
//
// Wire protocol (data channel):  { t: 'reveal', s: 'yes' | 'no' }   then, only once both sides said yes:  { t: 'card', ... }

import { sanitizeAvatar, sanitizeHandle } from './identity.js';
import { sanitizeLang } from './languages.js';
import { stripInvisible } from './shield.js';

export const REVEAL_AFTER_MS = 10 * 60000;
export const BIO_MAX = 80;
export const CONTACT_MAX = 40;
export const CARD_MAX_BYTES = 1500;

const clean = (v, max) => (typeof v === 'string' ? stripInvisible(v).replace(/\s+/g, ' ').trim().slice(0, max) : '');
// A contact is a handle or number, not a link: letters, digits and . _ @ + - and spaces, nothing that looks like a URL.
const CONTACT_OK = /^[\p{L}\p{M}\p{N}._@+\- ]+$/u;
const URLISH = /(https?:|www\.|\.com\b|\.in\b|\.me\b|\/\/)/i;

export function sanitizeContact(v) {
    const s = clean(v, CONTACT_MAX);
    return s && CONTACT_OK.test(s) && !URLISH.test(s) ? s : '';
}

/** The card as it may be shown to the other person: every field validated, unknown fields dropped, or null if it isn't a card. */
export function sanitizeCard(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const nick = sanitizeHandle(raw.nick);
    if (!nick) return null;
    const country = typeof raw.country === 'string' && /^[A-Z]{2}$/.test(raw.country) ? raw.country : '';
    const interests = Array.isArray(raw.interests) ? raw.interests.map(i => clean(i, 24)).filter(Boolean).slice(0, 5) : [];
    return {
        nick,
        avatar: sanitizeAvatar(raw.avatar),
        country,
        lang: sanitizeLang(raw.lang),
        learn: sanitizeLang(raw.learn),
        interests,
        bio: clean(raw.bio, BIO_MAX),
        contact: sanitizeContact(raw.contact),
    };
}

/** The card to send, built from what we know about ourselves. */
export function buildCard({ nick, avatar, country, lang, learn, interests, bio, contact }) {
    return { t: 'card', ...sanitizeCard({ nick, avatar, country, lang, learn, interests, bio, contact }) };
}

/** One reveal per chat. Feed it what happens; it says what to do. */
export function createReveal() {
    const st = { me: false, them: false, declined: false, sentCard: false, gotCard: false };
    const both = () => st.me && st.them && !st.declined;
    return {
        get state() { return { ...st, both: both() }; },
        /** I said yes. Returns 'send-yes' the first time. */
        iAgree() { if (st.declined || st.me) return null; st.me = true; return 'send-yes'; },
        /** I said no (or closed it): the other side is told once. */
        iDecline() { if (st.declined) return null; st.declined = true; return 'send-no'; },
        /** A reveal message from the other person. */
        onReveal(msg) {
            if (!msg || typeof msg !== 'object' || st.declined) return null;
            if (msg.s === 'yes') { st.them = true; return 'they-agreed'; }
            if (msg.s === 'no') { st.declined = true; return 'they-declined'; }
            return null;
        },
        /** True once, when both said yes and our card has not gone out yet. */
        shouldSendCard() { if (both() && !st.sentCard) { st.sentCard = true; return true; } return false; },
        /** A card from the other person: accepted only after both said yes, only once, only if it is a valid card of a sane size. */
        onCard(msg) {
            if (!both() || st.gotCard) return null;
            let size = 0;
            try { size = JSON.stringify(msg).length; } catch { return null; }
            if (size > CARD_MAX_BYTES) return null;
            const card = sanitizeCard(msg);
            if (!card) return null;
            st.gotCard = true;
            return card;
        },
    };
}
