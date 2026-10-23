// Group rooms: up to 8 people on a voice call (up to 4 on video) around something they like, plus a text chat.
//
// How it connects: a full mesh. Every person has a direct WebRTC connection to every other person (so nothing passes through a
// server that could record it, and there is no media server to pay for); that is why video rooms are smaller. Who is in the room, and
// the connection handshakes, go through a "backend": Firestore + the joinGroup function on the live site (functions/groups.js),
// or a BroadcastChannel between tabs in the local demo.
//
// Everything a peer sends is untrusted: sizes and rates are bounded, and chat text is only ever shown with textContent.

export const GROUP_TOPICS = Object.freeze([
    ['cricket', 'Cricket'], ['music', 'Music'], ['bollywood', 'Bollywood'], ['gaming', 'Gaming'], ['movies', 'Movies'],
    ['travel', 'Travel'], ['coding', 'Coding'], ['study', 'Study'], ['anime', 'Anime'], ['fitness', 'Fitness'], ['hindi', 'Hindi baat-cheet'], ['latenight', 'Late night'],
].map(([id, name]) => Object.freeze({ id, name })));

/** cap = people in a room. Video is smaller because each person uploads a separate video to every other person. */
export const GROUP_MODES = Object.freeze({ voice: Object.freeze({ cap: 8 }), video: Object.freeze({ cap: 4 }) });
export const STALE_MS = 40000;          // someone not heard from for this long has left
export const HEARTBEAT_MS = 12000;
export const MAX_GROUP_MSG = 300;       // characters in one chat message
const MAX_WIRE_BYTES = 2048;

const TOPIC_IDS = new Set(GROUP_TOPICS.map(t => t.id));
export const groupTopicId = v => (typeof v === 'string' && TOPIC_IDS.has(v) ? v : '');
export const groupModeOk = v => typeof v === 'string' && Object.hasOwn(GROUP_MODES, v);
export const groupCap = mode => (groupModeOk(mode) ? GROUP_MODES[mode].cap : 0);

/** A chat message from a peer, or null: { t: 'gmsg', text } with plain text only. */
export function parseGroupMessage(raw) {
    let msg = raw;
    if (typeof raw === 'string') {
        if (raw.length > MAX_WIRE_BYTES) return null;
        try { msg = JSON.parse(raw); } catch { return null; }
    }
    if (!msg || typeof msg !== 'object' || msg.t !== 'gmsg' || typeof msg.text !== 'string') return null;
    const text = msg.text.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, MAX_GROUP_MSG);
    return text ? { text } : null;
}

/** Whose turn it is to make the offer for a pair: the lower id. */
export const isInitiator = (me, other) => me < other;

/** Members that are still around (heard from recently), without ourselves, newest information wins. */
export function freshMembers(list, now, selfId) {
    const out = new Map();
    for (const m of Array.isArray(list) ? list : []) {
        if (!m || typeof m.id !== 'string' || m.id === selfId) continue;
        if (typeof m.ts === 'number' && now - m.ts > STALE_MS) continue;
        out.set(m.id, m);
    }
    return [...out.values()];
}

