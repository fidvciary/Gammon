/**
 * Standard backgammon move notation, from the mover's point of view.
 *
 *   13/7      a checker from the 13-point to the 7-point
 *   bar/20    entering from the bar
 *   6/off     bearing off
 *   8/4*      the move hit a blot
 *   13/11(2)  the same move made twice
 *   bar/22/16 one checker played with both dice
 */

import { BAR, OFF } from './game.js';

function pointLabel(point) {
  if (point === BAR) return 'bar';
  if (point === OFF) return 'off';
  return String(point);
}

export function formatMove(move) {
  return `${pointLabel(move.from)}/${pointLabel(move.to)}${move.hit ? '*' : ''}`;
}

/**
 * Render a whole turn. Consecutive moves of the same checker are chained
 * (13/9/7), and identical moves are grouped with a count.
 */
export function notateMoves(moves) {
  if (!moves.length) return 'no play';

  const chains = [];
  for (const move of moves) {
    const target = pointLabel(move.to) + (move.hit ? '*' : '');
    // Continue the most recent chain that ended where this move starts.
    let chain = null;
    for (let i = chains.length - 1; i >= 0; i -= 1) {
      if (chains[i].open && chains[i].last === move.from) {
        chain = chains[i];
        break;
      }
    }
    if (chain) {
      chain.parts.push(target);
      chain.last = move.to;
      chain.open = move.to !== OFF;
    } else {
      chains.push({
        parts: [pointLabel(move.from), target],
        last: move.to,
        open: move.to !== OFF,
      });
    }
  }

  const rendered = chains.map((c) => c.parts.join('/'));
  const counts = new Map();
  for (const text of rendered) counts.set(text, (counts.get(text) || 0) + 1);

  const seen = new Set();
  const out = [];
  for (const text of rendered) {
    if (seen.has(text)) continue;
    seen.add(text);
    const n = counts.get(text);
    out.push(n > 1 ? `${text}(${n})` : text);
  }
  return out.join(' ');
}

export function notateTurn(entry) {
  return `${entry.roll[0]}${entry.roll[1]}: ${notateMoves(entry.moves)}`;
}
