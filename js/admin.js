// =====================================================================
// Admin page: dashboard, Premium members, payments, people, inbox, unban requests, bans, the IP whitelist and reports.
// Moderation goes through the `admin` Cloud Function (functions/moderation.js) and the numbers through `adminAnalytics`
// (functions/analytics.js); both only answer Google accounts listed in the ADMIN_EMAILS secret.
// =====================================================================
const CFG = window.APP_CONFIG || {};
const V = '11.6.1';
import { createAnalytics } from './admin-analytics.js';
import { startAppCheck } from './appcheck.js';
import { createHosts } from './admin-hosts.js';

const [appMod, authMod, fnMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-functions.js`),
]);
// A separate app instance, so signing in here never replaces the chat app's account in this browser.
const app = appMod.initializeApp(CFG.firebase, 'admin');
await startAppCheck(app, CFG.appCheck, { emulators: CFG.emulators });
const auth = authMod.getAuth(app);
const functions = fnMod.getFunctions(app, CFG.premium?.functionsRegion || 'asia-south1');
if (CFG.emulators) { // local testing only
    authMod.connectAuthEmulator(auth, CFG.emulators.auth, { disableWarnings: true });
    fnMod.connectFunctionsEmulator(functions, ...CFG.emulators.functions);
}
const adminFn = fnMod.httpsCallable(functions, 'admin');
const analyticsFn = fnMod.httpsCallable(functions, 'adminAnalytics');
const hostsFn = fnMod.httpsCallable(functions, 'adminHosts');

// The admin page has its own light/dark choice (button in the top bar). Until you press it, it follows the website's theme.
const readTheme = key => { try { const v = JSON.parse(localStorage.getItem(key)); return v === 'light' || v === 'dark' ? v : null; } catch { return null; } };
function applyAdminTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = document.getElementById('themeBtn');
    if (btn) { btn.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode'; btn.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`); }
}
applyAdminTheme(readTheme('ac.adminTheme') || readTheme('ac.theme') || 'dark');
document.getElementById('themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyAdminTheme(next);
    try { localStorage.setItem('ac.adminTheme', JSON.stringify(next)); } catch { /* private window: still applies for this visit */ }
};

// ---------------- helpers ----------------
const $ = id => document.getElementById(id);
function h(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text; // always textContent: everything here comes from users
    return node;
}
function toast(text, bad = false) {
    const t = h('div', 'toast' + (bad ? ' bad' : ''), text);
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 5000);
}
const short = s => (!s ? '—' : s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s);
const when = ms => (ms ? new Date(ms).toLocaleString() : '—');
function timeLeft(until) {
    const d = until - Date.now();
    if (d <= 0) return 'expired';
    const mins = Math.ceil(d / 60000), hr = Math.floor(mins / 60), m = mins % 60;
    return hr >= 48 ? `${Math.round(hr / 24)} days left` : hr ? `${hr} h ${m} min left` : `${m} min left`;
}
const REASONS = {
    underage: 'Under-age result', 'age-inconclusive': 'Age check failed 3 times', nudity: 'Nudity on camera', admin: 'Admin ban',
    sexual: 'Nudity or sexual content', minor: 'Appears under 18', harassment: 'Harassment', spam: 'Spam or scam',
    other: 'Something else', 'auto-nudity': 'Automatic nudity check',
};
const reasonText = r => (String(r).startsWith('report-') ? `Reported: ${REASONS[r.slice(7)] || r.slice(7)}` : REASONS[r] || r);
const SCOPE = { all: 'All chat', video: 'Video only' };
const TYPE = { uid: 'account', fp: 'device', ip: 'IP' };

function kv(pairs) {
    const box = h('div', 'kv');
    for (const [label, value, title] of pairs) {
        if (!value && value !== 0) continue;
        const item = h('span', '', `${label}: `);
        const code = h('code', '', String(value));
        if (title) code.title = title;
        item.appendChild(code);
        box.appendChild(item);
    }
    return box;
}
function button(text, cls, onclick) {
    const b = h('button', cls, text);
    b.type = 'button';
    b.onclick = () => onclick(b);
    return b;
}
const empty = text => h('div', 'empty', text);

