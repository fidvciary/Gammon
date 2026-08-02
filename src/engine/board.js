/**
 * Fast board representation for the engine and trainer.
 *
 * A position is an Int8Array(28) seen from the MOVER's side, laid out exactly
 * like Tesauro's pubeval `pos[]` so that evaluator can read it directly:
 *
 *   [0]      opponent checkers on the bar, as a NEGATIVE count
 *   [1..24]  relative points, mover positive / opponent negative;
 *            the mover travels 24 -> 1, the opponent 1 -> 24
 *   [25]     mover checkers on the bar (positive)
 *   [26]     mover checkers borne off (positive)
 *   [27]     opponent checkers borne off, as a NEGATIVE count
 *
 * This mirrors game.js's relative coordinates (bar = 25, off = 0), so the
 * moves produced here are directly usable as game.js move objects.
 */

export const POS_SIZE = 28;

/** The 21 distinct rolls with their weights out of 36. */
export const ALL_ROLLS = [];
for (let a = 1; a <= 6; a += 1) {
  for (let b = a; b <= 6; b += 1) {
    ALL_ROLLS.push({ dice: [b, a], weight: a === b ? 1 : 2 });
  }
}

/** The 15 rolls the opening throw can produce (doubles are re-thrown). */
export const OPENING_ROLLS = ALL_ROLLS.filter(({ dice }) => dice[0] !== dice[1]);

/** Fast-position from a game.js state, seen from `player`. */
export function fromState(state, player) {
  const pos = new Int8Array(POS_SIZE);
  for (let rel = 1; rel <= 24; rel += 1) {
    const abs = player === 1 ? rel : 25 - rel;
    pos[rel] = player * state.board[abs];
  }
  pos[25] = state.bar[player];
  pos[0] = -state.bar[-player];
  pos[26] = state.off[player];
  pos[27] = -state.off[-player];
  return pos;
}

/** Swap perspective: the opponent becomes the mover. */
export function flip(pos) {
  const out = new Int8Array(POS_SIZE);
  for (let i = 1; i <= 24; i += 1) out[i] = -pos[25 - i];
  out[25] = -pos[0];
  out[0] = -pos[25];
  out[26] = -pos[27];
  out[27] = -pos[26];
  return out;
}

export function posKey(pos) {
  let key = '';
  for (let i = 0; i < POS_SIZE; i += 1) key += pos[i] + ',';
  return key;
}

/** True when the sides can no longer hit each other (a pure race). */
export function isRace(pos) {
  if (pos[25] > 0 || pos[0] < 0) return false;
  let myBack = 0;
  for (let i = 24; i >= 1; i -= 1) {
    if (pos[i] > 0) {
      myBack = i;
      break;
    }
  }
  for (let i = 1; i <= myBack; i += 1) {
    if (pos[i] < 0) return false;
  }
  return true;
}

export function pipCountFast(pos) {
  let pips = pos[25] * 25;
  for (let i = 1; i <= 24; i += 1) {
    if (pos[i] > 0) pips += pos[i] * i;
  }
  return pips;
}

/** The mover has won; how many points is it worth? */
export function winPoints(pos) {
  if (-pos[27] > 0) return 1;
  let stranded = -pos[0] > 0;
  for (let i = 19; i <= 24 && !stranded; i += 1) {
    if (pos[i] < 0) stranded = true;
  }
  return stranded ? 3 : 2;
}

function allHomeFast(pos) {
  if (pos[25] > 0) return false;
  for (let i = 7; i <= 24; i += 1) {
    if (pos[i] > 0) return false;
  }
  return true;
}

function highestFast(pos) {
  for (let i = 24; i >= 1; i -= 1) {
    if (pos[i] > 0) return i;
  }
  return 0;
}

/**
 * Single-die moves as [from, to] pairs. `to === 0` bears off.
 * Mirrors game.js movesForDie exactly.
 */
function singleMoves(pos, die) {
  const moves = [];
  if (pos[25] > 0) {
    const to = 25 - die;
    if (pos[to] >= -1) moves.push([25, to]);
    return moves;
  }
  const bearingOff = allHomeFast(pos);
  const back = bearingOff ? highestFast(pos) : 0;
  for (let from = 24; from >= 1; from -= 1) {
    if (pos[from] <= 0) continue;
    const to = from - die;
    if (to >= 1) {
      if (pos[to] >= -1) moves.push([from, to]);
    } else if (bearingOff && (to === 0 || from === back)) {
      moves.push([from, 0]);
    }
  }
  return moves;
}

/** Apply one die's move in place. Returns true if it hit a blot. */
function applyFast(pos, from, to) {
  if (from === 25) pos[25] -= 1;
  else pos[from] -= 1;
  if (to === 0) {
    pos[26] += 1;
    return false;
  }
  if (pos[to] === -1) {
    pos[to] = 1;
    pos[0] -= 1;
    return true;
  }
  pos[to] += 1;
  return false;
}

/**
 * Every distinct way to play the roll in full.
 *
 * Returns [{ after, moves }] where `after` is the resulting position (still
 * from the mover's side) and `moves` is one legal ordering of game.js-style
 * move objects that reaches it. Enforces the play-both-dice rule and the
 * higher-die rule. An unplayable roll returns [].
 */
export function allPlays(pos, d1, d2) {
  const results = new Map(); // key -> {after, moves, used}
  let best = 0;

  const walk = (p, dice, seq) => {
    let extended = false;
    if (seq.length < dice.length) {
      const die = dice[seq.length];
      for (const [from, to] of singleMoves(p, die)) {
        const next = p.slice();
        const hit = applyFast(next, from, to);
        walk(next, dice, [...seq, { from, to, die, hit }]);
        extended = true;
      }
    }
    if (!extended && seq.length > 0) {
      if (seq.length > best) best = seq.length;
      const key = posKey(p);
      const prev = results.get(key);
      if (!prev || seq.length > prev.used) {
        results.set(key, { after: p, moves: seq, used: seq.length });
      }
    }
  };

  if (d1 === d2) {
    walk(pos, [d1, d1, d1, d1], []);
  } else {
    const hi = Math.max(d1, d2);
    const lo = Math.min(d1, d2);
    walk(pos, [hi, lo], []);
    walk(pos, [lo, hi], []);
  }

  if (!results.size) return [];

  let plays = [...results.values()].filter((r) => r.used === best);
  // If only one die can be played, it must be the higher one.
  if (best === 1 && d1 !== d2) {
    const hi = Math.max(d1, d2);
    const withHi = plays.filter((r) => r.moves[0].die === hi);
    if (withHi.length) plays = withHi;
  }
  return plays.map(({ after, moves }) => ({ after, moves }));
}

/**
 * The standard opening position from the mover's side.
 */
export function startPos() {
  const pos = new Int8Array(POS_SIZE);
  pos[24] = 2;
  pos[13] = 5;
  pos[8] = 3;
  pos[6] = 5;
  pos[1] = -2;
  pos[12] = -5;
  pos[17] = -3;
  pos[19] = -5;
  return pos;
}
