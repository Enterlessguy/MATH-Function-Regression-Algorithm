/**
 * ui.js: builds the static chrome (header, canvas overlay, sidebar) and
 * keeps every dynamic bit in sync with the store. Vanilla DOM, no framework.
 */
import { formatPieceLatex, formatParametricLatex, describeModel } from './math/format.js';

// --- tiny DOM helpers -------------------------------------------------------

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'checked' || k === 'disabled') {
      if (v) node.setAttribute(k, '');
    } else {
      node.setAttribute(k, v);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const ICONS = {
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  reset: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  check: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  func: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3"/><path d="M9 11.2h5.7"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  crosshair: '<circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>',
  pen: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
};

function icon(name, size = 14, className = '') {
  return el('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    class: className,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    html: ICONS[name] || '',
  });
}

const iconEl = (name, size = 14, className = '') => icon(name, size, className);

// --- latex rendering --------------------------------------------------------

function renderLatex(rootEl) {
  if (!window.katex) return;
  rootEl.querySelectorAll('.latex').forEach((node) => {
    try {
      window.katex.render(node.getAttribute('data-tex') || '', node, { throwOnError: false, displayMode: false });
    } catch { /* KaTeX already renders on error when throwOnError:false */ }
  });
}

// --- main entry -------------------------------------------------------------

