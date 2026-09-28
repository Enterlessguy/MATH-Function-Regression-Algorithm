'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/math.js');

const close = (actual, expected, tol, msg) =>
    assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected}, got ${actual} (tol ${tol})`);

function sample(f, a, b, n, jitter) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        // Uneven spacing, like a pen that speeds up and slows down.
        const t = i / (n - 1);
        const x = a + (b - a) * (jitter ? t * t * (3 - 2 * t) : t);
        pts.push({ x, y: f(x) });
    }
    return pts;
}

test('lstsq solves an overdetermined system exactly when consistent', () => {
    const rows = [[1, 0], [1, 1], [1, 2], [1, 3]];
    const b = rows.map(r => 2 + 3 * r[1]);
    const { coef, rank } = M.lstsq(rows, b);
    close(coef[0], 2, 1e-12);
    close(coef[1], 3, 1e-12);
    assert.equal(rank, 2);
});

test('lstsq handles rank deficiency without blowing up', () => {
    const rows = [[1, 2], [2, 4], [3, 6]];
    const { coef, rank } = M.lstsq(rows, [1, 2, 3]);
    assert.equal(rank, 1);
    assert.ok(coef.every(Number.isFinite));
});

test('polynomial fit recovers a cubic from unevenly spaced samples', () => {
    const f = x => 0.5 * x ** 3 - 2 * x ** 2 + x - 4;
    const piece = M.fitFunction(sample(f, -3, 5, 200, true), 'polynomial', { degree: 3 });
    const c = piece.fit.monoX;
    close(c[0], -4, 1e-8); close(c[1], 1, 1e-8); close(c[2], -2, 1e-8); close(c[3], 0.5, 1e-9);
    close(piece.stats.r2, 1, 1e-12);
});

test('high-degree polynomial stays well conditioned (degree 30)', () => {
    const f = x => Math.sin(3 * x) + 0.2 * x;
    const piece = M.fitFunction(sample(f, 20, 30, 600), 'polynomial', { degree: 30 });
    assert.equal(piece.fit.degree, 30);
    for (let x = 20; x <= 30; x += 0.37) close(M.evaluateModel(piece.fit, x), f(x), 1e-6, `x=${x}`);
});

test('polynomial degree is capped by the number of distinct x values', () => {
    const pts = [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 5 }];
    const piece = M.fitFunction(pts, 'polynomial', { degree: 10 });
    assert.equal(piece.fit.degree, 2);
});

test('Chebyshev -> monomial conversion matches Clenshaw evaluation', () => {
    const a = [0.3, -1.2, 0.7, 2.5, -0.4];
    const mono = M.chebToMonomial(a);
    for (let u = -1; u <= 1; u += 0.1) {
        const direct = mono.reduce((s, c, k) => s + c * u ** k, 0);
        close(direct, M.clenshaw(a, u), 1e-12);
    }
});

test('exponential fit is exact on clean data, including negative amplitude', () => {
    for (const [A, b] of [[2.5, 0.8], [-1.5, -0.6]]) {
        const piece = M.fitFunction(sample(x => A * Math.exp(b * x), -2, 3, 150), 'exponential', {});
        close(piece.fit.A, A, 1e-7 * Math.abs(A));
        close(piece.fit.b, b, 1e-8);
    }
});

test('exponential fit beats the log-linear shortcut on noisy data', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    const pts = sample(x => 3 * Math.exp(0.5 * x), 0, 4, 300).map(p => ({ x: p.x, y: p.y + rnd() * 0.8 }));
    const piece = M.fitFunction(pts, 'exponential', {});
    close(piece.fit.A, 3, 0.1);
    close(piece.fit.b, 0.5, 0.01);
});

test('logarithmic fit ignores x <= 0 and reports it', () => {
    const pts = sample(x => 1.5 + 2 * Math.log(x), 0.1, 6, 200);
    pts.push({ x: -1, y: 0 }, { x: 0, y: 0 });
    const piece = M.fitFunction(pts, 'logarithmic', {});
    close(piece.fit.a, 1.5, 1e-9);
    close(piece.fit.b, 2, 1e-9);
    assert.equal(piece.fit.dropped, 2);
});

test('logarithmic fit on x <= 0 only returns an error, not garbage', () => {
    const piece = M.fitFunction(sample(x => x, -5, -1, 50), 'logarithmic', {});
    assert.match(piece.error, /x > 0/);
});

test('Fourier fit reproduces a non-periodic signal without end-point Gibbs', () => {
    const f = x => Math.sin(x) + 0.3 * x;
    const piece = M.fitFunction(sample(f, 0, 10, 2000), 'fourier', { harmonics: 40, sigma: false });
    close(M.evaluateModel(piece.fit, 0), f(0), 0.03, 'left end');     // ~1/H decay after detrending
    close(M.evaluateModel(piece.fit, 10), f(10), 0.03, 'right end');
    for (let x = 0.5; x < 9.5; x += 0.73) close(M.evaluateModel(piece.fit, x), f(x), 5e-3, `x=${x}`);
});

test('Lanczos sigma never zeroes the last harmonic', () => {
    assert.ok(M.lanczos(10, 10) > 0);
    close(M.lanczos(0, 10), 1, 0);
});

test('FFT round-trips', () => {
    const re = Float64Array.from({ length: 16 }, (_, i) => Math.cos(i) + i);
    const im = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i * 0.3));
    const r0 = re.slice(), i0 = im.slice();
    M.fft(re, im, -1); M.fft(re, im, +1);
    for (let i = 0; i < 16; i++) { close(re[i] / 16, r0[i], 1e-12); close(im[i] / 16, i0[i], 1e-12); }
});

test('closed fit of a circle: area from coefficients matches pi r^2', () => {
    const pts = [];
    for (let i = 0; i < 400; i++) {
        const t = (2 * Math.PI * i) / 400;
        pts.push({ x: 1 + 3 * Math.cos(t), y: -2 + 3 * Math.sin(t) });
    }
    const fit = M.fitClosed(pts, 8, false);
    close(fit.fittedArea, Math.PI * 9, 0.01); // inscribed 400-gon
    close(fit.rawArea, Math.PI * 9, 0.01);
    assert.ok(fit.rmsError < 1e-3);
    // Clockwise traversal gives negative signed area.
    close(M.fitClosed(pts.slice().reverse(), 8, false).fittedArea, -Math.PI * 9, 0.01);
});

test('integration methods converge to the exact value', () => {
    const f = x => x * x - 1;               // integral over [-1, 2] = 0
    const exact = 0;
    close(M.integrate(f, -1, 2, 'simpson', 10), exact, 1e-12, 'simpson');
    close(M.integrate(f, -1, 2, 'mid', 1000), exact, 1e-5, 'mid');
    close(M.integrate(f, -1, 2, 'trapezoid', 1000), exact, 1e-5, 'trapezoid');
    close(M.integrate(f, -1, 2, 'left', 1000), exact, 1e-2, 'left');
    close(M.integrate(f, -1, 2, 'lebesgue', 400), exact, 2e-3, 'lebesgue');
    close(M.integrateReference(f, -1, 2), exact, 1e-12, 'reference');
});

test('Lebesgue sum is unbiased for a constant (old version over-counted a level)', () => {
    close(M.integrate(() => 2, 0, 3, 'lebesgue', 10), 6, 1e-9);
    close(M.integrate(() => -2, 0, 3, 'lebesgue', 10), -6, 1e-9);
});

test('piecewise evaluator returns NaN in gaps and integrals skip them', () => {
    const a = M.fitFunction(sample(() => 1, 0, 1, 20), 'constant', {});
    const b = M.fitFunction(sample(() => 3, 2, 3, 20), 'constant', {});
    const f = M.piecewise([a, b]);
    assert.ok(Number.isNaN(f(1.5)));
    close(M.integrateReference(f, 0, 3, [1, 2]), 4, 1e-9);
});

test('formatted numbers never contain markup from outside the formatter', () => {
    const html = M.htmlNum(-1.23456789e-9);
    assert.match(html, /^[−0-9.×]+<sup>[−0-9]+<\/sup>$/);
    assert.equal(M.texNum(1234.5678, 6), '1234.57');
});

test('formatFit produces Desmos-ready LaTeX for each model', () => {
    const pts = sample(x => 2 * x + 1, 1, 4, 50);
    for (const model of ['constant', 'polynomial', 'logarithmic', 'exponential', 'fourier']) {
        const piece = M.fitFunction(pts, model, { degree: 2, harmonics: 3, sigma: true });
        assert.ok(piece.fit, `${model}: ${piece.error}`);
        const { tex, html } = M.formatFit(piece.fit);
        assert.ok(tex.length > 0 && html.length > 0, model);
        assert.ok(!/NaN|undefined|Infinity/.test(tex), `${model}: ${tex}`);
    }
});

// ---------------------------------------------------------------- carried over from v2's suite

test('reference integral matches closed-form antiderivatives for every model', () => {
    const cases = [
        ['polynomial', x => 3 * x * x - 2 * x + 1, 0, 2, 8 - 4 + 2],
        ['exponential', x => 2 * Math.exp(0.5 * x), 0, 2, 4 * (Math.E - 1)],
        ['logarithmic', x => 1 + 2 * Math.log(x), 1, 3, 2 + 2 * (3 * Math.log(3) - 2)],
        ['constant', () => 5, -1, 3, 20],
    ];
    for (const [model, f, a, b, exact] of cases) {
        const piece = M.fitFunction(sample(f, a, b, 300), model, { degree: 2 });
        const g = x => M.evaluateModel(piece.fit, x);
        close(M.integrateReference(g, a, b), exact, 1e-7, model);
    }
});

test('Fourier reference integral matches term-by-term integration', () => {
    const piece = M.fitFunction(sample(x => Math.sin(2 * x) + x, 0, 5, 800), 'fourier', { harmonics: 20 });
    const fit = piece.fit;
    // Over one full period every harmonic integrates to 0: only the chord and a0 remain.
    const exact = fit.range * ((fit.y0 + fit.y1) / 2 + fit.a0);
    close(M.integrateReference(x => M.evaluateModel(fit, x), fit.minX, fit.minX + fit.range), exact, 1e-9);
});

test('Lebesgue handles a positive function that never touches zero (v2 regression)', () => {
    close(M.integrate(x => 3 + x, 0, 2, 'lebesgue', 400), 8, 2e-3);
});

test('auto closure detection works in screen pixels', () => {
    const loop = [];
    for (let i = 0; i <= 60; i++) { const t = (2 * Math.PI * i) / 64; loop.push({ x: 2 * Math.cos(t), y: 2 * Math.sin(t) }); }
    assert.equal(M.isClosedStroke(loop, 40), true);
    assert.equal(M.isClosedStroke(sample(x => x, -3, 3, 50), 40), false);
    // The same small loop seen from far away is just a dot: not a shape.
    assert.equal(M.isClosedStroke(loop, 2), false);
});

test('analyzeStrokes: piecewise strokes give one piece each with metrics', () => {
    const settings = { drawingMode: 'piecewise', shape: 'open', model: 'polynomial', degree: 2, harmonics: 5, sigma: false, intMethod: 'simpson', intN: 50 };
    const res = M.analyzeStrokes([sample(x => x, -3, -1, 30), sample(x => x * x, 0, 2, 30)], settings, 40);
    assert.equal(res.type, 'function');
    assert.equal(res.pieces.length, 2);
    assert.ok(res.pieces.every(p => p.stats.r2 > 0.999999));
    close(res.reference, -4 + 8 / 3, 1e-9);
});

test('analyzeStrokes returns null for strokes that are too short', () => {
    const settings = { drawingMode: 'single', shape: 'auto', model: 'polynomial', degree: 3, harmonics: 5, sigma: false, intMethod: 'mid', intN: 50 };
    assert.equal(M.analyzeStrokes([[{ x: 0, y: 0 }, { x: 1, y: 1 }]], settings, 40), null);
    assert.equal(M.analyzeStrokes([], settings, 40), null);
});

test('analyzeStrokes never throws on pathological input', () => {
    const nasty = [
        [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0.5 }],
        [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 1, y: 5 }],          // vertical line
        [{ x: NaN, y: 1 }, { x: 0, y: Infinity }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }, { x: 4, y: 0 }],
        Array.from({ length: 50 }, () => ({ x: 2, y: 2 })),                                         // a single dot
        Array.from({ length: 50 }, (_, i) => ({ x: i, y: 1e300 * (i % 2 ? 1 : -1) })),            // huge values
    ];
    for (const model of ['polynomial', 'fourier', 'exponential', 'logarithmic', 'constant']) {
        for (const shape of ['auto', 'open', 'closed']) {
            for (const intMethod of ['lebesgue', 'simpson', 'left']) {
                for (const mode of ['single', 'piecewise']) {
                    const settings = { drawingMode: mode, shape, model, degree: 30, harmonics: 500, sigma: true, intMethod, intN: 1000 };
                    for (const s of nasty) {
                        assert.doesNotThrow(() => {
                            const res = M.analyzeStrokes([s], settings, 40);
                            if (res && res.type === 'function') res.pieces.forEach(p => p.fit && M.formatFit(p.fit));
                            if (res && res.type === 'closed') M.formatParametric(res.fit.coeffs);
                        }, `${model}/${shape}/${intMethod}/${mode}`);
                    }
                }
            }
        }
    }
});

test('formatFit guards non-finite coefficients', () => {
    const { tex } = M.formatFit({ model: 'polynomial', degree: 1, cheb: [1, NaN], center: 0, halfWidth: 1, monoU: [1, NaN], monoX: [1, NaN] });
    assert.ok(!/NaN|Infinity/.test(tex), tex);
});

test('formatParametric produces a Desmos-ready tuple', () => {
    const pts = [];
    for (let i = 0; i < 200; i++) { const t = (2 * Math.PI * i) / 200; pts.push({ x: Math.cos(t), y: Math.sin(t) }); }
    const tex = M.formatParametric(M.fitClosed(pts, 3, false).coeffs);
    assert.match(tex, /^\\left\(.*,\\ .*\\right\)$/);
    assert.match(tex, /\\cos\\left\(2\\pi t\\right\)/);
});
