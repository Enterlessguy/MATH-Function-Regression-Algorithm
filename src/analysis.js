/**
 * analysis.js: the full computation pipeline shared by the web worker and
 * the main-thread fallback, so both paths are guaranteed to agree.
 */
import { regressPiece, computeDFT, fitMetrics } from './math/regression.js';
import { evaluatePiecewise } from './math/evaluate.js';
import { integrateNumeric, integrateExact } from './math/integrate.js';

export const DEFAULT_CLOSE_PIXELS = 40;

/**
 * Decide whether the current drawing should be treated as a closed curve.
 *  - topology 'closed' → always closed
 *  - topology 'open'   → never closed
 *  - topology 'auto'   → closed when the endpoints are within
 *    `closePixels` of each other on screen (uses zoom to convert).
 */
export function detectClosed(drawingMode, topologyMode, stroke, zoom) {
  if (drawingMode !== 'single') return false;
  if (topologyMode === 'closed') return true;
  if (topologyMode === 'open') return false;
  const first = stroke[0];
  const last = stroke[stroke.length - 1];
  const pixelDist = Math.hypot(first.x - last.x, first.y - last.y) * zoom;
  return pixelDist < DEFAULT_CLOSE_PIXELS;
}

/**
 * Compute everything the UI needs from the current strokes + settings.
 * Returns { analysis, fittedArea, exactArea, metrics }.
 * Never throws; returns an `error` field instead so callers can show it.
 */
export function computeAnalysis({
  strokes, model, degree, harmonics, applySigma,
  drawingMode, topologyMode, zoom, intMethod, intN,
}) {
  const validStrokes = (strokes || []).filter((s) => s && s.length > 5);
  if (validStrokes.length === 0) {
    return { analysis: null, fittedArea: 0, exactArea: null, metrics: [] };
  }

  try {
    const firstStroke = validStrokes[0];
    const isClosed = detectClosed(drawingMode, topologyMode, firstStroke, zoom);

    if (isClosed) {
      const closedPts = [...firstStroke, firstStroke[0]];
      let area = 0;
      for (let i = 0; i < closedPts.length - 1; i++) {
        area += closedPts[i].x * closedPts[i + 1].y
              - closedPts[i + 1].x * closedPts[i].y;
      }
      const coeffs = computeDFT(firstStroke, harmonics, applySigma);
      return {
        analysis: {
          type: 'closed',
          points: closedPts,
          rawArea: Math.abs(area) / 2,
          coeffs,
        },
        fittedArea: 0,
        exactArea: null,
        metrics: [],
      };
    }

    // Open / piecewise path.
    const pieces = validStrokes.map((stroke) =>
      regressPiece(stroke, model, degree, harmonics, applySigma));
    let minX = Infinity, maxX = -Infinity;
    for (const p of pieces) {
      if (p.minX < minX) minX = p.minX;
      if (p.maxX > maxX) maxX = p.maxX;
    }
    const analysis = { type: 'piecewise', pieces, minX, maxX };

    const fittedArea = maxX > minX ? integrateNumeric(analysis, intMethod, intN) : 0;
    const exact = integrateExact(analysis);
    const metrics = pieces.map((p, i) => ({ ...fitMetrics(p, validStrokes[i]) }));

    return { analysis, fittedArea, exactArea: exact.exact ? exact.value : null, metrics };
  } catch (err) {
    return { analysis: null, fittedArea: 0, exactArea: null, metrics: [], error: String(err && err.message || err) };
  }
}

export { evaluatePiecewise };
