/**
 * Board, dice, move log, and the analysis side: rolls table, luck meter,
 * and the engine card. All rules live in game.js; all evaluation lives in
 * engine/fathom.js. This file renders state and turns clicks into moves.
 */

import {
  WHITE,
  BLACK,
  BAR,
  OFF,
  newGame,
  roll,
  rollOpening,
  startTurn,
  parseRoll,
  legalMoves,
  legalPlays,
  applyMove,
  undoMove,
  canEndTurn,
  endTurn,
  pipCount,
  toRel,
  toAbs,
  playerName,
  diceRemaining,
  diceFromRoll,
} from './game.js';
import { notateMoves } from './notation.js';
import { getEngine, onEngineRegistered } from './engine.js';
import {
  evaluate,
  analyzeRolls,
  luckOf,
  bestPlay,
  engine as fathom,
} from './engine/fathom.js';
import {
  emptyLuckLog,
  recordLuck,
  luckSummary,
  reviveLuckLog,
} from './luck.js';

const $ = (id) => document.getElementById(id);

const boardEl = $('board');
const railTop = $('rail-top');
const railBottom = $('rail-bottom');
const railNote = $('rail-note');
const diceEl = $('dice');
const statusEl = $('status');
const logEl = $('log');
const rollBtn = $('roll');
const undoBtn = $('undo');
const doneBtn = $('done');
const newGameBtn = $('new-game');
const copyBtn = $('copy-log');
const rollsEl = $('rolls');
const rollsContext = $('rolls-context');
const luckChartEl = $('luck-chart');
const engineNameEl = $('engine-name');
const engineDescEl = $('engine-desc');
const evalbarFill = $('evalbar-fill');
const evalbarNum = $('evalbar-num');
const enginePlaysEl = $('engine-plays');
const controlsEl = $('controls');
const diceModeEl = $('dice-mode');
const diceEntryEl = $('dice-entry');
const diceInput = $('dice-input');
const diceSetBtn = $('dice-set');
const diceNoteEl = $('dice-note');
const bestToggle = $('best-toggle');
const bestPlayEl = $('best-play');
const bestEqEl = $('best-eq');

const STORAGE_KEY = 'gammon.state.v1';

let state;
let luckLog;
let enginePlays = 'off'; // off | white | black | both
let diceMode = 'random'; // random | manual
let selected = null;
let dieFilter = null;
let lastMove = null;
let moves = [];
let busy = false;
let engineToken = 0;
let checkerSize = 28;
let delays = { roll: 600, move: 450 };
let showBest = true;

load();

/* ---------------------------------------------------------------- build */

const pointEls = new Array(25);
const barEls = {};
const trayEls = {};
const SVG_NS = 'http://www.w3.org/2000/svg';
let overlayEl = null;

function cellFor(abs) {
  if (abs >= 13) return { row: 1, col: abs <= 18 ? abs - 12 : abs - 11 };
  return { row: 2, col: abs >= 7 ? 13 - abs : 14 - abs };
}

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.append(node);
  return node;
}

function buildBoard() {
  boardEl.textContent = '';
  for (let abs = 1; abs <= 24; abs += 1) {
    const { row, col } = cellFor(abs);
    const point = el('div', `point ${row === 1 ? 'top' : 'bottom'}`, boardEl);
    if (abs % 2 === 0) point.classList.add('light');
    point.style.gridRow = String(row);
    point.style.gridColumn = String(col);
    point.dataset.point = String(abs);
    el('div', 'tri', point);
    el('div', 'stack', point);
    pointEls[abs] = point;
  }
  const bar = el('div', 'bar', boardEl);
  for (const [player, half] of [
    [WHITE, 'top'],
    [BLACK, 'bottom'],
  ]) {
    const node = el('div', `bar-half ${half}`, bar);
    node.dataset.bar = String(player);
    barEls[player] = node;
  }
  for (const [player, half] of [
    [BLACK, 'top'],
    [WHITE, 'bottom'],
  ]) {
    const tray = el('div', `tray ${half}`, boardEl);
    tray.dataset.tray = String(player);
    el('div', 'tray-count', tray);
    trayEls[player] = tray;
  }
  for (const rail of [railTop, railBottom]) {
    rail.textContent = '';
    for (let col = 1; col <= 14; col += 1) el('span', null, rail);
  }

  overlayEl = document.createElementNS(SVG_NS, 'svg');
  overlayEl.setAttribute('class', 'best-overlay');
  overlayEl.setAttribute('aria-hidden', 'true');
  boardEl.append(overlayEl);
}

/* --------------------------------------------------------------- layout */

function measure() {
  const rect = pointEls[13].getBoundingClientRect();
  if (!rect.width) return false;
  const size = Math.max(
    8,
    Math.floor(Math.min(rect.width * 0.86, rect.height / 5.2)),
  );
  if (size === checkerSize) return false;
  checkerSize = size;
  boardEl.style.setProperty('--checker', `${size}px`);
  return true;
}

function stackStep(count, extent) {
  if (count < 2) return 0;
  return Math.min(checkerSize, Math.max(2, (extent - checkerSize) / (count - 1)));
}

function fillStack(stack, player, count, { fromTop, selectedTop, movable, landed }) {
  stack.textContent = '';
  if (!count) return;
  const step = stackStep(count, stack.clientHeight || checkerSize * 5);
  for (let i = 0; i < count; i += 1) {
    const checker = el('div', `checker ${player === WHITE ? 'w' : 'b'}`, stack);
    checker.style[fromTop ? 'top' : 'bottom'] = `${Math.round(i * step)}px`;
    const top = i === count - 1;
    if (top && count > 5) checker.textContent = String(count);
    if (top && selectedTop) checker.classList.add('selected');
    if (top && movable) checker.classList.add('movable');
    if (top && landed) checker.classList.add('just-moved');
  }
}

/* ------------------------------------------------------------- analysis */

