/**
 * Benchmark the trained net against Tesauro's pubeval.
 *
 *   node scripts/benchmark.js                       # shipped weights
 *   node scripts/benchmark.js --weights ckpt.json --games 2000
 *
 * Cubeless money sessions, both players at 1 ply, alternating who starts.
 * The shipped engine searches 2 ply in the app, so this understates it.
 */

import { readFileSync } from 'node:fs';

import { loadNet } from '../src/engine/net.js';
import { netVsPubeval, xorshift } from './td.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1];
}

const games = Number(args.games || 2000);
const seed = Number(args.seed || 987654321);

let data;
if (args.weights) {
  data = JSON.parse(readFileSync(args.weights, 'utf8'));
} else {
  data = (await import('../src/engine/weights.js')).default;
}
const net = loadNet(data);

const t0 = Date.now();
const r = netVsPubeval(net, games, xorshift(seed));
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const se = Math.sqrt((r.winRate * (1 - r.winRate)) / r.games) * 100;

console.log(
  `net (1-ply) vs pubeval over ${r.games} games [${secs}s]\n` +
    `  wins   ${r.netWins} (${(r.winRate * 100).toFixed(1)}% ± ${se.toFixed(1)}%)\n` +
    `  points ${r.netPoints} vs ${r.oppPoints} (ppg ${r.ppg >= 0 ? '+' : ''}${r.ppg.toFixed(3)})`,
);