// ---------------------------------------------------------------------------------------------------------------------
// The mesh: one RTCPeerConnection (and one data channel for chat) per other person.
// ---------------------------------------------------------------------------------------------------------------------
export function createMesh({ backend, gid, selfId, mode, stream, iceConfig, handlers = {}, makePc = cfg => new RTCPeerConnection(cfg) }) {
    const peers = new Map();       // id -> { pc, dc, meta, initiator, queued: [], tokens, at }
    const early = new Map();       // id -> signals that arrived before we knew who they are
    let closed = false;
    const send = (to, type, data) => backend.signal(gid, to, type, data ?? null).catch(() => {});

    function takeToken(p) {
        const now = Date.now();
        p.tokens = Math.min(20, (p.tokens ?? 20) + (now - (p.at ?? now)) / 100);
        p.at = now;
        if (p.tokens < 1) return false;
        p.tokens -= 1;
        return true;
    }

    function addPeer(meta) {
        const id = meta.id;
        if (closed || peers.has(id)) return;
        const pc = makePc(iceConfig());
        const p = { pc, dc: null, meta, initiator: isInitiator(selfId, id), queued: [], tokens: 20, at: Date.now(), restarts: 0 };
        peers.set(id, p);
        for (const t of stream?.getTracks?.() || []) if (t.kind === 'audio' || (t.kind === 'video' && mode === 'video')) pc.addTrack(t, stream);
        const remote = new MediaStream();
        pc.ontrack = e => { if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track); handlers.onStream?.(id, remote); };
        pc.onicecandidate = e => { if (e.candidate) send(id, 'candidate', e.candidate.toJSON()); };
        pc.onconnectionstatechange = () => {
            if (closed || !peers.has(id)) return;
            handlers.onState?.(id, pc.connectionState);
            if (pc.connectionState === 'failed' && p.initiator && p.restarts < 2) { p.restarts++; p.restarting = true; try { pc.restartIce(); } catch { p.restarting = false; } }
        };
        pc.onnegotiationneeded = async () => {
            if (!p.restarting || closed) return;
            p.restarting = false;
            try { if (pc.signalingState !== 'stable') return; const o = await pc.createOffer({ iceRestart: true }); await pc.setLocalDescription(o); send(id, 'offer', { type: o.type, sdp: o.sdp }); } catch { /* the next failure will try again */ }
        };
        const attach = dc => {
            p.dc = dc;
            dc.onopen = () => handlers.onOpen?.(id);
            dc.onmessage = e => {
                if (closed || typeof e.data !== 'string' || e.data.length > MAX_WIRE_BYTES || !takeToken(p)) return;
                const msg = parseGroupMessage(e.data);
                if (msg) handlers.onMessage?.(id, msg, p.meta);
            };
        };
        if (p.initiator) {
            attach(pc.createDataChannel('chat', { ordered: true }));
            (async () => { try { const o = await pc.createOffer(); await pc.setLocalDescription(o); send(id, 'offer', { type: o.type, sdp: o.sdp }); } catch { handlers.onState?.(id, 'failed'); } })();
        } else {
            pc.ondatachannel = e => { if (p.dc || e.channel.label !== 'chat') { e.channel.close(); return; } attach(e.channel); };
        }
        handlers.onPeer?.(id, meta);
        for (const s of early.get(id) || []) onSignal(s);
        early.delete(id);
    }

    function dropPeer(id) {
        const p = peers.get(id);
        if (!p) return;
        peers.delete(id);
        try { p.dc?.close(); } catch { /* gone */ }
        try { p.pc.close(); } catch { /* gone */ }
        handlers.onGone?.(id);
    }

    async function onSignal({ from, type, data }) {
        if (closed || typeof from !== 'string') return;
        const p = peers.get(from);
        if (!p) {
            // We haven't seen them in the member list yet: keep a few signals for a moment.
            const q = early.get(from) || [];
            if (q.length < 30) { q.push({ from, type, data }); early.set(from, q); setTimeout(() => early.delete(from), 15000); }
            return;
        }
        const { pc } = p;
        try {
            if (type === 'offer' && !p.initiator) {
                await pc.setRemoteDescription(data);
                for (const c of p.queued.splice(0)) await pc.addIceCandidate(c).catch(() => {});
                const a = await pc.createAnswer();
                await pc.setLocalDescription(a);
                send(from, 'answer', { type: a.type, sdp: a.sdp });
            } else if (type === 'answer' && p.initiator && pc.signalingState === 'have-local-offer') {
                await pc.setRemoteDescription(data);
                for (const c of p.queued.splice(0)) await pc.addIceCandidate(c).catch(() => {});
            } else if (type === 'candidate') {
                if (pc.remoteDescription) await pc.addIceCandidate(data).catch(() => {});
                else if (p.queued.length < 60) p.queued.push(data);
            } else if (type === 'bye') {
                dropPeer(from);
            }
        } catch (e) { console.warn('group signal', type, e); }
    }

    const stopSignals = backend.watchSignals(gid, onSignal);
    return {
        peers,
        /** Called with the member list each time it changes: connect to newcomers, drop the people who left. */
        setMembers(list) {
            if (closed) return;
            const now = Date.now();
            const fresh = freshMembers(list, now, selfId);
            const ids = new Set(fresh.map(m => m.id));
            for (const m of fresh) addPeer(m);
            for (const id of [...peers.keys()]) if (!ids.has(id)) dropPeer(id);
        },
        /** Chat message to everyone currently connected. Returns how many it reached. */
        broadcast(text) {
            const wire = JSON.stringify({ t: 'gmsg', text });
            let n = 0;
            for (const p of peers.values()) if (p.dc?.readyState === 'open') { try { p.dc.send(wire); n++; } catch { /* closing */ } }
            return n;
        },
        /** Swap the local video/audio track on every connection (camera on or off keeps the connection). */
        setSenderCaps(maxBitrate, scale, fps) {
            for (const p of peers.values()) {
                const s = p.pc.getSenders().find(x => x.track?.kind === 'video');
                if (!s) continue;
                try { const params = s.getParameters(); if (!params.encodings?.length) params.encodings = [{}]; Object.assign(params.encodings[0], { maxBitrate, scaleResolutionDownBy: scale, maxFramerate: fps }); s.setParameters(params).catch(() => {}); } catch { /* not supported */ }
            }
        },
        close() {
            if (closed) return;
            for (const id of peers.keys()) send(id, 'bye');
            closed = true;
            stopSignals?.();
            for (const id of [...peers.keys()]) dropPeer(id);
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Backends. Both expose: join, watchMembers, watchSignals, signal, heartbeat, leave.
// ---------------------------------------------------------------------------------------------------------------------

/** Between tabs of one browser (the local demo, and the tests). */
export function createLocalGroups(selfId) {
    const ch = new BroadcastChannel('anon-groups');
    const rooms = new Map();            // gid -> Map(id -> member)
    const memberWatchers = new Map();   // gid -> Set(fn)
    const signalWatchers = new Map();   // gid -> Set(fn)
    let timer = 0;
    let mine = null;                    // { gid, member }
    const held = [];                    // handshakes that arrived before the mesh was listening

    const list = gid => [...(rooms.get(gid)?.values() || [])];
    const notify = gid => { for (const fn of memberWatchers.get(gid) || []) fn(list(gid)); };
    const post = msg => ch.postMessage({ ...msg, from: selfId });
    ch.onmessage = ({ data: m }) => {
        if (m.from === selfId) return;
        if (m.k === 'here') {
            const r = rooms.get(m.gid) || new Map(); rooms.set(m.gid, r);
            r.set(m.member.id, { ...m.member, ts: Date.now() });
            for (const [id, x] of r) if (Date.now() - x.ts > STALE_MS) r.delete(id);
            notify(m.gid);
            if (m.reply && mine?.gid === m.gid) post({ k: 'here', gid: m.gid, member: mine.member });
        } else if (m.k === 'bye') {
            rooms.get(m.gid)?.delete(m.id); notify(m.gid);
        } else if (m.k === 'sig' && m.to === selfId) {
            const watchers = signalWatchers.get(m.gid);
            if (watchers?.size) for (const fn of watchers) fn({ from: m.from, type: m.type, data: m.data });
            else { held.push({ gid: m.gid, s: { from: m.from, type: m.type, data: m.data }, at: Date.now() }); } // not listening yet: keep it for a moment
        } else if (m.k === 'peek') {
            // someone is asking who is in a room: answer if we are in it (they are not a member yet)
            if (mine?.gid === m.gid) post({ k: 'here', gid: m.gid, member: mine.member });
        }
    };

    return {
        kind: 'local',
        async join({ topic, mode, meta }) {
            if (!groupTopicId(topic) || !groupModeOk(mode)) throw Object.assign(new Error('bad room'), { code: 'invalid' });
            const gid = `local-${topic}-${mode}`;
            // learn who is already there (they answer our hello), then check the room has space
            rooms.set(gid, new Map());
            const member = { ...meta, id: selfId };
            post({ k: 'peek', gid });          // ask who is there without announcing ourselves yet
            await new Promise(r => setTimeout(r, 350));
            const others = list(gid).filter(m => m.id !== selfId && Date.now() - m.ts < STALE_MS);
            if (others.length >= groupCap(mode)) throw Object.assign(new Error('That room is full.'), { code: 'full' });
            mine = { gid, member };
            rooms.get(gid).set(selfId, { ...member, ts: Date.now() });
            clearInterval(timer);
            timer = setInterval(() => post({ k: 'here', gid, member }), 3000);
            post({ k: 'here', gid, member });
            return { gid, cap: groupCap(mode) };
        },
        async joinLive() { throw Object.assign(new Error('Live sessions are available on the online version of the site.'), { code: 'online-only' }); },
        watchSession() { return () => {}; },
        watchEvents() { return () => {}; },
        async call() { throw Object.assign(new Error('Live sessions are available on the online version of the site.'), { code: 'online-only' }); },
        watchMembers(gid, fn) { const s = memberWatchers.get(gid) || new Set(); s.add(fn); memberWatchers.set(gid, s); fn(list(gid)); return () => s.delete(fn); },
        watchSignals(gid, fn) {
            const s = signalWatchers.get(gid) || new Set(); s.add(fn); signalWatchers.set(gid, s);
            for (const x of held.splice(0)) { if (x.gid === gid && Date.now() - x.at < 10000) fn(x.s); }
            return () => s.delete(fn);
        },
        async signal(gid, to, type, data) { post({ k: 'sig', gid, to, type, data }); },
        async heartbeat() {},
        async leave(gid) { clearInterval(timer); post({ k: 'bye', gid, id: selfId }); rooms.delete(gid); mine = null; },
        close() { clearInterval(timer); ch.close(); },
    };
}

/** The live site: the joinGroup function picks (or opens) a room with space and adds us as a member; the rest is Firestore. */
export function createFirebaseGroups(transport, { callable, region }) {
    const { fs, db, base } = transport.fb;
    const col = (gid, name) => fs.collection(db, ...base, 'groups', gid, name);
    let beat = 0;
    return {
        kind: 'firebase',
        async join({ topic, mode, meta }) {
            const fn = await callable(transport, 'joinGroup', region);
            const { data } = await fn({ topic, mode, nick: meta.nick, avatar: meta.avatar });
            return { gid: data.gid, cap: data.cap };
        },
        /** Live sessions (functions/live.js): the server charges a private session's fee and adds us as a member. */
        async joinLive({ sid, meta }) {
            const fn = await callable(transport, 'joinLive', region);
            const { data } = await fn({ sid, nick: meta.nick, avatar: meta.avatar });
            return { gid: data.gid, cap: data.cap, host: data.host === true, kind: data.kind, title: data.title, charged: data.charged || 0, hostUid: data.hostUid };
        },
        /** The session document (status 'live' or 'ended'): null when it is gone. */
        watchSession(gid, fn) {
            return fs.onSnapshot(fs.doc(db, ...base, 'groups', gid), snap => fn(snap.exists() ? snap.data() : null), e => console.warn('live session', e));
        },
        /** Gifts sent to the host, one call per new gift. */
        watchEvents(gid, fn) {
            return fs.onSnapshot(col(gid, 'events'), snap => snap.docChanges().forEach(c => { if (c.type === 'added') fn(c.doc.data()); }), e => console.warn('live events', e));
        },
        /** Any live-session function by name (sendLiveGift, endLive, kickLive, listLive, myHost...). */
        async call(name, data) {
            const fn = await callable(transport, name, region);
            return (await fn(data || {})).data;
        },
        watchMembers(gid, fn) {
            return fs.onSnapshot(col(gid, 'members'), snap => fn(snap.docs.map(d => ({ id: d.id, ...d.data() }))), e => console.warn('group members', e));
        },
        watchSignals(gid, fn) {
            const q = fs.query(col(gid, 'signals'), fs.where('to', '==', transport.uid));
            return fs.onSnapshot(q, snap => snap.docChanges().forEach(c => { if (c.type === 'added') { const d = c.doc.data(); fn({ from: d.from, type: d.type, data: d.data ?? null }); fs.deleteDoc(c.doc.ref).catch(() => {}); } }), e => console.warn('group signals', e));
        },
        async signal(gid, to, type, data) {
            await fs.addDoc(col(gid, 'signals'), { from: transport.uid, to, type, data: data ?? null, ts: Date.now() });
        },
        async heartbeat(gid) { await fs.updateDoc(fs.doc(db, ...base, 'groups', gid, 'members', transport.uid), { ts: Date.now() }); },
        async leave(gid) { clearInterval(beat); await fs.deleteDoc(fs.doc(db, ...base, 'groups', gid, 'members', transport.uid)).catch(() => {}); },
        close() { clearInterval(beat); },
    };
}
