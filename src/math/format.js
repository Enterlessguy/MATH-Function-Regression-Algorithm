/**
 * format.js: LaTeX / Desmos-friendly string formatting for fitted models.
 */

/** Format a number for LaTeX; switches to scientific notation for extremes. */
export function formatNum(num, digits = 8) {
  if (!Number.isFinite(num)) return '0';
  const abs = Math.abs(num);
  if (abs < 1e-6 || abs > 1e6) {
    const parts = num.toExponential(digits).split('e');
    return `${parts[0]} \\cdot 10^{${parts[1]}}`;
  }
  const out = Number(num.toPrecision(digits));
  return String(out);
}

/** Short formatter for parametric curves (Desmos pastes better). */
function formatShort(num) {
  if (!Number.isFinite(num)) return '0';
  const abs = Math.abs(num);
  if (abs < 0.0001 || abs > 10000) {
    const parts = num.toExponential(5).split('e');
    return `${parts[0]} \\cdot 10^{${parts[1]}}`;
  }
  return Number(num.toFixed(5)).toString();
}

/**
 * LaTeX for a fitted piece.
 * full=true includes the domain restriction.
 */
export function formatPieceLatex(piece, full = false) {
  const c = piece.coeffs || [];
  let formula;

  switch (piece.modelType) {
    case 'constant':
      formula = formatNum(c[0], 4);
      break;
    case 'logarithmic': {
      const a = c[0] || 0, b = c[1] || 0;
      formula = `${formatNum(b, 4)} \\ln(x) ${a >= 0 ? '+' : ''} ${formatNum(a, 4)}`;
      break;
    }
    case 'exponential': {
      const a = c[0] || 0, b = c[1] || 0;
      formula = `${formatNum(a, 4)} e^{${formatNum(b, 4)}x}`;
      break;
    }
    case 'fourier': {
      const { a0, fourierTerms, minX, range } = piece.fourierData || {};
      const terms = fourierTerms || [];
      let s = `${formatNum((a0 || 0) / 2, 4)}`;
      const limit = full ? terms.length : Math.min(3, terms.length);
      const xTrans = `\\left(\\frac{x - ${Number(minX.toFixed(2))}}{${Number(range.toFixed(2))}}\\right)`;
      for (let i = 0; i < limit; i++) {
        const { k, a, b } = terms[i];
        const freq = k === 1 ? '2\\pi' : `${2 * k}\\pi`;
        if (Math.abs(a) > 1e-6) s += ` ${a >= 0 ? '+' : ''} ${formatNum(a, 4)} \\cos(${freq}${xTrans})`;
        if (Math.abs(b) > 1e-6) s += ` ${b >= 0 ? '+' : ''} ${formatNum(b, 4)} \\sin(${freq}${xTrans})`;
      }
      if (!full && terms.length > 3) s += ' + \\dots';
      formula = s;
      break;
    }
    default: {
      // Polynomial: highest powers first, strip insignificant leading terms.
      const terms = [];
      const limit = full ? c.length : Math.min(6, c.length);
      for (let i = c.length - 1; i >= Math.max(0, c.length - limit); i--) {
        const v = c[i];
        if (!Number.isFinite(v) || (Math.abs(v) < 1e-18 && i !== 0)) continue;
        let term = (v >= 0 && i !== c.length - 1) ? '+' : '';
        term += formatNum(v);
        if (i > 0) term += i === 1 ? 'x' : `x^{${i}}`;
        terms.push(term);
      }
      formula = terms.length ? terms.join(' ') : '0';
    }
  }

  if (full) {
    formula += ` \\left\\{ ${Number(piece.minX.toFixed(3))} \\le x \\le ${Number(piece.maxX.toFixed(3))} \\right\\}`;
  }
  return formula;
}

/**
 * Parametric LaTeX for a closed-curve Fourier reconstruction,
 * formatted so it can be pasted into Desmos as (X(t), Y(t)) with t ∈ [0, 1].
 */
export function formatParametricLatex(coeffs) {
  const xTerms = [];
  const yTerms = [];

  for (const { k, re, im } of coeffs) {
    if (k === 0) {
      if (Math.abs(re) > 1e-4) xTerms.push(`${re > 0 ? '+' : ''}${formatShort(re)}`);
      if (Math.abs(im) > 1e-4) yTerms.push(`${im > 0 ? '+' : ''}${formatShort(im)}`);
    } else {
      const freq = Math.abs(k) === 1
        ? (k < 0 ? '-2\\pi ' : '2\\pi ')
        : `${2 * k}\\pi `;

      if (Math.abs(re) > 1e-4) {
        xTerms.push(`${re > 0 ? '+' : ''}${formatShort(re)}\\cos(${freq}t)`);
        yTerms.push(`${re > 0 ? '+' : ''}${formatShort(re)}\\sin(${freq}t)`);
      }
      if (Math.abs(im) > 1e-4) {
        xTerms.push(`${-im > 0 ? '+' : ''}${formatShort(-im)}\\sin(${freq}t)`);
        yTerms.push(`${im > 0 ? '+' : ''}${formatShort(im)}\\cos(${freq}t)`);
      }
    }
  }

  const X = xTerms.join('').replace(/^\+/, '') || '0';
  const Y = yTerms.join('').replace(/^\+/, '') || '0';
  return `\\left(${X}, ${Y}\\right)`;
}

/** Human-readable model description for a piece (for metrics UI). */
export function describeModel(model) {
  switch (model) {
    case 'polynomial': return 'Polynomial';
    case 'fourier': return 'Fourier (1D Trigonometric)';
    case 'exponential': return 'Exponential';
    case 'logarithmic': return 'Logarithmic';
    case 'constant': return 'Constant';
    default: return model;
  }
}

