import { createFirebaseTransport, createLocalTransport } from './transport.js';
import { COUNTRIES, flagOf, countryName, detectCountry } from './geo.js';
import { Effects, BACKGROUNDS, MASKS, FILTERS } from './effects.js';
import { NudityGuard } from './safety.js';
import { Friends, pairIdOf } from './friends.js';
import { Premium } from './premium.js';
import { Access } from './access.js';
import { openSheet, closeSheet, closeAllSheets, anySheetOpen } from './ui.js';
import { createGamesUi } from './games/ui.js';
import { generateHandle, generateAvatar, sanitizeAvatar, sanitizeHandle, avatarStyle } from './identity.js';
import { pickPrompts } from './icebreakers.js';
import { scanMessage, maskContact } from './shield.js';
import { meterStream } from './audio-meter.js';
import { callable } from './cloud.js';
import { initLanding } from './landing.js';
import { getApproxCell, parseLocMessage, locMessage, distanceBetweenCells, describeDistance } from './location.js';

// =====================================================================
// Config
// =====================================================================
const CFG = window.APP_CONFIG || {};
const injectedFirebase = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const firebaseConfig = CFG.firebase || injectedFirebase;
const appId = typeof __app_id !== 'undefined' ? __app_id : (CFG.appId || 'anon-connect');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
// ICE servers: STUN (and, in the local demo, any TURN) come from config.js. On the live site the relay (Cloudflare TURN)
// credentials are fetched from the turnCredentials function: short-lived, and only for people with an access pass.
const STATIC_ICE = CFG.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
const isTurnUrl = u => /^turns?:/i.test(u);
const hasTurnIn = list => list.some(srv => [].concat(srv.urls).some(isTurnUrl));
let iceServers = STATIC_ICE;
let iceExpiresAt = Infinity; // the static list never expires
const hasTurn = () => hasTurnIn(iceServers);
// With 'relay' our connection candidates are only relay addresses, so the other person never learns our IP address.
const iceConfig = () => ({ iceServers, iceTransportPolicy: hideIpOn() ? 'relay' : 'all' });
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
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    volumeOff: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
    menu: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
    gamepad: '<line x1="6" x2="10" y1="12" y2="12"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="15" x2="15.01" y1="13" y2="13"/><line x1="18" x2="18.01" y1="11" y2="11"/><rect width="20" height="12" x="2" y="6" rx="2"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
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
    installBtn: $('installBtn'),
    premiumBtn: $('premiumBtn'), premiumBtnText: $('premiumBtnText'), partnerBadge: $('partnerBadge'),
    paywall: $('paywall'), paywallClose: $('paywallClose'), paywallReason: $('paywallReason'), plans: $('plans'),
    paywallCta: $('paywallCta'), paywallHint: $('paywallHint'),
    friendsBtn: $('friendsBtn'), friendsBadge: $('friendsBadge'), addFriendBtn: $('addFriendBtn'),
    drawer: $('drawer'), drawerBack: $('drawerBack'), drawerTitle: $('drawerTitle'), drawerClose: $('drawerClose'),
    drawerAccount: $('drawerAccount'), friendList: $('friendList'), friendChat: $('friendChat'),
    fcDot: $('fcDot'), fcStatus: $('fcStatus'), fcCall: $('fcCall'), fcRemove: $('fcRemove'),
    fcMessages: $('fcMessages'), fcInput: $('fcInput'), fcSend: $('fcSend'),
    callModal: $('callModal'), callAvatar: $('callAvatar'), callName: $('callName'), callDecline: $('callDecline'), callAccept: $('callAccept'),
    shield: $('shield'), shieldTitle: $('shieldTitle'), shieldSub: $('shieldSub'), shieldActions: $('shieldActions'),
    shieldSkip: $('shieldSkip'), shieldReport: $('shieldReport'), fxBtn: $('fxBtn'), fxPanel: $('fxPanel'), fxClose: $('fxClose'), fxStatus: $('fxStatus'),
    round: $('round'), roundFill: $('roundFill'), roundTime: $('roundTime'), roundNote: $('roundNote'), extendBtn: $('extendBtn'),
    hideIpBtn: $('hideIpBtn'), hideIpLabel: $('hideIpLabel'), shieldShow: $('shieldShow'), reportWho: $('reportWho'),
    exitBtn: $('exitBtn'), shareBtn: $('shareBtn'), themeLabel: $('themeLabel'), soundLabel: $('soundLabel'), accentGrid: $('accentGrid'), menuSheet: $('menuSheet'),
    overlayChips: $('overlayChips'), overlayTip: $('overlayTip'), endPauseBtn: $('endPauseBtn'), endReportBtn: $('endReportBtn'),
    reactBar: $('reactBar'), reactLayer: $('reactLayer'), reactBtn: $('reactBtn'), gamesBtn: $('gamesBtn'), gameStage: $('gameStage'), gameDock: $('gameDock'),
    icebreakers: $('icebreakers'), gamesBtnText: $('gamesBtnText'),
    locCheck: $('locCheck'), likeBtn: $('likeBtn'), endLikeBtn: $('endLikeBtn'), myVibes: $('myVibes'),
    voiceStage: $('voiceStage'), voiceAvatarThem: $('voiceAvatarThem'), voiceNameThem: $('voiceNameThem'), voiceAvatarMe: $('voiceAvatarMe'),
    ringThem: $('ringThem'), ringMe: $('ringMe'), voiceTime: $('voiceTime'), nextSlotStage: $('nextSlotStage'), nextSlotComposer: $('nextSlotComposer'),
};

function h(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text; // always textContent: never inject peer content as HTML
    return node;
}

function toast(text, bad = false) {
    const t = h('div', 'toast' + (bad ? ' bad' : ''), text);
    t.setAttribute('role', bad ? 'alert' : 'status');
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
let friends = null;
let premium = null;
let access = null; // server-side bans (Firebase only); null in the local demo
const PREMIUM_CFG = { enabled: true, functionsRegion: 'asia-south1', plans: [], ...(CFG.premium || {}) };
// Premium only exists on the live (Firebase) site with premium.enabled; otherwise everything is unlocked.
// Note: firestore.rules also enforce the filters, so turning Premium off needs a rules change too.
const premiumExpected = !!firebaseConfig && PREMIUM_CFG.enabled;
const isPremium = () => (premium ? premium.active : !premiumExpected);
// What free users get in the effects panel; everything else is Premium.
const FREE_FX = { background: ['none', 'blur'], mask: ['none', 'shades'], filter: ['none', 'beauty'] };
const fxLocked = (kind, id) => !isPremium() && !FREE_FX[kind].includes(id);

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

// "Hide my IP address" is a Premium feature: it sends the whole chat through the TURN relay, which costs relay bandwidth.
// Free users connect directly (the relay is still used automatically on networks that block that). Premium people get it
// on by default on the live site and can switch it off in the menu; the local demo has no relay, so it starts off there.
S.hideIpPref = store.get('hideIp', null); // true / false once the person has chosen
const hideIpDefault = Boolean(firebaseConfig) && CFG.privacy?.hideIpForPremium !== false;
const hideIpWanted = () => Boolean(isPremium() && (S.hideIpPref ?? hideIpDefault));
function hideIpOn() { return hideIpWanted() && hasTurn(); }
let icePending = null;
/** Fetch (or renew) the relay credentials. Never throws; without them chats simply connect directly. */
function refreshIce(force = false) {
    if (S.transport?.kind !== 'firebase') return Promise.resolve();
    if (!force && hasTurn() && Date.now() < iceExpiresAt - 30 * 60000) return Promise.resolve();
    icePending ||= (async () => {
        try {
            const fn = await callable(S.transport, 'turnCredentials', PREMIUM_CFG.functionsRegion);
            const r = (await fn()).data;
            if (Array.isArray(r?.iceServers) && hasTurnIn(r.iceServers)) {
                iceServers = [...STATIC_ICE.filter(srv => ![].concat(srv.urls).some(isTurnUrl)), ...r.iceServers];
                iceExpiresAt = Date.now() + (Number(r.ttl) > 0 ? Number(r.ttl) : 3600) * 1000;
            }
        } catch (e) {
            console.warn('relay credentials unavailable', e);
        } finally {
            if (Date.now() >= iceExpiresAt) { iceServers = STATIC_ICE; iceExpiresAt = Infinity; } // expired and not renewed: don't offer dead credentials
            icePending = null;
            renderHideIp();
        }
    })();
    return icePending;
}
Object.defineProperty(S, 'hideIp', { get: hideIpOn, enumerable: true });

// Anonymous identity: a friendly generated handle + emoji avatar, rerolled with the dice button.
if (!S.nick) { S.nick = generateHandle(); store.set('nick', S.nick); }
S.avatar = sanitizeAvatar(store.get('avatar', null)) || generateAvatar();
store.set('avatar', S.avatar);
function applyAvatar(node, who) {
    const a = who?.avatar;
    node.textContent = a ? a.e : (who?.nick || '?')[0].toUpperCase();
    node.style.background = a ? avatarStyle(a) : '';
}

// =====================================================================
// Theme & sound
// =====================================================================
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    setIcon(el.themeBtn.querySelector('.icon'), theme === 'dark' ? 'sun' : 'moon');
    el.themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#090a12' : '#f6f5fb');
    store.set('theme', theme);
}
applyTheme(store.get('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
el.themeBtn.onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

// Colour themes: two are free, the rest are Premium.
const ACCENTS = [
    { id: 'rani', name: 'Rani', sw: 'linear-gradient(135deg,#e0286f,#ff7aa8)', free: true },
    { id: 'monsoon', name: 'Monsoon', sw: 'linear-gradient(135deg,#0a7f9c,#2dd4bf)', free: true },
    { id: 'diwali', name: 'Diwali', sw: 'linear-gradient(135deg,#d9650b,#ffb020)' },
    { id: 'holi', name: 'Holi', sw: 'linear-gradient(135deg,#a424d6,#ff5da2)' },
    { id: 'chai', name: 'Chai', sw: 'linear-gradient(135deg,#b4531a,#e8b27a)' },
    { id: 'mumbai', name: 'Mumbai', sw: 'linear-gradient(135deg,#3d5cff,#2dd4bf)' },
];
const currentAccent = () => document.documentElement.dataset.accent || 'rani';
function applyAccent(id, { save = true } = {}) {
    if (id === 'rani') delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = id;
    if (save) store.set('accent', id);
    renderAccents();
}
function renderAccents() {
    el.accentGrid.replaceChildren(...ACCENTS.map(a => {
        const locked = !a.free && !isPremium();
        const b = h('button', 'accent-opt' + (a.id === currentAccent() ? ' on' : '') + (locked ? ' locked' : ''));
        b.type = 'button';
        b.setAttribute('aria-pressed', String(a.id === currentAccent()));
        const sw = h('i');
        sw.style.setProperty('--sw', a.sw);
        b.append(sw, h('span', '', a.name));
        b.onclick = () => {
            if (locked) { closeSheet(el.menuSheet); return openPaywall('theme'); }
            applyAccent(a.id);
        };
        return b;
    }));
}

function renderHideIp() {
    const locked = hasTurn() && !isPremium();
    el.hideIpLabel.textContent = !hasTurn() ? 'Unavailable' : locked ? '👑 Premium' : (hideIpOn() ? 'On' : 'Off');
    el.hideIpBtn.disabled = !hasTurn();
    el.hideIpBtn.title = !hasTurn() ? 'The relay isn’t available right now'
        : locked ? 'Premium: keep your IP address hidden from the people you chat with'
        : 'When on, your connection goes through a relay so strangers never see your IP address. When off, they can.';
}
el.hideIpBtn.onclick = () => {
    if (!isPremium()) { closeSheet(el.menuSheet); return openPaywall('ip'); }
    S.hideIpPref = !hideIpOn();
    store.set('hideIp', S.hideIpPref);
    renderHideIp();
    // The connection of a chat that is already running was made with the old setting and stays as it is.
    const live = S.session && !S.session.ended;
    toast(S.hideIp
        ? (live ? 'Your IP address will be hidden from your next chat. The current one keeps its connection.' : 'Your IP address is hidden from strangers.')
        : 'Direct connections on: strangers can see your IP address.', !hideIpOn());
};
renderHideIp();

function renderSoundBtn() {
    setIcon(el.soundBtn.querySelector('.icon'), S.sound ? 'volume' : 'volumeOff');
    el.soundLabel.textContent = S.sound ? 'On' : 'Off';
}
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
let mediaGen = 0;       // bumped when media is stopped: a request finishing after that must throw its stream away
let mediaPending = null;
async function ensureMedia() {
    const wantVideo = S.mode === 'video';
    if (S.localStream && (!wantVideo || S.localStream.getVideoTracks().length)) return true;
    if (S.localStream) stopMedia(); // e.g. an audio-only stream left over from a voice chat
    if (mediaPending) return mediaPending;
    const gen = mediaGen;
    mediaPending = (async () => {
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: wantVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
        } catch (e) {
            console.warn('getUserMedia failed', e);
            if (gen === mediaGen) {
                toast(S.mode === 'voice' ? 'Microphone unavailable, switched to text only.' : 'Camera/microphone unavailable, switched to text only.', true);
                setMode('text');
            }
            return false;
        }
        // The person left, or changed mode, while the permission prompt was open: don't keep the camera or mic.
        if (gen !== mediaGen || S.mode === 'text' || (S.mode === 'video') !== wantVideo || S.localStream) {
            stream.getTracks().forEach(t => t.stop());
            return Boolean(S.localStream);
        }
        S.localStream = stream;
        el.localVideo.srcObject = stream;
        applyTrackState();
        if (wantVideo && fxActive()) applyEffects({});
        try {
            S.videoDevices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        } catch { S.videoDevices = []; }
        el.switchCamBtn.classList.toggle('hidden', S.videoDevices.length < 2);
        return true;
    })().finally(() => { mediaPending = null; });
    return mediaPending;
}

function stopMedia() {
    mediaGen++;
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
    el.micBtn.title = el.micBtn.ariaLabel = S.muted ? 'Unmute microphone' : 'Mute microphone';
    el.camBtn.title = el.camBtn.ariaLabel = S.camOff ? 'Turn camera on' : 'Turn camera off';
    el.micBtn.setAttribute('aria-pressed', String(S.muted));
    el.camBtn.setAttribute('aria-pressed', String(S.camOff));
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
/** The effects actually applied: the user's saved choice minus anything their plan doesn't include. */
function effectiveFx() {
    const fx = { ...S.fx };
    for (const kind of Object.keys(FREE_FX)) if (fxLocked(kind, fx[kind])) fx[kind] = 'none';
    return fx;
}
const fxActive = () => { const fx = effectiveFx(); return fx.background !== 'none' || fx.mask !== 'none' || fx.filter !== 'none'; };
const videoSender = () => S.session?.pc.getTransceivers().find(t => t.receiver.track?.kind === 'video')?.sender;
/** A mask or background is there to hide you: it must never silently fall back to the raw camera. */
const hidingFx = () => { const fx = effectiveFx(); return fx.background !== 'none' || fx.mask !== 'none'; };
const hidingReady = () => !hidingFx() || Boolean(S.effects?.active && S.effects.track);
const effectsSettled = (ms = 12000) => Promise.race([fxChain.catch(() => {}), new Promise(r => setTimeout(r, ms))]);
/** The video track that is previewed and sent: processed when effects are on, raw camera otherwise. */
const outVideoTrack = () => S.effects?.track || S.localStream?.getVideoTracks()[0] || null;
/** Unprocessed camera (for safety checks that must not be fooled by masks). */
const rawVideoEl = () => (S.effects?.track ? S.effects.video : el.localVideo);

let fxChain = Promise.resolve();
/** Update effect settings. Changes are applied one at a time, always using the latest settings. */
function applyEffects(partial) {
    S.fx = { ...S.fx, ...partial };
    store.set('fx', S.fx); // keep the saved choice even if it's locked right now (e.g. before Premium loads)
    renderFxPanel();
    fxChain = fxChain.then(syncEffects, syncEffects);
    return fxChain;
}

async function syncEffects() {
    if (!S.localStream) return;
    const fx = S.effects ||= new Effects(CFG.effects);
    const wanted = effectiveFx();
    const needsModels = wanted.background !== 'none' || wanted.mask !== 'none';
    if (needsModels) el.fxStatus.textContent = 'Loading…';
    try {
        await fx.set(wanted);
    } catch (e) {
        console.warn('effects failed to load', e);
        // Fail closed: the choice is kept, so a new chat sends no video (instead of your unmasked face) until you pick "None".
        toast('Your mask or background couldn’t load on this device, so your video won’t be sent. Choose “None” in Effects to send it as it is.', true);
        await fx.set({ background: 'none', mask: 'none', filter: wanted.filter }).catch(() => {});
        renderFxPanel();
        el.fxStatus.textContent = '';
        // Stop sending in a chat that is already running (your own preview shows the plain camera); choosing "None" resumes it.
        await videoSender()?.replaceTrack(null).catch(() => {});
        return;
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
            const locked = fxLocked(kind, opt.id);
            const thumb = typeof opt.thumb === 'function';
            const b = h('button', (opt.emoji ? 'emoji' : '') + (thumb ? ' thumb' : '') + (effectiveFx()[kind] === opt.id ? ' active' : '') + (locked ? ' locked' : ''), thumb ? '' : opt.label);
            b.type = 'button';
            if (thumb) {
                // Options can draw their own preview picture (effects code draws everything itself: no image files, no emoji).
                const c = document.createElement('canvas');
                c.width = c.height = 80;
                try { opt.thumb(c.getContext('2d'), 80, 80); } catch (e) { console.warn('thumb failed', opt.id, e); }
                b.append(c);
                b.setAttribute('aria-label', opt.label + (locked ? ' (Premium)' : ''));
            }
            b.title = locked ? `${opt.label || opt.id} (Premium)` : (opt.label || opt.id);
            b.dataset.id = opt.id;
            b.onclick = () => (locked ? openPaywall('effects') : applyEffects({ [kind]: opt.id }));
            return b;
        }));
    });
}
el.fxBtn.onclick = e => { e.stopPropagation(); el.fxPanel.classList.toggle('hidden'); renderFxPanel(); };
el.fxClose.onclick = () => el.fxPanel.classList.add('hidden');
renderFxPanel();

