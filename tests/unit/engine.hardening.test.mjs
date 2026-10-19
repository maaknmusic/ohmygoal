// Adversarial review of js/games/engine.js: each test below demonstrates a bug that the first version had.
// Run: node --test /tmp/claude-0/-home-user-ohmygoal/80ecaa61-e063-55be-81f7-87bba82dfd45/scratchpad/unit/engine.hardening.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = 'file:///home/user/ohmygoal/js/games/';
const { createGameSession, sha256Hex, commitPayload, INVITE_TTL_MS, GRACE_MS } = await import(ROOT + 'engine.js');

// =====================================================================
// helpers (self-contained copies of the ones in games.test.mjs)
// =====================================================================
const other = p => (p === 'A' ? 'B' : 'A');

function makeClock(start = 1_000_000) {
    let t = start;
    let id = 0;
    const timers = new Map();
    return {
        now: () => t,
        setTimeout(fn, ms) { const h = ++id; timers.set(h, { at: t + Math.max(0, ms), fn, h }); return h; },
        clearTimeout(h) { timers.delete(h); },
        advance(ms) {
            const end = t + ms;
            for (;;) {
                let next = null;
                for (const x of timers.values()) if (x.at <= end && (!next || x.at < next.at || (x.at === next.at && x.h < next.h))) next = x;
                if (!next) break;
                timers.delete(next.h);
                t = Math.max(t, next.at);
                next.fn();
            }
            t = end;
        },
        pending: () => timers.size,
    };
}

/** Two engines wired back to back with a fixed one-way latency (ordered), driven by the fake clock. */
function makePair({ latency = 0 } = {}) {
    const clock = makeClock();
    const p = { clock, latency, log: [], sessions: {} };
    const make = (me, peer) => createGameSession({
        me, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
        send: msg => {
            const copy = structuredClone(msg);
            p.log.push({ from: me, msg: copy });
            clock.setTimeout(() => p.sessions[peer].receive(copy), latency);
        },
    });
    p.A = p.sessions.A = make('A', 'B');
    p.B = p.sessions.B = make('B', 'A');
    p.v = r => p[r].state();
    p.sent = (from, op) => p.log.filter(e => e.from === from && e.msg.op === op).map(e => e.msg);
    p.tick = ms => clock.advance(ms);
    return p;
}

function start(gameId, p = makePair()) {
    assert.equal(p.A.invite(gameId), true);
    p.tick(p.latency);
    assert.equal(p.B.accept(), true);
    p.tick(p.latency);
    assert.equal(p.v('A').phase, 'playing');
    assert.equal(p.v('B').phase, 'playing');
    return p;
}

/** One engine against a hand-driven peer: everything A sends is collected in `out`. */
function lone(gameId) {
    const out = [];
    const clock = makeClock();
    const A = createGameSession({ me: 'A', now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, send: m => out.push(structuredClone(m)) });
    A.invite(gameId);
    const gid = A.state().gid;
    A.receive({ t: 'game', op: 'accept', gid });
    return { A, out, gid, clock };
}

// =====================================================================
// 1. Commit-copy ("mirror") attack
// =====================================================================
test('commit-reveal: a peer that copies our commit is caught before we reveal anything', () => {
    const { A, out, gid } = lone('rps');
    assert.equal(A.move('stone'), true);
    const commit = out.find(m => m.op === 'commit');
    // The hostile peer echoes our own hash as its commit; it would then echo our reveal and always tie.
    A.receive({ t: 'game', op: 'commit', gid, round: 0, hash: commit.hash });
    assert.equal(out.some(m => m.op === 'reveal'), false, 'our move and nonce must not be revealed to a mirror');
    const v = A.state();
    assert.equal(v.phase, 'over');
    assert.equal(v.status.winner, 'A');
    assert.equal(v.lastEvent, 'They cheated, you win!');
});

test('commit-reveal: mirroring cannot force a wicket every ball in hand cricket', () => {
    const { A, out, gid } = lone('handcricket');
    const reveal = (round, move) => {
        const nonce = 'ab'.repeat(16);
        A.receive({ t: 'game', op: 'commit', gid, round, hash: sha256Hex(commitPayload(gid, round, move, nonce)) });
        return nonce;
    };
    // toss: A is the caller; the peer plays honestly and A wins it (3 + 4 is odd)
    assert.equal(A.move({ n: 3, call: 'odd' }), true);
    const nonce = reveal(0, { n: 4 });
    A.receive({ t: 'game', op: 'reveal', gid, round: 0, move: { n: 4 }, nonce });
    assert.equal(A.state().state.batter, 'A');
    // first ball: A bats; the peer mirrors A's commit instead of committing to its own number
    assert.equal(A.move(5), true);
    const commit = out.filter(m => m.op === 'commit').at(-1);
    assert.equal(commit.round, 1);
    A.receive({ t: 'game', op: 'commit', gid, round: 1, hash: commit.hash });
    assert.equal(A.state().phase, 'over');
    assert.equal(A.state().lastEvent, 'They cheated, you win!');
    assert.equal(out.filter(m => m.op === 'reveal' && m.round === 1).length, 0, 'no reveal for the mirrored round');
});

