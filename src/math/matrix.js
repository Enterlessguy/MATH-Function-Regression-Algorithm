/**
 * matrix.js: small linear-algebra helpers used by the regression engine.
 * All functions are pure and dependency-free so they run identically in the
 * browser (main thread + web worker) and in Node for testing.
 */

/**
 * Solve A x = b for a square system using Gaussian elimination with
 * partial pivoting. Returns an array of length n (n = rows of A).
 */
export function solveGaussian(A, b) {
  const n = A.length;
  if (n === 0) return [];
  // Augmented copy: [A | b]
  const M = A.map((row, i) => [...row, b[i]]);

  for (let i = 0; i < n; i++) {
    // Partial pivot: find the largest |entry| at or below the diagonal.
    let maxEl = Math.abs(M[i][i]);
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      const v = Math.abs(M[k][i]);
      if (v > maxEl) { maxEl = v; maxRow = k; }
    }
    if (maxRow !== i) {
      const tmp = M[maxRow]; M[maxRow] = M[i]; M[i] = tmp;
    }
    if (Math.abs(M[i][i]) < 1e-12) continue; // singular/degenerate column
    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / M[i][i];
      if (factor === 0) continue;
      M[k][i] = 0;
      for (let j = i + 1; j <= n; j++) M[k][j] -= factor * M[i][j];
    }
  }

  // Back substitution.
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(M[i][i]) < 1e-12) { x[i] = 0; continue; }
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Solve the linear least-squares problem min ||A x - b||₂ using the
 * modified Gram-Schmidt QR decomposition.
 *
 * A is an m×n matrix given as an array of m rows (each with n entries).
 * This is far more numerically stable than forming the normal equations,
 * which matters for high-degree polynomial fits.
 */
export function lstsqQR(A, b) {
  const m = A.length;
  if (m === 0) return [];
  const n = A[0].length;
  if (n === 0) return [];

  const Q = [];               // orthonormal columns (each length m)
  const R = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let j = 0; j < n; j++) {
    const v = new Array(m);
    for (let r = 0; r < m; r++) v[r] = A[r][j];

    for (let i = 0; i < j; i++) {
      const qi = Q[i];
      let dot = 0;
      for (let r = 0; r < m; r++) dot += qi[r] * v[r];
      R[i][j] = dot;
      if (dot !== 0) for (let r = 0; r < m; r++) v[r] -= dot * qi[r];
    }

    let norm2 = 0;
    for (let r = 0; r < m; r++) norm2 += v[r] * v[r];
    const norm = Math.sqrt(norm2);
    if (norm < 1e-14) {
      // Linearly dependent column: leave a zero row in R (rank deficient).
      R[j][j] = 0;
      Q[j] = new Array(m).fill(0);
      continue;
    }
    R[j][j] = norm;
    Q[j] = new Array(m);
    for (let r = 0; r < m; r++) Q[j][r] = v[r] / norm;
  }

  // c = Qᵀ b
  const c = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const qi = Q[i];
    if (!qi) continue;
    let s = 0;
    for (let r = 0; r < m; r++) s += qi[r] * b[r];
    c[i] = s;
  }

  // Back substitution on R x = c.
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(R[i][i]) < 1e-14) { x[i] = 0; continue; }
    let s = c[i];
    for (let j = i + 1; j < n; j++) s -= R[i][j] * x[j];
    x[i] = s / R[i][i];
  }
  return x;
}

/**
 * Fit a polynomial of the given degree to (x, y) points using a
 * scaled Vandermonde design matrix and QR least squares.
 * Returns coefficients low→high: [c0, c1, ..., c_degree].
 *
 * Scaling x by max|x| before building the design matrix keeps the
 * basis well-conditioned, and the coefficients are rescaled back
 * afterwards so the returned polynomial is in the original x space.
 */
export function fitPolynomial(xs, ys, degree) {
  const n = Math.min(degree, xs.length - 1);
  if (n < 0) return [];

  let scale = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = Math.abs(xs[i]);
    if (a > scale) scale = a;
  }
  if (scale < 1e-9) scale = 1;

  const A = [];
  const b = ys.slice();
  for (let i = 0; i < xs.length; i++) {
    const u = xs[i] / scale;
    const row = new Array(n + 1);
    row[0] = 1;
    for (let j = 1; j <= n; j++) row[j] = row[j - 1] * u;
    A.push(row);
  }

  const normCoeffs = lstsqQR(A, b);
  const coeffs = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    coeffs[i] = normCoeffs[i] / Math.pow(scale, i);
  }
  return coeffs;
}
