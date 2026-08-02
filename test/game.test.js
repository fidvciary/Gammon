import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WHITE,
  BLACK,
  BAR,
  OFF,
  newGame,
  startTurn,
  setupPosition,
  legalMoves,
  legalPlays,
  applyMove,
  undoMove,
  undoTurn,
  canEndTurn,
  endTurn,
  pipCount,
  countAt,
  allHome,
  diceRemaining,
  diceFromRoll,
  rollDice,
  cloneState,
} from '../src/game.js';
import { notateMoves } from '../src/notation.js';

/** A state with a hand-built position, dice already on the table. */
function position(spec, turn, roll) {
  const base = newGame();
  const state = cloneState({ ...base, ...setupPosition(spec), turn });
  return startTurn(state, roll);
}

function find(moves, from, to) {
  const move = moves.find((m) => m.from === from && m.to === to);
  assert.ok(move, `expected a legal move ${from}/${to}`);
  return move;
}

function play(state, ...pairs) {
  let s = state;
  for (const [from, to] of pairs) s = applyMove(s, find(legalMoves(s), from, to));
  return s;
}

test('opening position is the standard one', () => {
  const s = newGame();
  assert.equal(pipCount(s, WHITE), 167);
  assert.equal(pipCount(s, BLACK), 167);
  for (const player of [WHITE, BLACK]) {
    assert.equal(countAt(s, player, 24), 2);
    assert.equal(countAt(s, player, 13), 5);
    assert.equal(countAt(s, player, 8), 3);
    assert.equal(countAt(s, player, 6), 5);
    assert.equal(s.bar[player], 0);
    assert.equal(s.off[player], 0);
  }
  // The two sides never share a point at the start.
  for (let abs = 1; abs <= 24; abs += 1) {
    assert.ok(Math.abs(s.board[abs]) === 0 || Math.abs(s.board[abs]) >= 2);
  }
});

test('doubles are played four times', () => {
  const s = startTurn({ ...newGame(), turn: WHITE }, [3, 3]);
  assert.deepEqual(diceFromRoll([3, 3]), [3, 3, 3, 3]);
  assert.equal(s.playLength, 4);
  const after = play(s, [24, 21], [24, 21], [13, 10], [13, 10]);
  assert.equal(diceRemaining(after).length, 0);
  assert.ok(canEndTurn(after));
});

test('the opening 3-1 includes making the 5-point', () => {
  const s = startTurn({ ...newGame(), turn: WHITE }, [3, 1]);
  assert.equal(s.playLength, 2);
  const plays = legalPlays(s);
  assert.ok(plays.every((p) => p.length === 2), 'every play uses both dice');
  const notated = plays.map((p) => notateMoves(p));
  assert.ok(notated.includes('8/5 6/5'));
  // Nothing may land on an enemy point: Black holds White's 1- and 12-points.
  for (const p of plays) {
    for (const m of p) assert.ok(m.to !== 1 && m.to !== 12);
  }
});

test('a blot is hit and sent to the bar', () => {
  const s = position({ white: { 8: 2 }, black: { 20: 1 } }, WHITE, [3, 4]);
  // Black's 20-point is White's 5-point.
  const after = play(s, [8, 5]);
  assert.equal(after.bar[BLACK], 1);
  assert.equal(countAt(after, WHITE, 5), 1);
  assert.equal(countAt(after, BLACK, 20), 0);
  assert.equal(notateMoves(after.played), '8/5*');
});

test('checkers on the bar must enter before anything else moves', () => {
  const s = position({ white: { 8: 2 }, black: { 6: 2 }, whiteBar: 1 }, WHITE, [
    5, 2,
  ]);
  const moves = legalMoves(s);
  assert.ok(moves.every((m) => m.from === BAR), 'only bar moves are offered');
  // Die 5 enters on the 20-point, die 2 on the 23-point.
  assert.deepEqual(
    moves.map((m) => m.to).sort((a, b) => a - b),
    [20, 23],
  );
});