test('commit-reveal: an honest commit that happens to follow ours is still accepted', () => {
    const { A, out, gid } = lone('rps');
    A.move('stone');
    const mine = out.find(m => m.op === 'commit').hash;
    const nonce = 'cd'.repeat(16);
    const hash = sha256Hex(commitPayload(gid, 0, 'paper', nonce));
    assert.notEqual(hash, mine);
    A.receive({ t: 'game', op: 'commit', gid, round: 0, hash });
    assert.equal(A.state().phase, 'playing');
    assert.equal(out.filter(m => m.op === 'reveal').length, 1, 'both commits are in, so we reveal');
    A.receive({ t: 'game', op: 'reveal', gid, round: 0, move: 'paper', nonce });
    assert.equal(A.state().state.wins.B, 1);
});

// =====================================================================
// 2. Synchronous transports: state must be settled before the peer can answer
// =====================================================================
/** Messages are delivered inside send() and the UI reacts inside onChange, as a loopback test transport would. */
function syncPair(autoplay) {
    const clock = makeClock();
    const s = { clock };
    const make = (me, peer) => createGameSession({
        me, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
        send: msg => s[peer].receive(structuredClone(msg)),
        onChange: v => autoplay?.(me, v, s[me]),
    });
    s.A = make('A', 'B');
    s.B = make('B', 'A');
    return s;
}

test('sync transport: the first move made inside onChange right after accept is not lost', () => {
    const s = syncPair((me, v, sess) => { if (v.phase === 'playing' && v.canMove) sess.move(v.state.board.indexOf(null)); });
    assert.equal(s.A.invite('tictactoe'), true);
    assert.equal(s.B.accept(), true);
    // both UIs keep playing from inside onChange, so the whole game runs inside accept()
    assert.deepEqual(s.A.state().state, s.B.state().state, 'identical on both sides');
    assert.ok(s.B.state().state.moves >= 5, 'A moved first and every move arrived');
    assert.equal(s.A.state().phase, 'over');
    assert.equal(s.B.state().status.winner, s.A.state().status.winner);
    assert.equal(s.clock.pending(), 0);
    s.A.dispose(); s.B.dispose();
});

test('sync transport: a commit made inside onChange right after accept is not lost', () => {
    const s = syncPair((me, v, sess) => { if (v.phase === 'playing' && v.canMove) sess.move(me === 'A' ? 'stone' : 'scissors'); });
    s.A.invite('rps');
    s.B.accept();
    // the first commit came from inside onChange right after accept; the match then plays itself out
    assert.deepEqual(s.A.state().state.wins, { A: 2, B: 0 });
    assert.deepEqual(s.A.state().state, s.B.state().state);
    assert.equal(s.B.state().phase, 'over');
    assert.equal(s.B.state().status.winner, 'A');
    s.A.dispose(); s.B.dispose();
});

test('sync transport: a rematch offered from inside onChange right after a forfeit reaches the forfeiter', () => {
    const s = syncPair((me, v, sess) => { if (me === 'A' && v.phase === 'over') sess.rematch(); });
    s.A.invite('tictactoe');
    s.B.accept();
    assert.equal(s.B.forfeit(), true);
    assert.equal(s.B.state().phase, 'over');
    assert.equal(s.B.state().rematch, 'them', 'the forfeiter sees the offer');
    assert.equal(s.A.state().rematch, 'you');
    assert.equal(s.B.rematch(), true);
    assert.equal(s.A.state().phase, 'playing');
    assert.equal(s.B.state().phase, 'playing');
    assert.equal(s.A.state().gid, s.B.state().gid);
    s.A.dispose(); s.B.dispose();
});

test('sync transport: declining an invite and being re-invited at once leaves the new invite alive', () => {
    let again = true;
    const s = syncPair((me, v, sess) => { if (me === 'A' && v.phase === 'idle' && again) { again = false; sess.invite('rps'); } });
    s.A.invite('tictactoe');
    assert.equal(s.B.decline(), true);
    assert.equal(s.A.state().phase, 'inviting', 'A re-invited from inside onChange');
    assert.equal(s.B.state().phase, 'invited', 'B must not drop the fresh invite');
    assert.equal(s.B.state().game.id, 'rps');
    s.A.dispose(); s.B.dispose();
});

