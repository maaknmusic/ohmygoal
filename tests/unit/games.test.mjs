// Run: node --test /tmp/claude-0/-home-user-ohmygoal/80ecaa61-e063-55be-81f7-87bba82dfd45/scratchpad/unit/games.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const ROOT = 'file:///home/user/ohmygoal/js/games/';
const { createGameSession, sha256Hex, commitPayload, INVITE_TTL_MS, IDLE_MS, GRACE_MS, TOLERANCE_MS, MAX_MESSAGE_BYTES } = await import(ROOT + 'engine.js');
const { GAMES, byId } = await import(ROOT + 'index.js');
const wordchain = await import(ROOT + 'wordchain.js');
const { checkWord, lastLetter } = wordchain;
const ttt = byId.tictactoe;
const rps = byId.rps;
const c4 = byId.connect4;
const hc = byId.handcricket;
const wc = byId.wordchain;

// =====================================================================
// helpers
// =====================================================================
function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        Object.values(o).forEach(deepFreeze);
    }
    return o;
}

const other = p => (p === 'A' ? 'B' : 'A');

/** Play moves on a turn-based game definition (no engine), the player on turn moves each time. */
function playDef(def, moves, first = 'A') {
    let st = def.init({ first, opts: {} });
    for (const m of moves) {
        const p = def.status(st).turn;
        assert.ok(def.validMove(st, p, m), `move ${JSON.stringify(m)} should be valid for ${p}`);
        st = def.apply(deepFreeze(st), p, m);
    }
    return st;
}

/** Fake clock: timers only fire when advance() is called. */
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

/** Two engines wired back to back; messages travel asynchronously (setImmediate). */
function makePair() {
    const clock = makeClock();
    const p = { clock, log: [], views: { A: [], B: [] }, filter: null, inflight: 0 };
    const make = (me, peer) => createGameSession({
        me, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
        onChange: v => p.views[me].push(v),
        send: msg => {
            const copy = structuredClone(msg);
            p.log.push({ from: me, msg: copy });
            const out = p.filter ? p.filter(me, copy) : copy;
            if (!out) return;
            p.inflight++;
            setImmediate(() => { try { p[peer].receive(out); } finally { p.inflight--; } });
        },
    });
    p.A = make('A', 'B');
    p.B = make('B', 'A');
    p.settle = async () => { do { await new Promise(r => setImmediate(r)); } while (p.inflight > 0); };
    p.tick = async ms => { clock.advance(ms); await p.settle(); };
    p.v = r => p[r].state();
    p.sent = (from, op) => p.log.filter(e => e.from === from && e.msg.op === op).map(e => e.msg);
    return p;
}

async function start(gameId, p = makePair()) {
    assert.equal(p.A.invite(gameId), true);
    await p.settle();
    assert.equal(p.B.accept(), true);
    await p.settle();
    assert.equal(p.v('A').phase, 'playing');
    assert.equal(p.v('B').phase, 'playing');
    return p;
}

function assertSynced(p) {
    assert.deepEqual(p.v('A').state, p.v('B').state, 'both peers must hold identical state');
}

/** Turn-based: whoever is on turn plays each move. */
async function turns(p, moves) {
    for (const m of moves) {
        const who = p.v('A').status.turn;
        assert.ok(['A', 'B'].includes(who), 'someone must be on turn');
        assert.equal(p[who].move(m), true, `${who} should be able to play ${JSON.stringify(m)}`);
        await p.settle();
        assertSynced(p);
    }
}

/** Simultaneous: both pick, then commit/reveal runs to completion. */
async function round(p, a, b) {
    assert.equal(p.A.move(a), true, `A picks ${JSON.stringify(a)}`);
    assert.equal(p.B.move(b), true, `B picks ${JSON.stringify(b)}`);
    await p.settle();
    assertSynced(p);
}

function assertResult(p, winner) {
    for (const r of ['A', 'B']) {
        const v = p.v(r);
        assert.equal(v.phase, 'over');
        assert.equal(v.status.over, true);
        assert.equal(v.status.winner, winner);
        assert.equal(v.canMove, false);
        assert.equal(v.lastEvent, winner === 'draw' ? 'Draw' : winner === r ? 'You won!' : 'You lost');
    }
}

const RAW = (p, op, extra = {}) => ({ t: 'game', op, gid: p.v('A').gid, ...extra });

// =====================================================================
// SHA-256 and registry
// =====================================================================
test('sha256Hex matches node:crypto, including multi-block and unicode input', () => {
    const samples = ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(1000), 'हिन्दी 🎮 café'];
    for (const s of samples) assert.equal(sha256Hex(s), createHash('sha256').update(s).digest('hex'));
    const payload = commitPayload('0123456789ab', 3, { n: 4, call: 'odd' }, 'ff'.repeat(16));
    assert.equal(payload, JSON.stringify(['0123456789ab', 3, { n: 4, call: 'odd' }, 'ff'.repeat(16)]));
    assert.equal(sha256Hex(payload), createHash('sha256').update(payload).digest('hex'));
});

test('registry: ordered GAMES and prototype-free byId', () => {
    assert.deepEqual(GAMES.map(g => g.id), ['tictactoe', 'rps', 'connect4', 'handcricket', 'wordchain']);
    for (const g of GAMES) assert.equal(byId[g.id], g);
    assert.equal(byId.constructor, undefined);
    assert.equal(byId.__proto__, undefined);
    assert.equal(byId.nope, undefined);
});

test('every game follows the definition interface', () => {
    const ids = new Set();
    for (const g of GAMES) {
        assert.ok(!ids.has(g.id));
        ids.add(g.id);
        for (const k of ['id', 'name', 'emoji', 'blurb']) assert.equal(typeof g[k], 'string', `${g.id}.${k}`);
        assert.ok(g.blurb.length > 0 && g.blurb.length <= 60, `${g.id} blurb is one short line`);
        assert.equal(g.players, 2);
        assert.equal(typeof g.simultaneous, 'boolean');
        for (const f of ['init', 'validMove', 'status']) assert.equal(typeof g[f], 'function', `${g.id}.${f}`);
        assert.equal(typeof (g.simultaneous ? g.applyRound : g.apply), 'function');
        for (const first of ['A', 'B']) {
            const st = g.init({ first, opts: {} });
            assert.deepEqual(JSON.parse(JSON.stringify(st)), st, `${g.id} state is JSON-serialisable`);
            const s = g.status(st);
            assert.equal(s.over, false);
            assert.equal(s.winner, null);
            assert.equal(typeof s.summary, 'string');
            assert.ok(g.simultaneous ? s.turn === 'both' : s.turn === first);
        }
        assert.ok(g.init({}) && g.init(), 'init tolerates missing arguments');
    }
    assert.deepEqual(GAMES.filter(g => g.timeLimitMs).map(g => g.id), ['wordchain']);
});

const GARBAGE = [undefined, null, NaN, Infinity, -Infinity, -1, 0.5, 7, 99, 1e9, '', '0', '1', 'x', 'stone ', true, false, [], [1], {}, { n: 1 }, { word: 5 }, { word: [] }, { timeout: 1 }, { __proto__: { n: 1 } }, () => 1];

test('validMove never throws on garbage and returns booleans', () => {
    for (const g of GAMES) {
        const st = deepFreeze(g.init({ first: 'A' }));
        for (const player of ['A', 'B', 'C', '', null, undefined, 1]) {
            for (const m of GARBAGE) {
                let r;
                assert.doesNotThrow(() => { r = g.validMove(st, player, m); }, `${g.id} ${String(player)} ${String(m)}`);
                assert.equal(typeof r, 'boolean');
            }
        }
        // obviously wrong input is never valid
        for (const m of [undefined, null, NaN, '', {}, [], () => 1, { n: 1, extra: 1 }]) assert.equal(g.validMove(st, 'A', m), false);
    }
});

// =====================================================================
// Tic-tac-toe
// =====================================================================
test('tictactoe: all 8 lines win, state never mutated', () => {
    const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    for (const line of lines) {
        const rest = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(c => !line.includes(c));
        const st = playDef(ttt, [line[0], rest[0], line[1], rest[1], line[2]]);
        assert.equal(st.winner, 'A');
        assert.deepEqual([...st.line].sort(), line);
        const s = ttt.status(st);
        assert.deepEqual([s.over, s.winner, s.turn], [true, 'A', null]);
    }
});

test('tictactoe: second player can win, first player is X, rematch alternates marks', () => {
    const st = playDef(ttt, [0, 3, 1, 4, 8, 5]);
    assert.equal(st.winner, 'B');
    assert.deepEqual(st.marks, { A: 'X', B: 'O' });
    const st2 = playDef(ttt, [4, 0], 'B');
    assert.deepEqual(st2.marks, { A: 'O', B: 'X' });
    assert.equal(ttt.init({ first: 'B' }).turn, 'B');
});