/**
 * The rolls table is always computed for the position the dice are (or are
 * about to be) thrown at: the live position before rolling, the turn-start
 * position while moving. Cached until that position changes.
 */
let analysisCache = { key: null, data: null };

function preRollState() {
  if (state.phase === 'roll' || state.phase === 'opening') return state;
  if (state.phase === 'move') {
    return {
      ...state,
      board: state.turnStart.board,
      bar: state.turnStart.bar,
      off: state.turnStart.off,
    };
  }
  return null;
}

function analysisKey(pre) {
  return [
    state.phase === 'move' ? 'move' : state.phase,
    state.turn,
    pre.board.join(','),
    pre.bar[1],
    pre.bar[-1],
  ].join('|');
}

function getAnalysis() {
  const pre = preRollState();
  if (!pre) return null;
  const key = analysisKey(pre);
  if (analysisCache.key !== key) {
    analysisCache = {
      key,
      data: analyzeRolls(pre, { opening: state.phase === 'opening' }),
    };
  }
  return analysisCache.data;
}

/** Record the throw that just happened, exactly once. */
function recordRollLuck(analysis) {
  if (state.phase !== 'move' || !analysis) return;
  const turn = state.history.length + 1;
  const last = luckLog.entries[luckLog.entries.length - 1];
  if (last && last.turn === turn) return;
  const result = luckOf(analysis, state.roll);
  if (!result) return;
  luckLog = recordLuck(luckLog, {
    turn,
    player: state.turn,
    roll: state.roll,
    luck: result.luck,
    rank: result.entry.rank,
    outOf: analysis.rolls.length,
  });
}

/**
 * The engine's best way to play what is left of the roll. Recomputed only
 * when the position, the dice, or how much has been played changes.
 */
let bestCache = { key: null, data: null };

function getBest() {
  if (state.phase !== 'move') return null;
  const key = [
    state.board.join(','),
    state.bar[WHITE],
    state.bar[BLACK],
    state.turn,
    String(state.roll),
    state.played.length,
  ].join('|');
  if (bestCache.key !== key) bestCache = { key, data: bestPlay(state) };
  return bestCache.data;
}

/** Roll for whoever is on turn, pricing the throw against the alternatives. */
function doRoll() {
  const analysis = getAnalysis();
  lastMove = null;
  state = state.phase === 'opening' ? rollOpening(state) : roll(state);
  recordRollLuck(analysis);
}

/* --------------------------------------------------- manual dice entry */

/** A mis-typed roll can be replaced until the first checker moves. */
function canReplaceRoll() {
  return state.phase === 'move' && state.played.length === 0;
}

function wantsDice() {
  return state.phase === 'opening' || state.phase === 'roll';
}

function dropLuckFor(turn) {
  luckLog = { entries: luckLog.entries.filter((e) => e.turn !== turn) };
}

/**
 * Play a roll the user supplied. During the opening the pair is read as
 * [White's die, Black's die] and the higher one starts.
 */
function submitRoll(dice) {
  if (busy) return false;
  if (!wantsDice() && !canReplaceRoll()) return false;

  lastMove = null;
  if (state.phase === 'opening') {
    const analysis = getAnalysis();
    state = rollOpening(state, Math.random, dice);
    recordRollLuck(analysis);
  } else {
    // Replacing: forget the roll we priced before overwriting it.
    if (state.phase === 'move') dropLuckFor(state.history.length + 1);
    const analysis = getAnalysis();
    state = startTurn(state, dice);
    recordRollLuck(analysis);
  }
  diceInput.value = '';
  diceInput.classList.remove('bad');
  sync();
  return true;
}

function trySubmitInput({ quiet = false } = {}) {
  const dice = parseRoll(diceInput.value);
  if (!dice) {
    if (!quiet && diceInput.value.trim()) {
      diceInput.classList.add('bad');
      diceNoteEl.textContent = 'Two dice, each 1–6 — for example 53.';
      diceNoteEl.classList.add('bad');
      diceNoteEl.hidden = false;
    }
    return false;
  }
  return submitRoll(dice);
}

/* --------------------------------------------------------------- render */

function availableMoves() {
  if (!dieFilter) return moves;
  const filtered = moves.filter((m) => m.die === dieFilter);
  if (filtered.length) return filtered;
  dieFilter = null;
  return moves;
}

function render() {
  moves = state.phase === 'move' && !busy ? legalMoves(state) : [];
  const avail = availableMoves();
  const persp = state.turn || WHITE;

  renderRails(persp);
  renderPoints(avail);
  renderBar(avail);
  renderTrays(avail);
  renderScores();
  renderDice();
  renderStatus();
  renderControls();
  renderLog();
  renderRolls();
  renderLuck();
  renderEngine();
  renderBest();
}

function renderRails(persp) {
  const top = [13, 14, 15, 16, 17, 18, null, 19, 20, 21, 22, 23, 24, null];
  const bottom = [12, 11, 10, 9, 8, 7, null, 6, 5, 4, 3, 2, 1, null];
  for (const [rail, points] of [
    [railTop, top],
    [railBottom, bottom],
  ]) {
    points.forEach((abs, i) => {
      rail.children[i].textContent = abs === null ? '' : String(toRel(persp, abs));
    });
  }
  railNote.textContent = `Points numbered from ${playerName(persp)}'s side.`;
}

