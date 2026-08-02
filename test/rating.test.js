import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EDGE_SD,
  skillEdge,
  ratingFromEdge,
  ratingLabel,
  skillRating,
  liveSkillRating,
} from '../src/rating.js';

test('edge strips the luck out of the result', () => {
  // Won a gammon, but the dice handed over exactly two points of equity:
  // nothing was earned.
  assert.equal(skillEdge({ result: 2, whiteLuck: 2, blackLuck: 0 }), 0);

  // Won a single point while the dice were against you: that is all skill.
  assert.equal(skillEdge({ result: 1, whiteLuck: -0.5, blackLuck: 0.5 }), 2);

  // Lost, but the dice were far worse than the loss: still a plus.
  assert.equal(skillEdge({ result: -1, whiteLuck: -1, blackLuck: 1 }), 1);

  // Lost by exactly what the opponent's dice were worth: nobody outplayed
  // anybody, so the edge is zero.
  assert.equal(skillEdge({ result: -1, whiteLuck: 0, blackLuck: 1 }), 0);

  // Held the result level while the opponent's dice ran hot: that is earned.
  assert.equal(skillEdge({ result: 0, whiteLuck: 0, blackLuck: 1 }), 1);
});

test('a result fully explained by luck rates exactly 0.5', () => {
  const r = skillRating({ result: 3, whiteLuck: 3, blackLuck: 0 });
  assert.equal(r.edgePerGame, 0);
  assert.equal(r.white.rating, 0.5);
  assert.equal(r.black.rating, 0.5);
  assert.equal(r.white.label, 'level with the dice');
});

test('the two ratings always split one whole', () => {
  const cases = [
    { result: 3, whiteLuck: 0, blackLuck: 0 },
    { result: -2, whiteLuck: 1.5, blackLuck: -0.25 },
    { result: 1, whiteLuck: -2, blackLuck: 2 },
    { result: 0, whiteLuck: 0, blackLuck: 0 },
  ];
  for (const game of cases) {
    const r = skillRating(game);
    assert.ok(Math.abs(r.white.rating + r.black.rating - 1) < 1e-12);
    // And it is a genuine mirror: swapping the sides flips the rating.
    const swapped = skillRating({
      result: -game.result,
      whiteLuck: game.blackLuck,
      blackLuck: game.whiteLuck,
    });
    assert.ok(Math.abs(swapped.white.rating - r.black.rating) < 1e-12);
  }
});

test('ratings stay inside 0..1 however lopsided the game', () => {
  // Anything a real game can produce stays strictly inside the range: a
  // backgammon is 3 points and luck totals do not run far past that.
  for (const edge of [-8, -3, -1, 0, 1, 3, 8]) {
    const r = ratingFromEdge(edge);
    assert.ok(r > 0 && r < 1, `edge ${edge} -> ${r}`);
  }
  // Absurd inputs saturate at the ends rather than escaping them.
  for (const edge of [-1e9, -50, 50, 1e9]) {
    const r = ratingFromEdge(edge);
    assert.ok(r >= 0 && r <= 1, `edge ${edge} -> ${r}`);
  }
  assert.equal(ratingFromEdge(0), 0.5);
  assert.ok(Number.isFinite(ratingFromEdge(0, 1000)));
});

test('rating rises with edge and one SD lands near 0.73', () => {
  let previous = -Infinity;
  for (const edge of [-2, -1, -0.4, 0, 0.4, 1, 2]) {
    const r = ratingFromEdge(edge);
    assert.ok(r > previous, 'monotone in edge');
    previous = r;
  }
  const oneSd = ratingFromEdge(EDGE_SD, 1);
  assert.ok(Math.abs(oneSd - 0.731) < 0.01, `one SD -> ${oneSd}`);
});

test('more games make the same average edge count for more', () => {
  const edge = 0.3;
  const one = ratingFromEdge(edge, 1);
  const four = ratingFromEdge(edge, 4);
  const twenty = ratingFromEdge(edge, 20);
  assert.ok(four > one, 'four games beat one');
  assert.ok(twenty > four, 'twenty beat four');
  // Scale tightens as the standard error, sd/sqrt(n).
  assert.ok(Math.abs(four - ratingFromEdge(edge * 2, 1)) < 1e-12);
});

test('a run of games averages the edge and drops the provisional flag', () => {
  const games = Array.from({ length: 12 }, () => ({
    result: 1,
    whiteLuck: 0.5,
    blackLuck: 0,
  }));
  const r = skillRating(games);
  assert.equal(r.games, 12);
  assert.ok(Math.abs(r.edgePerGame - 0.5) < 1e-12);
  assert.ok(Math.abs(r.edgeTotal - 6) < 1e-12);
  assert.equal(r.provisional, false);
  assert.ok(
    r.white.rating > ratingFromEdge(0.5, 1),
    'twelve consistent games say more than one',
  );
  // Twelve games at half a point each is well clear of the noise floor.
  assert.ok(r.white.rating > 0.85, 'and say it strongly');

  assert.equal(skillRating([games[0]]).provisional, true, 'one game is not');
});

test('an empty run has no rating', () => {
  assert.equal(skillRating([]), null);
});

test('labels track the bands and mirror around par', () => {
  assert.equal(ratingLabel(0.5), 'level with the dice');
  assert.equal(ratingLabel(0.9), 'commanding');
  assert.equal(ratingLabel(0.05), 'well behind the dice');
  assert.equal(ratingLabel(0.7), 'outplayed the dice');
  assert.equal(ratingLabel(0.3), 'the dice deserve the credit');
});

test('a live rating stands the current equity in for the result', () => {
  const live = liveSkillRating({ equity: 0.8, whiteLuck: 0.8, blackLuck: 0 });
  assert.equal(live.edgePerGame, 0);
  assert.equal(live.white.rating, 0.5, 'ahead exactly as much as the dice gave');
  assert.ok(live.live);
  assert.ok(live.provisional);

  // Ahead on the board despite bad dice reads as skill.
  const earned = liveSkillRating({ equity: 0.5, whiteLuck: -0.5, blackLuck: 0 });
  assert.ok(earned.white.rating > 0.5);
});
