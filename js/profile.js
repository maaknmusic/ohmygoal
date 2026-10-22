// =====================================================================
// ProfileSync: a signed-in Google account keeps its profile (language, nickname, avatar, interests, gender) in
//   artifacts/<app>/public/data/profiles/<uid>   (readable and writable only by that account, see firestore.rules)
// so it follows the person to other devices. Anonymous people never touch the database: their profile lives only in
// this browser's localStorage, exactly as before.
//
//   after a Google sign-in  load the document and apply it here (what the account has wins); with no document yet,
//                           create it from the values on this device
//   later edits             saved after a short pause, and only while signed in with Google
//   offline / denied        quiet: nothing is shown, nothing blocks, the next edit tries again
//
// The class takes its database, its identity and the app's state as parameters (tests use fakes); firestoreIo() and
// googleIdentity() are the real ones.
// =====================================================================
import { sanitizeLang } from './languages.js';
import { sanitizeAvatar, sanitizeHandle } from './identity.js';

export const SAVE_DELAY_MS = 1500;
const RETRY_MS = [5000, 20000, 60000];
const GENDERS = new Set(['male', 'female', 'x', '']);
export const MAX_INTERESTS = 5;
export const MAX_INTEREST_LEN = 24;

const cleanInterests = list => {
    if (!Array.isArray(list)) return null;
    const seen = new Set();
    for (const t of list) {
        if (typeof t !== 'string') continue;
        const tag = t.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MAX_INTEREST_LEN).trim();
        if (tag) seen.add(tag);
        if (seen.size >= MAX_INTERESTS) break;
    }
    return [...seen];
};

/** The document to store, from the values on this device. Every field already satisfies the security rules. */
export function buildProfile(local = {}, now = Date.now()) {
    const doc = {};
    const lang = sanitizeLang(local.lang);
    if (lang) doc.lang = lang;
    const nick = sanitizeHandle(local.nick);
    if (nick) doc.nick = nick;
    const avatar = sanitizeAvatar(local.avatar);
    if (avatar) doc.avatar = { e: avatar.e, h: avatar.h };
    doc.interests = cleanInterests(local.interests) || [];
    doc.gender = GENDERS.has(local.gender) ? local.gender : 'x';
    doc.updatedAt = now;
    return doc;
}

/** What a stored document may change here: only fields that are valid (it is treated as untrusted too). */
export function parseProfile(data) {
    const out = {};
    if (!data || typeof data !== 'object') return out;
    const lang = sanitizeLang(data.lang);
    if (lang) out.lang = lang;
    const nick = sanitizeHandle(data.nick);
    if (nick) out.nick = nick;
    const avatar = sanitizeAvatar(data.avatar);
    if (avatar) out.avatar = avatar;
    const interests = cleanInterests(data.interests);
    if (interests) out.interests = interests;
    if (typeof data.gender === 'string' && GENDERS.has(data.gender)) out.gender = data.gender || 'x';
    return out;
}

/** The profile fields in a fixed order, timestamp left out: "did anything change?". */
const FIELDS = ['lang', 'nick', 'avatar', 'interests', 'gender'];
const fingerprint = doc => JSON.stringify(FIELDS.map(k => doc?.[k] ?? null));

export class ProfileSync {
    /**
     * io:        { get(uid) -> data | null, set(uid, data) }
     * identity:  () => { uid, google }        google = signed in with Google (never true for an anonymous account)
     * getLocal:  () => { lang, nick, avatar, interests, gender }   the values on this device
     * apply:     (parsed) => void             put the account's values into the app state, the form and localStorage
     */
    constructor({ io, identity, getLocal, apply, delayMs = SAVE_DELAY_MS, retryMs = RETRY_MS, now = Date.now, onError = () => {} }) {
        Object.assign(this, { io, identity, getLocal, applyRemote: apply, delayMs, retryMs, now, onError });
        this.uid = null;
        this.ready = false;         // the account's document has been read: only then may we write
        this.loading = false;
        this.applying = false;      // while the account's values are being applied, edits are not "local edits"
        this.denied = false;
        this.saved = '';            // fingerprint of what the account holds
        this.timer = null;
        this.retryTimer = null;
        this.retries = 0;
        this.gen = 0;               // a new sign-in invalidates answers still on their way
    }

