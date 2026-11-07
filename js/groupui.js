// The Group rooms screen: pick a topic, join, see everyone, talk. See js/groups.js for how people are connected.
// app.js gives this module the few things it shares (toasts, the safety model, reporting, avatars); the rest is here.
import { GROUP_TOPICS, GROUP_MODES, HEARTBEAT_MS, MAX_GROUP_MSG, createMesh, createLocalGroups, createFirebaseGroups, groupCap } from './groups.js';
import { meterStream } from './audio-meter.js';
import { GIFTS, giftById, stickerURL } from './stickers.js';
import { createLiveUi } from './liveui.js';

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

    // ---- the lobby has two tabs: topic rooms (as before) and live sessions with hosts ----
    let live = null;
    function lobbyTab(which) {
        root.querySelectorAll('[data-gtab]').forEach(b => { b.classList.toggle('active', b.dataset.gtab === which); b.setAttribute('aria-pressed', String(b.dataset.gtab === which)); });
        $('groupTopicsPane').classList.toggle('hidden', which !== 'topics');
        $('livePane').classList.toggle('hidden', which !== 'live');
        if (which === 'live') (live ||= createLiveUi({ pane: $('livePane'), ctx, enter: s => joinLiveSession(s) })).open();
        else live?.pause();
    }
    root.querySelectorAll('[data-gtab]').forEach(b => { b.onclick = () => lobbyTab(b.dataset.gtab); });

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
        if (meta.host) name.append(h('span', 'g-host', 'Host'));
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
        if (room.live && ctx.giftCoins) {
            const gc = h('button', '', 'Gift coins…'); gc.type = 'button';
            gc.onclick = () => { closeMenu(); ctx.giftCoins({ to: id, name: meta.nick, sid: room.live.sid }); };
            menu.append(gc);
        }
        if (room.live?.host) {
            const kick = h('button', '', 'Remove from session'); kick.type = 'button';
            kick.onclick = async () => {
                closeMenu();
                if (!confirm(`Remove ${meta.nick} from this session? They can’t come back.`)) return;
                try { await room.backend.call('kickLive', { sid: room.live.sid, uid: id }); ctx.toast(`${meta.nick} was removed.`); } catch (e) { ctx.toast(e.message || 'That didn’t work.', true); }
            };
            menu.append(kick);
        }
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
    // a host who leaves ends the session (nobody should be left in a room without its host)
    $('groupLeave').onclick = () => { if (room?.live?.host) $('gEnd').click(); else leave(); };
    $('groupBack').onclick = () => { if (room?.live?.host) $('gEnd').click(); else if (room) leave(); else close(); };

    async function acquire(m) {
        return navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: m === 'video' ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } : false,
        });
    }

    function joinErrorText(e, isLive) {
        const c = e?.code || '';
        if (c === 'full') return 'That room is full right now. Try again in a moment, or pick another topic.';
        if (c === 'online-only') return e.message;
        if (isLive) {
            if (/not-found/.test(c)) return 'That session is not open any more.';
            if (/failed-precondition|permission-denied|resource-exhausted|invalid-argument/.test(c) && e.message) return e.message;
            return 'Couldn’t join that session. Try again.';
        }
        if (c === 'functions/resource-exhausted') return 'You’re joining rooms very quickly. Try again in a little while.';
        if (/permission-denied/.test(c)) return e.message || 'Couldn’t join that room.';
        return 'Couldn’t join that room. Try again.';
    }

    /** Opens the camera or microphone, asks the backend to let us in (`run`), and builds the room. Used for topic rooms and live sessions. */
    async function joinRoom({ mode: m, topic = null, liveInfo = null, run }) {
        if (room) return;
        const meta = { nick: ctx.nick(), avatar: ctx.avatar() };
        let stream;
        try { stream = await acquire(m); }
        catch (e) { ctx.toast(ctx.mediaError(e, m === 'video' ? 'video' : 'voice') + (m === 'video' ? ' Try a voice room instead.' : ''), true); return; }
        const backend = ctx.makeBackend();
        const busyBox = liveInfo ? $('livePane') : $('groupTopics');
        busyBox.classList.add('busy');
        let joined;
        try { joined = await run(backend, meta); }
        catch (e) {
            stream.getTracks().forEach(t => t.stop());
            backend.close?.();
            busyBox.classList.remove('busy');
            ctx.toast(joinErrorText(e, Boolean(liveInfo)), true);
            return;
        }
        busyBox.classList.remove('busy');
        room = { gid: joined.gid, topic, mode: m, backend, stream, tiles: new Map(), timers: [], stops: [], meta, mic: true, cam: true, live: null };
        $('groupTitle').textContent = joined.title ? `${joined.title} · ${m === 'video' ? 'Video' : 'Voice'}` : `${GROUP_TOPICS.find(t => t.id === topic)?.name || topic} · ${m === 'video' ? 'Video' : 'Voice'}`;
        $('groupMessages').replaceChildren();
        $('groupGrid').replaceChildren();
        $('gGiftPop').classList.add('hidden');
        $('gCam').classList.toggle('hidden', m !== 'video');
        setMic(true); setCam(true);
        show('room');
        const me = addTile('self', { ...meta, host: Boolean(liveInfo && joined.host) }, true);
        if (m === 'video') {
            const v = h('video', 'g-video'); v.autoplay = true; v.playsInline = true; v.muted = true; v.srcObject = stream; me.media.prepend(v); me.tile.classList.add('has-video'); room.selfVideo = v;
        }
        me.stopMeter = meterStream(stream, lv => me.tile.classList.toggle('speaking', lv > 0.15 && room.mic));
        room.mesh = createMesh({
            backend, gid: joined.gid, selfId: ctx.selfId(), mode: m, stream, iceConfig: ctx.iceConfig,
            handlers: {
                onPeer: (id, mm) => { addTile(id, { nick: ctx.nickOf(mm.nick), avatar: ctx.avatarOf(mm.avatar), host: mm.host === true }); updateCount(); ctx.chime(); if (m === 'video') room.mesh.setSenderCaps(room.tiles.size > 3 ? 220000 : 350000, 1, 20); },
                onGone: id => { removeTile(id); },
                onStream: (id, st) => attachStream(id, st),
                onState: (id, st) => { const t = room?.tiles.get(id); if (t && !t.blocked) t.state.textContent = st === 'connected' ? '' : st === 'failed' ? 'Connection lost' : st === 'disconnected' ? 'Reconnecting…' : 'Connecting…'; },
                onMessage: (id, msg) => { const t = room?.tiles.get(id); if (!t || t.blocked) return; addChat('them', msg.text, t.meta); },
            },
        });
        room.stops.push(backend.watchMembers(joined.gid, list => room.mesh.setMembers(list)));
        room.timers.push(setInterval(() => backend.heartbeat(joined.gid).catch(() => {}), HEARTBEAT_MS));
        // a person who closed the tab never says goodbye: the member list drops them when their heartbeat stops
        watchSelf();
        updateCount();
        if (liveInfo) startLiveRoom(joined);
        else ctx.toast(`You’re in. Say hi!`);
    }

    function join(topic) { return joinRoom({ mode, topic, run: (backend, meta) => backend.join({ topic, mode, meta }) }); }

    // ---- live sessions: a host, gifts, and the host can end the room ----
    function joinLiveSession(s) {
        return joinRoom({ mode: s.mode, liveInfo: s, run: (backend, meta) => backend.joinLive({ sid: s.sid, meta }) });
    }

    function startLiveRoom(joined) {
        const sid = joined.gid;
        room.live = { sid, host: joined.host, title: joined.title, kind: joined.kind, startedAt: Date.now() };
        $('gGift').classList.toggle('hidden', joined.host);
        $('gEnd').classList.toggle('hidden', !joined.host);
        $('groupCount').dataset.live = joined.kind;
        room.stops.push(room.backend.watchSession(sid, g => { if (room?.live?.sid === sid && (!g || g.status !== 'live')) { ctx.toast(joined.host ? 'Your session has ended.' : 'The host ended this session.'); leave(); } }));
        room.stops.push(room.backend.watchEvents(sid, ev => onGift(ev)));
        if (joined.charged) { ctx.toast(`${joined.charged} coins paid for this private session.`); }
        ctx.coins?.refresh();
        ctx.toast(joined.host ? 'You’re live. Say hi!' : 'You’re in. Say hi!');
    }

    function addSystem(text) {
        const row = h('div', 'g-msg g-sys');
        row.append(h('span', '', text));
        const list = $('groupMessages');
        list.appendChild(row);
        while (list.childElementCount > 200) list.firstElementChild.remove();
        list.scrollTop = list.scrollHeight;
    }
    function onGift(ev) {
        if (room?.live && ev && ev.kind === 'coins' && Number.isInteger(ev.amount) && ev.amount > 0 && ev.amount <= 500 && (typeof ev.at !== 'number' || ev.at >= room.live.startedAt - 3000)) {
            const from = typeof ev.nick === 'string' ? ev.nick.slice(0, 20) : 'Someone', to = typeof ev.toNick === 'string' ? ev.toNick.slice(0, 20) : 'someone';
            addSystem(`${from} sent ${ev.amount} coins to ${to}`);
            ctx.chime();
            return;
        }
        if (!room?.live || !ev || ev.kind !== 'gift') return;
        if (typeof ev.at === 'number' && ev.at < room.live.startedAt - 3000) return;   // gifts from before we came in
        const g = giftById(ev.gift);
        if (!g) return;
        const who = typeof ev.nick === 'string' ? ev.nick.slice(0, 20) : 'Someone';
        addSystem(`${who} sent a ${g.label}`);
        const fx = new Image();
        fx.className = 'g-fx'; fx.alt = ''; fx.src = stickerURL(g.id);
        fx.style.left = `${20 + Math.random() * 60}%`;
        $('groupRoom').appendChild(fx);
        fx.addEventListener('animationend', () => fx.remove());
        ctx.chime();
    }
    function renderGiftPop() {
        $('gGiftGrid').replaceChildren(...GIFTS.map(g => {
            const b = h('button', 'sticker-item');
            b.type = 'button';
            b.title = `${g.label} · ${g.coins} coins`;
            b.setAttribute('aria-label', b.title);
            const img = new Image(); img.src = stickerURL(g.id); img.alt = ''; img.draggable = false;
            b.append(img, h('small', '', String(g.coins)));
            b.onclick = () => sendRoomGift(g.id);
            return b;
        }));
        $('gGiftCoins').textContent = ctx.coins?.get() == null ? '…' : String(ctx.coins.get());
    }
    async function sendRoomGift(id) {
        const g = giftById(id);
        if (!g || !room?.live || room.live.host) return;
        if (!ctx.signedIn() && !(await ctx.signIn())) return;
        try {
            const r = await room.backend.call('sendLiveGift', { sid: room.live.sid, gift: id, nick: room.meta.nick });
            ctx.coins?.set(r.coins);
            $('gGiftCoins').textContent = String(r.coins);
            $('gGiftPop').classList.add('hidden');
        } catch (e) {
            if (/failed-precondition/.test(e.code || '') && /coins/i.test(e.message || '')) { ctx.toast('You need more coins for that gift.', true); ctx.coins?.openShop(); }
            else ctx.toast(e.code === 'functions/resource-exhausted' ? 'That’s a lot of gifts for one hour. Try again later.' : e.code === 'functions/failed-precondition' ? 'That session has ended.' : e.message || 'Couldn’t send the gift.', true);
        }
    }
    $('gGift').onclick = e => {
        e.stopPropagation();
        const open = $('gGiftPop').classList.toggle('hidden') === false;
        if (open) { renderGiftPop(); Promise.resolve(ctx.coins?.refresh()).then(() => { if (room?.live) $('gGiftCoins').textContent = ctx.coins?.get() == null ? '…' : String(ctx.coins.get()); }); }
    };
    $('gGetCoins').onclick = () => ctx.coins?.openShop();
    document.addEventListener('click', e => { const pop = $('gGiftPop'); if (!pop.classList.contains('hidden') && !pop.contains(e.target) && !$('gGift').contains(e.target)) pop.classList.add('hidden'); });
    $('gEnd').onclick = async () => {
        if (!room?.live?.host) return;
        if (!confirm('End this session for everyone?')) return;
        try { await room.backend.call('endLive', { sid: room.live.sid }); } catch (e) { ctx.toast(e.message || 'That didn’t work.', true); return; }
        leave();
    };

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
        $('gGiftPop').classList.add('hidden');
        show('lobby');
        if (r.live) { lobbyTab('live'); live?.refresh(); }
    }

    function open() {
        mode = 'voice';
        renderLobby();
        lobbyTab('topics');
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
