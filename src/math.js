/*
 * Function Regression - fitting, Fourier transforms and integration.
 *
 * Pure functions only: no DOM, no globals besides the export. Loaded as a
 * classic script in the browser (window.FRMath) and as a CommonJS module by
 * the Node test suite.
 *
 * Points are plain {x, y} objects in math coordinates.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.FRMath = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MAX_DEGREE = 30;
    const MAX_HARMONICS = 500;
    const TAU = 2 * Math.PI;

    // ---------------------------------------------------------------- basics

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function sinc(x) {
        if (Math.abs(x) < 1e-12) return 1;
        const px = Math.PI * x;
        return Math.sin(px) / px;
    }

    /** Lanczos sigma factor for harmonic k of an m-term series (never zeroes term m). */
    function lanczos(k, m) {
        return sinc(k / (m + 1));
    }

    function nextPow2(n) {
        let p = 1;
        while (p < n) p <<= 1;
        return p;
    }

    // ---------------------------------------------------------------- linear algebra

    /**
     * Weighted linear least squares via Householder QR: minimise
     * sum_i w_i (rows_i . c - b_i)^2. Numerically stable (no normal equations);
     * rank-deficient columns get a zero coefficient.
     */
    function lstsq(rows, b, weights) {
        const m = rows.length;
        const n = rows[0].length;
        if (m < n) throw new Error('lstsq: fewer rows than unknowns');
        const A = [];
        for (let j = 0; j < n; j++) A.push(new Float64Array(m));
        const y = new Float64Array(m);
        for (let i = 0; i < m; i++) {
            const s = weights ? Math.sqrt(weights[i]) : 1;
            for (let j = 0; j < n; j++) A[j][i] = rows[i][j] * s;
            y[i] = b[i] * s;
        }

        const diag = new Float64Array(n);
        for (let k = 0; k < n; k++) {
            const col = A[k];
            let norm2 = 0;
            for (let i = k; i < m; i++) norm2 += col[i] * col[i];
            const norm = Math.sqrt(norm2);
            if (norm === 0) { diag[k] = 0; continue; }
            const alpha = col[k] > 0 ? -norm : norm;
            col[k] -= alpha;
            let v2 = 0;
            for (let i = k; i < m; i++) v2 += col[i] * col[i];
            diag[k] = alpha;
            if (v2 === 0) continue;
            for (let j = k + 1; j < n; j++) {
                const cj = A[j];
                let s = 0;
                for (let i = k; i < m; i++) s += col[i] * cj[i];
                const f = (2 * s) / v2;
                for (let i = k; i < m; i++) cj[i] -= f * col[i];
            }
            let s = 0;
            for (let i = k; i < m; i++) s += col[i] * y[i];
            const f = (2 * s) / v2;
            for (let i = k; i < m; i++) y[i] -= f * col[i];
        }

        let dmax = 0;
        for (let k = 0; k < n; k++) dmax = Math.max(dmax, Math.abs(diag[k]));
        const tol = dmax * Math.max(m, n) * 1e-13;
        const x = new Float64Array(n);
        let rank = 0;
        for (let k = n - 1; k >= 0; k--) {
            if (Math.abs(diag[k]) <= tol) { x[k] = 0; continue; }
            rank++;
            let s = y[k];
            for (let j = k + 1; j < n; j++) s -= A[j][k] * x[j];
            x[k] = s / diag[k];
        }
        return { coef: Array.from(x), rank };
    }

    // ---------------------------------------------------------------- FFT

    /** In-place iterative radix-2 FFT. sign = -1 forward, +1 inverse (unscaled). */
    function fft(re, im, sign) {
        const n = re.length;
        if (n & (n - 1)) throw new Error('fft: length must be a power of two');
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                let t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const ang = (sign * TAU) / len;
            const wr = Math.cos(ang), wi = Math.sin(ang);
            const half = len >> 1;
            for (let i = 0; i < n; i += len) {
                let cr = 1, ci = 0;
                for (let j = 0; j < half; j++) {
                    const a = i + j, b = a + half;
                    const tr = re[b] * cr - im[b] * ci;
                    const ti = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - tr; im[b] = im[a] - ti;
                    re[a] += tr; im[a] += ti;
                    const nr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = nr;
                }
            }
        }
    }

    // ---------------------------------------------------------------- sample prep

    function finitePoints(points) {
        return points.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    }

    /**
     * Sort by x and attach quadrature weights w_i ~ dx around each sample, so
     * the discrete fit approximates the continuous L2 error over the domain
     * instead of over-weighting places where the pen moved slowly.
     */
    function prepareFunctionSamples(points) {
        const pts = finitePoints(points).slice().sort((a, b) => a.x - b.x);
        const n = pts.length;
        if (n === 0) return { pts, w: [], minX: 0, maxX: 0, distinct: 0 };
        const minX = pts[0].x, maxX = pts[n - 1].x;
        const range = maxX - minX;
        const eps = range > 0 ? range * 1e-4 : 1;
        const w = new Array(n);
        let total = 0;
        for (let i = 0; i < n; i++) {
            const left = i > 0 ? pts[i].x - pts[i - 1].x : 0;
            const right = i < n - 1 ? pts[i + 1].x - pts[i].x : 0;
            w[i] = Math.max((left + right) / 2, eps);
            total += w[i];
        }
        for (let i = 0; i < n; i++) w[i] *= n / total;
        let distinct = n ? 1 : 0;
        for (let i = 1; i < n; i++) if (pts[i].x - pts[i - 1].x > eps * 1e-3) distinct++;
        return { pts, w, minX, maxX, distinct };
    }

    /** Linear interpolation of sorted points on n uniform samples over [a, b) (periodic grid). */
    function resampleUniform(pts, a, b, n) {
        const out = new Float64Array(n);
        let j = 0;
        for (let i = 0; i < n; i++) {
            const x = a + ((b - a) * i) / n;
            while (j < pts.length - 2 && pts[j + 1].x < x) j++;
            const p = pts[j], q = pts[Math.min(j + 1, pts.length - 1)];
            const dx = q.x - p.x;
            out[i] = dx > 0 ? p.y + ((q.y - p.y) * (x - p.x)) / dx : p.y;
        }
        return out;
    }

    function weightedStats(pts, w, f) {
        let sw = 0, swy = 0;
        for (let i = 0; i < pts.length; i++) { sw += w[i]; swy += w[i] * pts[i].y; }
        const mean = swy / sw;
        let ssRes = 0, ssTot = 0, sq = 0;
        for (let i = 0; i < pts.length; i++) {
            const r = pts[i].y - f(pts[i].x);
            ssRes += w[i] * r * r;
            ssTot += w[i] * (pts[i].y - mean) ** 2;
            sq += r * r;
        }
        return {
            n: pts.length,
            rmse: Math.sqrt(sq / pts.length),
            r2: ssTot > 0 ? 1 - ssRes / ssTot : (ssRes < 1e-18 ? 1 : 0),
        };
    }

    // ---------------------------------------------------------------- polynomial (Chebyshev)

    function clenshaw(a, u) {
        let b1 = 0, b2 = 0;
        for (let k = a.length - 1; k >= 1; k--) {
            const t = 2 * u * b1 - b2 + a[k];
            b2 = b1; b1 = t;
        }
        return u * b1 - b2 + a[0];
    }

    /** Chebyshev series -> power series in the same variable. */
    function chebToMonomial(a) {
        const d = a.length - 1;
        const out = new Array(d + 1).fill(0);
        let prev = [1], cur = [0, 1];
        out[0] += a[0];
        if (d >= 1) out[1] += a[1];
        for (let k = 2; k <= d; k++) {
            const next = new Array(k + 1).fill(0);
            for (let i = 0; i < cur.length; i++) next[i + 1] += 2 * cur[i];
            for (let i = 0; i < prev.length; i++) next[i] -= prev[i];
            for (let i = 0; i <= k; i++) out[i] += a[k] * next[i];
            prev = cur; cur = next;
        }
        return out;
    }

    /** Power series in u = (x - c)/h -> power series in x (Horner on polynomials). */
    function shiftMonomial(mono, c, h) {
        const alpha = 1 / h, beta = -c / h;
        let res = [mono[mono.length - 1]];
        for (let k = mono.length - 2; k >= 0; k--) {
            const next = new Array(res.length + 1).fill(0);
            for (let i = 0; i < res.length; i++) {
                next[i] += beta * res[i];
                next[i + 1] += alpha * res[i];
            }
            next[0] += mono[k];
            res = next;
        }
        return res;
    }

    function fitPolynomial(prep, degree) {
        const { pts, w, minX, maxX, distinct } = prep;
        const d = clamp(Math.round(degree), 0, Math.min(MAX_DEGREE, Math.max(0, distinct - 1)));
        const c = (minX + maxX) / 2;
        const h = (maxX - minX) / 2 || 1;
        const rows = pts.map(p => {
            const u = (p.x - c) / h;
            const r = [1];
            if (d >= 1) r.push(u);
            for (let k = 2; k <= d; k++) r.push(2 * u * r[k - 1] - r[k - 2]);
            return r;
        });
        const { coef } = lstsq(rows, pts.map(p => p.y), w);
        const monoU = chebToMonomial(coef);
        return {
            model: 'polynomial', degree: d, requestedDegree: degree, cheb: coef, center: c, halfWidth: h,
            monoU, monoX: d <= 10 ? shiftMonomial(monoU, c, h) : null,
        };
    }

    // ---------------------------------------------------------------- other models

    function fitConstant(prep) {
        let sw = 0, s = 0;
        prep.pts.forEach((p, i) => { sw += prep.w[i]; s += prep.w[i] * p.y; });
        return { model: 'constant', value: s / sw };
    }

    function fitLogarithmic(prep) {
        const idx = [];
        prep.pts.forEach((p, i) => { if (p.x > 0) idx.push(i); });
        if (idx.length < 3) throw new Error('Logarithmic fit needs points with x > 0.');
        const rows = idx.map(i => [1, Math.log(prep.pts[i].x)]);
        const { coef } = lstsq(rows, idx.map(i => prep.pts[i].y), idx.map(i => prep.w[i]));
        return { model: 'logarithmic', a: coef[0], b: coef[1], dropped: prep.pts.length - idx.length };
    }

    /**
     * y = A e^{b x}. Stored centred as a e^{b (x - x0)} to avoid overflow.
     * Log-linear initial guess (weighted by y^2 to undo the log's bias), then
     * Levenberg-Marquardt on the true residuals.
     */
    function fitExponential(prep) {
        const { pts, w } = prep;
        let sw = 0, sx = 0;
        pts.forEach((p, i) => { sw += w[i]; sx += w[i] * p.x; });
        const x0 = sx / sw;
        const sumY = pts.reduce((s, p) => s + p.y, 0);
        const sgn = sumY < 0 ? -1 : 1;

        const pos = [];
        pts.forEach((p, i) => { if (sgn * p.y > 0) pos.push(i); });
        let a, b;
        if (pos.length >= 2) {
            const rows = pos.map(i => [1, pts[i].x - x0]);
            const ww = pos.map(i => w[i] * pts[i].y * pts[i].y);
            const { coef } = lstsq(rows, pos.map(i => Math.log(sgn * pts[i].y)), ww);
            a = sgn * Math.exp(coef[0]); b = coef[1];
        } else {
            a = sumY / pts.length || 1; b = 0;
        }

        const sse = (A, B) => {
            let s = 0;
            for (let i = 0; i < pts.length; i++) {
                const r = A * Math.exp(B * (pts[i].x - x0)) - pts[i].y;
                s += w[i] * r * r;
            }
            return s;
        };
        let cost = sse(a, b), lambda = 1e-3;
        for (let iter = 0; iter < 100; iter++) {
            let j11 = 0, j12 = 0, j22 = 0, g1 = 0, g2 = 0;
            for (let i = 0; i < pts.length; i++) {
                const dx = pts[i].x - x0;
                const e = Math.exp(b * dx);
                const r = a * e - pts[i].y;
                const da = e, db = a * dx * e;
                j11 += w[i] * da * da; j12 += w[i] * da * db; j22 += w[i] * db * db;
                g1 += w[i] * da * r; g2 += w[i] * db * r;
            }
            let improved = false;
            for (let tries = 0; tries < 12; tries++) {
                const m11 = j11 * (1 + lambda), m22 = j22 * (1 + lambda);
                const det = m11 * m22 - j12 * j12;
                if (!(Math.abs(det) > 0)) { lambda *= 10; continue; }
                const da = -(m22 * g1 - j12 * g2) / det;
                const db = -(m11 * g2 - j12 * g1) / det;
                const na = a + da, nb = b + db;
                const nc = sse(na, nb);
                if (Number.isFinite(nc) && nc < cost) {
                    const rel = (cost - nc) / (cost || 1);
                    a = na; b = nb; cost = nc; lambda = Math.max(lambda / 10, 1e-12);
                    improved = rel > 1e-12;
                    break;
                }
                lambda *= 10;
            }
            if (!improved) break;
        }
        return { model: 'exponential', a, b, x0, A: a * Math.exp(-b * x0) };
    }

    /**
     * 1-D trigonometric series on [minX, maxX]. The chord between the end
     * values is removed first so the periodic extension is continuous: the
     * coefficients then decay like 1/k^2 and the Gibbs overshoot at the
     * interval ends disappears.
     */
    function fitFourier(prep, harmonics, sigma) {
        const { pts, minX, maxX, distinct } = prep;
        const range = maxX - minX;
        if (!(range > 0)) throw new Error('Fourier fit needs a stroke with some horizontal extent.');
        const maxH = Math.max(1, Math.floor((distinct - 1) / 2));
        const H = clamp(Math.round(harmonics), 1, Math.min(MAX_HARMONICS, maxH));
        const N = nextPow2(Math.max(1024, 8 * H));
        const samples = resampleUniform(pts, minX, maxX, N);
        const y0 = pts[0].y, y1 = pts[pts.length - 1].y;
        const re = new Float64Array(N), im = new Float64Array(N);
        for (let i = 0; i < N; i++) re[i] = samples[i] - (y0 + ((y1 - y0) * i) / N);
        fft(re, im, -1);
        const a = [], b = [];
        for (let k = 1; k <= H; k++) {
            const s = sigma ? lanczos(k, H) : 1;
            a.push((2 * re[k] / N) * s);
            b.push((-2 * im[k] / N) * s);
        }
        return {
            model: 'fourier', harmonics: H, requestedHarmonics: harmonics,
            minX, range, y0, y1, a0: re[0] / N, a, b,
        };
    }

    // ---------------------------------------------------------------- evaluation

    /** Sum a_k cos(k th) + b_k sin(k th), k = 1..n, by angle-addition recurrence. */
    function trigSum(a, b, th) {
        const c1 = Math.cos(th), s1 = Math.sin(th);
        let c = c1, s = s1, sum = 0;
        for (let k = 0; k < a.length; k++) {
            sum += a[k] * c + b[k] * s;
            const nc = c * c1 - s * s1;
            s = s * c1 + c * s1;
            c = nc;
        }
        return sum;
    }

    function evaluateModel(m, x) {
        switch (m.model) {
            case 'constant': return m.value;
            case 'polynomial': return clenshaw(m.cheb, (x - m.center) / m.halfWidth);
            case 'logarithmic': return x > 0 ? m.a + m.b * Math.log(x) : NaN;
            case 'exponential': return m.a * Math.exp(m.b * (x - m.x0));
            case 'fourier': {
                const t = (x - m.minX) / m.range;
                return m.y0 + (m.y1 - m.y0) * t + m.a0 + trigSum(m.a, m.b, TAU * t);
            }
            default: return NaN;
        }
    }

    const FITTERS = {
        constant: prep => fitConstant(prep),
        polynomial: (prep, o) => fitPolynomial(prep, o.degree),
        logarithmic: prep => fitLogarithmic(prep),
        exponential: prep => fitExponential(prep),
        fourier: (prep, o) => fitFourier(prep, o.harmonics, o.sigma),
    };

    /** Fit y = f(x) to one stroke. Returns a piece: {minX, maxX, fit, stats} or {error}. */
    function fitFunction(points, model, opts) {
        const prep = prepareFunctionSamples(points);
        if (prep.pts.length < 2) return { error: 'Not enough points.' };
        const fitter = FITTERS[model];
        if (!fitter) return { error: 'Unknown model.' };
        try {
            const fit = fitter(prep, opts || {});
            const f = x => evaluateModel(fit, x);
            const valid = model === 'logarithmic' ? prep.pts.map(p => p.x > 0) : null;
            const pts = valid ? prep.pts.filter((_, i) => valid[i]) : prep.pts;
            const w = valid ? prep.w.filter((_, i) => valid[i]) : prep.w;
            return { minX: prep.minX, maxX: prep.maxX, fit, stats: weightedStats(pts, w, f) };
        } catch (err) {
            return { minX: prep.minX, maxX: prep.maxX, error: err.message };
        }
    }

    /** Piecewise evaluator: first piece whose domain contains x, NaN in gaps. */
    function piecewise(pieces) {
        const ok = pieces.filter(p => p.fit);
        return x => {
            for (const p of ok) if (x >= p.minX && x <= p.maxX) return evaluateModel(p.fit, x);
            return NaN;
        };
    }

    // ---------------------------------------------------------------- closed curves

    function arcResample(points, n) {
        const pts = finitePoints(points);
        const m = pts.length;
        const cum = [0];
        for (let i = 0; i < m; i++) {
            const p = pts[i], q = pts[(i + 1) % m];
            cum.push(cum[i] + Math.hypot(q.x - p.x, q.y - p.y));
        }
        const total = cum[m];
        const xs = new Float64Array(n), ys = new Float64Array(n);
        let seg = 0;
        for (let i = 0; i < n; i++) {
            const target = (total * i) / n;
            while (seg < m - 1 && cum[seg + 1] < target) seg++;
            const p = pts[seg], q = pts[(seg + 1) % m];
            const len = cum[seg + 1] - cum[seg];
            const t = len > 0 ? (target - cum[seg]) / len : 0;
            xs[i] = p.x + (q.x - p.x) * t;
            ys[i] = p.y + (q.y - p.y) * t;
        }
        return { xs, ys, perimeter: total };
    }

    /** Signed polygon area (shoelace); positive = counter-clockwise. */
    function shoelace(points) {
        const pts = finitePoints(points);
        let s = 0;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            s += p.x * q.y - q.x * p.y;
        }
        return s / 2;
    }

    /**
     * Complex Fourier series z(t) = sum_{|k|<=H} c_k e^{2 pi i k t} of a closed
     * stroke, sampled uniformly by arc length. Also returns the reconstructed
     * outline, its RMS deviation from the stroke and the enclosed area
     * A = pi * sum k |c_k|^2 computed from the coefficients.
     */
    function fitClosed(points, harmonics, sigma) {
        const pts = finitePoints(points);
        if (pts.length < 4) return { error: 'Not enough points.' };
        const maxH = Math.max(1, Math.floor(pts.length / 2));
        const H = clamp(Math.round(harmonics), 1, Math.min(MAX_HARMONICS, maxH));
        const N = nextPow2(Math.max(1024, 8 * H));
        const { xs, ys, perimeter } = arcResample(pts, N);
        const re = Float64Array.from(xs), im = Float64Array.from(ys);
        fft(re, im, -1);

        const coeffs = [];
        const sre = new Float64Array(N), sim = new Float64Array(N);
        for (let k = -H; k <= H; k++) {
            const idx = (k + N) % N;
            const s = sigma && k !== 0 ? lanczos(Math.abs(k), H) : 1;
            const cr = (re[idx] / N) * s, ci = (im[idx] / N) * s;
            coeffs.push({ k, re: cr, im: ci });
            sre[idx] = cr; sim[idx] = ci;
        }
        fft(sre, sim, +1);

        let err = 0;
        for (let i = 0; i < N; i++) err += (sre[i] - xs[i]) ** 2 + (sim[i] - ys[i]) ** 2;
        let area = 0;
        for (const c of coeffs) area += c.k * (c.re * c.re + c.im * c.im);
        area *= Math.PI;

        return {
            harmonics: H, requestedHarmonics: harmonics, coeffs,
            outline: { xs: sre, ys: sim },
            rmsError: Math.sqrt(err / N),
            perimeter,
            fittedArea: area,
            rawArea: shoelace(pts),
        };
    }

    // ---------------------------------------------------------------- integration

    const GL5 = [
        [0, 0.5688888888888889],
        [-0.5384693101056831, 0.4786286704993665], [0.5384693101056831, 0.4786286704993665],
        [-0.9061798459386640, 0.2369268850561891], [0.9061798459386640, 0.2369268850561891],
    ];

    const val = v => (Number.isFinite(v) ? v : 0);

    /**
     * High-accuracy reference integral of f on [a, b]: composite 5-point
     * Gauss-Legendre on each interval between breakpoints (piece ends), so
     * jumps between pieces never fall inside a panel.
     */
    function integrateReference(f, a, b, breakpoints, panels) {
        const cuts = [a, b, ...(breakpoints || []).filter(x => x > a && x < b)].sort((p, q) => p - q);
        const per = Math.max(8, Math.ceil((panels || 2048) / (cuts.length - 1)));
        let total = 0;
        for (let s = 0; s + 1 < cuts.length; s++) {
            const lo = cuts[s], hi = cuts[s + 1];
            const h = (hi - lo) / per;
            if (!(h > 0)) continue;
            for (let i = 0; i < per; i++) {
                const mid = lo + (i + 0.5) * h;
                let acc = 0;
                for (const [node, weight] of GL5) acc += weight * val(f(mid + (node * h) / 2));
                total += (acc * h) / 2;
            }
        }
        return total;
    }

    /**
     * Lebesgue sum: integral f+ = int_0^max mu{f > t} dt (and likewise for f-),
     * with the measure mu estimated from dense midpoint samples and the level
     * integral taken with the midpoint rule over n levels.
     */
    function lebesgue(f, a, b, n, samples) {
        const M = samples || 20000;
        const dx = (b - a) / M;
        const pos = [], neg = [];
        for (let i = 0; i < M; i++) {
            const v = f(a + (i + 0.5) * dx);
            if (!Number.isFinite(v)) continue;
            if (v > 0) pos.push(v); else if (v < 0) neg.push(-v);
        }
        pos.sort((p, q) => p - q);
        neg.sort((p, q) => p - q);
        const countAbove = (arr, t) => {
            let lo = 0, hi = arr.length;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] > t) hi = mid; else lo = mid + 1; }
            return arr.length - lo;
        };
        const part = arr => {
            if (!arr.length) return { value: 0, dt: 0 };
            const top = arr[arr.length - 1];
            const dt = top / n;
            let s = 0;
            for (let j = 0; j < n; j++) s += countAbove(arr, (j + 0.5) * dt) * dx * dt;
            return { value: s, dt };
        };
        const p = part(pos), q = part(neg);
        return { value: p.value - q.value, dtPos: p.dt, dtNeg: q.dt };
    }

    /** Horizontal level strips for drawing a Lebesgue sum, in math coordinates. */
    function lebesgueStrips(f, a, b, n, samples) {
        const M = samples || 4000;
        const dx = (b - a) / M;
        const ys = new Float64Array(M);
        let top = 0, bottom = 0;
        for (let i = 0; i < M; i++) {
            const v = f(a + (i + 0.5) * dx);
            ys[i] = Number.isFinite(v) ? v : 0;
            top = Math.max(top, ys[i]); bottom = Math.min(bottom, ys[i]);
        }
        const strips = [];
        const levels = (extent, sign) => {
            if (!(extent > 0)) return;
            const dt = extent / n;
            for (let j = 0; j < n; j++) {
                const t = (j + 0.5) * dt;
                let start = -1;
                for (let i = 0; i <= M; i++) {
                    const inside = i < M && sign * ys[i] > t;
                    if (inside && start < 0) start = i;
                    else if (!inside && start >= 0) {
                        strips.push({ x0: a + start * dx, x1: a + i * dx, y0: sign * j * dt, y1: sign * (j + 1) * dt });
                        start = -1;
                    }
                }
            }
        };
        levels(top, 1);
        levels(-bottom, -1);
        return strips;
    }

    /** Numerical integral of f over [a, b] with n subintervals. */
    function integrate(f, a, b, method, n) {
        if (!(b > a) || !(n >= 1)) return 0;
        if (method === 'lebesgue') return lebesgue(f, a, b, n).value;
        if (method === 'simpson') {
            const m = n % 2 ? n + 1 : n;
            const h = (b - a) / m;
            let s = val(f(a)) + val(f(b));
            for (let i = 1; i < m; i++) s += (i % 2 ? 4 : 2) * val(f(a + i * h));
            return (s * h) / 3;
        }
        const h = (b - a) / n;
        let s = 0;
        for (let i = 0; i < n; i++) {
            const xl = a + i * h, xr = xl + h;
            if (method === 'left') s += val(f(xl));
            else if (method === 'right') s += val(f(xr));
            else if (method === 'mid') s += val(f(xl + h / 2));
            else s += (val(f(xl)) + val(f(xr))) / 2;
        }
        return s * h;
    }

    // ---------------------------------------------------------------- formatting

    /** Number as LaTeX: plain decimal in [1e-4, 1e6), else a \cdot 10^{e}. */
    function texNum(v, sig) {
        const digits = sig || 6;
        if (!Number.isFinite(v) || v === 0) return '0';
        const a = Math.abs(v);
        if (a >= 1e-4 && a < 1e6) return String(Number(v.toPrecision(digits)));
        const [mant, exp] = v.toExponential(digits - 1).split('e');
        return `${Number(mant)}\\cdot10^{${Number(exp)}}`;
    }

    /** Same number as display HTML. Output contains only digits, signs and fixed markup. */
    function htmlNum(v, sig) {
        const digits = sig || 6;
        if (!Number.isFinite(v) || v === 0) return '0';
        const a = Math.abs(v);
        if (a >= 1e-4 && a < 1e6) return String(Number(v.toPrecision(digits))).replace('-', '−');
        const [mant, exp] = v.toExponential(digits - 1).split('e');
        return `${String(Number(mant)).replace('-', '−')}×10<sup>${String(Number(exp)).replace('-', '−')}</sup>`;
    }

    /**
     * Join signed terms. Each term: {c, tex, html} where tex/html is the basis
     * (empty string for a constant). Tiny terms relative to the largest are dropped.
     */
    function joinTerms(terms, limit) {
        // A term's size is |c| times its basis magnitude over the domain (t.w, default 1);
        // terms below 1e-9 of the largest are floating-point noise from the fit.
        const size = t => Math.abs(t.c) * (t.w === undefined ? 1 : t.w);
        const biggest = terms.reduce((m, t) => Math.max(m, size(t)), 0);
        const kept = terms.filter(t => Number.isFinite(t.c) && size(t) > biggest * 1e-9);
        const shown = limit && kept.length > limit ? kept.slice(0, limit) : kept;
        let tex = '', html = '';
        shown.forEach((t, i) => {
            const neg = t.c < 0;
            const mag = Math.abs(t.c);
            const unit = t.tex && Math.abs(mag - 1) < 1e-12;
            const nTex = unit ? '' : texNum(mag);
            const nHtml = unit ? '' : htmlNum(mag);
            if (i === 0) { tex += neg ? '-' : ''; html += neg ? '−' : ''; }
            else { tex += neg ? ' - ' : ' + '; html += neg ? ' − ' : ' + '; }
            tex += nTex + t.tex;
            html += nHtml + (t.html && nHtml ? ' ' : '') + t.html;
        });
        if (!shown.length) { tex = '0'; html = '0'; }
        if (shown.length < kept.length) { tex += ' + \\dots'; html += ' + …'; }
        return { tex, html, truncated: shown.length < kept.length };
    }

    const X_HTML = '<i>x</i>';
    const powHtml = (v, k) => (k === 0 ? '' : k === 1 ? v : `${v}<sup>${k}</sup>`);
    const powTex = (v, k) => (k === 0 ? '' : k === 1 ? v : `${v}^{${k}}`);

    /**
     * Formula for one fitted piece. Returns {tex, html, note} where tex is a
     * Desmos-ready expression in x (without domain restriction).
     */
    function formatFit(fit, opts) {
        const limit = opts && opts.limit;
        switch (fit.model) {
            case 'constant': {
                const r = joinTerms([{ c: fit.value, tex: '', html: '' }]);
                return { tex: r.tex, html: r.html };
            }
            case 'logarithmic': {
                const r = joinTerms([
                    { c: fit.b, tex: '\\ln\\left(x\\right)', html: 'ln(' + X_HTML + ')' },
                    { c: fit.a, tex: '', html: '' },
                ]);
                return { tex: r.tex, html: r.html, note: fit.dropped ? `${fit.dropped} point(s) with x ≤ 0 ignored` : '' };
            }
            case 'exponential': {
                const centred = !Number.isFinite(fit.A) || Math.abs(fit.A) > 1e12 || Math.abs(fit.A) < 1e-12;
                if (centred) {
                    const shift = joinTerms([{ c: 1, tex: 'x', html: X_HTML }, { c: -fit.x0, tex: '', html: '' }]);
                    return {
                        tex: `${texNum(fit.a)}e^{${texNum(fit.b)}\\left(${shift.tex}\\right)}`,
                        html: `${htmlNum(fit.a)} <i>e</i><sup>${htmlNum(fit.b)}(${shift.html})</sup>`,
                    };
                }
                return {
                    tex: `${texNum(fit.A)}e^{${texNum(fit.b)}x}`,
                    html: `${htmlNum(fit.A)} <i>e</i><sup>${htmlNum(fit.b)}<i>x</i></sup>`,
                };
            }
            case 'polynomial': {
                if (fit.monoX) {
                    const xmax = Math.max(Math.abs(fit.center - fit.halfWidth), Math.abs(fit.center + fit.halfWidth)) || 1;
                    const terms = [];
                    for (let k = fit.monoX.length - 1; k >= 0; k--) {
                        terms.push({ c: fit.monoX[k], w: xmax ** k, tex: powTex('x', k), html: powHtml(X_HTML, k) });
                    }
                    const r = joinTerms(terms, limit);
                    return { tex: joinTerms(terms).tex, html: r.html };
                }
                // High degree: keep the well-conditioned centred variable u.
                const u = joinTerms([{ c: 1, tex: 'x', html: X_HTML }, { c: -fit.center, tex: '', html: '' }]);
                const uTex = `\\left(\\frac{${u.tex}}{${texNum(fit.halfWidth)}}\\right)`;
                const terms = [];
                for (let k = fit.monoU.length - 1; k >= 0; k--) {
                    terms.push({ c: fit.monoU[k], tex: powTex(uTex, k), html: powHtml('<i>u</i>', k) });
                }
                return {
                    tex: joinTerms(terms).tex,
                    html: joinTerms(terms, limit).html,
                    note: `u = (${u.html}) / ${htmlNum(fit.halfWidth)}`,
                };
            }
            case 'fourier': {
                const slope = (fit.y1 - fit.y0) / fit.range;
                const tTex = `\\frac{x-${texNum(fit.minX)}}{${texNum(fit.range)}}`.replace('x--', 'x+');
                const xmax = Math.max(Math.abs(fit.minX), Math.abs(fit.minX + fit.range)) || 1;
                const terms = [
                    { c: fit.y0 + fit.a0 - slope * fit.minX, tex: '', html: '' },
                    { c: slope, w: xmax, tex: 'x', html: X_HTML },
                ];
                for (let k = 1; k <= fit.a.length; k++) {
                    const arg = `${2 * k}\\pi${tTex}`;
                    const argHtml = `${2 * k}π<i>t</i>`;
                    terms.push({ c: fit.a[k - 1], tex: `\\cos\\left(${arg}\\right)`, html: `cos(${argHtml})` });
                    terms.push({ c: fit.b[k - 1], tex: `\\sin\\left(${arg}\\right)`, html: `sin(${argHtml})` });
                }
                const t = joinTerms([{ c: 1, tex: 'x', html: X_HTML }, { c: -fit.minX, tex: '', html: '' }]);
                return {
                    tex: joinTerms(terms).tex,
                    html: joinTerms(terms, limit || 8).html,
                    note: `t = (${t.html}) / ${htmlNum(fit.range)}`,
                };
            }
            default:
                return { tex: '0', html: '0' };
        }
    }

    /** Desmos-ready parametric curve (X(t), Y(t)) for t in [0, 1]. */
    function formatParametric(coeffs) {
        const biggest = coeffs.reduce((m, c) => Math.max(m, Math.hypot(c.re, c.im)), 0);
        const xs = [], ys = [];
        for (const { k, re, im } of coeffs) {
            if (Math.hypot(re, im) <= biggest * 1e-6) continue;
            if (k === 0) {
                xs.push({ c: re, tex: '' }); ys.push({ c: im, tex: '' });
                continue;
            }
            const arg = `${2 * k}\\pi t`;
            xs.push({ c: re, tex: `\\cos\\left(${arg}\\right)` }, { c: -im, tex: `\\sin\\left(${arg}\\right)` });
            ys.push({ c: re, tex: `\\sin\\left(${arg}\\right)` }, { c: im, tex: `\\cos\\left(${arg}\\right)` });
        }
        const withHtml = arr => arr.map(t => ({ ...t, html: '' }));
        return `\\left(${joinTerms(withHtml(xs)).tex},\\ ${joinTerms(withHtml(ys)).tex}\\right)`;
    }

    // ---------------------------------------------------------------- pipeline

    /**
     * Endpoints close together relative to the stroke's size mean a loop.
     * `scale` is pixels per unit, so the thresholds are in screen pixels.
     */
    function isClosedStroke(stroke, scale) {
        const pts = finitePoints(stroke);
        if (pts.length < 4) return false;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, length = 0;
        pts.forEach((p, i) => {
            x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
            if (i) length += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
        });
        const first = pts[0], last = pts[pts.length - 1];
        const gap = Math.hypot(first.x - last.x, first.y - last.y) * scale;
        const diag = Math.hypot(x1 - x0, y1 - y0) * scale;
        return diag > 30 && gap < Math.max(24, 0.15 * diag) && length * scale > 3 * gap;
    }

    /**
     * Fit and integrate a set of strokes. Never throws: failures come back as
     * {type: 'error'} or as pieces with an `error` field.
     *
     * settings: {drawingMode, shape, model, degree, harmonics, sigma, intMethod, intN}
     */
    function analyzeStrokes(strokes, settings, scale) {
        try {
            const valid = (strokes || []).map(finitePoints).filter(s => s.length >= 4);
            if (!valid.length) return null;
            const single = settings.drawingMode === 'single';
            const closed = single && (settings.shape === 'closed' ||
                (settings.shape === 'auto' && isClosedStroke(valid[0], scale)));

            if (closed) {
                const fit = fitClosed(valid[0], settings.harmonics, settings.sigma);
                return fit.error ? { type: 'error', message: fit.error } : { type: 'closed', fit };
            }

            const opts = { degree: settings.degree, harmonics: settings.harmonics, sigma: settings.sigma };
            const pieces = (single ? valid.slice(0, 1) : valid).map(s => fitFunction(s, settings.model, opts));
            const good = pieces.filter(p => p.fit);
            const result = { type: 'function', pieces };
            if (good.length) {
                const f = piecewise(good);
                const a = Math.min(...good.map(p => p.minX));
                const b = Math.max(...good.map(p => p.maxX));
                const breaks = good.flatMap(p => [p.minX, p.maxX]);
                result.f = f;
                result.domain = [a, b];
                // Rendering uses the method this result was computed with, never live settings.
                result.method = settings.intMethod;
                result.n = settings.intN;
                result.area = integrate(f, a, b, result.method, result.n);
                result.reference = integrateReference(f, a, b, breaks);
                result.absolute = integrateReference(x => Math.abs(f(x)), a, b, breaks);
                if (result.method === 'lebesgue') result.strips = lebesgueStrips(f, a, b, result.n);
            }
            return result;
        } catch (err) {
            return { type: 'error', message: `Analysis failed: ${err && err.message ? err.message : err}` };
        }
    }

    return {
        MAX_DEGREE, MAX_HARMONICS,
        isClosedStroke, analyzeStrokes,
        lstsq, fft, lanczos, clenshaw, chebToMonomial, shiftMonomial,
        prepareFunctionSamples, fitFunction, evaluateModel, piecewise,
        fitClosed, shoelace,
        integrate, integrateReference, lebesgue, lebesgueStrips,
        texNum, htmlNum, formatFit, formatParametric,
    };
});
