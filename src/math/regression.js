/**
 * regression.js: model fitting.
 *   • regressPiece: fit one stroke to a model (constant, logarithmic,
 *     exponential, Fourier series, polynomial).
 *   • computeDFT: Fourier decomposition of a closed curve using
 *     arc-length parameterisation (the "draw with epicycles" math).
 *   • fitMetrics: R² / RMSE quality scores for a fitted piece.
 */
import { solveGaussian, fitPolynomial } from './matrix.js';
import { evaluatePiece } from './evaluate.js';

/** Number of uniform samples used for Fourier workflows. */
export const FOURIER_SAMPLES = 16000;

/**
 * Resample a polyline uniformly by arc length into `n` points
 * (used for closed-curve DFT so sampling does not favour dense
 * handwriting segments).
 */
export function resampleByArcLength(points, n) {
  const m = points.length;
  if (m < 2) return points.slice();
  const cumulative = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % m];
    cumulative[i + 1] = cumulative[i] + Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  const total = cumulative[m];
  if (total <= 0) return points.slice();

  const out = new Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / n) * total;
    while (seg < m && cumulative[seg + 1] < target) seg++;
    if (seg >= m) seg = m - 1;
    const p1 = points[seg];
    const p2 = points[(seg + 1) % m];
    const segLen = cumulative[seg + 1] - cumulative[seg];
    const t = segLen > 0 ? (target - cumulative[seg]) / segLen : 0;
    out[i] = {
      x: p1.x + (p2.x - p1.x) * t,
      y: p1.y + (p2.y - p1.y) * t,
    };
  }
  return out;
}

/**
 * Discrete Fourier Transform of a closed curve.
 * Returns 2·H + 1 coefficients {k, re, im} for k in [-H, H] where
 * re/im are the coefficients of the complex DFT of (x + i·y).
 *
 * Optional Lanczos sigma windowing suppresses the Gibbs phenomenon at
 * the truncation edge: sigma_k = sinc(k / (H+1)).
 */
export function computeDFT(rawPoints, harmonics, applySigma) {
  const H = Math.max(1, Math.floor(harmonics));
  if (!rawPoints || rawPoints.length < 2) return [];

  const points = resampleByArcLength(rawPoints, FOURIER_SAMPLES);
  const N = points.length;
  const coeffs = [];

  for (let k = -H; k <= H; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const phi = (2 * Math.PI * k * n) / N;
      const cos = Math.cos(phi), sin = Math.sin(phi);
      const x = points[n].x, y = points[n].y;
      // (x + i·y)·e^{−i·φ}
      re += x * cos + y * sin;
      im += y * cos - x * sin;
    }
    let sigma = 1;
    if (applySigma && k !== 0) {
      const u = (Math.PI * k) / (H + 1);
      sigma = Math.sin(u) / u;
    }
    coeffs.push({ k, re: (re / N) * sigma, im: (im / N) * sigma });
  }
  return coeffs;
}

/**
 * Fit a single stroke to the requested model.
 * Returns a piece descriptor { modelType, minX, maxX, coeffs, fourierData }.
 */
