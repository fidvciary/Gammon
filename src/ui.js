/**
 * Board, dice, and move log. All rules live in game.js — this file only
 * renders a state and turns clicks into legal moves.
 */

import {
  WHITE,
  BLACK,
  BAR,
  OFF,
  newGame,
  roll,
  rollOpening,
  legalMoves,
  legalPlays,
  applyMove,
  undoMove,
  canEndTurn,
  endTurn,
  pipCount,
  toRel,
  playerName,
  diceRemaining,
  diceFromRoll,
} from './game.js';
import { notateMoves } from './notation.js';
import { getEngine, onEngineRegistered } from './engine.js';

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
const cpuToggle = $('cpu-toggle');
const cpuBlack = $('cpu-black');
const engineName = $('engine-name');

const STORAGE_KEY = 'gammon.state.v1';

let state = load() || newGame();
let selected = null; // relative point (or BAR) the player has picked up
let dieFilter = null; // restrict moves to this die value
let lastMove = null; // for the landing animation
let moves = []; // legal moves for the current state
let busy = false; // an engine is playing; ignore input
let checkerSize = 28;

/* ---------------------------------------------------------------- build */

const pointEls = new Array(25);
const barEls = {};
const trayEls = {};

/** Which grid cell an absolute point sits in. Point 1 is bottom right. */
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

  // White enters from the bar into the top right quadrant, Black into the
  // bottom right, so each side waits on the half it is heading for.
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

/** Stack `count` checkers along `extent` px, overlapping only when needed. */
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
      // Put the drop marker where the checker will come to rest. A checker
      // that hits lands on the bottom of an otherwise empty point.
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
    // Keep the far end of the tray clear for the "n off" label.
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

function dieNode(value, player, { used = false, pickable = false, picked = false } = {}) {
  const die = el('div', `die${player === BLACK ? ' dark' : ''}`);
  if (used) die.classList.add('used');
  if (pickable) die.classList.add('pickable');
  if (picked) die.classList.add('picked');
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
      const wrap = el('div', 'die-pair', diceEl);
      wrap.append(dieNode(state.openingRoll[player], player));
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
    return state.openingRoll
      ? `Both rolled ${state.openingRoll[WHITE]} — roll again.`
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

  if (state.phase === 'roll') return `${opening}${who} to roll.`;

  if (state.playLength === 0) {
    return `${opening}${who} cannot move. Press Done to pass.`;
  }
  const left = state.playLength - state.played.length;
  if (left === 0) return `${who} has played the roll. Press Done.`;
  if (state.bar[state.turn] > 0) {
    return `${who} must enter from the bar.`;
  }
  const forced = state.mustUseDie
    ? ` Only the higher die (${state.mustUseDie}) can be played.`
    : '';
  return `${opening}${who} to move — ${left} checker${left > 1 ? 's' : ''}.${forced}`;
}

function renderControls() {
  const canRoll = !busy && (state.phase === 'opening' || state.phase === 'roll');
  rollBtn.disabled = !canRoll;
  rollBtn.classList.toggle('ready', canRoll);

  undoBtn.disabled = busy || state.phase !== 'move' || state.played.length === 0;

  const done = !busy && canEndTurn(state);
  doneBtn.disabled = !done;
  doneBtn.classList.toggle('ready', done);
  doneBtn.textContent =
    state.phase === 'move' && state.playLength === 0 ? 'Pass' : 'Done';
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
  for (const entry of state.history) {
    logEl.append(
      logRow(entry.index, entry.player, entry.roll, notateMoves(entry.moves)),
    );
  }
  if (state.phase === 'move') {
    logEl.append(
      logRow(
        state.history.length + 1,
        state.turn,
        state.roll,
        state.played.length ? notateMoves(state.played) : '…',
        'current',
      ),
    );
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

/* ---------------------------------------------------------- interaction */

/**
 * When several dice reach the same square — only possible when bearing off —
 * spend the exact one first, then the smallest.
 */
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
    // Entering from the bar is compulsory, so pick it up for them.
    const next = legalMoves(state);
    if (state.bar[state.turn] > 0 && next.some((m) => m.from === BAR)) selected = BAR;
  } else {
    dieFilter = null;
  }
  save();
  render();
  scheduleEngine();
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
  if (busy || state.phase !== 'move' || !state.turn) return;
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
  lastMove = null;
  state = state.phase === 'opening' ? rollOpening(state) : roll(state);
  sync();
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
  state = newGame();
  lastMove = null;
  sync();
});

copyBtn.addEventListener('click', async () => {
  const lines = state.history.map(
    (e) =>
      `${e.index}. ${e.player === WHITE ? 'W' : 'B'} ${e.roll[0]}${e.roll[1]}: ${
        notateMoves(e.moves)
      }`,
  );
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode, quota — the game just won't survive a reload */
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.board) || saved.board.length !== 25) return null;
    if (!saved.bar || !saved.off || !Array.isArray(saved.history)) return null;
    return saved;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- engine */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function enginePlays(player) {
  return player === BLACK && cpuBlack.checked && Boolean(getEngine());
}

function scheduleEngine() {
  if (busy || !enginePlays(state.turn)) return;
  if (state.phase !== 'roll' && state.phase !== 'move') return;
  setTimeout(runEngine, 500);
}

async function runEngine() {
  if (busy || !enginePlays(state.turn)) return;
  busy = true;
  render();
  try {
    if (state.phase === 'roll') {
      state = roll(state);
      render();
      await wait(600);
    }
    if (state.phase === 'move') {
      const plays = legalPlays(state);
      let choice = await getEngine().choosePlay(state, plays);
      if (!Array.isArray(choice)) choice = plays[0] || [];
      for (const move of choice) {
        state = applyMove(state, move);
        lastMove = move;
        busy = false; // let render show the board mid-play
        render();
        busy = true;
        await wait(450);
      }
      if (canEndTurn(state)) state = endTurn(state);
    }
  } catch (error) {
    console.error('engine failed, handing the turn back', error);
  } finally {
    busy = false;
    lastMove = null;
  }
  sync();
}

function refreshEngineUI() {
  const engine = getEngine();
  cpuToggle.hidden = !engine;
  if (engine) engineName.textContent = engine.name || 'engine';
}

cpuBlack.addEventListener('change', scheduleEngine);
onEngineRegistered(() => {
  refreshEngineUI();
  scheduleEngine();
});

/* ----------------------------------------------------------------- boot */

buildBoard();
measure();
refreshEngineUI();
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
