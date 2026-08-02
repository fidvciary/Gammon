import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WHITE,
  BLACK,
  newGame,
  startTurn,
  rollDice,
  legalPlays,
  applyMove,
  cloneState,
  endTurn,
  canEndTurn,
} from '../src/game.js';
import {
  ALL_ROLLS,
  OPENING_ROLLS,
  fromState,
  flip,
  posKey,
  allPlays,
  isRace,
  startPos,
  winPoints,
} from '../src/engine/board.js';

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

/** Checkers on both sides must always total fifteen. */
function conserved(pos) {
  let mine = pos[25] + pos[26];
  let theirs = -pos[0] - pos[27];
  for (let i = 1; i <= 24; i += 1) {
    if (pos[i] > 0) mine += pos[i];
    else theirs -= pos[i];
  }
  return mine === 15 && theirs === 15;
}

test('roll tables are complete', () => {
  assert.equal(ALL_ROLLS.length, 21);
  assert.equal(
    ALL_ROLLS.reduce((s, r) => s + r.weight, 0),
    36,
  );
  assert.equal(OPENING_ROLLS.length, 15);
  assert.equal(
    OPENING_ROLLS.reduce((s, r) => s + r.weight, 0),
    30,
  );
});

test('flip is an involution and matches the other perspective', () => {
  const s = newGame();
  const w = fromState(s, WHITE);
  const b = fromState(s, BLACK);
  assert.equal(posKey(flip(w)), posKey(b));
  assert.equal(posKey(flip(b)), posKey(w));
  assert.equal(posKey(flip(flip(w))), posKey(w));
  assert.equal(posKey(startPos()), posKey(w));
});

test('the opening position is symmetric and not a race', () => {
  const pos = startPos();
  assert.ok(conserved(pos));
  assert.equal(isRace(pos), false);
  assert.equal(posKey(flip(pos)), posKey(pos));
});

test('race detection flips on when the sides have passed', () => {
  const race = new Int8Array(28);
  race[3] = 5;
  race[5] = 10;
  race[20] = -8;
  race[22] = -7;
  assert.equal(isRace(race), true);

  const contact = race.slice();
  contact[21] = 1; // one straggler behind an enemy checker
  contact[5] -= 1;
  assert.equal(isRace(contact), false);

  const barred = race.slice();
  barred[25] = 1;
  barred[5] -= 1;
  assert.equal(isRace(barred), false);
});

test('win points classify single, gammon, backgammon', () => {
  const pos = new Int8Array(28);
  pos[26] = 15;
  pos[27] = -3;
  pos[10] = -12;
  assert.equal(winPoints(pos), 1); // opponent has borne off

  pos[27] = 0;
  pos[10] = -15;
  assert.equal(winPoints(pos), 2); // gammon

  pos[10] = -14;
  pos[22] = -1; // checker in the mover's home board
  assert.equal(winPoints(pos), 3);

  pos[22] = 0;
  pos[0] = -1;
  pos[10] = -14;
  assert.equal(winPoints(pos), 3); // on the bar
});

/**
 * The heart of the suite: play random games with the reference rules engine
 * and, at every single turn, demand that the fast movegen produces exactly
 * the same set of reachable positions.
 */
test('fast movegen agrees with game.js on random games', () => {
  const random = rng(20260802);
  let turns = 0;
  let noPlayTurns = 0;

  for (let g = 0; g < 25; g += 1) {
    let state = { ...newGame(), turn: random() < 0.5 ? WHITE : BLACK };
    state = startTurn(cloneState(state), rollDice(random));

    for (let guard = 0; guard < 400 && state.phase !== 'over'; guard += 1) {
      const mover = state.turn;
      const pos = fromState(state, mover);
      const fast = allPlays(pos, state.roll[0], state.roll[1]);
      const slow = legalPlays(state);

      // Same play length. A dead roll is [] here and [[]] in legalPlays.
      if (state.playLength === 0) {
        assert.equal(fast.length, 0, 'no fast plays when the roll is dead');
        assert.deepEqual(slow, [[]], 'game.js sees the same dead roll');
        noPlayTurns += 1;
        state = endTurn(state);
        turns += 1;
        if (state.phase === 'over') break;
        state = startTurn(state, rollDice(random));
        continue;
      } else {
        assert.ok(fast.length > 0);
        for (const p of fast) {
          assert.equal(p.moves.length, state.playLength);
          assert.ok(conserved(p.after));
        }
      }

      // Same afterstates.
      const slowKeys = new Set(
        slow.map((moves) => {
          let s = state;
          for (const m of moves) s = applyMove(s, m);
          return posKey(fromState(s, mover));
        }),
      );
      const fastKeys = new Set(fast.map((p) => posKey(p.after)));
      assert.deepEqual(
        [...fastKeys].sort(),
        [...slowKeys].sort(),
        `afterstates diverge on roll ${state.roll} (game ${g}, turn ${turns})`,
      );

      // Every fast move sequence must replay cleanly through the rules engine.
      for (const p of fast) {
        let s = state;
        for (const m of p.moves) s = applyMove(s, m); // throws if illegal
        assert.equal(posKey(fromState(s, mover)), posKey(p.after));
      }

      // Advance with a random legal play.
      if (slow.length) {
        const pick = slow[Math.floor(random() * slow.length)];
        for (const m of pick) state = applyMove(state, m);
      }
      assert.ok(canEndTurn(state));
      state = endTurn(state);
      turns += 1;
      if (state.phase === 'over') break;
      state = startTurn(state, rollDice(random));
    }
  }

  assert.ok(turns > 500, `exercised ${turns} turns`);
  assert.ok(noPlayTurns > 0, 'saw at least one dance');
});
