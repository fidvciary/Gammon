/**
 * Fathom — the built-in engine. A TD(λ) self-play neural network (net.js,
 * weights trained by scripts/train.js) over the fast movegen in board.js,
 * searching 2 plies deep for its own moves.
 *
 * Besides playing, it powers the analysis UI: `evaluate` for the eval bar,
 * `analyzeRolls` for the 21-roll table and the luck meter, `hint` for humans.
 * All equities are cubeless, in points, from White's side unless stated.
 */

import { WHITE, legalPlays, applyMove } from '../game.js';
import { notateMoves } from '../notation.js';
import { ALL_ROLLS, OPENING_ROLLS, fromState, flip, allPlays } from './board.js';
import { forward, makeScratch, equityOf } from './net.js';
import WEIGHTS from './weights.js';
import { loadNet } from './net.js';
import { registerEngine } from '../engine.js';

const net = loadNet(WEIGHTS);
const scratch = makeScratch(net.hidden);

/**
 * Equity for `player` of a position given from `player`'s side, with
 * `toRoll` (+1/−1 relative to player: +1 = player rolls next).
 */
function evalRel(pos, player, toRoll) {
  const whitePos = player === WHITE ? pos : flip(pos);
  const y = forward(net, whitePos, player * toRoll, scratch);
  return player * equityOf(y);
}

/**
 * Best single afterstate for a roll, 1-ply, for `player` whose side `pos`
 * shows. A dance keeps the position and hands the dice over.
 */
function bestAfter(pos, player, d1, d2) {
  const plays = allPlays(pos, d1, d2);
  if (!plays.length) {
    return { after: pos, moves: [], eq: evalRel(pos, player, -1) };
  }
  let best = null;
  let bestEq = -Infinity;
  for (const play of plays) {
    const eq = evalRel(play.after, player, -1);
    if (eq > bestEq) {
      bestEq = eq;
      best = play;
    }
  }
  return { after: best.after, moves: best.moves, eq: bestEq };
}

/**
 * 2-ply value of an afterstate (mover's view, opponent to roll): the dice
 * average of the opponent's best 1-ply reply.
 */
function twoPlyValue(after, player) {
  const oppView = flip(after);
  let sum = 0;
  for (const { dice, weight } of ALL_ROLLS) {
    const reply = bestAfter(oppView, -player, dice[0], dice[1]);
    sum += weight * -reply.eq;
  }
  return sum / 36;
}

/* ------------------------------------------------------------------ *
 * Public engine surface
 * ------------------------------------------------------------------ */

/** Equity for White of the live position (any phase). */
export function evaluate(state) {
  if (state.phase === 'over') {
    return state.result.points * state.winner;
  }
  const turn = state.turn || WHITE;
  const whitePos = fromState(state, WHITE);
  return equityOf(forward(net, whitePos, turn, scratch));
}

/**
 * Rank every roll the player on turn could throw from the current position:
 * the table behind the rolls panel and the luck meter.
 *
 * Returns { rolls, mean, median } where rolls[i] = { dice, weight, eq, rank,
 * notation, delta } sorted best-first, `mean` is the probability-weighted
 * average equity (the luck baseline, so luck averages exactly zero), and
 * `median` is the weighted-median-ranked roll (the panel's Δ baseline).
 */
export function analyzeRolls(state, { opening = false } = {}) {
  const player = state.turn || WHITE;
  const pos = fromState(state, player);
  const table = opening ? OPENING_ROLLS : ALL_ROLLS;
  const totalWeight = opening ? 30 : 36;

  const rolls = table.map(({ dice, weight }) => {
    const { moves, eq } = bestAfter(pos, player, dice[0], dice[1]);
    return {
      dice,
      weight,
      eq, // for the player on turn
      notation: moves.length ? notateMoves(moves) : 'no play',
    };
  });

  rolls.sort((a, b) => b.eq - a.eq);
  let mean = 0;
  for (const r of rolls) mean += r.weight * r.eq;
  mean /= totalWeight;

  let median = rolls[0];
  let cum = 0;
  for (const r of rolls) {
    cum += r.weight;
    if (cum * 2 >= totalWeight) {
      median = r;
      break;
    }
  }
  rolls.forEach((r, i) => {
    r.rank = i + 1;
    r.delta = r.eq - median.eq;
  });

  return { rolls, mean, median, player, opening };
}

/** The luck of throwing `roll` given an analyzeRolls result. */
export function luckOf(analysis, roll) {
  const hi = Math.max(roll[0], roll[1]);
  const lo = Math.min(roll[0], roll[1]);
  const entry = analysis.rolls.find((r) => r.dice[0] === hi && r.dice[1] === lo);
  return entry ? { luck: entry.eq - analysis.mean, entry } : null;
}

/** How many 1-ply survivors get the full 2-ply treatment. */
const CANDIDATES = 6;

/**
 * Order plays best-first for the player on turn. Every play is scored at
 * 1 ply; the leading few are then settled at 2 ply, which is what decides
 * the winner when 2-ply is asked for.
 */
function rankPlays(state, plays, ply) {
  const player = state.turn;
  const scored = plays.map((moves) => {
    let s = state;
    for (const m of moves) s = applyMove(s, m);
    const after = fromState(s, player);
    return { moves, after, eq: evalRel(after, player, -1), value: null };
  });
  scored.sort((a, b) => b.eq - a.eq);
  if (ply < 2) return scored;

  const top = scored.slice(0, CANDIDATES);
  for (const cand of top) cand.value = twoPlyValue(cand.after, player);
  top.sort((a, b) => b.value - a.value);
  return top.concat(scored.slice(CANDIDATES));
}

/**
 * Choose among game.js plays (full turns or the rest of a part-played turn).
 */
export function choosePlay(state, plays, { ply = 2 } = {}) {
  if (!plays.length) return plays;
  if (plays.length === 1) return plays[0];
  return rankPlays(state, plays, ply)[0].moves;
}

/**
 * The best way to play what is left of the current roll, or null when there
 * is nothing to play. `equity` is for the player on turn, and `runnerUp` is
 * what the second-best play would cost — the price of going your own way.
 */
export function bestPlay(state, { ply = 2 } = {}) {
  if (state.phase !== 'move') return null;
  const plays = legalPlays(state);
  if (!plays.length || (plays.length === 1 && !plays[0].length)) return null;

  const ranked = rankPlays(state, plays, ply);
  const best = ranked[0];
  const second = ranked[1];
  const scoreOf = (c) => (c && c.value !== null ? c.value : c ? c.eq : null);
  const bestScore = scoreOf(best);
  const nextScore = scoreOf(second);

  return {
    moves: best.moves,
    notation: notateMoves(best.moves),
    equity: bestScore,
    margin: nextScore === null ? null : bestScore - nextScore,
    choices: plays.length,
  };
}

export const engine = registerEngine({
  name: 'Fathom',
  description: 'TD(λ) self-play neural net, 2-ply',
  choosePlay: (state, plays) => choosePlay(state, plays),
});