test('tictactoe: draw on a full board without a line', () => {
    const st = playDef(ttt, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
    assert.equal(st.winner, 'draw');
    assert.equal(st.line, null);
    assert.equal(ttt.status(st).winner, 'draw');
});

test('tictactoe: rejects out of turn, occupied, out of range and malformed moves; nothing after the end', () => {
    const st = playDef(ttt, [4]);
    assert.equal(ttt.validMove(st, 'A', 0), false, 'out of turn');
    assert.equal(ttt.validMove(st, 'B', 4), false, 'occupied');
    for (const m of [-1, 9, 1.5, '3', null, [3], { cell: 3 }, NaN]) assert.equal(ttt.validMove(st, 'B', m), false);
    assert.equal(ttt.validMove(st, 'B', 0), true);
    const won = playDef(ttt, [0, 3, 1, 4, 2]);
    for (let c = 0; c < 9; c++) for (const p of ['A', 'B']) assert.equal(ttt.validMove(won, p, c), false);
});

// =====================================================================
// Stone Paper Scissors
// =====================================================================
test('rps: every pairing resolves correctly', () => {
    const beats = { stone: 'scissors', paper: 'stone', scissors: 'paper' };
    for (const a of Object.keys(beats)) {
        for (const b of Object.keys(beats)) {
            const st = rps.applyRound(deepFreeze(rps.init({})), { A: a, B: b });
            const want = a === b ? 'draw' : beats[a] === b ? 'A' : 'B';
            assert.equal(st.rounds[0].winner, want);
            assert.equal(st.wins.A, want === 'A' ? 1 : 0);
            assert.equal(st.wins.B, want === 'B' ? 1 : 0);
        }
    }
});

test('rps: first to 2 wins, tied rounds replay, capped at 5 rounds', () => {
    const play = rounds => rounds.reduce((st, [a, b]) => rps.applyRound(st, { A: a, B: b }), rps.init({}));
    assert.equal(play([['stone', 'scissors'], ['paper', 'stone']]).winner, 'A');
    assert.equal(play([['stone', 'paper'], ['scissors', 'stone']]).winner, 'B');
    let st = play([['stone', 'stone'], ['stone', 'scissors']]);
    assert.deepEqual([st.winner, st.wins], [null, { A: 1, B: 0 }], 'a tie does not count; match goes on');
    st = rps.applyRound(st, { A: 'paper', B: 'scissors' });
    assert.deepEqual([st.winner, st.wins], [null, { A: 1, B: 1 }], '1-1: still open');
    st = rps.applyRound(st, { A: 'paper', B: 'scissors' });
    assert.equal(st.winner, 'B', 'B takes the decider');
    assert.equal(play([['stone', 'scissors'], ['stone', 'paper'], ['stone', 'scissors']]).winner, 'A', '2-1');
    const ties = Array(5).fill(['stone', 'stone']);
    assert.equal(play(ties.slice(0, 4)).winner, null);
    assert.equal(play(ties).winner, 'draw');
    assert.equal(play([['stone', 'scissors'], ['stone', 'stone'], ['stone', 'stone'], ['stone', 'stone'], ['stone', 'stone']]).winner, 'A', 'leader wins when capped');
    assert.equal(play([['stone', 'scissors'], ['stone', 'paper'], ['stone', 'stone'], ['stone', 'stone'], ['stone', 'stone']]).winner, 'draw', '1-1 when capped');
    assert.deepEqual(rps.status(play(ties)), { over: true, winner: 'draw', turn: null, summary: 'Match tied 0-0' });
});

test('rps: validMove checks a single pick; applyRound ignores bad picks and finished matches', () => {
    const st = rps.init({});
    for (const p of ['A', 'B']) for (const m of ['stone', 'paper', 'scissors']) assert.equal(rps.validMove(st, p, m), true);
    for (const m of ['Stone', 'rock', ['stone'], 1, { move: 'stone' }, null]) assert.equal(rps.validMove(st, 'A', m), false);
    assert.equal(rps.applyRound(st, { A: 'stone' }), st);
    assert.equal(rps.applyRound(st, { A: 'stone', B: 'dynamite' }), st);
    assert.equal(rps.applyRound(st, null), st);
    const done = rps.applyRound(rps.applyRound(st, { A: 'stone', B: 'scissors' }), { A: 'stone', B: 'scissors' });
    assert.equal(rps.validMove(done, 'A', 'stone'), false);
    assert.equal(rps.applyRound(done, { A: 'paper', B: 'stone' }), done);
});

// =====================================================================
// Connect 4
// =====================================================================
test('connect4: vertical, horizontal and both diagonals win', () => {
    assert.equal(playDef(c4, [0, 1, 0, 1, 0, 1, 0]).winner, 'A', 'vertical');
    assert.equal(playDef(c4, [0, 0, 1, 1, 2, 2, 3]).winner, 'A', 'horizontal');
    // rising diagonal: A on (col0,row0) (col1,row1) (col2,row2) (col3,row3), counted from the bottom
    const up = playDef(c4, [0, 1, 1, 2, 3, 2, 2, 3, 3, 6, 3]);
    assert.equal(up.winner, 'A', 'diagonal /');
    assert.equal(up.line.length, 4);
    const down = playDef(c4, [3, 2, 2, 1, 0, 1, 1, 0, 0, 6, 0]);
    assert.equal(down.winner, 'A', 'diagonal \\');
    const b = playDef(c4, [0, 1, 0, 1, 2, 1, 2, 1]);
    assert.equal(b.winner, 'B', 'second player wins');
    assert.deepEqual(b.line, [1, 8, 15, 22, 29, 36].slice(-4).sort((x, y) => x - y).map(x => x), 'line holds the four winning cells');
});

test('connect4: discs stack, full columns are rejected, marks follow the first player', () => {
    const st = playDef(c4, [3, 3, 3, 3, 3, 3]);
    assert.equal(st.board[3 + 5 * 7], 'A');
    assert.equal(st.board[3], 'B');
    assert.equal(c4.validMove(st, 'A', 3), false, 'column full');
    assert.equal(c4.validMove(st, 'A', 4), true);
    assert.deepEqual(c4.init({ first: 'B' }).marks, { B: 'red', A: 'yellow' });
});

test('connect4: draw on a full board with no four in a row', () => {
    const drawn = [1, 6, 5, 5, 6, 4, 5, 1, 6, 2, 5, 5, 3, 1, 6, 3, 1, 3, 2, 3, 3, 4, 5, 0, 3, 6, 6, 0, 2, 0, 1, 1, 2, 2, 4, 4, 2, 4, 0, 0, 0, 4];
    assert.equal(drawn.length, 42);
    const st = playDef(c4, drawn);
    assert.equal(st.winner, 'draw');
    assert.equal(st.moves, 42);
    assert.deepEqual(c4.status(st), { over: true, winner: 'draw', turn: null, summary: 'Board full' });
});

test('connect4: rejects malformed and out-of-turn moves', () => {
    const st = playDef(c4, [3]);
    assert.equal(c4.validMove(st, 'A', 4), false);
    for (const m of [-1, 7, 3.5, '3', null, [3], NaN, {}]) assert.equal(c4.validMove(st, 'B', m), false);
    assert.equal(c4.validMove(playDef(c4, [0, 1, 0, 1, 0, 1, 0]), 'B', 2), false, 'game over');
});

// =====================================================================
// Hand cricket
// =====================================================================
const batter = st => st.batter;
function ball(st, bat, bowl) {
    const b = batter(st);
    const picks = b === 'A' ? { A: bat, B: bowl } : { A: bowl, B: bat };
    assert.ok(hc.validMove(st, 'A', picks.A) && hc.validMove(st, 'B', picks.B));
    return hc.applyRound(deepFreeze(st), picks);
}
const innings = (st, balls) => balls.reduce((s, [bat, bowl]) => ball(s, bat, bowl), st);
const toss = (callerPick, otherPick, first = 'A') => {
    const st = hc.init({ first });
    const o = other(first);
    return hc.applyRound(st, { [first]: callerPick, [o]: otherPick });
};

test('handcricket: toss by sum parity, caller wins when parity matches, winner bats', () => {
    let st = toss({ n: 3, call: 'odd' }, { n: 4 });
    assert.equal(st.toss.sum, 7);
    assert.equal(st.toss.parity, 'odd');
    assert.equal(st.toss.winner, 'A');
    assert.equal(st.batter, 'A');
    assert.deepEqual([st.phase, st.innings], ['play', 1]);

    st = toss({ n: 3, call: 'even' }, { n: 4 });
    assert.deepEqual([st.toss.winner, st.batter], ['B', 'B']);
    st = toss({ n: 2, call: 'even' }, { n: 6 });
    assert.equal(st.toss.winner, 'A');
    st = toss({ n: 2, call: 'odd' }, { n: 6 });
    assert.equal(st.toss.winner, 'B');
    st = toss({ n: 1, call: 'even' }, { n: 5 }, 'B'); // rematch: B calls
    assert.equal(st.caller, 'B');
    assert.equal(st.toss.winner, 'B');
});

test('handcricket: toss move shapes are strict', () => {
    const st = hc.init({ first: 'A' });
    assert.equal(hc.validMove(st, 'A', { n: 3, call: 'odd' }), true);
    assert.equal(hc.validMove(st, 'A', { n: 3 }), false, 'caller must call');
    assert.equal(hc.validMove(st, 'B', { n: 3 }), true);
    assert.equal(hc.validMove(st, 'B', { n: 3, call: 'odd' }), false, 'only the caller calls');
    for (const m of [3, '3', { n: 0, call: 'odd' }, { n: 7, call: 'odd' }, { n: 1.5, call: 'odd' }, { n: 3, call: 'both' }, { n: 3, call: 'odd', x: 1 }, null])
        assert.equal(hc.validMove(st, 'A', m), false);
    assert.equal(hc.applyRound(st, { A: { n: 3 }, B: { n: 3 } }), st, 'bad toss picks change nothing');
});

test('handcricket: equal numbers are a wicket, otherwise the batter number is added', () => {
    let st = toss({ n: 3, call: 'odd' }, { n: 4 }); // A bats
    st = ball(st, 4, 1);
    assert.deepEqual([st.runs.A, st.wickets.A, st.balls.A], [4, 0, 1]);
    assert.deepEqual(st.last, { innings: 1, batter: 'A', bat: 4, bowl: 1, out: false, runs: 4 });
    st = ball(st, 5, 5);
    assert.deepEqual([st.runs.A, st.wickets.A, st.balls.A], [4, 1, 2]);
    assert.equal(st.last.out, true);
    assert.equal(st.runs.B, 0, 'bowling side score untouched');
    assert.equal(st.log.length, 2);
    assert.equal(st.innings, 1);
});

test('handcricket: innings ends after 6 balls, then the other side chases', () => {
    let st = toss({ n: 3, call: 'odd' }, { n: 4 });
    st = innings(st, [[4, 1], [5, 2], [3, 1], [2, 1], [6, 1]]);
    assert.equal(st.innings, 1);
    assert.equal(st.balls.A, 5);
    st = ball(st, 1, 2);
    assert.equal(st.runs.A, 21);
    assert.deepEqual([st.innings, st.batter, st.target, st.phase], [2, 'B', 21, 'play']);
    assert.match(hc.status(st).summary, /needs 22 to win/);
});

test('handcricket: two wickets end an innings early', () => {
    let st = toss({ n: 3, call: 'odd' }, { n: 4 });
    st = innings(st, [[3, 3], [4, 1]]);
    assert.equal(st.innings, 1);
    st = ball(st, 2, 2);
    assert.deepEqual([st.wickets.A, st.balls.A, st.runs.A], [2, 3, 4]);
    assert.deepEqual([st.innings, st.batter, st.target], [2, 'B', 4]);
});

test('handcricket: chase ends the moment the target is passed', () => {
    let st = toss({ n: 3, call: 'odd' }, { n: 4 });
    st = innings(st, [[4, 1], [5, 2], [3, 1], [2, 1], [6, 1], [1, 2]]); // 21
    st = innings(st, [[6, 1], [6, 2], [6, 3]]);
    assert.equal(st.winner, null, '18 does not pass 21');
    st = ball(st, 4, 1);
    assert.deepEqual([st.runs.B, st.balls.B, st.winner, st.phase], [22, 4, 'B', 'over']);
    assert.deepEqual(hc.status(st), { over: true, winner: 'B', turn: null, summary: 'Target chased down' });
    assert.equal(hc.validMove(st, 'A', 3), false);
    assert.equal(hc.applyRound(st, { A: 1, B: 2 }), st);
});

test('handcricket: first side wins when the chase falls short (all out or balls gone)', () => {
    const first = innings(toss({ n: 3, call: 'odd' }, { n: 4 }), [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 1]]); // 36
    const allOut = innings(first, [[1, 2], [3, 3], [2, 4], [5, 5]]);
    assert.deepEqual([allOut.winner, allOut.runs.B, allOut.wickets.B, allOut.balls.B], ['A', 3, 2, 4]);
    assert.equal(hc.status(allOut).summary, 'Target defended');
    const spent = innings(first, [[1, 2], [1, 2], [1, 2], [1, 2], [1, 2], [1, 2]]);
    assert.deepEqual([spent.winner, spent.runs.B], ['A', 6]);
});

