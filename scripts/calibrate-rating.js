/**
 * Calibrate the skill-rating scale.
 *
 *   node scripts/calibrate-rating.js --games 250
 *
 * Plays the engine against itself — equal skill on both sides — and measures
 * the luck-adjusted edge of each game:
 *
 *   edge = result(White) − (White's luck − Black's luck)
 *
 * With both sides equally strong the true skill difference is zero, so the
 * spread of `edge` is pure noise: how much of a game's outcome the luck
 * metric fails to explain. That standard deviation is the natural unit for
 * the 0..1 rating — one SD of edge is one unit of "outplayed the dice".
 *
 * It also checks the bookkeeping: the mean edge must sit on zero, otherwise
 * the luck signs are inconsistent with the result signs somewhere.
 */

import {
  WHITE,
  BLACK,
  newGame,
  rollOpening,
  roll,
  legalPlays,
  applyMove,
  endTurn,
} from '../src/game.js';
import { analyzeRolls, luckOf, choosePlay } from '../src/engine/fathom.js';
import { xorshift } from './td.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1];
}
const GAMES = Number(args.games || 250);
const PLY = Number(args.ply || 1);
const rng = xorshift(Number(args.seed || 20260802));

/** One self-play game, returning its result and each side's luck. */
function playGame() {
  let state = newGame();
  const luck = { [WHITE]: 0, [BLACK]: 0 };

  // Opening. The starting position is symmetric, so the roll analysis is the
  // same whichever side ends up playing it.
  let guard = 0;
  while (state.phase === 'opening' && guard < 50) {
    const analysis = analyzeRolls(state, { opening: true });
    state = rollOpening(state, rng);
    if (state.phase === 'move') {
      luck[state.turn] += luckOf(analysis, state.roll).luck;
    }
    guard += 1;
  }

  for (let turn = 0; turn < 600 && state.phase !== 'over'; turn += 1) {
    if (state.phase === 'roll') {
      const analysis = analyzeRolls(state);
      state = roll(state, rng);
      luck[state.turn] += luckOf(analysis, state.roll).luck;
    }
    const plays = legalPlays(state);
    const choice = choosePlay(state, plays, { ply: PLY });
    if (Array.isArray(choice)) {
      for (const move of choice) state = applyMove(state, move);
    }
    state = endTurn(state);
  }

  if (state.phase !== 'over') return null;
  const result = state.result.points * state.winner; // signed, White's side
  return {
    result,
    whiteLuck: luck[WHITE],
    blackLuck: luck[BLACK],
    edge: result - (luck[WHITE] - luck[BLACK]),
    turns: state.history.length,
  };
}

const edges = [];
const results = [];
const luckSwing = [];
const t0 = Date.now();

for (let g = 0; g < GAMES; g += 1) {
  const game = playGame();
  if (!game) continue;
  edges.push(game.edge);
  results.push(game.result);
  luckSwing.push(game.whiteLuck - game.blackLuck);
  if ((g + 1) % 25 === 0) {
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`  ${g + 1}/${GAMES} games (${secs}s)\n`);
  }
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
/** How much of the result's variance the luck metric accounts for. */
const correlation = (xs, ys) => {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
};

const edgeMean = mean(edges);
const edgeSd = sd(edges);
const stderr = edgeSd / Math.sqrt(edges.length);

console.log(`
games                 ${edges.length}   (${((Date.now() - t0) / 1000).toFixed(0)}s, ${PLY}-ply play)
result   mean ${mean(results).toFixed(3)}   sd ${sd(results).toFixed(3)}
luck swing mean ${mean(luckSwing).toFixed(3)}   sd ${sd(luckSwing).toFixed(3)}
edge     mean ${edgeMean.toFixed(3)}   sd ${edgeSd.toFixed(3)}   stderr ${stderr.toFixed(3)}
  mean/stderr = ${(edgeMean / stderr).toFixed(2)}  (should sit near 0 for equal players)
corr(result, luck swing) = ${correlation(results, luckSwing).toFixed(3)}
variance of the result explained by luck = ${(correlation(results, luckSwing) ** 2 * 100).toFixed(0)}%

=> suggested EDGE_SD = ${edgeSd.toFixed(2)}
`);
