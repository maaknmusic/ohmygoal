// =====================================================================
// Friends & accounts (Firebase only).
// - Google sign-in upgrades the anonymous account (same uid, so blocks etc. carry over).
// - Friendships need both people: the requester creates a "pending" doc, the
//   other person accepts it; Firestore rules enforce this.
// - Friend chats are stored (unlike random chats) so they can be read later.
// - Friend video calls ring through a "call" field on the friendship doc.
// =====================================================================

const CALL_RING_MS = 45000;
const ONLINE_MS = 75000;

export const pairIdOf = (a, b) => [a, b].sort().join('_');

export class Friends {
    constructor(transport) {
        this.t = transport;
        const { auth, db, fs, authMod, base } = transport.fb;
        Object.assign(this, { auth, db, fs, authMod, base });
        this.col = fs.collection(db, ...base, 'friendships');
        this.list = [];
        this.presence = new Map();
        this.listeners = new Set();
        this.unsub = null;
        this.presenceTimer = null;
    }

    get uid() { return this.auth.currentUser?.uid; }
    get signedIn() { const u = this.auth.currentUser; return !!u && !u.isAnonymous; }
    get displayName() { return this.auth.currentUser?.displayName || this.auth.currentUser?.email || ''; }

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit() { this.listeners.forEach(fn => fn(this)); }

    /** Sign in with Google, keeping the current anonymous account (and its uid) when possible. */
    async signIn() {
        const { GoogleAuthProvider, linkWithPopup, signInWithPopup, signInWithCredential } = this.authMod;
        const provider = new GoogleAuthProvider();
        const user = this.auth.currentUser;
        try {
            if (user?.isAnonymous) await linkWithPopup(user, provider);
            else await signInWithPopup(this.auth, provider);
        } catch (e) {
            // This Google account already has a profile: switch to it.
            if (e.code === 'auth/credential-already-in-use') {
                const cred = GoogleAuthProvider.credentialFromError(e);
                if (!cred) throw e;
                await signInWithCredential(this.auth, cred);
            } else throw e;
        }
        await this.auth.currentUser.getIdToken(true); // refresh the token so rules see the Google sign-in
        this.start();
        this.emit();
    }

    async signOut() {
        this.stop();
        await this.authMod.signOut(this.auth);
        await this.authMod.signInAnonymously(this.auth);
        this.emit();
    }

    /** Listen to my friendships and keep friends' online status fresh. */
    start() {
        this.stop();
        if (!this.signedIn) return;
        const { query, where, onSnapshot } = this.fs;
        const uid = this.uid;
        this.unsub = onSnapshot(query(this.col, where('users', 'array-contains', uid)), snap => {
            this.list = snap.docs.map(d => {
                const x = d.data();
                const other = x.users.find(u => u !== uid);
                return { id: d.id, ...x, other, name: x.names?.[other] || 'Friend' };
            }).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
            this.emit();
            this.refreshPresence();
        }, e => console.warn('friends listener', e));
        this.presenceTimer = setInterval(() => this.refreshPresence(), 30000);
    }

    stop() {
        this.unsub?.();
        this.unsub = null;
        clearInterval(this.presenceTimer);
        this.list = [];
    }

    async refreshPresence() {
        const { doc, getDoc } = this.fs;
        await Promise.all(this.list.filter(f => f.status === 'accepted').map(async f => {
            try {
                const snap = await getDoc(doc(this.db, ...this.base, 'presence', f.other));
                this.presence.set(f.other, (snap.data()?.ts || 0) > Date.now() - ONLINE_MS);
            } catch { /* ignore */ }
        }));
        this.emit();
    }

    isOnline(uid) { return !!this.presence.get(uid); }
    get friends() { return this.list.filter(f => f.status === 'accepted'); }
    isFriend(uid) { return this.friends.some(f => f.other === uid); }

    /** Step 1 (requester, after the other person agreed in the chat): create the pending friendship. */
    async createPending(otherUid, myNick) {
        const { doc, setDoc } = this.fs;
        const users = [this.uid, otherUid].sort();
        const id = users.join('_');
        await setDoc(doc(this.col, id), {
            users, status: 'pending', requestedBy: this.uid,
            names: { [this.uid]: myNick || 'Friend' }, createdAt: Date.now(),
        });
        return id;
    }

    /** Step 2 (the other person): accept it. */
    async accept(pairId, myNick) {
        const { doc, updateDoc } = this.fs;
        await updateDoc(doc(this.col, pairId), {
            status: 'accepted', acceptedAt: Date.now(), [`names.${this.uid}`]: myNick || 'Friend',
        });
    }

    async remove(pairId) {
        const { doc, deleteDoc } = this.fs;
        await deleteDoc(doc(this.col, pairId));
    }

    /** Subscribe to the last 100 messages of a friend chat. */
    watchMessages(pairId, fn) {
        const { collection, query, orderBy, limit, onSnapshot } = this.fs;
        const q = query(collection(this.col, pairId, 'messages'), orderBy('ts', 'desc'), limit(100));
        return onSnapshot(q, snap => fn(snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse()),
            e => console.warn('messages listener', e));
    }

    async send(pairId, text) {
        const { collection, doc, addDoc, updateDoc } = this.fs;
        const ts = Date.now();
        await addDoc(collection(this.col, pairId, 'messages'), { from: this.uid, text, ts });
        await updateDoc(doc(this.col, pairId), { lastMessage: text.slice(0, 80), lastMessageAt: ts }).catch(() => {});
    }

    /** Ring a friend: create a room and put the invitation on the friendship. Returns the roomId. */
    async call(pairId, friendUid) {
        const { collection, doc, setDoc, updateDoc } = this.fs;
        const roomRef = doc(collection(this.db, ...this.base, 'rooms'));
        await setDoc(roomRef, { mode: 'video', users: [this.uid, friendUid], created: Date.now(), friendship: pairId });
        await updateDoc(doc(this.col, pairId), { call: { from: this.uid, roomId: roomRef.id, ts: Date.now() } });
        return roomRef.id;
    }

    async clearCall(pairId) {
        const { doc, updateDoc } = this.fs;
        await updateDoc(doc(this.col, pairId), { call: null }).catch(() => {});
    }

    /** Incoming, still-ringing calls from friends. */
    incomingCalls() {
        const now = Date.now();
        return this.friends.filter(f => f.call && f.call.from !== this.uid && now - f.call.ts < CALL_RING_MS);
    }
}