test('handcricket: level scores are a draw', () => {
    const first = innings(toss({ n: 3, call: 'odd' }, { n: 4 }), [[3, 1], [2, 1], [1, 2], [4, 1], [5, 1], [6, 1]]); // 21
    const done = innings(first, [[6, 1], [5, 1], [4, 1], [3, 1], [2, 1], [1, 2]]);
    assert.deepEqual([done.runs.B, done.winner], [21, 'draw']);
    assert.equal(hc.status(done).summary, 'Scores level');
});

test('handcricket: a side that scores nothing can still be chased', () => {
    let st = toss({ n: 3, call: 'odd' }, { n: 4 });
    st = innings(st, [[2, 2], [5, 5]]);
    assert.deepEqual([st.target, st.innings], [0, 2]);
    st = ball(st, 1, 3);
    assert.equal(st.winner, 'B');
});

test('handcricket: ball picks must be 1-6 integers', () => {
    const st = toss({ n: 3, call: 'odd' }, { n: 4 });
    for (const m of [0, 7, 3.5, '3', null, { n: 3 }, [3], NaN]) assert.equal(hc.validMove(st, 'A', m), false);
    for (let n = 1; n <= 6; n++) assert.equal(hc.validMove(st, 'B', n), true);
    assert.equal(hc.applyRound(st, { A: 3, B: 9 }), st);
});

// =====================================================================
// Word chain
// =====================================================================
const wcState = (...words) => {
    let st = wc.init({ first: 'A' });
    for (const w of words) st = wc.apply(st, st.turn, { word: w });
    return st;
};

test('wordchain: Latin rules', () => {
    const st = wcState('apple');
    assert.equal(st.need, 'e');
    assert.deepEqual(checkWord(wc.init({}), 'Apple'), { ok: true, word: 'apple', reason: '' }, 'first word is free, case-insensitive');
    assert.equal(checkWord(st, 'Eagle').ok, true, 'case-insensitive');
    assert.equal(checkWord(st, '  eagle  ').word, 'eagle', 'trimmed');
    assert.match(checkWord(st, 'tiger').reason, /Must start with e/);
    assert.equal(checkWord(st, 'e').reason, 'Too short');
    assert.equal(checkWord(st, '').reason, 'Too short');
    assert.equal(checkWord(st, 'e' + 'x'.repeat(23)).ok, true, '24 letters is fine');
    assert.equal(checkWord(st, 'e' + 'x'.repeat(24)).reason, 'Too long');
    assert.equal(checkWord(st, 'ea').ok, true, '2 letters is fine');
    for (const bad of ['eag1e', 'ea gle', 'éclair', 'e-mail', 'ea_', '12', '\uFF45gg', 'e\u0301a']) assert.equal(checkWord(st, bad).reason, 'Letters only', JSON.stringify(bad));
    assert.equal(checkWord(st, 'e\u212A').word, 'ek', 'NFC folds the Kelvin sign into a plain K, so both peers agree');
    const used = wcState('apple', 'eagle', 'elephant', 'tiger', 'rabbit');
    assert.equal(used.need, 't');
    assert.equal(checkWord(used, 'tiger').reason, 'Already used');
    assert.equal(checkWord(used, 'TIGER').reason, 'Already used', 'repeats ignore case');
    assert.equal(checkWord(used, 'turtle').ok, true);
});

test('wordchain: Devanagari last letter ignores trailing matras and virama', () => {
    const cases = { 'भारत': 'त', 'गाना': 'न', 'पानी': 'न', 'विद्या': 'य', 'सम्राट्': 'ट', 'चाँद': 'द', 'जंगल': 'ल', 'राजा': 'ज', 'कमल': 'ल', 'आम': 'म', 'अंक': 'क', 'किसान': 'न' };
    for (const [word, last] of Object.entries(cases)) assert.equal(lastLetter(word), last, word);
    assert.equal(lastLetter('apple'), 'e');
    assert.equal(lastLetter('कि'), 'क', 'a word ending in a matra');
});

test('wordchain: Devanagari words chain, with the same rules as Latin', () => {
    const st = wcState('भारत');
    assert.equal(st.words[0], 'भारत');
    assert.equal(st.need, 'त');
    assert.equal(checkWord(st, 'तारा').ok, true);
    const st2 = wcState('भारत', 'तारा');
    assert.equal(st2.need, 'र');
    assert.equal(checkWord(st2, 'रात').ok, true);
    assert.match(checkWord(st2, 'कमल').reason, /Must start with र/);
    const st3 = wcState('भारत', 'तारा', 'रात');
    assert.equal(checkWord(st3, 'भारत').reason, 'Must start with त', 'wrong start is judged before repeats');
    assert.equal(checkWord(st3, 'तारा').reason, 'Already used');
    assert.equal(checkWord(st, 'भ').reason, 'Too short');
    assert.match(checkWord(st, 'apple').reason, /Must start with त/, 'Latin cannot answer a Devanagari word');
    assert.match(checkWord(wcState('apple'), 'तारा').reason, /Must start with e/, 'Devanagari cannot answer a Latin word');
    for (const bad of ['भारतapple', 'भा रत', 'भारत१', 'भारत।', 'ाम', '्त', 'भारतॐ']) assert.equal(checkWord(wc.init({}), bad).reason, 'Letters only', JSON.stringify(bad));
    // repeats: same word again
    const again = wcState('भारत', 'तारा', 'रात', 'तारा');
    assert.equal(again.hearts.A, 3);
    assert.equal(again.hearts.B, 2, 'B (4th turn) repeated a word and lost a heart');
    // precomposed nukta letters are normalised to base + nukta
    assert.equal(checkWord(wc.init({}), 'क़िला').word, 'क़िला');
    assert.equal(lastLetter('क़िला'), 'ल');
    assert.equal(lastLetter('ज़'), 'ज');
});

test('wordchain: bad words and timeouts cost hearts, the required letter stays, 0 hearts loses', () => {
    let st = wcState('apple');
    st = wc.apply(st, 'B', { word: 'tiger' }); // wrong letter
    assert.deepEqual(st.hearts, { A: 3, B: 2 });
    assert.equal(st.need, 'e');
    assert.equal(st.turn, 'A');
    assert.deepEqual(st.last, { player: 'B', word: 'tiger', ok: false, timeout: false, reason: 'Must start with e' });
    st = wc.apply(st, 'A', { timeout: true });
    assert.deepEqual(st.hearts, { A: 2, B: 2 });
    assert.deepEqual([st.last.timeout, st.last.word, st.need, st.turn], [true, '', 'e', 'B']);
    st = wc.apply(st, 'B', { word: 'eagle' });
    assert.deepEqual([st.hearts.B, st.need, st.words.length], [2, 'e', 2]);
    st = wc.apply(st, 'A', { word: 'eagle' }); // repeat
    assert.equal(st.hearts.A, 1);
    assert.equal(st.winner, null);
    st = wc.apply(st, 'B', { word: 'x' });
    assert.equal(st.hearts.B, 1);
    st = wc.apply(st, 'A', { timeout: true });
    assert.deepEqual([st.hearts.A, st.winner], [0, 'B']);
    assert.deepEqual(wc.status(st), { over: true, winner: 'B', turn: null, summary: 'Out of hearts' });
    assert.equal(wc.timeLimitMs(st), null);
    assert.equal(wc.validMove(st, 'B', { word: 'abc' }), false);
});

test('wordchain: swear words and contact-sharing words are refused like any bad word', () => {
    const st = wcState('apple');
    for (const bad of ['fuck', 'Shit', 'bitch', 'madarchod', 'चूतिया', 'whatsapp', 'callmeonwhatsapp', 'instagram', 'otp']) {
        assert.deepEqual(checkWord(wc.init({}), bad), { ok: false, word: '', reason: 'Not allowed' }, bad);
    }
    assert.deepEqual(checkWord(st, 'fuck'), { ok: false, word: '', reason: 'Not allowed' }, 'refused even with the wrong first letter');
    for (const fine of ['class', 'assistant', 'scunthorpe', 'cocktail', 'snap', 'photos']) assert.equal(checkWord(wc.init({}), fine).ok, true, fine);
    const next = wc.apply(wcState('apple'), 'B', { word: 'fuck' });
    assert.deepEqual(next.hearts, { A: 3, B: 2 });
    assert.deepEqual(next.last, { player: 'B', word: '', ok: false, timeout: false, reason: 'Not allowed' }, 'never echoed back');
    assert.deepEqual(next.words, ['apple']);
    for (const odd of [undefined, null, 5, {}, Symbol('x')]) assert.deepEqual(checkWord(wc.init({}), odd), { ok: false, word: '', reason: 'Letters only' });
});

