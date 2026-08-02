/**
 * Backgammon rules engine.
 *
 * Pure, DOM-free, and side-effect free: every exported mutator takes a state
 * and returns a new state. This module knows the rules of backgammon and
 * nothing else — no AI, no rendering, no storage.
 *
 * Coordinates
 * -----------
 * The board is stored in *absolute* points 1..24 as a signed array:
 * positive counts are White checkers, negative are Black. White always moves
 * toward point 1, Black toward point 24.
 *
 * Rules are expressed in *relative* points instead, which is how players
 * actually talk ("three on my 8-point"). For both players a relative point
 * counts down 24 -> 1 in the direction they move, home board is 1..6, the bar
 * is 25 and borne off is 0.
 *
 *     absolute = player === WHITE ? relative : 25 - relative
 */

export const WHITE = 1;
export const BLACK = -1;

/** Pseudo-points used as move endpoints. */
export const BAR = 25;
export const OFF = 0;

export const CHECKERS_PER_SIDE = 15;

export function opponent(player) {
  return -player;
}

export function toAbs(player, rel) {
  return player === WHITE ? rel : 25 - rel;
}

export function toRel(player, abs) {
  return player === WHITE ? abs : 25 - abs;
}

export function playerName(player) {
  return player === WHITE ? 'White' : 'Black';
}

/* ------------------------------------------------------------------ *
 * Positions
 * ------------------------------------------------------------------ */

function emptyBoard() {
  return new Array(25).fill(0); // index 0 unused
}

function clonePos(pos) {
  return {
    board: pos.board.slice(),
    bar: { ...pos.bar },
    off: { ...pos.off },
  };
}

/** The standard opening setup, mirrored for both sides. */
export function initialPosition() {
  const board = emptyBoard();
  // White: 2 on the 24-point, 5 on the 13, 3 on the 8, 5 on the 6.
  board[24] = 2;
  board[13] = 5;
  board[8] = 3;
  board[6] = 5;
  // Black, mirrored.
  board[1] = -2;
  board[12] = -5;
  board[17] = -3;
  board[19] = -5;
  return { board, bar: { 1: 0, '-1': 0 }, off: { 1: 0, '-1': 0 } };
}

/**
 * Build a position from relative-point maps, e.g.
 *   setupPosition({ white: { 6: 2, 3: 1 }, black: { 24: 2 }, whiteBar: 1 })
 * Anything not placed is assumed borne off, so the counts always add to 15.
 */
export function setupPosition({
  white = {},
  black = {},
  whiteBar = 0,
  blackBar = 0,
} = {}) {
  const board = emptyBoard();
  let placed = { 1: whiteBar, '-1': blackBar };
  for (const [player, points] of [
    [WHITE, white],
    [BLACK, black],
  ]) {
    for (const [rel, count] of Object.entries(points)) {
      board[toAbs(player, Number(rel))] += player * count;
      placed[player] += count;
    }
  }
  return {
    board,
    bar: { 1: whiteBar, '-1': blackBar },
    off: {
      1: CHECKERS_PER_SIDE - placed[WHITE],
      '-1': CHECKERS_PER_SIDE - placed[BLACK],
    },
  };
}

/** How many checkers `player` has on a relative point (or the bar). */
export function countAt(pos, player, rel) {
  if (rel === BAR) return pos.bar[player];
  if (rel === OFF) return pos.off[player];
  const v = pos.board[toAbs(player, rel)];
  return player === WHITE ? Math.max(0, v) : Math.max(0, -v);
}

/** How many *opposing* checkers sit on a relative point. */
function enemyAt(pos, player, rel) {
  const v = pos.board[toAbs(player, rel)];
  return player === WHITE ? Math.max(0, -v) : Math.max(0, v);
}

/** True once every checker is home (points 1..6) and none are on the bar. */
export function allHome(pos, player) {
  if (pos.bar[player] > 0) return false;
  for (let rel = 7; rel <= 24; rel += 1) {
    if (countAt(pos, player, rel) > 0) return false;
  }
  return true;
}

/** The furthest-back point `player` still occupies, or 0 if none. */
function highestPoint(pos, player) {
  for (let rel = 24; rel >= 1; rel -= 1) {
    if (countAt(pos, player, rel) > 0) return rel;
  }
  return 0;
}

export function pipCount(pos, player) {
  let pips = pos.bar[player] * 25;
  for (let rel = 1; rel <= 24; rel += 1) {
    pips += countAt(pos, player, rel) * rel;
  }
  return pips;
}

/* ------------------------------------------------------------------ *
 * Single moves
 * ------------------------------------------------------------------ */

function makeMove(from, to, die, hit) {
  return { from, to, die, hit };
}

export function moveKey(move) {
  return `${move.from}/${move.to}:${move.die}`;
}

/**
 * Every move `player` could make with one die, ignoring whether it leaves the
 * rest of the roll playable. `legalMoves` layers that requirement on top.
 */
