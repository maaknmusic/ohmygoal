// Adaptive video quality: when it steps down, when it steps up, that it doesn't flap, and reading a stats report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, createAdaptive, qualityNote, readSample } from '/home/user/ohmygoal/js/adaptive.js';

const GOOD = { rtt: 80, loss: 0, available: 3000000 };
const LOSSY = { rtt: 150, loss: 0.1, available: null };

const feed = (a, sample, n) => { const out = []; for (let i = 0; i < n; i++) out.push(a.update(sample)); return out; };

test('the tiers get strictly cheaper and are frozen', () => {
    for (let i = 1; i < TIERS.length; i++) {
        assert.ok(TIERS[i].maxBitrate < TIERS[i - 1].maxBitrate, TIERS[i].id);
        assert.ok(TIERS[i].scale > TIERS[i - 1].scale, TIERS[i].id);
        assert.ok(TIERS[i].fps <= TIERS[i - 1].fps, TIERS[i].id);
    }
    assert.equal(TIERS[0].scale, 1);
    assert.ok(Object.isFrozen(TIERS) && Object.isFrozen(TIERS[0]));
});

test('a good connection stays at full quality', () => {
    const a = createAdaptive();
    assert.deepEqual(feed(a, GOOD, 40).filter(x => x !== null), []);
    assert.equal(a.tier, 0);
});

test('two bad readings in a row lower the quality one step; one bad reading does not', () => {
    const a = createAdaptive();
    assert.equal(a.update(LOSSY), null);
    assert.equal(a.update(GOOD), null);   // a good reading in between resets the streak
    assert.equal(a.update(LOSSY), null);
    assert.equal(a.update(LOSSY), 1);
    assert.equal(a.tier, 1);
});

test('after a change the next reading is ignored while the numbers catch up', () => {
    const a = createAdaptive();
    feed(a, LOSSY, 2);
    assert.equal(a.tier, 1);
    assert.equal(a.update(LOSSY), null); // settling
    assert.equal(a.update(LOSSY), null); // first counted bad reading
    assert.equal(a.update(LOSSY), 2);
});

test('severe loss drops an extra step', () => {
    const a = createAdaptive();
    feed(a, { rtt: 100, loss: 0.3, available: null }, 2);
    assert.equal(a.tier, 2);
});

test('a low bandwidth estimate jumps straight to a tier it can carry', () => {
    const a = createAdaptive();
    feed(a, { rtt: 100, loss: 0, available: 300000 }, 2); // 300 kbps: low (200k) fits, medium (450k) does not
    assert.equal(TIERS[a.tier].id, 'low');
});

test('high round-trip time counts as bad', () => {
    const a = createAdaptive();
    feed(a, { rtt: 900, loss: 0, available: null }, 2);
    assert.equal(a.tier, 1);
});

test('it never goes below the last tier or above the first', () => {
    const a = createAdaptive();
    for (let i = 0; i < 200; i++) a.update({ rtt: 2000, loss: 0.5, available: 10000 });
    assert.equal(a.tier, TIERS.length - 1);
    for (let i = 0; i < 400; i++) a.update(GOOD);
    assert.equal(a.tier, 0);
});

test('recovery is slow: five good readings per step, and it needs headroom', () => {
    const a = createAdaptive({ start: 2 });
    // tier 2 -> 1 needs the estimate to cover tier 1 (900k) with 25% to spare
    assert.deepEqual(feed(a, { rtt: 100, loss: 0, available: 1000000 }, 12).filter(x => x !== null), []);
    assert.equal(a.tier, 2);
    const ups = feed(a, GOOD, 5);
    assert.equal(ups[4], 1);
    assert.equal(a.tier, 1);
});

test('it does not flap on a connection that alternates good and bad', () => {
    const a = createAdaptive();
    const changes = [];
    for (let i = 0; i < 100; i++) { const c = a.update(i % 2 ? GOOD : LOSSY); if (c !== null) changes.push(c); }
    assert.deepEqual(changes, []);
});

test('empty, missing and nonsense samples change nothing', () => {
    const a = createAdaptive({ start: 1 });
    for (const s of [undefined, null, {}, { rtt: null, loss: null, available: null }, { rtt: NaN, loss: -1, available: Infinity }, 'x', 5]) {
        assert.equal(a.update(s), null, JSON.stringify(s));
    }
    assert.equal(a.tier, 1);
});

test('start is clamped and reset works', () => {
    assert.equal(createAdaptive({ start: 99 }).tier, TIERS.length - 1);
    assert.equal(createAdaptive({ start: -3 }).tier, 0);
    const a = createAdaptive();
    feed(a, LOSSY, 2);
    a.reset();
    assert.equal(a.tier, 0);
    assert.equal(a.update(LOSSY), null); // counters were cleared too
});

test('qualityNote speaks only when the video was lowered', () => {
    assert.equal(qualityNote(0), '');
    assert.match(qualityNote(1), /lowering video quality/);
    assert.match(qualityNote(2), /lowering video quality/);
    assert.match(qualityNote(3), /lowered a lot/);
});

test('readSample reads rtt, loss and the bandwidth estimate from a stats report', () => {
    const report = new Map([
        ['a', { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.0834, availableOutgoingBitrate: 1234567 }],
        ['b', { type: 'candidate-pair', nominated: false, state: 'succeeded', currentRoundTripTime: 9, availableOutgoingBitrate: 1 }],
        ['c', { type: 'remote-inbound-rtp', kind: 'video', fractionLost: 0.04, roundTripTime: 0.2 }],
        ['d', { type: 'remote-inbound-rtp', kind: 'audio', fractionLost: 0.9 }],
    ]);
    assert.deepEqual(readSample(report), { rtt: 83, loss: 0.04, available: 1234567 });
    assert.deepEqual(readSample(new Map()), { rtt: null, loss: null, available: null });
    // Firefox reports no bandwidth estimate; the round-trip time can come from the remote report
    assert.deepEqual(readSample(new Map([['c', { type: 'remote-inbound-rtp', mediaType: 'video', fractionLost: 0, roundTripTime: 0.05 }]])), { rtt: 50, loss: 0, available: null });
});