test('wordchain: time limit starts at 20 s, drops 1 s per round, floors at 8 s', () => {
    const at = turns => wc.timeLimitMs({ ...wc.init({}), turns });
    assert.deepEqual([at(0), at(1), at(2), at(3), at(4)], [20000, 20000, 19000, 19000, 18000]);
    assert.equal(at(24), 8000);
    assert.equal(at(23), 9000);
    assert.equal(at(25), 8000);
    assert.equal(at(1000), 8000);
});

test('wordchain: moves are validated structurally, state is never mutated', () => {
    const st = deepFreeze(wc.init({ first: 'A' }));
    assert.equal(wc.validMove(st, 'A', { word: 'apple' }), true);
    assert.equal(wc.validMove(st, 'A', { timeout: true }), true);
    assert.equal(wc.validMove(st, 'B', { word: 'apple' }), false, 'out of turn');
    for (const m of ['apple', { word: 5 }, { word: 'a', extra: 1 }, { timeout: false }, { timeout: true, word: 'a' }, { word: 'x'.repeat(65) }, {}, [], null])
        assert.equal(wc.validMove(st, 'A', m), false, JSON.stringify(m));
    assert.equal(wc.validMove(st, 'A', { word: 'x'.repeat(64) }), true, 'long but well-formed: judged by the rules (costs a heart)');
    const next = wc.apply(st, 'A', { word: 'x'.repeat(40) });
    assert.equal(next.hearts.A, 2);
    assert.equal(next.last.word, 'x'.repeat(40));
    const weird = wc.apply(st, 'A', { word: 'a\u0000b<script>' });
    assert.equal(weird.last.word, '', 'non-letters are never echoed back');
    assert.equal(st.words.length, 0);
});

// =====================================================================
// Engine: lobby
// =====================================================================
test('lobby: invite -> accept starts the same game on both sides, inviter is A', async () => {
    const p = makePair();
    assert.equal(p.v('A').phase, 'idle');
    assert.equal(p.A.invite('tictactoe'), true);
    assert.equal(p.v('A').phase, 'inviting');
    assert.equal(p.v('A').waitingFor, 'them');
    assert.equal(p.log[0].msg.t, 'game');
    assert.equal(p.log[0].msg.op, 'invite');
    assert.match(p.log[0].msg.gid, /^[0-9a-f]{12}$/);
    assert.equal(p.log[0].msg.game, 'tictactoe');
    await p.settle();
    const inv = p.v('B');
    assert.equal(inv.phase, 'invited');
    assert.equal(inv.game, ttt);
    assert.equal(inv.waitingFor, 'you');
    assert.equal(inv.canMove, false);
    assert.equal(inv.state, null);
    assert.equal(inv.deadline, p.clock.now() + INVITE_TTL_MS);
    assert.equal(p.B.accept(), true);
    await p.settle();
    for (const r of ['A', 'B']) {
        const v = p.v(r);
        assert.equal(v.phase, 'playing');
        assert.equal(v.game, ttt);
        assert.equal(v.me, r);
        assert.equal(v.you, other(r));
        assert.equal(v.gid, p.v('A').gid);
        assert.equal(v.status.turn, 'A');
    }
    assert.equal(p.v('A').canMove, true);
    assert.equal(p.v('A').waitingFor, 'you');
    assert.equal(p.v('B').canMove, false);
    assert.equal(p.v('B').waitingFor, 'them');
    assert.equal(p.B.move(0), false, 'B is not on turn');
    assert.equal(p.log.length, 2, 'only invite and accept so far');
});

test('lobby: either peer may invite; the inviter is always A', async () => {
    const p = makePair();
    assert.equal(p.B.invite('connect4'), true);
    await p.settle();
    assert.equal(p.A.accept(), true);
    await p.settle();
    assert.equal(p.v('B').me, 'A');
    assert.equal(p.v('A').me, 'B');
    assert.equal(p.v('B').canMove, true, 'inviter moves first');
});

test('lobby: decline ends the invite for both', async () => {
    const p = makePair();
    p.A.invite('rps');
    await p.settle();
    assert.equal(p.B.decline(), true);
    assert.equal(p.v('B').phase, 'idle');
    assert.equal(p.v('B').lastEvent, 'You declined');
    await p.settle();
    assert.equal(p.v('A').phase, 'idle');
    assert.equal(p.v('A').lastEvent, 'They declined');
    assert.equal(p.A.accept(), false);
    assert.equal(p.clock.pending(), 0, 'timers are cleaned up');
});

test('lobby: an invite expires after 30 s on both sides', async () => {
    const p = makePair();
    p.A.invite('rps');
    await p.settle();
    await p.tick(INVITE_TTL_MS - 1);
    assert.equal(p.v('A').phase, 'inviting');
    assert.equal(p.v('B').phase, 'invited');
    await p.tick(1);
    for (const r of ['A', 'B']) {
        assert.equal(p.v(r).phase, 'idle');
        assert.equal(p.v(r).lastEvent, 'Invite expired');
    }
    assert.equal(p.B.accept(), false, 'too late');
    assert.equal(p.sent('A', 'cancel').length, 1, 'the inviter tells the other side');
    assert.equal(p.clock.pending(), 0);
    assert.equal(p.A.invite('rps'), true, 'can invite again');
});

test('lobby: the invitee also expires locally if the cancel never arrives', async () => {
    const p = makePair();
    p.filter = (from, msg) => (msg.op === 'cancel' ? null : msg);
    p.A.invite('rps');
    await p.settle();
    await p.tick(INVITE_TTL_MS);
    assert.equal(p.v('B').phase, 'idle');
    assert.equal(p.v('B').lastEvent, 'Invite expired');
});

test('lobby: the inviter can withdraw an invite with forfeit()', async () => {
    const p = makePair();
    p.A.invite('rps');
    await p.settle();
    assert.equal(p.A.forfeit(), true);
    await p.settle();
    assert.equal(p.v('A').phase, 'idle');
    assert.equal(p.v('B').phase, 'idle');
    assert.equal(p.v('B').lastEvent, 'Invite cancelled');
});

test('lobby: an accept that crosses a cancel does not leave a ghost game', async () => {
    const p = makePair();
    p.A.invite('tictactoe');
    await p.settle();
    p.filter = (from, msg) => (msg.op === 'accept' ? null : msg); // accept gets lost
    p.B.accept();
    assert.equal(p.v('B').phase, 'playing');
    p.A.forfeit(); // A withdraws the invite
    await p.settle();
    assert.equal(p.v('B').phase, 'idle');
    assert.equal(p.v('B').lastEvent, 'Invite cancelled');
});

test('lobby: invite while a game is active is auto-declined and the game is untouched', async () => {
    const p = await start('tictactoe');
    await turns(p, [4]);
    const before = p.v('A');
    p.log.length = 0;
    p.A.receive({ t: 'game', op: 'invite', gid: '0123456789ab', game: 'rps' });
    assert.deepEqual(p.log.map(e => [e.from, e.msg.op, e.msg.gid]), [['A', 'decline', '0123456789ab']]);
    assert.equal(p.v('A').phase, 'playing');
    assert.deepEqual(p.v('A').state, before.state);
    assert.equal(p.A.invite('rps'), false);
    assert.equal(p.A.accept(), false);
});

test('lobby: unknown game ids are declined; garbage ids are ignored', async () => {
    const p = makePair();
    p.A.receive({ t: 'game', op: 'invite', gid: '0123456789ab', game: 'chess' });
    assert.equal(p.v('A').phase, 'idle');
    assert.equal(p.log.at(-1).msg.op, 'decline');
    p.log.length = 0;
    for (const game of [5, null, {}, 'CHESS', '', 'constructor', '__proto__', 'x'.repeat(100)]) {
        p.A.receive({ t: 'game', op: 'invite', gid: '0123456789ab', game });
    }
    assert.equal(p.v('A').phase, 'idle');
    assert.equal(p.A.invite('chess'), false);
    assert.equal(p.A.invite('constructor'), false);
    assert.equal(p.A.invite(undefined), false);
    assert.equal(p.A.invite({ toString: () => 'rps' }), false);
});

test('lobby: crossing invites resolve to exactly one game', async () => {
    const p = makePair();
    p.A.invite('tictactoe');
    p.B.invite('rps');
    await p.settle();
    const phases = [p.v('A').phase, p.v('B').phase].sort();
    assert.deepEqual(phases, ['invited', 'inviting']);
    const invitee = p.v('A').phase === 'invited' ? 'A' : 'B';
    const inviter = other(invitee);
    assert.equal(p.v(invitee).game, p.v(inviter).game, 'both agree which game');
    assert.equal(p.v(invitee).gid, p.v(inviter).gid);
    assert.equal(p[invitee].accept(), true);
    await p.settle();
    assert.equal(p.v(inviter).me, 'A');
    assert.equal(p.v(invitee).me, 'B');
    assert.equal(p.v(inviter).phase, 'playing');
});

test('protocol constants match the spec', () => {
    assert.deepEqual([INVITE_TTL_MS, IDLE_MS, GRACE_MS, TOLERANCE_MS, MAX_MESSAGE_BYTES], [30000, 90000, 3000, 3000, 2048]);
});

test('lobby: a repeated copy of the same invite does not extend its life', async () => {
    const p = makePair();
    p.A.invite('rps');
    await p.settle();
    const invite = p.sent('A', 'invite')[0];
    await p.tick(20000);
    p.B.receive(invite); // replayed by a hostile or buggy peer
    assert.equal(p.v('B').deadline, p.clock.now() - 20000 + 30000, 'deadline unchanged');
    await p.tick(10000);
    assert.equal(p.v('B').phase, 'idle');
    assert.equal(p.v('B').lastEvent, 'Invite expired');
});

test('lobby: a newer invite replaces a pending one; stale/foreign gids are ignored', async () => {
    const p = makePair();
    p.A.invite('rps');
    await p.settle();
    const g1 = p.v('B').gid;
    p.B.receive({ t: 'game', op: 'invite', gid: 'aaaaaaaaaaaa', game: 'connect4' });
    assert.equal(p.v('B').gid, 'aaaaaaaaaaaa');
    assert.equal(p.v('B').game, c4);
    p.B.receive({ t: 'game', op: 'accept', gid: g1 }); // wrong direction and wrong gid
    p.B.receive({ t: 'game', op: 'cancel', gid: g1 });
    assert.equal(p.v('B').phase, 'invited');
    p.B.receive({ t: 'game', op: 'cancel', gid: 'aaaaaaaaaaaa' });
    assert.equal(p.v('B').phase, 'idle');
});

