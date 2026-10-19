// =====================================================================
// Moderation: server-side bans by IP address, device fingerprint and account,
// access passes for matchmaking, unban requests and the admin API.
//
// - checkAccess (every visit): looks up bans for the caller's IP / fingerprint /
//   uid and, if allowed, writes access/{uid}, a pass valid for 2 hours. firestore.rules only
//   let users join the matching queue with a valid pass, so bans hold even in a
//   private tab or a modified copy of the app.
// - reportViolation: the app reports its own user's age-check / nudity outcomes;
//   the server decides the penalty (a caller can only ever penalise itself).
// - requestUnban: a banned user asks for a review, shown on the admin page.
// - admin: actions for admin.html, allowed only for emails in the ADMIN_EMAILS secret.
// =====================================================================
import crypto from 'node:crypto';
import net from 'node:net';
import { logger } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { Timestamp } from 'firebase-admin/firestore';
import { db, publicDoc, privateDoc, privateCol, publicCol } from './common.js';

const ADMIN_EMAILS = defineSecret('ADMIN_EMAILS'); // comma-separated Google emails

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ACCESS_PASS_MS = 2 * HOUR; // short, so a new IP ban reaches other people on that IP soon

/** Penalties are decided here, never by the client. */
const RULES = {
    underage: { scope: 'all', ms: DAY, reason: 'underage' },
    ageCooldown: { scope: 'all', ms: 15 * MIN, reason: 'age-inconclusive', tries: 3, window: HOUR },
    nudity: { scope: 'video', ms: DAY, reason: 'nudity', strikes: 3, window: DAY },
};

// ---------------- helpers ----------------

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const keyOf = (type, value) => `${type}_${sha(`${type}:${value}`).slice(0, 40)}`;
// One record per scope ('all' = no chatting, 'video' = text only) per key, so different penalties never overwrite each other.
const SCOPES = ['all', 'video'];
const banRef = (scope, type, value) => privateDoc(`bans/${scope}_${keyOf(type, value)}`);
const whitelistRef = ip => privateDoc(`whitelist/${keyOf('ip', ip)}`);
const counterRef = (kind, type, value) => privateDoc(`counters/${kind}_${keyOf(type, value)}`);