export function regressPiece(pts, model, degree, harmonics, applySigma) {
  const sorted = pts.slice().sort((a, b) => a.x - b.x);
  const minX = sorted[0].x;
  const maxX = sorted[sorted.length - 1].x;
  const n = sorted.length;
  const xs = sorted.map((p) => p.x);
  const ys = sorted.map((p) => p.y);

  let coeffs = [];
  let fourierData = null;

  switch (model) {
    case 'constant': {
      const sum = ys.reduce((a, b) => a + b, 0);
      coeffs = [sum / n];
      break;
    }
    case 'logarithmic': {
      // y = b·ln(x) + a, using only points with x > 0.
      const valid = [];
      for (let i = 0; i < n; i++) {
        if (xs[i] > 0.001) valid.push([Math.log(xs[i]), ys[i]]);
      }
      if (valid.length < 2) {
        coeffs = [0, 0];
      } else {
        let s0 = 0, s1 = 0, s2 = 0, sy = 0, sxy = 0;
        for (const [u, y] of valid) {
          s0 += 1; s1 += u; s2 += u * u; sy += y; sxy += y * u;
        }
        const sol = solveGaussian(
          [[s0, s1], [s1, s2]],
          [sy, sxy],
        );
        coeffs = [sol[0], sol[1]]; // [a, b] → a + b·ln(x)
      }
      break;
    }
    case 'exponential': {
      // y = a·e^{b·x}, linearised as ln(y) = ln(a) + b·x (y > 0).
      const valid = [];
      for (let i = 0; i < n; i++) {
        if (ys[i] > 0.001) valid.push([xs[i], Math.log(ys[i])]);
      }
      if (valid.length < 2) {
        coeffs = [0, 0];
      } else {
        let s0 = 0, s1 = 0, s2 = 0, sy = 0, sxy = 0;
        for (const [x, lny] of valid) {
          s0 += 1; s1 += x; s2 += x * x; sy += lny; sxy += x * lny;
        }
        const sol = solveGaussian(
          [[s0, s1], [s1, s2]],
          [sy, sxy],
        );
        coeffs = [Math.exp(sol[0]), sol[1]]; // [a, b] → a·e^{b·x}
      }
      break;
    }
    case 'fourier': {
      const range = maxX - minX;
      let a0 = 0;
      const terms = [];
      if (range > 1e-3) {
        const H = Math.max(1, Math.floor(harmonics));
        // Uniformly resample the stroke in x so the series integrates cleanly.
        const sampled = new Array(FOURIER_SAMPLES);
        for (let i = 0; i < FOURIER_SAMPLES; i++) {
          const x = minX + (i / (FOURIER_SAMPLES - 1)) * range;
          sampled[i] = { x, y: interpolateY(sorted, x) };
        }
        const dx = range / FOURIER_SAMPLES;
        for (let i = 0; i < FOURIER_SAMPLES; i++) a0 += sampled[i].y * dx;
        a0 = (2 / range) * a0;

        for (let k = 1; k <= H; k++) {
          let ak = 0, bk = 0;
          for (let i = 0; i < FOURIER_SAMPLES; i++) {
            const t = (sampled[i].x - minX) / range;
            const phi = 2 * Math.PI * k * t;
            ak += sampled[i].y * Math.cos(phi) * dx;
            bk += sampled[i].y * Math.sin(phi) * dx;
          }
          let sigma = 1;
          if (applySigma && H > 1) {
            const u = (Math.PI * k) / (H + 1);
            sigma = Math.sin(u) / u;
          }
          terms.push({ k, a: (2 / range) * ak * sigma, b: (2 / range) * bk * sigma });
        }
      }
      fourierData = { a0, fourierTerms: terms, minX, range };
      coeffs = [];
      break;
    }
    default: {
      // Polynomial via scaled QR least squares (stable up to degree 30).
      const deg = Math.max(0, Math.min(Math.floor(degree), 30, n - 1));
      coeffs = fitPolynomial(xs, ys, deg);
      break;
    }
  }

  return { modelType: model, minX, maxX, coeffs, fourierData };
}

/** Piecewise-linear interpolation of a sorted point list at x. */
function interpolateY(sortedPts, x) {
  const n = sortedPts.length;
  if (x <= sortedPts[0].x) return sortedPts[0].y;
  if (x >= sortedPts[n - 1].x) return sortedPts[n - 1].y;
  // Binary search for the bracketing segment (O(log n) instead of O(n)
  // per sample; matters with long strokes x 16k samples).
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x >= sortedPts[mid].x) lo = mid; else hi = mid;
  }
  const p1 = sortedPts[lo], p2 = sortedPts[hi];
  const denom = p2.x - p1.x;
  if (denom === 0) return p1.y;
  return p1.y + (p2.y - p1.y) * ((x - p1.x) / denom);
}

/**
 * Fit-quality metrics for a piece, computed at the original stroke points.
 * R² ∈ (−∞, 1]; values close to 1 mean the model explains nearly all the
 * variance. (For non-linear models this is a pseudo-R².)
 */
export function fitMetrics(piece, pts) {
  let ssRes = 0, ssTot = 0, mean = 0;
  for (const p of pts) mean += p.y;
  mean /= pts.length;
  for (const p of pts) {
    const err = p.y - evaluatePiece(p.x, piece);
    const dev = p.y - mean;
    ssRes += err * err;
    ssTot += dev * dev;
  }
  const rmse = Math.sqrt(ssRes / pts.length);
  const r2 = ssTot > 1e-12 ? 1 - ssRes / ssTot : (ssRes < 1e-12 ? 1 : 0);
  return { r2, rmse, ssRes, ssTot };
}