async function call(action, payload = {}) {
    const { data } = await adminFn({ action, ...payload });
    return data;
}
async function act(btn, action, payload, done) {
    btn.disabled = true;
    try {
        await call(action, payload);
        if (done) toast(done);
        await load();
    } catch (e) {
        console.error(e);
        toast(e.message || 'That didn’t work.', true);
    } finally {
        btn.disabled = false;
    }
}

// ---------------- screens ----------------
function show(which) {
    for (const id of ['loading', 'signin', 'panel']) $(id).classList.toggle('hidden', id !== which);
}
function showSignIn(message) {
    $('signinMsg').textContent = message || 'Sign in with the Google account listed in ADMIN_EMAILS.';
    show('signin');
}

const analytics = createAnalytics({
    $, h, toast, button, empty, kv, when, short, fn: analyticsFn,
    adminCall: (action, payload) => call(action, payload),
    openTab: name => { tab = name; history.replaceState(null, '', '#' + name); render(); },
});

const hosts = createHosts({ $, h, toast, button, empty, kv, when, short, fn: hostsFn });

let data = null;
const TABS = ['dashboard', 'hosts', 'premium', 'payments', 'people', 'inbox', 'requests', 'bans', 'whitelist', 'reports'];
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';

async function load() {
    try {
        data = await call('overview');
    } catch (e) {
        console.warn(e);
        if (e.code === 'functions/permission-denied') {
            return showSignIn(`${auth.currentUser?.email || 'This account'} isn’t an admin. Add it to the ADMIN_EMAILS secret (bash deploy.sh --reset-secrets), or sign in with another Google account.`);
        }
        if (e.code === 'functions/unauthenticated') return showSignIn();
        if ($('panel').classList.contains('hidden')) showSignIn('Could not reach the admin service. Are the functions deployed? (bash deploy.sh)');
        toast('Could not load: ' + e.message, true);
        return;
    }
    $('meEmail').textContent = data.me.email;
    $('meIp').textContent = data.me.ip || 'unknown';
    show('panel');
    hosts.badge();
    announceNew();
    render();
}

function render() {
    const open = data.requests.filter(r => r.status === 'open').length;
    $('countRequests').textContent = open;
    $('countBans').textContent = banGroups().length;
    $('countWhitelist').textContent = data.whitelist.length;
    $('countReports').textContent = data.reports.length;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('[data-view]').forEach(s => s.classList.toggle('hidden', s.dataset.view !== tab));
    renderInbox();
    renderRequests();
    renderBans();
    renderWhitelist();
    renderReports();
    analytics.show(tab);
    if (tab === 'hosts') hosts.show();
}

// ---------------- unban requests ----------------
function renderRequests() {
    const all = $('requestFilter').value === 'all';
    const list = data.requests.filter(r => all || r.status === 'open');
    $('requestList').replaceChildren(...(list.length ? list.map(requestItem) : [empty(all ? 'No requests yet.' : 'No open requests. 🎉')]));
}

function requestItem(r) {
    const item = h('div', 'item');
    const head = h('div', 'item-head');
    head.append(h('span', 'pill ' + r.status, r.status), h('b', '', when(r.createdAt)));
    const seen = new Set();
    for (const b of r.bans || []) {
        const key = b.scope + b.reason;
        if (seen.has(key)) continue;
        seen.add(key);
        head.append(h('span', 'pill ' + b.scope, `${SCOPE[b.scope] || b.scope} · ${reasonText(b.reason)}`));
    }
    item.append(head, h('div', 'item-msg', r.message), kv([['Contact', r.contact], ['IP', r.ip], ['Device', short(r.fp), r.fp], ['User', short(r.uid), r.uid]]));
    if (r.status !== 'open') {
        item.appendChild(h('p', 'help', `${r.status === 'approved' ? 'Approved' : 'Rejected'} by ${r.resolvedBy || '?'} on ${when(r.resolvedAt)}${r.note ? ` · ${r.note}` : ''}`));
        return item;
    }
    const actions = h('div', 'actions');
    const note = h('input', 'input');
    note.placeholder = 'Note for your records (optional)';
    note.maxLength = 300;
    const resolve = (approve, whitelist, done) => b => act(b, 'resolveRequest', { requestId: r.id, approve, whitelist, note: note.value.trim() }, done);
    actions.append(note, button('Approve & unban', 'btn btn-primary btn-sm', resolve(true, false, 'Unbanned. They can try again now.')));
    if (r.ip) actions.append(button('Approve & whitelist IP', 'btn btn-ghost btn-sm', resolve(true, true, `Unbanned, and ${r.ip} is whitelisted.`)));
    actions.append(button('Reject', 'btn btn-ghost btn-sm', resolve(false, false, 'Request rejected. The ban stays.')));
    item.appendChild(actions);
    return item;
}
$('requestFilter').onchange = () => renderRequests();

