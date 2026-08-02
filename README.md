# Gammon

Backgammon in the browser, with a neural-net engine, full rule enforcement,
a ranked table of every possible roll, a luck meter that prices each throw of
the dice, and a skill rating that separates the two. No build step, no
dependencies.

## Running it

```sh
npm start          # http://localhost:8080
npm start -- 3000  # a different port
npm test           # rules engine + analysis test suites
```

Any static server works; the app is plain HTML, CSS, and ES modules. It has to
be *served* rather than opened as a file because browsers refuse to load ES
modules over `file://`.

## Playing

Click a checker, then click where it goes — only legal destinations light up.
**Roll** throws the dice (the opening throw is one die each; higher goes first
and plays both, ties are re-thrown). **Undo** takes back checkers one at a
time until **Done** commits the turn; Done only enables once the roll has been
played out as fully as the rules demand. Keys: <kbd>R</kbd> roll,
<kbd>U</kbd> undo, <kbd>Enter</kbd> done, <kbd>B</kbd> best play,
<kbd>Esc</kbd> deselect.

Both sides are played by hand unless you hand one to the engine, so a
pass-and-play game between two people needs no setup at all.

### Entering your own rolls

Switch **Dice** to **Manual** (next to the controls) to dictate the dice
instead of throwing them — for replaying a game from a transcript or copying
one as it happens. The Roll button gives way to an entry box:

- Type the two dice and they play the moment the second digit lands — `53`,
  or `5 3` / `5-3` / `5,3` if you prefer. No Enter needed.
- Or click any row in the **Rolls** panel to play that roll.
- During the opening, enter **both** dice, White's first (`53` = White threw
  5, Black threw 3, so White starts and plays 5-3). Equal dice are a tie, and
  it waits for the next pair, exactly as at the table.
- Mistyped it? Enter the roll again — it is replaced as long as you have not
  moved a checker yet, and its luck entry is rewritten rather than double
  counted.
- Anything that is not a die simply never enters the box.

Luck and roll analysis work the same on dictated rolls, so a transcribed game
gets the full treatment. The setting sticks across reloads. If the engine is
playing a side, it waits for you to enter its roll and then moves.

The rules engine enforces everything: bar entry before anything else, blocked
points, hitting, doubles played four times, "play both dice if any order
allows it", "if only one die plays it must be the higher", bear-off legality,
and gammon/backgammon scoring. Games save to `localStorage` after every move.

## The engine — Fathom

`src/engine/` holds a self-contained engine:

- **`net.js` + `weights.js`** — a TD-Gammon-style neural network: 198 inputs
  (Tesauro's board encoding plus whose turn), 80 sigmoid hidden units, and
  five outputs — P(win), P(gammon win), P(backgammon win), P(gammon loss),
  P(backgammon loss) — from which cubeless equity follows. The shipped
  weights were trained from scratch by `scripts/train.js`: TD(λ) self-play
  (λ = 0.7, annealed α), 200,000 games. At 1 ply they beat pubeval 54.9%
  with **+0.30 points per game** over a 2,000-game cubeless money session
  (`npm run benchmark`); the app plays them at 2 ply.
- **`board.js`** — a fast move generator over an `Int8Array` position, laid
  out to match Tesauro's `pos[]` convention. Cross-validated move-for-move
  against the reference rules engine on random games (`test/board.test.js`).
- **`pubeval.js`** — Tesauro's public benchmark evaluator, ported verbatim,
  weights byte-for-byte. It is the sparring partner the net is measured
  against (`scripts/benchmark.js`) and the standard yardstick in the
  backgammon-programming literature.
- **`fathom.js`** — the engine proper: 1-ply scoring with a 2-ply expectimax
  settle among the best candidates when it plays, plus the analysis calls the
  UI uses (`evaluate`, `analyzeRolls`, `bestPlay`).

The engine card (right panel) shows a live evaluation bar and lets the engine
play **White**, **Black**, **both sides**, or neither.

### Best play

As soon as there are dice on the table, the engine's best play for them is
shown — in notation on the engine card, and **drawn on the board as arrows**,
one per move, with a `×2` badge where the same move is made twice. Alongside
the notation is the equity of that play for the player on turn and how much
it beats the second-best play by, so you can see whether the choice is
close or clear-cut. Play a checker and it re-solves for the rest of the roll,
so it always answers "what should I do from here".

Press <kbd>B</kbd> or the **Shown/Hidden** button to turn it off — worth doing
if you want to play seriously rather than analyse. The setting is remembered.

Depth note: the best play is searched at 2 ply, while the rolls table below is
1 ply (21 rolls times every play is far too much work at 2 ply), so the two
equities read a little differently for the same roll. Each roll's tooltip says
which it is.

Training and benchmarking (Node, no dependencies):

```sh
node scripts/train.js --games 200000 --hidden 80   # regenerates weights.js
node scripts/benchmark.js --games 2000             # vs pubeval, 1-ply
```

## The rolls table

The left panel prices **all 21 distinct rolls** for whoever rolls next, from
the position they would roll at: each row shows the roll, the equity of its
best play (hover for the play itself), and a bar of its edge over the
**median-ranked roll** — the dashed line in the table. During the opening
throw it lists the 15 non-double rolls, since opening doubles are re-thrown.
After a roll, the thrown one is highlighted with its rank and luck.

## The luck meter

Every throw is priced before it lands: the luck of a roll is

```
luck = equity(best play with the roll) − Σ p(r) · equity(best play with r)
```

— the probability-weighted mean over all rolls that could have come instead
(doubles 1/36, others 2/36). By construction the expected luck of a throw is
**exactly zero**, so any nonzero total is edge the dice actually handed out.
The same roll scores differently in different positions: the best roll in a
sharp position (a hit that swings the game) carries big luck, while the best
roll of a flat position barely moves the needle — which is what makes "rank 1
of 21" and "luck +0.02" both true at once. A dance on the bar prices the
unchanged position and comes out strongly negative on its own.

Per player, luck accumulates through the game: totals and per-roll averages
sit above a chart of both players' running luck — its highs and lows marked —
with a tooltip giving each throw's rank and value. Each move-log row also
carries its roll's luck, and **Copy** exports the log with luck annotations.

## The skill rating

A game's outcome is two things added together — what the dice handed out, and
what the players did with it:

```
result = luck + skill
```

The luck meter measures the first term directly, so subtracting it from the
score leaves what was earned:

```
edge = result(White) − (White's luck − Black's luck)
```

`edge` is in points and zero-sum. A player who wins two points while the dice
gave them exactly two points of equity has an edge of zero — the dice did it.
Winning a single point through dice that were a point and a half against you
is an edge of +2.5, and losing while the dice were even worse than the loss
still comes out positive.

The **Skill** panel puts that on a 0..1 scale, split between the two players
so the pair always sums to exactly 1 — it is a share of the credit, not an
absolute strength. **0.50 is par**: the result was precisely what the dice
dictated. Above means a player got more out of their dice than they gave.

The scale is calibrated, not guessed. `scripts/calibrate-rating.js` plays the
engine against itself — equal skill, so the true edge is zero — and measures
the spread of `edge` over 600 games. That spread (0.84 points) is the noise
floor, and one noise-SD of edge is what moves the rating to 0.73. The same run
is a check on the arithmetic: mean edge came out −0.024 against a standard
error of 0.034, i.e. indistinguishable from the zero that two equal players
must average. It also shows how much of backgammon is dice — luck alone
explained **79%** of the variance in the raw result (r = 0.887); `edge` is the
remaining fifth.

Because one game is mostly noise, the rating accumulates over a run: finished
games are kept across **New game**, the scale tightens as √games, and the
panel says how far along it is until roughly a dozen games have been played.
**reset** clears the run. While a game is in progress the engine's equity
stands in for its result — equity *is* the expected final score — so the
number moves during play and converges on the real one at the end.

A caveat worth stating: this measures outcomes, not moves. It cannot tell a
player who blundered and got away with it from one who played cleanly, only
what the scoreboard says once the dice are accounted for. Move-by-move error
rates (comparing each play against the engine's best) would measure skill
directly, and would be the natural next step.

## Layout

```
index.html         markup: rolls panel · board · controls/engine/log
styles.css         the board is CSS; chart palette validated for CVD contrast
src/game.js        the rules. Pure, DOM-free; the only source of legality
src/notation.js    "13/7 8/4*" formatting
src/ui.js          rendering and input; holds no rules of its own
src/luck.js        the luck ledger: record, summarize, revive from storage
src/rating.js      skill rating: result minus luck, on a 0..1 scale
src/engine.js      engine registry (external engines can still plug in)
src/engine/        Fathom: net, weights, movegen, pubeval, search
scripts/serve.js   static server for npm start
scripts/train.js   TD(λ) self-play trainer (worker threads)
scripts/td.js      training core + pubeval match play
scripts/benchmark.js  net vs pubeval CLI
scripts/calibrate-rating.js  measures the rating's noise floor
test/              node --test suites
```

## Plugging in your own engine

The registry from the first version still works — register an object with a
`choosePlay(state, plays)` and it takes over the *playing* (the analysis
panels stay on the built-in net):

```js
import { registerEngine } from './src/engine.js';   // or window.Gammon.registerEngine
registerEngine({
  name: 'my engine',
  choosePlay(state, plays) {
    return plays[0]; // may return a promise
  },
});
```

`legalPlays(state)` enumerates complete plays; `src/engine/board.js` offers a
fast position representation (`fromState`, `allPlays`, `flip`) if you want to
search. Not implemented anywhere: the doubling cube, match play, clocks.