// =====================================================================
// Nudity safety: partner video is blurred until an on-device check passes,
// and your own camera is switched off if it shows nudity.
// =====================================================================
const SAFETY = { nudityModelUrl: 'models/nsfw/model.json', blurThreshold: 0.85, selfThreshold: 0.92, strikesForBan: 3, ...(CFG.safety || {}) };
let guard = null;
const getGuard = () => (guard ||= new NudityGuard(async () => (await loadFaceApi()).tf, SAFETY.nudityModelUrl));
const DAY_MS = 86400000;
const videoBannedUntil = () => { const u = store.get('videoBanUntil', 0); return u > Date.now() ? u : 0; };

let shieldState = 'off';
function setShield(state) {
    shieldState = state;
    el.remoteVideo.classList.toggle('shielded', state !== 'off');
    el.shield.classList.toggle('hidden', state === 'off');
    el.shield.classList.toggle('alert', state === 'hidden' || state === 'unavailable');
    el.shieldActions.classList.toggle('hidden', state !== 'hidden' && state !== 'unavailable');
    el.shieldShow.classList.toggle('hidden', state !== 'unavailable');
    if (state === 'checking') {
        el.shieldTitle.textContent = 'Checking video…';
        el.shieldSub.textContent = 'Video appears once our on-device safety check passes.';
    } else if (state === 'unavailable') {
        el.shieldTitle.textContent = 'Safety check unavailable';
        el.shieldSub.textContent = 'We can’t check this video for nudity right now, so it stays hidden. You can skip, or show it at your own risk.';
    } else if (state === 'hidden') {
        el.shieldTitle.textContent = 'Video hidden';
        el.shieldSub.textContent = 'It may contain nudity. It will reappear automatically if it’s clean again.';
    }
}

function startSafety(sess) {
    if (S.mode !== 'video') return;
    setShield('checking');
    const st = sess.safety = { bad: 0, good: 0, hits: 0, reported: false, selfBad: 0 };
    const g = getGuard();
    // If the model can't load (old device, offline CDN), don't leave the video blurred forever.
    sess.safetyFailOpen = setTimeout(() => { if (!sess.ended && !g.model && shieldState === 'checking') setShield('unavailable'); }, 20000);
    g.load().catch(e => { console.warn('nudity model failed to load', e); if (!sess.ended && shieldState === 'checking') setShield('unavailable'); });

    sess.safetyTimer = setInterval(async () => {
        const r = await g.check(el.remoteVideo).catch(() => null);
        if (!r || sess.ended) return;
        if (r.explicit >= SAFETY.blurThreshold) {
            st.good = 0;
            if (++st.bad >= 2) {
                if (shieldState !== 'hidden') sys('⚠️ Video hidden: it may contain nudity.', 'bad');
                setShield('hidden');
                if (++st.hits >= 3 && !st.reported) {
                    st.reported = true;
                    S.transport.report({ partnerId: sess.partnerId, roomId: sess.roomId, reason: 'auto-nudity' }).catch(() => {});
                }
            }
        } else {
            st.bad = 0;
            // The first clean frame lifts the initial blur; after a detection, require 3 clearly clean frames.
            const clean = shieldState === 'hidden' ? r.explicit < SAFETY.blurThreshold - 0.2 : true;
            if (clean && ++st.good >= (shieldState === 'hidden' ? 3 : 1)) setShield('off');
            if (!clean) st.good = 0;
        }
    }, 1500);

    sess.selfTimer = setInterval(async () => {
        if (sess.ended || S.camOff) return;
        const r = await g.check(rawVideoEl()).catch(() => null);
        if (!r || sess.ended) return;
        if (r.explicit >= SAFETY.selfThreshold) { if (++st.selfBad >= 2) selfViolation(sess); }
        else st.selfBad = 0;
    }, 3000);
}

async function selfViolation(sess) {
    sess.safety.selfBad = 0;
    S.camOff = true;
    applyTrackState();
    let strikes, max, banned;
    // On the live site the server counts strikes (per device and account) and decides the ban.
    const res = access ? await access.report('nudity-strike').catch(e => (console.warn('strike report failed', e), null)) : null;
    if (res) {
        if (!res.allowed) { applyAccess(res); return; } // fully restricted: the ban screen explains
        ({ strikes, strikesForBan: max } = res);
        store.set('videoBanUntil', res.videoBanUntil || 0);
        banned = res.videoBanUntil > Date.now();
    } else {
        const list = store.get('strikes', []).filter(t => Date.now() - t < DAY_MS);
        list.push(Date.now());
        strikes = list.length;
        max = SAFETY.strikesForBan;
        banned = strikes >= max;
        store.set('strikes', banned ? [] : list);
        if (banned) store.set('videoBanUntil', Date.now() + DAY_MS);
    }
    if (banned) {
        toast('Video chat is locked for 24 hours after repeated nudity on camera. Text chat is still available.', true);
        setMode('text');
        startSearch('Your camera was turned off.');
    } else if (!sess.ended) {
        toast(`Your camera was turned off: nudity detected. Strike ${strikes} of ${max}.`, true);
        sys('Your camera was turned off by the safety check. Turn it back on when you’re ready.', 'bad');
    }
}

el.shieldSkip.onclick = () => startSearch('You skipped the last chat.');
el.shieldShow.onclick = () => setShield('off');
el.shieldReport.onclick = () => {
    const sexual = document.querySelector('input[name="reason"][value="sexual"]');
    if (sexual) sexual.checked = true;
    el.reportBtn.click();
};

// =====================================================================
// Matching & connection lifecycle
// =====================================================================
const TIPS_ALL = [
    'A real question gets better chats than “hi”. Try “what’s the best thing you ate this week?”',
    'Esc twice skips to the next person.',
    'Never share OTPs, UPI IDs or your phone number with a stranger.',
    'Add interests in your preferences to meet people who like what you like.',
    'Report anything that feels off. Every report is reviewed.',
    'Nothing here is recorded. Video goes straight between you and them.',
];
function startTips() {
    stopTips();
    const tips = S.mode === 'video' ? [...TIPS_ALL, 'Try an effect while you wait: tap the sparkles in the controls.']
        : S.mode === 'voice' ? [...TIPS_ALL, 'Voice only: nobody sees you. Headphones make calls clearer.'] : TIPS_ALL;
    let i = Math.floor(Math.random() * tips.length);
    const show = () => { el.overlayTip.textContent = tips[i++ % tips.length]; };
    show();
    el.overlayTip.classList.remove('hidden');
    S.tipTimer = setInterval(show, 6000);
}
function stopTips() {
    clearInterval(S.tipTimer);
    el.overlayTip.classList.add('hidden');
}

