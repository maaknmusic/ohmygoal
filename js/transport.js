// =====================================================================
// Transports: matchmaking + WebRTC signaling + online presence.
// - Firebase (production): Firestore queue with transactional claiming.
// - Local demo: BroadcastChannel between tabs of one browser.
// Chat itself goes over a WebRTC data channel and is never stored.
// =====================================================================

const QUEUE_STALE_MS = 30000;
const PRESENCE_BEAT_MS = 30000;
const PRESENCE_WINDOW_MS = 75000;

/**
 * Both people's filters must accept each other.
 * profile = { gender: 'male'|'female'|'x', country: 'IN'|'', genderFilter: 'any'|'male'|'female', countryFilter: 'any'|'IN'|... }
 */
export function compatible(me = {}, them = {}) {
    const ok = (filter, value) => !filter || filter === 'any' || filter === value;
    return ok(me.genderFilter, them.gender) && ok(them.genderFilter, me.gender)
        && ok(me.countryFilter, them.country) && ok(them.countryFilter, me.country);
}

const profileFields = p => ({
    gender: p?.gender || 'x',
    country: p?.country || '',
    genderFilter: p?.genderFilter || 'any',
    countryFilter: p?.countryFilter || 'any',
});

export async function createFirebaseTransport({ firebaseConfig, appId, initialAuthToken, emulators }) {
    const v = '11.6.1';
    const [appMod, authMod, fs] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${v}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore.js`),
    ]);
    const { getAuth, signInAnonymously, signInWithCustomToken } = authMod;
    const { getFirestore, collection, doc, setDoc, getDocs, query, where, limit, runTransaction,
        onSnapshot, deleteDoc, addDoc, updateDoc, serverTimestamp, getCountFromServer } = fs;

    const app = appMod.initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    if (emulators) { // local testing only
        authMod.connectAuthEmulator(auth, emulators.auth, { disableWarnings: true });
        fs.connectFirestoreEmulator(db, ...emulators.firestore);
    }
    await auth.authStateReady();
    if (!auth.currentUser) {
        if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);
        else await signInAnonymously(auth);
    }
    // Always read the current user: signing in with Google can change it mid-session.
    const me = () => auth.currentUser?.uid;

    const base = ['artifacts', appId, 'public', 'data'];
    const queueCol = collection(db, ...base, 'queue');
    const roomsCol = collection(db, ...base, 'rooms');
    const reportsCol = collection(db, ...base, 'reports');
    const presenceCol = collection(db, ...base, 'presence');
    const myQueueRef = () => doc(queueCol, me());
    const myPresenceRef = () => doc(presenceCol, me());

    function roomBus(roomId) {
        const sigCol = collection(db, ...base, 'rooms', roomId, 'signals');
        const handlers = [];
        const mine = [];
        let closed = false;
        const unsub = onSnapshot(sigCol, snap => {
            snap.docChanges().forEach(ch => {
                if (ch.type !== 'added') return;
                const d = ch.doc.data();
                if (d.from !== me()) handlers.forEach(fn => fn(d));
            });
        }, err => console.warn('signal listener error', err));
        return {
            send(type, data) {
                if (closed) return;
                addDoc(sigCol, { from: me(), type, data: data ?? null, ts: Date.now() })
                    .then(ref => mine.push(ref)).catch(e => console.warn('signal send failed', e));
            },
            onMessage(fn) { handlers.push(fn); },
            close() {
                if (closed) return;
                closed = true;
                unsub();
                // Give the final "bye" time to be delivered, then remove our signaling docs.
                setTimeout(() => mine.forEach(ref => deleteDoc(ref).catch(() => {})), 4000);
            },
        };
    }

    async function tryClaim({ mode, interests, blocked, profile }) {
        const snap = await getDocs(query(queueCol, where('mode', '==', mode), limit(50)));
        const now = Date.now();
        const shared = d => (d.interests || []).filter(i => interests.includes(i)).length;
        const candidates = snap.docs
            .filter(d => {
                const x = d.data();
                return d.id !== me() && !x.roomId && now - (x.ts || 0) < QUEUE_STALE_MS
                    && !blocked.includes(d.id) && !(x.blocked || []).includes(me())
                    && compatible(profile, x);
            })
            .sort((a, b) => shared(b.data()) - shared(a.data()) || a.data().ts - b.data().ts);

        const queueRef = myQueueRef();
        const uid = me();
        for (const cand of candidates) {
            const roomRef = doc(roomsCol);
            try {
                const ok = await runTransaction(db, async t => {
                    const theirs = await t.get(cand.ref);
                    const mine = await t.get(queueRef);
                    if (!theirs.exists() || theirs.data().roomId) return false;
                    if (mine.exists() && mine.data().roomId) return false; // someone already claimed us
                    t.update(cand.ref, { roomId: roomRef.id, partnerId: uid });
                    t.set(roomRef, { mode, users: [cand.id, uid], created: serverTimestamp() });
                    if (mine.exists()) t.delete(queueRef);
                    return true;
                });
                if (ok) return { roomId: roomRef.id, role: 'offerer', partnerId: cand.id, bus: roomBus(roomRef.id) };
            } catch (e) {
                console.warn('claim failed', e);
            }
        }
        return null;
    }

    async function findMatch(opts, signal) {
        const first = await tryClaim(opts);
        if (first) return first;
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');

        const queueRef = myQueueRef();
        await setDoc(queueRef, {
            mode: opts.mode, interests: opts.interests, blocked: opts.blocked.slice(-100),
            ...profileFields(opts.profile), ts: Date.now(), roomId: null,
        });

        return new Promise((resolve, reject) => {
            let done = false;
            let claiming = false;
            const finish = (value, error) => {
                if (done) return;
                done = true;
                unsub();
                clearInterval(heartbeat);
                clearInterval(retry);
                signal.removeEventListener('abort', onAbort);
                error ? reject(error) : resolve(value);
            };
            const unsub = onSnapshot(queueRef, snap => {
                const x = snap.data();
                if (x?.roomId) {
                    deleteDoc(queueRef).catch(() => {});
                    finish({ roomId: x.roomId, role: 'answerer', partnerId: x.partnerId, bus: roomBus(x.roomId) });
                }
            });
            const heartbeat = setInterval(() => updateDoc(queueRef, { ts: Date.now() }).catch(() => {}), 10000);
            // Keep trying to claim others too, so two people who enqueue at the same moment still meet.
            const retry = setInterval(async () => {
                if (claiming || done) return;
                claiming = true;
                try {
                    const m = await tryClaim(opts);
                    if (m) { if (done) m.bus.close(); else finish(m); }
                } finally { claiming = false; }
            }, 4000 + Math.random() * 2000);
            const onAbort = () => {
                deleteDoc(queueRef).catch(() => {});
                finish(null, new DOMException('aborted', 'AbortError'));
            };
            signal.addEventListener('abort', onAbort);
        });
    }

    async function report({ partnerId, roomId, reason }) {
        await addDoc(reportsCol, { reporter: me(), reported: partnerId, roomId, reason, ts: serverTimestamp() });
    }

    // Presence: every open page refreshes a tiny doc; "online" = refreshed within the window.
    const beat = () => { if (me() && document.visibilityState !== 'hidden') setDoc(myPresenceRef(), { ts: Date.now() }).catch(() => {}); };
    beat();
    setInterval(beat, PRESENCE_BEAT_MS);
    document.addEventListener('visibilitychange', beat);
    async function onlineCount() {
        const snap = await getCountFromServer(query(presenceCol, where('ts', '>', Date.now() - PRESENCE_WINDOW_MS)));
        return snap.data().count;
    }

    function leave() {
        deleteDoc(myQueueRef()).catch(() => {});
        deleteDoc(myPresenceRef()).catch(() => {});
    }

    return {
        kind: 'firebase', get uid() { return me(); }, findMatch, report, onlineCount, leave, roomBus, beat,
        fb: { app, auth, db, fs, authMod, base },
    };
}

export function createLocalTransport() {
    const uid = 'local-' + crypto.randomUUID().slice(0, 8);
    const lobby = new BroadcastChannel('anon-connect-lobby');
    const post = msg => lobby.postMessage({ ...msg, from: uid });
    let search = null;

    function roomBus(roomId) {
        const ch = new BroadcastChannel('anon-connect-room-' + roomId);
        const handlers = [];
        let closed = false;
        ch.onmessage = ({ data }) => { if (data.from !== uid) handlers.forEach(fn => fn(data)); };
        return {
            send(type, data) { if (!closed) ch.postMessage({ from: uid, type, data: data ?? null }); },
            onMessage(fn) { handlers.push(fn); },
            close() { closed = true; ch.close(); },
        };
    }

    // Handshake: lower id proposes -> higher id accepts -> proposer confirms.
    lobby.onmessage = ({ data: m }) => {
        if (m.k === 'ping') { peers.set(m.from, Date.now()); return; }
        const s = search;
        if (!s || m.from === uid || (m.to && m.to !== uid)) return;
        switch (m.k) {
            case 'here':
                if (m.mode !== s.mode || s.pending || s.awaiting) return;
                if (s.blocked.includes(m.from) || (m.blocked || []).includes(uid)) return;
                if (!compatible(s.profile, m.profile)) return;
                if (uid < m.from) {
                    const roomId = crypto.randomUUID();
                    s.pending = { to: m.from, roomId };
                    post({ k: 'propose', to: m.from, roomId });
                    setTimeout(() => { if (s.pending?.roomId === roomId) s.pending = null; }, 1500);
                }
                break;
            case 'propose':
                if (s.pending || s.awaiting) { post({ k: 'decline', to: m.from, roomId: m.roomId }); return; }
                s.awaiting = { roomId: m.roomId, bus: roomBus(m.roomId) };
                post({ k: 'accept', to: m.from, roomId: m.roomId });
                setTimeout(() => {
                    if (search === s && s.awaiting?.roomId === m.roomId) { s.awaiting.bus.close(); s.awaiting = null; }
                }, 2000);
                break;
            case 'accept':
                if (s.pending?.roomId === m.roomId) {
                    post({ k: 'confirm', to: m.from, roomId: m.roomId });
                    s.finish({ roomId: m.roomId, role: 'offerer', partnerId: m.from, bus: roomBus(m.roomId) });
                } else {
                    post({ k: 'decline', to: m.from, roomId: m.roomId });
                }
                break;
            case 'confirm':
                if (s.awaiting?.roomId === m.roomId) {
                    const bus = s.awaiting.bus;
                    s.awaiting = null;
                    s.finish({ roomId: m.roomId, role: 'answerer', partnerId: m.from, bus });
                }
                break;
            case 'decline':
                if (s.awaiting?.roomId === m.roomId) { s.awaiting.bus.close(); s.awaiting = null; }
                if (s.pending?.roomId === m.roomId) s.pending = null;
                break;
        }
    };

    function findMatch({ mode, blocked, profile }, signal) {
        return new Promise((resolve, reject) => {
            const s = { mode, blocked, profile: profileFields(profile), pending: null, awaiting: null };
            const announce = () => post({ k: 'here', mode, blocked, profile: s.profile });
            const timer = setInterval(announce, 700);
            announce();
            const end = () => { clearInterval(timer); if (search === s) search = null; signal.removeEventListener('abort', onAbort); };
            s.finish = value => { end(); resolve(value); };
            const onAbort = () => { s.awaiting?.bus.close(); end(); reject(new DOMException('aborted', 'AbortError')); };
            signal.addEventListener('abort', onAbort);
            search = s;
        });
    }

    // Presence between local tabs.
    const peers = new Map();
    setInterval(() => post({ k: 'ping' }), 3000);
    post({ k: 'ping' });
    async function onlineCount() {
        const now = Date.now();
        for (const [id, ts] of peers) if (now - ts > 8000) peers.delete(id);
        return peers.size + 1;
    }

    async function report(payload) { console.info('[demo] report', payload); }

    return { kind: 'local', uid, findMatch, report, onlineCount, leave() {}, roomBus };
}