test('a closed board leaves no play at all', () => {
  const s = position(
    { white: { 13: 2 }, black: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 }, whiteBar: 1 },
    WHITE,
    [6, 2],
  );
  assert.equal(s.playLength, 0);
  assert.deepEqual(legalMoves(s), []);
  assert.ok(canEndTurn(s), 'the turn can be passed');
  assert.equal(notateMoves(s.played), 'no play');
});

test('both dice must be played when a sequence exists', () => {
  // One checker on the 13, and Black owns the 10-point (its own 15-point).
  // 13/10 dies on the spot, so the 5 has to be played first: 13/8, 8/5.
  const s = position({ white: { 13: 1 }, black: { 15: 2 } }, WHITE, [5, 3]);
  assert.equal(s.playLength, 2);
  assert.deepEqual(
    legalMoves(s).map((m) => [m.from, m.to, m.die]),
    [[13, 8, 5]],
    'only the 5 is offered first',
  );
  const after = play(s, [13, 8], [8, 5]);
  assert.ok(canEndTurn(after));
  assert.equal(notateMoves(after.played), '13/8/5');
});

test('when only one die can be played it must be the higher one', () => {
  // Black holds the 10-point and the 5-point, so the 3 has no move at all:
  // not now (13/10) and not after the 5 either (8/5).
  const s = position({ white: { 13: 1 }, black: { 15: 2, 20: 2 } }, WHITE, [5, 3]);
  assert.equal(s.playLength, 1, 'only one die is playable');
  assert.equal(s.mustUseDie, 5);
  assert.deepEqual(
    legalMoves(s).map((m) => [m.from, m.to, m.die]),
    [[13, 8, 5]],
  );
});

test('bearing off needs every checker home', () => {
  const outside = position({ white: { 8: 1, 6: 2 } }, WHITE, [6, 1]);
  assert.equal(allHome(outside, WHITE), false);
  assert.ok(legalMoves(outside).every((m) => m.to !== OFF));

  const home = position({ white: { 6: 2, 1: 1 } }, WHITE, [6, 1]);
  assert.ok(allHome(home, WHITE));
  const moves = legalMoves(home);
  assert.ok(find(moves, 6, OFF), 'exact roll bears off');
  assert.ok(find(moves, 1, OFF), 'exact roll bears off');
});

test('a high die only bears off from the furthest-back point', () => {
  const s = position({ white: { 4: 1, 2: 1 } }, WHITE, [6, 1]);
  const moves = legalMoves(s);
  const withSix = moves.filter((m) => m.die === 6);
  assert.deepEqual(
    withSix.map((m) => m.from),
    [4],
    'the 6 bears off the back checker only',
  );
  // Once the back checker is gone the 6 applies to the next one back.
  const after = play(s, [4, OFF]);
  assert.deepEqual(
    legalMoves(after).map((m) => [m.from, m.to]),
    [[2, 1]],
    'the 1 must still be played inside the board',
  );
});

test('a checker outside the die value must be moved down first', () => {
  const s = position({ white: { 6: 1, 5: 1 } }, WHITE, [4, 4]);
  const moves = legalMoves(s);
  assert.ok(moves.every((m) => m.to !== OFF), 'nothing bears off with a 4 yet');
  const after = play(s, [6, 2], [5, 1]);
  const next = legalMoves(after);
  assert.ok(next.every((m) => m.to === OFF), 'now both bear off');
});

test('undo rewinds one move and the whole turn', () => {
  const s = startTurn({ ...newGame(), turn: WHITE }, [3, 1]);
  const two = play(s, [8, 5], [6, 5]);
  assert.equal(countAt(two, WHITE, 5), 2);

  const one = undoMove(two);
  assert.equal(one.played.length, 1);
  assert.equal(countAt(one, WHITE, 5), 1);
  assert.equal(countAt(one, WHITE, 6), 5);

  const none = undoTurn(two);
  assert.equal(none.played.length, 0);
  assert.deepEqual(none.board, s.board);
  assert.equal(countAt(none, WHITE, 8), 3);
});

