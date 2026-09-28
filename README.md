# Function Regression Algorithm

**Live version: [enterlessguy.github.io/MATH-Function-Regression-Algorithm](https://enterlessguy.github.io/MATH-Function-Regression-Algorithm/)**

Draw a curve with the mouse and get a formula for it. The program fits the
drawing with a polynomial, Fourier series, exponential, logarithm or constant.
It fits closed shapes with a parametric Fourier series, and it computes the
area under the fitted function with six integration methods. Every formula
can be copied as LaTeX and pasted into Desmos.

It uses the same look and startup animation as
[I-DB Macro](https://github.com/Enterlessguy/IDB-Macro) and the Schedule I
Control Center.

![Fourier series fitted to a hand-drawn curve](docs/screenshot.png)

## Running it

- Online: open the link above.
- Offline: download the repository and open `index.html` in Chrome, Edge or
  Firefox. There is nothing to install or build.

## Controls

- **Left mouse:** draw. In *Continuous* mode each new stroke replaces the old
  one. In *Piecewise* mode every stroke is fitted as a separate segment.
- **Shape:** *Auto* treats a stroke as a closed curve when it ends near its
  start point. *Function* and *Closed* set it by hand.
- **Right or middle drag:** pan. **Mouse wheel:** zoom around the cursor.
- **Keys:** <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo, <kbd>Del</kbd> clear,
  <kbd>F</kbd> fit the view to the drawing, <kbd>+</kbd>/<kbd>-</kbd> zoom,
  <kbd>0</kbd> reset the view.
- **Copy LaTeX:** copies `y=… \left\{a\le x\le b\right\}`, which Desmos
  accepts as-is. Closed curves copy as `(X(t), Y(t))` with `t` from 0 to 1.

## How the math works

### Least squares

Each model is fitted by minimising the weighted squared error

$$\sum_i w_i \big(f(x_i) - y_i\big)^2 .$$

The linear systems are solved with a Householder QR decomposition. The
normal equations $A^\mathsf{T}A\,c = A^\mathsf{T}y$ are not used, because
forming $A^\mathsf{T}A$ squares the condition number.

### Weights

A stroke has more points where the mouse moved slowly. With equal weights,
those parts of the curve would count for more in the fit. So each point is
weighted by the width of the x-interval around it:

$$w_i = \tfrac{1}{2}(x_{i+1} - x_{i-1}).$$

The sum above is then a Riemann sum for $\int (f - y)^2\,dx$. The fit
minimises the error over the whole interval, not over the sampled points.

### Polynomial

$x$ is mapped to $u = (x - c)/h \in [-1, 1]$, and the polynomial is written
in Chebyshev polynomials:

$$p(x) = \sum_{k=0}^{n} a_k T_k(u), \qquad T_{k+1}(u) = 2u\,T_k(u) - T_{k-1}(u).$$

On $[-1, 1]$ the Chebyshev polynomials are much closer to orthogonal than the
plain powers $1, x, x^2, \dots$, whose columns become nearly parallel as the
degree grows. The Chebyshev system stays well conditioned up to degree 30. The polynomial
is evaluated with Clenshaw's recurrence. It is shown in powers of $x$ up to
degree 10, and in powers of $u$ above that. The degree is limited to one less
than the number of distinct x values.

### Exponential

$y = A e^{bx}$ is not linear in $b$. Taking logarithms gives the line
$\ln y = \ln A + bx$, which provides a starting guess. That line fit on its
own is biased: it minimises the error in $\ln y$, not in $y$. The starting
guess is therefore refined with Levenberg–Marquardt on the actual residuals
$A e^{bx_i} - y_i$. Negative $A$ is supported: when the $y$ values sum to a negative
number, the starting guess is made from $-y$.

### Logarithmic

$y = a + b\ln x$ is linear in $a$ and $b$, so it is an ordinary least-squares
fit against $\ln x$. Points with $x \le 0$ are left out, and the number left
out is shown.

### Fourier series of a function

On $[x_0, x_1]$, with $t = (x - x_0)/(x_1 - x_0)$:

$$f(x) = L(t) + \frac{a_0}{2} + \sum_{k=1}^{H}\big(a_k \cos 2\pi k t + b_k \sin 2\pi k t\big),$$

where $L$ is the straight line through the two end points of the stroke. A
Fourier series is periodic. If the stroke ends at a different height than it
starts, the periodic copy has a jump, and a jump causes Gibbs overshoot and
coefficients that decay only like $1/k$. Subtracting $L$ first makes both
ends zero, so the periodic copy is continuous and the coefficients decay like
$1/k^2$. The coefficients come from an FFT of the stroke resampled at
uniform $x$. $H$ is limited to half the number of points (the Nyquist limit).

### Closed curves

The stroke is treated as a complex function $z = x + iy$, resampled at
equal arc-length steps, and transformed with an FFT:

$$z(t) = \sum_{k=-H}^{H} c_k\, e^{2\pi i k t}, \qquad t \in [0, 1].$$

The enclosed area follows from Green's theorem, $A = \tfrac12\oint(x\,dy - y\,dx)$.
Substituting the series gives

$$A = \pi \sum_{k} k\,|c_k|^2 .$$

This is compared with the shoelace formula on the raw points. The sign of
$A$ gives the direction: positive means counter-clockwise.

### Lanczos σ

Optional. It multiplies harmonic $k$ by $\sigma_k = \operatorname{sinc}\!\big(k/(H+1)\big)$,
which damps high harmonics. With $H$ instead of $H+1$ in the denominator, the
last harmonic would be multiplied by zero. It is off by default: both series
above are already continuous, and σ also scales the first harmonic
slightly, which shrinks the curve (about 2% of the area at 12 harmonics).

### Integration

The integral of the fitted function over $[a, b]$ is computed with $N$
subintervals:

| Method | Formula | Error |
| --- | --- | --- |
| Left / right | $h\sum f(x_i)$ at left or right ends | $O(h)$ |
| Midpoint | $h\sum f\big(\tfrac{x_i + x_{i+1}}{2}\big)$ | $O(h^2)$ |
| Trapezoid | $h\sum \tfrac12\big(f(x_i) + f(x_{i+1})\big)$ | $O(h^2)$ |
| Simpson | $\tfrac{h}{3}\big(f_0 + 4f_1 + 2f_2 + \dots + 4f_{N-1} + f_N\big)$ | $O(h^4)$ |
| Lebesgue | see below | |

The Lebesgue sum cuts the area into horizontal strips instead of vertical ones:

$$\int f^+\,dx = \int_0^{\max f} \mu\{x : f(x) > t\}\,dt,$$

where $\mu$ is the total length of the set of $x$ where $f$ is above the
level $t$. $\mu$ is measured from 20,000 sorted samples of $f$, and the
integral over $t$ uses the midpoint rule with $N$ levels. The negative part
is done the same way.

Each result is compared with a reference value from 5-point Gauss–Legendre
quadrature on 2,048 panels, split at segment ends. The error is shown
relative to $\int |f|\,dx$, because the signed area can be close to zero.

### Fit quality

Each segment shows $R^2 = 1 - SS_\text{res}/SS_\text{tot}$ and the RMSE.

## Tests

```bash
npm test
```

This needs Node 18 or newer and no packages. The 28 tests check the QR
solver, every model, a degree-30 fit, the FFT, the closed-curve area, every
integration method against exact values, the formula output, and a run over
broken input (NaN points, vertical lines, single dots, huge values).

## Files

```
index.html          page layout and Content-Security-Policy
src/math.js         fitting, FFT and integration (no DOM; also used by the tests)
src/app.js          drawing, canvas and results panel
src/splash.js       startup animation
src/styles.css      styles
assets/             logo, greeting font, dropdown arrow
tests/              unit tests
.github/workflows/  tests and GitHub Pages deploy
```

## Privacy

The page does not make network requests. Settings are saved in the
browser's `localStorage`. See [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Disclaimer

This project has no affiliation with Intel Corporation.
