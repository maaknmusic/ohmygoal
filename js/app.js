import { createFirebaseTransport, createLocalTransport } from './transport.js';
import { COUNTRIES, flagOf, countryName, detectCountry } from './geo.js';
import { Effects, BACKGROUNDS, MASKS, FILTERS } from './effects.js';

// =====================================================================
// Config
// =====================================================================
const CFG = window.APP_CONFIG || {};
const injectedFirebase = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const firebaseConfig = CFG.firebase || injectedFirebase;
const appId = typeof __app_id !== 'undefined' ? __app_id : (CFG.appId || 'anon-connect');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const ICE = { iceServers: CFG.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }] };
const canTranslate = Boolean(CFG.geminiApiKey) || typeof __app_id !== 'undefined';

const MAX_INTERESTS = 5;
const CONNECT_TIMEOUT_MS = 20000;
const ROUND_SECONDS = 60;
const ONLINE_REFRESH_MS = 30000;

// =====================================================================
// Icons (inline, no external dependency)
// =====================================================================
const ICONS = {
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    video: '<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    videoOff: '<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/><line x1="2" y1="2" x2="22" y2="22"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    micOff: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/><line x1="2" y1="2" x2="22" y2="22"/>',
    switch: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    max: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    sparkles: '<path d="M9.94 14.06A2 2 0 0 0 8.5 12.6l-6.1-1.6a.5.5 0 0 1 0-1l6.1-1.6a2 2 0 0 0 1.45-1.44L11.5 1.9a.5.5 0 0 1 1 0l1.57 6.1a2 2 0 0 0 1.44 1.44l6.1 1.57a.5.5 0 0 1 0 1l-6.1 1.57a2 2 0 0 0-1.44 1.44L12.5 21.1a.5.5 0 0 1-1 0z"/><path d="M20 3v4M22 5h-4"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    volumeOff: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
};
function setIcon(el, name) {
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}
document.querySelectorAll('[data-icon]').forEach(el => setIcon(el, el.dataset.icon));

// =====================================================================
// DOM helpers
// =====================================================================
const $ = id => document.getElementById(id);
const el = {
    welcome: $('welcome'), chat: $('chat'), startBtn: $('startBtn'), ageCheck: $('ageCheck'),
    nickInput: $('nickInput'), tags: $('tags'), tagInput: $('tagInput'), demoNote: $('demoNote'),
    modeChip: $('modeChip'), leaveBtn: $('leaveBtn'), soundBtn: $('soundBtn'), themeBtn: $('themeBtn'),
    remoteVideo: $('remoteVideo'), localVideo: $('localVideo'), videoWrap: $('videoWrap'),
    overlay: $('overlay'), overlaySpinner: $('overlaySpinner'), overlayTitle: $('overlayTitle'),
    overlaySub: $('overlaySub'), overlayNewBtn: $('overlayNewBtn'),
    micBtn: $('micBtn'), camBtn: $('camBtn'), switchCamBtn: $('switchCamBtn'), fullBtn: $('fullBtn'),
    quality: $('quality'), qdot: $('qdot'), qtext: $('qtext'),
    avatar: $('avatar'), partnerName: $('partnerName'), partnerSub: $('partnerSub'), statusDot: $('statusDot'),
    reportBtn: $('reportBtn'), blockBtn: $('blockBtn'),
    messages: $('messages'), piiWarn: $('piiWarn'), msgInput: $('msgInput'), sendBtn: $('sendBtn'),
    nextBtn: $('nextBtn'), emojiBtn: $('emojiBtn'), emojiPop: $('emojiPop'),
    reportModal: $('reportModal'), reportCancel: $('reportCancel'), reportSubmit: $('reportSubmit'),
    toasts: $('toasts'),
    genderSelect: $('genderSelect'), genderFilter: $('genderFilter'), countryFilter: $('countryFilter'),
    filterHint: $('filterHint'), timedCheck: $('timedCheck'), partnerFlag: $('partnerFlag'),
    onlineCount: $('onlineCount'), onlineChip: $('onlineChip'), onlineChipCount: $('onlineChipCount'),
    installBtn: $('installBtn'), fxBtn: $('fxBtn'), fxPanel: $('fxPanel'), fxClose: $('fxClose'), fxStatus: $('fxStatus'),
    round: $('round'), roundFill: $('roundFill'), roundTime: $('roundTime'), roundNote: $('roundNote'), extendBtn: $('extendBtn'),
};

function h(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text; // always textContent: never inject peer content as HTML
    return node;
}

function toast(text, bad = false) {
    const t = h('div', 'toast' + (bad ? ' bad' : ''), text);
    el.toasts.appendChild(t);
    setTimeout(() => t.remove(), 4000);
}

