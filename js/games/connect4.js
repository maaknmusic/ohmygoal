// Connect 4 on a 7x6 board. Move = column index 0-6. The player who starts plays red.
// board is flat, row-major, row 0 at the top: cell = row * COLS + col.

const COLS = 7;
const ROWS = 6;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

const other = p => (p === 'A' ? 'B' : 'A');
const isPlayer = p => p === 'A' || p === 'B';

function dropRow(board, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (board[r * COLS + col] === null) return r;
    return -1;
}

/** Cells of a run of 4+ through `cell`, or null. */
function runThrough(board, cell) {
    const owner = board[cell];
    const row = Math.floor(cell / COLS);
    const col = cell % COLS;
    for (const [dr, dc] of DIRS) {
        const run = [cell];
        for (const sign of [1, -1]) {
            for (let r = row + dr * sign, c = col + dc * sign; r >= 0 && r < ROWS && c >= 0 && c < COLS; r += dr * sign, c += dc * sign) {
                if (board[r * COLS + c] !== owner) break;
                run.push(r * COLS + c);
            }
        }
        if (run.length >= 4) return run.sort((x, y) => x - y);
    }
    return null;
}

function init({ first } = {}) {
    const f = first === 'B' ? 'B' : 'A';
    return {
        first: f, turn: f, marks: { [f]: 'red', [other(f)]: 'yellow' },
        board: Array(COLS * ROWS).fill(null), moves: 0, winner: null, line: null, last: null,
    };
}

function validMove(state, player, move) {
    return isPlayer(player) && state.winner === null && player === state.turn
        && Number.isInteger(move) && move >= 0 && move < COLS && state.board[move] === null;
}

function apply(state, player, move) {
    const board = state.board.slice();
    const cell = dropRow(board, move) * COLS + move;
    board[cell] = player;
    const line = runThrough(board, cell);
    const moves = state.moves + 1;
    return {
        ...state, board, moves, line, last: cell, turn: other(player),
        winner: line ? player : moves === COLS * ROWS ? 'draw' : null,
    };
}

function status(state) {
    const over = state.winner !== null;
    let summary = `${state.marks[state.turn]} to drop`;
    if (state.winner === 'draw') summary = 'Board full';
    else if (over) summary = `${state.marks[state.winner]} connected four`;
    return { over, winner: state.winner, turn: over ? null : state.turn, summary };
}

export default {
    id: 'connect4', name: 'Connect 4', emoji: '🔴', blurb: 'Drop discs, line up four.',
    players: 2, simultaneous: false, init, validMove, apply, status,
};
