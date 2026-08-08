/**
 * state.js: a tiny observable store so the vanilla-JS UI stays declarative
 * without pulling in a framework.
 */
export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();

  return {
    getState: () => state,
    /** setState(partial) or setState(fn(current) → partial) */
    setState(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      if (!next) return;
      state = { ...state, ...next };
      for (const fn of listeners) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(state); // immediate replay
      return () => listeners.delete(fn);
    },
  };
}