const store = {
    get(key, fallback) { try { const v = localStorage.getItem('ac.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem('ac.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

// =====================================================================
// State
// =====================================================================
const S = {
    transport: null,
    mode: store.get('mode', 'video'),
    nick: store.get('nick', ''),
    interests: store.get('interests', []),
    blocked: new Set(store.get('blocked', [])),
    sound: store.get('sound', true),
    gender: store.get('gender', 'x'),
    genderFilter: store.get('genderFilter', 'any'),
    countryFilter: store.get('countryFilter', 'any'),
    timed: store.get('timed', false),
    fx: { background: 'none', mask: 'none', filter: 'none', ...store.get('fx', {}) },
    effects: null,
    country: '',
    phase: 'idle', // idle | searching | connecting | connected | ended
    localStream: null,
    videoDevices: [],
    camIndex: 0,
    muted: false,
    camOff: false,
    searchAbort: null,
    session: null, // { roomId, role, bus, partnerId, pc, dc, partner, pendingCandidates, timers }
    autoNextTimer: null,
    sentTyping: false,
    typingTimer: null,
    msgTimes: [],
    piiConfirmed: false,
    skipArmed: false,
    skipTimer: null,
};

// =====================================================================
// Theme & sound
// =====================================================================
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    setIcon(el.themeBtn.querySelector('.icon'), theme === 'dark' ? 'sun' : 'moon');
    store.set('theme', theme);
}
applyTheme(store.get('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
el.themeBtn.onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

function renderSoundBtn() { setIcon(el.soundBtn.querySelector('.icon'), S.sound ? 'volume' : 'volumeOff'); }
renderSoundBtn();
el.soundBtn.onclick = () => { S.sound = !S.sound; store.set('sound', S.sound); renderSoundBtn(); };

let audioCtx = null;
function beep(notes) {
    if (!S.sound) return;
    try {
        audioCtx = audioCtx || new AudioContext();
        let t = audioCtx.currentTime;
        for (const [freq, dur] of notes) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(t);
            osc.stop(t + dur);
            t += dur * 0.8;
        }
    } catch { /* audio unavailable */ }
}
const SOUND = {
    match: () => beep([[523, 0.12], [784, 0.18]]),
    message: () => beep([[880, 0.09]]),
    leave: () => beep([[440, 0.12], [330, 0.18]]),
};

// =====================================================================
// Moderation helpers
// =====================================================================
const PROFANITY = /\b(f+u+c+k+\w*|sh[i1]t+\w*|bitch\w*|cunt\w*|dick\w*|cock\w*|puss(y|ies)|whore\w*|slut\w*|fag\w*|nigg\w*|retard\w*|porn\w*|nudes?)\b/gi;
const PII = /([\w.+-]+@[\w-]+\.[\w.]+)|(\+?\d[\d\s().-]{7,}\d)|(https?:\/\/\S+)|(\b(insta(gram)?|snap(chat)?|telegram|whatsapp|discord)\b)/i;
const maskProfanity = text => text.replace(PROFANITY, m => m[0] + '*'.repeat(m.length - 1));
const EMOJI_ONLY = /^(?=.*\p{Extended_Pictographic})(?:\p{Extended_Pictographic}|‍|️|[\u{1F3FB}-\u{1F3FF}]|\s){1,12}$/u;

// =====================================================================
// Media
// =====================================================================
async function ensureMedia() {
    if (S.localStream) return true;
    try {
        S.localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
    } catch (e) {
        console.warn('getUserMedia failed', e);
        toast('Camera/microphone unavailable — switched to text only.', true);
        setMode('text');
        return false;
    }
    el.localVideo.srcObject = S.localStream;
    applyTrackState();
    if (fxActive()) applyEffects({});
    try {
        S.videoDevices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    } catch { S.videoDevices = []; }
    el.switchCamBtn.classList.toggle('hidden', S.videoDevices.length < 2);
    return true;
}

function stopMedia() {
    S.effects?.stop();
    S.localStream?.getTracks().forEach(t => t.stop());
    S.localStream = null;
    el.localVideo.srcObject = null;
}

function applyTrackState() {
    S.localStream?.getAudioTracks().forEach(t => (t.enabled = !S.muted));
    S.localStream?.getVideoTracks().forEach(t => (t.enabled = !S.camOff));
    if (S.effects?.track) S.effects.track.enabled = !S.camOff;
    el.micBtn.classList.toggle('active', S.muted);
    el.camBtn.classList.toggle('active', S.camOff);
    el.micBtn.title = S.muted ? 'Unmute microphone' : 'Mute microphone';
    el.camBtn.title = S.camOff ? 'Turn camera on' : 'Turn camera off';
    setIcon(el.micBtn.querySelector('.icon'), S.muted ? 'micOff' : 'mic');
    setIcon(el.camBtn.querySelector('.icon'), S.camOff ? 'videoOff' : 'video');
    el.localVideo.classList.toggle('cam-off', S.camOff);
    sendData({ t: 'av', muted: S.muted, camOff: S.camOff });
}

async function switchCamera() {
    if (S.videoDevices.length < 2 || !S.localStream) return;
    S.camIndex = (S.camIndex + 1) % S.videoDevices.length;
    try {
        const fresh = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: S.videoDevices[S.camIndex].deviceId } } });
        const newTrack = fresh.getVideoTracks()[0];
        const oldTrack = S.localStream.getVideoTracks()[0];
        newTrack.enabled = !S.camOff;
        S.localStream.removeTrack(oldTrack);
        oldTrack.stop();
        S.localStream.addTrack(newTrack);
        if (S.effects?.track) {
            S.effects.setSource(S.localStream); // the processed track keeps flowing to the partner
        } else {
            const sender = videoSender();
            if (sender) await sender.replaceTrack(newTrack);
            el.localVideo.srcObject = S.localStream;
        }
    } catch (e) {
        toast('Could not switch camera.', true);
    }
}

el.micBtn.onclick = () => { S.muted = !S.muted; applyTrackState(); };
el.camBtn.onclick = () => { S.camOff = !S.camOff; applyTrackState(); };
el.switchCamBtn.onclick = switchCamera;
el.fullBtn.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else el.videoWrap.requestFullscreen?.().catch(() => {});
};

// =====================================================================
// Video effects
// =====================================================================
const fxActive = () => S.fx.background !== 'none' || S.fx.mask !== 'none' || S.fx.filter !== 'none';
const videoSender = () => S.session?.pc.getSenders().find(s => s.track?.kind === 'video');
/** The video track that is previewed and sent: processed when effects are on, raw camera otherwise. */
const outVideoTrack = () => S.effects?.track || S.localStream?.getVideoTracks()[0] || null;
/** Unprocessed camera (for safety checks that must not be fooled by masks). */
const rawVideoEl = () => (S.effects?.track ? S.effects.video : el.localVideo);

let fxChain = Promise.resolve();
/** Update effect settings. Changes are applied one at a time, always using the latest settings. */
function applyEffects(partial) {
    S.fx = { ...S.fx, ...partial };
    store.set('fx', S.fx);
    renderFxPanel();
    fxChain = fxChain.then(syncEffects, syncEffects);
    return fxChain;
}

async function syncEffects() {
    if (!S.localStream) return;
    const fx = S.effects ||= new Effects(CFG.effects);
    const needsModels = S.fx.background !== 'none' || S.fx.mask !== 'none';
    if (needsModels) el.fxStatus.textContent = 'Loading…';
    try {
        await fx.set({ ...S.fx });
    } catch (e) {
        console.warn('effects failed to load', e);
        toast('Backgrounds and masks aren’t available on this device.', true);
        S.fx = { ...S.fx, background: 'none', mask: 'none' };
        store.set('fx', S.fx);
        await fx.set({ ...S.fx }).catch(() => {});
        renderFxPanel();
    }
    el.fxStatus.textContent = '';
    if (!S.localStream) return;
    const previous = outVideoTrack();
    let track;
    if (fx.active) track = await fx.start(S.localStream);
    else { fx.stop(); track = S.localStream.getVideoTracks()[0]; }
    track.enabled = !S.camOff;
    el.localVideo.srcObject = new MediaStream([track]);
    const sender = videoSender();
    if (sender && sender.track !== track) await sender.replaceTrack(track).catch(e => console.warn('replaceTrack', e));
    if (previous && previous !== track && previous !== S.localStream.getVideoTracks()[0]) previous.stop();
}

function renderFxPanel() {
    el.fxBtn.classList.toggle('on', fxActive());
    const lists = { background: BACKGROUNDS, mask: MASKS, filter: FILTERS };
    el.fxPanel.querySelectorAll('.fx-opts').forEach(box => {
        const kind = box.dataset.kind;
        box.replaceChildren(...lists[kind].map(opt => {
            const b = h('button', (opt.emoji ? 'emoji' : '') + (S.fx[kind] === opt.id ? ' active' : ''), opt.label);
            b.type = 'button';
            b.title = opt.id;
            b.onclick = () => applyEffects({ [kind]: opt.id });
            return b;
        }));
    });
}
el.fxBtn.onclick = e => { e.stopPropagation(); el.fxPanel.classList.toggle('hidden'); renderFxPanel(); };
el.fxClose.onclick = () => el.fxPanel.classList.add('hidden');
renderFxPanel();