test('sync transport: both sides react to the rematch start at once', () => {
    const s = syncPair((me, v, sess) => { if (v.phase === 'playing' && v.canMove && v.state.moves === 0) sess.move(v.state.board.indexOf(null)); });
    s.A.invite('tictactoe');
    s.B.accept();
    s.A.forfeit();
    s.B.rematch(); // B starts the next game, so it reacts inside the call that delivers A's acceptance
    s.A.rematch();
    assert.equal(s.A.state().phase, 'playing');
    assert.equal(s.B.state().phase, 'playing');
    assert.deepEqual(s.A.state().state, s.B.state().state);
    assert.equal(s.A.state().state.moves, 1, 'the new first player moved and the other side saw it');
    s.A.dispose(); s.B.dispose();
});

// =====================================================================
// 3. Invite expiry crossing an accept
// =====================================================================
test('lobby: an invitee that already committed is still pulled out of a cancelled invite', () => {
    const p = makePair({ latency: 100 });
    p.A.invite('rps');
    p.tick(100);
    p.tick(INVITE_TTL_MS - 150); // B answers in the last moment of A's window
    assert.equal(p.B.accept(), true);
    assert.equal(p.B.move('stone'), true, 'B commits at once; accept and commit are in flight');
    p.tick(100); // A's invite has expired by the time the accept arrives, so A cancelled and went idle
    assert.equal(p.v('A').phase, 'idle');
    p.tick(300);
    assert.equal(p.v('B').phase, 'idle', 'no ghost game where B waits for a peer that never started');
    assert.equal(p.v('B').lastEvent, 'Invite cancelled');
    assert.equal(p.clock.pending(), 0);
});

// =====================================================================
// 4. Rematch accepted just as the offer expires
// =====================================================================
test('rematch: an acceptance that lands just after our offer expired still starts the game on both sides', () => {
    const p = makePair({ latency: 500 });
    start('tictactoe', p);
    p.A.forfeit();
    p.tick(500);
    assert.equal(p.v('B').phase, 'over');
    p.A.rematch(); // t0: expires on A at t0 + 30 s, reaches B at t0 + 0.5 s
    p.tick(500);
    assert.equal(p.v('B').rematch, 'them');
    p.tick(INVITE_TTL_MS - 500 + 400); // B clicks at t0 + 30.4 s: inside its own window (ends t0 + 30.5 s)
    assert.equal(p.v('A').rematch, null, 'A already let the offer lapse');
    assert.equal(p.v('B').rematch, 'them');
    assert.equal(p.B.rematch(), true);
    p.tick(500);
    assert.equal(p.v('B').phase, 'playing');
    assert.equal(p.v('A').phase, 'playing', 'A must not be left asking for a rematch while B plays alone');
    assert.equal(p.v('A').gid, p.v('B').gid);
    // B moves first in the rematch (first player alternates); that move must land
    assert.equal(p.v('B').canMove, true);
    assert.equal(p.B.move(4), true);
    p.tick(500);
    assert.equal(p.v('A').state.board[4], 'B');
});

test('rematch: a late acceptance of an offer that expired long ago starts nothing', () => {
    const p = makePair({ latency: 0 });
    start('tictactoe', p);
    p.A.forfeit();
    p.tick(0);
    p.A.rematch();
    p.tick(INVITE_TTL_MS + GRACE_MS + 1);
    assert.equal(p.v('A').rematch, null);
    const offer = p.sent('A', 'rematch')[0].newGid;
    p.A.receive({ t: 'game', op: 'rematch', gid: p.v('A').gid, newGid: offer });
    assert.equal(p.v('A').phase, 'over');
    assert.equal(p.v('A').rematch, 'them', 'treated as a fresh offer for A to answer');
});

test('rematch: an offer that reuses the id of the finished game is ignored', () => {
    const p = makePair();
    start('tictactoe', p);
    p.A.forfeit();
    p.tick(0);
    const gid = p.v('B').gid;
    p.B.receive({ t: 'game', op: 'rematch', gid, newGid: gid });
    assert.equal(p.v('B').rematch, null);
    assert.equal(p.v('B').phase, 'over');
});

// =====================================================================
// 5. Randomness: never fall back to Math.random for nonces
// =====================================================================
test('no secure randomness: the session refuses to invite or commit instead of using Math.random', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const { A, out } = lone('rps'); // a game in progress, created while crypto still works
    try {
        Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
        assert.equal(A.move('stone'), false, 'a commit nonce from Math.random could be predicted');
        assert.equal(A.state().round.iCommitted, false, 'nothing half-done');
        assert.equal(out.some(m => m.op === 'commit'), false);
        A.forfeit();
        const fresh = createGameSession({ send: () => {} });
        assert.equal(fresh.invite('rps'), false);
        assert.equal(fresh.state().phase, 'idle', 'a failed invite leaves the session idle');
        assert.equal(fresh.state().gid, null);
    } finally {
        Object.defineProperty(globalThis, 'crypto', saved);
    }
    const ok = createGameSession({ send: () => {} });
    assert.equal(ok.invite('rps'), true, 'works again once crypto is back');
    ok.dispose();
});
