// Registry of the games two strangers can play over the chat data channel.
// Each module default-exports a definition (see engine.js for how they are driven):
//   { id, name, emoji, blurb, players: 2, simultaneous, init, validMove, apply | applyRound, status, timeLimitMs? }

import ticTacToe from './tictactoe.js';
import rps from './rps.js';
import connect4 from './connect4.js';
import handCricket from './handcricket.js';
import wordChain from './wordchain.js';

/** Display order of the game picker. */
export const GAMES = Object.freeze([ticTacToe, rps, connect4, handCricket, wordChain]);

/** id -> definition. No prototype, so ids like "constructor" are never found. */
export const byId = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(GAMES.map(g => [g.id, g]))));
