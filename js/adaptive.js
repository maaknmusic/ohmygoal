// Adaptive video quality. Every couple of seconds the app reads what the connection reports (round-trip time,
// packet loss, the bandwidth the browser estimates) and this module says which "tier" the outgoing video should use.
// Pure logic, no browser APIs: the app turns a tier into RTCRtpSender parameters (see applyVideoTier in app.js).
//
// Going DOWN is quick (two bad readings in a row, about 4 seconds) because a stuttering call is the worst case.
// Going UP is slow (five good readings, about 10 seconds, and enough headroom for the next tier) so quality doesn't flap.

/** maxBitrate in bits per second; scale divides the captured size (1 = as captured, 2 = half the width and height). */
export const TIERS = Object.freeze([
    Object.freeze({ id: 'full', label: 'HD', maxBitrate: 1500000, scale: 1, fps: 30 }),
    Object.freeze({ id: 'high', label: 'Good', maxBitrate: 900000, scale: 1.5, fps: 30 }),
    Object.freeze({ id: 'medium', label: 'Standard', maxBitrate: 450000, scale: 2, fps: 24 }),
    Object.freeze({ id: 'low', label: 'Data saver', maxBitrate: 200000, scale: 3, fps: 15 }),
    Object.freeze({ id: 'minimal', label: 'Minimum', maxBitrate: 90000, scale: 4, fps: 10 }),
]);
const LAST = TIERS.length - 1;

const LOSS_BAD = 0.06;     // 6% of packets lost since the last report
const LOSS_SEVERE = 0.2;
const RTT_BAD = 600;       // ms
const RTT_GOOD = 300;
const LOSS_GOOD = 0.02;
const BITRATE_FIT = 0.85;  // a tier fits when it needs no more than this share of the estimated bandwidth
const HEADROOM = 1.25;     // to step up, the estimate must cover the next tier with this much to spare

const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** @param {{start?: number, downAfter?: number, upAfter?: number, settle?: number}} [opts] */
export function createAdaptive({ start = 0, downAfter = 2, upAfter = 5, settle = 1 } = {}) {
    let tier = Math.min(LAST, Math.max(0, start | 0));
    let bad = 0, good = 0, skip = 0;
    const go = next => {
        tier = next;
        bad = good = 0;
        skip = settle;
        return tier;
    };
    return {
        get tier() { return tier; },
        reset(to = 0) { tier = Math.min(LAST, Math.max(0, to | 0)); bad = good = skip = 0; },
        /**
         * @param {{rtt?: number|null, loss?: number|null, available?: number|null}} sample  rtt in ms, loss 0..1, available in bits per second
         * @returns {number|null} the new tier when it changed, otherwise null
         */
        update(sample) {
            const rtt = num(sample?.rtt), loss = num(sample?.loss), available = num(sample?.available);
            if (rtt == null && loss == null && available == null) return null; // nothing to go on
            if (skip > 0) { skip--; return null; }                              // let the last change show up in the numbers first

            const cur = TIERS[tier];
            const isBad = (loss != null && loss >= LOSS_BAD) || (rtt != null && rtt >= RTT_BAD)
                || (available != null && tier < LAST && available < cur.maxBitrate * 0.7);
            const isGood = (loss == null || loss < LOSS_GOOD) && (rtt == null || rtt < RTT_GOOD)
                && (tier === 0 || available == null || available >= TIERS[tier - 1].maxBitrate * HEADROOM);

            if (isBad && tier < LAST) {
                good = 0;
                if (++bad < downAfter) return null;
                let next = tier + 1;
                if (available != null) { // jump straight to a tier the estimate can carry
                    while (next < LAST && TIERS[next].maxBitrate > available * BITRATE_FIT) next++;
                }
                if (loss != null && loss >= LOSS_SEVERE && next < LAST) next++;
                return go(next);
            }
            if (isGood && tier > 0) {
                bad = 0;
                if (++good < upAfter) return null;
                return go(tier - 1);
            }
            // in between (or already at an end): neither streak continues
            bad = 0;
            good = 0;
            return null;
        },
    };
}

/** What to tell the person, once, the first time the video had to be turned down. */
export function qualityNote(tier) {
    if (tier >= 3) return 'Slow connection: video quality is lowered a lot to keep the sound clear.';
    if (tier >= 1) return 'Slow connection: lowering video quality to keep the call smooth.';
    return '';
}

/** Reads the numbers this module needs out of an RTCStatsReport (or any Map-like of stats objects). */
export function readSample(report) {
    let rtt = null, loss = null, available = null;
    report.forEach(r => {
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
            if (num(r.currentRoundTripTime) != null) rtt = Math.round(r.currentRoundTripTime * 1000);
            if (num(r.availableOutgoingBitrate) != null) available = r.availableOutgoingBitrate;
        } else if (r.type === 'remote-inbound-rtp' && (r.kind === 'video' || r.mediaType === 'video')) {
            if (num(r.fractionLost) != null) loss = r.fractionLost;
            if (rtt == null && num(r.roundTripTime) != null) rtt = Math.round(r.roundTripTime * 1000);
        }
    });
    return { rtt, loss, available };
}
