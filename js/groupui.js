// The Group rooms screen: pick a topic, join, see everyone, talk. See js/groups.js for how people are connected.
// app.js gives this module the few things it shares (toasts, the safety model, reporting, avatars); the rest is here.
import { GROUP_TOPICS, GROUP_MODES, HEARTBEAT_MS, MAX_GROUP_MSG, createMesh, createLocalGroups, createFirebaseGroups, groupCap } from './groups.js';
import { meterStream } from './audio-meter.js';

const $ = id => document.getElementById(id);
function h(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

export function createGroupUi(ctx) {
    const root = $('groups');
    let mode = 'voice';
    let room = null;          // { gid, topic, mode, backend, mesh, stream, tiles: Map, timers, stops: [] }

    const topics = $('groupTopics');
    function renderLobby() {
        root.querySelectorAll('[data-gmode]').forEach(b => { b.classList.toggle('active', b.dataset.gmode === mode); b.setAttribute('aria-pressed', String(b.dataset.gmode === mode)); });
        topics.replaceChildren(...GROUP_TOPICS.map(t => {
            const b = h('button', 'group-topic');
            b.type = 'button';
            b.append(h('b', '', t.name), h('span', '', `Up to ${groupCap(mode)} people`));
            b.onclick = () => join(t.id);
            return b;
        }));
    }
    root.querySelectorAll('[data-gmode]').forEach(b => { b.onclick = () => { mode = b.dataset.gmode; renderLobby(); }; });

    function show(view) {
        $('groupLobby').classList.toggle('hidden', view !== 'lobby');
        $('groupRoom').classList.toggle('hidden', view !== 'room');
    }

    // ---- tiles ----
    function addTile(id, meta, self = false) {
        const tile = h('div', 'g-tile' + (self ? ' self' : ''));
        tile.dataset.id = id;
        const media = h('div', 'g-media');
        const av = h('div', 'avatar g-avatar');
        ctx.applyAvatar(av, { avatar: meta.avatar, nick: meta.nick });
        media.appendChild(av);
        const name = h('div', 'g-name');
        name.append(h('span', '', self ? `${meta.nick} (you)` : meta.nick));
        const state = h('small', 'g-state', self ? '' : 'Connecting…');
        name.appendChild(state);
        tile.append(media, name);
        if (!self) {
            const more = h('button', 'g-more', '⋯');
            more.type = 'button';
            more.title = 'Report or block';
            more.setAttribute('aria-label', `Options for ${meta.nick}`);
            more.onclick = e => { e.stopPropagation(); openMenu(id, meta, more); };
            tile.appendChild(more);
        }
        $('groupGrid').appendChild(tile);
        const t = { tile, media, av, state, video: null, audio: null, meta, stopMeter: null, blocked: false, safety: null };
        room.tiles.set(id, t);
        return t;
    }
    function removeTile(id) {
        const t = room?.tiles.get(id);
        if (!t) return;
        t.stopMeter?.();
        clearInterval(t.safetyTimer);
        t.tile.remove();
        room.tiles.delete(id);
        updateCount();
    }
    function updateCount() { if (room) $('groupCount').textContent = `${room.tiles.size} in the room · up to ${groupCap(room.mode)}`; }

    function attachStream(id, stream) {
        const t = room?.tiles.get(id);
        if (!t || t.blocked) return;
        if (!t.audio) { t.audio = new Audio(); t.audio.autoplay = true; t.audio.srcObject = stream; t.audio.play?.().catch(() => {}); t.stopMeter = meterStream(stream, lv => t.tile.classList.toggle('speaking', lv > 0.15)); }
        if (room.mode === 'video' && stream.getVideoTracks().length && !t.video) {
            const v = h('video', 'g-video');
            v.autoplay = true; v.playsInline = true; v.muted = true; v.srcObject = stream;
            t.video = v;
            t.media.prepend(v);
            t.tile.classList.add('has-video', 'checking');
            watchVideo(id, t);
        }
    }

    // ---- safety for video rooms: every other person's video stays blurred until our on-device check clears it ----
    function watchVideo(id, t) {
        const g = ctx.getGuard();
        const st = { bad: 0, good: 0 };
        g.load().catch(() => {});
        const failOpen = setTimeout(() => { if (t.tile.classList.contains('checking') && !g.model) { t.state.textContent = 'Safety check unavailable'; addShowAnyway(t); } }, 20000);
        t.safetyTimer = setInterval(async () => {
            const r = await g.check(t.video).catch(() => null);
            if (!r || !room) return;
            if (r.explicit >= ctx.threshold) {
                st.good = 0;
                if (++st.bad >= 2) { t.tile.classList.add('hidden-video'); t.tile.classList.remove('checking'); t.state.textContent = 'Video hidden: it may contain nudity'; }
            } else {
                st.bad = 0;
                const hidden = t.tile.classList.contains('hidden-video');
                if (++st.good >= (hidden ? 3 : 1)) { t.tile.classList.remove('checking', 'hidden-video'); t.state.textContent = ''; clearTimeout(failOpen); }
            }
        }, 1800);
    }
    function addShowAnyway(t) {
        if (t.tile.querySelector('.g-show')) return;
        const b = h('button', 'btn btn-ghost btn-sm g-show', 'Show anyway');
        b.type = 'button';
        b.onclick = () => { t.tile.classList.remove('checking'); b.remove(); };
        t.tile.appendChild(b);
    }
    function watchSelf() {
        if (room.mode !== 'video') return;
        const g = ctx.getGuard();
        g.load().catch(() => {});
        let bad = 0;
        room.timers.push(setInterval(async () => {
            const vt = room.stream?.getVideoTracks()[0];
            if (!vt || !vt.enabled || !room.selfVideo) return;
            const r = await g.check(room.selfVideo).catch(() => null);
            if (!r || !room) return;
            if (r.explicit >= ctx.selfThreshold) { if (++bad >= 2) { bad = 0; setCam(false); ctx.selfViolation(); } } else bad = 0;
        }, 3000));
    }

    // ---- per-person menu ----
    let menu = null;
    function closeMenu() { menu?.remove(); menu = null; }
    document.addEventListener('click', closeMenu);
    function openMenu(id, meta, anchor) {
        closeMenu();
        menu = h('div', 'g-menu');
        const rep = h('button', '', 'Report'); rep.type = 'button';
        rep.onclick = () => { closeMenu(); ctx.reportPerson({ partnerId: id, roomId: room.gid, nick: meta.nick }); };
        const blk = h('button', '', 'Block (mute and hide)'); blk.type = 'button';
        blk.onclick = () => { closeMenu(); blockPerson(id); };
        menu.append(rep, blk);
        anchor.parentElement.appendChild(menu);
    }
    function blockPerson(id) {
        const t = room?.tiles.get(id);
        if (!t) return;
        ctx.block(id);
        t.blocked = true;
        t.audio?.pause?.();
        if (t.audio) t.audio.srcObject = null;
        t.video?.remove();
        t.stopMeter?.();
        t.tile.classList.add('blocked');
        t.state.textContent = 'Blocked';
        ctx.toast('Blocked. You won’t hear or see them, and you won’t be matched with them again.');
    }

    // ---- chat ----
    function addChat(who, text, meta) {
        const row = h('div', 'g-msg' + (who === 'me' ? ' me' : ''));
        row.append(h('b', '', who === 'me' ? 'You' : meta.nick), h('span', '', ctx.cleanText(text)));
        const list = $('groupMessages');
        list.appendChild(row);
        while (list.childElementCount > 200) list.firstElementChild.remove();
        list.scrollTop = list.scrollHeight;
    }
    $('groupForm').onsubmit = e => {
        e.preventDefault();
        if (!room) return;
        const text = $('groupInput').value.trim().slice(0, MAX_GROUP_MSG);
        if (!text) return;
        const now = Date.now();
        room.sent = (room.sent || []).filter(t => now - t < 4000);
        if (room.sent.length >= 6) { ctx.toast('Slow down a little 🙂', true); return; }
        room.sent.push(now);
        room.mesh.broadcast(text);
        addChat('me', text, room.meta);
        $('groupInput').value = '';
    };

    // ---- controls ----
    function setMic(on) { for (const t of room.stream?.getAudioTracks() || []) t.enabled = on; room.mic = on; $('gMic').classList.toggle('off', !on); $('gMic').setAttribute('aria-pressed', String(!on)); }
    function setCam(on) { for (const t of room.stream?.getVideoTracks() || []) t.enabled = on; room.cam = on; $('gCam').classList.toggle('off', !on); $('gCam').setAttribute('aria-pressed', String(!on)); }
    $('gMic').onclick = () => room && setMic(!room.mic);
    $('gCam').onclick = () => room && setCam(!room.cam);
    $('groupLeave').onclick = () => leave();
    $('groupBack').onclick = () => { if (room) leave(); else close(); };

    async function acquire(m) {
        return navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: m === 'video' ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } : false,
        });
    }

    async function join(topic) {
        if (room) return;
        const meta = { nick: ctx.nick(), avatar: ctx.avatar() };
        let stream;
        try { stream = await acquire(mode); }
        catch (e) { ctx.toast(ctx.mediaError(e, mode === 'video' ? 'video' : 'voice') + (mode === 'video' ? ' Try a voice room instead.' : ''), true); return; }
        const backend = ctx.makeBackend();
        $('groupTopics').classList.add('busy');
        let joined;
        try { joined = await backend.join({ topic, mode, meta }); }
        catch (e) {
            stream.getTracks().forEach(t => t.stop());
            backend.close?.();
            $('groupTopics').classList.remove('busy');
            ctx.toast(e?.code === 'full' ? 'That room is full right now. Try again in a moment, or pick another topic.' : e?.code === 'functions/resource-exhausted' ? 'You’re joining rooms very quickly. Try again in a little while.' : /permission-denied/.test(e?.code || '') ? (e.message || 'Couldn’t join that room.') : 'Couldn’t join that room. Try again.', true);
            return;
        }
        $('groupTopics').classList.remove('busy');
        room = { gid: joined.gid, topic, mode, backend, stream, tiles: new Map(), timers: [], stops: [], meta, mic: true, cam: true };
        $('groupTitle').textContent = `${GROUP_TOPICS.find(t => t.id === topic)?.name || topic} · ${mode === 'video' ? 'Video' : 'Voice'}`;
        $('groupMessages').replaceChildren();
        $('groupGrid').replaceChildren();
        $('gCam').classList.toggle('hidden', mode !== 'video');
        setMic(true); setCam(true);
        show('room');
        const me = addTile('self', meta, true);
        if (mode === 'video') {
            const v = h('video', 'g-video'); v.autoplay = true; v.playsInline = true; v.muted = true; v.srcObject = stream; me.media.prepend(v); me.tile.classList.add('has-video'); room.selfVideo = v;
        }
        me.stopMeter = meterStream(stream, lv => me.tile.classList.toggle('speaking', lv > 0.15 && room.mic));
        room.mesh = createMesh({
            backend, gid: joined.gid, selfId: ctx.selfId(), mode, stream, iceConfig: ctx.iceConfig,
            handlers: {
                onPeer: (id, m) => { addTile(id, { nick: ctx.nickOf(m.nick), avatar: ctx.avatarOf(m.avatar) }); updateCount(); ctx.chime(); if (mode === 'video') room.mesh.setSenderCaps(room.tiles.size > 3 ? 220000 : 350000, 1, 20); },
                onGone: id => { removeTile(id); },
                onStream: (id, s) => attachStream(id, s),
                onState: (id, st) => { const t = room?.tiles.get(id); if (t && !t.blocked) t.state.textContent = st === 'connected' ? '' : st === 'failed' ? 'Connection lost' : st === 'disconnected' ? 'Reconnecting…' : 'Connecting…'; },
                onMessage: (id, msg) => { const t = room?.tiles.get(id); if (!t || t.blocked) return; addChat('them', msg.text, t.meta); },
            },
        });
        room.stops.push(backend.watchMembers(joined.gid, list => room.mesh.setMembers(list)));
        room.timers.push(setInterval(() => backend.heartbeat(joined.gid).catch(() => {}), HEARTBEAT_MS));
        // a person who closed the tab never says goodbye: the member list drops them when their heartbeat stops
        watchSelf();
        updateCount();
        ctx.toast(`You’re in. Say hi!`);
    }

    async function leave() {
        const r = room;
        if (!r) return;
        room = null;
        r.timers.forEach(clearInterval);
        r.stops.forEach(s => s?.());
        r.mesh?.close();
        for (const t of r.tiles.values()) { t.stopMeter?.(); clearInterval(t.safetyTimer); t.audio && (t.audio.srcObject = null); }
        r.stream.getTracks().forEach(t => t.stop());
        await r.backend.leave(r.gid).catch(() => {});
        r.backend.close?.();
        closeMenu();
        show('lobby');
    }

    function open() {
        mode = 'voice';
        renderLobby();
        show('lobby');
        root.classList.remove('hidden');
    }
    async function close() {
        await leave();
        root.classList.add('hidden');
        ctx.onClose();
    }
    window.addEventListener('pagehide', () => { if (room) { room.mesh?.close(); room.backend.leave(room.gid); } });
    return { open, close, get active() { return Boolean(room); } };
}
