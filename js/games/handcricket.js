// Indian odd-even hand cricket, "super over" format. Simultaneous: each ball both sides pick 1-6.
//
// Toss: the caller (state.caller = the `first` player, i.e. the inviter in the first game) calls
// odd or even. Both pick 1-6 at once; if the parity of the sum matches the call the caller wins
// the toss, otherwise the other side does. The toss winner bats first.
//   toss move, caller:     { n: 1-6, call: 'odd' | 'even' }
//   toss move, other side: { n: 1-6 }
//   ball move (both):      1-6
//
// Each side bats once: 6 balls or 2 wickets, whichever comes first. Equal numbers = wicket,
// otherwise the batter's number is added to their runs. `target` is the first innings total;
// the chasing side wins as soon as its runs pass it. Level scores after the chase = draw.

const BALLS = 6;
const WICKETS = 2;

const other = p => (p === 'A' ? 'B' : 'A');
const isPlayer = p => p === 'A' || p === 'B';
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = n => Number.isInteger(n) && n >= 1 && n <= 6;

function init({ first } = {}) {
    const f = first === 'B' ? 'B' : 'A';
    return {
        first: f, caller: f, phase: 'toss', toss: null, innings: 0, batter: null, target: null,
        runs: { A: 0, B: 0 }, wickets: { A: 0, B: 0 }, balls: { A: 0, B: 0 },
        log: [], last: null, winner: null,
    };
}

function validMove(state, player, move) {
    if (!isPlayer(player) || state.winner !== null) return false;
    if (state.phase === 'play') return isNum(move);
    if (!isObj(move)) return false;
    const keys = Object.keys(move).sort().join();
    if (player === state.caller) return keys === 'call,n' && isNum(move.n) && (move.call === 'odd' || move.call === 'even');
    return keys === 'n' && isNum(move.n);
}

function resolveToss(state, a, b) {
    const pick = { A: a, B: b };
    const call = pick[state.caller].call;
    const sum = a.n + b.n;
    const parity = sum % 2 ? 'odd' : 'even';
    const winner = parity === call ? state.caller : other(state.caller);
    return {
        ...state, phase: 'play', innings: 1, batter: winner,
        toss: { call, A: a.n, B: b.n, sum, parity, winner },
    };
}

function playBall(state, a, b) {
    const batter = state.batter;
    const bat = batter === 'A' ? a : b;
    const bowl = batter === 'A' ? b : a;
    const out = bat === bowl;
    const runs = out ? 0 : bat;
    const next = {
        ...state,
        runs: { ...state.runs, [batter]: state.runs[batter] + runs },
        wickets: { ...state.wickets, [batter]: state.wickets[batter] + (out ? 1 : 0) },
        balls: { ...state.balls, [batter]: state.balls[batter] + 1 },
    };
    next.last = { innings: state.innings, batter, bat, bowl, out, runs };
    next.log = [...state.log, next.last];

    const chasing = state.innings === 2;
    if (chasing && next.runs[batter] > state.target) return { ...next, phase: 'over', winner: batter };
    if (next.wickets[batter] < WICKETS && next.balls[batter] < BALLS) return next;
    if (!chasing) return { ...next, innings: 2, batter: other(batter), target: next.runs[batter] };
    const level = next.runs[batter] === state.target;
    return { ...next, phase: 'over', winner: level ? 'draw' : other(batter) };
}

function applyRound(state, picks) {
    const a = picks?.A;
    const b = picks?.B;
    if (state.winner !== null) return state;
    if (state.phase === 'toss') {
        return validMove(state, 'A', a) && validMove(state, 'B', b) ? resolveToss(state, a, b) : state;
    }
    return isNum(a) && isNum(b) ? playBall(state, a, b) : state;
}

function status(state) {
    const over = state.winner !== null;
    let summary = `Toss: ${state.caller} calls odd or even`;
    if (state.phase === 'play') {
        const b = state.batter;
        summary = `Innings ${state.innings}: ${b} ${state.runs[b]}/${state.wickets[b]}, ${BALLS - state.balls[b]} balls left`;
        if (state.innings === 2) summary += `, needs ${state.target + 1 - state.runs[b]} to win`;
    } else if (over) {
        summary = state.winner === 'draw' ? 'Scores level'
            : state.winner === state.toss.winner ? 'Target defended' : 'Target chased down';
    }
    return { over, winner: state.winner, turn: over ? null : 'both', summary };
}

export default {
    id: 'handcricket', name: 'Hand Cricket', emoji: '🏏', blurb: 'Odd-even super over: 6 balls, 2 wickets.',
    players: 2, simultaneous: true, init, validMove, applyRound, status,
};
