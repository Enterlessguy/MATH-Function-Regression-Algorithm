/**
 * renderer.js: canvas drawing: grid, axes, raw strokes, fitted curves,
 * integral visualisation (Lebesgue strips or Riemann bars), and closed-curve
 * Fourier reconstructions. DPI-aware and driven by the store.
 */
import { evaluatePiecewise } from './math/evaluate.js';
import { sampleFunction } from './math/integrate.js';

export function createRenderer(canvas, getState) {
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let dirty = true;

  const invalidate = () => { dirty = true; };
  document.addEventListener('visibilitychange', invalidate);

  function loop() {
    if (dirty) {
      draw();
      dirty = false;
    }
    raf = requestAnimationFrame(loop);
  }

  function toPixel(mathX, mathY, s) {
    const { w, h } = s.dimensions;
    return {
      x: mathX * s.zoom + w / 2 + s.pan.x,
      y: -mathY * s.zoom + h / 2 + s.pan.y,
    };
  }

  function draw() {
    const s = getState();
    const { w, h } = s.dimensions;
    if (w === 0 || h === 0) return;

    // HiDPI: back the canvas with device pixels, draw in CSS pixels.
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    drawGrid(s);
    if (s.rawStrokes.length > 0 && s.showOriginal) drawRawStrokes(s);
    if (s.analysis) drawAnalysis(s);
  }

  function drawGrid(s) {
    const { w, h } = s.dimensions;
    const idealStep = 80 / s.zoom;
    const order = Math.floor(Math.log10(idealStep));
    let step = Math.pow(10, order);
    const fraction = idealStep / step;
    if (fraction >= 5) step *= 5; else if (fraction >= 2) step *= 2;

    const startX = Math.floor((-w / 2 - s.pan.x) / s.zoom / step) * step;
    const endX = Math.ceil((w / 2 - s.pan.x) / s.zoom / step) * step;
    const startY = Math.floor((-h / 2 - s.pan.y) / s.zoom / step) * step;
    const endY = Math.ceil((h / 2 - s.pan.y) / s.zoom / step) * step;

    ctx.font = '10px monospace';
    ctx.fillStyle = '#64748b';

    for (let x = startX; x <= endX; x += step) {
      if (Math.abs(x) < 1e-9) continue;
      const p = toPixel(x, 0, s);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, h);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(Number(x.toPrecision(4)).toString(), p.x, h / 2 + s.pan.y + 6);
    }
    for (let y = startY; y <= endY; y += step) {
      if (Math.abs(y) < 1e-9) continue;
      const p = toPixel(0, y, s);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, p.y);
      ctx.lineTo(w, p.y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(Number(y.toPrecision(4)).toString(), w / 2 + s.pan.x - 6, p.y);
    }

    // Axes
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2 + s.pan.x, 0);
    ctx.lineTo(w / 2 + s.pan.x, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, h / 2 + s.pan.y);
    ctx.lineTo(w, h / 2 + s.pan.y);
    ctx.stroke();
  }

  function drawRawStrokes(s) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const stroke of s.rawStrokes) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      stroke.forEach((p, i) => {
        const px = toPixel(p.x, p.y, s);
        if (i === 0) ctx.moveTo(px.x, px.y); else ctx.lineTo(px.x, px.y);
      });
      ctx.stroke();
    }
  }

  function drawAnalysis(s) {
    const { analysis } = s;
    ctx.shadowBlur = 12;
    ctx.lineJoin = 'round';

    if (analysis.type === 'piecewise') {
      drawPiecewise(s);
    } else if (analysis.type === 'closed') {
      drawClosed(s);
    }
    ctx.shadowBlur = 0;
  }

  function drawPiecewise(s) {
    const { analysis, intMethod, intN } = s;
    const { minX, maxX, pieces } = analysis;

    if (intMethod === 'lebesgue') {
      // Sample once; draw a horizontal strip per level-slice.
      const sample = sampleFunction(analysis, 4000);
      const { ys, yMin, yMax, dx } = sample;
      const evals = [];
      for (let i = 0; i < ys.length; i++) evals.push({ x: minX + i * dx, y: ys[i] });
      const dy = yMax - yMin < 1e-12 ? 1 : (yMax - yMin) / Math.max(1, intN);

      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
      ctx.lineWidth = 1;

      const strip = (level, sign) => {
        let segStart = null;
        const meets = sign > 0 ? (v) => v >= level : (v) => v <= level;
        for (let i = 0; i < evals.length; i++) {
          const inSet = meets(evals[i].y);
          if (inSet && segStart === null) segStart = evals[i].x;
          else if (!inSet && segStart !== null) {
            fillStrip(segStart, evals[i].x, level, sign, dy);
            segStart = null;
          }
        }
        if (segStart !== null) fillStrip(segStart, maxX, level, sign, dy);
      };

      // The differential slab for a level 	 sits between t and t ± dy on
      // the measure side (above for the positive part, below for negative).
      const fillStrip = (x0, x1, level, sign, height) => {
        const p0 = toPixel(x0, level, s);
        const p1 = toPixel(x1, level, s);
        const width = p1.x - p0.x;
        const slab = sign > 0
          ? { top: toPixel(0, level + height, s).y, bottom: p0.y }
          : { top: p0.y, bottom: toPixel(0, level - height, s).y };
        const hPx = Math.max(1, slab.bottom - slab.top);
        ctx.fillRect(p0.x, slab.top, width, hPx);
        ctx.strokeRect(p0.x, slab.top, width, hPx);
      };

      // Positive levels 0 → yMax, negative levels 0 → yMin.
      for (let lvl = 0; lvl <= yMax; lvl += dy) strip(lvl, 1);
      for (let lvl = 0; lvl >= yMin; lvl -= dy) strip(lvl, -1);
    } else {
      // Riemann-style bars.
      const n = Math.max(1, intN);
      const dx = (maxX - minX) / n;
      ctx.fillStyle = 'rgba(14, 165, 233, 0.15)';
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const xL = minX + i * dx;
        const xR = xL + dx;
        const pL = toPixel(xL, 0, s);
        const pR = toPixel(xR, 0, s);
        let yEval;
        if (intMethod === 'trapezoid') {
          const yL = evaluatePiecewise(xL, analysis);
          const yR = evaluatePiecewise(xR, analysis);
          ctx.moveTo(pL.x, pL.y);
          ctx.lineTo(toPixel(xL, yL, s).x, toPixel(xL, yL, s).y);
          ctx.lineTo(toPixel(xR, yR, s).x, toPixel(xR, yR, s).y);
          ctx.lineTo(pR.x, pR.y);
          continue;
        } else if (intMethod === 'simpson') {
          // Simpson bars use the midpoint for the "roof" of a cubic-ish slice.
          yEval = evaluatePiecewise((xL + xR) / 2, analysis);
        } else if (intMethod === 'left') yEval = evaluatePiecewise(xL, analysis);
        else if (intMethod === 'right') yEval = evaluatePiecewise(xR, analysis);
        else yEval = evaluatePiecewise((xL + xR) / 2, analysis);

        ctx.moveTo(pL.x, pL.y);
        ctx.lineTo(toPixel(xL, yEval, s).x, toPixel(xL, yEval, s).y);
        ctx.lineTo(toPixel(xR, yEval, s).x, toPixel(xR, yEval, s).y);
        ctx.lineTo(pR.x, pR.y);
      }
      ctx.fill();
      ctx.stroke();
    }

    // Fitted curve per piece.
    for (const piece of pieces) {
      ctx.strokeStyle = '#38bdf8';
      ctx.shadowColor = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      let pMinX = piece.minX;
      if (piece.modelType === 'logarithmic') pMinX = Math.max(0.01, pMinX);
      const drawStepX = Math.max(0.001, (piece.maxX - pMinX) / 5000);
      let first = true;
      for (let x = pMinX; x <= piece.maxX; x += drawStepX) {
        const y = evaluatePiecewise(x, { type: 'piecewise', pieces: [piece] });
        const p = toPixel(x, y, s);
        if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  function drawClosed(s) {
    const { analysis } = s;
    const steps = Math.max(1000, analysis.coeffs.length * 20);
    const path = [];
    for (let t = 0; t <= steps; t++) {
      const theta = (2 * Math.PI * t) / steps;
      let sumX = 0, sumY = 0;
      for (const { k, re, im } of analysis.coeffs) {
        const cosT = Math.cos(k * theta);
        const sinT = Math.sin(k * theta);
        sumX += re * cosT - im * sinT;
        sumY += re * sinT + im * cosT;
      }
      path.push(toPixel(sumX, sumY, s));
    }

    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.beginPath();
    path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#34d399';
    ctx.shadowColor = '#34d399';
    ctx.lineWidth = 3;
    ctx.beginPath();
    path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
  }

  loop();
  return {
    invalidate,
    destroy() {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', invalidate);
    },
  };
}

