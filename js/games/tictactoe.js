// Tic-tac-toe. Move = cell index 0-8 (row-major). The player who starts plays X.

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

const other = p => (p === 'A' ? 'B' : 'A');
const isPlayer = p => p === 'A' || p === 'B';

function lineOf(board) {
    return LINES.find(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c]) || null;
}

function init({ first } = {}) {
    const f = first === 'B' ? 'B' : 'A';
    return {
        first: f, turn: f, marks: { [f]: 'X', [other(f)]: 'O' },
        board: Array(9).fill(null), moves: 0, winner: null, line: null, last: null,
    };
}

function validMove(state, player, move) {
    return isPlayer(player) && state.winner === null && player === state.turn
        && Number.isInteger(move) && move >= 0 && move < 9 && state.board[move] === null;
}

function apply(state, player, move) {
    const board = state.board.slice();
    board[move] = player;
    const line = lineOf(board);
    const moves = state.moves + 1;
    return {
        ...state, board, moves, line, last: move, turn: other(player),
        winner: line ? player : moves === 9 ? 'draw' : null,
    };
}

function status(state) {
    const over = state.winner !== null;
    let summary = `${state.marks[state.turn]} to move`;
    if (state.winner === 'draw') summary = 'Board full';
    else if (over) summary = `${state.marks[state.winner]} made three in a row`;
    return { over, winner: state.winner, turn: over ? null : state.turn, summary };
}

export default {
    id: 'tictactoe', name: 'Tic-Tac-Toe', emoji: '❌', blurb: 'Three in a row wins.',
    players: 2, simultaneous: false, init, validMove, apply, status,
};