// =====================================================================
// Matching & connection lifecycle
// =====================================================================
function setPhase(phase, info = {}) {
    S.phase = phase;
    const live = phase === 'connected';
    el.msgInput.disabled = !live;
    el.sendBtn.disabled = !live;
    el.emojiBtn.disabled = !live;
    el.reportBtn.disabled = !(live || phase === 'connecting');
    el.blockBtn.disabled = !(live || phase === 'connecting');
    el.overlay.classList.toggle('hidden', live);
    el.overlaySpinner.classList.toggle('hidden', phase === 'ended');
    el.overlayNewBtn.classList.toggle('hidden', phase !== 'ended');
    el.quality.classList.toggle('hidden', !live || S.mode !== 'video');
    el.statusDot.className = 'status-dot ' + (live ? 'on' : phase === 'ended' ? '' : 'wait');
    disarmSkip();

    if (phase === 'searching') {
        el.overlayTitle.textContent = 'Looking for someone…';
        el.overlaySub.textContent = S.interests.length ? `Prioritizing people into ${S.interests.join(', ')}` : '';
        el.partnerName.textContent = 'Searching…';
        el.partnerSub.textContent = 'Finding a match';
        el.avatar.textContent = '?';
        el.partnerFlag.textContent = '';
        el.nextBtn.textContent = 'Stop';
        el.nextBtn.title = 'Stop searching';
    } else if (phase === 'connecting') {
        el.overlayTitle.textContent = 'Connecting…';
        el.overlaySub.textContent = 'Setting up a secure peer‑to‑peer connection';
        el.partnerSub.textContent = 'Connecting';
        el.nextBtn.textContent = 'Next';
        el.nextBtn.title = 'Skip to the next person (Esc)';
    } else if (phase === 'connected') {
        el.partnerSub.textContent = 'Connected';
        el.nextBtn.textContent = 'Next';
        el.msgInput.focus();
    } else if (phase === 'ended') {
        el.overlayTitle.textContent = info.title || 'Chat ended';
        el.overlaySub.textContent = info.sub || '';
        el.partnerSub.textContent = 'Disconnected';
        el.nextBtn.textContent = 'New';
        el.nextBtn.title = 'Find someone new (Esc)';
    }
}

function clearMessages() {
    el.messages.replaceChildren();
    hideTyping();
}

function sys(text, kind = '') {
    const node = h('div', 'sys' + (kind ? ' ' + kind : ''), text);
    el.messages.appendChild(node);
    scrollMessages();
    return node;
}

function scrollMessages() { el.messages.scrollTop = el.messages.scrollHeight; }

/** note: optional message carried over from the chat that just ended (e.g. "Time's up"). */
async function startSearch(note) {
    clearTimeout(S.autoNextTimer);
    endSession({ notify: true });
    S.searchAbort?.abort();
    clearMessages();
    setPhase('searching');
    if (typeof note === 'string') sys(note);
    sys('Looking for someone to talk to…');

    if (S.mode === 'video' && !(await ensureMedia())) {
        // ensureMedia already switched us to text mode
    }

    const ac = new AbortController();
    S.searchAbort = ac;
    const filtered = S.genderFilter !== 'any' || S.countryFilter !== 'any';
    const slowHint = setTimeout(() => {
        if (S.searchAbort === ac && filtered) sys('Still looking… your filters may be limiting matches. Try “Everyone” or “Anywhere” for faster chats.');
    }, 25000);
    ac.signal.addEventListener('abort', () => clearTimeout(slowHint));
    let match;
    try {
        match = await S.transport.findMatch({
            mode: S.mode, interests: S.interests, blocked: [...S.blocked], profile: myProfile(),
        }, ac.signal);
        clearTimeout(slowHint);
    } catch (e) {
        clearTimeout(slowHint);
        if (ac.signal.aborted) return;
        console.error(e);
        sys('Matching failed. Check your connection and try again.', 'bad');
        setPhase('ended', { title: 'Matching failed', sub: e.message });
        return;
    }
    if (ac.signal.aborted || S.searchAbort !== ac) { match.bus.close(); return; }
    S.searchAbort = null;
    connect(match);
}

function stopSearch() {
    S.searchAbort?.abort();
    S.searchAbort = null;
    clearTimeout(S.autoNextTimer);
    setPhase('ended', { title: 'Stopped', sub: 'Press “Find someone new” when you’re ready.' });
    sys('You stopped searching.');
}

async function connect({ roomId, role, bus, partnerId }) {
    setPhase('connecting');
    const pc = new RTCPeerConnection(ICE);
    const sess = S.session = {
        roomId, role, bus, partnerId, pc, dc: null, partner: null,
        pendingCandidates: [], ended: false, startedAt: 0, statsTimer: null, connectTimer: null, clockTimer: null,
    };

    if (S.mode === 'video' && S.localStream) {
        const send = new MediaStream([...S.localStream.getAudioTracks(), outVideoTrack()].filter(Boolean));
        send.getTracks().forEach(t => pc.addTrack(t, send));
    }
    pc.onicecandidate = e => { if (e.candidate) bus.send('candidate', e.candidate.toJSON()); };
    pc.ontrack = e => { el.remoteVideo.srcObject = e.streams[0]; };
    pc.onconnectionstatechange = () => {
        if (sess.ended) return;
        if (pc.connectionState === 'failed') {
            partnerLeft('Connection failed', 'The network blocked a direct connection. A TURN server fixes this.');
        } else if (pc.connectionState === 'disconnected') {
            setTimeout(() => { if (!sess.ended && pc.connectionState === 'disconnected') partnerLeft('Stranger disconnected'); }, 5000);
        }
    };

    if (role === 'offerer') attachChannel(sess, pc.createDataChannel('chat', { ordered: true }));
    else pc.ondatachannel = e => attachChannel(sess, e.channel);

    const flushCandidates = async () => {
        for (const c of sess.pendingCandidates.splice(0)) {
            await pc.addIceCandidate(c).catch(e => console.warn('addIceCandidate', e));
        }
    };

    bus.onMessage(async ({ type, data }) => {
        if (sess.ended) return;
        try {
            if (type === 'offer' && role === 'answerer') {
                await pc.setRemoteDescription(data);
                await flushCandidates();
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                bus.send('answer', { type: answer.type, sdp: answer.sdp });
            } else if (type === 'answer' && role === 'offerer' && pc.signalingState === 'have-local-offer') {
                await pc.setRemoteDescription(data);
                await flushCandidates();
            } else if (type === 'candidate') {
                if (pc.remoteDescription) await pc.addIceCandidate(data);
                else sess.pendingCandidates.push(data);
            } else if (type === 'bye') {
                partnerLeft('Stranger disconnected');
            }
        } catch (e) {
            console.warn('signaling error', type, e);
        }
    });

    sess.connectTimer = setTimeout(() => {
        if (!sess.ended && S.phase === 'connecting') partnerLeft('Could not connect', 'The other person didn’t respond in time.');
    }, CONNECT_TIMEOUT_MS);

    if (role === 'offerer') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        bus.send('offer', { type: offer.type, sdp: offer.sdp });
    }
}