function renderPoints(avail) {
  for (let abs = 1; abs <= 24; abs += 1) {
    const point = pointEls[abs];
    const value = state.board[abs];
    const owner = value > 0 ? WHITE : value < 0 ? BLACK : null;
    const rel = state.turn ? toRel(state.turn, abs) : null;

    const isSource = rel !== null && avail.some((m) => m.from === rel);
    const targets =
      selected === null || rel === null
        ? []
        : avail.filter((m) => m.from === selected && m.to === rel);
    const isSelected = rel !== null && selected === rel;

    point.classList.toggle('source', isSource && selected === null);
    point.classList.toggle('target', targets.length > 0);
    point.classList.toggle('hit', targets.some((m) => m.hit));

    const stack = point.querySelector('.stack');
    const extent = stack.clientHeight || checkerSize * 5;

    if (targets.length) {
      const landing = targets.some((m) => m.hit) ? 0 : Math.abs(value);
      point.style.setProperty(
        '--drop',
        `${Math.round(landing * stackStep(landing + 1, extent))}px`,
      );
    }

    fillStack(stack, owner, Math.abs(value), {
      fromTop: abs >= 13,
      selectedTop: isSelected,
      movable: isSource,
      landed: lastMove && lastMove.to === rel && rel !== null,
    });
  }
}

function renderBar(avail) {
  for (const player of [WHITE, BLACK]) {
    const node = barEls[player];
    const count = state.bar[player];
    const mine = state.turn === player;
    node.classList.toggle('source', mine && avail.some((m) => m.from === BAR));
    node.classList.toggle('selected', mine && selected === BAR);
    fillStack(node, player, count, {
      fromTop: player === WHITE,
      selectedTop: mine && selected === BAR,
      movable: mine && count > 0,
      landed: lastMove && lastMove.hit && state.turn !== player,
    });
  }
}

function renderTrays(avail) {
  for (const player of [WHITE, BLACK]) {
    const tray = trayEls[player];
    const count = state.off[player];
    const mine = state.turn === player;
    const canBearOff =
      mine &&
      selected !== null &&
      avail.some((m) => m.from === selected && m.to === OFF);
    tray.classList.toggle('target', canBearOff);

    tray.querySelectorAll('.slab').forEach((n) => n.remove());
    const fromTop = player === BLACK;
    const slabH = Math.max(4, Math.round(checkerSize * 0.3));
    const extent = tray.clientHeight - 34;
    const step =
      count > 1 ? Math.min(slabH + 2, Math.max(2, (extent - slabH) / (count - 1))) : 0;
    for (let i = 0; i < count; i += 1) {
      const slab = el('div', `slab ${player === WHITE ? 'w' : 'b'}`, tray);
      slab.style.height = `${slabH}px`;
      slab.style[fromTop ? 'top' : 'bottom'] = `${Math.round(4 + i * step)}px`;
    }
    tray.querySelector('.tray-count').textContent = count ? `${count} off` : '';
  }
}

function renderScores() {
  for (const player of [WHITE, BLACK]) {
    const card = $(player === WHITE ? 'score-white' : 'score-black');
    card.classList.toggle('on-turn', state.turn === player && state.phase !== 'over');
    card.querySelector('.pips b').textContent = String(pipCount(state, player));
    const borne = card.querySelector('.borne');
    borne.hidden = state.off[player] === 0;
    borne.textContent = `· ${state.off[player]} off`;
  }
}

const PIP_CELLS = {
  1: [[2, 2]],
  2: [
    [1, 1],
    [3, 3],
  ],
  3: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  4: [
    [1, 1],
    [1, 3],
    [3, 1],
    [3, 3],
  ],
  5: [
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 1],
    [3, 3],
  ],
  6: [
    [1, 1],
    [1, 3],
    [2, 1],
    [2, 3],
    [3, 1],
    [3, 3],
  ],
};

function dieNode(value, player, opts = {}) {
  const die = el('div', `die${player === BLACK ? ' dark' : ''}`);
  if (opts.mini) die.classList.add('mini');
  if (opts.used) die.classList.add('used');
  if (opts.pickable) die.classList.add('pickable');
  if (opts.picked) die.classList.add('picked');
  die.dataset.die = String(value);
  for (const [row, col] of PIP_CELLS[value]) {
    const pip = el('div', 'pip', die);
    pip.style.gridRow = String(row);
    pip.style.gridColumn = String(col);
  }
  return die;
}

function renderDice() {
  diceEl.textContent = '';
  if (state.phase === 'opening') {
    if (!state.openingRoll) return;
    for (const player of [WHITE, BLACK]) {
      diceEl.append(dieNode(state.openingRoll[player], player));
    }
    return;
  }
  if (!state.roll) return;

  const remaining = diceRemaining(state).slice();
  const playable = new Set(moves.map((m) => m.die));
  for (const value of diceFromRoll(state.roll)) {
    const i = remaining.indexOf(value);
    const used = i < 0;
    if (!used) remaining.splice(i, 1);
    diceEl.append(
      dieNode(value, state.turn, {
        used,
        pickable: !used && playable.has(value) && playable.size > 1,
        picked: !used && dieFilter === value,
      }),
    );
  }
}

function renderStatus() {
  statusEl.innerHTML = statusHtml();
}

function statusHtml() {
  if (state.phase === 'opening') {
    if (state.openingRoll) {
      return `Both rolled ${state.openingRoll[WHITE]} — ${
        diceMode === 'manual' ? 'enter the next pair.' : 'roll again.'
      }`;
    }
    return diceMode === 'manual'
      ? 'Enter the opening dice to see who goes first.'
      : 'Roll to see who goes first.';
  }
  if (state.phase === 'over') {
    const { winner, type, points } = state.result;
    const label =
      type === 'single' ? '' : type === 'gammon' ? ' a gammon,' : ' a backgammon,';
    return `<span class="win">${playerName(winner)} wins${label} ${points} point${
      points > 1 ? 's' : ''
    }.</span>`;
  }

  const who = `<b>${playerName(state.turn)}</b>`;
  const opening =
    state.history.length === 0 && state.openingRoll
      ? `${playerName(state.turn)} won the opening roll ${state.openingRoll[WHITE]}-${
          state.openingRoll[BLACK]
        }. `
      : '';

  if (state.phase === 'roll') {
    return diceMode === 'manual'
      ? `${opening}Enter ${playerName(state.turn)}'s roll.`
      : `${opening}${who} to roll.`;
  }
  if (state.playLength === 0) {
    return `${opening}${who} cannot move. Press Done to pass.`;
  }
  const left = state.playLength - state.played.length;
  if (left === 0) return `${who} has played the roll. Press Done.`;
  if (state.bar[state.turn] > 0) return `${who} must enter from the bar.`;
  const forced = state.mustUseDie
    ? ` Only the higher die (${state.mustUseDie}) can be played.`
    : '';
  return `${opening}${who} to move — ${left} checker${left > 1 ? 's' : ''}.${forced}`;
}