export function mountUI(rootEl, store, { toast }) {
  const s = store.getState();

  // Static chrome -----------------------------------------------------------
  rootEl.append(
    el('div', {
      class: 'min-h-screen lg:h-screen bg-slate-950 text-slate-200 font-mono flex flex-col selection:bg-emerald-500/30 overflow-auto lg:overflow-hidden',
    }, [
      el('header', {
        class: 'border-b border-slate-800 bg-slate-900/80 p-3 flex items-center justify-between shadow-xl relative z-20 backdrop-blur-md shrink-0',
      }, [
        el('div', { class: 'flex items-center gap-3' }, [
          el('div', { class: 'p-2 bg-slate-800 border border-slate-700 text-emerald-400 rounded-lg shadow-lg' }, [iconEl('shield', 20)]),
          el('div', {}, [
            el('h1', { class: 'text-lg font-bold bg-gradient-to-r from-emerald-400 to-sky-400 bg-clip-text text-transparent uppercase tracking-wider' }, 'Topographic Core'),
            el('p', { class: 'text-[10px] text-slate-500 tracking-widest uppercase mt-0.5' }, 'Measure Theory & Advanced Regression'),
          ]),
        ]),
        el('div', { class: 'flex gap-2' }, [
          el('button', {
            class: 'header-ui flex items-center gap-2 px-3 py-1.5 rounded border transition-all uppercase text-[10px] tracking-wider font-bold cursor-pointer',
            onclick: () => store.setState({ showUI: !store.getState().showUI }),
          }, [iconEl('eyeOff', 14), el('span', { class: 'label' }, 'Hide Controls')]),
          el('button', {
            class: 'header-orig flex items-center gap-2 px-3 py-1.5 rounded border transition-all uppercase text-[10px] tracking-wider font-bold cursor-pointer',
            onclick: () => store.setState({ showOriginal: !store.getState().showOriginal }),
          }, [iconEl('check', 14), el('span', { class: 'label' }, 'Raw Vector Data')]),
          el('button', {
            class: 'flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded border border-rose-500/30 transition-all uppercase text-[10px] tracking-wider font-bold cursor-pointer',
            onclick: () => store.setState({ rawStrokes: [], analysis: null, metrics: [], exactArea: null, fittedArea: 0 }),
          }, [iconEl('reset', 14), el('span', {}, 'Purge Buffer')]),
        ]),
      ]),

      el('main', { class: 'flex-1 flex flex-col lg:flex-row min-h-0' }, [
        // Canvas ------------------------------------------------------------
        el('section', {
          class: 'canvas-section h-[60vh] min-h-[450px] lg:h-auto lg:flex-1 relative border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-950 cursor-crosshair overflow-hidden touch-none shrink-0',
        }, [
          el('div', { class: 'absolute top-4 left-4 z-10 pointer-events-none opacity-60' }, [
            el('div', { class: 'flex items-center gap-2 text-sky-500 text-xs tracking-widest mb-1 font-bold drop-shadow-md' }, [iconEl('crosshair', 12), el('span', { class: 'uppercase' }, 'Optics Live')]),
            el('div', { class: 'viewport-info text-[10px] text-slate-400 font-medium' }),
            el('div', { class: 'engine-status text-[10px] text-emerald-400 font-medium' }),
          ]),
          el('div', { class: 'absolute top-4 right-4 z-10 flex gap-1 bg-slate-900/80 p-1.5 rounded-lg border border-slate-700/50 backdrop-blur-md shadow-lg' }, [
            el('button', { class: 'zoom-out p-1 hover:bg-slate-800 text-slate-400 hover:text-sky-400 rounded transition-colors cursor-pointer', title: 'Zoom out' }, [iconEl('zoomOut', 16)]),
            el('button', { class: 'zoom-reset px-2 text-[10px] font-bold text-slate-400 hover:text-emerald-400 font-mono flex items-center transition-colors cursor-pointer' }, [iconEl('maximize', 14)]),
            el('button', { class: 'zoom-in p-1 hover:bg-slate-800 text-slate-400 hover:text-sky-400 rounded transition-colors cursor-pointer', title: 'Zoom in' }, [iconEl('zoomIn', 16)]),
          ]),
          el('canvas', {
            class: 'absolute inset-0 touch-none',
            'data-canvas': '',
          }),
          el('div', { class: 'empty-hint absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-slate-600' }, [
            iconEl('pen', 32, 'mb-4 opacity-50 text-sky-500'),
            el('p', { class: 'uppercase tracking-widest text-xs text-slate-400 font-bold' }, 'Draw a function to initialize core'),
          ]),
        ]),

        // Sidebar ------------------------------------------------------------
        el('aside', {
          class: 'controls-panel transition-all duration-300 ease-in-out border-slate-800 bg-slate-900 overflow-y-auto overflow-x-hidden',
        }, [
          el('div', { class: 'p-5 space-y-8' }, [
            el('div', { class: 'space-y-6' }, [
              el('h2', { class: 'text-xs uppercase tracking-widest text-slate-400 font-bold flex items-center gap-2' }, [iconEl('settings', 14, 'text-sky-400'), 'Engine Configuration']),

              // Stroke behavior --------------------------------------------
              el('div', { class: 'space-y-4 pb-4 border-b border-slate-800/50' }, [
                el('div', { class: 'space-y-2' }, [
                  el('label', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-2' }, [iconEl('edit', 12), 'Stroke Behavior']),
                  el('div', { class: 'flex bg-slate-950 border border-slate-700 rounded-lg p-1 gap-1' }, [
                    el('button', { class: 'mode-single flex-1 text-[10px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer' }, 'Continuous'),
                    el('button', { class: 'mode-piecewise flex-1 text-[10px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer' }, 'Multi-Stroke (Piecewise)'),
                  ]),
                ]),
                el('div', { class: 'topology-wrap space-y-2' }, [
                  el('label', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-2' }, [iconEl('crosshair', 12), 'Topology Detection']),
                  el('div', { class: 'flex bg-slate-950 border border-slate-700 rounded-lg p-1 gap-1' }, [
                    el('button', { class: 'topo-auto flex-1 text-[10px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer' }, 'Auto-Detect'),
                    el('button', { class: 'topo-open flex-1 text-[10px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer' }, 'Force Open'),
                    el('button', { class: 'topo-closed flex-1 text-[10px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer' }, 'Force Closed'),
                  ]),
                ]),
              ]),

              // Model selection ---------------------------------------------
              el('div', { class: 'model-wrap space-y-4' }, [
                el('div', { class: 'space-y-2' }, [
                  el('label', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-2' }, [iconEl('func', 12), 'Math Target Model']),
                  el('select', { class: 'model-select w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-sky-400 focus:outline-none focus:border-sky-500 font-bold tracking-wide' }, [
                    el('option', { value: 'polynomial' }, 'Polynomial'),
                    el('option', { value: 'fourier' }, 'Fourier (1D Trigonometric)'),
                    el('option', { value: 'exponential' }, 'Exponential'),
                    el('option', { value: 'logarithmic' }, 'Logarithmic'),
                    el('option', { value: 'constant' }, 'Constant'),
                  ]),
                ]),

                // Polynomial degree ----------------------------------------
                el('div', { class: 'poly-wrap space-y-3 transition-all overflow-hidden' }, [
                  el('div', { class: 'flex justify-between items-center' }, [
                    el('label', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold' }, 'Polynomial Degree'),
                    el('span', { class: 'poly-val font-mono text-sky-400 text-xs bg-sky-500/10 px-1.5 py-0.5 rounded' }),
                  ]),
                  el('input', { type: 'range', min: '1', max: '30', value: '3', class: 'poly-slider w-full accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer' }),
                ]),

                // Fourier harmonics ----------------------------------------
                el('div', { class: 'fourier-wrap space-y-3 transition-all overflow-hidden' }, [
                  el('div', { class: 'flex justify-between items-center' }, [
                    el('label', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold' }, 'Fourier Harmonics'),
                    el('span', { class: 'fourier-val font-mono text-emerald-400 text-xs bg-emerald-500/10 px-1.5 py-0.5 rounded' }),
                  ]),
                  el('input', { type: 'range', min: '1', max: '500', value: '5', class: 'fourier-slider w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer' }),
                  el('label', { class: 'flex items-center gap-2 cursor-pointer mt-3 group' }, [
                    el('input', { type: 'checkbox', class: 'sigma-check w-3 h-3 accent-emerald-500 bg-slate-900 border-slate-700 rounded cursor-pointer' }),
                    el('span', { class: 'text-[9px] uppercase tracking-wider text-slate-500 group-hover:text-slate-300 transition-colors font-bold' }, 'Lanczos Anti-Gibbs Sigma'),
                  ]),
                ]),

                // Integration engine ----------------------------------------
                el('div', { class: 'int-wrap space-y-4 pt-5 border-t border-slate-800/50' }, [
                  el('label', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-2' }, [iconEl('layers', 12, 'text-emerald-400'), 'Integration Engine']),
                  el('div', { class: 'grid grid-cols-6 bg-slate-950 border border-slate-700 rounded-lg p-1 gap-1' }, [
                    ...['lebesgue', 'simpson', 'trapezoid', 'left', 'mid', 'right'].map((m) =>
                      el('button', { class: `int-${m} text-[8px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer` }, m)),
                  ]),
                  el('div', { class: 'space-y-3' }, [
                    el('div', { class: 'flex justify-between items-center' }, [
                      el('label', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold' }, 'Resolution (N Slices)'),
                      el('span', { class: 'intn-val font-mono text-emerald-400 text-xs bg-emerald-500/10 px-1.5 py-0.5 rounded' }),
                    ]),
                    el('input', { type: 'range', min: '10', max: '1000', step: '10', value: '50', class: 'intn-slider w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer' }),
                  ]),
                ]),
              ]),
            ]),

            // Approximation data --------------------------------------------
            el('div', { class: 'pt-8 border-t border-slate-800' }, [
              el('h2', { class: 'text-xs uppercase tracking-widest text-slate-400 font-bold flex items-center gap-2 mb-4' }, [iconEl('activity', 14, 'text-sky-400'), 'Approximation Data']),
              el('div', { class: 'analysis-area space-y-5' }),
            ]),
          ]),
        ]),
      ]),
    ]),
  );

  // Wire static controls -----------------------------------------------------
  const q = (sel) => rootEl.querySelector(sel);
  let lastAnalysisSig = null;
  const aside = q('.controls-panel');
  const emptyHint = q('.empty-hint');
  const viewportInfo = q('.viewport-info');
  const engineStatus = q('.engine-status');

  q('.mode-single').addEventListener('click', () => store.setState({ drawingMode: 'single' }));
  q('.mode-piecewise').addEventListener('click', () => store.setState({ drawingMode: 'piecewise', topologyMode: 'open' }));
  q('.topo-auto').addEventListener('click', () => store.setState({ topologyMode: 'auto' }));
  q('.topo-open').addEventListener('click', () => store.setState({ topologyMode: 'open' }));
  q('.topo-closed').addEventListener('click', () => store.setState({ topologyMode: 'closed' }));
  q('.model-select').addEventListener('change', (e) => store.setState({ model: e.target.value }));
  q('.poly-slider').addEventListener('input', (e) => store.setState({ polyDegree: Number(e.target.value) }));
  q('.fourier-slider').addEventListener('input', (e) => store.setState({ harmonics: Number(e.target.value) }));
  q('.sigma-check').addEventListener('change', (e) => store.setState({ applySigma: e.target.checked }));
  q('.intn-slider').addEventListener('input', (e) => store.setState({ intN: Number(e.target.value) }));
  for (const m of ['lebesgue', 'simpson', 'trapezoid', 'left', 'mid', 'right']) {
    q(`.int-${m}`).addEventListener('click', () => store.setState({ intMethod: m }));
  }
  q('.zoom-in').addEventListener('click', () => store.setState((st) => ({ zoom: Math.min(st.zoom * 1.2, 1000) })));
  q('.zoom-out').addEventListener('click', () => store.setState((st) => ({ zoom: Math.max(st.zoom / 1.2, 5) })));
  q('.zoom-reset').addEventListener('click', () => store.setState({ zoom: 40 }));

  // Live updates -------------------------------------------------------------
  const active = 'bg-sky-500/20 text-sky-400';
  const activeGreen = 'bg-emerald-500/20 text-emerald-400';
  const idle = 'text-slate-500 hover:text-slate-300';

  // Capture stable references ONCE. The subscriber mutates classNames, so
  // re-querying by class after the first update would find nothing.
  const R = {
    uiBtn: q('.header-ui'),
    origBtn: q('.header-orig'),
    aside,
    modeSingle: q('.mode-single'),
    modePiecewise: q('.mode-piecewise'),
    topoWrap: q('.topology-wrap'),
    topoAuto: q('.topo-auto'),
    topoOpen: q('.topo-open'),
    topoClosed: q('.topo-closed'),
    modelSelect: q('.model-select'),
    polyWrap: q('.poly-wrap'),
    polyVal: q('.poly-val'),
    polySlider: q('.poly-slider'),
    fourierWrap: q('.fourier-wrap'),
    fourierVal: q('.fourier-val'),
    fourierSlider: q('.fourier-slider'),
    sigmaCheck: q('.sigma-check'),
    intBtns: Object.fromEntries(
      ['lebesgue', 'simpson', 'trapezoid', 'left', 'mid', 'right'].map((m) => [m, q(`.int-${m}`)]),
    ),
    intnVal: q('.intn-val'),
    intnSlider: q('.intn-slider'),
    zoomReset: q('.zoom-reset'),
    analysisArea: q('.analysis-area'),
  };

  store.subscribe((state) => {
    // Header buttons
    R.uiBtn.className = `header-ui flex items-center gap-2 px-3 py-1.5 rounded border transition-all uppercase text-[10px] tracking-wider font-bold cursor-pointer ${state.showUI ? 'bg-slate-800 border-slate-600 text-emerald-400' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'}`;
    R.uiBtn.querySelector('svg')?.remove();
    R.uiBtn.prepend(iconEl(state.showUI ? 'eyeOff' : 'eye', 14));
    R.uiBtn.querySelector('.label').textContent = state.showUI ? 'Hide Controls' : 'Show Controls';
    R.origBtn.className = `header-orig flex items-center gap-2 px-3 py-1.5 rounded border transition-all uppercase text-[10px] tracking-wider font-bold cursor-pointer ${state.showOriginal ? 'bg-slate-800 border-slate-600 text-sky-400' : 'bg-slate-900 border-slate-800 text-slate-500'}`;

    // Sidebar visibility
    R.aside.className = `controls-panel transition-all duration-300 ease-in-out border-slate-800 bg-slate-900 overflow-y-auto overflow-x-hidden ${state.showUI ? 'w-full lg:w-[420px] opacity-100' : 'w-0 opacity-0 border-0'}`;

    // Stroke/topology buttons
    R.modeSingle.className = `flex-1 text-[10px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer ${state.drawingMode === 'single' ? active : idle}`;
    R.modePiecewise.className = `flex-1 text-[10px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer ${state.drawingMode === 'piecewise' ? 'bg-emerald-500/20 text-emerald-400' : idle}`;
    R.topoWrap.style.display = state.drawingMode === 'single' ? '' : 'none';
    R.topoAuto.className = `flex-1 text-[10px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer ${state.topologyMode === 'auto' ? active : idle}`;
    R.topoOpen.className = `flex-1 text-[10px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer ${state.topologyMode === 'open' ? active : idle}`;
    R.topoClosed.className = `flex-1 text-[10px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer ${state.topologyMode === 'closed' ? active : idle}`;

    // Model controls
    R.modelSelect.value = state.model;
    const isClosed = state.analysis ? state.analysis.type === 'closed' : state.topologyMode === 'closed';
    const fourierRelevant = isClosed || state.model === 'fourier';

    R.polyWrap.className = `poly-wrap space-y-3 transition-all overflow-hidden ${state.model === 'polynomial' ? 'h-auto opacity-100 mt-4' : 'h-0 opacity-0 m-0'}`;
    R.polyVal.textContent = String(state.polyDegree);
    R.polySlider.value = String(state.polyDegree);

    R.fourierWrap.className = `fourier-wrap space-y-3 transition-all overflow-hidden ${fourierRelevant ? 'h-auto opacity-100 pt-5 border-t border-slate-800/50' : 'h-0 opacity-0 m-0 border-0 pt-0'}`;
    R.fourierVal.textContent = String(state.harmonics);
    R.fourierSlider.value = String(state.harmonics);
    R.sigmaCheck.checked = state.applySigma;

    // Integration buttons
    for (const m of ['lebesgue', 'simpson', 'trapezoid', 'left', 'mid', 'right']) {
      const btn = R.intBtns[m];
      const isActive = state.intMethod === m;
      const color = m === 'lebesgue' ? activeGreen : active;
      btn.className = `text-[8px] uppercase tracking-wider font-bold py-1.5 rounded transition-colors cursor-pointer ${isActive ? color : idle}`;
    }
    R.intnVal.textContent = String(state.intN);
    R.intnSlider.value = String(state.intN);

    // Canvas overlay
    viewportInfo.textContent = `Viewport: ${state.dimensions.w}?${state.dimensions.h} px`;
    engineStatus.textContent = `Engine: ${state.isDrawing ? 'CAPTURING VECTORS...' : state.isComputing ? 'COMPUTING...' : 'IDLE'}`;
    R.zoomReset.innerHTML = '';
    R.zoomReset.append(iconEl('maximize', 14, 'mr-1'), ` ${Math.round(state.zoom)}x`);
    emptyHint.style.display = state.rawStrokes.length ? 'none' : '';

    // Analysis panel (only rebuild when its inputs actually change)
    const sig = JSON.stringify([
      state.analysis, state.isComputing, state.fittedArea,
      state.exactArea, state.metrics, state.intMethod, state.intN,
    ]);
    if (sig !== lastAnalysisSig) {
      lastAnalysisSig = sig;
      renderAnalysis(R.analysisArea, state, { toast });
    }
  });
}
function renderAnalysis(container, state, { toast }) {
  const { analysis, isComputing } = state;

  if (!analysis) {
    container.innerHTML = '';
    container.append(
      el('div', { class: 'h-40 flex items-center justify-center border border-dashed border-slate-800 rounded-lg bg-slate-950/50' }, [
        el('p', { class: 'text-[10px] text-slate-600 uppercase tracking-widest text-center px-8 font-bold leading-relaxed' }, 'Awaiting vectors.'),
      ]),
    );
    return;
  }

  const computingBadge = isComputing
    ? el('span', { class: 'text-emerald-400 animate-pulse text-[8px] border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 rounded' }, 'COMPUTING...')
    : null;

  const modelCard = el('div', { class: 'bg-slate-950 p-4 rounded-lg border border-slate-800 relative overflow-hidden group' }, [
    el('div', { class: 'absolute -right-4 -top-4 opacity-5' }, [iconEl('cpu', 80)]),
    el('div', { class: 'text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3 flex items-center justify-between relative z-10' }, [
      el('span', { class: 'flex items-center gap-2' }, [iconEl('cpu', 12, 'text-rose-400'), 'Math Model']),
      computingBadge,
    ]),
    ...(analysis.type === 'piecewise' ? renderPieces(analysis, state, { toast }) : renderClosed(analysis, { toast })),
  ]);

  const areaCard = renderAreaCard(analysis, state);

  container.innerHTML = '';
  container.append(modelCard, areaCard);
  renderLatex(container);
}

function renderPieces(analysis, state, { toast }) {
  const wrap = el('div', { class: 'bg-slate-900 p-4 rounded border border-slate-800/50 text-sky-300 text-xs shadow-inner flex flex-col gap-4 relative z-10' }, [
    el('div', { class: 'text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1 border-b border-slate-800 pb-2' }, 'Piecewise System f(x)'),
  ]);

  analysis.pieces.forEach((piece, idx) => {
    const metrics = state.metrics && state.metrics[idx];
    const r2 = metrics ? metrics.r2 : null;
    const card = el('div', { class: 'group relative bg-slate-950/30 p-2 rounded-lg border border-transparent hover:border-slate-700/50 transition-all' }, [
      el('div', { class: 'flex justify-between items-center mb-2' }, [
        el('span', { class: 'text-[9px] text-slate-500 font-sans font-bold uppercase tracking-tighter' },
          `Segment ${idx + 1} | ${describeModel(piece.modelType)} | x ∈ [${Number(piece.minX.toFixed(2))}, ${Number(piece.maxX.toFixed(2))}]`),
        el('div', { class: 'flex gap-1' }, [
          ...(r2 != null ? [el('span', {
            class: 'r2-badge text-[9px] px-1.5 py-0.5 rounded border font-bold',
          }, `R² ${Number(r2.toFixed(4))}`)] : []),
          el('button', {
            class: 'p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-emerald-400 transition-colors cursor-pointer',
            title: 'Copy LaTeX',
            onclick: () => copyText(formatPieceLatex(piece, true), toast),
          }, [iconEl('copy', 12)]),
        ]),
      ]),
      el('div', { class: 'overflow-x-auto pb-2 scrollbar-hide' }, [
        el('span', { class: 'latex text-sm whitespace-nowrap', 'data-tex': formatPieceLatex(piece) }),
      ]),
    ]);
    if (r2 != null) {
      const badge = card.querySelector('.r2-badge');
      if (badge) badge.className = badge.className + ` ${r2 > 0.95 ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : r2 > 0.7 ? 'text-sky-400 border-sky-500/30 bg-sky-500/10' : 'text-amber-400 border-amber-500/30 bg-amber-500/10'}`;
    }
    wrap.append(card);
  });
  return [wrap];
}

function renderClosed(analysis, { toast }) {
  const wrap = el('div', { class: 'group bg-slate-900 p-4 rounded border border-slate-800/50 text-emerald-300 shadow-inner relative z-10 space-y-3' }, [
    el('div', { class: 'flex justify-between items-center border-b border-slate-800 pb-2 mb-1' }, [
      el('div', { class: 'text-[10px] text-slate-500 uppercase font-bold tracking-widest' }, 'Parametric Reconstruction'),
      el('button', {
        class: 'p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-emerald-400 transition-colors cursor-pointer',
        title: 'Copy Parametric Curve for Desmos',
        onclick: () => copyText(formatParametricLatex(analysis.coeffs), toast),
      }, [iconEl('copy', 12)]),
    ]),
    el('div', { class: 'flex flex-col gap-2' }, [
      el('div', { class: 'flex items-center gap-3' }, [
        el('span', { class: 'text-xs text-slate-500 font-bold w-8' }, 'X(t) ≈'),
        el('span', { class: 'latex text-emerald-400', 'data-tex': '\\sum [a_k\\cos(kt) - b_k\\sin(kt)]' }),
      ]),
      el('div', { class: 'flex items-center gap-3' }, [
        el('span', { class: 'text-xs text-slate-500 font-bold w-8' }, 'Y(t) ≈'),
        el('span', { class: 'latex text-emerald-400', 'data-tex': '\\sum [a_k\\sin(kt) + b_k\\cos(kt)]' }),
      ]),
    ]),
    el('div', { class: 'text-[9px] text-slate-500 uppercase tracking-widest mt-2' }, [
      '* Copy and paste into Desmos as ',
      el('span', { class: 'font-mono text-sky-400' }, '(X(t), Y(t))'),
    ]),
  ]);
  return [wrap];
}

function renderAreaCard(analysis, state) {
  const isClosed = analysis.type === 'closed';
  const title = isClosed
    ? 'Enclosed Area (Green\'s Theorem)'
    : `${state.intMethod.toUpperCase()} AREA (N=${state.intN})`;

  const card = el('div', { class: 'bg-slate-950 p-4 rounded-lg border border-slate-800 relative overflow-hidden' }, [
    el('div', { class: 'absolute -right-4 -top-4 opacity-5' }, [iconEl('hash', 80)]),
    el('div', { class: 'text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 relative z-10' }, title),
    el('div', { class: 'text-2xl text-slate-200 font-light flex items-end gap-2 relative z-10' }, [
      String((isClosed ? analysis.rawArea : state.fittedArea).toFixed(4)),
      el('span', { class: 'text-xs text-sky-500 font-bold mb-1 uppercase tracking-widest' }, 'units²'),
    ]),
    el('div', { class: 'bg-slate-900 mt-3 p-3 rounded border border-slate-800/50 flex justify-center text-slate-300 shadow-inner relative z-10' }, [
      el('div', { class: 'flex items-center py-2' }, [
        el('span', {
          class: 'latex text-xl text-emerald-400',
          'data-tex': isClosed
            ? 'A = \\frac{1}{2} \\oint_C (x\\,dy - y\\,dx)'
            : state.intMethod === 'lebesgue'
              ? '\\int_0^\\infty \\mu\\left(\\{x : f(x) \\ge t\\}\\right)\\,dt'
              : `\\int_{${Number(analysis.minX.toFixed(1))}}^{${Number(analysis.maxX.toFixed(1))}} f(x)\\,dx`,
        }),
      ]),
    ]),
  ]);

  if (!isClosed && state.exactArea != null) {
    const err = Math.abs(state.fittedArea - state.exactArea);
    card.append(
      el('div', { class: 'mt-2 grid grid-cols-2 gap-2 text-center relative z-10' }, [
        el('div', { class: 'bg-slate-900/80 rounded p-2 border border-slate-800/50' }, [
          el('div', { class: 'text-[9px] uppercase tracking-widest text-slate-500 font-bold' }, 'Exact (antiderivative)'),
          el('div', { class: 'text-sm text-emerald-400 font-light mt-0.5' }, String(state.exactArea.toFixed(6))),
        ]),
        el('div', { class: 'bg-slate-900/80 rounded p-2 border border-slate-800/50' }, [
          el('div', { class: 'text-[9px] uppercase tracking-widest text-slate-500 font-bold' }, 'Numeric error'),
          el('div', { class: 'text-sm text-sky-400 font-light mt-0.5' }, err < 1e-9 ? '0' : String(err.toExponential(3))),
        ]),
      ]),
    );
  }
  return card;
}

/** Copy text with a graceful fallback for non-secure contexts (file://). */
async function copyText(text, toast) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('LaTeX copied to clipboard');
  } catch {
    toast('Could not copy. Select the text manually.');
  }
}



