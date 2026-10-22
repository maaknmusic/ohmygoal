// Reactions: the wire protocol (what we accept from the other person), the rate budget, and that every sprite draws cleanly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REACTIONS, MAX_BURST, HOLD_MAX, SEND_CAP, RECEIVE_CAP, reactionById, parseReaction, takeBudget, drawSprite } from '/home/user/ohmygoal/js/reactions.js';

const IDS = 'heart laugh fire cheer lotus wow star party balloon rainbow gem bolt'.split(' ');

test('twelve reactions: the first six are free, the pack of six is Premium', () => {
    assert.deepEqual(REACTIONS.map(r => r.id), IDS);
    assert.equal(new Set(REACTIONS.map(r => r.label)).size, 12);
    assert.deepEqual(REACTIONS.filter(r => r.premium).map(r => r.id), IDS.slice(6));
    assert.deepEqual(REACTIONS.filter(r => !r.premium).map(r => r.id), IDS.slice(0, 6));
    assert.equal(reactionById('heart').label, 'Heart');
    assert.equal(reactionById('nope'), null);
    assert.equal(reactionById('__proto__'), null);
    assert.equal(reactionById('constructor'), null);
});

test('parseReaction accepts only known ids and clamps the count', () => {
    assert.deepEqual(parseReaction({ t: 'react', e: 'heart' }), { id: 'heart', n: 1 });
    assert.deepEqual(parseReaction({ e: 'gem', n: 5 }), { id: 'gem', n: 5 });
    assert.deepEqual(parseReaction({ e: 'gem', n: 9999 }), { id: 'gem', n: MAX_BURST });
    for (const n of [0, -3, 2.5, NaN, Infinity, '7', null, undefined, [], {}, true]) {
        const r = parseReaction({ e: 'fire', n });
        assert.ok(r && r.id === 'fire' && Number.isInteger(r.n) && r.n >= 1 && r.n <= MAX_BURST, String(n));
        if (!Number.isInteger(n)) assert.equal(r.n, 1, String(n));
    }
    assert.equal(parseReaction({ e: 'fire', n: 0 }).n, 1);
    assert.equal(parseReaction({ e: 'fire', n: 12 }).n, 12);
});

test('parseReaction maps the emoji older versions sent, and nothing else', () => {
    assert.equal(parseReaction({ e: '❤️' }).id, 'heart');
    assert.equal(parseReaction({ e: '😂' }).id, 'laugh');
    assert.equal(parseReaction({ e: '🔥' }).id, 'fire');
    assert.equal(parseReaction({ e: '👏' }).id, 'cheer');
    assert.equal(parseReaction({ e: '🙏' }).id, 'lotus');
    assert.equal(parseReaction({ e: '😮' }).id, 'wow');
    assert.equal(parseReaction({ e: '🎉' }), null);
    assert.equal(parseReaction({ e: '❤' }), null); // without the variation selector
});

test('parseReaction rejects hostile input', () => {
    const bad = [null, undefined, 0, 1, 'heart', true, [], ['heart'], {}, { e: null }, { e: 42 }, { e: ['heart'] }, { e: { id: 'heart' } }, { e: '' },
        { e: '__proto__' }, { e: 'constructor' }, { e: 'toString' }, { e: 'hasOwnProperty' }, { e: 'valueOf' }, { e: 'HEART' }, { e: ' heart' }, { e: 'heart ' },
        { e: 'x'.repeat(5000) }, { e: '<img src=x onerror=alert(1)>' }, { e: '❤️'.repeat(20) }, { e: 'heart\u0000' }];
    for (const m of bad) assert.equal(parseReaction(m), null, JSON.stringify(m));
    // an extra field on a good message changes nothing
    assert.deepEqual(parseReaction({ e: 'heart', n: 3, x: '<b>', id: 'star', __proto__: { e: 'star' } }), { id: 'heart', n: 3 });
});

