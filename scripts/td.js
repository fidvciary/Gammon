/**
 * Self-play TD(λ) training core and match play, shared by the trainer,
 * the benchmark CLI, and tests. Node-only; the browser never loads this.
 */

import {
  allPlays,
  flip,
  startPos,
  isRace,
  winPoints,
} from '../src/engine/board.js';
import { pubeval } from '../src/engine/pubeval.js';
import {
  N_INPUTS,
  N_OUTPUTS,
  forward,
  makeScratch,
  equityOf,
} from '../src/engine/net.js';

export function xorshift(seed) {
  let x = seed >>> 0 || 88675123;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

const die = (rng) => 1 + Math.floor(rng() * 6);

/** White-view of a mover-relative position. */
const whiteView = (pos, mover) => (mover === 1 ? pos : flip(pos));

/**
 * The net's 1-ply move choice: maximize the mover's equity of the afterstate,
 * evaluated with the opponent on roll. Returns null on a dance.
 */
export function netPick(net, pos, mover, d1, d2, scratch) {
  const plays = allPlays(pos, d1, d2);
  if (!plays.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const play of plays) {
    const y = forward(net, whiteView(play.after, mover), -mover, scratch);
    const score = mover * equityOf(y);
    if (score > bestScore) {
      bestScore = score;
      best = play;
    }
  }
  return best;
}

/** Tesauro's benchmark player: highest pubeval score wins. */
export function pubevalPick(pos, d1, d2) {
  const race = isRace(pos) ? 1 : 0;
  const plays = allPlays(pos, d1, d2);
  if (!plays.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const play of plays) {
    const score = pubeval(race, play.after);
    if (score > bestScore) {
      bestScore = score;
      best = play;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * TD(λ) trainer
 * ------------------------------------------------------------------ */

export function makeTrainer(net) {
  const H = net.hidden;
  return {
    net,
    scratch: makeScratch(H),
    pick: makeScratch(H),
    yPrev: new Float64Array(N_OUTPUTS),
    // One eligibility trace per output unit over every weight.
    eW1: Array.from({ length: N_OUTPUTS }, () => new Float64Array(N_INPUTS * H)),
    eB1: Array.from({ length: N_OUTPUTS }, () => new Float64Array(H)),
    eW2: Array.from({ length: N_OUTPUTS }, () => new Float64Array(H * N_OUTPUTS)),
    eB2: new Float64Array(N_OUTPUTS),
  };
}

function resetTraces(tr) {
  for (let k = 0; k < N_OUTPUTS; k += 1) {
    tr.eW1[k].fill(0);
    tr.eB1[k].fill(0);
    tr.eW2[k].fill(0);
  }
  tr.eB2.fill(0);
}

/** e ← λ·e + ∇y  for every output, using the caches left by forward(). */
function accumulateTraces(tr, lambda) {
  const { net, scratch } = tr;
  const H = net.hidden;
  const { idx, val, nActive, h, y } = scratch;
  for (let k = 0; k < N_OUTPUTS; k += 1) {
    const gk = y[k] * (1 - y[k]);
    const eW1 = tr.eW1[k];
    const eB1 = tr.eB1[k];
    const eW2 = tr.eW2[k];
    if (lambda !== 1) {
      for (let i = 0; i < eW1.length; i += 1) eW1[i] *= lambda;
      for (let j = 0; j < H; j += 1) {
        eB1[j] *= lambda;
      }
      for (let i = 0; i < eW2.length; i += 1) eW2[i] *= lambda;
    }
    tr.eB2[k] = tr.eB2[k] * lambda + gk;
    for (let j = 0; j < H; j += 1) {
      const hj = h[j];
      eW2[j * N_OUTPUTS + k] += gk * hj;
      const back = gk * net.w2[j * N_OUTPUTS + k] * hj * (1 - hj);
      if (back === 0) continue;
      eB1[j] += back;
      for (let a = 0; a < nActive; a += 1) {
        eW1[idx[a] * H + j] += back * val[a];
      }
    }
  }
}

/** w ← w + α·Σ_k δ_k·e_k */
function applyDelta(tr, delta, alpha) {
  const { net } = tr;
  for (let k = 0; k < N_OUTPUTS; k += 1) {
    const step = alpha * delta[k];
    if (step === 0) continue;
    const eW1 = tr.eW1[k];
    const eB1 = tr.eB1[k];
    const eW2 = tr.eW2[k];
    for (let i = 0; i < eW1.length; i += 1) net.w1[i] += step * eW1[i];
    for (let j = 0; j < eB1.length; j += 1) net.b1[j] += step * eB1[j];
    for (let i = 0; i < eW2.length; i += 1) net.w2[i] += step * eW2[i];
    net.b2[k] += step * tr.eB2[k];
  }
}

const delta = new Float64Array(N_OUTPUTS);
const zTerm = new Float64Array(N_OUTPUTS);

/**
 * One self-play game with online TD(λ) updates. Returns plies played, or -1
 * if the game hit the safety cap and was abandoned.
 */
export function selfPlayGame(tr, { alpha, lambda, rng, startMover = 1 }) {
  const { net } = tr;
  let pos = startPos();
  let mover = startMover;

  // Opening throw: a random non-double, winner already folded into startMover.
  let d1 = die(rng);
  let d2 = die(rng);
  while (d1 === d2) {
    d1 = die(rng);
    d2 = die(rng);
  }

  resetTraces(tr);
  forward(net, whiteView(pos, mover), mover, tr.scratch);
  tr.yPrev.set(tr.scratch.y);
  accumulateTraces(tr, 0); // e = ∇y_0

  for (let ply = 0; ply < 500; ply += 1) {
    const play = netPick(net, pos, mover, d1, d2, tr.pick);

    if (play && play.after[26] === 15) {
      // The mover has borne off the last checker: terminal update.
      const points = winPoints(play.after);
      zTerm.fill(0);
      if (mover === 1) {
        zTerm[0] = 1;
        zTerm[1] = points >= 2 ? 1 : 0;
        zTerm[2] = points === 3 ? 1 : 0;
      } else {
        zTerm[3] = points >= 2 ? 1 : 0;
        zTerm[4] = points === 3 ? 1 : 0;
      }
      for (let k = 0; k < N_OUTPUTS; k += 1) delta[k] = zTerm[k] - tr.yPrev[k];
      applyDelta(tr, delta, alpha);
      return ply + 1;
    }

    pos = play ? flip(play.after) : flip(pos);
    mover = -mover;

    const y = forward(net, whiteView(pos, mover), mover, tr.scratch);
    for (let k = 0; k < N_OUTPUTS; k += 1) delta[k] = y[k] - tr.yPrev[k];
    applyDelta(tr, delta, alpha);
    tr.yPrev.set(y);
    accumulateTraces(tr, lambda);

    d1 = die(rng);
    d2 = die(rng);
  }
  return -1;
}

/* ------------------------------------------------------------------ *
 * Matches
 * ------------------------------------------------------------------ */

/**
 * A cubeless money session: the net (1-ply) against pubeval, alternating who
 * moves first. Returns points and wins from the net's side.
 */
export function netVsPubeval(net, games, rng) {
  const scratch = makeScratch(net.hidden);
  let netPoints = 0;
  let oppPoints = 0;
  let netWins = 0;
  let decided = 0;

  for (let g = 0; g < games; g += 1) {
    // +1: the net moves first this game.
    const netMover = g % 2 === 0 ? 1 : -1;
    let pos = startPos();
    let mover = 1;
    let d1 = die(rng);
    let d2 = die(rng);
    while (d1 === d2) {
      d1 = die(rng);
      d2 = die(rng);
    }

    for (let ply = 0; ply < 2000; ply += 1) {
      const play =
        mover === netMover
          ? netPick(net, pos, mover, d1, d2, scratch)
          : pubevalPick(pos, d1, d2);

      if (play && play.after[26] === 15) {
        const points = winPoints(play.after);
        decided += 1;
        if (mover === netMover) {
          netPoints += points;
          netWins += 1;
        } else {
          oppPoints += points;
        }
        break;
      }
      pos = play ? flip(play.after) : flip(pos);
      mover = -mover;
      d1 = die(rng);
      d2 = die(rng);
    }
  }

  return {
    games: decided,
    netWins,
    winRate: netWins / decided,
    netPoints,
    oppPoints,
    ppg: (netPoints - oppPoints) / decided,
  };
}
