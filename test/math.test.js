/**
 * math.test.js: unit tests for the pure math core (runs with `npm test`,
 * i.e. `node --test test/`). No dependencies, no DOM required.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { solveGaussian, lstsqQR, fitPolynomial } from '../src/math/matrix.js';
import { regressPiece, computeDFT, fitMetrics } from '../src/math/regression.js';
import { evaluatePiecewise } from '../src/math/evaluate.js';
import {
  riemannIntegrate, simpsonIntegrate, lebesgueIntegrate,
  integrateNumeric, integrateExact, sampleFunction,
} from '../src/math/integrate.js';
import { formatPieceLatex, formatParametricLatex } from '../src/math/format.js';
import { computeAnalysis, detectClosed } from '../src/analysis.js';

// --- matrix ----------------------------------------------------------------

test('solveGaussian solves square systems', () => {
  const x = solveGaussian([[2, 1], [1, 3]], [5, 10]);
  assert.ok(Math.abs(x[0] - 1) < 1e-12, `x0=${x[0]}`);
  assert.ok(Math.abs(x[1] - 3) < 1e-12, `x1=${x[1]}`);
});

test('solveGaussian handles degenerate columns without NaN', () => {
  const x = solveGaussian([[0, 0], [0, 1]], [0, 2]);
  assert.ok(x.every((v) => Number.isFinite(v)));
});

test('lstsqQR fits an overdetermined line', () => {
  // y = 2 + 3x + small noise
  const xs = [0, 1, 2, 3, 4];
  const A = xs.map((x) => [1, x]);
  const b = xs.map((x) => 2 + 3 * x + (Math.random() - 0.5) * 1e-6);
  const [c0, c1] = lstsqQR(A, b);
  assert.ok(Math.abs(c0 - 2) < 1e-3);
  assert.ok(Math.abs(c1 - 3) < 1e-3);
});

test('fitPolynomial recovers a quadratic with high degree available', () => {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const x = (i / 40) * 4 - 2;
    pts.push({ x, y: 1 - 2 * x + 0.5 * x * x });
  }
  const c = fitPolynomial(pts.map((p) => p.x), pts.map((p) => p.y), 10);
  assert.ok(Math.abs(c[0] - 1) < 1e-6);
  assert.ok(Math.abs(c[1] - -2) < 1e-6);
  assert.ok(Math.abs(c[2] - 0.5) < 1e-6);
});

// --- regression ------------------------------------------------------------

test('constant regression returns the mean', () => {
  const piece = regressPiece([{ x: 0, y: 2 }, { x: 1, y: 4 }, { x: 2, y: 6 }], 'constant', 3, 5, true);
  assert.ok(Math.abs(piece.coeffs[0] - 4) < 1e-12);
});

test('exponential regression recovers y = a·e^(b·x)', () => {
  const pts = [];
  for (let i = 0; i < 50; i++) {
    const x = (i / 49) * 3;
    pts.push({ x, y: 2.5 * Math.exp(0.8 * x) });
  }
  const piece = regressPiece(pts, 'exponential', 3, 5, true);
  assert.ok(Math.abs(piece.coeffs[0] - 2.5) < 1e-6, `a=${piece.coeffs[0]}`);
  assert.ok(Math.abs(piece.coeffs[1] - 0.8) < 1e-6, `b=${piece.coeffs[1]}`);
});

test('logarithmic regression recovers y = a + b·ln(x)', () => {
  const pts = [];
  for (let i = 1; i <= 50; i++) {
    const x = 0.1 * i;
    pts.push({ x, y: 3 + 1.5 * Math.log(x) });
  }
  const piece = regressPiece(pts, 'logarithmic', 3, 5, true);
  assert.ok(Math.abs(piece.coeffs[0] - 3) < 1e-6, `a=${piece.coeffs[0]}`);
  assert.ok(Math.abs(piece.coeffs[1] - 1.5) < 1e-6, `b=${piece.coeffs[1]}`);
});

test('1D Fourier regression recovers a sine fundamental', () => {
  const pts = [];
  const N = 200;
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    pts.push({ x, y: Math.sin(2 * Math.PI * x) });
  }
  const piece = regressPiece(pts, 'fourier', 3, 5, false);
  const b1 = piece.fourierData.fourierTerms.find((t) => t.k === 1).b;
  const a1 = piece.fourierData.fourierTerms.find((t) => t.k === 1).a;
  assert.ok(Math.abs(b1 - 1) < 1e-2, `b1=${b1}`);
  assert.ok(Math.abs(a1) < 1e-2, `a1=${a1}`);
});

test('polynomial regression recovers a cubic', () => {
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const x = (i / 60) * 5 - 2.5;
    pts.push({ x, y: x * x * x - x + 4 });
  }
  const piece = regressPiece(pts, 'polynomial', 3, 5, true);
  assert.ok(Math.abs(piece.coeffs[3] - 1) < 1e-5, `c3=${piece.coeffs[3]}`);
  assert.ok(Math.abs(piece.coeffs[2]) < 1e-5, `c2=${piece.coeffs[2]}`);
  assert.ok(Math.abs(piece.coeffs[1] + 1) < 1e-5, `c1=${piece.coeffs[1]}`);
  assert.ok(Math.abs(piece.coeffs[0] - 4) < 1e-5, `c0=${piece.coeffs[0]}`);
});

test('fitMetrics reports R² ≈ 1 for a perfect fit', () => {
  const pts = [];
  for (let i = 0; i < 20; i++) {
    const x = i / 19;
    pts.push({ x, y: 2 * x + 1 });
  }
  const piece = regressPiece(pts, 'polynomial', 1, 5, true);
  const m = fitMetrics(piece, pts);
  assert.ok(m.r2 > 0.999999, `r2=${m.r2}`);
  assert.ok(m.rmse < 1e-8, `rmse=${m.rmse}`);
});

// --- closed curves / DFT ---------------------------------------------------

test('DFT of a circle recovers its radius in the k=1 coefficient', () => {
  const r = 3;
  const pts = [];
  const N = 400;
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  const coeffs = computeDFT(pts, 4, false);
  const k1 = coeffs.find((c) => c.k === 1);
  // tolerance reflects arc-length resampling over chords (~1e-4 for 400 pts)
  assert.ok(Math.abs(k1.re - r) < 1e-3, `re=${k1.re}`);
  assert.ok(Math.abs(k1.im) < 1e-3, `im=${k1.im}`);
});

test('Lanczos sigma no longer zeroes the top harmonic (H+1 fix)', () => {
  // Signal with content exactly at frequency H=2: z(t) = e^{i·2π·2t}
  const N = 300;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * 2 * i) / N;
    pts.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  const coeffs = computeDFT(pts, 2, true);
  const k2 = coeffs.find((c) => c.k === 2);
  const mag = Math.hypot(k2.re, k2.im);
  assert.ok(mag > 0.2, `top harmonic killed by sigma: mag=${mag}`);
});

test('closed-curve Green area matches π·r²', () => {
  const r = 2;
  const pts = [];
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  const res = computeAnalysis({
    strokes: [pts], model: 'fourier', degree: 3, harmonics: 8, applySigma: true,
    drawingMode: 'single', topologyMode: 'closed', zoom: 40, intMethod: 'trapezoid', intN: 50,
  });
  assert.ok(res.analysis.type === 'closed');
  assert.ok(Math.abs(res.analysis.rawArea - Math.PI * r * r) / (Math.PI * r * r) < 1e-6);
});

// --- closure detection -----------------------------------------------------

test('auto closure detection uses pixel distance', () => {
  const stroke = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0.5 }];
  // endpoints 0.5 math units apart × zoom 40 = 20 px < 40 → closed
  assert.equal(detectClosed('single', 'auto', stroke, 40), true);
  // same stroke, zoom 5 → 2.5 px... wait 0.5*5 = 2.5 < 40 → still closed
  assert.equal(detectClosed('single', 'auto', stroke, 5), true);
  // endpoints 5 units apart × zoom 10 = 50 px ≥ 40 → open
  const far = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
  assert.equal(detectClosed('single', 'auto', far, 10), false);
  assert.equal(detectClosed('single', 'closed', far, 10), true);
  assert.equal(detectClosed('single', 'open', stroke, 40), false);
  assert.equal(detectClosed('piecewise', 'auto', stroke, 40), false);
});

// --- integration -----------------------------------------------------------

function quadAnalysis() {
  const pts = [];
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    pts.push({ x, y: x * x });
  }
  return computeAnalysis({
    strokes: [pts], model: 'polynomial', degree: 2, harmonics: 5, applySigma: true,
    drawingMode: 'single', topologyMode: 'open', zoom: 40, intMethod: 'trapezoid', intN: 1000,
  });
}

test('Simpson integrates x² on [0,1] to exactly 1/3', () => {
  const res = quadAnalysis();
  const v = simpsonIntegrate(res.analysis, 1000);
  assert.ok(Math.abs(v - 1 / 3) < 1e-10, `simpson=${v}`);
});

test('trapezoid integrates x² on [0,1] with O(1/n²) accuracy', () => {
  const res = quadAnalysis();
  const v = riemannIntegrate(res.analysis, 'trapezoid', 1000);
  assert.ok(Math.abs(v - 1 / 3) < 1e-6, `trap=${v}`);
});

test('midpoint integrates x² on [0,1] accurately', () => {
  const res = quadAnalysis();
  const v = riemannIntegrate(res.analysis, 'mid', 1000);
  assert.ok(Math.abs(v - 1 / 3) < 1e-6, `mid=${v}`);
});

test('Lebesgue integration handles flat non-zero functions (bug fix)', () => {
  const pts = [];
  for (let i = 0; i <= 50; i++) pts.push({ x: i / 50, y: 5 });
  const res = computeAnalysis({
    strokes: [pts], model: 'constant', degree: 3, harmonics: 5, applySigma: true,
    drawingMode: 'single', topologyMode: 'open', zoom: 40, intMethod: 'lebesgue', intN: 50,
  });
  const v = lebesgueIntegrate(res.analysis, 50);
  assert.ok(Math.abs(v - 5) < 1e-6, `lebesgue flat=${v}`);
});

test('Lebesgue integration includes the box below yMin (bug fix)', () => {
  const pts = [];
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    pts.push({ x, y: 1 + x }); // yMin=1 > 0
  }
  const res = computeAnalysis({
    strokes: [pts], model: 'polynomial', degree: 1, harmonics: 5, applySigma: true,
    drawingMode: 'single', topologyMode: 'open', zoom: 40, intMethod: 'lebesgue', intN: 200,
  });
  const v = lebesgueIntegrate(res.analysis, 200);
  assert.ok(Math.abs(v - 1.5) < 1e-2, `lebesgue offset=${v}`);
});

test('Lebesgue integration handles negative regions', () => {
  const pts = [];
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    pts.push({ x, y: x - 0.5 }); // signed area = 0
  }
  const res = computeAnalysis({
    strokes: [pts], model: 'polynomial', degree: 1, harmonics: 5, applySigma: true,
    drawingMode: 'single', topologyMode: 'open', zoom: 40, intMethod: 'lebesgue', intN: 200,
  });
  const v = lebesgueIntegrate(res.analysis, 200);
  assert.ok(Math.abs(v) < 1e-3, `lebesgue signed=${v}`);
});

test('exact antiderivative integration matches x² on [0,1]', () => {
  const res = quadAnalysis();
  const exact = integrateExact(res.analysis);
  assert.equal(exact.exact, true);
  assert.ok(Math.abs(exact.value - 1 / 3) < 1e-12, `exact=${exact.value}`);
});

test('exact integration works for exponential and constant pieces', () => {
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const x = i / 60;
    pts.push({ x, y: 2 * Math.exp(0.5 * x) });
  }
  const res = computeAnalysis({
    strokes: [pts], model: 'exponential', degree: 3, harmonics: 5, applySigma: true,
    drawingMode: 'single', topologyMode: 'open', zoom: 40, intMethod: 'trapezoid', intN: 1000,
  });
  const exact = integrateExact(res.analysis);
  // ∫₀¹ 2e^{0.5x} dx = 4(e^{0.5} − 1)
  const want = 4 * (Math.exp(0.5) - 1);
  assert.ok(Math.abs(exact.value - want) < 1e-9, `exact=${exact.value}`);
  assert.ok(Math.abs(res.fittedArea - want) < 1e-4, `trap=${res.fittedArea}`);
});

test('exact Fourier integration matches numeric integration', () => {
  const pts = [];
  const N = 300;
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * 2;
    pts.push({ x, y: Math.sin(2 * Math.PI * x) + 0.5 * Math.cos(4 * Math.PI * x) });
  }
  const res = computeAnalysis({
    strokes: [pts], model: 'fourier', degree: 3, harmonics: 12, applySigma: false,
    drawingMode: 'single', topologyMode: 'open', zoom: 40, intMethod: 'simpson', intN: 1000,
  });
  const exact = integrateExact(res.analysis);
  // ∫₀² sin(2πx) dx = 0 and ∫₀² 0.5·cos(4πx) dx = 0 → total 0 (whole periods)
  // DC leakage from resampling a 2-loop signal keeps ~1e-5 offsets
  assert.ok(Math.abs(exact.value) < 1e-3, `exact fourier=${exact.value}`);
  assert.ok(Math.abs(res.fittedArea) < 1e-3, `numeric fourier=${res.fittedArea}`);
});

test('sampleFunction covers the full domain', () => {
  const res = quadAnalysis();
  const s = sampleFunction(res.analysis, 100);
  assert.equal(s.xs.length, 101);
  assert.ok(Math.abs(s.xs[0]) < 1e-12);
  assert.ok(Math.abs(s.xs[100] - 1) < 1e-12);
});

// --- end-to-end pipeline ---------------------------------------------------

test('piecewise analysis from two strokes produces per-piece metrics', () => {
  const stroke1 = [];
  const stroke2 = [];
  for (let i = 0; i <= 50; i++) {
    const x = i / 50;
    stroke1.push({ x, y: x * x });
    stroke2.push({ x: 1 + x, y: 2 * (1 + x) });
  }
  const res = computeAnalysis({
    strokes: [stroke1, stroke2], model: 'polynomial', degree: 2, harmonics: 5, applySigma: true,
    drawingMode: 'piecewise', topologyMode: 'open', zoom: 40, intMethod: 'trapezoid', intN: 200,
  });
  assert.equal(res.analysis.type, 'piecewise');
  assert.equal(res.analysis.pieces.length, 2);
  assert.equal(res.metrics.length, 2);
  assert.ok(res.metrics.every((m) => m.r2 > 0.999));
});

test('computeAnalysis returns null analysis for too-short strokes', () => {
  const res = computeAnalysis({
    strokes: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]], model: 'polynomial', degree: 3, harmonics: 5,
    applySigma: true, drawingMode: 'single', topologyMode: 'open', zoom: 40, intMethod: 'trapezoid', intN: 50,
  });
  assert.equal(res.analysis, null);
});

test('computeAnalysis never throws on pathological input', () => {
  const res = computeAnalysis({
    strokes: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0.5 }]],
    model: 'fourier', degree: 30, harmonics: 500, applySigma: true,
    drawingMode: 'single', topologyMode: 'auto', zoom: 40, intMethod: 'lebesgue', intN: 1000,
  });
  assert.ok(!res.error, `unexpected error: ${res.error}`);
  assert.ok(res.analysis, 'should still produce an analysis');
});

// --- formatting ------------------------------------------------------------

test('formatPieceLatex renders polynomial with sensible structure', () => {
  const piece = { modelType: 'polynomial', minX: 0, maxX: 1, coeffs: [1, 2, 3] };
  const tex = formatPieceLatex(piece, true);
  assert.match(tex, /x\^\{2\}/);
  assert.match(tex, /0 \\le x \\le 1/);
});

test('formatPieceLatex guards non-finite coefficients', () => {
  const piece = { modelType: 'polynomial', minX: 0, maxX: 1, coeffs: [Infinity, NaN] };
  const tex = formatPieceLatex(piece);
  assert.ok(!tex.includes('undefined'));
  assert.ok(!tex.includes('Infinity'));
});

test('formatParametricLatex produces Desmos-ready tuple', () => {
  const tex = formatParametricLatex([{ k: 0, re: 1, im: 0 }, { k: 1, re: 2, im: 0.5 }]);
  assert.match(tex, /^\\left\(/);
  assert.match(tex, /\\cos/);
  assert.match(tex, /2\\pi t/);
});

test('evaluatePiecewise clamps log-domain gracefully', () => {
  const piece = { modelType: 'logarithmic', minX: 0.1, maxX: 1, coeffs: [1, 2] };
  const analysis = { type: 'piecewise', pieces: [piece], minX: 0.1, maxX: 1 };
  assert.ok(Number.isFinite(evaluatePiecewise(-5, analysis)));
});