test('takeBudget is a sliding window', () => {
    const times = [];
    assert.equal(takeBudget(times, 1000, 10, 24), 10);
    assert.equal(takeBudget(times, 1500, 10, 24), 10);
    assert.equal(takeBudget(times, 2000, 10, 24), 4);   // only 4 left in the window
    assert.equal(takeBudget(times, 2500, 1, 24), 0);    // full
    assert.equal(times.length, 24);
    assert.equal(takeBudget(times, 5100, 10, 24), 10);  // the first ten (t=1000) have aged out
    assert.equal(takeBudget(times, 5600, 10, 24), 10);  // and the next ten (t=1500)
    assert.equal(takeBudget(times, 5600, 10, 24), 0);    // 4 (t=2000) + 20 are still inside the window
    assert.equal(takeBudget(times, 6100, 10, 24), 4);    // the four at t=2000 aged out
    assert.equal(takeBudget([], 0, 0, 24), 0);
    assert.equal(takeBudget([], 0, -4, 24), 0);
    assert.equal(takeBudget([], 0, 5, 0), 0);
});

test('the limits are consistent: one hold fits in the send budget, a burst fits in one message', () => {
    assert.ok(HOLD_MAX <= MAX_BURST);
    assert.ok(HOLD_MAX * 2 <= SEND_CAP);
    assert.ok(RECEIVE_CAP >= SEND_CAP);
    assert.ok(HOLD_MAX >= 5 && HOLD_MAX <= 10);
});

/** A canvas 2D context that records every call and fails on anything that is not a finite number. */
function recorder() {
    const calls = [];
    const target = {};
    const gradient = { addColorStop(p, col) { calls.push(['stop', p, col]); assert.ok(p >= 0 && p <= 1, `colour stop ${p}`); assert.equal(typeof col, 'string'); } };
    return {
        calls,
        ctx: new Proxy(target, {
            get(t, k) {
                if (k in t) return t[k];
                if (k === 'createLinearGradient' || k === 'createRadialGradient') {
                    return (...a) => { a.forEach(v => assert.ok(Number.isFinite(v), `${String(k)} arg ${v}`)); return gradient; };
                }
                return (...a) => {
                    for (const v of a) {
                        if (typeof v === 'number') assert.ok(Number.isFinite(v), `${String(k)}(${a.join(', ')})`);
                        if (typeof v === 'object' && v !== null) throw new Error(`${String(k)} got an object`);
                    }
                    calls.push([String(k), ...a]);
                };
            },
            set(t, k, v) { t[k] = v; calls.push(['set', String(k)]); return true; },
        }),
    };
}

test('every sprite draws without bad numbers, balanced save/restore and no text glyphs', () => {
    for (const { id } of REACTIONS) {
        const { ctx, calls } = recorder();
        assert.equal(drawSprite(ctx, id), true, id);
        const saves = calls.filter(c => c[0] === 'save').length;
        const restores = calls.filter(c => c[0] === 'restore').length;
        assert.equal(saves, restores, `${id} save/restore`);
        assert.ok(calls.filter(c => c[0] === 'fill' || c[0] === 'stroke').length >= 5, `${id} draws something`);
        assert.equal(calls.filter(c => c[0] === 'fillText' || c[0] === 'strokeText' || c[0] === 'drawImage').length, 0, `${id} uses no text or images`);
    }
    assert.equal(drawSprite(recorder().ctx, 'nope'), false);
    assert.equal(drawSprite(recorder().ctx, '__proto__'), false);
});

test('the artwork is original: no emoji or other pictographs anywhere in the source', () => {
    const src = fs.readFileSync('/home/user/ohmygoal/js/reactions.js', 'utf8');
    // the six legacy emoji are the only pictographs allowed: they are the wire values older clients send
    const rest = src.replace(/const LEGACY = new Map\(\[.*?\]\);/s, '');
    assert.equal(/\p{Extended_Pictographic}/u.test(rest), false);
    assert.equal(/fillText|strokeText|drawImage\(\s*img|new Image|fetch\(|https?:\/\//.test(src.replace(/o\.drawImage\(art, 0, 0\)/, '')), false);
});