function attachChannel(sess, dc) {
    sess.dc = dc;
    dc.onopen = () => {
        if (sess.ended) return;
        clearTimeout(sess.connectTimer);
        sess.startedAt = Date.now();
        setPhase('connected');
        clearMessages();
        sys("You're now chatting with a stranger. Say hi! 👋", 'good');
        el.partnerName.textContent = 'Stranger';
        el.avatar.textContent = 'S';
        sendData({ t: 'hello', nick: S.nick, interests: S.interests, country: S.country, gender: S.gender, timed: S.timed });
        if (S.timed) startRound(sess);
        sendData({ t: 'av', muted: S.muted, camOff: S.camOff });
        SOUND.match();
        sess.clockTimer = setInterval(() => renderPartnerSub(sess), 1000);
        if (S.mode === 'video') { startStats(sess); startAgeRecheck(sess); }
    };
    dc.onmessage = e => {
        if (sess.ended) return;
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        onPeerData(sess, msg);
    };
    dc.onclose = () => { if (!sess.ended && S.phase === 'connected') partnerLeft('Stranger disconnected'); };
}

function sendData(obj) {
    const dc = S.session?.dc;
    if (dc?.readyState === 'open') dc.send(JSON.stringify(obj));
}

function onPeerData(sess, msg) {
    switch (msg.t) {
        case 'hello': {
            const nick = String(msg.nick || '').trim().slice(0, 20) || 'Stranger';
            const interests = Array.isArray(msg.interests) ? msg.interests.map(String).slice(0, MAX_INTERESTS) : [];
            const country = /^[A-Z]{2}$/.test(msg.country || '') ? msg.country : '';
            const gender = ['male', 'female'].includes(msg.gender) ? msg.gender : '';
            sess.partner = { nick, interests, country, gender };
            el.partnerName.textContent = nick;
            el.partnerFlag.textContent = country ? flagOf(country) : '';
            el.partnerFlag.title = country ? countryName(country) : '';
            el.avatar.textContent = nick[0].toUpperCase();
            if (country) sys(`${flagOf(country)} ${nick} is from ${countryName(country)}${gender ? ` · ${gender === 'male' ? '♂' : '♀'}` : ''}`);
            if (msg.timed && !sess.round) startRound(sess);
            const shared = interests.filter(i => S.interests.includes(i));
            if (shared.length) {
                const line = sys('You both like ');
                line.appendChild(h('span', 'shared', shared.join(', ')));
            }
            break;
        }
        case 'msg':
            hideTyping();
            addMessage('them', String(msg.text || '').slice(0, 500));
            SOUND.message();
            break;
        case 'typing':
            msg.on ? showTyping() : hideTyping();
            break;
        case 'extend':
            sess.partnerExtend = true;
            tryExtend(sess);
            break;
        case 'av':
            sess.partnerAv = { muted: !!msg.muted, camOff: !!msg.camOff };
            renderPartnerSub(sess);
            break;
    }
}

function renderPartnerSub(sess) {
    if (sess !== S.session || S.phase !== 'connected') return;
    const secs = Math.floor((Date.now() - sess.startedAt) / 1000);
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const flags = [];
    if (sess.partnerAv?.muted && S.mode === 'video') flags.push('muted');
    if (sess.partnerAv?.camOff && S.mode === 'video') flags.push('camera off');
    el.partnerSub.textContent = ['Connected', clock, ...flags].join(' · ');
}

function startStats(sess) {
    sess.statsTimer = setInterval(async () => {
        if (sess.ended) return;
        try {
            const stats = await sess.pc.getStats();
            let rtt = null;
            stats.forEach(r => {
                if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && r.currentRoundTripTime != null) {
                    rtt = Math.round(r.currentRoundTripTime * 1000);
                }
            });
            if (rtt == null) return;
            const q = rtt < 150 ? 'good' : rtt < 350 ? 'ok' : 'poor';
            el.qdot.className = 'qdot ' + q;
            el.qtext.textContent = `${q === 'good' ? 'Good' : q === 'ok' ? 'Fair' : 'Poor'} · ${rtt} ms`;
        } catch { /* ignore */ }
    }, 2000);
}

/** Tear down the current peer session. notify=true tells the partner we left. */
function endSession({ notify }) {
    const sess = S.session;
    if (!sess) return;
    sess.ended = true;
    if (notify) sess.bus.send('bye');
    clearTimeout(sess.connectTimer);
    clearInterval(sess.statsTimer);
    clearInterval(sess.clockTimer);
    clearInterval(sess.ageTimer);
    clearInterval(sess.roundTimer);
    el.round.classList.add('hidden');
    try { sess.dc?.close(); } catch { /* ignore */ }
    try { sess.pc.close(); } catch { /* ignore */ }
    sess.bus.close();
    S.session = null;
    el.remoteVideo.srcObject = null;
    hideTyping();
    setTypingSent(false);
}

function partnerLeft(title, sub = '') {
    if (!S.session) return;
    endSession({ notify: true });
    SOUND.leave();
    sys(title + '.', 'bad');
    setPhase('ended', { title, sub: sub || 'Finding someone new in a moment…' });
    S.autoNextTimer = setTimeout(() => { if (S.phase === 'ended') startSearch(); }, 2500);
}

// Quick rounds: a countdown per chat. Time is only added when BOTH people tap "+1 min".
function startRound(sess) {
    if (sess.round || sess.ended) return;
    sess.round = { endsAt: Date.now() + ROUND_SECONDS * 1000, total: ROUND_SECONDS };
    sess.myExtend = sess.partnerExtend = false;
    el.round.classList.remove('hidden');
    el.extendBtn.classList.remove('waiting');
    el.extendBtn.disabled = false;
    el.roundNote.textContent = '';
    const tick = () => {
        if (sess.ended || sess !== S.session) return;
        const left = Math.max(0, Math.ceil((sess.round.endsAt - Date.now()) / 1000));
        el.roundTime.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        el.roundFill.style.width = `${Math.min(100, (left / sess.round.total) * 100)}%`;
        el.round.classList.toggle('low', left <= 10);
        if (left === 0) {
            startSearch('⏱ Time’s up!');
        }
    };
    tick();
    sess.roundTimer = setInterval(tick, 1000);
}

function tryExtend(sess) {
    if (!sess.round || sess.ended) return;
    if (sess.myExtend && sess.partnerExtend) {
        sess.round.endsAt += 60000;
        sess.round.total = Math.max(sess.round.total, Math.ceil((sess.round.endsAt - Date.now()) / 1000));
        sess.myExtend = sess.partnerExtend = false;
        el.extendBtn.classList.remove('waiting');
        el.extendBtn.disabled = false;
        el.roundNote.textContent = '';
        sys('⏱ You both added a minute!', 'good');
    } else if (sess.partnerExtend) {
        el.roundNote.textContent = 'They want more time!';
    } else if (sess.myExtend) {
        el.roundNote.textContent = 'Waiting for them…';
    }
}

