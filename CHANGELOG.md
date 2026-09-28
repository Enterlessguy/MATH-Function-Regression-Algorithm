# Changelog

All notable changes to Function Regression Algorithm (formerly Topographic Core) are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-09-28

Intelligence Database redesign, with a new numerical core and zero third-party code.

### Design
- New Intelligence Database look, matching I-DB Macro and the Schedule I
  Control Center. It uses their design tokens, sidebar, cards, segmented
  controls and toggles.
- Adds the shared startup animation: a 720 ms fade-in, a hold of at least
  900 ms and a 680 ms fade-out. <kbd>Esc</kbd>, <kbd>Space</kbd> or
  <kbd>Enter</kbd> skips it, and it is skipped automatically when the system
  asks for reduced motion.
- Canvas rendering is sharp on high-DPI screens, zooms around the cursor and
  redraws only when something changes.
- Adds undo, fit-to-strokes, PNG export and toasts in place of `alert()`.

### Maths
- Least squares uses Householder QR on a Chebyshev basis over x mapped to
  [-1, 1]. v2 used column-scaled modified Gram–Schmidt on raw powers of x.
  Degree 30 now stays accurate to about 1e-6, even far from the origin.
- The polynomial degree is capped by the number of distinct points.
- Points are weighted by x-spacing, so slow pen movement no longer biases the
  fit.
- Exponential fit: log-linear start followed by Levenberg–Marquardt on the
  true residuals. v2 stopped at the log-linear fit, which is biased by noise.
  Negative amplitudes now work.
- 1-D Fourier: the chord is removed before the transform, which ends the
  Gibbs overshoot at both ends, and the coefficients come from an FFT instead
  of 16,000-sample quadrature. Harmonics are capped at Nyquist.
- Closed shapes: FFT-based. Adds the coefficient area π Σ k|cₖ|², the RMS
  deviation and the orientation.
- Lanczos σ is now off by default. Both series are continuous, so it only
  shrank shapes (about 2% of the area at 12 harmonics).
- Lebesgue sum: midpoint levels with dense sorted samples. Unbiased for
  constants and for positive and negative parts.
- Every integral is compared with a Gauss–Legendre reference. The error is
  shown relative to ∫|f|, so a signed area near zero no longer reports huge
  relative errors.
- Auto-closure is scale-aware: the endpoint gap is compared with the shape's
  size, not a fixed 40 px.

### Security
- Removed the last CDN dependencies, the Tailwind Play CDN and KaTeX. Neither had
  Subresource Integrity, and Tailwind's runtime compiler injects styles, which
  rules out a strict CSP. The app now makes no network requests at all.
- Removed `scripts/serve.mjs`, which listened on every network interface and
  served any file in the checkout, including `.git/`. It's no longer needed,
  because the page runs from `file://`.
- Adds a strict Content-Security-Policy and validates stored settings.
- The Pages workflow publishes only `index.html`, `src/` and `assets/`, not the
  whole repository, and runs the tests first.

### Removed
- The build script and `dist/` single-file bundle. The page itself now runs
  from `file://`, because it uses classic scripts, not ES modules.
- The Web Worker. With FFTs in place of 16,000-sample quadrature, a full
  analysis takes 1–5 ms on the main thread. The worst case, 500 harmonics
  plus a 1000-level Lebesgue sum, takes about 70 ms.
- Exact antiderivative integration. It is replaced by a composite
  Gauss–Legendre reference, which agrees with the antiderivatives to about
  1e-12 (see the tests) and also covers gaps between segments.

## [2.0.0] - 2026-08-08

### Added
- Simpson's rule integration and exact antiderivative integration for every model.
- Per-piece R² and RMSE fit quality metrics.
- Proper horizontal-slice rendering for Lebesgue integration.
- GitHub Pages deployment workflow: builds on push, publishes automatically.
- Unit test suite: 31 tests, zero dependencies.

### Fixed
- Lebesgue integration returned 0 for constant non-zero functions and under-counted functions that never cross zero.
- Lanczos sigma window zeroed the top Fourier harmonic; the denominator is now H + 1.
- High-degree polynomial fits were unstable; normal equations replaced with scaled QR least squares.
- Fourier resampling was O(n m); per-sample binary search makes it O(log n).
- Worker failure could leave the UI stuck on "COMPUTING...".
- `alert()` and clipboard calls failed on `file://`.
- Blurry canvas on HiDPI displays; zoom now tracks the cursor.
- Stale async results could overwrite newer ones.

### Changed
- React plus in-browser Babel replaced with plain ES modules and a zero-build setup.
- Worker and main thread now share one analysis pipeline.
- The app ships as a single self-contained `dist/topographic-core.html`.

### Removed
- In-browser runtime transpilation (about 400 KB of script).
- Dead code and encoding artifacts from the original file.