// ---------------- bans ----------------
/** One incident writes a record per key (account, device, IP); show them as one row. */
function banGroups() {
    const groups = new Map();
    for (const b of data.bans) {
        const key = [b.scope, b.reason, b.uid, b.ip, b.fp].join('|');
        const g = groups.get(key) || { ...b, ids: [], types: [], until: 0 };
        g.ids.push(b.id);
        g.types = [...g.types, b.type].sort((x, y) => Object.keys(TYPE).indexOf(x) - Object.keys(TYPE).indexOf(y));
        g.until = Math.max(g.until, b.until);
        groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function renderBans() {
    const q = $('banSearch').value.trim().toLowerCase();
    const whitelisted = new Set(data.whitelist.map(w => w.ip));
    const list = banGroups().filter(g => !q || [g.ip, g.uid, g.fp, g.reason, g.note, reasonText(g.reason)].some(v => String(v || '').toLowerCase().includes(q)));
    $('banList').replaceChildren(...(list.length ? list.map(g => {
        const item = h('div', 'item');
        const head = h('div', 'item-head');
        head.append(h('span', 'pill ' + g.scope, SCOPE[g.scope] || g.scope), h('b', '', reasonText(g.reason)), h('span', '', `${timeLeft(g.until)} · until ${when(g.until)}`));
        item.append(head, kv([
            ['Covers', g.types.map(t => TYPE[t] || t).join(', ')], ['IP', g.ip], ['Device', short(g.fp), g.fp], ['User', short(g.uid), g.uid],
            ['Since', when(g.createdAt)], ['By', g.createdBy], ['Note', g.note],
        ]));
        const actions = h('div', 'actions');
        actions.append(button('Unban', 'btn btn-primary btn-sm', b => act(b, 'unban', { banIds: g.ids }, 'Unbanned. They can try again now.')));
        if (g.ip && !whitelisted.has(g.ip)) {
            actions.append(button('Whitelist this IP', 'btn btn-ghost btn-sm', b => act(b, 'whitelistAdd', { ip: g.ip, note: `From the ban list (${reasonText(g.reason)})` }, `${g.ip} whitelisted.`)));
        }
        item.appendChild(actions);
        return item;
    }) : [empty(q ? 'No bans match.' : 'No active bans.')]));
}
$('banSearch').oninput = () => renderBans();

const looksLikeIp = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || (s.includes(':') && /^[0-9a-f:]+(\/\d+)?$/i.test(s));
$('banForm').onsubmit = e => {
    e.preventDefault();
    const target = $('banTarget').value.trim();
    if (!target) return;
    const btn = e.submitter || $('banForm').querySelector('button');
    act(btn, 'ban', {
        ...(looksLikeIp(target) ? { ip: target.replace(/\/\d+$/, '') } : { uid: target }),
        hours: Number($('banHours').value), scope: $('banScope').value, reason: 'admin', note: $('banNote').value.trim(),
    }, 'Banned.').then(() => { $('banTarget').value = ''; $('banNote').value = ''; });
};

// ---------------- whitelist ----------------
function renderWhitelist() {
    $('whitelistList').replaceChildren(...(data.whitelist.length ? data.whitelist.map(w => {
        const item = h('div', 'item');
        const head = h('div', 'item-head');
        head.append(h('b', '', w.ip), h('span', '', `added ${when(w.addedAt)} by ${w.addedBy || '?'}`));
        item.append(head);
        if (w.note) item.append(h('div', 'item-msg', w.note));
        const actions = h('div', 'actions');
        actions.append(button('Remove', 'btn btn-ghost btn-sm', b => act(b, 'whitelistRemove', { ip: w.ip }, `${w.ip} removed from the whitelist.`)));
        item.appendChild(actions);
        return item;
    }) : [empty('No whitelisted IPs.')]));
}
$('whitelistForm').onsubmit = e => {
    e.preventDefault();
    const ip = $('wlIp').value.trim().replace(/\/\d+$/, '');
    if (!ip) return;
    const btn = e.submitter || $('whitelistForm').querySelector('button');
    act(btn, 'whitelistAdd', { ip, note: $('wlNote').value.trim() }, `${ip} whitelisted.`)
        .then(() => { $('wlIp').value = ''; $('wlNote').value = ''; });
};

// ---------------- reports ----------------
function renderReports() {
    $('reportList').replaceChildren(...(data.reports.length ? data.reports.map(reportItem) : [empty('No reports.')]));
}

function reportItem(r) {
    {
        const item = h('div', 'item');
        const head = h('div', 'item-head');
        head.append(h('span', 'pill ' + (r.reason === 'minor' || r.reason === 'sexual' || r.reason === 'auto-nudity' ? 'all' : 'video'), reasonText(r.reason)), h('b', '', when(r.ts)));
        if (r.count > 1) head.append(h('span', '', `${r.count} reports about this person`));
        item.append(head, kv([['Reported user', short(r.reported), r.reported], ['IP', r.ip], ['Device', short(r.fp), r.fp], ['Reporter', short(r.reporter), r.reporter]]));
        if (r.evidence) item.appendChild(h('p', 'item-msg', `Reporter says they received (not verified): “${String(r.evidence).slice(0, 300)}”`));
        const actions = h('div', 'actions');
        const ban = (hours, scope) => b => act(b, 'ban', { uid: r.reported, hours, scope, reason: `report-${r.reason}` },
            `Banned ${scope === 'video' ? 'from video ' : ''}for ${hours >= 48 ? `${hours / 24} days` : `${hours} hours`}.`);
        actions.append(
            button('Ban 24 h', 'btn btn-danger btn-sm', ban(24, 'all')),
            button('Ban 7 days', 'btn btn-danger btn-sm', ban(168, 'all')),
            button('Video only, 24 h', 'btn btn-ghost btn-sm', ban(24, 'video')),
        );
        item.appendChild(actions);
        return item;
    }
}

// ---------------- inbox: unban requests and reports in one list, newest first, with unread marks ----------------
const READ_KEY = 'ac.adminRead';
const readSet = (() => { try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]')); } catch { return new Set(); } })();
const saveRead = () => { try { localStorage.setItem(READ_KEY, JSON.stringify([...readSet].slice(-3000))); } catch { /* private window */ } };
let inboxFilter = 'unread';
let selected = '';
let known = null;       // keys seen in the last refresh, to tell what is new

function inboxItems() {
    const out = [];
    for (const r of data.requests) out.push({ key: 'a:' + r.id, kind: 'appeal', ts: r.createdAt || 0, open: r.status === 'open', r });
    for (const r of data.reports) out.push({ key: 'r:' + r.id, kind: 'report', ts: r.ts || 0, open: true, r });
    return out.sort((a, b) => b.ts - a.ts);
}
const isUnread = it => it.open && !readSet.has(it.key);
const ago = ms => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`; };

function renderInbox() {
    const items = inboxItems();
    const unread = items.filter(isUnread).length;
    $('countInbox').textContent = unread;
    document.title = (unread ? `(${unread}) ` : '') + 'Admin';
    document.querySelectorAll('#inboxFilters button').forEach(b => b.classList.toggle('active', b.dataset.f === inboxFilter));
    const shown = items.filter(it => inboxFilter === 'all' || (inboxFilter === 'unread' ? isUnread(it) : it.kind === inboxFilter));
    $('inboxList').replaceChildren(...(shown.length ? shown.map(it => {
        const row = h('button', 'inbox-row' + (isUnread(it) ? ' unread' : '') + (it.key === selected ? ' sel' : ''));
        row.type = 'button';
        const main = h('span', '');
        const title = it.kind === 'appeal' ? 'Unban request' : reasonText(it.r.reason);
        const preview = it.kind === 'appeal' ? String(it.r.message || '').slice(0, 90) : `About ${short(it.r.reported)}${it.r.evidence ? ': ' + String(it.r.evidence).slice(0, 60) : ''}`;
        const t = h('span', 't');
        t.append(h('span', 'k ' + it.kind, it.kind === 'appeal' ? 'Appeal' : 'Report'), document.createTextNode(title));
        main.append(t, h('span', 'p', preview));
        row.append(h('span', 'dot'), main, h('span', 'w', ago(it.ts)));
        row.onclick = () => openInbox(it.key);
        return row;
    }) : [empty(inboxFilter === 'unread' ? 'Nothing new. 🎉' : 'Nothing here.')]));
    const cur = items.find(it => it.key === selected);
    if (cur) $('inboxDetail').replaceChildren(cur.kind === 'appeal' ? requestItem(cur.r) : reportItem(cur.r));
    else $('inboxDetail').replaceChildren(h('p', 'help', 'Pick a message on the left. New unban requests and reports appear here by themselves.'));
}
function openInbox(key) {
    selected = key;
    readSet.add(key);
    saveRead();
    renderInbox();
    $('inboxDetail').scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}
document.querySelectorAll('#inboxFilters button').forEach(b => (b.onclick = () => { inboxFilter = b.dataset.f; renderInbox(); }));
$('markAllRead').onclick = () => { inboxItems().forEach(it => readSet.add(it.key)); saveRead(); renderInbox(); };

// A soft chime and a toast when something new arrives while this page is open.
let audio = null;
function chime() {
    try {
        audio ||= new AudioContext();
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 880; g.gain.setValueAtTime(0.0001, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.4);
        o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.45);
    } catch { /* no audio */ }
}
function announceNew() {
    const keys = new Set(inboxItems().map(it => it.key));
    if (known) {
        const fresh = inboxItems().filter(it => !known.has(it.key) && it.open);
        if (fresh.length) {
            const a = fresh.filter(it => it.kind === 'appeal').length, r = fresh.length - a;
            toast(`New: ${[a ? `${a} unban request${a > 1 ? 's' : ''}` : '', r ? `${r} report${r > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')}`);
            chime();
        }
    }
    known = keys;
}
async function refreshQuietly() {
    if (!data || document.visibilityState === 'hidden') return;
    try { data = await call('overview'); } catch { return; }
    announceNew();
    render();
}
setInterval(refreshQuietly, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshQuietly(); });

// ---------------- wiring ----------------
document.querySelectorAll('#tabs button').forEach(b => (b.onclick = () => {
    tab = b.dataset.tab;
    history.replaceState(null, '', '#' + tab);
    render();
}));
$('refreshBtn').onclick = async () => { $('refreshBtn').disabled = true; await load(); analytics.refresh(tab); if (tab === 'hosts') hosts.refresh(); $('refreshBtn').disabled = false; };

$('signInBtn').onclick = async () => {
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
        await authMod.signInWithPopup(auth, provider);
    } catch (e) {
        if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) return;
        console.error(e);
        toast(e.code === 'auth/unauthorized-domain'
            ? `Add ${location.hostname} in Firebase → Authentication → Settings → Authorized domains.`
            : e.code === 'auth/operation-not-allowed' ? 'Turn on Google in Firebase → Authentication → Sign-in method.'
            : e.message, true);
    }
};
$('signOutBtn').onclick = () => authMod.signOut(auth);

authMod.onAuthStateChanged(auth, user => {
    $('signOutBtn').classList.toggle('hidden', !user);
    if (!user) { data = null; showSignIn(); return; }
    show('loading');
    load();
});