el.extendBtn.onclick = () => {
    const sess = S.session;
    if (!sess?.round || sess.myExtend) return;
    sess.myExtend = true;
    el.extendBtn.classList.add('waiting');
    el.extendBtn.disabled = true;
    sendData({ t: 'extend' });
    tryExtend(sess);
};

// Skipping requires a second press (like the classic "Really?" button) to avoid accidents.
function disarmSkip() {
    S.skipArmed = false;
    clearTimeout(S.skipTimer);
    el.nextBtn.classList.remove('confirm');
}
function onNext() {
    if (S.phase === 'searching') return stopSearch();
    if (S.phase === 'ended') return startSearch();
    if (!S.skipArmed) {
        S.skipArmed = true;
        el.nextBtn.textContent = 'Really?';
        el.nextBtn.classList.add('confirm');
        S.skipTimer = setTimeout(() => { disarmSkip(); el.nextBtn.textContent = 'Next'; }, 2500);
        return;
    }
    disarmSkip();
    startSearch('You skipped the last chat.');
}
el.nextBtn.onclick = onNext;
el.overlayNewBtn.onclick = () => startSearch();

// =====================================================================
// Messaging
// =====================================================================
function addMessage(who, text) {
    const wrap = h('div', 'msg ' + who);
    const shown = who === 'them' ? maskProfanity(text) : text;
    if (EMOJI_ONLY.test(shown)) wrap.classList.add('emoji-only');
    wrap.appendChild(h('div', 'bubble', shown));
    const meta = h('div', 'meta', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    if (who === 'them' && canTranslate && !wrap.classList.contains('emoji-only')) {
        const btn = h('button', '', 'Translate');
        btn.onclick = () => translateInto(wrap, btn, text);
        meta.appendChild(btn);
    }
    wrap.appendChild(meta);
    el.messages.insertBefore(wrap, typingNode?.isConnected ? typingNode : null);
    scrollMessages();
}

function sendMessage() {
    const text = el.msgInput.value.trim();
    if (!text || S.phase !== 'connected') return;

    const now = Date.now();
    S.msgTimes = S.msgTimes.filter(t => now - t < 4000);
    if (S.msgTimes.length >= 6) { toast('Slow down a little 🙂', true); return; }

    if (PII.test(text) && !S.piiConfirmed) {
        S.piiConfirmed = true;
        el.piiWarn.classList.remove('hidden');
        return;
    }
    S.piiConfirmed = false;
    el.piiWarn.classList.add('hidden');

    S.msgTimes.push(now);
    sendData({ t: 'msg', text });
    addMessage('me', text);
    el.msgInput.value = '';
    setTypingSent(false);
}

function setTypingSent(on) {
    clearTimeout(S.typingTimer);
    if (S.sentTyping !== on) { S.sentTyping = on; sendData({ t: 'typing', on }); }
    if (on) S.typingTimer = setTimeout(() => setTypingSent(false), 3000);
}

let typingNode = null;
function showTyping() {
    if (!typingNode) {
        typingNode = h('div', 'typing');
        typingNode.append(h('span'), h('span'), h('span'));
    }
    if (!typingNode.isConnected) { el.messages.appendChild(typingNode); scrollMessages(); }
}
function hideTyping() { typingNode?.remove(); }

el.sendBtn.onclick = sendMessage;
el.msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
el.msgInput.addEventListener('input', () => {
    if (S.piiConfirmed) { S.piiConfirmed = false; el.piiWarn.classList.add('hidden'); }
    setTypingSent(el.msgInput.value.length > 0);
});

// Emoji picker
const EMOJIS = '😀 😂 🥲 😊 😍 😎 🤔 😅 😭 😡 😴 🤯 🥳 😇 🙃 😬 👍 👎 👋 🙏 👏 💪 🤝 ✌️ ❤️ 🔥 ✨ 🎉 💯 🌍 🎵 🎮 🍕 ☕ 🐶 🐱 🌙 ☀️ 🌈 🤷'.split(' ');
EMOJIS.forEach(em => {
    const b = h('button', '', em);
    b.type = 'button';
    b.onclick = () => {
        const i = el.msgInput.selectionStart ?? el.msgInput.value.length;
        el.msgInput.value = el.msgInput.value.slice(0, i) + em + el.msgInput.value.slice(i);
        el.msgInput.focus();
        el.msgInput.setSelectionRange(i + em.length, i + em.length);
        el.emojiPop.classList.add('hidden');
    };
    el.emojiPop.appendChild(b);
});
el.emojiBtn.onclick = e => { e.stopPropagation(); el.emojiPop.classList.toggle('hidden'); };
document.addEventListener('click', e => { if (!el.emojiPop.contains(e.target)) el.emojiPop.classList.add('hidden'); });

// Translation (optional, Gemini)
async function translateInto(wrap, btn, text) {
    btn.disabled = true;
    btn.textContent = 'Translating…';
    const code = (navigator.language || 'en').split('-')[0];
    const lang = new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || 'English';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CFG.geminiModel || 'gemini-2.5-flash'}:generateContent?key=${CFG.geminiApiKey || ''}`;
    const payload = {
        contents: [{ parts: [{ text }] }],
        systemInstruction: { parts: [{ text: `Translate the user's message into ${lang}. Reply with only the translation. If it is already in ${lang}, reply with it unchanged.` }] },
    };
    try {
        let res;
        for (let i = 0; i < 3; i++) {
            res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (res.ok) break;
            await new Promise(r => setTimeout(r, 2 ** i * 1000));
        }
        const json = await res.json();
        const out = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!out) throw new Error('empty translation');
        wrap.insertBefore(h('div', 'translated', `${lang}: ${maskProfanity(out)}`), wrap.lastChild);
        btn.remove();
    } catch (e) {
        console.warn('translate failed', e);
        btn.textContent = 'Translation unavailable';
    }
}

// =====================================================================
// Report & block
// =====================================================================
function blockCurrent() {
    const id = S.session?.partnerId;
    if (!id) return;
    S.blocked.add(id);
    store.set('blocked', [...S.blocked].slice(-200));
}

el.blockBtn.onclick = () => {
    if (!S.session) return;
    blockCurrent();
    toast('Blocked. You won’t be matched with them again.');
    startSearch();
};
el.reportBtn.onclick = () => { if (S.session) el.reportModal.classList.remove('hidden'); };
el.reportCancel.onclick = () => el.reportModal.classList.add('hidden');
el.reportSubmit.onclick = async () => {
    el.reportModal.classList.add('hidden');
    const sess = S.session;
    if (!sess) return;
    const reason = document.querySelector('input[name="reason"]:checked')?.value || 'other';
    blockCurrent();
    S.transport.report({ partnerId: sess.partnerId, roomId: sess.roomId, reason })
        .then(() => toast('Thanks — report sent.'))
        .catch(() => toast('Could not send report.', true));
    startSearch();
};

// =====================================================================
// Keyboard shortcuts
// =====================================================================
document.addEventListener('keydown', e => {
    if (el.chat.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
        if (!el.reportModal.classList.contains('hidden')) { el.reportModal.classList.add('hidden'); return; }
        e.preventDefault();
        onNext();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm' && S.mode === 'video') {
        e.preventDefault();
        el.micBtn.click();
    }
});