test('undo restores a hit checker to the board', () => {
  const s = position({ white: { 8: 2 }, black: { 20: 1 } }, WHITE, [3, 4]);
  const after = undoMove(play(s, [8, 5]));
  assert.equal(after.bar[BLACK], 0);
  assert.equal(countAt(after, BLACK, 20), 1);
});

test('the turn passes to the other player', () => {
  const s = startTurn({ ...newGame(), turn: WHITE }, [3, 1]);
  const next = endTurn(play(s, [8, 5], [6, 5]));
  assert.equal(next.turn, BLACK);
  assert.equal(next.phase, 'roll');
  assert.equal(next.roll, null);
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].player, WHITE);
  assert.equal(notateMoves(next.history[0].moves), '8/5 6/5');
});

test('bearing off the last checker wins', () => {
  const s = position({ white: { 2: 1 }, black: { 6: 2, 5: 3 } }, WHITE, [2, 5]);
  const done = endTurn(play(s, [2, OFF]));
  assert.equal(done.phase, 'over');
  assert.equal(done.winner, WHITE);
  assert.equal(done.result.type, 'single');
  assert.equal(done.result.points, 1);
});

test('a gammon is two points, a backgammon three', () => {
  // Black has borne nothing off in any of these: all fifteen are still up.
  const gammon = position(
    { white: { 3: 1 }, black: { 13: 5, 8: 5, 6: 5 } },
    WHITE,
    [3, 5],
  );
  const gammonResult = endTurn(play(gammon, [3, OFF])).result;
  assert.equal(gammonResult.type, 'gammon');
  assert.equal(gammonResult.points, 2);

  // Black still has two checkers in White's home board (White's 2-point).
  const bg = position(
    { white: { 3: 1 }, black: { 23: 2, 13: 8, 8: 5 } },
    WHITE,
    [3, 5],
  );
  const bgResult = endTurn(play(bg, [3, OFF])).result;
  assert.equal(bgResult.type, 'backgammon');
  assert.equal(bgResult.points, 3);

  // Black on the bar is also a backgammon.
  const barred = position(
    { white: { 3: 1 }, black: { 13: 9, 8: 5 }, blackBar: 1 },
    WHITE,
    [3, 5],
  );
  assert.equal(endTurn(play(barred, [3, OFF])).result.type, 'backgammon');
});

test('illegal moves are refused', () => {
  const s = startTurn({ ...newGame(), turn: WHITE }, [3, 1]);
  assert.throws(() => applyMove(s, { from: 13, to: 12, die: 1 }), /illegal/);
  assert.throws(() => applyMove(s, { from: 6, to: 2, die: 4 }), /illegal/);
});

test('black moves the other way down the board', () => {
  const s = startTurn({ ...newGame(), turn: BLACK }, [6, 5]);
  const after = play(s, [24, 18], [18, 13]);
  // Black's 24-point is absolute 1, its 13-point absolute 12.
  assert.equal(after.board[1], -1);
  assert.equal(after.board[12], -6);
  assert.equal(notateMoves(after.played), '24/18/13');
});

test('a play can be enumerated for an engine to choose from', () => {
  const s = startTurn({ ...newGame(), turn: WHITE }, [6, 5]);
  const plays = legalPlays(s);
  assert.ok(plays.length > 0);
  assert.ok(plays.every((p) => p.length === s.playLength));
  // The classic lover's leap.
  assert.ok(plays.map(notateMoves).includes('24/18/13'));
  // No duplicates.
  const keys = plays.map((p) =>
    p.map((m) => `${m.from}/${m.to}`).sort().join(','),
  );
  assert.equal(new Set(keys).size, keys.length);
});

test('dice land in range', () => {
  let seed = 12345;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) {
    for (const d of rollDice(rng)) {
      assert.ok(Number.isInteger(d) && d >= 1 && d <= 6);
      seen.add(d);
    }
  }
  assert.equal(seen.size, 6, 'all six faces show up');
});