function renderControls() {
  const engineTurn = enginePlaysTurn();
  const manual = diceMode === 'manual';
  const canRoll = !busy && !engineTurn && wantsDice();

  rollBtn.hidden = manual;
  controlsEl.classList.toggle('two', manual);
  rollBtn.disabled = !canRoll;
  rollBtn.classList.toggle('ready', canRoll && !manual);

  for (const btn of diceModeEl.querySelectorAll('.seg')) {
    btn.classList.toggle('on', btn.dataset.dice === diceMode);
  }
  renderDiceEntry(manual);

  undoBtn.disabled =
    busy || engineTurn || state.phase !== 'move' || state.played.length === 0;

  const done = !busy && !engineTurn && canEndTurn(state);
  doneBtn.disabled = !done;
  doneBtn.classList.toggle('ready', done);
  doneBtn.textContent =
    state.phase === 'move' && state.playLength === 0 ? 'Pass' : 'Done';

}

function renderDiceEntry(manual) {
  const open = manual && !busy && (wantsDice() || canReplaceRoll());
  diceEntryEl.hidden = !open;
  diceSetBtn.disabled = !open;

  if (!open) {
    diceNoteEl.hidden = true;
    diceNoteEl.classList.remove('bad');
    return;
  }
  // A live error message survives until the next successful entry.
  if (diceNoteEl.classList.contains('bad') && diceInput.value.trim()) return;

  diceNoteEl.classList.remove('bad');
  diceNoteEl.hidden = false;
  if (state.phase === 'opening') {
    diceNoteEl.textContent =
      "Both opening dice, White's first — the higher one starts.";
  } else if (state.phase === 'roll') {
    diceNoteEl.textContent = `${playerName(state.turn)}'s two dice, or click a row in Rolls.`;
  } else {
    diceNoteEl.textContent = 'Enter a new roll to correct this one.';
  }
}

function fmtEq(v, digits = 2) {
  const abs = Math.abs(v).toFixed(digits);
  if (Number(abs) === 0) return abs; // an honest zero, no sign
  return `${v > 0 ? '+' : '−'}${abs}`;
}

/** Polarity class for a value at display precision; zero stays neutral. */
function luckClass(v, digits = 2) {
  if (Number(Math.abs(v).toFixed(digits)) === 0) return '';
  return v > 0 ? 'luck-pos' : 'luck-neg';
}

function luckBadge(luck) {
  const span = el('span', 'luck-badge luck-num');
  const cls = luckClass(luck);
  if (cls) span.classList.add(cls);
  span.textContent = fmtEq(luck);
  span.title = 'Luck of this roll (equity vs the average roll)';
  return span;
}

function logRow(index, player, roll, text, extra = '') {
  const li = el('li', extra);
  const n = el('span', 'n', li);
  n.textContent = index === null ? '' : `${index}.`;
  el('span', `side ${player === WHITE ? 'w' : 'b'}`, li);
  const r = el('span', 'roll', li);
  r.textContent = roll ? `${roll[0]}-${roll[1]}` : '';
  const play = el('span', 'play', li);
  play.textContent = text;
  return li;
}

