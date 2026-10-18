// =====================================================================
// Two-player game sessions between chat strangers, over a WebRTC data channel (no server).
// Pure logic, no DOM. The app provides send(obj) and passes every incoming object to receive().
//
// Messages are plain objects { t: 'game', op, gid, ... }:
//   invite {game}  accept  decline  cancel          lobby; the inviter is 'A', the invitee 'B'
//   move {seq, move}                                turn-based; seq = moves applied before this one
//   commit {round, hash}  reveal {round, move, nonce}   simultaneous games (commit-reveal):
//       hash = SHA-256 hex of JSON.stringify([gid, round, move, nonce]), nonce = 16 random bytes
//       as hex. Reveals are only sent once both commits are in; a reveal that does not match
//       its commit (or is not a legal move) forfeits the cheater.
//   forfeit                                         the sender gives up
//   rematch {newGid}                                same game, roles stay, first player alternates
//
// Peers are untrusted: input is size-limited, copied through JSON, validated, and never throws.
// Both sides run the same pure game code, so they hold identical state.
// A commit that is a copy of our own is cheating (they would just echo our reveal and always tie).
// Messages are queued while an entry point runs and sent when it is done, so a peer that answers
// from inside send() (or a UI that reacts inside onChange) always finds our state already settled.
// =====================================================================

import { byId } from './index.js';

export const INVITE_TTL_MS = 30000;
export const IDLE_MS = 90000;       // no move for this long: the side on turn loses
export const GRACE_MS = 3000;       // extra wait before the other side gives up on a silent peer
export const TOLERANCE_MS = 3000;   // how early a peer's timeout claim may be by our own clock
export const MAX_MESSAGE_BYTES = 2048;

const OPS = new Set(['invite', 'accept', 'decline', 'cancel', 'move', 'commit', 'reveal', 'forfeit', 'rematch']);
const GID = /^[0-9a-f]{12}$/;
const NONCE = /^[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{64}$/;
const GAME_ID = /^[a-z0-9_-]{1,32}$/;

const other = r => (r === 'A' ? 'B' : 'A');
const isStr = (v, re) => typeof v === 'string' && re.test(v);

// ---------------------------------------------------------------------
// SHA-256 (synchronous, so a round can never be interleaved with other messages)
// ---------------------------------------------------------------------
const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const ror = (x, n) => (x >>> n) | (x << (32 - n));

/** Hex SHA-256 of a string (UTF-8). */
export function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const total = ((bytes.length + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[bytes.length] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(total - 4, (bytes.length << 3) >>> 0);

    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15];
            const y = w[i - 2];
            w[i] = w[i - 16] + (ror(x, 7) ^ ror(x, 18) ^ (x >>> 3)) + w[i - 7] + (ror(y, 17) ^ ror(y, 19) ^ (y >>> 10));
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const t1 = hh + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
            const t2 = (ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
            hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] += v; });
    }
    return Array.from(h, v => v.toString(16).padStart(8, '0')).join('');
}

/** Throws without a secure source: a guessable commit nonce would reveal our move. */
function randomHex(bytes) {
    const buf = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(buf);
    return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

/** The string a commit hashes. */
export const commitPayload = (gid, round, move, nonce) => JSON.stringify([gid, round, move, nonce]);

/** Deep copy through JSON: strips anything that is not plain data. undefined if impossible. */
function plain(value) {
    try {
        const text = JSON.stringify(value);
        return text === undefined ? undefined : JSON.parse(text);
    } catch { return undefined; }
}

/** Incoming object -> clean plain message, or null if it is oversized, malformed or unknown. */
function parse(input) {
    let text;
    try { text = JSON.stringify(input); } catch { return null; }
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES) return null;
    const msg = JSON.parse(text);
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return null;
    if (msg.t !== 'game' || !OPS.has(msg.op) || !isStr(msg.gid, GID)) return null;
    return msg;
}

// ---------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------