// =====================================================================
// Engine: turn-based games end to end
// =====================================================================
test('tictactoe over the wire: win, loss and draw', async () => {
    let p = await start('tictactoe');
    await turns(p, [0, 3, 1, 4, 2]);
    assertResult(p, 'A');
    assert.equal(p.clock.pending(), 0);

    p = await start('tictactoe');
    await turns(p, [0, 3, 1, 4, 8, 5]);
    assertResult(p, 'B');

    p = await start('tictactoe');
    await turns(p, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
    assertResult(p, 'draw');
    assert.equal(p.v('A').status.summary, 'Board full');
});

test('connect4 over the wire: win, loss and draw', async () => {
    let p = await start('connect4');
    await turns(p, [0, 1, 0, 1, 0, 1, 0]);
    assertResult(p, 'A');
    assert.equal(p.v('B').state.line.length, 4);

    p = await start('connect4');
    await turns(p, [0, 1, 0, 1, 2, 1, 2, 1]);
    assertResult(p, 'B');

    p = await start('connect4');
    await turns(p, [1, 6, 5, 5, 6, 4, 5, 1, 6, 2, 5, 5, 3, 1, 6, 3, 1, 3, 2, 3, 3, 4, 5, 0, 3, 6, 6, 0, 2, 0, 1, 1, 2, 2, 4, 4, 2, 4, 0, 0, 0, 4]);
    assertResult(p, 'draw');
});

test('turn-based: out-of-turn, illegal and malformed moves are ignored and never sent', async () => {
    const p = await start('tictactoe');
    p.log.length = 0;
    for (const m of [4]) assert.equal(p.B.move(m), false, 'B out of turn');
    for (const m of [-1, 9, 1.5, '4', null, undefined, {}, [], NaN, () => 4, { toJSON() { throw new Error('boom'); } }]) {
        assert.equal(p.A.move(m), false, `A illegal ${String(m)}`);
    }
    await p.settle();
    assert.equal(p.log.length, 0);

    await turns(p, [4]);
    const snapshot = p.v('B').state;
    const gid = p.v('A').gid;
    // forged messages arriving at B that claim to be A's move, while it is B's turn
    p.B.receive({ t: 'game', op: 'move', gid, seq: 1, move: 0 });
    // forged messages at A that claim to be B's move, in every malformed way
    const bad = [
        { seq: 1, move: 9 }, { seq: 1, move: -1 }, { seq: 1, move: '0' }, { seq: 1, move: 4 }, { seq: 1, move: null }, { seq: 1 },
        { seq: 1, move: { cell: 0 } }, { seq: '1', move: 0 }, { seq: 1.5, move: 0 }, { seq: null, move: 0 }, { move: 0 }, { seq: -1, move: 0 },
    ];
    for (const b of bad) p.A.receive({ t: 'game', op: 'move', gid, ...b });
    assert.deepEqual(p.v('B').state, snapshot);
    assert.equal(p.v('A').state.moves, 1);
    assert.equal(p.v('A').status.turn, 'B');
    // wrong gid / wrong envelope
    p.A.receive({ t: 'game', op: 'move', gid: '000000000000', seq: 1, move: 0 });
    p.A.receive({ t: 'chat', op: 'move', gid, seq: 1, move: 0 });
    p.A.receive({ op: 'move', gid, seq: 1, move: 0 });
    assert.equal(p.v('A').state.moves, 1);
    // and a legitimate move still goes through afterwards
    await turns(p, [0]);
    assert.equal(p.v('A').state.moves, 2);
});

test('turn-based: duplicate and out-of-order seq are ignored', async () => {
    const p = await start('tictactoe');
    await turns(p, [4]);
    const first = p.sent('A', 'move')[0];
    assert.deepEqual([first.seq, first.move], [0, 4]);
    p.B.receive(first); // duplicate
    p.B.receive({ ...first, move: 0 }); // same seq, different move
    assert.equal(p.v('B').state.moves, 1);
    assert.equal(p.v('B').state.board[0], null);
    await turns(p, [0]);
    assert.equal(p.sent('B', 'move')[0].seq, 1);
    // A receives a replay of B's move and one from the future
    p.A.receive(p.sent('B', 'move')[0]);
    p.A.receive({ t: 'game', op: 'move', gid: first.gid, seq: 5, move: 8 });
    p.A.receive({ t: 'game', op: 'move', gid: first.gid, seq: 3, move: 8 });
    assert.equal(p.v('A').state.moves, 2);
    assertSynced(p);
    await turns(p, [8]);
    assert.equal(p.v('A').state.moves, 3);
});

test('turn-based: moves after the end are ignored', async () => {
    const p = await start('tictactoe');
    await turns(p, [0, 3, 1, 4, 2]);
    const snap = p.v('B').state;
    assert.equal(p.A.move(8), false);
    assert.equal(p.B.move(8), false);
    p.B.receive({ t: 'game', op: 'move', gid: p.v('A').gid, seq: 5, move: 8 });
    assert.deepEqual(p.v('B').state, snap);
});

test('forfeit: the other side wins, nothing more is accepted', async () => {
    const p = await start('connect4');
    await turns(p, [3]);
    assert.equal(p.B.forfeit(), true);
    assert.equal(p.v('B').phase, 'over');
    assert.equal(p.v('B').lastEvent, 'You forfeited');
    await p.settle();
    assert.equal(p.v('A').phase, 'over');
    assert.equal(p.v('A').lastEvent, 'They forfeited');
    assert.equal(p.v('A').status.winner, 'A');
    assert.equal(p.v('B').status.winner, 'A');
    assert.equal(p.v('A').canMove, false);
    assert.equal(p.A.forfeit(), false);
    assert.equal(p.A.move(2), false);
    assert.equal(p.clock.pending(), 0);
});

test('idle: the side on turn loses after 90 s without a move (and a move resets the clock)', async () => {
    let p = await start('tictactoe');
    await p.tick(60000);
    await turns(p, [4]);
    await p.tick(IDLE_MS - 1);
    assert.equal(p.v('A').phase, 'playing');
    await p.tick(1); // B has been silent for 90 s
    assert.equal(p.v('B').phase, 'over');
    assert.equal(p.v('B').lastEvent, 'You timed out');
    assert.equal(p.v('A').phase, 'over');
    assert.equal(p.v('A').status.winner, 'A');
    assert.equal(p.v('A').lastEvent, 'They forfeited');

    // if the idle player's own report never arrives, the waiting side gives up after a grace period
    p = await start('tictactoe');
    p.filter = (from, msg) => (msg.op === 'forfeit' ? null : msg);
    await p.tick(IDLE_MS);
    assert.equal(p.v('A').phase, 'over', 'A was on turn and reported its own timeout');
    p = await start('tictactoe');
    await turns(p, [4]);
    p.filter = (from, msg) => (msg.op === 'forfeit' ? null : msg);
    await p.tick(IDLE_MS);
    assert.equal(p.v('A').phase, 'playing', 'A waits during the grace period');
    await p.tick(GRACE_MS);
    assert.equal(p.v('A').phase, 'over');
    assert.equal(p.v('A').lastEvent, 'They timed out');
    assert.equal(p.v('A').status.winner, 'A');
});

test('views: canMove / waitingFor / deadline for turn-based games', async () => {
    const p = await start('tictactoe');
    assert.equal(p.v('A').deadline, null, 'untimed games have no deadline');
    assert.equal(p.v('A').round, null);
    await turns(p, [0]);
    assert.deepEqual([p.v('A').canMove, p.v('A').waitingFor], [false, 'them']);
    assert.deepEqual([p.v('B').canMove, p.v('B').waitingFor], [true, 'you']);
    assert.ok(p.views.A.length >= 3 && p.views.B.length >= 3, 'onChange fires after every change');
    const v = p.v('A');
    v.state.board[8] = 'A'; // callers cannot corrupt the session through the view
    assert.equal(p.v('A').state.board[8], null);
});

// =====================================================================
// Engine: simultaneous games (commit-reveal)
// =====================================================================
test('rps over the wire: win, loss, draw and replayed ties', async () => {
    let p = await start('rps');
    await round(p, 'stone', 'scissors');
    assert.equal(p.v('A').phase, 'playing');
    await round(p, 'paper', 'stone');
    assertResult(p, 'A');
    assert.equal(p.clock.pending(), 0);

    p = await start('rps');
    await round(p, 'stone', 'paper');
    await round(p, 'scissors', 'stone');
    assertResult(p, 'B');

    p = await start('rps');
    for (let i = 0; i < 4; i++) await round(p, 'paper', 'paper');
    assert.equal(p.v('A').phase, 'playing', 'ties do not end the match early');
    await round(p, 'paper', 'paper');
    assertResult(p, 'draw');

    p = await start('rps');
    await round(p, 'stone', 'scissors');
    await round(p, 'stone', 'stone');
    await round(p, 'scissors', 'stone');
    await round(p, 'paper', 'stone');
    assertResult(p, 'A');
});

test('commit-reveal: commits hide the move, reveals follow only after both commits, hashes verify', async () => {
    const p = await start('rps');
    p.log.length = 0;
    assert.equal(p.A.move('stone'), true);
    assert.equal(p.A.move('paper'), false, 'one pick per round');
    await p.settle();
    const commitA = p.sent('A', 'commit')[0];
    assert.equal(p.sent('A', 'reveal').length, 0, 'no reveal until B committed too');
    assert.deepEqual(Object.keys(commitA).sort(), ['gid', 'hash', 'op', 'round', 't']);
    assert.equal(commitA.round, 0);
    assert.match(commitA.hash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(commitA).includes('stone'));
    let a = p.v('A');
    let b = p.v('B');
    assert.deepEqual(a.round, { number: 1, iCommitted: true, theyCommitted: false });
    assert.deepEqual(b.round, { number: 1, iCommitted: false, theyCommitted: true });
    assert.deepEqual([a.canMove, a.waitingFor, b.canMove, b.waitingFor], [false, 'them', true, 'you']);

    p.B.move('scissors');
    await p.settle();
    const [revA] = p.sent('A', 'reveal');
    const [revB] = p.sent('B', 'reveal');
    assert.equal(revA.move, 'stone');
    assert.equal(revB.move, 'scissors');
    assert.match(revA.nonce, /^[0-9a-f]{32}$/);
    const expectHash = (r, m, n) => createHash('sha256').update(JSON.stringify([r.gid, r.round, m, n])).digest('hex');
    assert.equal(commitA.hash, expectHash(revA, revA.move, revA.nonce));
    assert.equal(p.sent('B', 'commit')[0].hash, expectHash(revB, revB.move, revB.nonce));
    assert.notEqual(revA.nonce, revB.nonce);
    // round resolved, next round open
    a = p.v('A');
    assert.deepEqual(a.round, { number: 2, iCommitted: false, theyCommitted: false });
    assert.deepEqual(a.lastRound, { A: 'stone', B: 'scissors' });
    assert.deepEqual([a.canMove, a.waitingFor], [true, 'both']);
    assert.deepEqual(a.state.wins, { A: 1, B: 0 });
    // fresh nonce and hash every round
    p.A.move('stone');
    await p.settle();
    assert.notEqual(p.sent('A', 'commit')[1].hash, commitA.hash);
    assert.equal(p.sent('A', 'commit')[1].round, 1);
});

test('commit-reveal: a tampered reveal is caught and the cheater forfeits', async () => {
    for (const tamper of [msg => { msg.move = 'paper'; }, msg => { msg.nonce = 'f'.repeat(32); }]) {
        const p = await start('rps');
        p.filter = (from, msg) => { if (from === 'A' && msg.op === 'reveal') tamper(msg); return msg; };
        p.A.move('stone');
        p.B.move('scissors');
        await p.settle();
        const b = p.v('B');
        assert.equal(b.phase, 'over');
        assert.equal(b.status.winner, 'B');
        assert.equal(b.lastEvent, 'They cheated, you win!');
        assert.equal(b.state.rounds.length, 0, 'the tampered round is never applied');
        assert.equal(p.B.move('stone'), false);
        assert.equal(p.B.rematch(), true, 'the honest side can start over');
    }
});

test('commit-reveal: committing to an illegal move is cheating too', async () => {
    const p = await start('rps');
    const gid = p.v('A').gid;
    const nonce = 'ab'.repeat(16);
    const hash = sha256Hex(commitPayload(gid, 0, 'dynamite', nonce));
    p.B.receive({ t: 'game', op: 'commit', gid, round: 0, hash });
    p.B.move('stone');
    p.B.receive({ t: 'game', op: 'reveal', gid, round: 0, move: 'dynamite', nonce });
    assert.equal(p.v('B').phase, 'over');
    assert.equal(p.v('B').status.winner, 'B');
});

test('commit-reveal: out-of-order, repeated and malformed commit/reveal messages are ignored', async () => {
    const p = await start('rps');
    const gid = p.v('A').gid;
    const nonce = 'cd'.repeat(16);
    const h1 = sha256Hex(commitPayload(gid, 0, 'paper', nonce));
    const h2 = sha256Hex(commitPayload(gid, 0, 'stone', nonce));
    const snap = () => JSON.stringify(p.v('B'));
    // reveal before anyone committed
    p.B.receive({ t: 'game', op: 'reveal', gid, round: 0, move: 'paper', nonce });
    // malformed commits
    for (const c of [{ round: 0 }, { hash: h1 }, { round: 0, hash: 'xyz' }, { round: '0', hash: h1 }, { round: 1, hash: h1 }, { round: 0, hash: h1.toUpperCase() }, { round: -1, hash: h1 }, { round: 0, hash: [h1] }])
        p.B.receive({ t: 'game', op: 'commit', gid, ...c });
    assert.equal(p.v('B').round.theyCommitted, false);
    const before = snap();
    p.B.receive({ t: 'game', op: 'commit', gid: '111111111111', round: 0, hash: h1 });
    assert.equal(snap(), before);
    // a good commit, then a second one for the same round is ignored
    p.B.receive({ t: 'game', op: 'commit', gid, round: 0, hash: h1 });
    p.B.receive({ t: 'game', op: 'commit', gid, round: 0, hash: h2 });
    assert.equal(p.v('B').round.theyCommitted, true);
    // reveal before B has committed itself is ignored (B would learn nothing and A could not be checked)
    p.B.receive({ t: 'game', op: 'reveal', gid, round: 0, move: 'paper', nonce });
    assert.equal(p.v('B').phase, 'playing');
    p.B.move('stone');
    // malformed reveals are ignored, they do not count as cheating
    for (const r of [{ round: 0, nonce }, { round: 0, move: 'paper' }, { round: 0, move: 'paper', nonce: 'zz' }, { round: 1, move: 'paper', nonce }, { round: 0, move: 'paper', nonce: 5 }, { round: '0', move: 'paper', nonce }])
      p.B.receive({ t: 'game', op: 'reveal', gid, round: 0, ...r });
    assert.equal(p.v('B').phase, 'playing');
    // the matching reveal resolves the round (the first commit won)
    p.B.receive({ t: 'game', op: 'reveal', gid, round: 0, move: 'paper', nonce });
    assert.equal(p.v('B').state.rounds.length, 1);
    assert.equal(p.v('B').state.rounds[0].A, 'paper');
    assert.equal(p.v('B').round.number, 2);
    // and a replayed reveal does nothing
    p.B.receive({ t: 'game', op: 'reveal', gid, round: 0, move: 'paper', nonce });
    p.B.receive({ t: 'game', op: 'reveal', gid, round: 1, move: 'paper', nonce });
    assert.equal(p.v('B').state.rounds.length, 1);
    assert.equal(p.v('B').phase, 'playing');
});

test('simultaneous: illegal picks are rejected locally and never sent', async () => {
    const p = await start('rps');
    p.log.length = 0;
    for (const m of ['rock', '', null, undefined, 3, {}, ['stone'], 'STONE']) assert.equal(p.A.move(m), false);
    assert.equal(p.log.length, 0);
    assert.equal(p.v('A').round.iCommitted, false);
});

test('simultaneous: idle player forfeits after 90 s; silent peer is dropped after the grace period', async () => {
    let p = await start('rps');
    p.A.move('stone');
    await p.settle();
    await p.tick(IDLE_MS); // B never picked
    assert.equal(p.v('B').lastEvent, 'You timed out');
    assert.equal(p.v('A').phase, 'over');
    assert.equal(p.v('A').status.winner, 'A');

    p = await start('rps');
    p.filter = (from, msg) => (msg.op === 'forfeit' ? null : msg);
    p.A.move('stone');
    await p.settle();
    await p.tick(IDLE_MS);
    assert.equal(p.v('A').phase, 'playing');
    await p.tick(GRACE_MS);
    assert.equal(p.v('A').phase, 'over');
    assert.equal(p.v('A').lastEvent, 'They timed out');

    p = await start('rps'); // nobody picks: nobody wins
    await p.tick(IDLE_MS);
    assertResult(p, 'draw');
    assert.equal(p.v('A').lastEvent, 'Draw');
});

test('simultaneous: committing resets the idle clock for the other side', async () => {
    const p = await start('rps');
    await p.tick(80000);
    p.A.move('stone');
    await p.settle();
    await p.tick(60000); // B has had 140 s in total, but only 60 s since A committed
    assert.equal(p.v('B').phase, 'playing');
    await p.tick(30000);
    assert.equal(p.v('B').phase, 'over');
});

// ----- hand cricket over the wire -----
async function cricketToss(p, call, callerN, otherN) {
    const caller = p.v('A').state.caller;
    const o = other(caller);
    assert.equal(p[caller].move({ n: callerN, call }), true);
    assert.equal(p[o].move({ n: otherN }), true);
    await p.settle();
    assertSynced(p);
}

async function cricketBalls(p, balls) {
    for (const [bat, bowl] of balls) {
        const b = p.v('A').state.batter;
        const bowler = other(b);
        assert.equal(p[b].move(bat), true);
        assert.equal(p[bowler].move(bowl), true);
        await p.settle();
        assertSynced(p);
    }
}

test('handcricket over the wire: toss, innings with wickets, chase ends the match', async () => {
    const p = await start('handcricket');
    assert.equal(p.v('A').state.phase, 'toss');
    assert.equal(p.A.move(4), false, 'toss needs the object form');
    assert.equal(p.A.move({ n: 3 }), false, 'caller must call');
    assert.equal(p.B.move({ n: 3, call: 'odd' }), false, 'only the caller calls');
    await cricketToss(p, 'odd', 3, 4);
    assert.equal(p.v('B').state.toss.winner, 'A');
    assert.equal(p.v('A').state.batter, 'A');
    assert.equal(p.v('A').lastRound.A.call, 'odd', 'toss picks are revealed after the round');
    await cricketBalls(p, [[3, 3], [4, 1], [2, 2]]); // out, 4, out -> innings over
    assert.deepEqual([p.v('A').state.innings, p.v('A').state.target, p.v('A').state.batter], [2, 4, 'B']);
    await cricketBalls(p, [[5, 1]]);
    assertResult(p, 'B');
});

test('handcricket over the wire: defended target (loss for the chaser) and a tie', async () => {
    let p = await start('handcricket');
    await cricketToss(p, 'even', 3, 4); // odd: B wins the toss and bats first
    assert.equal(p.v('A').state.batter, 'B');
    await cricketBalls(p, [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 1]]);
    assert.equal(p.v('A').state.target, 36);
    await cricketBalls(p, [[1, 2], [3, 3], [2, 4], [5, 5]]);
    assertResult(p, 'B');

    p = await start('handcricket');
    await cricketToss(p, 'odd', 3, 4);
    await cricketBalls(p, [[3, 1], [2, 1], [1, 2], [4, 1], [5, 1], [6, 1]]);
    await cricketBalls(p, [[6, 1], [5, 1], [4, 1], [3, 1], [2, 1], [1, 2]]);
    assertResult(p, 'draw');
});