function renderLog() {
  logEl.textContent = '';
  const luckByTurn = new Map(luckLog.entries.map((e) => [e.turn, e]));
  for (const entry of state.history) {
    const li = logRow(entry.index, entry.player, entry.roll, notateMoves(entry.moves));
    const luck = luckByTurn.get(entry.index);
    if (luck) li.append(luckBadge(luck.luck));
    logEl.append(li);
  }
  if (state.phase === 'move') {
    const li = logRow(
      state.history.length + 1,
      state.turn,
      state.roll,
      state.played.length ? notateMoves(state.played) : '…',
      'current',
    );
    const luck = luckByTurn.get(state.history.length + 1);
    if (luck) li.append(luckBadge(luck.luck));
    logEl.append(li);
  }
  if (state.phase === 'over') {
    const li = el('li', 'result');
    li.textContent = `${playerName(state.result.winner)} wins ${
      state.result.points
    } point${state.result.points > 1 ? 's' : ''}`;
    logEl.append(li);
  }
  if (!logEl.children.length) {
    const li = el('li', 'empty');
    li.textContent = 'No moves yet.';
    logEl.append(li);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

/* ------------------------------------------------------- rolls panel */

function renderRolls() {
  rollsEl.textContent = '';

  if (state.phase === 'over') {
    rollsContext.textContent = 'game over';
    const li = el('li', 'empty', rollsEl);
    li.textContent = 'No more rolls to price.';
    return;
  }

  const analysis = getAnalysis();
  if (!analysis) return;

  const player = analysis.player;
  const actual =
    state.phase === 'move'
      ? [Math.max(state.roll[0], state.roll[1]), Math.min(state.roll[0], state.roll[1])]
      : null;

  if (state.phase === 'opening') {
    rollsContext.textContent = 'opening throw (doubles rethrown)';
  } else if (actual) {
    const entry = analysis.rolls.find(
      (r) => r.dice[0] === actual[0] && r.dice[1] === actual[1],
    );
    rollsContext.textContent = `${playerName(player)} rolled ${actual[0]}-${
      actual[1]
    } — rank ${entry.rank}/${analysis.rolls.length}`;
  } else {
    rollsContext.textContent = `if ${playerName(player)} rolls…`;
  }

  const maxDelta = Math.max(
    1e-9,
    ...analysis.rolls.map((r) => Math.abs(r.delta)),
  );

  // While transcribing, a row is a one-click way to say "this is what fell".
  // Not during the opening: a row shows a pair, not which side threw which.
  const pickable =
    diceMode === 'manual' &&
    !busy &&
    state.phase !== 'opening' &&
    (wantsDice() || canReplaceRoll());

  for (const r of analysis.rolls) {
    const li = el('li', null, rollsEl);
    if (r === analysis.median) li.classList.add('median-row');
    const isActual = actual && r.dice[0] === actual[0] && r.dice[1] === actual[1];
    if (isActual) li.classList.add('rolled');
    if (pickable) {
      li.classList.add('pickable');
      li.dataset.roll = `${r.dice[0]}${r.dice[1]}`;
    }
    // 1 ply here: 21 rolls times every play is far too much work at 2 ply,
    // so these read a touch differently from the 2-ply Best play card.
    li.title =
      `${pickable ? 'Play ' : ''}${r.dice[0]}-${r.dice[1]}: ` +
      `best ${r.notation} (${fmtEq(r.eq, 3)} at 1 ply)`;

    const rank = el('span', 'rank', li);
    rank.textContent = String(r.rank);

    const dice = el('span', 'dice-mini', li);
    dice.append(
      dieNode(r.dice[0], player, { mini: true }),
      dieNode(r.dice[1], player, { mini: true }),
    );

    const eq = el('span', 'eq luck-num', li);
    eq.textContent = fmtEq(r.eq);

    const delta = el('span', 'delta', li);
    const fill = el('span', `fill ${r.delta >= 0 ? 'pos' : 'neg'}`, delta);
    fill.style.width = `${(Math.abs(r.delta) / maxDelta) * 50}%`;

    const tag = el('span', 'tag', li);
    if (isActual) {
      const luck = r.eq - analysis.mean;
      tag.textContent = fmtEq(luck);
      tag.classList.add('luck-num');
      const cls = luckClass(luck);
      if (cls) tag.classList.add(cls);
      tag.title = 'Luck: equity vs the average roll';
    } else if (r === analysis.median) {
      tag.textContent = 'median';
    }
  }
}

/* --------------------------------------------------------- luck panel */

function renderLuckSide(id, side) {
  const node = $(id);
  node.querySelector('.total').textContent = fmtEq(side.total);
  node.querySelector('.total').className = `total luck-num ${luckClass(side.total)}`;
  node.querySelector('.per').textContent = side.count
    ? `avg ${fmtEq(side.avg)} · ${side.count} roll${side.count > 1 ? 's' : ''}`
    : 'no rolls yet';
}

function renderLuck() {
  const summary = luckSummary(luckLog);
  renderLuckSide('luck-white', summary.white);
  renderLuckSide('luck-black', summary.black);
  drawLuckChart(summary);
}

function drawLuckChart(summary) {
  const { series } = summary;
  luckChartEl.textContent = '';
  if (series.length < 2) {
    const p = el('p', 'luck-empty', luckChartEl);
    p.textContent = 'The luck lines appear after a few rolls.';
    return;
  }

  const W = 264;
  const H = 116;
  const pad = { l: 30, r: 20, t: 8, b: 12 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  let lo = 0;
  let hi = 0;
  for (const p of series) {
    lo = Math.min(lo, p.cumWhite, p.cumBlack);
    hi = Math.max(hi, p.cumWhite, p.cumBlack);
  }
  const span = Math.max(0.2, hi - lo);
  lo -= span * 0.08;
  hi += span * 0.08;

  const x = (i) => pad.l + (i / (series.length - 1)) * iw;
  const y = (v) => pad.t + ((hi - v) / (hi - lo)) * ih;

  const pts = (key) =>
    series.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const mk = (tag, attrs, parent = svg) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.append(node);
    return node;
  };

  // Recessive frame: a zero line and min/max gridlines with tick labels.
  mk('line', { class: 'zero', x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0) });
  const t0 = mk('text', { class: 'tick-label', x: pad.l - 4, y: y(0) + 3, 'text-anchor': 'end' });
  t0.textContent = '0';

  for (const line of [
    { key: 'cumWhite', cls: 'white' },
    { key: 'cumBlack', cls: 'black' },
  ]) {
    mk('polyline', { class: `line ${line.cls}`, points: pts(line.key) });
  }

  // The highs and lows: mark each side's running peak and trough.
  for (const [key, cls] of [
    ['cumWhite', 'white'],
    ['cumBlack', 'black'],
  ]) {
    let iMax = 0;
    let iMin = 0;
    series.forEach((p, i) => {
      if (p[key] > series[iMax][key]) iMax = i;
      if (p[key] < series[iMin][key]) iMin = i;
    });
    for (const i of new Set([iMax, iMin])) {
      mk('circle', {
        class: `extreme ${cls}`,
        cx: x(i).toFixed(1),
        cy: y(series[i][key]).toFixed(1),
        r: 3.5,
      });
    }
    const last = series[series.length - 1];
    const label = mk('text', {
      class: 'end-label',
      x: W - pad.r + 3,
      y: (y(last[key]) + 3).toFixed(1),
    });
    label.textContent = cls === 'white' ? 'W' : 'B';
  }

  luckChartEl.append(svg);

  const legend = el('div', 'luck-legend', luckChartEl);
  for (const [cls, name] of [
    ['white', 'White'],
    ['black', 'Black'],
  ]) {
    const item = el('span', null, legend);
    el('span', `swatch ${cls}`, item);
    item.append(name);
  }

  // Hover: nearest roll event, both totals.
  const tip = el('div', 'luck-tip', luckChartEl);
  svg.addEventListener('mousemove', (event) => {
    const rect = svg.getBoundingClientRect();
    const fx = ((event.clientX - rect.left) / rect.width) * W;
    const i = Math.max(
      0,
      Math.min(series.length - 1, Math.round(((fx - pad.l) / iw) * (series.length - 1))),
    );
    const p = series[i];
    const e = luckLog.entries[i];
    tip.innerHTML =
      `<b>${playerName(e.player)}</b> rolled ${e.roll[0]}-${e.roll[1]} ` +
      `(rank ${e.rank}/${e.outOf})<br>` +
      `luck <b class="${luckClass(e.luck)}">${fmtEq(e.luck)}</b>` +
      `<br>totals W ${fmtEq(p.cumWhite)} · B ${fmtEq(p.cumBlack)}`;
    tip.style.left = `${(x(i) / W) * 100}%`;
    tip.style.top = '0px';
    tip.style.display = 'block';
  });
  svg.addEventListener('mouseleave', () => {
    tip.style.display = 'none';
  });
}

/* -------------------------------------------------------- engine card */

function renderEngine() {
  const engine = getEngine() || fathom;
  engineNameEl.textContent = engine.name || 'Engine';
  engineDescEl.textContent = busy
    ? 'thinking…'
    : engine.description || '';

  const eq = evaluate(state);
  const clamped = Math.max(-2, Math.min(2, eq));
  const frac = Math.abs(clamped) / 2 / 2; // half-track at ±2
  if (clamped >= 0) {
    evalbarFill.className = 'evalbar-fill white';
    evalbarFill.style.right = '50%';
    evalbarFill.style.left = `${50 - frac * 100}%`;
  } else {
    evalbarFill.className = 'evalbar-fill black';
    evalbarFill.style.left = '50%';
    evalbarFill.style.right = `${50 - frac * 100}%`;
  }
  evalbarNum.textContent = fmtEq(eq);
  evalbarNum.title = `Cubeless equity for White: ${fmtEq(eq, 3)}`;

  for (const btn of enginePlaysEl.querySelectorAll('.seg')) {
    btn.classList.toggle('on', btn.dataset.plays === enginePlays);
  }
}

/* ------------------------------------------------------ best play */

function renderBest() {
  bestToggle.classList.toggle('on', showBest);
  bestToggle.textContent = showBest ? 'Shown' : 'Hidden';

  if (!showBest) {
    bestPlayEl.className = 'best-play muted';
    bestPlayEl.textContent = 'Hidden — press B to show.';
    bestEqEl.textContent = '';
    drawBestOverlay(null);
    return;
  }

  const best = state.phase === 'move' && !busy ? getBest() : null;
  if (!best) {
    bestPlayEl.className = 'best-play muted';
    bestPlayEl.textContent =
      state.phase === 'move' ? 'Nothing left to play.' : 'Waiting for the dice.';
    bestEqEl.textContent = '';
    drawBestOverlay(null);
    return;
  }

  bestPlayEl.className = 'best-play';
  bestPlayEl.textContent = best.notation;
  bestEqEl.textContent =
    best.margin === null || best.choices < 2
      ? 'only play'
      : `${fmtEq(best.equity)} · +${Math.abs(best.margin).toFixed(2)} over 2nd`;
  bestEqEl.title =
    `Equity ${fmtEq(best.equity, 3)} for ${playerName(state.turn)} after this play, ` +
    `chosen from ${best.choices} legal ${best.choices === 1 ? 'play' : 'plays'}.`;
  drawBestOverlay(best);
}

/** Where an arrow should start or end for a relative point. */
function anchorFor(rel) {
  const turn = state.turn;
  const svgRect = overlayEl.getBoundingClientRect();
  let node;
  let middle = false;
  if (rel === BAR) {
    node = barEls[turn];
    middle = true;
  } else if (rel === OFF) {
    node = trayEls[turn];
    middle = true;
  } else {
    node = pointEls[toAbs(turn, rel)];
  }
  if (!node) return null;

  const r = node.getBoundingClientRect();
  const x = r.left + r.width / 2 - svgRect.left;
  if (middle) return { x, y: r.top + r.height / 2 - svgRect.top };
  // Sit inside the triangle rather than on the board edge.
  const abs = toAbs(turn, rel);
  const y =
    abs >= 13 ? r.top + r.height * 0.32 : r.bottom - r.height * 0.32;
  return { x, y: y - svgRect.top };
}

function svg(tag, attrs, parent = overlayEl) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.append(node);
  return node;
}