/**
 * me: the role shown while idle. In each game the inviter is 'A' and the invitee 'B' (kept for rematches).
 * send(obj): deliver to the peer. onChange(view): called after every change.
 * now / setTimeout / clearTimeout can be replaced (tests use a fake clock).
 */
export function createGameSession({
    me = 'A', send, onChange, now = Date.now,
    setTimeout: setT = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: clearT = id => globalThis.clearTimeout(id),
} = {}) {
    let disposed = false;
    let phase = 'idle';              // idle | inviting | invited | playing | over
    let role = me === 'B' ? 'B' : 'A';
    let gid = null;
    let def = null;
    let first = 'A';
    let state = null;
    let seq = 0;                     // moves (or rounds) applied so far
    let ended = null;                // { winner, summary } when the game stopped outside its own rules
    let lastEvent = '';
    let activityAt = 0;              // clock of the last progress, drives timeouts
    let inviteAt = 0;                // when the pending invite expires
    let rd = null;                   // simultaneous games: the round being played
    let lastRound = null;            // picks of the last resolved round { A, B }
    let rematchMine = null;
    let rematchTheirs = null;
    let lateOffer = null;            // our rematch offer that just lapsed: an acceptance already on its way still counts
    let depth = 0;                   // entry points running (public calls, incoming messages, timers)
    const outbox = [];
    const timers = { invite: null, play: null, rematch: null };

    // ----- plumbing -----
    function post(op, fields) {
        outbox.push({ t: 'game', op, gid, ...fields });
        if (depth === 0) flush();
    }

    function flush() {
        while (outbox.length) {
            const msg = outbox.shift(); // taken first: with no send(), `send?.(outbox.shift())` would never drain the queue
            try { send?.(msg); } catch { /* channel closed */ }
        }
    }

    /** Run an entry point; what it queued goes out once it (and any onChange reaction) has finished. */
    function entry(fn) {
        depth++;
        try { return fn(); } finally {
            depth--;
            if (depth === 0) flush();
        }
    }

    function emit() {
        if (disposed) return;
        try { onChange?.(view()); } catch { /* a UI error must not break the session */ }
    }

    function clearTimer(name) {
        if (timers[name] === null) return;
        clearT(timers[name]);
        timers[name] = null;
    }

    function setTimer(name, ms, fn) {
        clearTimer(name);
        timers[name] = setT(() => {
            timers[name] = null;
            if (disposed) return;
            try { entry(fn); } catch { /* never throw out of a timer */ }
        }, Math.max(0, ms));
    }

    function reset() {
        Object.keys(timers).forEach(clearTimer);
        gid = null; def = null; state = null; seq = 0; ended = null; rd = null; lastRound = null;
        rematchMine = null; rematchTheirs = null; lateOffer = null; inviteAt = 0;
    }

    function toIdle(event) {
        reset();
        phase = 'idle';
        lastEvent = event;
        emit();
    }

    const valid = (player, move) => {
        try { return def.validMove(state, player, move) === true; } catch { return false; }
    };
    const statusNow = () => (ended ? { over: true, winner: ended.winner, turn: null, summary: ended.summary } : def.status(state));
    const limitNow = () => (def?.timeLimitMs && !def.simultaneous ? def.timeLimitMs(state) : null);

    // ----- view -----
    function waitingFor() {
        if (phase === 'inviting') return 'them';
        if (phase === 'invited') return 'you';
        if (phase !== 'playing') return null;
        if (!def.simultaneous) return statusNow().turn === role ? 'you' : 'them';
        if (!rd.mine) return rd.theirHash ? 'you' : 'both';
        return 'them';
    }

    function deadline() {
        if (phase === 'inviting' || phase === 'invited') return inviteAt;
        const limit = phase === 'playing' ? limitNow() : null;
        return limit ? activityAt + limit : null;
    }

    function view() {
        const live = phase === 'playing';
        const shown = live || phase === 'over';
        const wait = waitingFor();
        return {
            phase, gid, game: def, me: role, you: other(role),
            state: shown ? plain(state) : null,
            status: shown ? statusNow() : null,
            canMove: live && (def.simultaneous ? !rd.mine : statusNow().turn === role),
            waitingFor: wait,
            lastEvent,
            round: live && def.simultaneous ? { number: rd.n + 1, iCommitted: Boolean(rd.mine), theyCommitted: Boolean(rd.theirHash) } : null,
            lastRound: lastRound ? { ...lastRound } : null,
            rematch: phase === 'over' ? (rematchMine ? 'you' : rematchTheirs ? 'them' : null) : null,
            deadline: deadline(),
        };
    }

    // ----- lobby -----
    function startInviteTimer() {
        inviteAt = now() + INVITE_TTL_MS;
        setTimer('invite', INVITE_TTL_MS, () => {
            if (phase === 'inviting') post('cancel');
            toIdle('Invite expired');
        });
    }

    function invite(gameId) {
        if (disposed || (phase !== 'idle' && phase !== 'over')) return false;
        const game = isStr(gameId, GAME_ID) ? byId[gameId] : undefined;
        if (!game) return false;
        const id = randomHex(6);
        reset();
        phase = 'inviting'; role = 'A'; def = game; gid = id; lastEvent = '';
        post('invite', { game: game.id });
        startInviteTimer();
        emit();
        return true;
    }

    function onInvite(msg) {
        if (msg.gid === gid) return;
        const game = isStr(msg.game, GAME_ID) ? byId[msg.game] : undefined;
        if (phase === 'playing' || !game) { // busy or unknown game: refuse without touching our own state
            post('decline', { gid: msg.gid });
            return;
        }
        // Both invited at once: the lower gid wins, the other side drops its own invite.
        if (phase === 'inviting' && msg.gid > gid) return;
        reset();
        phase = 'invited'; role = 'B'; def = game; gid = msg.gid; lastEvent = '';
        startInviteTimer();
        emit();
    }

    function accept() {
        if (disposed || phase !== 'invited') return false;
        post('accept');
        startGame('A');
        return true;
    }

    function decline() {
        if (disposed) return false;
        if (phase === 'invited') {
            post('decline');
            toIdle('You declined');
            return true;
        }
        if (phase === 'over' && rematchTheirs && !rematchMine) {
            post('decline');
            rematchTheirs = null;
            clearTimer('rematch');
            lastEvent = 'You declined the rematch';
            emit();
            return true;
        }
        return false;
    }

    function onAccept(msg) {
        if (phase === 'inviting' && msg.gid === gid) startGame('A');
    }

    function onDecline(msg) {
        if (msg.gid !== gid) return;
        if (phase === 'inviting') toIdle('They declined');
        else if (phase === 'over' && rematchMine) {
            rematchMine = null;
            clearTimer('rematch');
            lastEvent = 'They declined the rematch';
            emit();
        }
    }

    function onCancel(msg) {
        if (msg.gid !== gid) return;
        // The invitee may have accepted (and even committed) just as the invite expired on the other side.
        const justStarted = phase === 'playing' && role === 'B' && seq === 0 && !rd?.theirHash;
        if (phase === 'invited' || justStarted) toIdle('Invite cancelled');
    }

    // ----- game start -----
    function startGame(firstPlayer) {
        Object.keys(timers).forEach(clearTimer);
        first = firstPlayer;
        phase = 'playing'; ended = null; seq = 0; lastRound = null; lastEvent = '';
        rematchMine = null; rematchTheirs = null; lateOffer = null;
        state = def.init({ first, opts: {} });
        rd = def.simultaneous ? newRound(0) : null;
        activityAt = now();
        settle();
    }

    function newRound(n) {
        return { n, mine: null, theirHash: null, theirMove: undefined, revealed: false };
    }

    // ----- ending -----
    function endGame(winner, event, summary) {
        Object.keys(timers).forEach(clearTimer);
        ended = { winner, summary };
        phase = 'over';
        lastEvent = event;
        emit();
    }

    function outcomeText(winner) {
        return winner === 'draw' ? 'Draw' : winner === role ? 'You won!' : 'You lost';
    }

    /** After any state change: finish the game if its rules say so, else re-arm the clock. */
    function settle() {
        const st = def.status(state);
        if (st.over) {
            Object.keys(timers).forEach(clearTimer);
            phase = 'over';
            lastEvent = outcomeText(st.winner);
        } else arm();
        emit();
    }

    function forfeit() {
        if (disposed) return false;
        if (phase === 'inviting') {
            post('cancel');
            toIdle('Invite cancelled');
            return true;
        }
        if (phase !== 'playing') return false;
        post('forfeit');
        endGame(other(role), 'You forfeited', 'Forfeited');
        return true;
    }

    function onForfeit(msg) {
        if (phase === 'playing' && msg.gid === gid) endGame(role, 'They forfeited', 'Forfeited');
    }

    // ----- clocks -----
    /** Who is overdue: the side on turn, or whoever has not yet committed/revealed. */
    function overdueSide() {
        if (!def.simultaneous) return statusNow().turn;
        if (!rd.mine) return rd.theirHash ? role : 'both';
        return other(role);
    }

    function arm() {
        clearTimer('play');
        if (phase !== 'playing' || ended) return;
        const side = overdueSide();
        const limit = limitNow();
        const wait = activityAt + (limit ?? IDLE_MS) - now();
        if (side === role) setTimer('play', wait, onMyDeadline);
        else if (side === 'both') setTimer('play', wait, () => endGame('draw', 'Draw', 'Timed out'));
        else setTimer('play', wait + GRACE_MS, () => endGame(role, 'They timed out', 'Timed out'));
    }

    function onMyDeadline() {
        if (limitNow()) { // timed games: report the timeout as a move, both sides apply it
            const move = { timeout: true };
            if (valid(role, move)) applyTurn(role, move);
            return;
        }
        post('forfeit');
        endGame(other(role), 'You timed out', 'Timed out');
    }

    const isTimeout = move => Boolean(limitNow()) && move !== null && typeof move === 'object' && move.timeout === true;
    const timeoutDue = tolerance => now() - activityAt >= limitNow() - tolerance;

    // ----- turn-based moves -----
    /** Apply a move on our side; our own moves are sent once applied, so a reply can never overtake them. */
    function applyTurn(player, move) {
        const sentSeq = seq;
        state = def.apply(state, player, move);
        seq++;
        activityAt = now();
        if (player === role) post('move', { seq: sentSeq, move });
        settle();
    }

    function playTurn(raw) {
        if (statusNow().turn !== role) return false;
        const move = plain(raw);
        if (move === undefined || !valid(role, move)) return false;
        if (isTimeout(move) && !timeoutDue(250)) return false; // only when our own clock ran out
        applyTurn(role, move);
        return true;
    }

    function onMove(msg) {
        if (phase !== 'playing' || def.simultaneous || msg.gid !== gid) return;
        if (!Number.isInteger(msg.seq) || msg.seq !== seq) return; // duplicate or out of order
        const them = other(role);
        if (statusNow().turn !== them || !valid(them, msg.move)) return;
        if (isTimeout(msg.move) && !timeoutDue(TOLERANCE_MS)) return; // their clock disagrees with ours
        applyTurn(them, msg.move);
    }

    // ----- simultaneous moves: commit, then reveal -----
    function commitMine(raw) {
        if (rd.mine) return false;
        const move = plain(raw);
        if (move === undefined || !valid(role, move)) return false;
        const nonce = randomHex(16);
        const hash = sha256Hex(commitPayload(gid, rd.n, move, nonce));
        rd.mine = { move, nonce, hash };
        post('commit', { round: rd.n, hash });
        activityAt = now();
        advanceRound();
        return true;
    }

    function onCommit(msg) {
        if (phase !== 'playing' || !def.simultaneous || msg.gid !== gid || ended) return;
        if (msg.round !== rd.n || rd.theirHash || !isStr(msg.hash, HASH)) return;
        if (rd.mine?.hash === msg.hash) { // an echo of our commit: they would mirror our reveal and never lose a round
            endGame(role, 'They cheated, you win!', 'Cheating detected');
            return;
        }
        rd.theirHash = msg.hash;
        activityAt = now();
        advanceRound();
    }

    function onReveal(msg) {
        if (phase !== 'playing' || !def.simultaneous || msg.gid !== gid || ended) return;
        // Only after both commits are in; anything else is out of order and ignored.
        if (msg.round !== rd.n || !rd.mine || !rd.theirHash || rd.theirMove !== undefined) return;
        if (!isStr(msg.nonce, NONCE) || !('move' in msg)) return;
        const matches = sha256Hex(commitPayload(gid, rd.n, msg.move, msg.nonce)) === rd.theirHash;
        if (!matches || !valid(other(role), msg.move)) {
            endGame(role, 'They cheated, you win!', 'Cheating detected');
            return;
        }
        rd.theirMove = msg.move;
        activityAt = now();
        advanceRound();
    }

    function advanceRound() {
        if (rd.mine && rd.theirHash && !rd.revealed) {
            rd.revealed = true;
            post('reveal', { round: rd.n, move: rd.mine.move, nonce: rd.mine.nonce });
        }
        if (rd.revealed && rd.theirMove !== undefined) {
            const picks = { [role]: rd.mine.move, [other(role)]: rd.theirMove };
            state = def.applyRound(state, picks);
            lastRound = picks;
            seq++;
            rd = newRound(rd.n + 1);
            activityAt = now();
        }
        settle();
    }

    function move(raw) {
        if (disposed || phase !== 'playing' || ended) return false;
        return def.simultaneous ? commitMine(raw) : playTurn(raw);
    }

    // ----- rematch -----
    function rematch() {
        if (disposed || phase !== 'over' || rematchMine) return false;
        rematchMine = rematchTheirs || randomHex(6);
        post('rematch', { newGid: rematchMine });
        if (rematchTheirs) beginRematch();
        else {
            setTimer('rematch', INVITE_TTL_MS, () => {
                lateOffer = { gid: rematchMine, until: now() + GRACE_MS };
                rematchMine = null; lastEvent = 'Rematch expired'; emit();
            });
            emit();
        }
        return true;
    }

    function onRematch(msg) {
        if (phase !== 'over' || msg.gid !== gid || rematchTheirs || !isStr(msg.newGid, GID) || msg.newGid === gid) return;
        rematchTheirs = msg.newGid;
        // They answered our offer in the last moment: it reached us just after our own timer ran out.
        if (!rematchMine && lateOffer?.gid === msg.newGid && now() <= lateOffer.until) rematchMine = msg.newGid;
        if (rematchMine) beginRematch();
        else {
            setTimer('rematch', INVITE_TTL_MS, () => { rematchTheirs = null; lastEvent = 'Rematch expired'; emit(); });
            lastEvent = 'They want a rematch';
            emit();
        }
    }

    function beginRematch() {
        gid = rematchMine < rematchTheirs ? rematchMine : rematchTheirs; // both sides pick the same one
        startGame(other(first));
    }

    // ----- inbound -----
    const handlers = {
        invite: onInvite, accept: onAccept, decline: onDecline, cancel: onCancel, move: onMove,
        commit: onCommit, reveal: onReveal, forfeit: onForfeit, rematch: onRematch,
    };

    function receive(input) {
        if (disposed) return;
        try {
            const msg = parse(input);
            if (msg) entry(() => handlers[msg.op](msg));
        } catch { /* garbage from the peer must never throw */ }
    }

    const guard = (fn, fallback) => (...args) => {
        try { return entry(() => fn(...args)); } catch { return fallback; }
    };

    return {
        invite: guard(invite, false),
        accept: guard(accept, false),
        decline: guard(decline, false),
        move: guard(move, false),
        forfeit: guard(forfeit, false),
        rematch: guard(rematch, false),
        receive,
        state: guard(view, null),
        dispose() {
            disposed = true;
            Object.keys(timers).forEach(clearTimer);
        },
    };
}
