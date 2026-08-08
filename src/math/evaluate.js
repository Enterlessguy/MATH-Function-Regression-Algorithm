/**
 * evaluate.js: shared evaluation of fitted models.
 * Pure functions, usable in the browser (main thread + worker) and in Node.
 *
 * A "piece" is a fitted model on a domain [minX, maxX]:
 *   { modelType, minX, maxX, coeffs, fourierData? }
 * An "analysis" is either:
 *   { type: 'piecewise', minX, maxX, pieces }  or
 *   { type: 'closed', points, rawArea, coeffs }  (Fourier reconstruction).
 */

const LOG_EPS = 1e-9;

/** Evaluate a single fitted piece at x (no domain clamp; extrapolates). */
export function evaluatePiece(x, piece) {
  if (!piece) return 0;
  const c = piece.coeffs || [];
  switch (piece.modelType) {
    case 'constant':
      return c[0] || 0;
    case 'logarithmic':
      // y = b·ln(x) + a  (guard x ≤ 0)
      return (c[1] || 0) * Math.log(Math.max(x, LOG_EPS)) + (c[0] || 0);
    case 'exponential': {
      // y = a·e^{b·x}
      const a = c[0] || 0, b = c[1] || 0;
      if (Number.isNaN(b) || !Number.isFinite(b)) return 0;
      const exp = Math.exp(b * x);
      return Number.isFinite(exp) ? a * exp : 0;
    }
    case 'polynomial': {
      let y = 0;
      for (let i = c.length - 1; i >= 0; i--) y = y * x + c[i]; // Horner
      return y;
    }
    case 'fourier': {
      const { a0, fourierTerms, minX, range } = piece.fourierData || {};
      const terms = fourierTerms || [];
      const t = range > 1e-9 ? (x - minX) / range : 0;
      let y = (a0 || 0) / 2;
      for (let i = 0; i < terms.length; i++) {
        const { k, a, b } = terms[i];
        const arg = 2 * Math.PI * k * t;
        y += a * Math.cos(arg) + b * Math.sin(arg);
      }
      return y;
    }
    default:
      return 0;
  }
}

/**
 * Evaluate a piecewise analysis at x. The first piece whose domain
 * contains x wins (documented behavior for overlapping strokes).
 */
export function evaluatePiecewise(x, analysis) {
  if (!analysis || analysis.type !== 'piecewise') return 0;
  const pieces = analysis.pieces || [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (x >= p.minX && x <= p.maxX) return evaluatePiece(x, p);
  }
  return 0;
}

/**
 * Indefinite-integral (antiderivative) of a piece, evaluated from x1 to x2.
 * Returns a finite number, or NaN when the antiderivative is undefined on
 * the interval (e.g. log model with x ≤ 0).
 */
export function antiderivativeOn(piece, x1, x2) {
  const c = piece.coeffs || [];
  switch (piece.modelType) {
    case 'constant':
      return (c[0] || 0) * (x2 - x1);
    case 'logarithmic': {
      // ∫ (b·ln x + a) dx = b·(x·ln x − x) + a·x
      const a = c[0] || 0, b = c[1] || 0;
      const F = (x) => x > 0 ? b * (x * Math.log(x) - x) + a * x : NaN;
      return F(x2) - F(x1);
    }
    case 'exponential': {
      // ∫ a·e^{b x} dx = a/b · e^{b x}
      const a = c[0] || 0, b = c[1] || 0;
      if (Math.abs(b) < 1e-12) return a * (x2 - x1);
      const F = (x) => (a / b) * Math.exp(b * x);
      return F(x2) - F(x1);
    }
    case 'polynomial': {
      // ∫ Σ c_i x^i dx = Σ c_i x^{i+1}/(i+1)
      const F = (x) => {
        let s = 0;
        for (let i = 0; i < c.length; i++) s += (c[i] / (i + 1)) * Math.pow(x, i + 1);
        return s;
      };
      return F(x2) - F(x1);
    }
    case 'fourier': {
      // f(x) = a0/2 + Σ [a_k cos(2πk·(x−x0)/T) + b_k sin(2πk·(x−x0)/T)]
      const { a0, fourierTerms, minX, range } = piece.fourierData || {};
      const terms = fourierTerms || [];
      if (!(range > 1e-9)) return (a0 || 0) / 2 * (x2 - x1);
      const T = range;
      const F = (x) => {
        const tau = (x - minX) / T;
        let s = (a0 || 0) / 2 * x;
        for (let i = 0; i < terms.length; i++) {
          const { k, a, b } = terms[i];
          if (k === 0) continue;
          const w = (2 * Math.PI * k) / T;
          s += (a / w) * Math.sin(w * (x - minX))
             - (b / w) * Math.cos(w * (x - minX));
        }
        return s;
      };
      return F(x2) - F(x1);
    }
    default:
      return 0;
  }
}


