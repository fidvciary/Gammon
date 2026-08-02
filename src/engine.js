/**
 * Where a move-picking engine plugs in. There is no engine here — this is the
 * socket it screws into.
 *
 * An engine is any object shaped like:
 *
 *   {
 *     name: 'my engine',
 *     choosePlay(state, plays) {
 *       // `plays` is every legal way to play the current roll in full, each
 *       // one an array of moves. Return one of them (or a promise of one).
 *       return plays[0];
 *     }
 *   }
 *
 * Register it before or after the page loads, from a module or a plain script:
 *
 *   import { registerEngine } from './src/engine.js';
 *   registerEngine(myEngine);
 *
 *   // or, from anything compiled to a classic script:
 *   window.Gammon.registerEngine(myEngine);
 *
 * Once one is registered the "Black: <name>" toggle appears in the header.
 */

const engines = [];
const listeners = new Set();

export function registerEngine(engine) {
  if (!engine || typeof engine.choosePlay !== 'function') {
    throw new TypeError('an engine needs a choosePlay(state, plays) method');
  }
  engines.push(engine);
  for (const listener of listeners) listener(engine);
  return engine;
}

/** The engine the UI will use, or null while none is registered. */
export function getEngine() {
  return engines.length ? engines[engines.length - 1] : null;
}

export function onEngineRegistered(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== 'undefined') {
  window.Gammon = Object.assign(window.Gammon || {}, {
    registerEngine,
    getEngine,
  });
}