// =====================================================================
// Age verification: on-device face age estimation + liveness check.
// Uses face-api (TinyFaceDetector + 68-point landmarks + age model).
// Frames are analysed in the browser only; nothing is uploaded or stored.
// =====================================================================
const AGE = {
    enabled: true, passAge: 25, minAge: 18, maxAttempts: 3, lockHours: 24, validDays: 30,
    recheckDuringVideo: true, fallbackUrl: '',
    libUrl: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js',
    modelUrl: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/',
    wasmUrl: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/',
    ...(CFG.ageCheck || {}),
};
const V = { faceapi: null, loading: null, stream: null, run: 0 };
const vEl = {
    screen: $('verify'), video: $('verifyVideo'), canvas: $('verifyCanvas'), msg: $('verifyMsg'),
    steps: $('verifySteps'), liveHint: $('liveHint'), progress: $('ageProgress'), result: $('verifyResult'),
    cancel: $('verifyCancel'), retry: $('verifyRetry'), cont: $('verifyContinue'), fallback: $('verifyFallback'),
    ageStatus: $('ageStatus'),
};
const AGE_DEBUG = new URLSearchParams(location.search).has('agedebug');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const median = arr => { const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const ageVerified = () => !AGE.enabled || store.get('ageVerifiedUntil', 0) > Date.now();
const ageLockedUntil = () => { const u = store.get('ageLockUntil', 0); return u > Date.now() ? u : 0; };

function renderAgeStatus() {
    const locked = ageLockedUntil();
    if (locked) vEl.ageStatus.textContent = `Age verification is locked on this device until ${new Date(locked).toLocaleString()}.`;
    else if (AGE.enabled && ageVerified()) vEl.ageStatus.textContent = '✓ Age verified on this device';
    else if (AGE.enabled) vEl.ageStatus.textContent = 'A quick on-device face age check (about 10 seconds) is required before chatting.';
    else vEl.ageStatus.textContent = '';
}

function loadFaceApi() {
    if (!V.loading) {
        V.loading = (async () => {
            const faceapi = await import(AGE.libUrl);
            const tf = faceapi.tf;
            (tf.setWasmPaths || faceapi.setWasmPaths)?.(AGE.wasmUrl);
            // Prefer GPU, then WebAssembly, then plain JS.
            for (const backend of ['webgl', 'wasm', 'cpu']) {
                try { if (await tf.setBackend(backend)) break; } catch { /* try next */ }
            }
            await tf.ready();
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(AGE.modelUrl),
                faceapi.nets.faceLandmark68Net.loadFromUri(AGE.modelUrl),
                faceapi.nets.ageGenderNet.loadFromUri(AGE.modelUrl),
            ]);
            V.faceapi = faceapi;
            return faceapi;
        })();
        V.loading.catch(() => { V.loading = null; });
    }
    return V.loading;
}

function detectFaces(input) {
    const fa = V.faceapi;
    return fa.detectAllFaces(input, new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 }))
        .withFaceLandmarks()
        .withAgeAndGender();
}

/** Head yaw from landmarks: ~0 facing camera, sign flips as the head turns left/right. */
function yawOf(landmarks) {
    const p = landmarks.positions;
    const nose = p[30], l = p[36], r = p[45];
    const dl = Math.hypot(nose.x - l.x, nose.y - l.y);
    const dr = Math.hypot(nose.x - r.x, nose.y - r.y);
    return (dl - dr) / (dl + dr);
}

function setStep(name, cls) {
    vEl.steps.querySelector(`[data-step="${name}"]`).className = cls;
}

function drawVerify(faces, color) {
    const c = vEl.canvas, v = vEl.video;
    if (!v.videoWidth) return;
    if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    // Oval guide
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(c.width / 2, c.height / 2, c.width * 0.2, c.height * 0.36, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const f of faces) {
        const { x, y, width: w, height: hh } = f.detection.box;
        const k = Math.min(w, hh) * 0.2;
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + hh, 1, -1], [x + w, y + hh, -1, -1]].forEach(([cx, cy, dx, dy]) => {
            ctx.moveTo(cx + dx * k, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * k);
        });
        ctx.stroke();
        ctx.fillStyle = color;
        for (const pt of f.landmarks.positions) ctx.fillRect(pt.x - 1, pt.y - 1, 2, 2);
    }
}

function stopVerifyCamera() {
    V.run++; // invalidates any running loop
    V.stream?.getTracks().forEach(t => t.stop());
    V.stream = null;
    vEl.video.srcObject = null;
    vEl.canvas.getContext('2d').clearRect(0, 0, vEl.canvas.width, vEl.canvas.height);
}

function showVerifyResult(kind, text, { retry = false, cont = false } = {}) {
    vEl.result.className = 'result ' + kind;
    vEl.result.textContent = text;
    vEl.retry.classList.toggle('hidden', !retry);
    vEl.cont.classList.toggle('hidden', !cont);
    vEl.fallback.classList.toggle('hidden', !(AGE.fallbackUrl && kind !== 'ok'));
    if (AGE.fallbackUrl) vEl.fallback.href = AGE.fallbackUrl;
}

