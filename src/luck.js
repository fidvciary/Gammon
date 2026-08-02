/**
 * Luck bookkeeping. The engine prices every roll before it happens
 * (fathom.analyzeRolls); this module keeps the running account.
 *
 * A roll's luck is its best-play equity minus the probability-weighted mean
 * over every roll that could have been thrown instead — so luck averages
 * exactly zero, a good roll in a sharp position counts for more than the
 * same roll in a flat one, and the totals here sum something meaningful:
 * equity handed out by the dice, in points.
 */

import { WHITE } from './game.js';

export function emptyLuckLog() {
  return { entries: [] };
}

/**
 * Record one throw. `turn` is the history index the roll belongs to,
 * `rank`/`outOf` its position among the possible rolls, `luck` in equity.
 */
export function recordLuck(log, { turn, player, roll, luck, rank, outOf }) {
  return {
    entries: [
      ...log.entries,
      {
        n: log.entries.length + 1,
        turn,
        player,
        roll: [roll[0], roll[1]],
        luck,
        rank,
        outOf,
      },
    ],
  };
}

const emptySide = () => ({
  total: 0,
  count: 0,
  avg: 0,
  best: null,
  worst: null,
});

/**
 * Totals, averages, and the cumulative series the chart draws.
 * series[i] carries both players' running totals after entry i.
 */
export function luckSummary(log) {
  const white = emptySide();
  const black = emptySide();
  const series = [];
  let cumWhite = 0;
  let cumBlack = 0;

  for (const e of log.entries) {
    const side = e.player === WHITE ? white : black;
    side.total += e.luck;
    side.count += 1;
    if (side.best === null || e.luck > side.best.luck) side.best = e;
    if (side.worst === null || e.luck < side.worst.luck) side.worst = e;
    if (e.player === WHITE) cumWhite += e.luck;
    else cumBlack += e.luck;
    series.push({ n: e.n, player: e.player, luck: e.luck, cumWhite, cumBlack });
  }

  white.avg = white.count ? white.total / white.count : 0;
  black.avg = black.count ? black.total / black.count : 0;
  return { white, black, series };
}

/** Rescue a log from storage; anything malformed becomes a fresh log. */
export function reviveLuckLog(raw) {
  if (!raw || !Array.isArray(raw.entries)) return emptyLuckLog();
  const ok = raw.entries.every(
    (e) =>
      e &&
      Number.isFinite(e.luck) &&
      (e.player === 1 || e.player === -1) &&
      Array.isArray(e.roll) &&
      e.roll.length === 2,
  );
  return ok ? { entries: raw.entries } : emptyLuckLog();
}