test('handcricket: caller alternates on rematch, rounds restart', async () => {
    const p = await start('handcricket');
    await cricketToss(p, 'odd', 1, 2);
    await cricketBalls(p, [[1, 2], [3, 3], [4, 4]]); // 1 run, all out
    await cricketBalls(p, [[2, 5]]);
    assertResult(p, 'B');
    p.A.rematch();
    p.B.rematch();
    await p.settle();
    assert.equal(p.v('A').state.caller, 'B');
    assert.equal(p.v('A').round.number, 1);
    assert.equal(p.B.move({ n: 2, call: 'even' }), true);
    assert.equal(p.A.move({ n: 4 }), true);
    await p.settle();
    assert.equal(p.v('A').state.toss.winner, 'B');
});

// ----- word chain over the wire -----
test('wordchain over the wire: valid chain, repeats and bad words cost hearts until someone is out', async () => {
    const p = await start('wordchain');
    assert.equal(p.v('A').deadline, p.clock.now() + 20000);
    await turns(p, [{ word: 'apple' }]);
    assert.equal(p.v('B').state.need, 'e');
    assert.equal(p.v('B').status.summary, 'Next word starts with e');
    await turns(p, [{ word: 'zebra' }]); // wrong letter: B loses a heart, A is on turn again
    assert.deepEqual(p.v('A').state.hearts, { A: 3, B: 2 });
    assert.equal(p.v('A').status.turn, 'A');
    await turns(p, [{ word: 'Eagle' }, { word: 'eagle' }, { word: 'emu' }]); // B repeats -> 1 heart
    assert.equal(p.v('A').state.hearts.B, 1);
    await turns(p, [{ word: 'x' }]);
    assertResult(p, 'A');
    assert.equal(p.v('A').state.hearts.B, 0);
    assert.notEqual(p.v('A').status.winner, 'draw');
});

