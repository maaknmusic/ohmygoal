// The visit log, for tracing fraud and abuse (admin page → Visits). Disclosed in the Privacy Policy ("Abuse prevention").
//
// Every check-in from the website (checkAccess, which runs when the page connects and before chats) adds to one row per
// account + address + device per 30 minutes: when, the address the server saw (IPv4 or IPv6, the one a visitor cannot
// fake), the addresses the device says it has on the other protocol (looked up in the browser, so marked as reported), the
// device identifier, the browser, and the Google email for signed-in accounts. Rows live in the private tree (no client can
// read or write them) and are deleted 90 days after the last visit (moderation.js sweepOldRecords).
// The approximate place of each address is saved into the row at visit time (onVisitWritten, just after the check-in, so the
// visitor never waits for it): g for the address the server saw, g4 / g6 for the reported ones. Looked-up places are cached
// for 7 days, so one address is asked about at most once a week. If a lookup fails (IPinfo's free limit is 1,000 a day), the
// admin page looks the place up when the log is opened instead.
import crypto from 'node:crypto';
import net from 'node:net';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { privateCol, privateDoc } from './common.js';

export const VISIT_BUCKET_MS = 30 * 60000;
export const VISIT_KEEP_MS = 90 * 24 * 3600000;
export const GEO_KEEP_MS = 7 * 24 * 3600000; // a place looked up for an address is reused for a week
const GEO_TIMEOUT_MS = 2500;
const MAX_GEO_LOOKUPS = 40; // per page of the log
// IPinfo's free API (city, region, country, network): 1,000 a day without a key. The emulator tests use a local stand-in.
const GEO_API = process.env.FUNCTIONS_EMULATOR === 'true' ? 'http://127.0.0.1:7777/ipinfo' : 'https://ipinfo.io';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');

/** A full address as the server saw it: IPv4 as-is, IPv6 in lower case, an IPv4-mapped IPv6 address as IPv4. '' if not an address. */
export function plainIp(raw) {
    let ip = String(raw || '').trim().replace(/^\[|\]$/g, '');
    if (ip.toLowerCase().startsWith('::ffff:') && net.isIP(ip.slice(7)) === 4) ip = ip.slice(7);
    const v = net.isIP(ip);
    return v === 4 ? ip : v === 6 ? ip.toLowerCase() : '';
}