function setPhase(phase, info = {}) {
    S.phase = phase;
    el.chat.dataset.phase = phase;
    const live = phase === 'connected';
    el.reactBtn.disabled = !live;
    el.likeBtn.disabled = !live || Boolean(S.session?.liked);
    if (phase === 'searching' || phase === 'connecting') el.likeBtn.classList.remove('on');
    el.endLikeBtn.classList.toggle('hidden', !(phase === 'ended' && info.report && S.last && !S.last.liked && S.transport?.kind === 'firebase'));
    el.gamesBtn.disabled = !live;
    el.gamesBtnText.disabled = !live;
    if (!live) { el.reactBar.classList.add('hidden'); el.reactBtn.classList.remove('on'); hideIcebreakers(); }
    el.msgInput.disabled = !live;
    el.sendBtn.disabled = !live;
    el.emojiBtn.disabled = !live;
    el.reportBtn.disabled = !(live || phase === 'connecting' || (phase === 'ended' && info.report));
    el.blockBtn.disabled = !(live || phase === 'connecting');
    el.addFriendBtn.disabled = !live || !!S.session?.friend;
    const friendCall = S.session?.friend;
    el.overlay.classList.toggle('hidden', live);
    el.overlaySpinner.classList.toggle('hidden', phase === 'ended');
    el.overlayNewBtn.classList.toggle('hidden', phase !== 'ended');
    el.endReportBtn.classList.toggle('hidden', !(phase === 'ended' && info.report));
    el.endPauseBtn.classList.toggle('hidden', !(phase === 'ended' && info.countdown));
    el.overlayChips.classList.toggle('hidden', !(phase === 'searching' && S.interests.length));
    if (phase === 'searching') el.overlayChips.replaceChildren(...S.interests.map(t => h('span', '', '#' + t)));
    if (phase === 'searching') startTips(); else stopTips();
    el.quality.classList.toggle('hidden', !live || S.mode === 'text');
    el.statusDot.className = 'status-dot ' + (live ? 'on' : phase === 'ended' ? '' : 'wait');
    disarmSkip();

    if (phase === 'searching') {
        el.overlayTitle.textContent = 'Looking for someone…';
        el.overlaySub.textContent = S.interests.length ? `Prioritizing people into ${S.interests.join(', ')}` : '';
        el.partnerName.textContent = 'Searching…';
        el.partnerSub.textContent = 'Finding a match';
        el.avatar.textContent = '?';
        el.avatar.style.background = '';
        el.partnerFlag.textContent = '';
        el.partnerBadge.classList.add('hidden');
        el.nextBtn.textContent = 'Stop';
        el.nextBtn.title = 'Stop searching';
    } else if (phase === 'connecting') {
        el.overlayTitle.textContent = friendCall ? `Calling ${friendCall.name}…` : 'Connecting…';
        el.overlaySub.textContent = friendCall ? 'Waiting for your friend to answer' : 'Setting up a secure peer‑to‑peer connection';
        el.partnerSub.textContent = 'Connecting';
        if (friendCall) { el.partnerName.textContent = friendCall.name; el.avatar.textContent = friendCall.name[0].toUpperCase(); }
        el.nextBtn.textContent = friendCall ? 'Hang up' : 'Next';
        el.nextBtn.title = friendCall ? 'End the call' : 'Next person (Esc)';
    } else if (phase === 'connected') {
        el.partnerSub.textContent = 'Connected';
        el.nextBtn.textContent = friendCall ? 'Hang up' : 'Next';
        if (!anySheetOpen()) el.msgInput.focus();
    } else if (phase === 'ended') {
        el.overlayTitle.textContent = info.title || 'Chat ended';
        el.overlaySub.textContent = info.sub || '';
        el.partnerSub.textContent = 'Disconnected';
        el.nextBtn.textContent = 'New';
        el.nextBtn.title = 'Find someone new (Esc)';
    }
}

function clearMessages() {
    hideIcebreakers();
    el.messages.replaceChildren();
    hideTyping();
}

function sys(text, kind = '') {
    const node = h('div', 'sys' + (kind ? ' ' + kind : ''), text);
    el.messages.appendChild(node);
    scrollMessages();
    return node;
}

let scrollQueued = false;
function scrollMessages() {
    // Keep the list bounded, and read layout at most once a frame however fast lines arrive.
    while (el.messages.childElementCount > 300) el.messages.firstElementChild.remove();
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; el.messages.scrollTop = el.messages.scrollHeight; });
}

/** note: optional message carried over from the chat that just ended (e.g. "Time's up"). */
async function startSearch(note) {
    clearTimeout(S.autoNextTimer);
    endSession({ notify: true });
    S.searchAbort?.abort();
    clearMessages();
    setPhase('searching');
    if (typeof note === 'string') sys(note);
    sys('Looking for someone to talk to…');

    const ac = new AbortController();
    S.searchAbort = ac;
    if (S.loc) {
        // Permission was granted earlier, so this is quick; don't let a slow GPS hold up the search for long.
        await Promise.race([
            refreshCell().catch(e => { S.loc = false; myCell = null; el.locCheck.checked = false; store.set('loc', false); toast(LOC_ERRORS[e?.code] || 'Distance turned off.', true); }),
            new Promise(r => setTimeout(r, 4000)),
        ]);
        if (ac.signal.aborted || S.searchAbort !== ac) return;
    }
    // The matching queue only accepts people with a current access pass (see firestore.rules).
    if (access) {
        const st = await access.fresh().catch(e => (console.warn('access check failed', e), null));
        if (ac.signal.aborted || S.searchAbort !== ac) return;
        if (st && applyAccess(st)) return;
        await Promise.race([refreshIce(), new Promise(r => setTimeout(r, 4000))]);
        if (ac.signal.aborted || S.searchAbort !== ac) return;
    }
    // "Hide my IP address" is on but the relay can't be reached: don't quietly connect directly and show the IP.
    if (hideIpWanted() && !hasTurn()) {
        toast('“Hide my IP address” is on, but the relay isn’t reachable right now, so no chat was started.', true);
        setPhase('ended', { title: 'Relay unavailable', sub: 'Try again in a moment, or turn off “Hide my IP address” in the menu to connect directly.' });
        return;
    }

    if (S.mode !== 'text') {
        const ok = await ensureMedia();
        if (ac.signal.aborted || S.searchAbort !== ac) return; // they left or pressed Stop while the permission prompt was open
        if (!ok && S.mode !== 'text') setMode('text');
    }
    // A saved mask / background gets time to load (and a late Premium answer time to arrive) before anyone can be matched with your camera.
    if (S.mode === 'video' && (S.fx.mask !== 'none' || S.fx.background !== 'none')) {
        if (premium) await premium.waitReady(3000);
        await effectsSettled();
        if (ac.signal.aborted || S.searchAbort !== ac) return;
    }
    const filtered = S.genderFilter !== 'any' || S.countryFilter !== 'any';
    const slowHint = setTimeout(() => {
        if (S.searchAbort === ac && filtered) sys('Still looking… your filters may be limiting matches. Try “Everyone” or “Anywhere” for faster chats.');
    }, 25000);
    ac.signal.addEventListener('abort', () => clearTimeout(slowHint));
    let match;
    const search = profile => S.transport.findMatch({
        mode: S.mode, interests: S.interests, blocked: [...S.blocked], profile,
    }, ac.signal);
    const searchAs = async profile => {
        try {
            return await search(profile);
        } catch (e) {
            // The database refused Premium options (pass expired, clock skew...): search as a free user.
            if (e?.code !== 'permission-denied' || !(profile.premium || profile.genderFilter !== 'any' || profile.countryFilter !== 'any')) throw e;
            console.warn('premium search refused; retrying without premium options', e);
            sys('Premium options aren’t active right now, so you’re searching everyone.');
            return search({ ...profile, premium: false, genderFilter: 'any', countryFilter: 'any' });
        }
    };
    try {
        try {
            match = await searchAs(myProfile());
        } catch (e) {
            // The access pass expired or was revoked: ask the server again, then retry once.
            if (e?.code !== 'permission-denied' || !access || ac.signal.aborted) throw e;
            console.warn('queue refused; renewing the access pass', e);
            const st = await access.check();
            if (ac.signal.aborted || S.searchAbort !== ac) return;
            if (applyAccess(st)) { ac.abort(); return; }
            if (S.mode !== 'text' && !S.localStream && !(await ensureMedia())) { /* switched to text */ }
            if (ac.signal.aborted || S.searchAbort !== ac) return;
            match = await searchAs(myProfile());
        }
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

async function connect({ roomId, role, bus, partnerId, friend = null }) {
    const pc = new RTCPeerConnection(iceConfig());
    const sess = S.session = {
        roomId, role, bus, partnerId, pc, dc: null, partner: null, friend,
        pendingCandidates: [], ended: false, startedAt: 0, statsTimer: null, connectTimer: null, clockTimer: null,
    };

    if (S.mode !== 'text' && S.localStream) {
        // startSearch already gave a saved mask / background time to load; if it still isn't ready, no video is sent.
        const withhold = S.mode === 'video' && !hidingReady();
        if (withhold) toast('Your mask or background isn’t ready, so your video isn’t being sent in this chat.', true);
        const send = new MediaStream([...S.localStream.getAudioTracks(), S.mode === 'video' && !withhold ? outVideoTrack() : null].filter(Boolean));
        send.getTracks().forEach(t => pc.addTrack(t, send));
    }
    setPhase('connecting');
    startSafety(sess);
    pc.onicecandidate = e => { if (e.candidate) bus.send('candidate', e.candidate.toJSON()); };
    // Only accept the kind of media this chat is for: a stranger can't push sound into a text chat or video into a voice chat.
    const remote = new MediaStream();
    pc.ontrack = e => {
        if (sess.ended || S.mode === 'text') return;
        if (e.track.kind === 'video' && S.mode !== 'video') return;
        if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track);
        if (el.remoteVideo.srcObject !== remote) el.remoteVideo.srcObject = remote;
    };
    pc.onconnectionstatechange = () => {
        if (sess.ended) return;
        if (pc.connectionState === 'failed') {
            partnerLeft('Connection failed', hideIpOn()
                ? 'The privacy relay could not connect. You can turn off “Hide my IP address” in the menu to allow direct connections (this shows your IP address to the other person).'
                : 'The network blocked a direct connection. A TURN server fixes this.');
        } else if (pc.connectionState === 'disconnected') {
            setTimeout(() => { if (!sess.ended && pc.connectionState === 'disconnected') partnerLeft(leftText(sess)); }, 5000);
        }
    };

    if (role === 'offerer') attachChannel(sess, pc.createDataChannel('chat', { ordered: true }));
    else {
        // One channel, named 'chat'. Extra channels would re-run the opening sequence and wipe what the person is reading.
        pc.ondatachannel = e => {
            if (sess.dc || e.channel.label !== 'chat') { e.channel.close(); return; }
            attachChannel(sess, e.channel);
        };
    }

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
                partnerLeft(sess.friend && S.phase === 'connecting' ? `${sess.friend.name} declined` : leftText(sess));
            }
        } catch (e) {
            console.warn('signaling error', type, e);
        }
    });

    sess.connectTimer = setTimeout(() => {
        if (!sess.ended && S.phase === 'connecting') {
            partnerLeft(friend ? 'No answer' : 'Could not connect', friend ? `${friend.name} didn’t pick up.` : 'The other person didn’t respond in time.');
        }
    }, friend ? 45000 : CONNECT_TIMEOUT_MS);

    if (role === 'offerer') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        bus.send('offer', { type: offer.type, sdp: offer.sdp });
    }
}

const leftText = sess => (sess.friend ? 'Call ended' : 'Stranger disconnected');

const MAX_PEER_BYTES = 4096;
const FLOOD_LIMIT = 200;
/** Token bucket: a burst of 20 messages, then 10 a second. */
function takePeerToken(sess) {
    const now = Date.now();
    const b = sess.bucket ||= { tokens: 20, at: now };
    b.tokens = Math.min(20, b.tokens + (now - b.at) / 100);
    b.at = now;
    sess.flood ||= 0;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
}