test('wordchain over the wire: Devanagari chain', async () => {
    const p = await start('wordchain');
    await turns(p, [{ word: 'भारत' }, { word: 'तारा' }, { word: 'रात' }]);
    assert.equal(p.v('A').state.need, 'त');
    assert.deepEqual(p.v('B').state.words, ['भारत', 'तारा', 'रात']);
    await turns(p, [{ word: 'कमल' }]); // B's turn: wrong letter
    assert.equal(p.v('A').state.hearts.B, 2);
    assert.equal(p.v('A').state.last.reason, 'Must start with त');
});

test('wordchain: the side on turn reports its own timeout, both sides lose the heart and the limit shrinks', async () => {
    const p = await start('wordchain');
    const t0 = p.clock.now();
    await p.tick(19999);
    assert.equal(p.v('A').state.turns, 0);
    await p.tick(1);
    for (const r of ['A', 'B']) {
        const v = p.v(r);
        assert.deepEqual(v.state.hearts, { A: 2, B: 3 });
        assert.equal(v.status.turn, 'B');
        assert.equal(v.state.last.timeout, true);
    }
    assert.deepEqual(p.sent('A', 'move')[0].move, { timeout: true });
    assert.equal(p.v('B').deadline, t0 + 20000 + 20000);
    await p.tick(20000); // B times out (second turn is still a 20 s turn)
    assert.deepEqual(p.v('A').state.hearts, { A: 2, B: 2 });
    assert.equal(p.v('A').deadline, p.clock.now() + 19000, 'round 2 has 19 s');
    // run A out of hearts by letting every one of its turns expire: 19 s, 19 s (B), 18 s
    await p.tick(19000);
    await p.tick(19000);
    await p.tick(18000);
    assertSynced(p);
    assertResult(p, 'B');
    assert.equal(p.v('A').state.hearts.A, 0);
    assert.equal(p.clock.pending(), 0);
});

test('wordchain: a timeout claim is accepted only if our own clock roughly agrees', async () => {
    const p = await start('wordchain');
    const gid = p.v('A').gid;
    const claim = { t: 'game', op: 'move', gid, seq: 0, move: { timeout: true } };
    await p.tick(20000 - TOLERANCE_MS - 1000);
    p.filter = () => null; // keep A's real engine out of it
    p.B.receive(claim);
    assert.equal(p.v('B').state.turns, 0, 'claimed 4 s early: ignored');
    assert.equal(p.v('B').state.hearts.A, 3);
    p.clock.advance(999);
    p.B.receive(claim);
    assert.equal(p.v('B').state.turns, 0, 'still 1 ms outside the tolerance');
    p.clock.advance(1);
    p.B.receive(claim);
    assert.equal(p.v('B').state.turns, 1, 'within the 3 s tolerance: accepted');
    assert.equal(p.v('B').state.hearts.A, 2);
    // the same claim again is a duplicate seq
    p.B.receive(claim);
    assert.equal(p.v('B').state.turns, 1);
});

test('wordchain: nobody can claim a timeout for the wrong side, early, or in a game without a clock', async () => {
    const p = await start('wordchain');
    const gid = p.v('A').gid;
    // B trying to time itself out / A out of turn
    assert.equal(p.B.move({ timeout: true }), false);
    assert.equal(p.A.move({ timeout: true }), false, 'A cannot claim before its own clock ran out');
    p.A.receive({ t: 'game', op: 'move', gid, seq: 0, move: { timeout: true } });
    assert.equal(p.v('A').state.turns, 0, 'A is on turn: B may not move');
    await turns(p, [{ word: 'apple' }]);
    p.A.receive({ t: 'game', op: 'move', gid, seq: 1, move: { timeout: true, word: 'x' } });
    p.A.receive({ t: 'game', op: 'move', gid, seq: 1, move: { timeout: false } });
    assert.equal(p.v('A').state.turns, 1);

    const q = await start('tictactoe');
    q.A.receive({ t: 'game', op: 'move', gid: q.v('A').gid, seq: 0, move: { timeout: true } });
    await q.tick(1000);
    assert.equal(q.v('A').state.moves, 0);
    assert.equal(q.B.move({ timeout: true }), false);
});

test('wordchain: a silent peer on turn is dropped after the limit plus grace', async () => {
    const p = await start('wordchain');
    await turns(p, [{ word: 'apple' }]);
    p.filter = (from, msg) => (from === 'B' ? null : msg); // B goes dark
    await p.tick(19999 + GRACE_MS);
    assert.equal(p.v('A').phase, 'playing');
    await p.tick(1);
    assert.equal(p.v('A').phase, 'over');
    assert.equal(p.v('A').lastEvent, 'They timed out');
    assert.equal(p.v('A').status.winner, 'A');
});

// =====================================================================
// Engine: rematch
// =====================================================================
test('rematch: roles stay, the first player alternates every game', async () => {
    const p = await start('tictactoe');
    const gids = [p.v('A').gid];
    const firsts = [p.v('A').state.first];
    for (let g = 0; g < 3; g++) {
        await turns(p, [0, 3, 1, 4, 2].slice(0, 5)); // the player who starts takes cells 0,1,2
        const winner = p.v('A').status.winner;
        assert.equal(winner, firsts.at(-1), 'the starter wins this scripted game');
        assert.equal(p.A.rematch(), true);
        assert.equal(p.A.rematch(), false, 'one request at a time');
        await p.settle();
        assert.equal(p.v('A').rematch, 'you');
        assert.equal(p.v('B').rematch, 'them');
        assert.equal(p.v('B').lastEvent, 'They want a rematch');
        assert.equal(p.v('B').phase, 'over', 'game stays visible until B answers');
        assert.equal(p.B.rematch(), true);
        await p.settle();
        for (const r of ['A', 'B']) {
            const v = p.v(r);
            assert.equal(v.phase, 'playing');
            assert.equal(v.me, r, 'roles stay');
            assert.equal(v.rematch, null);
            assert.equal(v.state.moves, 0);
            assert.equal(v.lastEvent, '');
        }
        assert.notEqual(p.v('A').gid, gids.at(-1), 'new gid per game');
        assert.equal(p.v('A').gid, p.v('B').gid);
        gids.push(p.v('A').gid);
        firsts.push(p.v('A').state.first);
        assert.equal(p.v('A').state.first, p.v('B').state.first);
    }
    assert.deepEqual(firsts, ['A', 'B', 'A', 'B']);
    assert.equal(new Set(gids).size, 4);
});

test('rematch: the new first player moves first and old-game messages are ignored', async () => {
    const p = await start('connect4');
    await turns(p, [0, 1, 0, 1, 0, 1, 0]);
    const oldGid = p.v('A').gid;
    p.B.rematch();
    p.A.rematch();
    await p.settle();
    assert.equal(p.v('B').canMove, true, 'B starts the second game');
    assert.equal(p.v('A').canMove, false);
    assert.equal(p.A.move(3), false);
    p.A.receive({ t: 'game', op: 'move', gid: oldGid, seq: 0, move: 3 });
    assert.equal(p.v('A').state.moves, 0);
    await turns(p, [3]);
    assert.equal(p.v('A').state.board[38], 'B');
    assert.equal(p.v('A').state.marks.B, 'red');
});

test('rematch: both asking at once agree on one new game', async () => {
    const p = await start('tictactoe');
    await turns(p, [0, 3, 1, 4, 2]);
    p.A.rematch();
    p.B.rematch();
    await p.settle();
    assert.equal(p.v('A').phase, 'playing');
    assert.equal(p.v('B').phase, 'playing');
    assert.equal(p.v('A').gid, p.v('B').gid);
    assert.equal(p.v('A').state.first, 'B');
    await turns(p, [4]);
});

test('rematch: works for commit-reveal games (round numbers restart)', async () => {
    const p = await start('rps');
    await round(p, 'stone', 'scissors');
    await round(p, 'stone', 'scissors');
    assertResult(p, 'A');
    p.A.rematch();
    p.B.rematch();
    await p.settle();
    assert.equal(p.v('A').round.number, 1);
    assert.deepEqual(p.v('A').state.wins, { A: 0, B: 0 });
    await round(p, 'paper', 'scissors');
    await round(p, 'paper', 'stone');
    await round(p, 'paper', 'scissors');
    assertResult(p, 'B');
    assert.deepEqual(p.sent('A', 'commit').slice(-1)[0].round, 2);
});