    get active() { return this.uid !== null; }

    /** Call whenever the sign-in state may have changed (Friends.onChange). Cheap when nothing changed. */
    check() {
        let id;
        try { id = this.identity(); } catch { id = null; }
        const uid = id?.google && id.uid ? id.uid : null;
        if (uid === this.uid) {
            if (uid && !this.ready && !this.loading && !this.retryTimer) { this.retries = 0; this.adopt(uid); } // an earlier read gave up: try again
            return;
        }
        this.stop();
        if (uid) this.adopt(uid);
    }

    stop() {
        this.gen++;
        clearTimeout(this.timer);
        clearTimeout(this.retryTimer);
        this.timer = this.retryTimer = null;
        this.uid = null;
        this.ready = false;
        this.loading = false;
        this.denied = false;
        this.saved = '';
        this.retries = 0;
    }

    /** Load the account's profile and merge it in; with none yet, create it from this device. */
    async adopt(uid) {
        this.uid = uid;
        const gen = this.gen;
        let data;
        this.loading = true;
        try {
            data = await this.io.get(uid);
        } catch (e) {
            if (gen === this.gen) this.loading = false;
            if (gen !== this.gen) return;
            this.fail(e, () => this.adopt(uid)); // never write before the account's own values were read: that could overwrite them
            return;
        }
        if (gen !== this.gen) return;
        this.loading = false;
        this.retries = 0;
        this.ready = true;
        if (data) {
            const remote = parseProfile(data);
            this.applying = true;
            try { this.applyRemote(remote); } catch (e) { this.onError(e); } finally { this.applying = false; }
            // What the account holds is now in the app. Anything it lacked (a language chosen before signing in, a field an older
            // version never wrote) is added to it.
            this.saved = fingerprint(remote);
            if (fingerprint(buildProfile(this.getLocal())) !== this.saved) this.schedule(0);
        } else {
            this.schedule(0); // first sign-in: create the document from this device
        }
    }

    /** A profile value changed on this device (nickname, avatar, interests, gender, language). */
    touch() {
        if (!this.ready || !this.uid || this.applying || this.denied) return;
        this.schedule(this.delayMs);
    }

    schedule(ms) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; this.flush(); }, ms);
    }

    /** Save now if something changed (also called when the page is hidden). Never throws. */
    async flush() {
        clearTimeout(this.timer);
        this.timer = null;
        if (!this.ready || !this.uid || this.denied) return false;
        const uid = this.uid, gen = this.gen;
        let id;
        try { id = this.identity(); } catch { id = null; }
        if (!id?.google || id.uid !== uid) return false; // signed out in the meantime
        const doc = buildProfile(this.getLocal(), this.now());
        const fp = fingerprint(doc);
        if (fp === this.saved) return true;
        try {
            await this.io.set(uid, doc);
        } catch (e) {
            if (gen === this.gen) this.fail(e, () => this.flush());
            return false;
        }
        if (gen !== this.gen) return false;
        this.saved = fp;
        this.retries = 0;
        return true;
    }

    /** Quiet failure: permission-denied stops writing until the next sign-in; anything else (offline...) retries a few times. */
    fail(e, retry) {
        this.onError(e);
        if (/permission-denied/.test(String(e?.code || ''))) { this.denied = true; return; }
        if (this.retries >= this.retryMs.length) return;
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(retry, this.retryMs[this.retries++]);
    }
}

// ---------------------------------------------------------------------
// The real thing: Firestore and Firebase Auth (transport.fb, see transport.js)
// ---------------------------------------------------------------------
export function firestoreIo(fb) {
    const ref = uid => fb.fs.doc(fb.db, ...fb.base, 'profiles', uid);
    return {
        async get(uid) {
            const snap = await fb.fs.getDoc(ref(uid));
            return snap.exists() ? snap.data() : null;
        },
        set: (uid, data) => fb.fs.setDoc(ref(uid), data),
    };
}

/** Signed in with Google (not anonymous): the only accounts allowed to have a profile document. */
export function googleIdentity(fb) {
    return () => {
        const u = fb.auth.currentUser;
        return { uid: u?.uid || null, google: Boolean(u && !u.isAnonymous && u.providerData?.some(p => p?.providerId === 'google.com')) };
    };
}