async function runVerification() {
    const run = ++V.run;
    el.welcome.classList.add('hidden');
    vEl.screen.classList.remove('hidden');
    vEl.result.classList.add('hidden');
    [vEl.retry, vEl.cont, vEl.fallback].forEach(b => b.classList.add('hidden'));
    ['face', 'live', 'age'].forEach(s => setStep(s, ''));
    setStep('face', 'active');
    vEl.liveHint.textContent = '';
    vEl.progress.style.width = '0%';
    const msg = t => { vEl.msg.textContent = AGE_DEBUG ? `${t} [${vEl.liveHint.dataset.debug || ''}]` : t; };

    msg('Loading face models…');
    try { await loadFaceApi(); } catch (e) {
        console.error('face-api load failed', e);
        msg('');
        return showVerifyResult('warn', 'Could not load the age-check models. Check your connection and try again.', { retry: true });
    }
    if (run !== V.run) return;

    msg('Starting camera…');
    try {
        V.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } });
    } catch (e) {
        msg('Camera blocked');
        return showVerifyResult('bad', 'Camera access is required for age verification. Allow camera access in your browser and try again.', { retry: true });
    }
    if (run !== V.run) { V.stream.getTracks().forEach(t => t.stop()); return; }
    vEl.video.srcObject = V.stream;
    await vEl.video.play().catch(() => {});
    while (!vEl.video.videoWidth && run === V.run) await sleep(50);

    const st = { step: 'face', steady: 0, yaws: [], base: 0, sideA: false, sideB: false, ages: [], last: null, lost: 0, crowd: 0, jumps: 0, started: Date.now() };
    const NEED_SAMPLES = 15;
    // Detection flickers, especially while the head is turned. Only restart when a problem persists
    // for this many consecutive frames (~1.5-2 s), never on a single glitch.
    const GRACE_FRAMES = 15;
    const TIMEOUT_MS = 60000;
    const restart = why => {
        Object.assign(st, { step: 'face', steady: 0, yaws: [], base: 0, sideA: false, sideB: false, ages: [], last: null, lost: 0, crowd: 0, jumps: 0 });
        ['live', 'age'].forEach(s => setStep(s, ''));
        setStep('face', 'active');
        vEl.liveHint.textContent = '';
        vEl.progress.style.width = '0%';
        msg(why);
    };

    while (run === V.run) {
        if (Date.now() - st.started > TIMEOUT_MS) return finishAttempt(null);
        let faces;
        try { faces = await detectFaces(vEl.video); } catch (e) { console.warn(e); await sleep(150); continue; }
        if (run !== V.run) return;
        // Weak detections (e.g. a turned head) are kept, but only confident ones count as extra people.
        faces.sort((a, b) => b.detection.score - a.detection.score);
        const strong = faces.filter(x => x.detection.score >= 0.6);
        drawVerify(faces.slice(0, Math.max(1, strong.length)), strong.length > 1 ? '#f59e0b' : '#10b981');
        await sleep(30);

        if (faces.length === 0) {
            if (st.step === 'face') { st.steady = 0; msg('No face detected — face the camera in good light'); }
            else if (++st.lost > GRACE_FRAMES) restart('Face lost — let’s start over');
            else msg('Keep your face in view');
            continue;
        }
        st.lost = 0;
        if (strong.length > 1) {
            if (++st.crowd > GRACE_FRAMES) restart('Only one person should be in the frame');
            else msg('Only one person should be in the frame');
            continue;
        }
        st.crowd = 0;
        const f = faces[0];
        const box = f.detection.box;
        if (box.width < vEl.video.videoWidth * 0.14) { msg('Move a little closer'); continue; }
        // Guard against swapping people mid-check: the face must move continuously. A single jumpy
        // box is ignored; only a sustained jump (a different face elsewhere in frame) restarts.
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        if (st.last && Math.hypot(cx - st.last.x, cy - st.last.y) > box.width * 1.2) {
            if (++st.jumps > 5) restart('Please keep your face in view');
            continue;
        }
        st.jumps = 0;
        st.last = { x: cx, y: cy };
        const yaw = yawOf(f.landmarks);
        if (AGE_DEBUG) vEl.liveHint.dataset.debug = `yaw ${yaw.toFixed(2)} base ${st.base.toFixed(2)} age ${f.age.toFixed(1)} score ${f.detection.score.toFixed(2)}`;

        if (st.step === 'face') {
            // Landmark yaw is noisy and person-specific, so measure turns relative to this resting pose.
            msg('Hold still…');
            st.yaws.push(yaw);
            if (++st.steady >= 5) { st.base = median(st.yaws); st.step = 'live'; setStep('face', 'done'); setStep('live', 'active'); }
        } else if (st.step === 'live') {
            if (yaw > st.base + 0.16) st.sideA = true;
            if (yaw < st.base - 0.16) st.sideB = true;
            vEl.liveHint.textContent = `(${(st.sideA ? 1 : 0) + (st.sideB ? 1 : 0)}/2)`;
            msg(st.sideA || st.sideB ? 'Now slowly turn to the other side' : 'Slowly turn your head to one side');
            if (st.sideA && st.sideB) { st.step = 'age'; setStep('live', 'done'); setStep('age', 'active'); }
        } else if (st.step === 'age') {
            if (Math.abs(yaw - st.base) > 0.15) { msg('Look straight at the camera'); continue; }
            st.ages.push(f.age);
            vEl.progress.style.width = `${Math.round((st.ages.length / NEED_SAMPLES) * 100)}%`;
            msg('Estimating age… hold still');
            if (st.ages.length >= NEED_SAMPLES) return finishAttempt(median(st.ages));
        }
    }
}

function finishAttempt(age) {
    stopVerifyCamera();
    vEl.msg.textContent = '';
    if (age == null) {
        return showVerifyResult('warn', 'We couldn’t finish the check. Make sure your face is well lit, remove hats or sunglasses, and try again.', { retry: true });
    }
    setStep('age', 'done');
    if (age >= AGE.passAge) {
        store.set('ageVerifiedUntil', Date.now() + AGE.validDays * 86400000);
        store.set('ageAttempts', 0);
        renderAgeStatus();
        return showVerifyResult('ok', '✓ Verified. You’re good to go.', { cont: true });
    }
    if (age < AGE.minAge) {
        store.set('ageLockUntil', Date.now() + AGE.lockHours * 3600000);
        store.set('ageAttempts', 0);
        renderAgeStatus();
        return showVerifyResult('bad', `Access denied. Our check suggests you may be under ${AGE.minAge}. This service is for adults only. Try again in ${AGE.lockHours} hours.`);
    }
    const attempts = store.get('ageAttempts', 0) + 1;
    store.set('ageAttempts', attempts);
    if (attempts >= AGE.maxAttempts) {
        store.set('ageLockUntil', Date.now() + AGE.lockHours * 3600000);
        store.set('ageAttempts', 0);
        renderAgeStatus();
        return showVerifyResult('bad', `We couldn’t confirm you’re over ${AGE.minAge} after ${AGE.maxAttempts} tries. Please try again in ${AGE.lockHours} hours${AGE.fallbackUrl ? ' or verify with an ID document' : ''}.`);
    }
    showVerifyResult('warn', `Inconclusive: we couldn’t confirm you’re over ${AGE.minAge}. Try again facing a light source, without hats or glasses. (${AGE.maxAttempts - attempts} attempt${AGE.maxAttempts - attempts === 1 ? '' : 's'} left)`, { retry: true });
}

function closeVerify() {
    stopVerifyCamera();
    vEl.screen.classList.add('hidden');
}
vEl.cancel.onclick = () => { closeVerify(); el.welcome.classList.remove('hidden'); renderAgeStatus(); };
vEl.retry.onclick = () => runVerification();
vEl.cont.onclick = () => { closeVerify(); enterChat(); };

/** During video chats, periodically re-estimate the age of whoever is on camera. */
function startAgeRecheck(sess) {
    if (!AGE.enabled || !AGE.recheckDuringVideo || S.mode !== 'video') return;
    loadFaceApi().catch(() => {});
    sess.ageSamples = [];
    sess.ageTimer = setInterval(async () => {
        const cam = rawVideoEl();
        if (sess.ended || !V.faceapi || S.camOff || !cam.videoWidth) return;
        let faces;
        try { faces = await detectFaces(cam); } catch { return; }
        if (sess.ended || faces.length !== 1) return;
        sess.ageSamples = [...sess.ageSamples, faces[0].age].slice(-3);
        // Conservative: only act on three consecutive clearly-underage estimates.
        if (sess.ageSamples.length === 3 && sess.ageSamples.every(a => a < AGE.minAge - 2)) {
            store.set('ageVerifiedUntil', 0);
            endSession({ notify: true });
            S.searchAbort?.abort();
            stopMedia();
            el.chat.classList.add('hidden');
            el.leaveBtn.classList.add('hidden');
            el.modeChip.classList.add('hidden');
            toast('The person on camera needs to verify their age.', true);
            runVerification();
        }
    }, 15000);
}

