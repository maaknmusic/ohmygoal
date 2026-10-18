// Stone-Paper-Scissors, best of 3: first to 2 round wins takes the match.
// A tied round is replayed; after MAX_ROUNDS rounds the leader wins, or the match is a draw if level.
// Simultaneous: both sides pick, then applyRound({ A, B }) resolves the round.

const MOVES = ['stone', 'paper', 'scissors'];
const BEATS = { stone: 'scissors', paper: 'stone', scissors: 'paper' };
const WINS_NEEDED = 2;
const MAX_ROUNDS = 5;

const isPlayer = p => p === 'A' || p === 'B';

function init({ first } = {}) {
    return { first: first === 'B' ? 'B' : 'A', wins: { A: 0, B: 0 }, rounds: [], winner: null, target: WINS_NEEDED, maxRounds: MAX_ROUNDS };
}

function validMove(state, player, move) {
    return isPlayer(player) && state.winner === null && MOVES.includes(move);
}

function matchWinner(wins, played) {
    if (wins.A >= WINS_NEEDED) return 'A';
    if (wins.B >= WINS_NEEDED) return 'B';
    if (played < MAX_ROUNDS) return null;
    return wins.A === wins.B ? 'draw' : wins.A > wins.B ? 'A' : 'B';
}

function applyRound(state, picks) {
    const a = picks?.A;
    const b = picks?.B;
    if (state.winner !== null || !MOVES.includes(a) || !MOVES.includes(b)) return state;
    const who = a === b ? 'draw' : BEATS[a] === b ? 'A' : 'B';
    const wins = { ...state.wins };
    if (who !== 'draw') wins[who] += 1;
    const rounds = [...state.rounds, { A: a, B: b, winner: who }];
    return { ...state, wins, rounds, winner: matchWinner(wins, rounds.length) };
}

function status(state) {
    const over = state.winner !== null;
    const { A, B } = state.wins;
    let summary = `Round ${state.rounds.length + 1}, first to ${WINS_NEEDED} (${A}-${B})`;
    if (state.winner === 'draw') summary = `Match tied ${A}-${B}`;
    else if (over) summary = `Won the match ${Math.max(A, B)}-${Math.min(A, B)}`;
    return { over, winner: state.winner, turn: over ? null : 'both', summary };
}

export default {
    id: 'rps', name: 'Stone Paper Scissors', emoji: '✂️', blurb: 'Best of 3, picks revealed together.',
    players: 2, simultaneous: true, init, validMove, applyRound, status,
};
