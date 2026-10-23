// =====================================================================
// Relay (TURN) credentials. The relay is Cloudflare Realtime TURN. The long-term key stays here (Secret Manager);
// browsers only ever receive short-lived credentials, issued to signed-in people with a valid access pass, so the
// relay can't be drained with credentials copied out of the page source.
//
// Setup (once): Cloudflare dashboard -> Realtime -> TURN Server -> Create. Give deploy.sh the Key ID and API Token.
// If they are not set (the word "unset"), this returns no relay and the app connects directly.
// =====================================================================
import { logger } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { publicDoc, callOpts } from './common.js';

const CF_TURN_KEY_ID = defineSecret('CF_TURN_KEY_ID');
const CF_TURN_API_TOKEN = defineSecret('CF_TURN_API_TOKEN');
// Overridable only so tests can point at a mock; production uses Cloudflare.
const CF_TURN_API = defineString('CF_TURN_API', { default: 'https://rtc.live.cloudflare.com' });

const HOUR = 3600000;
const TTL_S = 4 * 3600;        // a credential works for 4 hours...
const REUSE_MS = 1 * HOUR;     // ...and one is shared for the first hour, so everyone gets at least 3 hours
const FAIL_RETRY_MS = 30000;   // after a failed request, don't ask Cloudflare again for 30 s
const PER_PERSON_PER_HOUR = 30;

const set = v => typeof v === 'string' && v.trim() !== '' && v.trim().toLowerCase() !== 'unset';

let cache = null;              // { servers, at } (per function instance)
let inflight = null;
const calls = new Map();       // uid -> recent call times (per instance)

async function issue() {
    const keyId = CF_TURN_KEY_ID.value(), token = CF_TURN_API_TOKEN.value();
    if (!set(keyId) || !set(token)) return [];
    const res = await fetch(`${CF_TURN_API.value()}/v1/turn/keys/${encodeURIComponent(keyId.trim())}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_S }),
        signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) { logger.error('TURN credential request failed', { status: res.status }); return []; }
    const json = await res.json();
    const list = Array.isArray(json.iceServers) ? json.iceServers : json.iceServers ? [json.iceServers] : [];
    // Port 53 URLs are rejected by browsers; only the fields a browser needs are passed on.
    return list
        .map(s => ({
            urls: [].concat(s.urls || []).filter(u => typeof u === 'string' && !/:53(\?|$)/.test(u)),
            username: String(s.username || ''), credential: String(s.credential || ''),
        }))
        .filter(s => s.urls.length && s.username && s.credential);
}

async function shared() {
    const now = Date.now();
    if (cache && now - cache.at < (cache.servers.length ? REUSE_MS : FAIL_RETRY_MS)) return cache;
    inflight ||= issue().catch(e => { logger.error('TURN credential request errored', { message: e.message }); return []; })
        .then(servers => { cache = { servers, at: Date.now() }; return cache; })
        .finally(() => { inflight = null; });
    return inflight;
}

export const turnCredentials = onCall(callOpts({ secrets: [CF_TURN_KEY_ID, CF_TURN_API_TOKEN] }), async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please reload the page.');
    const uid = request.auth.uid;
    const pass = (await publicDoc(`access/${uid}`).get()).data();
    if (typeof pass?.until !== 'number' || pass.until <= Date.now()) {
        throw new HttpsError('permission-denied', 'Your access has expired. Please reload the page.');
    }
    const now = Date.now();
    const recent = (calls.get(uid) || []).filter(t => t > now - HOUR);
    if (recent.length >= PER_PERSON_PER_HOUR) throw new HttpsError('resource-exhausted', 'Too many requests. Try again later.');
    recent.push(now);
    if (calls.size > 5000) calls.clear();
    calls.set(uid, recent);

    const { servers, at } = await shared();
    return { iceServers: servers, ttl: servers.length ? Math.max(0, Math.floor((at + TTL_S * 1000 - now) / 1000)) : 0 };
});
