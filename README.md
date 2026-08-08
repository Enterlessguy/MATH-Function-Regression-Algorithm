# Topographic Core

**Turn a freehand sketch into fitted math.** Draw a function or a closed loop with your mouse or finger, and Topographic Core fits a model, integrates it, measures the enclosed area, and hands you KaTeX-rendered LaTeX plus a Desmos-ready parametric curve.

This repository is a ground-up rewrite of a single ~70 KB HTML file that ran React and in-browser Babel. The rewrite is plain ES modules with a zero build step, a pure math core with unit tests, and a Web Worker for the heavy Fourier math.

## Release notes

**v2.0.0** is the first public release. It is a re-architecture rather than a facelift:

- **Zero build step.** The app is static HTML, CSS, and ES modules. There is no bundler, no transpiler, no framework, and no `npm install`.
- **A testable math core.** Every fit and every integration method lives in a pure, dependency-free module covered by 31 unit tests in `test/math.test.js`.
- **One shared pipeline.** The Web Worker and the UI run the same analysis code, so the two threads cannot disagree about a result.
- **Correct integration.** The Lebesgue-style integrator used to return 0 for `f(x) = 5` and under-counted any function sitting above zero. Both defects are fixed and regression-tested. Simpson's rule and exact antiderivative integration are new.
- **Stable high-degree fits.** Polynomials up to degree 30 use scaled QR least squares instead of normal equations.
- **The top harmonic survives.** The Lanczos sigma window no longer zeroes the highest Fourier coefficient.
- **Faster resampling.** Fourier paths resample with a binary search (O(log n) per sample) instead of a linear scan (O(n)).
- **No dead ends.** A crashed worker falls back to the main thread, toasts replace `alert()`, and clipboard operations degrade gracefully under `file://`.
- **Sharper drawing.** The canvas is device-pixel-ratio aware, and zoom targets the cursor instead of the viewport centre.

## Capabilities

- **Input.** Freehand drawing, wheel zoom, right-drag pan, and multi-stroke piecewise mode for modelling different regions with different functions.
- **Models.** Polynomial (degree 0..30), exponential `a e^{bx}`, logarithmic `a + b ln x`, constant, and one-dimensional Fourier series.
- **Closed curves.** Arc-length resampling plus a discrete Fourier transform rebuilds any closed stroke as a sum of rotating circles (epicycles), with an optional Lanczos anti-Gibbs window.
- **Integration.** Riemann sums (left, midpoint, right, trapezoid), Simpson's rule, a Lebesgue-style level-set integrator, and exact integrals from antiderivatives for every model.
- **Area.** Closed shapes report the signed area via Green's theorem (shoelace form).
- **Fit quality.** Every piece reports R² and RMSE, so you can judge the fit before trusting its integral.
- **Output.** KaTeX-rendered LaTeX per piece, copy buttons, and a Desmos-pasteable parametric `(X(t), Y(t))` for closed curves.
## Getting started

Three ways to run it. None of them compiles anything.

### 1. Live on GitHub Pages