/** Is this an address on the public internet (not private, loopback, link-local or shared carrier space)? */
export function isPublic(ip) {
    const v = net.isIP(ip);
    if (v === 4) {
        const [a, b] = ip.split('.').map(Number);
        return !(a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
    }
    if (v === 6) {
        const l = ip.toLowerCase();
        return !(l === '::' || l === '::1' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('ff'));
    }
    return false;
}

/**
 * The addresses the device reports for itself ({ v4, v6 }, from the browser): only well-formed public addresses of the stated
 * protocol, and not the one the server already saw. A device can send anything here, so they are kept apart and marked.
 */
export function reportedIps(data, seen) {
    const out = {};
    const v4 = plainIp(data?.v4), v6 = plainIp(data?.v6);
    if (v4 && net.isIP(v4) === 4 && isPublic(v4) && v4 !== seen) out.v4 = v4;
    if (v6 && net.isIP(v6) === 6 && isPublic(v6) && v6 !== seen) out.v6 = v6;
    return out;
}

/** A short, readable device line from the browser's user agent: "Chrome 131 · Android 14 · Pixel 7". */
export function deviceText(ua) {
    ua = String(ua || '');
    if (!ua) return '';
    // The most specific name first: Edge, Opera and Samsung Internet also say "Chrome", and Chrome also says "Safari".
    const names = [['Edg', 'Edge'], ['EdgA', 'Edge'], ['OPR', 'Opera'], ['SamsungBrowser', 'Samsung Internet'], ['FxiOS', 'Firefox'], ['Firefox', 'Firefox'],
        ['CriOS', 'Chrome'], ['Chrome', 'Chrome'], ['Version', /Safari/.test(ua) ? 'Safari' : 'Browser']];
    let b = '';
    for (const [token, name] of names) {
        const hit = new RegExp(`${token}/(\\d+)`).exec(ua);
        if (hit) { b = `${name} ${hit[1]}`; break; }
    }
    let os = '';
    let m;
    if ((m = /Android (\d+(?:\.\d+)?)/.exec(ua))) os = `Android ${m[1]}`;
    else if ((m = /(?:iPhone|CPU) OS (\d+)[_\d]*/.exec(ua))) os = `iOS ${m[1]}`;
    else if (/iPad/.test(ua)) os = 'iPadOS';
    else if ((m = /Windows NT (\d+\.\d+)/.exec(ua))) os = `Windows ${{ '10.0': '10/11', '6.3': '8.1', '6.1': '7' }[m[1]] || m[1]}`;
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    let model = '';
    if ((m = /Android [^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\)/.exec(ua)) && !/^(K|wv|Mobile)$/.test(m[1].trim())) model = m[1].trim();
    else if (/iPhone/.test(ua)) model = 'iPhone';
    return [b, os, model].filter(Boolean).join(' · ').slice(0, 120);
}

/** One row per account + address + device per half hour, so a busy visitor does not fill the log. */
export function visitId(uid, ip, fp, now) {
    return `${Math.floor(now / VISIT_BUCKET_MS)}_${sha(`${uid}|${ip}|${fp}`).slice(0, 24)}`;
}

/** Add this check-in to the log. `req` is the raw HTTP request; `token` the caller's auth token. */
export async function recordVisit({ uid, ip, fp, token, req, reported, now = Date.now() }) {
    if (!uid || !ip) return;
    const ua = clip(req?.headers?.['user-agent'], 400);
    const google = token?.firebase?.sign_in_provider === 'google.com';
    const row = {
        uid, ip, v: net.isIP(ip), fp: fp || '',
        at: Math.floor(now / VISIT_BUCKET_MS) * VISIT_BUCKET_MS, last: now, count: FieldValue.increment(1),
        ua, device: deviceText(ua), lang: clip(String(req?.headers?.['accept-language'] || '').split(',')[0], 20),
        account: google ? 'google' : 'anonymous',
        ...(google && token.email ? { email: clip(token.email, 120) } : {}),
    };
    const rep = reportedIps(reported, ip);
    if (rep.v4) row.r4 = rep.v4;
    if (rep.v6) row.r6 = rep.v6;
    await privateCol('visits').doc(visitId(uid, ip, fp || '', now)).set(row, { merge: true });
}

// ---------------- the admin view ----------------

/** What we keep from IPinfo's answer: the place and the network, nothing else. */
export function geoFrom(json) {
    if (!json || typeof json !== 'object' || json.bogon) return null;
    const g = { city: clip(json.city, 60), region: clip(json.region, 60), country: clip(json.country, 2).toUpperCase(), org: clip(json.org, 100), tz: clip(json.timezone, 40) };
    return g.city || g.region || g.country || g.org ? g : null;
}

const geoRef = ip => privateDoc(`ipgeo/${sha(ip).slice(0, 40)}`);

async function lookUp(ip, fetchImpl) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
    try {
        const res = await fetchImpl(`${GEO_API}/${encodeURIComponent(ip)}/json`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) return null;
        return geoFrom(await res.json());
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** Approximate places for these addresses: from the 30-day cache, else looked up (a limited number per call). */
export async function placesFor(ips, { now = Date.now(), fetchImpl = fetch } = {}) {
    const unique = [...new Set(ips.filter(ip => ip && isPublic(ip)))];
    const out = {};
    if (!unique.length) return out;
    const cached = await Promise.all(unique.map(ip => geoRef(ip).get()));
    const missing = [];
    unique.forEach((ip, i) => {
        const d = cached[i].data();
        if (d && now - d.at < GEO_KEEP_MS) out[ip] = d.geo || null;
        else missing.push(ip);
    });
    const todo = missing.slice(0, MAX_GEO_LOOKUPS);
    await Promise.all(todo.map(async ip => {
        const geo = await lookUp(ip, fetchImpl);
        out[ip] = geo;
        if (geo) await geoRef(ip).set({ at: now, geo }).catch(() => {});
    }));
    return out;
}

/** What the admin typed: an IP address, an email, a device identifier, an account ID, or nothing (the latest visits). */
export function parseQuery(raw) {
    const q = String(raw || '').trim().slice(0, 200);
    if (!q) return { type: 'latest' };
    const ip = plainIp(q);
    if (ip) return { type: 'ip', value: ip };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return { type: 'email', value: q.toLowerCase() };
    if (/^[a-f0-9]{16,64}$/.test(q)) return { type: 'fp', value: q };
    if (/^[A-Za-z0-9_-]{6,128}$/.test(q)) return { type: 'uid', value: q };
    return { type: 'invalid' };
}

// ---------------- the place, saved at visit time ----------------

/** The places a row still needs: [field, address] for each address whose saved place is missing or belongs to another address. */
export function placesWanted(row) {
    if (!row) return [];
    return [['g', row.ip], ['g4', row.r4], ['g6', row.r6]].filter(([k, ip]) => ip && isPublic(ip) && row[k]?.ip !== ip);
}

/** Runs after a check-in wrote its row: saves the place of its addresses into it. Writing the place triggers this again, which then has nothing to do. */
export const onVisitWritten = onDocumentWritten({ document: 'artifacts/anon-connect/private/data/visits/{visitId}', retry: false }, async event => {
    const row = event.data?.after?.data();
    const want = placesWanted(row);
    if (!want.length) return;
    try {
        const places = await placesFor(want.map(([, ip]) => ip));
        const patch = {};
        for (const [k, ip] of want) if (places[ip]) patch[k] = { ...places[ip], ip, at: Date.now() };
        if (Object.keys(patch).length) await event.data.after.ref.update(patch);
    } catch (e) {
        logger.warn('visit place failed', { message: e.message });
    }
});

const LIMIT = 200;

/** Rows for the admin page, newest first, each with the approximate place of its addresses. */
export async function listVisits(raw, opts = {}) {
    const q = parseQuery(raw);
    if (q.type === 'invalid') return { query: q, visits: [], places: {} };
    const col = privateCol('visits');
    // Equality filters only (no composite indexes needed); sorted here.
    const queries = q.type === 'latest' ? [col.orderBy('last', 'desc').limit(LIMIT)]
        : q.type === 'ip' ? [col.where('ip', '==', q.value).limit(LIMIT), col.where('r4', '==', q.value).limit(LIMIT), col.where('r6', '==', q.value).limit(LIMIT)]
        : [col.where(q.type, '==', q.value).limit(LIMIT)];
    const snaps = await Promise.all(queries.map(x => x.get()));
    const seen = new Map();
    for (const s of snaps) for (const d of s.docs) seen.set(d.id, { id: d.id, ...d.data() });
    const visits = [...seen.values()].sort((a, b) => b.last - a.last).slice(0, LIMIT);
    // Places saved at visit time are used as they are; only addresses still without one are looked up now.
    const places = await placesFor(visits.flatMap(v => placesWanted(v).map(([, ip]) => ip)), opts);
    return { query: q, visits, places };
}
