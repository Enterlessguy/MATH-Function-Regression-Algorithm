# Changelog

Changes to the Function Regression Algorithm. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-09-28

### Changed
- New look, matching I-DB Macro and the Schedule I Control Center.
- Startup animation shared with those two apps: 720 ms fade-in, at least
  900 ms hold, 680 ms fade-out. <kbd>Esc</kbd>, <kbd>Space</kbd> or
  <kbd>Enter</kbd> skips it. It is not shown when the system asks for reduced
  motion.
- Polynomials are fitted in a Chebyshev basis with Householder QR (v2 used
  Gram–Schmidt on powers of x). A degree-30 fit on x in [20, 30] is now
  accurate to 1e-6.
- Points are weighted by the x-spacing around them, so parts of the stroke
  drawn slowly no longer count for more.
- Exponential fits are refined with Levenberg–Marquardt after the log-linear
  starting guess. v2 used the log-linear fit only, which is biased when the
  data is noisy. Negative amplitudes work.
- Fourier series of a function: the line through the two end points is
  subtracted before the transform. This removes the Gibbs overshoot at both
  ends. The coefficients come from an FFT, not from 16,000-sample sums.
  Harmonics are limited to half the number of points.
- Closed curves use an FFT and also report the area π Σ k|cₖ|², the RMS
  distance from the stroke and the direction of travel.
- Lanczos σ is off by default. It shrank closed curves by about 2% of their
  area at 12 harmonics.
- Every integral is compared with a Gauss–Legendre reference. The error is
  shown relative to ∫|f|, because relative to the signed area it becomes
  meaningless when the signed area is near zero.
- Auto-detection of closed curves compares the gap between the end points
  with the size of the shape, not with a fixed 40 px.

### Added
- Undo, fit view to drawing, PNG export.

### Security
- Tailwind and KaTeX are no longer loaded from CDNs. They had no integrity
  hashes, and the Tailwind CDN version was not pinned. The page now makes no
  network requests, and a Content-Security-Policy blocks any it didn't ship
  with.
- Settings read from `localStorage` are validated.
- Removed `scripts/serve.mjs`. It listened on all network interfaces and
  served every file in the folder, including `.git/`.
- The Pages workflow runs the tests and publishes only `index.html`, `src/`
  and `assets/`.

### Removed
- The build script and the `dist/` bundle. The page opens directly from disk
  because it no longer uses ES modules.
- The Web Worker. With FFTs, a full analysis takes 1–5 ms. The slowest case,
  500 harmonics with a 1000-level Lebesgue sum, takes about 70 ms.
- Exact integrals from antiderivatives. The Gauss–Legendre reference matches
  them to about 1e-12 (checked in the tests) and also handles gaps between
  segments.

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
- The app ships as a single self-contained HTML file in `dist/`.

### Removed
- In-browser runtime transpilation (about 400 KB of script).
- Dead code and encoding artifacts from the original file.
