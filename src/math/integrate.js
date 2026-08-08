/**
 * integrate.js: numerical and exact integration for piecewise analyses.
 *
 * Riemann-style methods approximate ∫f dx with slices; the "lebesgue"
 * method integrates level-sets:  ∫₀^∞ λ{x : f(x) ≥ t} dt − ∫₋∞⁰ λ{x : f(x) ≤ t} dt
 */
import { evaluatePiecewise, antiderivativeOn } from './evaluate.js';

const DEFAULT_EVAL_STEPS = 5000;

/**
 * Sample the piecewise function on [minX, maxX] and return
 * { xs, ys, yMin, yMax, dx }.
 */
export function sampleFunction(analysis, steps = DEFAULT_EVAL_STEPS) {
  const { minX, maxX } = analysis;
  const dx = (maxX - minX) / steps;
  const xs = new Float64Array(steps + 1);
  const ys = new Float64Array(steps + 1);
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const x = minX + i * dx;
    const y = evaluatePiecewise(x, analysis);
    xs[i] = x; ys[i] = y;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  return { xs, ys, yMin, yMax, dx, width: maxX - minX };
}

/**
 * Lebesgue-style (horizontal slice) integration.
 * Correctly handles flat functions and functions that never cross zero.
 * the original implementation returned 0 for f(x) = const ≠ 0 and
 * under-counted the "box" below yMin / above yMax.
 */
export function lebesgueIntegrate(analysis, nLevels, steps = DEFAULT_EVAL_STEPS) {
  const s = sampleFunction(analysis, steps);
  if (!(s.width > 0)) return 0;

  // Degenerate / flat case: ∫ c dx = c·width.
  if (s.yMax - s.yMin < 1e-12) return s.yMax * s.width;

  const dy = (s.yMax - s.yMin) / Math.max(1, nLevels);
  const sorted = Array.from(s.ys).sort((a, b) => a - b);
  const N = s.ys.length;
  const countAbove = (level) => {
    // Number of samples with y >= level (binary search on sorted asc).
    let lo = 0, hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < level) lo = mid + 1; else hi = mid;
    }
    return N - lo;
  };
  const countBelow = (level) => {
    let lo = 0, hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= level) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  let area = 0;
  // Positive part: ∫₀^{yMax} λ{f ≥ t} dt
  if (s.yMax > 0) {
    const levels = Math.max(1, Math.ceil(s.yMax / dy));
    for (let i = 0; i < levels; i++) {
      const level = i * dy;
      area += (countAbove(level) * s.dx) * dy;
    }
  }
  // Negative part: ∫₀^{yMin} λ{f ≤ t} dt (subtracted)
  if (s.yMin < 0) {
    const levels = Math.max(1, Math.ceil(Math.abs(s.yMin) / dy) || 0);
    for (let i = 0; i < levels; i++) {
      const level = -(i * dy);
      area -= (countBelow(level) * s.dx) * dy;
    }
  }
  return area;
}

/** Simpson's composite rule (even slice count enforced). */
export function simpsonIntegrate(analysis, n) {
  const { minX, maxX } = analysis;
  const slices = Math.max(2, Math.ceil(n / 2) * 2);
  const h = (maxX - minX) / slices;
  let sum = evaluatePiecewise(minX, analysis) + evaluatePiecewise(maxX, analysis);
  for (let i = 1; i < slices; i++) {
    const x = minX + i * h;
    sum += evaluatePiecewise(x, analysis) * (i % 2 === 1 ? 4 : 2);
  }
  return (h / 3) * sum;
}

/** Left / right / midpoint / trapezoid Riemann sums. */
export function riemannIntegrate(analysis, method, n) {
  const { minX, maxX } = analysis;
  const dx = (maxX - minX) / n;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const xL = minX + i * dx;
    const xR = xL + dx;
    if (method === 'left') area += evaluatePiecewise(xL, analysis) * dx;
    else if (method === 'right') area += evaluatePiecewise(xR, analysis) * dx;
    else if (method === 'mid') area += evaluatePiecewise((xL + xR) / 2, analysis) * dx;
    else if (method === 'trapezoid') area += ((evaluatePiecewise(xL, analysis) + evaluatePiecewise(xR, analysis)) / 2) * dx;
  }
  return area;
}

/** Dispatch to the chosen numeric method. */
export function integrateNumeric(analysis, method, n) {
  if (method === 'lebesgue') return lebesgueIntegrate(analysis, n);
  if (method === 'simpson') return simpsonIntegrate(analysis, n);
  return riemannIntegrate(analysis, method, n);
}

/**
 * Exact integral of the piecewise model using antiderivatives
 * (polynomials, exponentials, logarithms, constants, Fourier series).
 * Returns { value, exact }; exact:false when a piece could not be
 * integrated in closed form (currently never happens).
 */
export function integrateExact(analysis) {
  if (!analysis || analysis.type !== 'piecewise') return { value: 0, exact: false };
  let total = 0;
  for (const piece of analysis.pieces) {
    const v = antiderivativeOn(piece, piece.minX, piece.maxX);
    if (!Number.isFinite(v)) return { value: total, exact: false };
    total += v;
  }
  return { value: total, exact: true };
}

