/**
 * main.js: application bootstrap: store, canvas interactions, worker
 * orchestration (with main-thread fallback), and UI mounting.
 */
import { createStore } from './state.js';
import { mountUI } from './ui.js';
import { createRenderer } from './renderer.js';
import { computeAnalysis } from './analysis.js';

const store = createStore({
  drawingMode: 'single',
  topologyMode: 'auto',
  model: 'polynomial',
  polyDegree: 3,
  harmonics: 5,
  applySigma: true,
  showOriginal: true,
  zoom: 40,
  pan: { x: 0, y: 0 },
  intMethod: 'lebesgue',
  intN: 50,
  showUI: true,
  dimensions: { w: 800, h: 600 },
  rawStrokes: [],
  isDrawing: false,
  isPanning: false,
  analysis: null,
  isComputing: false,
  fittedArea: 0,
  exactArea: null,
  metrics: [],
  computeError: null,
});

// --- Toast ------------------------------------------------------------------

let toastTimer = null;
function toast(message, kind = 'ok') {
  const root = document.getElementById('toasts');
  if (!root) return;
  const colors = {
    ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    err: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  };
  const node = document.createElement('div');
  node.className = `px-3 py-1.5 rounded border text-[11px] font-bold uppercase tracking-widest shadow-lg ${colors[kind] || colors.ok} transition-opacity duration-300`;
  node.textContent = message;
  root.append(node);
  requestAnimationFrame(() => { node.style.opacity = '1'; });
  setTimeout(() => {
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 300);
  }, 2200);
}

// --- Worker (with graceful main-thread fallback) ----------------------------

let worker = null;
let workerFailed = false;

function createWorker() {
  try {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onerror = (e) => {
      workerFailed = true;
      store.setState({ isComputing: false });
      toast('Worker failed, falling back to main thread', 'warn');
      try { w.terminate(); } catch { /* noop */ }
      worker = null;
    };
    return w;
  } catch {
    workerFailed = true;
    return null;
  }
}

// --- Computation pipeline ---------------------------------------------------

let computeTimer = null;
let jobId = 0;
const COMPUTE_DEBOUNCE_MS = 120;

function scheduleCompute() {
  clearTimeout(computeTimer);
  computeTimer = setTimeout(runCompute, COMPUTE_DEBOUNCE_MS);
}

function runCompute() {
  const s = store.getState();
  const validStrokes = s.rawStrokes.filter((st) => st && st.length > 5);
  if (validStrokes.length === 0) {
    store.setState({ analysis: null, fittedArea: 0, exactArea: null, metrics: [], isComputing: false });
    return;
  }
  store.setState({ isComputing: true });

  const params = {
    strokes: validStrokes,
    model: s.model,
    degree: s.polyDegree,
    harmonics: s.harmonics,
    applySigma: s.applySigma,
    drawingMode: s.drawingMode,
    topologyMode: s.topologyMode,
    zoom: s.zoom,
    intMethod: s.intMethod,
    intN: s.intN,
  };

  const myJob = ++jobId;
  const apply = (result) => {
    if (myJob !== jobId) return; // stale result; a newer job already ran
    if (result.error) {
      store.setState({ isComputing: false, computeError: result.error });
      toast(`Compute error: ${result.error}`, 'err');
      return;
    }
    store.setState({
      analysis: result.analysis,
      fittedArea: result.fittedArea,
      exactArea: result.exactArea,
      metrics: result.metrics || [],
      isComputing: false,
    });
  };

  if (!worker && !workerFailed) worker = createWorker();

  if (worker) {
    worker.onmessage = (e) => apply(e.data);
    worker.postMessage({ id: myJob, ...params });
  } else {
    // Fallback: run synchronously on the main thread (file:// or old browsers).
    setTimeout(() => apply(computeAnalysis(params)), 0);
  }
}

// --- Canvas interaction -----------------------------------------------------

