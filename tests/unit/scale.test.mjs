// Busy-site safeguards: the random place in the matching queue, the sharded daily counters and the function ceilings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { queueKey } from '../../js/transport.js';
import { addCounters, HOT, SHARDS } from '../../functions/stats.js';
import { MAX_INSTANCES, BUSY } from '../../functions/common.js';

const root = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');

test('queueKey: "<mode>:0.dddddd", always in range, in the format the rules accept', () => {
    const rule = mode => new RegExp('^' + mode + ':0[.][0-9]{6}$');       // firestore.rules validQueue
    for (const mode of ['video', 'voice', 'text']) for (const r of [0, 0.5, 0.123456789, 0.9999999, 1, -1, NaN, '0.3', undefined]) {
        const k = queueKey(mode, r);
        assert.match(k, rule(mode), `${mode} ${r}`);
    }
    assert.equal(queueKey('video', 0.25), 'video:0.250000');
    // keys sort by their number within a mode, and every mode's keys sort between "<mode>:" and "<mode>;" (the range readQueue reads)
    const ks = [0.9, 0.1, 0.5].map(r => queueKey('voice', r)).sort();
    assert.deepEqual(ks, ['voice:0.100000', 'voice:0.500000', 'voice:0.900000']);
    for (const k of ks) assert.ok(k >= 'voice:' && k < 'voice;');
    assert.ok(queueKey('video', 0.999999) < 'video;' && queueKey('voice', 0) > 'video;');
});

test('the queue rule allows the random place and checks its format', () => {
    const rules = read('firestore.rules');
    assert.match(rules, /'roomId', 'rk'\]\)/);
    assert.match(rules, /d\.rk\.matches\('\^' \+ d\.mode \+ ':0\[\.\]\[0-9\]\{6\}\$'\)/);
});

test('matching reads a small random window of the queue, not the same first entries for everyone', () => {
    const src = read('js/transport.js');
    assert.match(src, /orderBy\('rk'\), limit\(QUEUE_WINDOW\)/);
    assert.doesNotMatch(src, /limit\(50\)/);
});

test('addCounters adds numbers and keeps the first non-number', () => {
    assert.deepEqual(addCounters({ a: 1, b: 2 }, { a: 3 }, undefined, null, { c: 4, a: 1 }), { a: 5, b: 2, c: 4 });
    assert.deepEqual(addCounters(), {});
    assert.deepEqual(addCounters({ note: 'x', n: 1 }, { note: 'y', n: Infinity }, { n: 2 }), { note: 'x', n: 3 });
});

test('the counters bumped for every chat, join and visitor are sharded; the rest stay on the day document', () => {
    for (const f of ['chats', 'chats_video', 'chats_text', 'friendCalls', 'dau', 'groupJoins', 'groupJoins_voice']) assert.ok(HOT.test(f), f);
    for (const f of ['liveStarts', 'coinGifts', 'hostShareCoins', 'likes', 'gifts', 'coinsSpent']) assert.ok(!HOT.test(f), f);
    assert.ok(Number.isInteger(SHARDS) && SHARDS >= 10);
});

test('function ceilings: room for a crowd, more for the functions every visitor calls', () => {
    assert.ok(MAX_INSTANCES >= 50);
    assert.ok(BUSY.maxInstances > MAX_INSTANCES);
    for (const [file, name] of [['groups', 'joinGroup'], ['moderation', 'checkAccess'], ['translate', 'translateText'], ['turn', 'turnCredentials'], ['wallet', 'getWallet']]) {
        assert.match(read(`functions/${file}.js`), new RegExp(`export const ${name} = onCall\\(callOpts\\((\\{ \\.\\.\\.)?BUSY`), name);
    }
    assert.match(read('functions/index.js'), /countOnline/);
});