Push the repository and the included workflow builds and publishes the site automatically. No local host, no scripts, no dependencies. See [Deploy to GitHub Pages](#deploy-to-github-pages).

### 2. Pre-packaged single file

Open `dist/topographic-core.html` and double-click. The app, the math engine, and the web worker are all inside that one file, and it runs from `file://` with no server and no Node.js. Only the Tailwind and KaTeX CDNs need an internet connection.

### 3. Local dev server

Requires Node.js 18 or newer:

```bash
npm start        # serve at http://localhost:4173
npm test         # run the unit tests (node --test, zero deps)
npm run build    # regenerate dist/topographic-core.html
```

There is no `npm install` step; `npm start` is just `node scripts/serve.mjs`.

Why does development need a server? Browsers block ES modules over `file://`. Production avoids that problem entirely: the hosted site (option 1) and the bundled file (option 2) both run without one.

## Deploy to GitHub Pages

1. Push this repository to GitHub on the `main` branch.
2. In the repo settings, open Pages and set Source to **GitHub Actions**.
3. The workflow at `.github/workflows/pages.yml` builds `dist/` and publishes the site at `https://<user>.github.io/<repo>/` on every push (or via manual `workflow_dispatch`).

That workflow is the whole "auto compile and run" story: push once, and every later push republishes.

## The math, in detail

### 1. From strokes to pieces

A stroke is a list of points in math coordinates. The viewport maps pixels to math coordinates, so zoom and pan change what you are fitting without changing the stored geometry. Strokes with fewer than six points are ignored as noise.

Each stroke becomes its own piece unless the end of one stroke lands close to its start. In auto mode, the engine treats the drawing as a closed curve when the endpoints sit within 40 screen pixels of each other. Open pieces go to the regression path; closed pieces go to the DFT path.

### 2. Polynomial regression

The polynomial model is

$$P(x) = \sum_{i=0}^{n} c_i x^i$$

and the fit solves the least-squares problem `min ||A c - y||` for the Vandermonde matrix `A_{ji} = x_j^i`. The classic route, the normal equations `A^T A c = A^T y`, squares the condition number and becomes unstable past degree 10 or so. This engine scales each column of the Vandermonde matrix to unit norm and solves the least-squares problem with a modified Gram-Schmidt QR decomposition, which stays stable up to degree 30. Linearly dependent columns get zero rows in R and are skipped, so the solver returns a sensible answer instead of NaN.
### 3. Exponential and logarithmic fits

Both models are linearised before fitting:

- Exponential: `y = a e^{bx}` becomes `ln y = ln a + b x`, a line fit in (x, ln y) over the points with y > 0.
- Logarithmic: `y = a + b ln x` becomes a line fit in (ln x, y) over the points with x > 0.

The intercept of the linear fit is exponentiated to recover `a`. Linearisation is cheap and stable, at the cost of assuming multiplicative noise on y.

### 4. Constant fit

The constant model returns the mean of the y values, which is the least-squares optimum for degree 0.

### 5. One-dimensional Fourier series

For an open piece on [a, b], the stroke is resampled to uniformly spaced x values and the engine estimates coefficients of

$$f(x) = \frac{a_0}{2} + \sum_{k=1}^{H} \left( a_k \cos\frac{2\pi k x}{T} + b_k \sin\frac{2\pi k x}{T} \right), \quad T = b - a$$

The coefficients are numeric quadratures of the standard Fourier integrals over the resampled stroke. Resampling evaluates the stroke at each of the 16,000 uniform samples; a binary search over the sorted points makes every lookup O(log n) instead of O(n), which matters for long strokes.

### 6. Closed curves: arc length and DFT

A closed stroke is treated as a complex signal `z(t) = x(t) + i y(t)` on the unit circle. First the stroke is resampled uniformly by cumulative arc length, so slow, dense handwriting does not dominate the spectrum. A discrete Fourier transform then produces coefficients `c_k` for k in [-H, H], and the reconstruction is

$$z(t) = \sum_{k=-H}^{H} c_k e^{i 2\pi k t}$$

Every term is one rotating circle: `|c_k|` sets the radius, `arg(c_k)` the phase, and k the rotation speed. H trades detail against smoothness. The optional Lanczos window scales each coefficient by `sinc(k pi / (H+1))`. The naive `sinc(k pi / H)` zeroes the last harmonic, so the engine uses H+1 in the denominator.
### 7. Integration

Integration runs on the fitted model rather than the raw sketch, so the result reflects the model you picked. Change the model and watch the area change with it.

**Riemann sums.** Left, midpoint, right, and trapezoid estimates of `int_a^b f(x) dx` on a uniform grid. The trapezoid rule converges like O(1/n²) for smooth functions.

**Simpson's rule.** The composite rule fits a parabola through every triple of adjacent samples:

$$S = \frac{\Delta x}{3} \left( f(x_0) + 4 \sum_{\text{odd}} f(x_i) + 2 \sum_{\text{even}} f(x_i) + f(x_n) \right)$$

It converges like O(1/n²) for smooth functions and is exact for polynomials up to degree 3.

**Lebesgue-style integration.** Instead of slicing vertically, the integrator slices horizontally and measures the level sets:

$$\int_0^\infty \mu\{x : f(x) \ge t\}\,dt - \int_{-\infty}^0 \mu\{x : f(x) \le t\}\,dt$$

At each level t it counts the samples above (or below) t, multiplies by the sample spacing, and accumulates over the level range. For continuous functions this matches the Riemann integral; it stays exact for step functions and shrugs off vertical jumps. Two historical bugs lived here: a constant function like `f(x) = 5` returned 0, and any function sitting above zero under-counted the box below its minimum. The integrator now uses the true zero baseline, and both cases are regression-tested.

**Exact integration.** Every model has a closed-form antiderivative, so the engine can also report the exact value:

- Polynomial: term-by-term power rule, `c_i x^{i+1}/(i+1)`.
- Exponential: `(a/b) e^{bx}`, with the b = 0 case reduced to a constant.
- Logarithmic: `b (x ln x - x) + a x`.
- Constant: `c x`.
- Fourier: term-by-term sine and cosine integrals.

The sidebar shows the numeric result and the exact result side by side, with the absolute error between them. If a piece cannot be integrated in closed form, the engine reports `exact: false` and shows the numeric value alone. With the current models that case never occurs.
### 8. Area of closed shapes

The signed area comes from Green's theorem in shoelace form:

$$A = \frac{1}{2} \oint (x\,dy - y\,dx)$$

evaluated over the resampled polygon. A circle of radius r yields `pi r^2` in the tests. The sign carries the winding direction; the UI shows the absolute area.

### 9. Fit quality

For each piece, the metrics are computed at the original stroke points:

$$R^2 = 1 - \frac{SS_{res}}{SS_{tot}}, \qquad \text{RMSE} = \sqrt{\frac{SS_{res}}{n}}$$

where SS_res is the sum of squared residuals and SS_tot the sum of squared deviations from the mean. R² close to 1 means the model explains the stroke; RMSE is in drawing units. For non-linear models this is a pseudo-R², so treat it as a rough guide.

### 10. Output

Every piece is rendered as LaTeX with KaTeX in the sidebar. The polynomial formatter orders terms high power first and drops insignificant leading terms, and a dedicated formatter builds the Desmos-pasteable parametric tuple `(X(t), Y(t))` for closed curves. Non-finite coefficients are filtered before any string is built.

## Project structure

```
MATH-Function-Regression-Algorithm/
├── index.html            # app shell (CDN: Tailwind, KaTeX; nothing else)
├── styles.css            # small additions on top of Tailwind
├── package.json          # npm start / build / test; zero dependencies
├── scripts/serve.mjs     # zero-dep static server for local dev
├── scripts/build.mjs     # zero-dep bundler -> dist/topographic-core.html
├── dist/                 # pre-packaged single-file build, double-clickable
├── .github/
│   └── workflows/pages.yml  # GitHub Actions: build + publish Pages
├── src/
│   ├── main.js           # bootstrap: store, pointer/wheel, worker orchestration
│   ├── worker.js         # Web Worker entry (same pipeline as main thread)
│   ├── analysis.js       # shared pipeline: closure detect, fit, integrate, metrics
│   ├── renderer.js       # canvas: grid, axes, strokes, fits, integral drawing
│   ├── ui.js             # vanilla-DOM sidebar and live updates
│   ├── state.js          # tiny observable store
│   └── math/             # pure, testable math core
│       ├── matrix.js     # Gaussian elimination, QR least squares, polynomial fit
│       ├── regression.js # per-piece fits, arc-length DFT, R²/RMSE
│       ├── evaluate.js   # model evaluation and exact antiderivatives
│       ├── integrate.js  # Riemann, Simpson, Lebesgue, exact
│       └── format.js     # LaTeX and Desmos formatting
└── test/math.test.js     # 31 unit tests (node --test)
```

## Stuff for nerds

### How the zero-dependency build works

`scripts/build.mjs` is the whole toolchain. It reads every module in `src/`, walks the import graph in post-order, wraps each module in an IIFE, rewrites `import { x } from './y.js'` into destructuring from an earlier-defined module variable, and returns the exported names as a namespace object. The web worker is compiled the same way and inlined into the page as a Blob source string, so the single-file build has no `import.meta` and no external script tags except the Tailwind and KaTeX CDNs. A `vm.Script` parse check in the build fails fast if any `import` or `import.meta` survives.

### Regression details

- Polynomial fits use a column-scaled Vandermonde matrix and a modified Gram-Schmidt QR solve. The normal equations route is avoided because it squares the condition number. Degrees are capped at 30, and rank-deficient columns are skipped instead of producing NaN.
- The 1D Fourier fit resamples the stroke to 16,000 uniform x samples, then estimates coefficients with quadrature. Per-sample lookup is a binary search over the sorted stroke, so the resample is O(m log n) rather than O(m n).
- Closed curves are treated as a complex signal and resampled by cumulative arc length to 16,000 points, which prevents dense handwriting from dominating the spectrum. The DFT returns 2H+1 coefficients for k in [-H, H], and the Lanczos sigma factor is sinc(k pi / (H+1)) because the naive sinc(k pi / H) is zero at k = H.
- Exponential and logarithmic fits linearise first: ln y vs x, and y vs ln x. The intercept is exponentiated to recover `a`. This assumes multiplicative noise on y.

### Integration details

- Riemann methods and Simpson use `evaluatePiecewise` on the fitted model, not the raw strokes. Simpson enforces an even slice count and is exact for polynomials up to degree 3.
- The Lebesgue-style integrator samples the function at 5,000 points, sorts them, and accumulates the measure of the level sets {x : f(x) >= t} and {x : f(x) <= t} with binary-search counting per level. Default resolution is 50 levels. A flat function short-circuits to c times the domain width.
- Exact integrals come from closed-form antiderivatives for every model. The exponential case handles b = 0 as a constant. If any piece antiderivative is non-finite, the engine reports `exact: false` and the UI falls back to the numeric value.

### Numerical notes

- R² is computed at the original stroke points and is a pseudo-R² for non-linear models, so treat values close to 1 as a guide rather than gospel.
- Overlapping piece domains resolve first-piece-wins in `evaluatePiecewise`; strokes with five or fewer points are ignored.
- Closure detection in auto mode compares the endpoint distance in screen pixels (math distance times zoom) against a 40 pixel threshold.
- The worker and the main thread import the same `analysis.js` pipeline, so both paths produce identical floats. Worker failure falls back to the main thread.

### Repo facts

- Runtime: plain browser. Node.js 18+ is only needed for `npm start`, `npm test`, and `npm run build`.
- The math core in `src/math/` has no imports from the DOM or the UI, so it runs in Node, in the worker, and in the page unchanged.
- The test suite is 31 tests with no dependencies and no DOM; it covers matrix solvers, every regression model, DFT reconstruction, closure detection, all five integration methods, exact antiderivatives, and formatting edge cases.
- The single-file bundle is about 331 KB.

## Notable fixes versus the original

- **Lebesgue integration returned 0 for flat functions** and under-counted functions that never cross zero. Now it integrates against the true baseline; regression-tested.
- **The Lanczos window killed the top harmonic**, since `sinc(k/H)` is zero at k = H. Now `sinc(k/(H+1))`; regression-tested.
- **High-degree polynomial fits went through numerically unstable normal equations.** Now scaled QR least squares.
- **Fourier resampling was O(n·m).** Binary search makes each sample lookup O(log n).
- **A dead worker left "COMPUTING..." stuck forever.** Error paths now fall back to the main thread and reset the UI.
- **`alert()` and clipboard calls threw on `file://`.** Toasts and a graceful copy fallback replaced them.
- **The canvas was blurry on HiDPI displays.** Rendering is now device-pixel-ratio aware.
- **Zoom was anchored to the viewport centre.** It now zooms toward the cursor.
- **The worker and the UI duplicated the math.** One shared pipeline guarantees identical results.
- **Mojibake and dead code cleaned up**; the in-browser React/Babel runtime is gone.

## Testing

```bash
npm test
```

The 31 tests cover the matrix solvers, every regression model, DFT reconstruction, closure detection, all five integration methods (including both Lebesgue regressions), exact antiderivatives, and formatting edge cases. No dependencies, no DOM.

## License

[MIT](./LICENSE)