export function movesForDie(pos, player, die) {
  const moves = [];

  // Checkers on the bar must come in before anything else moves.
  if (pos.bar[player] > 0) {
    const to = 25 - die;
    const blockers = enemyAt(pos, player, to);
    if (blockers <= 1) moves.push(makeMove(BAR, to, die, blockers === 1));
    return moves;
  }

  const bearingOff = allHome(pos, player);
  const back = highestPoint(pos, player);

  for (let from = 24; from >= 1; from -= 1) {
    if (countAt(pos, player, from) === 0) continue;
    const to = from - die;
    if (to >= 1) {
      const blockers = enemyAt(pos, player, to);
      if (blockers <= 1) moves.push(makeMove(from, to, die, blockers === 1));
    } else if (bearingOff) {
      // An exact roll always bears off. A larger roll only bears off from the
      // furthest-back point, i.e. when nothing is left behind it.
      if (to === 0 || from === back) moves.push(makeMove(from, OFF, die, false));
    }
  }
  return moves;
}

function applyMoveTo(pos, player, move) {
  if (move.from === BAR) pos.bar[player] -= 1;
  else pos.board[toAbs(player, move.from)] -= player;

  if (move.to === OFF) {
    pos.off[player] += 1;
    return;
  }
  const abs = toAbs(player, move.to);
  if (pos.board[abs] === -player) {
    // Lone enemy checker: send it to the bar.
    pos.board[abs] = 0;
    pos.bar[-player] += 1;
  }
  pos.board[abs] += player;
}

function positionKey(pos, player) {
  return `${pos.board.join(',')}|${pos.bar[1]}|${pos.bar[-1]}|${player}`;
}

function removeAt(list, index) {
  return list.filter((_, i) => i !== index);
}

function uniqueDice(dice) {
  return [...new Set(dice)];
}

/**
 * The largest number of dice `player` can legally use from this position.
 * This is what enforces "play both dice if you can" — a move is only offered
 * if it keeps this number at its maximum.
 */
