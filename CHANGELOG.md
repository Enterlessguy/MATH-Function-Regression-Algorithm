# Changelog

All notable changes to Topographic Core are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
