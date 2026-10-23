// Group rooms: topics and sizes (client and server must agree), message parsing, member freshness, and the server's helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_TOPICS, GROUP_MODES, STALE_MS, MAX_GROUP_MSG, groupTopicId, groupModeOk, groupCap, parseGroupMessage, isInitiator, freshMembers, createMesh } from '/home/user/ohmygoal/js/groups.js';
import { TOPICS, CAPS, STALE_MS as SERVER_STALE, cleanNick, cleanAvatar, pickGroup } from '/home/user/ohmygoal/functions/groups.js';

test('topics and sizes are the same on the client and the server', () => {
    assert.deepEqual(GROUP_TOPICS.map(t => t.id), [...TOPICS]);
    assert.deepEqual({ voice: GROUP_MODES.voice.cap, video: GROUP_MODES.video.cap }, { ...CAPS });
    assert.equal(STALE_MS, SERVER_STALE);
    assert.equal(CAPS.voice, 8); assert.equal(CAPS.video, 4);
    assert.ok(Object.isFrozen(GROUP_TOPICS) && Object.isFrozen(GROUP_TOPICS[0]));
});

test('the database rules and the server agree on the shape of a handshake', async () => {
    const fs = await import('node:fs');
    const rules = fs.readFileSync('/home/user/ohmygoal/firestore.rules', 'utf8');
    assert.match(rules, /match \/groups\/\{gid\}/);
    assert.match(rules, /allow write: if false;/);
    assert.match(rules, /type in \['offer', 'answer', 'candidate', 'bye'\]/);
});

test('topic and mode checks reject everything unknown', () => {
    for (const t of GROUP_TOPICS) assert.equal(groupTopicId(t.id), t.id);
    for (const bad of ['', 'nope', '__proto__', 'constructor', 'CRICKET', null, undefined, 5, {}, ['cricket']]) assert.equal(groupTopicId(bad), '', String(bad));
    assert.equal(groupModeOk('voice'), true); assert.equal(groupModeOk('video'), true);
    for (const bad of ['text', '__proto__', 'toString', null, 5]) assert.equal(groupModeOk(bad), false, String(bad));
    assert.equal(groupCap('voice'), 8); assert.equal(groupCap('video'), 4); assert.equal(groupCap('x'), 0);
});

test('chat messages from peers: plain text only, bounded, nothing else gets through', () => {
    assert.deepEqual(parseGroupMessage(JSON.stringify({ t: 'gmsg', text: 'hello' })), { text: 'hello' });
    assert.deepEqual(parseGroupMessage({ t: 'gmsg', text: '  hi  ' }), { text: 'hi' });
    assert.equal(parseGroupMessage({ t: 'gmsg', text: 'x'.repeat(5000) }).text.length, MAX_GROUP_MSG);
    assert.equal(parseGroupMessage({ t: 'gmsg', text: 'a‮b​c\u0007d' }).text, 'abcd');
    for (const bad of [null, undefined, 5, '', 'x', '{', '[]', JSON.stringify('x'), { t: 'msg', text: 'x' }, { t: 'gmsg' }, { t: 'gmsg', text: 5 }, { t: 'gmsg', text: '   ' }, { t: 'gmsg', text: ['x'] },
        JSON.stringify({ t: 'gmsg', text: 'x'.repeat(3000) }), { t: 'gmsg', text: '​​' }]) assert.equal(parseGroupMessage(bad), null, String(bad).slice(0, 30));
});

test('the lower id makes the offer, so two people never both do', () => {
    assert.equal(isInitiator('a', 'b'), true);
    assert.equal(isInitiator('b', 'a'), false);
    assert.equal(isInitiator('a', 'a'), false);
});

test('freshMembers drops ourselves, the stale and the malformed', () => {
    const now = 1_000_000;
    const list = [{ id: 'me', ts: now }, { id: 'a', ts: now - 1000 }, { id: 'b', ts: now - STALE_MS - 1 }, { id: 'c' }, null, { ts: now }, { id: 5, ts: now }, { id: 'a', ts: now - 500 }];
    assert.deepEqual(freshMembers(list, now, 'me').map(m => m.id).sort(), ['a', 'c']);
    assert.deepEqual(freshMembers(undefined, now, 'me'), []);
    assert.equal(freshMembers(list, now, 'me').find(m => m.id === 'a').ts, now - 500, 'the newest entry for a person wins');
});

test('the server cleans names and avatars before storing them', () => {
    assert.equal(cleanNick('  Priya  '), 'Priya');
    assert.equal(cleanNick('a‮b​c\n\td'), 'abcd');
    assert.equal(cleanNick('x'.repeat(100)).length, 20);
    for (const bad of ['', '   ', null, undefined, 5, {}, '​']) assert.equal(cleanNick(bad), 'Guest');
    assert.deepEqual(cleanAvatar({ e: '🦊', h: 200.4 }), { e: '🦊', h: 200 });
    assert.deepEqual(cleanAvatar({ e: '🦊', h: 9999 }), { e: '🦊', h: 360 });
    for (const bad of [null, undefined, 5, 'x', [], {}, { e: '🦊' }, { h: 5 }, { e: '<b>', h: 1 }, { e: 'x'.repeat(20), h: 1 }, { e: '🦊', h: NaN }]) assert.equal(cleanAvatar(bad), null, JSON.stringify(bad));
});

test('pickGroup: the fullest room with space, never one that is full or already holds us', () => {
    const rooms = [
        { id: 'empty', count: 0, members: [], created: 1 },
        { id: 'half', count: 4, members: ['x'], created: 2 },
        { id: 'almost', count: 7, members: ['y'], created: 3 },
        { id: 'full', count: 8, members: [], created: 4 },
        { id: 'mine', count: 6, members: ['me'], created: 5 },
    ];
    assert.deepEqual(pickGroup(rooms, 'me', 8).map(r => r.id), ['almost', 'half', 'empty']);
    assert.deepEqual(pickGroup([], 'me', 8), []);
    assert.deepEqual(pickGroup([{ id: 'v', count: 4, members: [], created: 1 }], 'me', 4), [], 'a video room of four is full');
    assert.deepEqual(pickGroup([{ id: 'a', count: 3, members: [], created: 9 }, { id: 'b', count: 3, members: [], created: 2 }], 'me', 8).map(r => r.id), ['b', 'a'], 'the older one first on a tie');
});

globalThis.MediaStream ??= class { constructor() { this.t = []; } getTracks() { return this.t; } addTrack(x) { this.t.push(x); } };

test('a mesh ignores handshakes from people it has not met, and never throws on junk', async () => {
    const sent = [];
    let onSig;
    const backend = { watchSignals: (g, fn) => { onSig = fn; return () => {}; }, signal: async (...a) => { sent.push(a); } };
    const fakePc = () => ({ addTrack() {}, getSenders: () => [], close() {}, createDataChannel: () => ({ close() {} }), createOffer: async () => ({ type: 'offer', sdp: 'x' }), setLocalDescription: async () => {}, signalingState: 'stable' });
    const mesh = createMesh({ backend, gid: 'g', selfId: 'b', mode: 'voice', stream: null, iceConfig: () => ({}), makePc: fakePc });
    for (const junk of [{ from: 5 }, { from: 'zz', type: 'offer' }, null, undefined].filter(Boolean)) await onSig(junk);
    mesh.setMembers([{ id: 'b', ts: Date.now() }, { id: 'c', ts: Date.now() }]);
    assert.equal(mesh.peers.size, 1);
    mesh.setMembers([]);
    assert.equal(mesh.peers.size, 0);
    mesh.close();
});
