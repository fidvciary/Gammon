import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WHITE,
  BLACK,
  newGame,
  startTurn,
  cloneState,
  legalPlays,
  applyMove,
  canEndTurn,
  setupPosition,
} from '../src/game.js';
import {
  analyzeRolls,
  luckOf,
  choosePlay,
  hint,
  evaluate,
} from '../src/engine/fathom.js';
import { emptyLuckLog, recordLuck, luckSummary, reviveLuckLog } from '../src/luck.js';

/**
 * These tests hold for ANY weights — they pin down the analysis contracts,
 * not the strength of the play.
 */

function moveState(spec, turn, roll) {
  const base = newGame();
  const state = cloneState({ ...base, ...setupPosition(spec), turn });
  return startTurn(state, roll);
}

test('analyzeRolls covers all 21 rolls with exact weights', () => {
  const state = { ...newGame(), turn: WHITE, phase: 'roll' };
  const a = analyzeRolls(state);
  assert.equal(a.rolls.length, 21);
  assert.equal(a.rolls.reduce((s, r) => s + r.weight, 0), 36);
  assert.deepEqual(
    a.rolls.map((r) => r.rank),
    Array.from({ length: 21 }, (_, i) => i + 1),
  );
  // Sorted best to worst.
  for (let i = 1; i < a.rolls.length; i += 1) {
    assert.ok(a.rolls[i - 1].eq >= a.rolls[i].eq);
  }
});

test('luck is exactly mean-zero over the roll distribution', () => {
  for (const [state, opening] of [
    [{ ...newGame(), turn: WHITE, phase: 'roll' }, false],
    [{ ...newGame(), turn: BLACK, phase: 'roll' }, false],
    [{ ...newGame(), turn: WHITE, phase: 'opening' }, true],
    [
      moveState({ white: { 6: 3, 5: 3, 13: 2 }, black: { 8: 2, 4: 2 }, whiteBar: 1 },
        WHITE, [6, 6]),
      false,
    ],
  ]) {
    const a = analyzeRolls(state, { opening });
    let weighted = 0;
    let total = 0;
    for (const r of a.rolls) {
      weighted += r.weight * (r.eq - a.mean);
      total += r.weight;
    }
    assert.equal(total, opening ? 30 : 36);
    assert.ok(Math.abs(weighted) < 1e-9, `mean luck ${weighted}`);
  }
});

test('the weighted median splits the distribution at half weight', () => {
  const a = analyzeRolls({ ...newGame(), turn: WHITE, phase: 'roll' });
  const before = a.rolls
    .filter((r) => r.rank < a.median.rank)
    .reduce((s, r) => s + r.weight, 0);
  const through = before + a.median.weight;
  assert.ok(before * 2 < 36, 'less than half the weight is strictly better');
  assert.ok(through * 2 >= 36, 'half is reached at the median roll');
  assert.equal(a.median.delta, 0, 'deltas are measured from the median');
});

test('the best roll never has negative luck, the worst never positive', () => {
  const a = analyzeRolls({ ...newGame(), turn: WHITE, phase: 'roll' });
  const best = luckOf(a, a.rolls[0].dice);
  const worst = luckOf(a, a.rolls[20].dice);
  assert.ok(best.luck >= 0);
  assert.ok(worst.luck <= 0);
  assert.equal(best.entry.rank, 1);
  // Every roll is findable, in either dice order.
  assert.ok(luckOf(a, [3, 5]).entry.dice[0] === 5);
  assert.ok(luckOf(a, [5, 3]).entry.dice[0] === 5);
});

test('an opening analysis has no doubles', () => {
  const a = analyzeRolls({ ...newGame(), turn: WHITE, phase: 'opening' }, { opening: true });
  assert.equal(a.rolls.length, 15);
  assert.ok(a.rolls.every((r) => r.dice[0] !== r.dice[1]));
});

test('choosePlay returns a full, replayable play', () => {
  for (const roll of [[6, 5], [3, 3], [2, 1]]) {
    const state = startTurn({ ...newGame(), turn: BLACK }, roll);
    const plays = legalPlays(state);
    const choice = choosePlay(state, plays);
    assert.equal(choice.length, state.playLength);
    let s = state;
    for (const m of choice) s = applyMove(s, m); // throws if illegal
    assert.ok(canEndTurn(s));
  }
});

test('hint offers nothing on a dead roll', () => {
  const state = moveState(
    { white: { 13: 2 }, black: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 }, whiteBar: 1 },
    WHITE,
    [6, 2],
  );
  assert.equal(state.playLength, 0);
  assert.equal(hint(state), null);
});

test('hint works mid-turn on the remaining dice', () => {
  const state = startTurn({ ...newGame(), turn: WHITE }, [3, 1]);
  const first = legalPlays(state)[0][0];
  const partway = applyMove(state, first);
  const h = hint(partway);
  assert.ok(h);
  assert.equal(h.moves.length, 1);
});

test('evaluate stays within the equity range and flips with the winner', () => {
  const eq = evaluate({ ...newGame(), turn: WHITE, phase: 'roll' });
  assert.ok(eq > -3 && eq < 3);
  assert.equal(
    evaluate({ phase: 'over', winner: BLACK, result: { points: 2 } }),
    -2,
  );
});

test('luck accumulates per player with a cumulative series', () => {
  let log = emptyLuckLog();
  log = recordLuck(log, { turn: 1, player: WHITE, roll: [6, 5], luck: 0.2, rank: 1, outOf: 15 });
  log = recordLuck(log, { turn: 2, player: BLACK, roll: [2, 1], luck: -0.15, rank: 20, outOf: 21 });
  log = recordLuck(log, { turn: 3, player: WHITE, roll: [4, 4], luck: 0.05, rank: 3, outOf: 21 });
  log = recordLuck(log, { turn: 4, player: WHITE, roll: [1, 2], luck: -0.4, rank: 21, outOf: 21 });

  const s = luckSummary(log);
  assert.ok(Math.abs(s.white.total - (0.2 + 0.05 - 0.4)) < 1e-12);
  assert.equal(s.white.count, 3);
  assert.ok(Math.abs(s.white.avg - s.white.total / 3) < 1e-12);
  assert.equal(s.black.count, 1);
  assert.equal(s.white.best.roll[0], 6);
  assert.equal(s.white.worst.luck, -0.4);
  assert.equal(s.series.length, 4);
  assert.ok(Math.abs(s.series[3].cumWhite - s.white.total) < 1e-12);
  assert.equal(s.series[1].cumBlack, -0.15);
  assert.equal(s.series[2].cumBlack, -0.15, 'holds between that player\'s rolls');
});

test('a mangled stored log is replaced, a good one revived', () => {
  assert.deepEqual(reviveLuckLog(null).entries, []);
  assert.deepEqual(reviveLuckLog({ entries: [{ bad: true }] }).entries, []);
  const good = recordLuck(emptyLuckLog(), {
    turn: 1, player: WHITE, roll: [5, 2], luck: 0.1, rank: 4, outOf: 21,
  });
  assert.equal(reviveLuckLog(JSON.parse(JSON.stringify(good))).entries.length, 1);
});