test('rematch: offers expire after 30 s, can be declined, and need a finished game', async () => {
    const p = await start('tictactoe');
    assert.equal(p.A.rematch(), false, 'game still running');
    await turns(p, [0, 3, 1, 4, 2]);
    p.A.rematch();
    await p.settle();
    await p.tick(INVITE_TTL_MS);
    assert.equal(p.v('A').rematch, null);
    assert.equal(p.v('A').lastEvent, 'Rematch expired');
    assert.equal(p.v('B').rematch, null);
    // B answering a stale offer starts nothing on A's side
    p.B.rematch();
    await p.settle();
    assert.equal(p.v('A').phase, 'over');
    assert.equal(p.v('B').rematch, 'you');
    assert.equal(p.B.decline(), false, 'cannot decline your own offer');
    p.A.decline();
    await p.settle();
    assert.equal(p.v('A').lastEvent, 'You declined the rematch');
    assert.equal(p.v('B').lastEvent, 'They declined the rematch');
    assert.equal(p.v('B').rematch, null);
    assert.equal(p.clock.pending(), 0);
});

test('rematch: a rematch message with the wrong gid or a bad newGid is ignored', async () => {
    const p = await start('tictactoe');
    await turns(p, [0, 3, 1, 4, 2]);
    const gid = p.v('A').gid;
    for (const m of [{ gid: '000000000000', newGid: 'abcabcabcabc' }, { gid, newGid: 'nope' }, { gid, newGid: 5 }, { gid }, { gid, newGid: ['abcabcabcabc'] }])
        p.B.receive({ t: 'game', op: 'rematch', ...m });
    assert.equal(p.v('B').rematch, null);
    assert.equal(p.v('B').phase, 'over');
});

test('after a game, a fresh invite (a different game) works', async () => {
    const p = await start('tictactoe');
    await turns(p, [0, 3, 1, 4, 2]);
    assert.equal(p.B.invite('rps'), true);
    await p.settle();
    assert.equal(p.v('A').phase, 'invited');
    assert.equal(p.v('A').game, rps);
    p.A.accept();
    await p.settle();
    assert.equal(p.v('B').me, 'A');
    assert.equal(p.v('A').me, 'B');
    await round(p, 'stone', 'scissors');
});

// =====================================================================
// Engine: hostile input
// =====================================================================
test('receive() never throws on garbage and ignores it', async () => {
    const p = await start('tictactoe');
    const gid = p.v('A').gid;
    const circular = {};
    circular.self = circular;
    const deep = {};
    let cur = deep;
    for (let i = 0; i < 5000; i++) cur = cur.n = {};
    const garbage = [
        undefined, null, 0, 1, NaN, 'game', '{"t":"game"}', true, [], [1, 2], {}, { t: 'game' }, { t: 'game', op: 'move' },
        { t: 'game', op: 'nope', gid }, { t: 'game', op: 'constructor', gid }, { t: 'game', op: '__proto__', gid },
        { t: 'game', op: 'toString', gid }, { t: 'game', op: 'hasOwnProperty', gid }, { t: 'game', op: ['move'], gid },
        { t: 'game', op: 'move', gid: 12 }, { t: 'game', op: 'move', gid: [gid] }, { t: 'game', op: 'move', gid: gid.toUpperCase() },
        { t: 'game', op: 'move', gid, seq: 1n }, circular, deep, { t: 'game', op: 'move', gid, get seq() { throw new Error('boom'); } },
        { t: 'game', op: 'move', gid, seq: 1, move: circular }, { toJSON() { throw new Error('boom'); } }, Symbol('x'), () => 1,
        new Date(), new Map(), new Uint8Array(4), Object.create(null),
    ];
    garbage.forEach((g, i) => {
        assert.doesNotThrow(() => p.A.receive(g), `garbage #${i} into A`);
        assert.doesNotThrow(() => p.B.receive(g), `garbage #${i} into B`);
    });
    assert.equal(p.v('A').phase, 'playing');
    assert.equal(p.v('B').phase, 'playing');
    assert.equal(p.v('A').state.moves, 0);
    await turns(p, [4]);
});

test('messages over 2 KB (by bytes) are ignored', async () => {
    const p = makePair();
    const inv = (extra = {}) => ({ t: 'game', op: 'invite', gid: '0123456789ab', game: 'rps', ...extra });
    p.A.receive(inv({ junk: 'x'.repeat(3000) }));
    assert.equal(p.v('A').phase, 'idle');
    p.A.receive(inv({ junk: 'é'.repeat(1100) })); // 1100 chars but 2200 bytes
    assert.equal(p.v('A').phase, 'idle');
    const pad = MAX_MESSAGE_BYTES - JSON.stringify(inv({ junk: '' })).length;
    p.A.receive(inv({ junk: 'x'.repeat(pad + 1) }));
    assert.equal(p.v('A').phase, 'idle', 'one byte over');
    p.A.receive(inv({ junk: 'x'.repeat(pad) }));
    assert.equal(p.v('A').phase, 'invited', 'exactly 2048 bytes is fine');
});

test('a large move in an otherwise valid message is ignored', async () => {
    const p = await start('wordchain');
    const gid = p.v('A').gid;
    p.B.receive({ t: 'game', op: 'move', gid, seq: 0, move: { word: 'a'.repeat(3000) } });
    assert.equal(p.v('B').state.turns, 0);
    p.B.receive({ t: 'game', op: 'move', gid, seq: 0, move: { word: 'a'.repeat(65) } });
    assert.equal(p.v('B').state.turns, 0, 'over the 64 character cap: malformed');
    p.B.receive({ t: 'game', op: 'move', gid, seq: 0, move: { word: 'a'.repeat(40) } });
    assert.equal(p.v('B').state.turns, 1, 'long but well-formed words are judged by the rules');
    assert.equal(p.v('B').state.hearts.A, 2);
});

test('public methods never throw, even with odd arguments or a broken channel', async () => {
    const views = [];
    const s = createGameSession({
        me: 'A',
        send: () => { throw new Error('channel closed'); },
        onChange: v => { views.push(v); throw new Error('ui bug'); },
    });
    assert.equal(s.invite('tictactoe'), true, 'a throwing send/onChange does not break the session');
    assert.equal(s.state().phase, 'inviting');
    assert.equal(s.move(1), false);
    assert.equal(s.rematch(), false);
    assert.equal(s.decline(), false);
    assert.equal(s.accept(), false);
    s.receive({ t: 'game', op: 'accept', gid: s.state().gid });
    assert.equal(s.state().phase, 'playing');
    assert.equal(s.move(4), true);
    assert.equal(s.move({ toJSON() { throw new Error('x'); } }), false);
    assert.equal(s.forfeit(), true);
    assert.ok(views.length >= 4);
    // construction with no options at all
    const bare = createGameSession();
    assert.equal(bare.state().phase, 'idle');
    assert.equal(bare.invite('rps'), true);
    bare.dispose();
});

test('dispose stops timers, callbacks and message handling', async () => {
    const p = makePair();
    p.A.invite('rps');
    await p.settle();
    const count = p.views.B.length;
    p.B.dispose();
    p.A.dispose();
    assert.equal(p.clock.pending(), 0);
    p.clock.advance(60000);
    p.B.receive({ t: 'game', op: 'cancel', gid: p.v('A').gid });
    assert.equal(p.views.B.length, count, 'no onChange after dispose');
    assert.equal(p.A.invite('rps'), false);
    assert.equal(p.B.accept(), false);

    const q = await start('wordchain');
    q.A.dispose();
    q.B.dispose();
    assert.equal(q.clock.pending(), 0);
});

test('views keep the documented shape in every phase', async () => {
    const p = makePair();
    const keys = ['canMove', 'deadline', 'game', 'gid', 'lastEvent', 'lastRound', 'me', 'phase', 'rematch', 'round', 'state', 'status', 'waitingFor', 'you'];
    const check = v => assert.deepEqual(Object.keys(v).sort(), keys);
    check(p.v('A'));
    assert.deepEqual([p.v('A').phase, p.v('A').game, p.v('A').state, p.v('A').status, p.v('A').canMove, p.v('A').waitingFor, p.v('A').lastEvent], ['idle', null, null, null, false, null, '']);
    await start('rps', p);
    for (const r of ['A', 'B']) check(p.v(r));
    p.A.forfeit();
    await p.settle();
    check(p.v('A'));
    check(p.v('B'));
    for (const v of [...p.views.A, ...p.views.B]) {
        assert.ok(['idle', 'invited', 'inviting', 'playing', 'over'].includes(v.phase));
        assert.ok([null, 'you', 'them', 'both'].includes(v.waitingFor));
        assert.equal(typeof v.lastEvent, 'string');
        assert.equal(typeof v.canMove, 'boolean');
    }
});

test('works with synchronous delivery too (send calls the peer directly, replies can be instant)', () => {
    const clock = makeClock();
    const wire = (me, peer, sessions, extra = {}) => createGameSession({
        me, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
        send: msg => sessions[peer].receive(structuredClone(msg)), ...extra,
    });

    // B answers from inside onChange, re-entrantly: its reply must not overtake the move it answers
    const t = {};
    t.A = wire('A', 'B', t);
    t.B = wire('B', 'A', t, {
        onChange: v => { if (v.phase === 'playing' && v.canMove) t.B.move(v.state.board.indexOf(null)); },
    });
    assert.equal(t.A.invite('tictactoe'), true);
    assert.equal(t.B.state().phase, 'invited');
    assert.equal(t.B.accept(), true);
    for (const cell of [4, 8, 7]) {
        if (t.A.state().phase !== 'playing') break;
        assert.equal(t.A.move(cell), true, `A plays ${cell}`);
        assert.deepEqual(t.A.state().state, t.B.state().state, 'identical after every exchange');
    }
    assert.ok(t.A.state().state.moves >= 5, 'the game kept going');

    // commit-reveal with instant delivery
    const r = {};
    r.A = wire('A', 'B', r);
    r.B = wire('B', 'A', r);
    r.A.invite('rps');
    r.B.accept();
    for (const [a, b] of [['stone', 'scissors'], ['paper', 'stone']]) {
        assert.equal(r.A.move(a), true);
        assert.equal(r.B.move(b), true);
        assert.deepEqual(r.A.state().state, r.B.state().state);
    }
    assert.equal(r.A.state().status.winner, 'A');
    assert.equal(r.B.state().status.winner, 'A');
    assert.equal(r.A.state().lastEvent, 'You won!');
    [t.A, t.B, r.A, r.B].forEach(x => x.dispose());
    assert.equal(clock.pending(), 0);
});