function isPublicIp(ip) {
    const v = net.isIP(ip);
    if (v === 4) {
        const [a, b] = ip.split('.').map(Number);
        return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
    }
    if (v === 6) {
        const l = ip.toLowerCase();
        return !(l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80'));
    }
    return false;
}

// Google's own load-balancer / proxy ranges, which can appear after the client in X-Forwarded-For.
function isGoogleProxy(ip) {
    if (net.isIP(ip) !== 4) return false;
    const [a, b, c] = ip.split('.').map(Number);
    return (a === 35 && b === 191) || (a === 130 && b === 211 && c < 4);
}

/** IPv4 as-is; IPv6 as its /64 prefix (one household / phone usually owns a whole /64). */
export function normalizeIp(raw) {
    let ip = String(raw || '').trim().replace(/^\[|\]$/g, '');
    if (ip.startsWith('::ffff:') && net.isIP(ip.slice(7)) === 4) ip = ip.slice(7);
    if (net.isIP(ip) === 6) {
        // Expand "::" so we can take the first four groups.
        const [head, tail = ''] = ip.toLowerCase().split('::');
        const h = head ? head.split(':') : [];
        const t = tail ? tail.split(':') : [];
        const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
        return `${groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
    }
    return net.isIP(ip) === 4 ? ip : '';
}

/**
 * The caller's IP. Google's front end appends the real client address to X-Forwarded-For,
 * so the right-most public entry is the one a client can't fake.
 */
function clientIp(req) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    for (let i = xff.length - 1; i >= 0; i--) {
        const ip = xff[i].replace(/^\[|\]$/g, '').replace(/:\d+$/, m => (net.isIP(xff[i]) ? m : ''));
        if (isPublicIp(ip) && !isGoogleProxy(ip)) return normalizeIp(ip);
    }
    return normalizeIp(req.ip || req.socket?.remoteAddress || '');
}

function identity(request) {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please reload the page.');
    const fp = typeof request.data?.fp === 'string' && /^[a-f0-9]{16,64}$/.test(request.data.fp) ? request.data.fp : '';
    return { uid: request.auth.uid, ip: clientIp(request.rawRequest), fp };
}

async function isWhitelisted(ip) {
    return !!ip && (await whitelistRef(ip).get()).exists;
}

/** The network neighbourhood of an address: IPv4 /24, IPv6 /48. */
function netPrefix(ip) {
    if (ip.endsWith('::/64')) return `${ip.split(':').slice(0, 3).join(':')}::/48`;
    return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
}

/**
 * The device key: the fingerprint together with the network neighbourhood. Phones of the same
 * model and browser version often share a fingerprint, so it is never used on its own: that
 * would also ban strangers with the same phone anywhere in the country.
 */
const deviceKey = ({ fp, ip }) => (fp && ip ? `${fp}@${netPrefix(ip)}` : '');

/**
 * The keys a ban is stored and looked up under. A whitelisted IP is a shared network
 * (office, college, mobile carrier), so there only the account counts.
 */
const keysOf = (id, whitelisted) =>
    [['uid', id.uid], ...(whitelisted ? [] : [['fp', deviceKey(id)], ['ip', id.ip]])].filter(([, v]) => v);

/** Keys that count strikes and age-check tries: per account and device, never per IP. */
const counterKeys = id => [['uid', id.uid], ['fp', deviceKey(id)]].filter(([, v]) => v);

/** Active bans that apply to this identity. */
async function activeBans(id) {
    const whitelisted = await isWhitelisted(id.ip);
    const refs = SCOPES.flatMap(scope => keysOf(id, whitelisted).map(([t, v]) => banRef(scope, t, v)));
    const snaps = await db.getAll(...refs);
    const now = Date.now();
    return {
        whitelisted,
        bans: snaps.filter(s => s.exists && s.data().until > now).map(s => ({ id: s.id, ...s.data() })),
    };
}

/** Ban every key of an identity (only the account on a whitelisted IP). */
async function ban(id, { scope, ms, reason, by = 'system', note = '' }) {
    const { uid, ip, fp } = id;
    const until = Date.now() + ms;
    const whitelisted = await isWhitelisted(ip);
    const keys = keysOf(id, whitelisted);
    const batch = db.batch();
    for (const [type, value] of keys) {
        const ref = banRef(scope, type, value);
        const existing = (await ref.get()).data();
        if (existing && existing.until > until) continue; // never shorten an existing ban
        batch.set(ref, {
            type, value, scope, reason, note, until, createdAt: Date.now(), createdBy: by,
            uid: uid || '', ip: ip || '', fp: fp || '',
        });
    }
    await batch.commit();
    // No uid, IP or admin email in the logs: those live only in the access-controlled database.
    logger.info('ban', { reason, scope, by: by === 'system' ? 'system' : 'admin', keys: keys.length });
    return keys.length;
}

/** Count an event for each key in a time window; returns the highest count. */
async function bump(kind, keys, window) {
    let max = 0;
    await db.runTransaction(async t => {
        const refs = keys.map(([type, value]) => counterRef(kind, type, value));
        const snaps = await Promise.all(refs.map(r => t.get(r)));
        const now = Date.now();
        snaps.forEach((s, i) => {
            const d = s.data();
            const fresh = !d || now - d.windowStart > window;
            const count = (fresh ? 0 : d.count) + 1;
            max = Math.max(max, count);
            t.set(refs[i], { count, windowStart: fresh ? now : d.windowStart });
        });
    });
    return max;
}

async function resetCounters(kind, keys) {
    await Promise.all(keys.map(([type, value]) => counterRef(kind, type, value).delete().catch(() => {})));
}

/** Write (or revoke) the caller's access pass and describe their status. */
async function refreshAccess(id) {
    const { bans, whitelisted } = await activeBans(id);
    const full = bans.filter(b => b.scope === 'all').sort((a, b) => b.until - a.until)[0] || null;
    const videoBanUntil = Math.max(0, ...bans.filter(b => b.scope === 'video').map(b => b.until));
    const pass = publicDoc(`access/${id.uid}`);
    if (full) await pass.delete().catch(() => {});
    else await pass.set({ until: Date.now() + ACCESS_PASS_MS, videoBanUntil });
    await privateDoc(`clients/${id.uid}`).set({ ip: id.ip, fp: id.fp, lastSeen: Date.now() }, { merge: true });
    return {
        allowed: !full,
        // A ban found through a shared IP or device but issued to another account does not reveal that person's reason or note.
        ban: full ? (!full.uid || full.uid === id.uid
            ? { scope: 'all', reason: full.reason, note: full.note || '', until: full.until }
            : { scope: 'all', reason: 'admin', note: '', until: full.until }) : null,
        videoBanUntil,
        whitelisted,
    };
}

// ---------------- public callables ----------------

export const checkAccess = onCall(async request => {
    const status = await refreshAccess(identity(request));
    // A little housekeeping on a small share of visits, so cleanup never depends on the admin page being opened.
    if (Math.random() < 0.03) await sweepOldRecords().catch(e => logger.warn('sweep failed', { message: e.message }));
    return status;
});

export const reportViolation = onCall(async request => {
    const id = identity(request);
    const type = request.data?.type;
    // Tries and strikes are counted per account and device, not per IP: many people can share
    // one IP (mobile networks, colleges). The resulting cooldown or ban still covers the IP.
    const counted = counterKeys(id);
    if (type === 'underage') {
        await ban(id, RULES.underage);
    } else if (type === 'age-inconclusive') {
        const r = RULES.ageCooldown;
        const tries = await bump('age', counted, r.window);
        if (tries >= r.tries) {
            await ban(id, r);
            await resetCounters('age', counted);
        }
        const status = await refreshAccess(id);
        return { ...status, triesLeft: Math.max(0, r.tries - tries) };
    } else if (type === 'nudity-strike') {
        const r = RULES.nudity;
        const strikes = await bump('nudity', counted, r.window);
        if (strikes >= r.strikes) {
            await ban(id, r);
            await resetCounters('nudity', counted);
        }
        const status = await refreshAccess(id);
        return { ...status, strikes, strikesForBan: r.strikes };
    } else {
        throw new HttpsError('invalid-argument', 'Unknown violation.');
    }
    return refreshAccess(id);
});

export const requestUnban = onCall(async request => {
    const id = identity(request);
    const message = String(request.data?.message || '').trim().slice(0, 600);
    const contact = String(request.data?.contact || '').trim().slice(0, 120);
    if (message.length < 5) throw new HttpsError('invalid-argument', 'Please tell us a little more.');
    const { bans } = await activeBans(id);
    if (!bans.length) throw new HttpsError('failed-precondition', 'You are not currently restricted. Try reloading the page.');
    // One open request per account; at most 3 per IP per day.
    const open = await privateCol('unbanRequests').where('uid', '==', id.uid).where('status', '==', 'open').limit(1).get();
    if (!open.empty) return { requestId: open.docs[0].id, duplicate: true };
    if (id.ip) {
        const used = (await counterRef('appeal', 'ip', id.ip).get()).data();
        if (used && Date.now() - used.windowStart <= DAY && used.count >= 3) {
            throw new HttpsError('resource-exhausted', 'Too many requests from your network today.');
        }
        await bump('appeal', [['ip', id.ip]], DAY);
    }
    const ref = await privateCol('unbanRequests').add({
        uid: id.uid, ip: id.ip, fp: id.fp, message, contact, status: 'open', createdAt: Date.now(),
        bans: bans.map(b => ({ id: b.id, type: b.type, scope: b.scope, reason: b.reason, until: b.until })),
    });
    return { requestId: ref.id };
});

// ---------------- admin ----------------

function requireAdmin(request) {
    const t = request.auth?.token;
    const allowed = ADMIN_EMAILS.value().split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!t || t.firebase?.sign_in_provider !== 'google.com' || !t.email_verified || !allowed.includes(String(t.email).toLowerCase())) {
        throw new HttpsError('permission-denied', 'This account is not an admin.');
    }
    return t.email;
}

const docs = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

const banRefsOf = id => SCOPES.flatMap(scope => keysOf(id, false).map(([t, v]) => banRef(scope, t, v)));

/**
 * Lifts every ban on this identity, and on the identities those bans were issued to:
 * a request sent from a private window (new account, same device/IP) also frees the
 * original account. Strike counters are reset so they can try the age check again.
 */
async function unbanIdentity(id) {
    const found = await db.getAll(...banRefsOf(id));
    const people = [id, ...found.filter(s => s.exists).map(s => s.data())];
    const refs = new Map(people.flatMap(banRefsOf).map(r => [r.path, r]));
    await Promise.all([...refs.values()].map(r => r.delete()));
    for (const person of people) {
        await resetCounters('age', counterKeys(person));
        await resetCounters('nudity', counterKeys(person));
    }
}

/**
 * Keeps the promise in the privacy policy: appeals and visit records are not kept forever.
 * Runs (a little at a time) whenever the admin overview is opened.
 */
const RETENTION = [
    ['unbanRequests', 'createdAt', 90 * DAY],   // appeals: 90 days
    ['clients', 'lastSeen', 90 * DAY],          // IP / device record of a visit: 90 days since the last visit
    ['bans', 'until', 30 * DAY],                // bans are removed 30 days after they expired
    ['counters', 'windowStart', 7 * DAY],       // strike / try / appeal counters
    ['likeCounters', 'times', null],            // (kept: tiny, self-trimming)
    ['likePairs', 'at', 2 * DAY],
    ['likeLog', 'at', 2 * DAY],
];
async function sweepOldRecords() {
    const now = Date.now();
    for (const [col, field, age] of RETENTION) {
        if (!age) continue;
        const snap = await privateCol(col).where(field, '<', now - age).limit(200).get();
        if (snap.empty) continue;
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
    // Matching rooms and their connection-setup messages (which can hold network addresses), dead queue entries and presence: after a day.
    const cutoff = now - DAY;
    const rooms = [
        ...(await publicCol('rooms').where('created', '<', Timestamp.fromMillis(cutoff)).limit(40).get()).docs,
        ...(await publicCol('rooms').where('created', '<', cutoff).limit(40).get()).docs, // friend calls store a number
    ];
    for (const d of rooms) await db.recursiveDelete(d.ref).catch(() => {});
    for (const col of ['queue', 'presence']) {
        const snap = await publicCol(col).where('ts', '<', cutoff).limit(200).get();
        if (snap.empty) continue;
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
}

export const admin = onCall({ secrets: [ADMIN_EMAILS] }, async request => {
    const email = requireAdmin(request);
    const { action } = request.data || {};
    const log = (what, details) => privateCol('adminLog').add({ at: Date.now(), by: email, what, details: details || {} });
    const now = Date.now();

    switch (action) {
        case 'overview': {
            const [requests, bans, whitelist, reports] = await Promise.all([
                privateCol('unbanRequests').orderBy('createdAt', 'desc').limit(100).get(),
                privateCol('bans').where('until', '>', now).orderBy('until', 'desc').limit(300).get(),
                privateCol('whitelist').orderBy('addedAt', 'desc').limit(500).get(),
                publicCol('reports').where('ts', '<=', Timestamp.now()).orderBy('ts', 'desc').limit(100).get(),
                sweepOldRecords().catch(e => logger.warn('sweep failed', { message: e.message })),
            ]);
            const reportList = docs(reports).map(r => ({ ...r, ts: r.ts?.toMillis?.() || 0 }));
            const reported = [...new Set(reportList.map(r => r.reported).filter(Boolean))];
            const clients = reported.length ? await db.getAll(...reported.map(u => privateDoc(`clients/${u}`))) : [];
            const clientOf = Object.fromEntries(clients.map(s => [s.id, s.data() || {}]));
            const counts = reportList.reduce((m, r) => ((m[r.reported] = (m[r.reported] || 0) + 1), m), {});
            return {
                me: { email, ip: clientIp(request.rawRequest) },
                requests: docs(requests),
                bans: docs(bans),
                whitelist: docs(whitelist),
                reports: reportList.map(r => ({ ...r, ip: clientOf[r.reported]?.ip || '', fp: clientOf[r.reported]?.fp || '', count: counts[r.reported] })),
            };
        }
        case 'unban': {
            const ids = (request.data.banIds || []).filter(x => typeof x === 'string' && /^(all|video)_(uid|fp|ip)_[a-f0-9]{40}$/.test(x)).slice(0, 50);
            await Promise.all(ids.map(x => privateDoc(`bans/${x}`).delete()));
            await log('unban', { ids });
            return { ok: true, removed: ids.length };
        }
        case 'resolveRequest': {
            const ref = privateDoc(`unbanRequests/${String(request.data.requestId || '')}`);
            const snap = await ref.get();
            if (!snap.exists) throw new HttpsError('not-found', 'Request not found.');
            const r = snap.data();
            const approve = !!request.data.approve;
            if (approve) {
                await unbanIdentity(r);
                if (request.data.whitelist && r.ip) {
                    await whitelistRef(r.ip).set({ ip: r.ip, note: `From unban request ${snap.id}`, addedAt: now, addedBy: email });
                }
            }
            await ref.update({ status: approve ? 'approved' : 'rejected', resolvedAt: now, resolvedBy: email, note: String(request.data.note || '').slice(0, 300) });
            await log('resolveRequest', { requestId: snap.id, approve, whitelist: !!request.data.whitelist });
            return { ok: true };
        }
        case 'ban': {
            const hours = Math.min(24 * 365, Math.max(1, Number(request.data.hours) || 24));
            const scope = request.data.scope === 'video' ? 'video' : 'all';
            const reason = String(request.data.reason || 'admin').slice(0, 100);
            let { uid = '', ip = '', fp = '' } = request.data;
            uid = typeof uid === 'string' ? uid.slice(0, 128) : '';
            ip = normalizeIp(ip);
            fp = typeof fp === 'string' && /^[a-f0-9]{16,64}$/.test(fp) ? fp : '';
            if (uid && (!ip || !fp)) {
                const c = (await privateDoc(`clients/${uid}`).get()).data() || {};
                ip ||= c.ip || '';
                fp ||= c.fp || '';
            }
            if (!uid && !ip && !fp) throw new HttpsError('invalid-argument', 'Give an IP address or a user.');
            const written = await ban({ uid, ip, fp }, { scope, ms: hours * HOUR, reason, by: email, note: String(request.data.note || '').slice(0, 300) });
            if (!written) throw new HttpsError('failed-precondition', 'That IP address is on the whitelist (a shared network). Remove it from the whitelist first, or ban a user ID instead.');
            if (uid) await publicDoc(`access/${uid}`).delete().catch(() => {});
            await log('ban', { uid, ip, fp, hours, scope, reason });
            return { ok: true };
        }
        case 'whitelistAdd': {
            const ip = normalizeIp(request.data.ip);
            if (!ip) throw new HttpsError('invalid-argument', 'That is not a valid IP address.');
            await whitelistRef(ip).set({ ip, note: String(request.data.note || '').slice(0, 200), addedAt: now, addedBy: email });
            await Promise.all(SCOPES.map(scope => banRef(scope, 'ip', ip).delete().catch(() => {})));
            await log('whitelistAdd', { ip });
            return { ok: true, ip };
        }
        case 'whitelistRemove': {
            const ip = normalizeIp(request.data.ip);
            if (!ip) throw new HttpsError('invalid-argument', 'That is not a valid IP address.');
            await whitelistRef(ip).delete();
            await log('whitelistRemove', { ip });
            return { ok: true };
        }
        default:
            throw new HttpsError('invalid-argument', 'Unknown action.');
    }
});
