/**
 * Skill rating: the part of the result the dice do not explain.
 *
 * A game's outcome is the sum of two things — what the dice handed out, and
 * what the players did with it:
 *
 *     result  =  luck  +  skill
 *
 * The luck ledger (luck.js) measures the first term directly: every throw is
 * priced against the throws that could have come instead, so a player's luck
 * total is the equity the dice gave them. Subtracting it from the result
 * leaves the equity they earned:
 *
 *     edge = result(White) − (White's luck − Black's luck)
 *
 * `edge` is in points, signed from White's side, and zero-sum: Black's edge
 * is its negative. It is the honest quantity; the 0..1 rating below is that
 * number put on a readable scale.
 *
 * Calibration (scripts/calibrate-rating.js): with the engine playing both
 * sides — equal skill, so the true edge is zero — the spread of `edge` over
 * 600 games is the noise floor of this measurement. EDGE_SD is that spread.
 * One SD of edge therefore means "a standard deviation better than the dice
 * alone would explain", which is what the rating scale is built from.
 *
 * That run also checks the arithmetic holds up: mean edge came out −0.024
 * against a standard error of 0.034, i.e. indistinguishable from the zero
 * theory demands of two equal players. Luck alone accounted for 79% of the
 * variance in the raw result (r = 0.887), and `edge` is what is left.
 */

/**
 * Standard deviation of a single game's edge between equally strong players,
 * measured over 600 engine-vs-engine games.
 */
export const EDGE_SD = 0.84;

/** Below this many games, say so — one game is mostly noise. */
export const CONFIDENT_GAMES = 12;

/**
 * The luck-adjusted result of one finished game, in points, from White's
 * side. `result` is the signed score (+2 = White won a gammon).
 */
export function skillEdge({ result, whiteLuck, blackLuck }) {
  return result - (whiteLuck - blackLuck);
}

/**
 * Put an average edge on a 0..1 scale. More games means the same average
 * edge is stronger evidence, so the scale tightens as √games — a run of
 * small edges eventually says more than one big one.
 *
 * 0.5 is par: the result was exactly what the dice dictated. Above means the
 * player got more out of their dice than they gave, below means less.
 */
export function ratingFromEdge(edge, games = 1, scale = EDGE_SD) {
  const n = Math.max(1, games);
  const standardError = scale / Math.sqrt(n);
  return 1 / (1 + Math.exp(-edge / standardError));
}

const BANDS = [
  [0.8, 'commanding'],
  [0.65, 'outplayed the dice'],
  [0.56, 'slightly ahead of the dice'],
  [0.44, 'level with the dice'],
  [0.35, 'slightly behind the dice'],
  [0.2, 'the dice deserve the credit'],
  [0, 'well behind the dice'],
];

export function ratingLabel(rating) {
  for (const [floor, label] of BANDS) {
    if (rating >= floor) return label;
  }
  return BANDS[BANDS.length - 1][1];
}

/**
 * Rate one game, or a run of them. `games` is a list of
 * { result, whiteLuck, blackLuck }, oldest first.
 *
 * Returns the shared edge plus a rating for each side. The two ratings sum
 * to exactly 1: this is a split of the credit between two players, not an
 * absolute measure of strength.
 */
export function skillRating(games, { scale = EDGE_SD } = {}) {
  const list = Array.isArray(games) ? games : [games];
  const played = list.length;
  if (!played) return null;

  let total = 0;
  for (const game of list) total += skillEdge(game);
  const perGame = total / played;

  const white = ratingFromEdge(perGame, played, scale);
  return {
    games: played,
    edgeTotal: total,
    edgePerGame: perGame,
    provisional: played < CONFIDENT_GAMES,
    white: { rating: white, label: ratingLabel(white) },
    black: { rating: 1 - white, label: ratingLabel(1 - white) },
  };
}

/**
 * A rating while the game is still running. Equity is the expected final
 * score, so it stands in for the result until there is a real one; the
 * number converges on the finished rating as the game closes out.
 */
export function liveSkillRating({ equity, whiteLuck, blackLuck }, opts) {
  const rating = skillRating(
    [{ result: equity, whiteLuck, blackLuck }],
    opts,
  );
  return { ...rating, live: true, provisional: true };
}
