/**
 * worker.js: web worker entry. Runs the analysis pipeline off the main
 * thread so heavy Fourier computations (16k samples × up to 500 harmonics)
 * never block drawing or UI interactions.
 */
import { computeAnalysis } from './analysis.js';

self.onmessage = (e) => {
  const { id, ...params } = e.data || {};
  const result = computeAnalysis(params);
  self.postMessage({ id, ...result });
};

self.onerror = (e) => {
  // Ensure the UI never hangs in "COMPUTING…" if the worker dies.
  self.postMessage({ id: -1, error: String(e.message || 'worker error') });
};