// =====================================================================
// Welcome screen
// =====================================================================
function setMode(mode) {
    S.mode = mode;
    store.set('mode', mode);
    document.querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    el.chat.classList.toggle('text-mode', mode === 'text');
    el.modeChip.textContent = mode === 'video' ? 'Video chat' : 'Text chat';
    if (mode === 'text') stopMedia();
}
document.querySelectorAll('.seg').forEach(b => (b.onclick = () => setMode(b.dataset.mode)));

function renderTags() {
    el.tags.querySelectorAll('.tag').forEach(t => t.remove());
    S.interests.forEach((tag, i) => {
        const chip = h('span', 'tag', tag);
        const x = h('button', '', '×');
        x.type = 'button';
        x.title = 'Remove';
        x.onclick = () => { S.interests.splice(i, 1); store.set('interests', S.interests); renderTags(); };
        chip.appendChild(x);
        el.tags.insertBefore(chip, el.tagInput);
    });
    el.tagInput.placeholder = S.interests.length >= MAX_INTERESTS ? '' : 'music, gaming, travel…';
}
function addTag(raw) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 24);
    if (!tag || S.interests.includes(tag) || S.interests.length >= MAX_INTERESTS) return;
    S.interests.push(tag);
    store.set('interests', S.interests);
    renderTags();
}
el.tagInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(el.tagInput.value); el.tagInput.value = ''; }
    else if (e.key === 'Backspace' && !el.tagInput.value && S.interests.length) {
        S.interests.pop(); store.set('interests', S.interests); renderTags();
    }
});
el.tagInput.addEventListener('blur', () => { if (el.tagInput.value) { addTag(el.tagInput.value); el.tagInput.value = ''; } });
el.tags.onclick = () => el.tagInput.focus();

function myProfile() {
    return { gender: S.gender, country: S.country, genderFilter: S.genderFilter, countryFilter: S.countryFilter };
}

function renderCountryFilter() {
    const codes = [...new Set([S.country, ...COUNTRIES].filter(Boolean))];
    if (S.countryFilter !== 'any' && !codes.includes(S.countryFilter)) codes.push(S.countryFilter);
    codes.sort((a, b) => (a === S.country ? -1 : b === S.country ? 1 : countryName(a).localeCompare(countryName(b))));
    el.countryFilter.replaceChildren(new Option('🌐 Anywhere', 'any'));
    for (const c of codes) el.countryFilter.add(new Option(`${flagOf(c)} ${countryName(c)}${c === S.country ? ' (you)' : ''}`, c));
    el.countryFilter.value = S.countryFilter;
}

el.genderSelect.value = S.gender;
el.genderFilter.value = S.genderFilter;
el.timedCheck.checked = S.timed;
el.genderSelect.onchange = () => { S.gender = el.genderSelect.value; store.set('gender', S.gender); };
el.genderFilter.onchange = () => { S.genderFilter = el.genderFilter.value; store.set('genderFilter', S.genderFilter); };
el.countryFilter.onchange = () => { S.countryFilter = el.countryFilter.value; store.set('countryFilter', S.countryFilter); };
el.timedCheck.onchange = () => { S.timed = el.timedCheck.checked; store.set('timed', S.timed); };
renderCountryFilter();

el.nickInput.value = S.nick;
el.ageCheck.checked = store.get('ageConfirmed', false);
const refreshStart = () => { el.startBtn.disabled = !(el.ageCheck.checked && S.transport); };
el.ageCheck.onchange = () => { store.set('ageConfirmed', el.ageCheck.checked); refreshStart(); };

el.startBtn.onclick = async () => {
    S.nick = el.nickInput.value.trim().slice(0, 20);
    store.set('nick', S.nick);
    if (el.tagInput.value) { addTag(el.tagInput.value); el.tagInput.value = ''; }
    const locked = ageLockedUntil();
    if (locked) { renderAgeStatus(); toast(`Locked until ${new Date(locked).toLocaleString()}.`, true); return; }
    if (!ageVerified()) return runVerification();
    enterChat();
};

function enterChat() {
    el.welcome.classList.add('hidden');
    el.chat.classList.remove('hidden');
    el.leaveBtn.classList.remove('hidden');
    el.modeChip.classList.remove('hidden');
    startSearch();
}

el.leaveBtn.onclick = () => {
    S.searchAbort?.abort();
    S.searchAbort = null;
    clearTimeout(S.autoNextTimer);
    endSession({ notify: true });
    stopMedia();
    setPhase('idle');
    el.chat.classList.add('hidden');
    el.welcome.classList.remove('hidden');
    el.leaveBtn.classList.add('hidden');
    el.modeChip.classList.add('hidden');
};

window.addEventListener('pagehide', () => {
    S.session?.bus.send('bye');
    S.transport?.leave();
});

// =====================================================================
// Online count
// =====================================================================
async function refreshOnline() {
    if (!S.transport) return;
    try {
        const n = await S.transport.onlineCount();
        const text = n.toLocaleString();
        el.onlineCount.textContent = text;
        document.getElementById('onlineLabel').textContent = n === 1 ? 'person online now' : 'people online now';
        el.onlineChipCount.textContent = text;
        el.onlineChip.classList.remove('hidden');
    } catch (e) {
        console.warn('online count failed', e);
        el.onlineCount.closest('.online-pill').classList.add('hidden');
    }
}

// =====================================================================
// Installable app (PWA)
// =====================================================================
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
}
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e;
    el.installBtn.classList.remove('hidden');
});
el.installBtn.onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    el.installBtn.classList.add('hidden');
};
window.addEventListener('appinstalled', () => el.installBtn.classList.add('hidden'));

// =====================================================================
// Boot
// =====================================================================
setMode(S.mode);
renderTags();
renderAgeStatus();
detectCountry(store).then(code => { S.country = code; renderCountryFilter(); });
el.startBtn.textContent = 'Connecting…';
try {
    S.transport = firebaseConfig
        ? await createFirebaseTransport({ firebaseConfig, appId, initialAuthToken })
        : createLocalTransport();
    el.demoNote.classList.toggle('hidden', S.transport.kind !== 'local');
    el.startBtn.textContent = 'Start chatting';
    refreshOnline();
    setInterval(refreshOnline, S.transport.kind === 'local' ? 3000 : ONLINE_REFRESH_MS);
} catch (e) {
    console.error('transport init failed', e);
    el.startBtn.textContent = 'Service unavailable';
    const hint = e.code === 'auth/configuration-not-found' || e.code === 'auth/operation-not-allowed'
        ? ' (Firebase: enable Anonymous sign-in in Authentication)'
        : e.code === 'auth/unauthorized-domain' ? ' (Firebase: add this site to Authentication → Settings → Authorized domains)'
        : e.code ? ` (${e.code})` : '';
    toast('Could not connect to the matching service' + hint + '. Please refresh.', true);
}
refreshStart();
