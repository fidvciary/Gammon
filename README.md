# Gammon

Two-player backgammon in the browser. Random dice, every rule enforced, and a
running log of the game in standard notation.

There is deliberately **no engine** — nothing here picks a move. Both sides are
played by a human, and `src/engine.js` is the empty socket an engine plugs into.

## Running it

No dependencies, no build step.

```sh
npm start          # http://localhost:8080
npm start -- 3000  # a different port
```

Any static server will do; the app is plain HTML, CSS, and ES modules. It has
to be *served* rather than opened as a file, because browsers refuse to load ES
modules over `file://`.

```sh
npm test           # the rules engine's test suite
```

## Playing

Click a checker, then click where it goes. Only legal destinations light up.

- **Roll** throws the dice. The first roll of the game is one die each, higher
  goes first and plays both — ties are re-thrown.
- Click a die to force the move to use that die, when both would reach the same
  square (only possible when bearing off). Click it again to release it.
- **Undo** takes back one checker; you can undo any number of times until you
  press Done.
- **Done** ends the turn. It only enables once the roll has been played out as
  fully as the rules require, so a turn can never be ended early.
- Keys: <kbd>R</kbd> roll, <kbd>U</kbd> undo, <kbd>Enter</kbd> done,
  <kbd>Esc</kbd> deselect.

Point numbers along the edge are shown from the point of view of whoever is on
move, matching the notation in the move log. The game is saved to
`localStorage` after every move, so a reload picks up where you left off.

### What the rules enforce

- Checkers on the bar must enter before anything else moves.
- Landing on two or more enemy checkers is blocked; landing on exactly one
  sends it to the bar.
- Doubles are played four times.
- Both dice must be played if any legal order allows it — including when only
  one order works. If just one die can be played, it has to be the higher one.
- Bearing off needs all fifteen checkers home. A die larger than the point only
  bears off when nothing is further back.
- Gammons (2 points) and backgammons (3 points) are detected and scored.

Not implemented: the doubling cube, match play, and any kind of clock.

## Layout

```
index.html      markup and the panel
styles.css      the board is CSS — points are clipped triangles on a grid
src/game.js     the rules. Pure, DOM-free, and the only thing under test
src/notation.js turns a list of moves into "13/7 8/4*"
src/ui.js       rendering and input; holds no rules of its own
src/engine.js   where a move-picking engine registers
test/           node --test suite for src/game.js
scripts/serve.js  a static file server so npm start needs nothing installed
```

`src/game.js` keeps the board as signed counts on absolute points 1..24 —
positive is White, negative is Black — but expresses every rule in *relative*
points, which count 24 down to 1 in the direction the player moves. Home is
1..6 for both sides, the bar is 25, borne off is 0. Converting is
`absolute = player === WHITE ? relative : 25 - relative`.

## Adding an engine

`legalPlays(state)` hands you every distinct legal way to play the current roll
in full, each one an array of moves. Pick one and return it:

```js
import { registerEngine } from './src/engine.js';

registerEngine({
  name: 'greedy',
  choosePlay(state, plays) {
    return plays[0]; // may also return a promise
  },
});
```

Or, from anything compiled to a classic script — an F#/Fable bundle, say — the
same registry hangs off the window:

```html
<script type="module" src="src/ui.js"></script>
<script src="engine-bundle.js"></script>   <!-- calls window.Gammon.registerEngine -->
```

A "Black: <name>" checkbox appears in the header as soon as one registers, and
ticking it hands Black's turns to the engine. Nothing else in the app changes.

The state passed in is a plain object, safe to read and safe to copy:

| field | meaning |
| --- | --- |
| `board` | 25 signed ints, index 1..24; `+` White, `−` Black |
| `bar`, `off` | `{ "1": n, "-1": n }`, keyed by player |
| `turn` | `1` for White, `-1` for Black |
| `roll` | the two dice as thrown |
| `played` | moves made so far this turn |
| `playLength` | how many moves this roll must produce |
| `history` | every completed turn |

Useful companions to `legalPlays`: `legalMoves`, `applyMove`, `pipCount`,
`maxDiceUsable`, and `setupPosition` for building a position by hand.
