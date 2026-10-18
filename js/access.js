// Server-side access control: bans by IP address, device and account (see functions/moderation.js).
import { callable } from './cloud.js';
import { deviceFingerprint } from './fingerprint.js';

const RECHECK_MS = 90 * 60000; // the server's pass lasts 2 h; refresh well before

export class Access {
    constructor(transport, region) {
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
    check() { return this.call('checkAccess'); }

    /** Check again only if the last answer is getting old. */
    async fresh() {
        if (!this.status || Date.now() - this.checkedAt > RECHECK_MS) await this.check();
        return this.status;
    }

    /** 'underage' | 'age-inconclusive' | 'nudity-strike' */
    report(type) { return this.call('reportViolation', { type }); }

    requestUnban(message, contact) { return this.call('requestUnban', { message, contact }); }
}