function attachChannel(sess, dc) {
    sess.dc = dc;
    dc.onopen = () => {
        if (sess.ended || sess.opened) return;
        sess.opened = true;
        clearTimeout(sess.connectTimer);
        sess.startedAt = Date.now();
        setPhase('connected');
        clearMessages();
        sys(sess.friend ? `You're on a call with ${sess.friend.name}.` : "You're now chatting with a stranger. Say hi! 👋", 'good');
        el.partnerName.textContent = sess.friend?.name || 'Stranger';
        el.avatar.textContent = (sess.friend?.name || 'S')[0].toUpperCase();
        el.avatar.style.background = '';
        if (sess.friend && sess.role === 'offerer') friends?.clearCall(sess.friend.id);
        sendData({ t: 'hello', nick: S.nick, avatar: S.avatar, loc: locOffer(), interests: S.interests, country: S.country, gender: S.gender, timed: S.timed, premium: isPremium() });
        if (S.timed && !sess.friend) startRound(sess);
        sendData({ t: 'av', muted: S.muted, camOff: S.camOff });
        sess.games = createGamesUi({
            send: sendData,
            say: (text, kind) => {
                if (sess !== S.session || Date.now() - (sess.sayAt || 0) < 1500) return;
                sess.sayAt = Date.now();
                sys(text, kind || '');
            },
            getContainer: () => (S.mode !== 'text' && matchMedia('(min-width: 900px)').matches ? el.gameStage : el.gameDock),
            getName: () => sess.partner?.nick || 'Stranger',
            attention: kind => {
                if (Date.now() - (sess.attnAt || 0) < 10000) return; // an invite storm gets one nudge
                sess.attnAt = Date.now();
                SOUND.message();
                if (kind === 'invite') toast(`🎮 ${sess.partner?.nick || 'Stranger'} invited you to play a game.`);
                el.gamesBtn.classList.add('on'); el.gamesBtnText.classList.add('on');
                setTimeout(() => { el.gamesBtn.classList.remove('on'); el.gamesBtnText.classList.remove('on'); }, 4000);
            },
        });
        SOUND.match();
        sess.clockTimer = setInterval(() => renderPartnerSub(sess), 1000);
        if (S.mode !== 'text') startStats(sess);
        if (S.mode === 'video') startAgeRecheck(sess);
        if (S.mode === 'voice') startVoiceStage(sess);
    };
    dc.onmessage = e => {
        if (sess.ended) return;
        // The other side can be a modified client: bound the size and the rate of everything it sends.
        if (typeof e.data !== 'string' || e.data.length > MAX_PEER_BYTES) return;
        if (!takePeerToken(sess)) {
            if (++sess.flood === FLOOD_LIMIT && !sess.ended) {
                S.transport.report({ partnerId: sess.partnerId, roomId: sess.roomId, reason: 'spam' }).catch(() => {});
                partnerLeft('Connection closed', 'The other person was sending far too fast.');
            }
            return;
        }
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        onPeerData(sess, msg);
    };
    dc.onclose = () => { if (!sess.ended && S.phase === 'connected') partnerLeft(leftText(sess)); };
}

function sendData(obj) {
    const dc = S.session?.dc;
    if (dc?.readyState === 'open') dc.send(JSON.stringify(obj));
}

function hideIcebreakers() { el.icebreakers.classList.add('hidden'); el.icebreakers.replaceChildren(); }
function showIcebreakers() {
    const prompts = pickPrompts({ interests: S.interests, lang: 'en', count: 3 });
    if (!prompts.length) return;
    el.icebreakers.replaceChildren(...prompts.map(t => {
        const b = h('button', 'ibreak', t);
        b.type = 'button';
        b.title = 'Send this as your first message';
        b.onclick = () => { el.msgInput.value = t; sendMessage(); };
        return b;
    }));
    el.icebreakers.classList.remove('hidden');
}

function renderMatchCard(p, shared) {
    const card = h('div', 'match-card');
    const av = h('div', 'avatar');
    applyAvatar(av, p);
    card.append(av, h('h4', '', p.nick));
    const where = [p.country ? `${flagOf(p.country)} ${countryName(p.country)}` : '', p.gender === 'male' ? 'Male' : p.gender === 'female' ? 'Female' : ''].filter(Boolean).join(' · ');
    if (where) card.appendChild(h('div', 'where', where));
    if (shared.length) {
        const chips = h('div', 'shared-chips');
        chips.append(...shared.map(t => h('span', '', '#' + t)));
        card.append(h('div', 'hint', 'You both like'), chips);
    } else {
        card.appendChild(h('div', 'hint', 'Say hi 👋 You can skip or report anytime.'));
    }
    el.messages.appendChild(card);
    scrollMessages();
}

