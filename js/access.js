// Server-side access control: bans by IP address, device and account (see functions/moderation.js).
import { callable } from './cloud.js';
import { deviceFingerprint } from './fingerprint.js';

const RECHECK_MS = 90 * 60000; // the server's pass lasts 2 h; refresh well before

// The visit log (functions/visits.js, Privacy Policy "Abuse prevention"): the server records the one address it sees; the device
// also says what it has on the other protocol (IPv4 and IPv6), asked once per visit from ipify. Never holds the check up for long.
const IP_LOOKUP_MS = 2500;
async function ownAddress(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IP_LOOKUP_MS);
    try {
        const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
        const ip = r.ok ? String((await r.json()).ip || '') : '';
        return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : '';
    } catch {
        return '';
    } finally {
        clearTimeout(timer);
    }
}
let addresses = null;
export function ownAddresses() {
    addresses ||= Promise.all([ownAddress('https://api4.ipify.org?format=json'), ownAddress('https://api6.ipify.org?format=json')])
        .then(([v4, v6]) => ({ ...(v4 ? { v4 } : {}), ...(v6 ? { v6 } : {}) }));
    return addresses;
}
const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

export class Access {
    constructor(transport, region) {
        ownAddresses(); // start now, alongside the rest of the start-up
        this.t = transport;
        this.region = region;
        this.status = null;
        this.checkedAt = 0;
    }

    async call(name, data = {}) {
        const fn = await callable(this.t, name, this.region);
        const { data: res } = await fn({ ...data, fp: await deviceFingerprint() });
        if (res && 'allowed' in res) { this.status = res; this.checkedAt = Date.now(); }
        return res;
    }

    /** { allowed, ban: {reason, note, until} | null, videoBanUntil } */
    async check() {
        const ips = await within(ownAddresses(), 1500); // a slow or blocked lookup is skipped this time, not waited for
        return this.call('checkAccess', ips && Object.keys(ips).length ? { ips } : {});
    }

    /** Check again only if the last answer is getting old. */
    async fresh() {
        if (!this.status || Date.now() - this.checkedAt > RECHECK_MS) await this.check();
        return this.status;
    }

    /** 'underage' | 'age-inconclusive' | 'nudity-strike' */
    report(type) { return this.call('reportViolation', { type }); }

    requestUnban(message, contact) { return this.call('requestUnban', { message, contact }); }
}