export function maxDiceUsable(pos, player, dice, memo = new Map()) {
  if (dice.length === 0) return 0;
  const key = `${positionKey(pos, player)}#${[...dice].sort().join('')}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let best = 0;
  const tried = new Set();
  for (let i = 0; i < dice.length; i += 1) {
    const die = dice[i];
    if (tried.has(die)) continue;
    tried.add(die);
    const rest = removeAt(dice, i);
    for (const move of movesForDie(pos, player, die)) {
      const next = clonePos(pos);
      applyMoveTo(next, player, move);
      const used = 1 + maxDiceUsable(next, player, rest, memo);
      if (used > best) best = used;
      if (best === dice.length) {
        memo.set(key, best);
        return best;
      }
    }
  }
  memo.set(key, best);
  return best;
}

/* ------------------------------------------------------------------ *
 * Dice
 * ------------------------------------------------------------------ */

export function rollDie(rng = Math.random) {
  return 1 + Math.floor(rng() * 6);
}

export function rollDice(rng = Math.random) {
  return [rollDie(rng), rollDie(rng)];
}

/** Doubles are played four times. */
export function diceFromRoll(roll) {
  const [a, b] = roll;
  return a === b ? [a, a, a, a] : [a, b];
}

/** Dice from the current roll that have not been spent yet. */
export function diceRemaining(state) {
  if (!state.roll) return [];
  const left = diceFromRoll(state.roll);
  for (const move of state.played) {
    const i = left.indexOf(move.die);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

/* ------------------------------------------------------------------ *
 * Game state
 * ------------------------------------------------------------------ */

/**
 * phase:
 *   'opening' — nobody has moved; both sides roll one die to decide who starts
 *   'roll'    — it is `turn`'s move but the dice have not been thrown
 *   'move'    — dice are on the table, `turn` is moving
 *   'over'    — somebody has borne off fifteen checkers
 */
export function newGame() {
  const pos = initialPosition();
  return {
    ...pos,
    turn: null,
    phase: 'opening',
    roll: null,
    openingRoll: null,
    played: [],
    playLength: 0,
    mustUseDie: null,
    turnStart: null,
    history: [],
    winner: null,
    result: null,
  };
}

export function cloneState(state) {
  return {
    ...state,
    ...clonePos(state),
    played: state.played.slice(),
  };
}

function restore(state, snapshot) {
  state.board = snapshot.board.slice();
  state.bar = { ...snapshot.bar };
  state.off = { ...snapshot.off };
}

/**
 * Put the dice on the table for whoever is on turn and work out how much of
 * the roll has to be played.
 */
export function startTurn(state, roll) {
  const s = cloneState(state);
  s.roll = roll;
  s.played = [];
  s.turnStart = clonePos(s);
  s.phase = 'move';

  const dice = diceFromRoll(roll);
  s.playLength = maxDiceUsable(s, s.turn, dice);
  s.mustUseDie = null;

  // "If only one die can be played, it must be the higher one."
  if (s.playLength === 1 && roll[0] !== roll[1]) {
    const higher = Math.max(roll[0], roll[1]);
    if (maxDiceUsable(s, s.turn, [higher]) === 1) s.mustUseDie = higher;
  }
  return s;
}

export function roll(state, rng = Math.random) {
  if (state.phase !== 'roll') return state;
  return startTurn(state, rollDice(rng));
}

/**
 * Decide who moves first. Each side throws one die; the higher throw plays,
 * using both dice. A tie is thrown again.
 */
export function rollOpening(state, rng = Math.random) {
  const white = rollDie(rng);
  const black = rollDie(rng);
  const s = cloneState(state);
  s.openingRoll = { 1: white, '-1': black };
  if (white === black) return s; // tie — roll again
  s.turn = white > black ? WHITE : BLACK;
  return startTurn(s, [white, black]);
}

/**
 * The moves that may be made right now: every single-die move that still
 * leaves the required number of dice playable.
 */
export function legalMoves(state) {
  if (state.phase !== 'move') return [];
  const needed = state.playLength - state.played.length;
  if (needed <= 0) return [];

  const remaining = diceRemaining(state);
  const memo = new Map();
  const moves = [];
  const tried = new Set();

  for (let i = 0; i < remaining.length; i += 1) {
    const die = remaining[i];
    if (tried.has(die)) continue;
    tried.add(die);
    if (state.mustUseDie && die !== state.mustUseDie) continue;
    const rest = removeAt(remaining, i);
    for (const move of movesForDie(state, state.turn, die)) {
      const next = clonePos(state);
      applyMoveTo(next, state.turn, move);
      if (1 + maxDiceUsable(next, state.turn, rest, memo) >= needed) {
        moves.push(move);
      }
    }
  }
  return moves;
}

export function isLegalMove(state, move) {
  return legalMoves(state).some(
    (m) => m.from === move.from && m.to === move.to && m.die === move.die,
  );
}

export function applyMove(state, move) {
  if (!isLegalMove(state, move)) throw new Error(`illegal move ${moveKey(move)}`);
  const s = cloneState(state);
  applyMoveTo(s, s.turn, move);
  s.played = [...s.played, move];
  return s;
}

/** Take back the last checker moved this turn. */
export function undoMove(state) {
  if (!state.played.length) return state;
  const s = cloneState(state);
  restore(s, s.turnStart);
  const replay = s.played.slice(0, -1);
  s.played = [];
  for (const move of replay) {
    applyMoveTo(s, s.turn, move);
    s.played.push(move);
  }
  return s;
}

/** Take back every checker moved this turn. */
export function undoTurn(state) {
  if (!state.played.length) return state;
  const s = cloneState(state);
  restore(s, s.turnStart);
  s.played = [];
  return s;
}

/** True when the roll has been played out (or could not be played at all). */
export function canEndTurn(state) {
  return state.phase === 'move' && state.played.length >= state.playLength;
}

function gameResult(state, winner) {
  const loser = opponent(winner);
  if (state.off[loser] > 0) return { winner, type: 'single', points: 1 };

  // Backgammon: the loser is shut out entirely — still on the bar, or with a
  // checker stuck in the winner's home board.
  const stranded =
    state.bar[loser] > 0 ||
    [1, 2, 3, 4, 5, 6].some((rel) => countAt(state, loser, 25 - rel) > 0);
  return stranded
    ? { winner, type: 'backgammon', points: 3 }
    : { winner, type: 'gammon', points: 2 };
}

/** Commit the turn to the history and hand over to the other player. */
export function endTurn(state) {
  if (!canEndTurn(state)) return state;
  const s = cloneState(state);
  s.history = [
    ...s.history,
    {
      index: s.history.length + 1,
      player: s.turn,
      roll: s.roll,
      moves: s.played.slice(),
      pips: { 1: pipCount(s, WHITE), '-1': pipCount(s, BLACK) },
    },
  ];

  if (s.off[s.turn] === CHECKERS_PER_SIDE) {
    s.winner = s.turn;
    s.result = gameResult(s, s.turn);
    s.phase = 'over';
  } else {
    s.turn = opponent(s.turn);
    s.phase = 'roll';
  }

  s.roll = null;
  s.played = [];
  s.playLength = 0;
  s.mustUseDie = null;
  s.turnStart = null;
  return s;
}

/* ------------------------------------------------------------------ *
 * Whole-turn plays (for engines and tests)
 * ------------------------------------------------------------------ */

/**
 * Every distinct legal way to play the current roll in full, each one a list
 * of moves. Sequences that shuffle the same moves into a different order are
 * collapsed. An empty list of moves means the roll cannot be played at all.
 */
export function legalPlays(state) {
  const plays = [];
  const seen = new Set();

  const walk = (s) => {
    const moves = legalMoves(s);
    if (!moves.length) {
      const key = `${positionKey(s, s.turn)}#${s.played
        .map(moveKey)
        .sort()
        .join(' ')}`;
      if (!seen.has(key)) {
        seen.add(key);
        plays.push(s.played.slice());
      }
      return;
    }
    for (const move of moves) walk(applyMove(s, move));
  };

  walk(state);
  return plays;
}