function onPeerData(sess, msg) {
    switch (msg.t) {
        case 'hello': {
            if (sess.partner) break; // only the first greeting counts
            const nick = sanitizeHandle(msg.nick) || 'Stranger';
            const avatar = sanitizeAvatar(msg.avatar);
            const interests = Array.isArray(msg.interests) ? msg.interests.map(String).slice(0, MAX_INTERESTS) : [];
            const country = typeof msg.country === 'string' && /^[A-Z]{2}$/.test(msg.country) ? msg.country : '';
            const gender = ['male', 'female'].includes(msg.gender) ? msg.gender : '';
            sess.partner = { nick, interests, country, gender, avatar, loc: msg.loc === true };
            el.partnerName.textContent = nick;
            el.partnerFlag.textContent = country ? flagOf(country) : '';
            el.partnerFlag.title = country ? countryName(country) : '';
            applyAvatar(el.avatar, sess.partner);
            if (S.mode === 'voice') { applyAvatar(el.voiceAvatarThem, sess.partner); el.voiceNameThem.textContent = nick; }
            if (msg.timed && !sess.round && !sess.friend) startRound(sess);
            // A Premium badge is only shown after checking the partner's pass in the database.
            if (msg.premium && premium) premium.verify(sess.partnerId, sess.roomId).then(ok => {
                if (ok && sess === S.session) el.partnerBadge.classList.remove('hidden');
            });
            renderMatchCard(sess.partner, interests.filter(i => S.interests.includes(i)));
            if (!sess.friend) showIcebreakers();
            maybeSendCell(sess);
            if (!sess.friend) likeCount(sess.partnerId).then(n => {
                if (!n || sess !== S.session) return;
                document.querySelector('.match-card')?.appendChild(h('div', 'vibes', vibesText(n)));
            });
            if (locOffer() && !sess.partner.loc) document.querySelector('.match-card')?.appendChild(h('div', 'hint', 'They haven’t turned on distance.'));
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
        case 'friend-req':
        case 'friend-ok':
        case 'friend-no':
        case 'friend-created':
        case 'friend-done':
            onFriendMessage(sess, msg);
            break;
        case 'extend':
            sess.partnerExtend = true;
            tryExtend(sess);
            break;
        case 'react':
            receiveReaction(sess, msg);
            break;
        case 'loc':
            receiveCell(sess, msg);
            break;
        case 'like':
            if (sess.likeShown) break; // a notification only: counts come from the database
            sess.likeShown = true;
            sys(`💜 ${sess.partner?.nick || 'Stranger'} sent you a good vibe.`, 'good');
            SOUND.match();
            break;
        case 'game':
            sess.games?.receive(msg);
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
    if (sess.partnerAv?.muted && S.mode !== 'text') flags.push('muted');
    if (sess.partnerAv?.camOff && S.mode === 'video') flags.push('camera off');
    el.partnerSub.textContent = ['Connected', clock, sess.distText ? `📍 ${sess.distText}` : '', ...flags].filter(Boolean).join(' · ');
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
            el.qtext.textContent = q === 'good' ? 'Good' : q === 'ok' ? 'Fair' : 'Poor';
            el.quality.title = `Round-trip time: ${rtt} ms`;
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
    clearInterval(sess.safetyTimer);
    clearInterval(sess.selfTimer);
    sess.games?.dispose();
    sess.stopMeters?.forEach(stop => stop?.());
    clearInterval(sess.voiceTimer);
    if (sess.friend && sess.role === 'offerer') friends?.clearCall(sess.friend.id); // stop the friend's phone ringing
    el.partnerBadge.classList.add('hidden');
    clearTimeout(sess.safetyFailOpen);
    setShield('off');
    el.round.classList.add('hidden');
    try { sess.dc?.close(); } catch { /* ignore */ }
    try { sess.pc.close(); } catch { /* ignore */ }
    sess.bus.close();
    if (!sess.friend) S.last = { partnerId: sess.partnerId, roomId: sess.roomId, at: Date.now(), nick: sess.partner?.nick };
    S.session = null;
    el.remoteVideo.srcObject = null;
    hideTyping();
    setTypingSent(false);
}

function partnerLeft(title, sub = '') {
    if (!S.session) return;
    const friend = S.session.friend;
    if (friend && S.session.role === 'offerer') friends?.clearCall(friend.id);
    endSession({ notify: true });
    SOUND.leave();
    sys(title + '.', 'bad');
    if (friend) {
        setPhase('ended', { title, sub: sub || 'Press “Find someone new” to meet strangers.' });
        return;
    }
    let left = 3;
    setPhase('ended', { title, sub: sub || `Next chat in ${left}…`, report: true, countdown: true });
    // A countdown with Pause, so someone who needs a breath (or to report) isn't rushed along.
    S.autoNextTimer = setInterval(() => {
        if (S.phase !== 'ended') return clearInterval(S.autoNextTimer);
        if (anySheetOpen()) return; // reporting or reading something: don't move on underneath them
        if (--left <= 0) { clearInterval(S.autoNextTimer); startSearch(); return; }
        if (!sub) el.overlaySub.textContent = `Next chat in ${left}…`;
    }, 1000);
}
el.endPauseBtn.onclick = () => {
    clearInterval(S.autoNextTimer);
    el.endPauseBtn.classList.add('hidden');
    el.overlaySub.textContent = 'Paused. Report them if you need to, or press “Find someone new” when you’re ready.';
};

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
    if (S.session?.friend) return partnerLeft('Call ended');
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
const RISK_COPY = {
    money: 'They brought up money, OTPs or payments. Never send either.',
    'explicit-ask': 'They asked for photos or private video. You never have to, and you can report this.',
    default: 'They shared contact details or a link. Moving to another app is how many scams start.',
};
function riskCard(scan, bubble, original, senderId) {
    const kind = scan.kinds.includes('explicit-ask') ? 'explicit-ask' : scan.kinds.includes('money') ? 'money' : 'default';
    const card = h('div', 'alert-card');
    card.append(h('b', '', 'Heads up. '), document.createTextNode(RISK_COPY[kind]));
    const row = h('div', 'row');
    const show = h('button', 'btn btn-ghost btn-sm', 'Show anyway');
    show.type = 'button';
    show.onclick = () => { bubble.textContent = maskProfanity(original); bubble.classList.remove('masked'); show.remove(); };
    const block = h('button', 'btn btn-ghost btn-sm', 'Block & next');
    block.type = 'button';
    block.onclick = () => {
        blockCurrent({ partnerId: senderId });
        if (S.session?.partnerId === senderId || S.phase === 'ended') startSearch(); else toast('Blocked. You won’t be matched with them again.');
    };
    row.append(show, block);
    card.appendChild(row);
    return card;
}

function addMessage(who, text) {
    hideIcebreakers();
    const wrap = h('div', 'msg ' + who);
    const scan = who === 'them' ? scanMessage(text) : { risky: false, kinds: [] };
    const shown = who === 'them' ? maskProfanity(scan.risky ? maskContact(text) : text) : text;
    if (EMOJI_ONLY.test(shown)) wrap.classList.add('emoji-only');
    const bubble = h('div', 'bubble' + (scan.risky ? ' masked' : ''), shown);
    wrap.appendChild(bubble);
    if (scan.risky) wrap.appendChild(riskCard(scan, bubble, text, S.session?.partnerId));
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

    if ((PII.test(text) || scanMessage(text).risky) && !S.piiConfirmed) {
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
// Approximate distance. Off by default, and only ever shared with a partner who also turned it on.
// The phone rounds its position to a grid square (config location.cellDeg, ~5 km) the moment it is read and
// only that square goes to the partner, over the private connection. Nothing is stored or sent to our servers,
// and distances are shown in coarse bands, never exact.
// =====================================================================
const CELL_DEG = CFG.location?.cellDeg || 0.05;
S.loc = store.get('loc', false);
let myCell = null; // in memory only
el.locCheck.checked = S.loc;
const LOC_ERRORS = {
    denied: 'Location is blocked. Allow it in your browser settings to show distance.',
    unavailable: 'Couldn’t find your location right now.',
    timeout: 'Finding your location took too long.',
    unsupported: 'This device can’t share an approximate location.',
};
async function refreshCell() {
    myCell = await getApproxCell({ cellDeg: CELL_DEG });
    return myCell;
}
let locRequest = 0;
el.locCheck.onchange = async () => {
    const mine = ++locRequest;
    if (!el.locCheck.checked) { S.loc = false; myCell = null; store.set('loc', false); return; }
    try {
        await refreshCell();
        // Unticked (or ticked again) while the position fix was pending: this answer is out of date, so nothing is turned on.
        if (mine !== locRequest || !el.locCheck.checked) { if (!el.locCheck.checked) myCell = null; return; }
        S.loc = true;
        store.set('loc', true);
        toast('Distance on. Only an approximate area (about 5 km) is shared, and only with a chat partner who also turned it on.');
    } catch (e) {
        el.locCheck.checked = false;
        S.loc = false;
        toast(LOC_ERRORS[e?.code] || 'Couldn’t turn on distance.', true);
    }
};
/** Called once the chat channel is open: tell the partner we offer distance. */
const locOffer = () => S.loc && myCell !== null;
function maybeSendCell(sess) {
    // Only to a partner who said they share too, and only once per chat.
    if (!locOffer() || !sess.partner?.loc || sess.locSent) return;
    sess.locSent = true;
    sendData(locMessage(myCell));
}
function receiveCell(sess, msg) {
    if (!locOffer() || sess.partnerCell || !sess.partner?.loc) return; // we never read a location we didn't ask for, or that they didn't offer
    const cell = parseLocMessage(msg, CELL_DEG);
    if (!cell) return;
    sess.partnerCell = cell;
    sess.distText = describeDistance(distanceBetweenCells(myCell, cell, CELL_DEG));
    if (!sess.distText) return;
    document.querySelector('.match-card .where')?.append(document.createTextNode(` · 📍 ${sess.distText}`));
    if (!document.querySelector('.match-card .where')) document.querySelector('.match-card')?.insertBefore(h('div', 'where', `📍 ${sess.distText}`), document.querySelector('.match-card .hint'));
    renderPartnerSub(sess);
}

// =====================================================================
// Voice chat: two avatars whose rings pulse with each person's voice
// =====================================================================
function startVoiceStage(sess) {
    applyAvatar(el.voiceAvatarMe, { avatar: S.avatar, nick: S.nick });
    applyAvatar(el.voiceAvatarThem, sess.partner || { nick: sess.friend?.name || 'Stranger' });
    el.voiceNameThem.textContent = sess.partner?.nick || sess.friend?.name || 'Stranger';
    const ring = (node, on) => lvl => { node.style.setProperty('--lvl', on() ? lvl.toFixed(2) : '0'); };
    sess.stopMeters = [
        meterStream(S.localStream, ring(el.ringMe, () => !S.muted)),
        meterStream(el.remoteVideo.srcObject, ring(el.ringThem, () => true)),
    ];
    // The remote stream may arrive just after the channel opens.
    el.remoteVideo.addEventListener('loadedmetadata', function again() {
        el.remoteVideo.removeEventListener('loadedmetadata', again);
        if (sess.ended) return;
        sess.stopMeters[1]?.();
        sess.stopMeters[1] = meterStream(el.remoteVideo.srcObject, ring(el.ringThem, () => true));
    });
    sess.voiceTimer = setInterval(() => {
        const secs = Math.floor((Date.now() - sess.startedAt) / 1000);
        el.voiceTime.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    }, 1000);
}

// =====================================================================
// Reactions: emoji that float up over the video for both of you
// =====================================================================
const REACTIONS = ['❤️', '😂', '🔥', '👏', '🙏', '😮'];
el.reactBar.append(...REACTIONS.map(e => {
    const b = h('button', '', e);
    b.type = 'button';
    b.setAttribute('aria-label', `Send ${e}`);
    b.onclick = () => sendReaction(e);
    return b;
}));
el.gamesBtn.onclick = el.gamesBtnText.onclick = () => S.session?.games?.toggle();
// A rotated tablet or resized window moves the game card between the video and the panel.
matchMedia('(min-width: 900px)').addEventListener('change', () => S.session?.games?.refresh());
el.reactBtn.onclick = () => {
    el.reactBar.classList.toggle('hidden');
    el.reactBtn.classList.toggle('on', !el.reactBar.classList.contains('hidden'));
};
function floatEmoji(e) {
    if (S.mode === 'text') return false;
    const node = h('span', 'float-emoji', e);
    node.style.left = `${12 + Math.random() * 70}%`;
    node.style.setProperty('--dx', `${Math.round(Math.random() * 80 - 40)}px`);
    el.reactLayer.appendChild(node);
    node.addEventListener('animationend', () => node.remove());
    return true;
}
function sendReaction(e) {
    if (S.phase !== 'connected' || !REACTIONS.includes(e)) return;
    const now = Date.now();
    S.reactTimes = (S.reactTimes || []).filter(t => now - t < 4000);
    if (S.reactTimes.length >= 8) return;
    S.reactTimes.push(now);
    sendData({ t: 'react', e });
    floatEmoji(e);
}
function receiveReaction(sess, msg) {
    if (!REACTIONS.includes(msg.e)) return;
    const now = Date.now();
    sess.reactTimes = (sess.reactTimes || []).filter(t => now - t < 4000);
    if (sess.reactTimes.length >= 10) return; // the other side is spamming
    sess.reactTimes.push(now);
    if (!floatEmoji(msg.e)) sys(`${sess.partner?.nick || 'Stranger'} sent ${msg.e}`);
    SOUND.message();
}
el.videoWrap.addEventListener('dblclick', e => {
    if (e.target.closest('button, input, textarea, .game-stage, .fx-panel, .react-bar, .stage-dock')) return;
    sendReaction('❤️');
});

el.shareBtn.onclick = async () => {
    const url = location.origin + location.pathname.replace(/index\.html$/, '');
    const text = 'Come chat with me on Anonymous Connect: free random video & text chat, age-checked and private.';
    try {
        if (navigator.share) { await navigator.share({ title: 'Anonymous Connect', text, url }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener');
};

// =====================================================================
// Good vibes: a like for someone you actually chatted with. The server checks the chat was real, limits how many
// you can send, and keeps the count, so numbers can't be faked from a browser.
// =====================================================================
const MIN_LIKE_MS = 30000;
/** A person's total, read from the database (never from what they tell us). null = unknown. */
async function likeCount(uid) {
    const fb = S.transport?.fb;
    if (!fb || !uid) return null;
    try {
        const snap = await fb.fs.getDoc(fb.fs.doc(fb.db, ...fb.base, 'reputation', uid));
        return snap.exists() ? Math.max(0, Number(snap.data().likes) || 0) : 0;
    } catch { return null; }
}
const vibesText = n => `💜 ${n.toLocaleString()} good vibe${n === 1 ? '' : 's'}`;
async function sendLike(t) {
    if (!t || t.liked || t.liking) return;
    if (t === S.session && Date.now() - t.startedAt < MIN_LIKE_MS) { toast('Chat for 30 seconds first, then you can send a good vibe.', true); return; }
    t.liking = true;
    try {
        if (S.transport.kind === 'firebase') {
            const fn = await callable(S.transport, 'likeUser', PREMIUM_CFG.functionsRegion);
            await fn({ roomId: t.roomId });
        }
        t.liked = true;
        if (t === S.session) sendData({ t: 'like' });
        const who = t.partner?.nick || t.nick;
        toast(`💜 Good vibe sent${who ? ` to ${who}` : ''}.`);
        el.likeBtn.classList.add('on');
        el.likeBtn.disabled = true;
        el.endLikeBtn.classList.add('hidden');
    } catch (e) {
        console.warn('like failed', e);
        if (e?.code === 'functions/already-exists') {
            // Same person within 24 h: nothing more to send, so show it as sent.
            t.liked = true;
            el.likeBtn.classList.add('on');
            el.likeBtn.disabled = true;
            el.endLikeBtn.classList.add('hidden');
            toast('You already sent them a good vibe today. 💜');
        } else {
            const msg = { 'functions/resource-exhausted': 'That’s a lot of good vibes for today. Come back tomorrow.', 'functions/failed-precondition': e?.message }[e?.code];
            toast(msg || 'Couldn’t send a good vibe. Try again.', true);
        }
    } finally {
        t.liking = false;
    }
}
el.likeBtn.onclick = () => sendLike(S.session);
el.endLikeBtn.onclick = () => sendLike(S.last);
el.menuSheet.addEventListener('sheet:open', async () => {
    const n = S.transport?.kind === 'firebase' ? await likeCount(S.transport.uid) : null;
    el.myVibes.textContent = n === null ? '–' : n.toLocaleString();
});
// Phones: the header buttons that don't fit live in a "This chat" sheet and forward to the real buttons.
$('moreSheet').addEventListener('sheet:open', () => {
    document.querySelectorAll('[data-proxy]').forEach(b => b.classList.toggle('hidden', $(b.dataset.proxy)?.classList.contains('hidden')));
});
document.querySelectorAll('[data-proxy]').forEach(b => {
    b.onclick = () => {
        closeSheet($('moreSheet'));
        const target = $(b.dataset.proxy);
        if (!target || target.disabled || target.classList.contains('hidden')) { toast('Not available right now.', true); return; }
        target.click();
    };
});

// =====================================================================
// Report & block
// =====================================================================
/** 'Priya Sharma' / 'priya@gmail.com' -> 'P•••' so a screen share doesn't reveal who you are. */
const maskName = name => { const t = String(name || '').trim(); return t ? t[0].toUpperCase() + '•••' : 'Google'; };

function blockCurrent(target = S.session || S.last) {
    const id = target?.partnerId;
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
/** The person to report: the current partner, or the one who just left (so a quick disconnect can still be reported). */
const reportTarget = () => S.session || S.last || null;
let reportFor = null; // fixed when the sheet opens, so a new match can never be reported by mistake
function openReport() {
    const t = reportTarget();
    if (!t) { toast('Too late to report this person.', true); return; }
    reportFor = { partnerId: t.partnerId, roomId: t.roomId, nick: t.partner?.nick || t.nick || 'Stranger', live: t === S.session };
    el.reportWho.textContent = `You’re reporting ${reportFor.nick}.`;
    openSheet(el.reportModal);
}
el.reportBtn.onclick = openReport;
el.endReportBtn.onclick = openReport;
el.reportCancel.onclick = () => { reportFor = null; closeSheet(el.reportModal); };
el.reportModal.addEventListener('sheet:close', () => { reportFor = null; });
el.reportSubmit.onclick = async () => {
    const target = reportFor;
    reportFor = null;
    closeSheet(el.reportModal);
    if (!target) { toast('Too late to report this person.', true); return; }
    const reason = document.querySelector('input[name="reason"]:checked')?.value || 'other';
    S.blocked.add(target.partnerId);
    store.set('blocked', [...S.blocked].slice(-200));
    S.transport.report({ partnerId: target.partnerId, roomId: target.roomId, reason })
        .then(() => toast('Thanks, report sent.'))
        .catch(e => toast(e?.code === 'permission-denied' ? 'You already reported this chat.' : 'Could not send report.', e?.code !== 'permission-denied'));
    if (S.last?.partnerId === target.partnerId) S.last = null;
    // Only move on if they are who we are still looking at; never drop someone new who just connected.
    if (S.session?.partnerId === target.partnerId || S.phase === 'ended') startSearch();
};

// =====================================================================
// Keyboard shortcuts
// =====================================================================
document.addEventListener('keydown', e => {
    if (el.chat.classList.contains('hidden') || anySheetOpen() || e.repeat) return;
    if (e.key === 'Escape') {
        // Whatever is open closes first; only a bare Esc means "next".
        const popovers = [el.emojiPop, el.reactBar, el.fxPanel];
        const open = popovers.find(p => !p.classList.contains('hidden'));
        if (open) { open.classList.add('hidden'); el.reactBtn.classList.toggle('on', !el.reactBar.classList.contains('hidden')); e.preventDefault(); return; }
        if (!el.drawer.classList.contains('hidden')) { el.drawer.classList.add('hidden'); return; }
        e.preventDefault();
        onNext();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm' && S.mode !== 'text') {
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
    enabled: true, passAge: 21, minAge: 18, maxAttempts: 3, cooldownMinutes: 15, lockHours: 24, validDays: 30,
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

async function finishAttempt(age) {
    stopVerifyCamera();
    vEl.msg.textContent = '';
    if (age == null) {
        return showVerifyResult('warn', 'We couldn’t finish the check. Face a light source (a window or lamp in front of you), take off sunglasses, and try again.', { retry: true });
    }
    setStep('age', 'done');
    if (age >= AGE.passAge) {
        store.set('ageVerifiedUntil', Date.now() + AGE.validDays * 86400000);
        store.set('ageAttempts', 0);
        renderAgeStatus();
        return showVerifyResult('ok', '✓ Verified. You’re good to go.', { cont: true });
    }
    // On the live site the server records the outcome and decides any lockout, for this
    // device, network and account (so a private window or a new account doesn't reset it).
    const report = async type => {
        if (!access) return null;
        vEl.msg.textContent = 'Saving result…';
        const res = await access.report(type).catch(e => (console.warn('age report failed', e), null));
        vEl.msg.textContent = '';
        if (res && !res.allowed) { closeVerify(); applyAccess(res); }
        return res;
    };
    if (age < AGE.minAge) {
        const res = await report('underage');
        if (res && !res.allowed) return;
        store.set('ageLockUntil', Date.now() + AGE.lockHours * 3600000);
        store.set('ageAttempts', 0);
        renderAgeStatus();
        return showVerifyResult('bad', `Access denied. Our check suggests you may be under ${AGE.minAge}. This service is for adults only. Try again in ${AGE.lockHours} hours.`);
    }
    const res = await report('age-inconclusive');
    if (res && !res.allowed) return;
    const attempts = res ? AGE.maxAttempts - res.triesLeft : store.get('ageAttempts', 0) + 1;
    if (!res) store.set('ageAttempts', attempts);
    if (attempts >= AGE.maxAttempts) {
        // Inconclusive isn't a fail: a short cooldown, not the long lockout used for under-age results.
        store.set('ageLockUntil', Date.now() + AGE.cooldownMinutes * 60000);
        store.set('ageAttempts', 0);
        renderAgeStatus();
        return showVerifyResult('warn', `We couldn’t confirm you’re over ${AGE.minAge} after ${AGE.maxAttempts} tries. Please try again in ${AGE.cooldownMinutes} minutes with brighter, even light on your face${AGE.fallbackUrl ? ', or verify with an ID document' : ''}.`);
    }
    showVerifyResult('warn', `Inconclusive: we couldn’t confirm you’re over ${AGE.minAge}. Try again with a light source in front of you (not behind), without sunglasses, looking straight at the camera. (${AGE.maxAttempts - attempts} attempt${AGE.maxAttempts - attempts === 1 ? '' : 's'} left)`, { retry: true });
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
// Restrictions: server-side bans by IP address, device and account
// (functions/moderation.js). They hold in private windows and new accounts.
// =====================================================================
const bEl = {
    screen: $('banned'), reason: $('banReason'), countdown: $('banCountdown'), until: $('banUntil'),
    form: $('appealForm'), msg: $('appealMsg'), contact: $('appealContact'), result: $('appealResult'),
    send: $('appealSend'), recheck: $('banRecheck'),
};
const BAN_REASONS = {
    underage: `Our age check suggested you may be under ${AGE.minAge}. This service is for adults only.`,
    'age-inconclusive': `We couldn’t confirm your age after ${AGE.maxAttempts} tries. Take a short break, then try again facing a light source.`,
    admin: 'A moderator has restricted access from this device or network.',
};
let banTimer = null;
let lastAutoRecheck = 0;

const formatLeft = ms => {
    const t = Math.ceil(ms / 1000), hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
    return hh ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${mm}:${String(ss).padStart(2, '0')}`;
};

/** Applies the server's answer. Returns true when the user is fully restricted (ban screen shown). */
function applyAccess(st) {
    if (!st) return false;
    // On the live site the server decides: an unban there clears this device's locks too.
    store.set('videoBanUntil', st.videoBanUntil || 0);
    if (!st.allowed) { showBanned(st.ban); return true; }
    if (ageLockedUntil()) { store.set('ageLockUntil', 0); renderAgeStatus(); }
    if (!bEl.screen.classList.contains('hidden')) closeBanned();
    if (S.mode === 'video' && videoBannedUntil()) setMode('text'); // explains why in a toast
    return false;
}

function showBanned(ban) {
    S.searchAbort?.abort();
    S.searchAbort = null;
    clearTimeout(S.autoNextTimer);
    endSession({ notify: true });
    stopMedia();
    closeVerify();
    closeAllSheets();
    [el.welcome, el.chat, el.leaveBtn, el.modeChip, el.drawer].forEach(x => x.classList.add('hidden'));
    bEl.screen.classList.remove('hidden');
    const reason = BAN_REASONS[ban?.reason] ? ban.reason : 'admin';
    bEl.reason.textContent = BAN_REASONS[reason] + (ban?.note ? ` Note from the moderator: ${ban.note}` : '');
    bEl.form.classList.toggle('no-appeal', reason === 'age-inconclusive'); // just a short cooldown
    bEl.result.classList.add('hidden');
    const until = ban?.until || 0;
    bEl.until.textContent = until ? `(${new Date(until).toLocaleString()})` : '';
    clearInterval(banTimer);
    const tick = () => {
        const left = until - Date.now();
        if (left > 0) { bEl.countdown.textContent = formatLeft(left); return; }
        bEl.countdown.textContent = 'a moment';
        // At most once a minute, in case this device's clock is ahead of the server's.
        if (Date.now() - lastAutoRecheck > 60000) { lastAutoRecheck = Date.now(); recheckBan(); }
    };
    tick();
    banTimer = setInterval(tick, 1000);
}

function closeBanned() {
    clearInterval(banTimer);
    bEl.screen.classList.add('hidden');
    el.welcome.classList.remove('hidden');
    renderAgeStatus();
}

async function recheckBan() {
    bEl.recheck.disabled = true;
    try {
        if (!applyAccess(await access.check())) toast('You can chat again. Welcome back!');
    } catch (e) {
        console.warn('access check failed', e);
        toast('Couldn’t check right now. Try again in a moment.', true);
    } finally {
        bEl.recheck.disabled = false;
    }
}
bEl.recheck.onclick = recheckBan;

function appealResult(kind, text) {
    bEl.result.className = 'result ' + kind;
    bEl.result.textContent = text;
}
bEl.form.onsubmit = async e => {
    e.preventDefault();
    const message = bEl.msg.value.trim();
    if (message.length < 5) return bEl.msg.focus();
    bEl.send.disabled = true;
    try {
        const res = await access.requestUnban(message, bEl.contact.value.trim());
        appealResult('ok', res.duplicate
            ? 'You already have a review request open. We’ll look at it soon.'
            : 'Request sent. A moderator will review it. Press “Check again” later to see if access is back.');
        bEl.msg.value = '';
    } catch (err) {
        console.warn('unban request failed', err);
        const shown = ['functions/invalid-argument', 'functions/failed-precondition', 'functions/resource-exhausted'];
        appealResult('bad', shown.includes(err?.code) ? err.message : 'Could not send the request. Check your connection and try again.');
    } finally {
        bEl.send.disabled = false;
    }
};

// =====================================================================
// Welcome screen
// =====================================================================
function setMode(mode) {
    if (!['video', 'voice', 'text'].includes(mode)) mode = 'video';
    if (mode === 'video' && videoBannedUntil()) {
        toast(`Video chat is locked until ${new Date(videoBannedUntil()).toLocaleString()}. Text chat is available.`, true);
        mode = 'text';
    }
    S.mode = mode;
    store.set('mode', mode);
    document.querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    el.chat.classList.toggle('text-mode', mode === 'text');
    el.chat.classList.toggle('voice-mode', mode === 'voice');
    el.modeChip.textContent = { video: 'Video chat', voice: 'Voice chat', text: 'Text chat' }[mode];
    (mode === 'text' ? el.nextSlotComposer : el.nextSlotStage).appendChild(el.nextBtn);
    // Leaving video: release the camera. Leaving text for voice/video: the mic/camera is requested on search.
    const hasVideo = (S.localStream?.getVideoTracks().length || 0) > 0;
    if (mode === 'text' || (mode === 'voice' && hasVideo) || (mode === 'video' && S.localStream && !hasVideo)) stopMedia();
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
    document.querySelectorAll('#interestChips .ichip').forEach(b => {
        const on = S.interests.includes(b.dataset.tag);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
    });
    const summary = $('prefsSummary');
    if (summary) summary.textContent = S.interests.length ? `${S.interests.length} interest${S.interests.length === 1 ? '' : 's'}` : 'Optional';
    $('prefsChips')?.replaceChildren(...S.interests.map(t => h('span', '', t)));
}
document.querySelectorAll('#interestChips .ichip').forEach(b => {
    b.onclick = () => {
        const i = S.interests.indexOf(b.dataset.tag);
        if (i >= 0) S.interests.splice(i, 1);
        else if (S.interests.length < MAX_INTERESTS) S.interests.push(b.dataset.tag);
        else toast(`Up to ${MAX_INTERESTS} interests.`, true);
        store.set('interests', S.interests);
        renderTags();
    };
});
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
    const pro = isPremium();
    return {
        gender: S.gender, country: S.country, premium: pro,
        genderFilter: pro ? S.genderFilter : 'any', countryFilter: pro ? S.countryFilter : 'any',
    };
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
el.genderFilter.onchange = () => {
    if (el.genderFilter.value !== 'any' && !isPremium()) { el.genderFilter.value = 'any'; return openPaywall('filters'); }
    S.genderFilter = el.genderFilter.value; store.set('genderFilter', S.genderFilter);
};
el.countryFilter.onchange = () => {
    if (el.countryFilter.value !== 'any' && !isPremium()) { el.countryFilter.value = 'any'; return openPaywall('filters'); }
    S.countryFilter = el.countryFilter.value; store.set('countryFilter', S.countryFilter);
};
el.timedCheck.onchange = () => { S.timed = el.timedCheck.checked; store.set('timed', S.timed); };
renderCountryFilter();

el.nickInput.value = S.nick;
const avatarPreview = $('avatarPreview');
const renderMyAvatar = () => { if (avatarPreview) applyAvatar(avatarPreview, { avatar: S.avatar, nick: S.nick }); };
renderMyAvatar();
$('diceBtn')?.addEventListener('click', () => {
    S.nick = generateHandle(); S.avatar = generateAvatar();
    el.nickInput.value = S.nick;
    store.set('nick', S.nick); store.set('avatar', S.avatar);
    renderMyAvatar();
});
el.ageCheck.checked = store.get('ageConfirmed', false);
const refreshStart = () => { el.startBtn.disabled = !S.transport; };
el.ageCheck.onchange = () => { store.set('ageConfirmed', el.ageCheck.checked); refreshStart(); };

el.startBtn.onclick = async () => {
    if (!el.ageCheck.checked) {
        // Nudge instead of leaving a dead, disabled button.
        toast('Please confirm you are 18+ to continue.', true);
        const box = el.ageCheck.closest('label, .check') || el.ageCheck;
        box.classList.remove('nudge'); void box.offsetWidth; box.classList.add('nudge');
        el.ageCheck.focus();
        return;
    }
    S.nick = sanitizeHandle(el.nickInput.value) || generateHandle();
    el.nickInput.value = S.nick;
    store.set('nick', S.nick);
    if (el.tagInput.value) { addTag(el.tagInput.value); el.tagInput.value = ''; }
    if (access) {
        el.startBtn.disabled = true;
        const st = await access.fresh().catch(e => (console.warn('access check failed', e), null));
        refreshStart();
        if (st && applyAccess(st)) return;
    }
    const locked = ageLockedUntil();
    if (locked) { renderAgeStatus(); toast(`Locked until ${new Date(locked).toLocaleString()}.`, true); return; }
    if (!ageVerified()) return runVerification();
    enterChat();
};

function enterChat() {
    if (S.mode === 'video') getGuard().load().catch(() => {});
    el.welcome.classList.add('hidden');
    el.chat.classList.remove('hidden');
    el.leaveBtn.classList.remove('hidden');
    el.modeChip.classList.remove('hidden');
    startSearch();
}

el.exitBtn.onclick = () => el.leaveBtn.click();
const stickyStart = $('stickyStartBtn');
if (stickyStart) {
    const sync = () => { stickyStart.textContent = el.startBtn.textContent; stickyStart.disabled = el.startBtn.disabled; };
    new MutationObserver(sync).observe(el.startBtn, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    stickyStart.onclick = () => el.startBtn.click();
    sync();
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
// Friends & accounts
// =====================================================================
const drawer = { view: 'list', open: null, unsubMessages: null };
const handledCalls = new Set();

function initFriends() {
    friends = new Friends(S.transport);
    el.friendsBtn.classList.remove('hidden');
    el.addFriendBtn.classList.remove('hidden');
    let lastUid = friends.uid;
    friends.onChange(() => {
        renderDrawer();
        checkIncomingCalls();
        if (friends.uid !== lastUid) {
            lastUid = friends.uid;
            // A different account needs its own access pass (and may have its own ban).
            const recheck = access ? access.check().then(applyAccess).catch(e => console.warn('access check failed', e)) : Promise.resolve();
            recheck.then(() => { if (S.phase === 'searching') startSearch(); }); // re-queue under the new account
        }
    });
    friends.start();
    renderDrawer();
    if (PREMIUM_CFG.enabled) {
        premium = new Premium(S.transport, friends, PREMIUM_CFG);
        premium.onChange(renderPremium);
        premium.waitReady().then(() => {
            const a = ACCENTS.find(x => x.id === currentAccent());
            // Show the free colour, but keep the saved choice: the Premium answer may just be slow.
            if (a && !a.free && !isPremium()) applyAccent('rani', { save: false });
        });
        el.premiumBtn.classList.remove('hidden');
        renderPremium();
    }
}

// =====================================================================
// Premium: Google sign-in + a pass. Free (anonymous or Google) users get
// everything except the features below.
// =====================================================================
const PAYWALL_REASONS = {
    filters: 'Gender and country filters are a Premium feature.',
    effects: 'This effect is part of Premium.',
    menu: 'Get more out of every chat.',
    theme: 'Colour themes are part of Premium.',
    ip: 'Hiding your IP address from the people you chat with is part of Premium.',
};
let selectedPlan = null;
let purchasing = false;

function renderPremium() {
    const pro = isPremium();
    document.body.classList.toggle('is-premium', pro);
    el.premiumBtn.classList.toggle('on', pro);
    el.premiumBtnText.textContent = pro ? 'Premium' : 'Go Premium';
    el.premiumBtn.title = pro ? `Premium until ${new Date(premium.premiumUntil).toLocaleString()}` : 'Get Premium';
    // Premium ended (or signed out): fall back to free settings.
    if (!pro) {
        el.genderFilter.value = 'any';
        el.countryFilter.value = 'any';
    } else {
        el.genderFilter.value = S.genderFilter;
        el.countryFilter.value = S.countryFilter;
    }
    if (S.localStream && S.mode === 'video') applyEffects({}); // re-apply: Premium effects switch on/off with the plan
    renderFxPanel();
    renderAccents();
    renderHideIp();
    renderPaywall();
}

function renderPaywall() {
    if (!premium) return;
    const plans = PREMIUM_CFG.plans || [];
    selectedPlan ||= (plans.find(p => p.note === 'Most popular') || plans[0])?.id;
    const rupees = p => Number(String(p.price).replace(/\D/g, '')) || 0;
    const perDay = p => (p.days ? rupees(p) / p.days : 0);
    const basePerDay = perDay(plans[0] || {});
    const syncCards = () => el.plans.querySelectorAll('.plan').forEach(c => {
        const on = c.dataset.plan === selectedPlan;
        c.classList.toggle('active', on);
        c.setAttribute('aria-checked', String(on));
        c.tabIndex = on ? 0 : -1;
    });
    if (el.plans.children.length === plans.length && plans.every((p, i) => el.plans.children[i].dataset.plan === p.id)) syncCards();
    else el.plans.replaceChildren(...plans.map(p => {
        const card = h('button', 'plan' + (p.id === selectedPlan ? ' active' : ''));
        card.type = 'button';
        card.dataset.plan = p.id;
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', String(p.id === selectedPlan));
        card.append(h('b', '', p.price), h('span', '', p.label));
        if (p.days) {
            const day = perDay(p);
            const save = basePerDay && p.id !== plans[0].id ? Math.round((1 - day / basePerDay) * 100) : 0;
            card.appendChild(h('em', '', `≈ ₹${day < 10 ? day.toFixed(1).replace('.0', '') : Math.round(day)}/day${save > 0 ? ` · save ${save}%` : ''}`));
        }
        if (p.note) card.appendChild(h('i', '', p.note));
        card.tabIndex = p.id === selectedPlan ? 0 : -1;
        card.onclick = () => { selectedPlan = p.id; renderPaywall(); };
        card.onkeydown = e => {
            const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
            if (!dir) return;
            e.preventDefault();
            const i = (plans.findIndex(x => x.id === p.id) + dir + plans.length) % plans.length;
            selectedPlan = plans[i].id;
            renderPaywall();
            el.plans.children[i]?.focus();
        };
        return card;
    }));
    const plan = plans.find(p => p.id === selectedPlan);
    if (purchasing) {
        el.paywallCta.disabled = true;
        el.paywallCta.textContent = 'Processing payment…';
        return;
    }
    if (isPremium()) {
        el.paywallCta.textContent = `Extend Premium · ${plan?.price || ''}`;
    } else {
        el.paywallCta.textContent = friends?.signedIn ? `Pay ${plan?.price || ''}` : 'Continue with Google';
    }
    el.paywallCta.disabled = false;
}

function openPaywall(reason = 'menu') {
    if (!premium) { toast('Premium is available on the online version of the site.', true); return; }
    el.paywallReason.textContent = isPremium()
        ? `You're Premium until ${new Date(premium.premiumUntil).toLocaleDateString()}. Buying again adds more time.`
        : PAYWALL_REASONS[reason] || PAYWALL_REASONS.menu;
    renderPaywall();
    openSheet(el.paywall);
}

el.premiumBtn.onclick = () => openPaywall('menu');
document.querySelectorAll('[data-open-premium]').forEach(b => b.addEventListener('click', () => {
    const plan = (PREMIUM_CFG.plans || []).find(p => p.days === Number(b.dataset.plan));
    if (plan) selectedPlan = plan.id;
    openPaywall('menu');
}));
el.paywallClose.onclick = () => closeSheet(el.paywall);

// Tip: any whole-rupee amount in range. The server re-checks it; it never changes Premium.
const TIP_MIN = 10, TIP_MAX = 5000;
let tipping = false;
$('tipBtn').onclick = () => {
    closeSheet(el.menuSheet);
    if (!premium) { toast('Tips are available on the online version of the site.', true); return; }
    $('tipError').textContent = '';
    openSheet($('tipSheet'));
};
$('tipChips').addEventListener('click', e => {
    const b = e.target.closest('[data-amt]');
    if (!b) return;
    $('tipAmount').value = b.dataset.amt;
    $('tipError').textContent = '';
    $('tipChips').querySelectorAll('[data-amt]').forEach(x => x.classList.toggle('on', x === b));
});
$('tipAmount').addEventListener('input', () => {
    $('tipError').textContent = '';
    $('tipChips').querySelectorAll('[data-amt]').forEach(x => x.classList.toggle('on', x.dataset.amt === $('tipAmount').value));
});
$('tipPay').onclick = async () => {
    if (tipping) return;
    const raw = $('tipAmount').value.trim();
    const rupees = Number(raw);
    if (!/^\d+$/.test(raw) || rupees < TIP_MIN || rupees > TIP_MAX) {
        $('tipError').textContent = `Enter a whole number of rupees from ₹${TIP_MIN} to ₹${TIP_MAX.toLocaleString('en-IN')}.`;
        return;
    }
    tipping = true;
    const pay = $('tipPay');
    pay.disabled = true;
    pay.textContent = 'Opening secure checkout…';
    try {
        await premium.tip(rupees);
        closeSheet($('tipSheet'));
        $('tipAmount').value = '';
        toast('💖 Thank you for your tip!');
        SOUND.match();
    } catch (e) {
        if (e.code === 'pending') { closeSheet($('tipSheet')); toast(e.message); }
        else if (e.code !== 'cancelled') { console.warn('tip failed', e); $('tipError').textContent = e.message || 'The payment could not be completed.'; }
    } finally {
        tipping = false;
        pay.disabled = false;
        pay.textContent = 'Pay with Razorpay';
    }
};

el.paywallCta.onclick = async () => {
    if (purchasing) return;
    if (!friends.signedIn) {
        if (await signInFlow()) {
            await premium.waitReady(); // a returning Premium user may already have a pass
            renderPaywall();
            if (isPremium()) { closeSheet(el.paywall); toast('👑 Welcome back! Your Premium is active.'); }
        }
        return;
    }
    purchasing = true;
    el.paywallCta.disabled = true;
    el.paywallCta.textContent = 'Opening secure checkout…';
    try {
        const until = await premium.buy(selectedPlan);
        closeSheet(el.paywall);
        toast(`👑 Premium is active until ${new Date(until).toLocaleDateString()}. Thank you!`);
        SOUND.match();
    } catch (e) {
        if (e.code === 'pending') {
            el.paywallReason.textContent = e.message; // charged; the webhook will activate it
            toast(e.message);
        } else if (e.code !== 'cancelled') {
            console.warn('purchase failed', e);
            const msg = /not-found|internal|unavailable/.test(e.code || '') && /not found|NOT_FOUND|internal/i.test(e.message || '')
                ? 'Premium payments aren’t set up yet. Please try again later.'
                : e.message || 'Payment failed.';
            toast(msg, true);
        }
    } finally {
        purchasing = false;
        renderPaywall();
    }
};

async function signInFlow() {
    try {
        await friends.signIn();
        toast(`Signed in as ${maskName(friends.displayName)}.`);
        return true;
    } catch (e) {
        console.warn('sign-in failed', e);
        const hints = {
            'auth/popup-closed-by-user': 'Sign-in was cancelled.',
            'auth/cancelled-popup-request': 'Sign-in was cancelled.',
            'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups for this site and try again.',
            'auth/operation-not-allowed': 'Google sign-in isn’t enabled yet (Firebase → Authentication → Sign-in method → Google).',
            'auth/unauthorized-domain': 'This website isn’t authorised for sign-in yet (Firebase → Authentication → Settings → Authorized domains).',
        };
        toast(hints[e.code] || `Sign-in failed (${e.code || e.message}).`, true);
        return false;
    }
}

// --- Adding a friend during a chat (both people must agree) ---
el.addFriendBtn.onclick = async () => {
    const sess = S.session;
    if (!sess || S.phase !== 'connected' || !friends) return;
    if (friends.isFriend(sess.partnerId)) { toast('You’re already friends.'); return; }
    if (!friends.signedIn && !(await signInFlow())) return;
    if (sess.ended) return;
    sess.friendReqSent = true;
    el.addFriendBtn.disabled = true;
    sendData({ t: 'friend-req', uid: friends.uid, nick: S.nick });
    sys('Friend request sent. Waiting for them to accept…');
};

async function onFriendMessage(sess, msg) {
    if (!friends) return;
    const name = sess.partner?.nick || 'Stranger';
    switch (msg.t) {
        case 'friend-req': {
            // Only the person we're actually connected to, and only once per chat.
            if (msg.uid !== sess.partnerId || sess.friendReqFrom) return;
            sess.friendReqFrom = msg.uid;
            const banner = h('div', 'friend-banner');
            banner.append(h('span', '', `👋 ${name} wants to add you as a friend.`));
            const no = h('button', 'btn btn-ghost btn-sm', 'No thanks');
            const yes = h('button', 'btn btn-primary btn-sm', 'Accept');
            no.onclick = () => { banner.remove(); sess.friendAccepted = false; sendData({ t: 'friend-no' }); };
            yes.onclick = async () => {
                if (!friends.signedIn && !(await signInFlow())) return;
                if (sess.ended) return;
                sess.friendAccepted = true; // the only thing that lets 'friend-created' be accepted
                banner.replaceChildren(h('span', '', 'Accepted. Adding…'));
                sendData({ t: 'friend-ok', uid: friends.uid, nick: S.nick });
            };
            banner.append(no, yes);
            el.messages.appendChild(banner);
            scrollMessages();
            break;
        }
        case 'friend-no':
            if (!sess.friendReqSent || sess.friendNoShown) return;
            sess.friendNoShown = true;
            sys(`${name} declined the friend request.`);
            break;
        case 'friend-ok':
            // They agreed: create the pending friendship; they confirm it on their side.
            if (!sess.friendReqSent || sess.friendOkHandled || msg.uid !== sess.partnerId) return;
            sess.friendOkHandled = true;
            try {
                const pairId = await friends.createPending(msg.uid, S.nick);
                sendData({ t: 'friend-created', pairId });
            } catch (e) {
                console.warn('create friendship', e);
                sys('Could not add friend. Please try again.', 'bad');
            }
            break;
        case 'friend-created':
            if (!sess.friendAccepted || !sess.friendReqFrom || msg.pairId !== pairIdOf(friends.uid, sess.friendReqFrom)) return;
            sess.friendAccepted = false;
            try {
                await friends.accept(msg.pairId, S.nick);
                sendData({ t: 'friend-done' });
                el.messages.querySelectorAll('.friend-banner').forEach(b => b.remove());
                sys(`🎉 You and ${name} are now friends! Find them under Friends.`, 'good');
            } catch (e) {
                console.warn('accept friendship', e);
                sys('Could not add friend. Please try again.', 'bad');
            }
            break;
        case 'friend-done':
            if (!sess.friendOkHandled || sess.friendDoneShown) return;
            sess.friendDoneShown = true;
            sys(`🎉 You and ${name} are now friends! Find them under Friends.`, 'good');
            break;
    }
}

// --- Drawer: account, friends list, friend chat ---
el.friendsBtn.onclick = () => { el.drawer.classList.toggle('hidden'); renderDrawer(); };
el.drawerClose.onclick = () => el.drawer.classList.add('hidden');
el.drawerBack.onclick = () => openFriendList();

function renderDrawer() {
    if (!friends) return;
    const ringing = friends.incomingCalls().length;
    el.friendsBadge.textContent = ringing ? String(ringing) : '';
    el.friendsBadge.classList.toggle('hidden', !ringing);

    el.drawerAccount.replaceChildren();
    if (friends.signedIn) {
        const line = h('div', '', `Signed in as ${friends.displayName}. Strangers never see this; friends see your nickname. `);
        const out = h('a', '', 'Sign out');
        out.onclick = async () => { await friends.signOut(); toast('Signed out.'); };
        line.appendChild(out);
        el.drawerAccount.appendChild(line);
    } else {
        el.drawerAccount.append(
            h('div', '', 'Sign in with Google to add friends, chat with them later and video call them. Random chats stay anonymous.'),
        );
        const btn = h('button', 'btn btn-primary', 'Sign in with Google');
        btn.onclick = signInFlow;
        el.drawerAccount.appendChild(btn);
    }
    if (drawer.view === 'list') renderFriendList();
    else renderFriendHeader();
}

function friendInitial(f) { return (f.name || 'F')[0].toUpperCase(); }

function renderFriendList() {
    el.friendList.classList.remove('hidden');
    el.friendChat.classList.add('hidden');
    el.drawerBack.classList.add('hidden');
    el.drawerTitle.textContent = 'Friends';
    const list = friends.friends;
    if (!friends.signedIn) { el.friendList.replaceChildren(); return; }
    if (!list.length) {
        el.friendList.replaceChildren(h('div', 'empty', 'No friends yet. Tap the 👤+ button during a chat to add someone. They have to accept too.'));
        return;
    }
    const ringing = new Set(friends.incomingCalls().map(f => f.id));
    el.friendList.replaceChildren(...list.map(f => {
        const row = h('div', 'friend' + (ringing.has(f.id) ? ' ringing' : ''));
        const av = h('div', 'avatar', friendInitial(f));
        av.appendChild(h('span', 'status-dot' + (friends.isOnline(f.other) ? ' on' : '')));
        const info = h('div');
        info.append(h('div', 'friend-name', f.name), h('div', 'friend-sub', ringing.has(f.id) ? '📞 Calling you…' : (f.lastMessage || (friends.isOnline(f.other) ? 'Online' : 'Offline'))));
        row.append(av, info);
        row.onclick = () => openFriendChat(f.id);
        return row;
    }));
}

function openFriendList() {
    drawer.view = 'list';
    drawer.open = null;
    drawer.unsubMessages?.();
    drawer.unsubMessages = null;
    renderDrawer();
}

function currentFriend() { return friends?.friends.find(f => f.id === drawer.open); }

function renderFriendHeader() {
    const f = currentFriend();
    if (!f) return openFriendList();
    el.drawerTitle.textContent = f.name;
    const online = friends.isOnline(f.other);
    el.fcDot.className = 'status-dot' + (online ? ' on' : '');
    el.fcStatus.textContent = online ? 'Online' : 'Offline';
}

function openFriendChat(pairId) {
    drawer.view = 'chat';
    drawer.open = pairId;
    el.friendList.classList.add('hidden');
    el.friendChat.classList.remove('hidden');
    el.drawerBack.classList.remove('hidden');
    renderFriendHeader();
    drawer.unsubMessages?.();
    el.fcMessages.replaceChildren();
    drawer.unsubMessages = friends.watchMessages(pairId, currentFriend()?.acceptedAt || 0, msgs => {
        el.fcMessages.replaceChildren(...msgs.map(m => {
            const mine = m.from === friends.uid;
            const wrap = h('div', 'msg ' + (mine ? 'me' : 'them'));
            const text = mine ? m.text : maskProfanity(m.text);
            if (EMOJI_ONLY.test(text)) wrap.classList.add('emoji-only');
            wrap.append(h('div', 'bubble', text), h('div', 'meta', new Date(m.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })));
            return wrap;
        }));
        el.fcMessages.scrollTop = el.fcMessages.scrollHeight;
    });
    el.fcInput.focus();
}

async function sendFriendMessage() {
    const text = el.fcInput.value.trim();
    if (!text || !drawer.open) return;
    el.fcInput.value = '';
    try { await friends.send(drawer.open, text); }
    catch (e) { console.warn('friend send', e); toast('Message not sent.', true); el.fcInput.value = text; }
}
el.fcSend.onclick = sendFriendMessage;
el.fcInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendFriendMessage(); } });
el.fcRemove.onclick = async () => {
    const f = currentFriend();
    if (!f || !confirm(`Remove ${f.name} from your friends?`)) return;
    await friends.remove(f.id).catch(() => toast('Could not remove friend.', true));
    openFriendList();
};

// --- Friend video calls ---
function canCall() {
    if (!ageVerified()) { toast('Verify your age first: press “Start chatting” once.', true); return false; }
    if (videoBannedUntil()) { toast('Video chat is locked for now.', true); return false; }
    return true;
}

/** Leave whatever we're doing and show the chat screen in video mode. */
async function prepareCallScreen() {
    S.searchAbort?.abort();
    S.searchAbort = null;
    clearTimeout(S.autoNextTimer);
    endSession({ notify: true });
    setMode('video');
    getGuard().load().catch(() => {});
    if (!(await ensureMedia()) || S.mode !== 'video') {
        // No camera or microphone: go back to the start screen instead of a dead chat screen.
        el.leaveBtn.onclick();
        return false;
    }
    el.welcome.classList.add('hidden');
    vEl.screen.classList.add('hidden');
    el.chat.classList.remove('hidden');
    el.leaveBtn.classList.remove('hidden');
    el.modeChip.classList.remove('hidden');
    el.drawer.classList.add('hidden');
    clearMessages();
    return true;
}

el.fcCall.onclick = async () => {
    const f = currentFriend();
    if (!f || !canCall()) return;
    if (!(await prepareCallScreen())) return;
    try {
        let roomId;
        try {
            roomId = await friends.call(f.id, f.other);
        } catch (e) {
            // Calls need a current access pass too: renew it and try once more.
            if (e?.code !== 'permission-denied' || !access) throw e;
            if (applyAccess(await access.check())) return;
            roomId = await friends.call(f.id, f.other);
        }
        connect({ roomId, role: 'offerer', partnerId: f.other, bus: S.transport.roomBus(roomId), friend: f });
    } catch (e) {
        console.warn('call failed', e);
        toast(e?.code === 'permission-denied' && access?.status?.videoBanUntil > Date.now()
            ? 'Video calls are locked for now after a safety strike.' : 'Could not start the call.', true);
    }
};

let ringTimer = null;
// Re-check while friends exist so a ring that expires (or is cancelled) stops on its own.
setInterval(() => { if (friends) checkIncomingCalls(); }, 3000);
function checkIncomingCalls() {
    const call = friends.incomingCalls().find(f => !handledCalls.has(f.call.roomId));
    if (!call || S.session?.friend) {
        if (!call) { closeSheet(el.callModal); clearInterval(ringTimer); ringTimer = null; }
        return;
    }
    el.callName.textContent = call.name;
    el.callAvatar.textContent = friendInitial(call);
    el.callModal.dataset.pair = call.id;
    openSheet(el.callModal);
    if (!ringTimer) { SOUND.match(); ringTimer = setInterval(() => SOUND.match(), 2000); }
}

function takeCall() {
    const f = friends.friends.find(x => x.id === el.callModal.dataset.pair);
    closeSheet(el.callModal);
    clearInterval(ringTimer);
    ringTimer = null;
    if (f?.call) handledCalls.add(f.call.roomId);
    return f;
}

el.callDecline.onclick = () => {
    const f = takeCall();
    if (!f?.call) return;
    const bus = S.transport.roomBus(f.call.roomId);
    bus.send('bye');
    setTimeout(() => bus.close(), 500);
};

el.callAccept.onclick = async () => {
    const f = takeCall();
    if (!f?.call) return;
    const { roomId } = f.call;
    // If we can't take the call, say so: otherwise the caller keeps ringing for 45 seconds.
    const decline = () => { const bus = S.transport.roomBus(roomId); bus.send('bye'); setTimeout(() => bus.close(), 500); };
    if (!canCall()) return decline();
    if (!(await prepareCallScreen())) return decline();
    connect({ roomId, role: 'answerer', partnerId: f.other, bus: S.transport.roomBus(roomId), friend: f });
};

// =====================================================================
// Online count
// =====================================================================
async function refreshOnline() {
    if (!S.transport) return;
    try {
        const n = Math.max(1, await S.transport.onlineCount()); // you're online too, even before your first ping lands
        const text = n.toLocaleString();
        el.onlineCount.textContent = text;
        document.getElementById('onlineLabel').textContent = n === 1 ? 'person online now' : 'people online now';
        el.onlineChipCount.textContent = text;
        // "1 online" is just you and makes a new site look empty: only show the count once it means something.
        const show = n >= 3;
        el.onlineChip.classList.toggle('hidden', !show);
        el.onlineCount.closest('.online-pill')?.classList.toggle('hidden', !show);
    } catch (e) {
        console.warn('online count failed', e);
        el.onlineCount.closest('.online-pill')?.classList.add('hidden');
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
renderAccents();
initLanding();
setMode(S.mode);
renderTags();
renderAgeStatus();
detectCountry(store).then(code => { S.country = code; renderCountryFilter(); });
el.startBtn.textContent = 'Connecting…';
try {
    S.transport = firebaseConfig
        ? await createFirebaseTransport({ firebaseConfig, appId, initialAuthToken, emulators: CFG.emulators })
        : createLocalTransport();
    el.demoNote.classList.toggle('hidden', S.transport.kind !== 'local');
    el.startBtn.textContent = 'Start chatting';
    refreshOnline();
    setTimeout(refreshOnline, 4000); // again once our own presence ping has been saved
    setInterval(refreshOnline, S.transport.kind === 'local' ? 3000 : ONLINE_REFRESH_MS);
    if (S.transport.kind === 'firebase') {
        access = new Access(S.transport, PREMIUM_CFG.functionsRegion);
        access.check().then(applyAccess).then(() => refreshIce()).catch(e => console.warn('access check failed', e));
        setInterval(() => refreshIce(), 10 * 60000); // renew the short-lived relay credentials before they run out
        initFriends();
    }
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