/**
 * Draw the best play as arrows on the board. Identical moves collapse into
 * one arrow carrying a count, so `13/11(2)` is a single marked arrow.
 */
function drawBestOverlay(best) {
  if (!overlayEl) return;
  overlayEl.textContent = '';
  if (!best || !best.moves.length || !state.turn) return;

  const grouped = new Map();
  for (const move of best.moves) {
    const key = `${move.from}>${move.to}`;
    const seen = grouped.get(key);
    if (seen) seen.count += 1;
    else grouped.set(key, { move, count: 1 });
  }

  for (const { move, count } of grouped.values()) {
    const a = anchorFor(move.from);
    const b = anchorFor(move.to);
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Bow the arrow so overlapping ones stay apart and read as paths.
    const bow = Math.min(26, len * 0.17);
    const cx = (a.x + b.x) / 2 - (dy / len) * bow;
    const cy = (a.y + b.y) / 2 + (dx / len) * bow;

    // Stop short of the destination so the head sits clear of the checkers.
    const tanX = b.x - cx;
    const tanY = b.y - cy;
    const tanLen = Math.hypot(tanX, tanY) || 1;
    const ux = tanX / tanLen;
    const uy = tanY / tanLen;
    const gap = Math.min(11, len * 0.3);
    const tip = { x: b.x - ux * gap, y: b.y - uy * gap };

    const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(
      1,
    )} ${tip.x.toFixed(1)} ${tip.y.toFixed(1)}`;

    const size = 9;
    const wing = size * 0.55;
    const head = [
      `${(tip.x + ux * size).toFixed(1)},${(tip.y + uy * size).toFixed(1)}`,
      `${(tip.x - uy * wing).toFixed(1)},${(tip.y + ux * wing).toFixed(1)}`,
      `${(tip.x + uy * wing).toFixed(1)},${(tip.y - ux * wing).toFixed(1)}`,
    ].join(' ');

    svg('path', { class: 'halo', d });
    svg('polygon', { class: 'head-halo', points: head });
    svg('path', { class: 'shaft', d });
    svg('polygon', { class: 'head', points: head });
    svg('circle', { class: 'from-dot', cx: a.x.toFixed(1), cy: a.y.toFixed(1), r: 3.5 });

    if (count > 1) {
      const mx = 0.25 * a.x + 0.5 * cx + 0.25 * tip.x;
      const my = 0.25 * a.y + 0.5 * cy + 0.25 * tip.y;
      svg('circle', { class: 'count-bg', cx: mx.toFixed(1), cy: my.toFixed(1), r: 8 });
      const label = svg('text', {
        class: 'count-text',
        x: mx.toFixed(1),
        y: my.toFixed(1),
      });
      label.textContent = `×${count}`;
    }
  }
}

/* ---------------------------------------------------------- interaction */

function preferred(candidates) {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => {
    const exactA = a.to === OFF && a.die === a.from ? 0 : 1;
    const exactB = b.to === OFF && b.die === b.from ? 0 : 1;
    return exactA - exactB || a.die - b.die;
  })[0];
}

function sync() {
  selected = null;
  if (state.phase === 'move') {
    const next = legalMoves(state);
    if (state.bar[state.turn] > 0 && next.some((m) => m.from === BAR)) selected = BAR;
  } else {
    dieFilter = null;
  }
  save();
  render();
  focusDiceEntry();
  scheduleEngine();
}

/** Keep the caret in the dice box while transcribing, never steal it. */
function focusDiceEntry() {
  if (diceEntryEl.hidden || !wantsDice()) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== diceInput) return;
  diceInput.focus();
  diceInput.select();
}

function doMove(move) {
  state = applyMove(state, move);
  lastMove = move;
  dieFilter = null;
  selected = null;
  sync();
}

function onPoint(abs) {
  const rel = toRel(state.turn, abs);
  const avail = availableMoves();
  if (selected !== null) {
    const move = preferred(avail.filter((m) => m.from === selected && m.to === rel));
    if (move) return doMove(move);
  }
  if (avail.some((m) => m.from === rel)) {
    selected = selected === rel ? null : rel;
  } else {
    selected = null;
  }
  render();
}

function onTray(player) {
  if (player !== state.turn || selected === null) return;
  const move = preferred(
    availableMoves().filter((m) => m.from === selected && m.to === OFF),
  );
  if (move) doMove(move);
}

function onBar(player) {
  if (player !== state.turn) return;
  if (availableMoves().some((m) => m.from === BAR)) {
    selected = selected === BAR ? null : BAR;
    render();
  }
}

boardEl.addEventListener('click', (event) => {
  if (busy || enginePlaysTurn() || state.phase !== 'move' || !state.turn) return;
  const point = event.target.closest('[data-point]');
  if (point) return onPoint(Number(point.dataset.point));
  const tray = event.target.closest('[data-tray]');
  if (tray) return onTray(Number(tray.dataset.tray));
  const bar = event.target.closest('[data-bar]');
  if (bar) return onBar(Number(bar.dataset.bar));
});

diceEl.addEventListener('click', (event) => {
  const die = event.target.closest('.die.pickable');
  if (!die) return;
  const value = Number(die.dataset.die);
  dieFilter = dieFilter === value ? null : value;
  if (selected !== null && !availableMoves().some((m) => m.from === selected)) {
    selected = null;
  }
  render();
});

rollBtn.addEventListener('click', () => {
  if (rollBtn.disabled) return;
  doRoll();
  sync();
});

diceModeEl.addEventListener('click', (event) => {
  const btn = event.target.closest('.seg');
  if (!btn) return;
  diceMode = btn.dataset.dice;
  diceInput.value = '';
  diceInput.classList.remove('bad');
  diceNoteEl.classList.remove('bad');
  engineToken += 1;
  busy = false;
  sync();
});

diceSetBtn.addEventListener('click', () => trySubmitInput());

diceInput.addEventListener('input', () => {
  // A die can only be 1-6, so anything else never makes it into the box —
  // silence would just look like a dropped keystroke, hence the note.
  const cleaned = diceInput.value.replace(/[^1-6\s,\-/x]/gi, '');
  if (cleaned !== diceInput.value) {
    diceInput.value = cleaned;
    diceInput.classList.add('bad');
    diceNoteEl.textContent = 'Dice run 1–6.';
    diceNoteEl.classList.add('bad');
    diceNoteEl.hidden = false;
    return;
  }
  diceInput.classList.remove('bad');
  diceNoteEl.classList.remove('bad');
  // Typing the second digit is the whole gesture — don't make them hit Enter.
  trySubmitInput({ quiet: true });
});

diceInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  trySubmitInput();
});

rollsEl.addEventListener('click', (event) => {
  const row = event.target.closest('li.pickable');
  if (!row) return;
  const dice = parseRoll(row.dataset.roll);
  if (dice) submitRoll(dice);
});

undoBtn.addEventListener('click', () => {
  if (undoBtn.disabled) return;
  lastMove = null;
  state = undoMove(state);
  sync();
});

doneBtn.addEventListener('click', () => {
  if (doneBtn.disabled) return;
  lastMove = null;
  state = endTurn(state);
  sync();
});

newGameBtn.addEventListener('click', () => {
  const inProgress = state.phase !== 'opening' && state.phase !== 'over';
  if (inProgress && !window.confirm('Start a new game? The current one is lost.')) {
    return;
  }
  engineToken += 1;
  busy = false;
  state = newGame();
  luckLog = emptyLuckLog();
  analysisCache = { key: null, data: null };
  lastMove = null;
  sync();
});

bestToggle.addEventListener('click', () => {
  showBest = !showBest;
  save();
  render();
});

copyBtn.addEventListener('click', async () => {
  const luckByTurn = new Map(luckLog.entries.map((e) => [e.turn, e]));
  const lines = state.history.map((e) => {
    const luck = luckByTurn.get(e.index);
    const suffix = luck ? `  [luck ${fmtEq(luck.luck)}]` : '';
    return `${e.index}. ${e.player === WHITE ? 'W' : 'B'} ${e.roll[0]}${e.roll[1]}: ${notateMoves(e.moves)}${suffix}`;
  });
  const summary = luckSummary(luckLog);
  if (luckLog.entries.length) {
    lines.push(
      `Luck totals: White ${fmtEq(summary.white.total)} (avg ${fmtEq(summary.white.avg)}), ` +
        `Black ${fmtEq(summary.black.total)} (avg ${fmtEq(summary.black.avg)})`,
    );
  }
  if (state.result) {
    lines.push(
      `${playerName(state.result.winner)} wins ${state.result.points} point${
        state.result.points > 1 ? 's' : ''
      } (${state.result.type})`,
    );
  }
  const text = lines.join('\n') || 'No moves yet.';
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied';
  } catch {
    copyBtn.textContent = 'Press ⌘C';
    console.log(text);
  }
  setTimeout(() => {
    copyBtn.textContent = 'Copy';
  }, 1400);
});

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.matches('input, textarea, select')) return;
  const key = event.key.toLowerCase();
  if (key === 'r' && !rollBtn.disabled) rollBtn.click();
  else if (key === 'u' && !undoBtn.disabled) undoBtn.click();
  else if (key === 'b') bestToggle.click();
  else if (event.key === 'Enter' && !doneBtn.disabled) doneBtn.click();
  else if (event.key === 'Escape') {
    selected = null;
    dieFilter = null;
    render();
  } else return;
  event.preventDefault();
});

/* -------------------------------------------------------------- storage */

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 2,
        state,
        luck: luckLog,
        plays: enginePlays,
        dice: diceMode,
        best: showBest,
      }),
    );
  } catch {
    /* private mode, quota — the game just won't survive a reload */
  }
}

function validState(saved) {
  return (
    saved &&
    Array.isArray(saved.board) &&
    saved.board.length === 25 &&
    saved.bar &&
    saved.off &&
    Array.isArray(saved.history)
  );
}

function load() {
  state = newGame();
  luckLog = emptyLuckLog();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && saved.v === 2 && validState(saved.state)) {
      state = saved.state;
      luckLog = reviveLuckLog(saved.luck);
      if (['off', 'white', 'black', 'both'].includes(saved.plays)) {
        enginePlays = saved.plays;
      }
      if (saved.dice === 'manual' || saved.dice === 'random') diceMode = saved.dice;
      if (typeof saved.best === 'boolean') showBest = saved.best;
    } else if (validState(saved)) {
      state = saved; // pre-analysis save format
    }
  } catch {
    /* fall through to a fresh game */
  }
}

/* --------------------------------------------------------------- engine */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sideEnabled(player) {
  if (enginePlays === 'both') return true;
  if (enginePlays === 'white') return player === WHITE;
  if (enginePlays === 'black') return player === BLACK;
  return false;
}

function enginePlaysTurn() {
  if (state.phase === 'opening') return enginePlays === 'both';
  if (state.phase !== 'roll' && state.phase !== 'move') return false;
  return sideEnabled(state.turn);
}

function scheduleEngine() {
  if (busy || !enginePlaysTurn()) return;
  // With manual dice the engine waits for the roll to be typed in.
  if (diceMode === 'manual' && state.phase !== 'move') return;
  const token = engineToken;
  setTimeout(() => {
    if (token === engineToken) runEngine();
  }, Math.min(400, delays.move));
}

async function runEngine() {
  if (busy || !enginePlaysTurn()) return;
  const token = engineToken;
  busy = true;
  render();
  try {
    if (wantsDice() && diceMode !== 'manual') {
      doRoll();
      render();
      await wait(delays.roll);
      if (token !== engineToken) return;
    }
    // An opening tie leaves us still in 'opening'; try again next round.
    if (state.phase === 'move' && sideEnabled(state.turn)) {
      const plays = legalPlays(state);
      const engine = getEngine() || fathom;
      let choice = await engine.choosePlay(state, plays);
      if (token !== engineToken) return;
      if (!Array.isArray(choice)) choice = plays[0] || [];
      for (const move of choice) {
        state = applyMove(state, move);
        lastMove = move;
        busy = false;
        render();
        busy = true;
        await wait(delays.move);
        if (token !== engineToken) return;
      }
      if (canEndTurn(state)) state = endTurn(state);
    }
  } catch (error) {
    console.error('engine failed, handing the turn back', error);
  } finally {
    if (token === engineToken) {
      busy = false;
      lastMove = null;
      sync();
    }
  }
}

enginePlaysEl.addEventListener('click', (event) => {
  const btn = event.target.closest('.seg');
  if (!btn) return;
  enginePlays = btn.dataset.plays;
  engineToken += 1;
  busy = false;
  sync();
});

onEngineRegistered(() => {
  render();
  scheduleEngine();
});

/* ----------------------------------------------------------------- boot */

window.Gammon = Object.assign(window.Gammon || {}, {
  setDelay(rollMs, moveMs = rollMs) {
    delays = { roll: rollMs, move: moveMs };
  },
});

buildBoard();
measure();
// A reload mid-turn may not have priced the live roll yet.
if (state.phase === 'move') recordRollLuck(getAnalysis());
sync();

let pending = false;
new ResizeObserver(() => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    measure();
    render();
  });
}).observe(boardEl);
