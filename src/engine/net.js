/**
 * The evaluation network: a TD-Gammon-style multilayer perceptron.
 *
 * Positions are encoded from White's fixed point of view plus a whose-turn
 * flag, so the value function is continuous across turns — no perspective
 * flipping between predictions, which keeps TD(λ) traces simple.
 *
 * Outputs are five sigmoids, all probabilities of WHITE's fate:
 *   [ P(White wins), P(White wins gammon or better), P(White wins backgammon),
 *     P(White loses gammon or better), P(White loses backgammon) ]
 *
 * Cubeless equity for White follows gnubg's convention:
 *   eq = 2·P(win) − 1 + P(wg) + P(wbg) − P(lg) − P(lbg)   ∈ [−3, 3]
 */

/** Input layout: 4 units per point per side, bars, offs, and the turn. */
export const N_INPUTS = 24 * 4 * 2 + 2 + 2 + 2; // = 198
export const N_OUTPUTS = 5;

export function createNet(hidden, rng = Math.random) {
  const net = {
    hidden,
    w1: new Float64Array(N_INPUTS * hidden),
    b1: new Float64Array(hidden),
    w2: new Float64Array(hidden * N_OUTPUTS),
    b2: new Float64Array(N_OUTPUTS),
  };
  for (let i = 0; i < net.w1.length; i += 1) net.w1[i] = (rng() * 2 - 1) * 0.1;
  for (let i = 0; i < net.w2.length; i += 1) net.w2[i] = (rng() * 2 - 1) * 0.1;
  return net;
}

export function loadNet(data) {
  return {
    hidden: data.hidden,
    w1: Float64Array.from(data.w1),
    b1: Float64Array.from(data.b1),
    w2: Float64Array.from(data.w2),
    b2: Float64Array.from(data.b2),
  };
}

export function exportNet(net, digits = 5) {
  const round = (arr) => Array.from(arr, (v) => Number(v.toFixed(digits)));
  return {
    hidden: net.hidden,
    w1: round(net.w1),
    b1: round(net.b1),
    w2: round(net.w2),
    b2: round(net.b2),
  };
}

/**
 * Sparse encoding of a White-view position (board.js layout, White positive).
 * Writes (index, value) pairs; returns how many pairs are active.
 * `turn` is +1 when White is to roll, −1 for Black.
 */
export function encode(whitePos, turn, idx, val) {
  let n = 0;
  for (let p = 1; p <= 24; p += 1) {
    const c = whitePos[p];
    if (c > 0) {
      const base = (p - 1) * 4;
      idx[n] = base;
      val[n] = 1;
      n += 1;
      if (c >= 2) {
        idx[n] = base + 1;
        val[n] = 1;
        n += 1;
      }
      if (c >= 3) {
        idx[n] = base + 2;
        val[n] = 1;
        n += 1;
      }
      if (c >= 4) {
        idx[n] = base + 3;
        val[n] = (c - 3) / 2;
        n += 1;
      }
    } else if (c < 0) {
      const m = -c;
      const base = 96 + (p - 1) * 4;
      idx[n] = base;
      val[n] = 1;
      n += 1;
      if (m >= 2) {
        idx[n] = base + 1;
        val[n] = 1;
        n += 1;
      }
      if (m >= 3) {
        idx[n] = base + 2;
        val[n] = 1;
        n += 1;
      }
      if (m >= 4) {
        idx[n] = base + 3;
        val[n] = (m - 3) / 2;
        n += 1;
      }
    }
  }
  if (whitePos[25] > 0) {
    idx[n] = 192;
    val[n] = whitePos[25] / 2;
    n += 1;
  }
  if (whitePos[0] < 0) {
    idx[n] = 193;
    val[n] = -whitePos[0] / 2;
    n += 1;
  }
  if (whitePos[26] > 0) {
    idx[n] = 194;
    val[n] = whitePos[26] / 15;
    n += 1;
  }
  if (whitePos[27] < 0) {
    idx[n] = 195;
    val[n] = -whitePos[27] / 15;
    n += 1;
  }
  idx[n] = turn === 1 ? 196 : 197;
  val[n] = 1;
  n += 1;
  return n;
}

function sigmoid(s) {
  return 1 / (1 + Math.exp(-s));
}

/**
 * Forward pass. `scratch` (from makeScratch) carries the sparse input and the
 * hidden activations so a trainer can compute gradients afterwards.
 */
export function forward(net, whitePos, turn, scratch) {
  const { idx, val, h, y } = scratch;
  const n = encode(whitePos, turn, idx, val);
  scratch.nActive = n;
  const { hidden, w1, b1, w2, b2 } = net;

  for (let j = 0; j < hidden; j += 1) h[j] = b1[j];
  for (let a = 0; a < n; a += 1) {
    const base = idx[a] * hidden;
    const v = val[a];
    for (let j = 0; j < hidden; j += 1) h[j] += v * w1[base + j];
  }
  for (let j = 0; j < hidden; j += 1) h[j] = sigmoid(h[j]);

  for (let k = 0; k < N_OUTPUTS; k += 1) {
    let s = b2[k];
    const base = k;
    for (let j = 0; j < hidden; j += 1) s += h[j] * w2[j * N_OUTPUTS + base];
    y[k] = sigmoid(s);
  }
  return y;
}

export function makeScratch(hidden) {
  return {
    idx: new Int32Array(64),
    val: new Float64Array(64),
    nActive: 0,
    h: new Float64Array(hidden),
    y: new Float64Array(N_OUTPUTS),
  };
}

/** Cubeless equity for White from an output vector. */
export function equityOf(y) {
  return 2 * y[0] - 1 + y[1] + y[2] - y[3] - y[4];
}
