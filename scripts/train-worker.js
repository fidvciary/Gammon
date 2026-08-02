/**
 * Self-play worker: receives weight snapshots, plays a batch of TD(λ)
 * training games against itself, and posts back the weight deltas.
 */

import { parentPort, workerData } from 'node:worker_threads';

import { createNet } from '../src/engine/net.js';
import { makeTrainer, selfPlayGame, xorshift } from './td.js';

const rng = xorshift(workerData.seed);
const net = createNet(workerData.hidden, rng);
const trainer = makeTrainer(net);
const snapshot = {
  w1: new Float64Array(net.w1.length),
  b1: new Float64Array(net.b1.length),
  w2: new Float64Array(net.w2.length),
  b2: new Float64Array(net.b2.length),
};
let startMover = 1;

parentPort.on('message', (msg) => {
  if (msg.type !== 'run') return;

  net.w1.set(msg.weights.w1);
  net.b1.set(msg.weights.b1);
  net.w2.set(msg.weights.w2);
  net.b2.set(msg.weights.b2);
  snapshot.w1.set(net.w1);
  snapshot.b1.set(net.b1);
  snapshot.w2.set(net.w2);
  snapshot.b2.set(net.b2);

  let plies = 0;
  let abandoned = 0;
  for (let g = 0; g < msg.games; g += 1) {
    const n = selfPlayGame(trainer, {
      alpha: msg.alpha,
      lambda: msg.lambda,
      rng,
      startMover,
    });
    startMover = -startMover;
    if (n < 0) abandoned += 1;
    else plies += n;
  }

  const delta = {
    w1: new Float64Array(net.w1.length),
    b1: new Float64Array(net.b1.length),
    w2: new Float64Array(net.w2.length),
    b2: new Float64Array(net.b2.length),
  };
  for (const key of ['w1', 'b1', 'w2', 'b2']) {
    const d = delta[key];
    const cur = net[key];
    const snap = snapshot[key];
    for (let i = 0; i < d.length; i += 1) d[i] = cur[i] - snap[i];
  }

  parentPort.postMessage(
    { type: 'done', games: msg.games, plies, abandoned, delta },
    [delta.w1.buffer, delta.b1.buffer, delta.w2.buffer, delta.b2.buffer],
  );
});