function wireCanvas(canvasEl, containerEl) {
  const rect = () => canvasEl.getBoundingClientRect();
  const toMath = (clientX, clientY) => {
    const s = store.getState();
    const r = rect();
    const { w, h } = s.dimensions;
    const px = clientX - r.left;
    const py = clientY - r.top;
    return {
      x: (px - w / 2 - s.pan.x) / s.zoom,
      y: -(py - h / 2 - s.pan.y) / s.zoom,
    };
  };

  canvasEl.addEventListener('pointerdown', (e) => {
    canvasEl.setPointerCapture?.(e.pointerId);
    if (e.button === 2) {
      store.setState({ isPanning: true });
      return;
    }
    const pt = toMath(e.clientX, e.clientY);
    store.setState((s) => {
      const rawStrokes = s.drawingMode === 'single' ? [[pt]] : [...s.rawStrokes, [pt]];
      return { rawStrokes, isDrawing: true };
    });
  });

  canvasEl.addEventListener('pointermove', (e) => {
    const s = store.getState();
    if (s.isPanning) {
      store.setState((st) => ({ pan: { x: st.pan.x + e.movementX, y: st.pan.y + e.movementY } }));
      return;
    }
    if (!s.isDrawing) return;
    const pt = toMath(e.clientX, e.clientY);
    store.setState((st) => {
      const copy = [...st.rawStrokes];
      const stroke = copy[copy.length - 1];
      if (!stroke) return null;
      const last = stroke[stroke.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) > 0.1) {
        stroke.push(pt);
        return { rawStrokes: copy };
      }
      return null;
    });
  });

  const endStroke = (e) => {
    if (e.button === 2) store.setState({ isPanning: false });
    store.setState({ isDrawing: false });
  };
  canvasEl.addEventListener('pointerup', endStroke);
  canvasEl.addEventListener('pointercancel', endStroke);
  canvasEl.addEventListener('pointerleave', endStroke);
  canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());

  // Zoom toward the cursor, keeping the math point under it fixed.
  canvasEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = rect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    store.setState((s) => {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const zoom = Math.min(1000, Math.max(5, s.zoom * factor));
      const mathX = (mx - s.dimensions.w / 2 - s.pan.x) / s.zoom;
      const mathY = -(my - s.dimensions.h / 2 - s.pan.y) / s.zoom;
      return {
        zoom,
        pan: {
          x: mx - s.dimensions.w / 2 - mathX * zoom,
          y: my - s.dimensions.h / 2 + mathY * zoom,
        },
      };
    });
  }, { passive: false });

  // Track canvas size.
  const observer = new ResizeObserver((entries) => {
    const rect2 = entries[0].contentRect;
    store.setState((s) => {
      const w = Math.floor(rect2.width);
      const h = Math.floor(rect2.height);
      return (s.dimensions.w === w && s.dimensions.h === h) ? null : { dimensions: { w, h } };
    });
  });
  observer.observe(containerEl);
}

// --- Recompute triggers -----------------------------------------------------

// Recompute (debounced) whenever input settings or strokes change.
// A signature guard prevents result-setState from re-triggering work.
let lastComputeSig = null;
store.subscribe((s) => {
  if (s.isDrawing) return; // compute on stroke end only
  const sig = JSON.stringify([
    s.rawStrokes, s.model, s.polyDegree, s.harmonics, s.applySigma,
    s.topologyMode, s.zoom, s.intMethod, s.intN, s.drawingMode,
  ]);
  if (sig !== lastComputeSig) {
    lastComputeSig = sig;
    scheduleCompute();
  }
});

// --- Boot -------------------------------------------------------------------

function boot() {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Missing root element');

  mountUI(rootEl, store, { toast });
  const canvasEl = document.querySelector('[data-canvas]');
  const containerEl = document.querySelector('.canvas-section');
  if (!canvasEl || !containerEl) throw new Error('Missing canvas mount points');
  const renderer = createRenderer(canvasEl, () => store.getState());
  wireCanvas(canvasEl, containerEl);
  store.subscribe(() => renderer.invalidate());

  // Cleanup on unload.
  window.addEventListener('beforeunload', () => {
    renderer.destroy();
    worker?.terminate();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}


