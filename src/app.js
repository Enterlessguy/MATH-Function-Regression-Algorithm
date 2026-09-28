/*
 * Function Regression - UI, canvas and interaction.
 *
 * Everything user-visible that is built from data goes through textContent,
 * except formula markup, which comes only from FRMath.formatFit / htmlNum:
 * numbers rendered by the formatter plus fixed tags (<i>, <sup>). No user
 * text ever reaches innerHTML.
 */
(function () {
    'use strict';

    const M = window.FRMath;
    const $ = sel => document.querySelector(sel);

    // ============================================================ settings

    const STORAGE_KEY = 'idb.function-regression.v1';
    const DEFAULTS = {
        drawingMode: 'single', shape: 'auto', model: 'polynomial', degree: 3, harmonics: 12,
        sigma: false, intMethod: 'simpson', intN: 50, showArea: true, showRaw: true, intro: true, userName: '',
    };
    const ENUMS = {
        drawingMode: ['single', 'piecewise'],
        shape: ['auto', 'open', 'closed'],
        model: ['polynomial', 'fourier', 'exponential', 'logarithmic', 'constant'],
        intMethod: ['simpson', 'trapezoid', 'mid', 'left', 'right', 'lebesgue'],
    };
    const RANGES = { degree: [1, M.MAX_DEGREE], harmonics: [1, M.MAX_HARMONICS], intN: [2, 1000] };
    const BOOLS = ['sigma', 'showArea', 'showRaw', 'intro'];

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    // Strip control characters and cap the length; the name is only ever drawn on a canvas.
    const cleanName = s => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 40);

    /** Validate settings read from localStorage: allow-listed choices, clamped numbers, cleaned name. */
    function sanitize(raw) {
        const s = { ...DEFAULTS };
        if (!raw || typeof raw !== 'object') return s;
        for (const k of Object.keys(ENUMS)) if (ENUMS[k].includes(raw[k])) s[k] = raw[k];
        for (const [k, [lo, hi]] of Object.entries(RANGES)) {
            if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) s[k] = clamp(Math.round(raw[k]), lo, hi);
        }
        for (const k of BOOLS) if (typeof raw[k] === 'boolean') s[k] = raw[k];
        if (typeof raw.userName === 'string') s.userName = cleanName(raw.userName);
        return s;
    }

    function loadSettings() {
        try { return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
        catch (_) { return { ...DEFAULTS }; }
    }

    function saveSettings() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) { /* storage disabled */ }
    }

    const settings = loadSettings();

    // ============================================================ state

    const DEFAULT_SCALE = 40;               // pixels per unit
    const view = { cx: 0, cy: 0, scale: DEFAULT_SCALE };
    let strokes = [];                       // [[{x, y}]]
    let history = [];
    let analysis = null;
    let drawing = false;
    let panning = null;
    let lastPx = null;
    let pointerMath = null;

    const canvas = $('#plot');
    const ctx = canvas.getContext('2d');
    const stage = $('#stage');
    let W = 0, H = 0, dpr = 1;

    const toPx = (x, y) => ({ x: W / 2 + (x - view.cx) * view.scale, y: H / 2 - (y - view.cy) * view.scale });
    const toMath = (px, py) => ({ x: view.cx + (px - W / 2) / view.scale, y: view.cy - (py - H / 2) / view.scale });
    const localPoint = e => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    // ============================================================ controls

    function bindControls() {
        document.querySelectorAll('.segmented[data-setting]').forEach(group => {
            const key = group.dataset.setting;
            group.addEventListener('click', e => {
                const btn = e.target.closest('button[data-value]');
                if (!btn || !ENUMS[key].includes(btn.dataset.value)) return;
                settings[key] = btn.dataset.value;
                if (key === 'drawingMode' && settings.drawingMode === 'piecewise') settings.shape = 'open';
                changed(key);
            });
        });
        document.querySelectorAll('select[data-setting]').forEach(sel => {
            sel.addEventListener('change', () => {
                if (ENUMS[sel.dataset.setting].includes(sel.value)) settings[sel.dataset.setting] = sel.value;
                changed(sel.dataset.setting);
            });
        });
        document.querySelectorAll('input[type="range"][data-setting]').forEach(input => {
            input.addEventListener('input', () => {
                const [lo, hi] = RANGES[input.dataset.setting];
                settings[input.dataset.setting] = clamp(Math.round(Number(input.value)), lo, hi);
                changed(input.dataset.setting);
            });
        });
        document.querySelectorAll('input[type="checkbox"][data-setting]').forEach(input => {
            input.addEventListener('change', () => { settings[input.dataset.setting] = input.checked; changed(input.dataset.setting); });
        });
        const name = $('#userName');
        name.addEventListener('input', () => { settings.userName = cleanName(name.value); saveSettings(); });

        $('#undo').addEventListener('click', undo);
        $('#clear').addEventListener('click', clearAll);
        $('#fit').addEventListener('click', fitView);
        $('#export').addEventListener('click', exportPng);
        $('#zoom-in').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.25));
        $('#zoom-out').addEventListener('click', () => zoomAt(W / 2, H / 2, 1 / 1.25));
        $('#zoom-reset').addEventListener('click', resetView);
        $('#results').addEventListener('click', onResultsClick);
    }

    const VIEW_ONLY = new Set(['showArea', 'showRaw', 'intro', 'userName']);

    function changed(key) {
        saveSettings();
        syncControls();
        if (VIEW_ONLY.has(key)) requestDraw();
        else scheduleAnalyze();
    }

    function syncControls() {
        document.querySelectorAll('.segmented[data-setting]').forEach(group => {
            group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === settings[group.dataset.setting])));
        });
        document.querySelectorAll('select[data-setting]').forEach(sel => { sel.value = settings[sel.dataset.setting]; });
        document.querySelectorAll('input[type="range"][data-setting]').forEach(input => {
            input.value = settings[input.dataset.setting];
            const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
            input.style.setProperty('--pct', `${pct}%`);
            const out = document.querySelector(`output[data-for="${input.id}"]`);
            if (out) out.textContent = input.value;
        });
        document.querySelectorAll('input[type="checkbox"][data-setting]').forEach(input => { input.checked = settings[input.dataset.setting]; });
        const name = $('#userName');
        if (document.activeElement !== name) name.value = settings.userName;

        const closed = isClosedMode();
        $('[data-show="single"]').hidden = settings.drawingMode !== 'single';
        $('[data-show="polynomial"]').hidden = closed || settings.model !== 'polynomial';
        $('[data-show="harmonics"]').hidden = !(closed || settings.model === 'fourier');
        $('#model-group select').disabled = closed;
        $('#integration-group').classList.toggle('disabled', closed);
    }

    /** Whether the current strokes are (or will be) treated as a closed curve. */
    function isClosedMode() {
        if (analysis) return analysis.type === 'closed';
        return settings.drawingMode === 'single' && settings.shape === 'closed';
    }

    // ============================================================ canvas sizing and view

    function resize() {
        const r = stage.getBoundingClientRect();
        dpr = window.devicePixelRatio || 1;
        W = Math.max(1, r.width);
        H = Math.max(1, r.height);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        requestDraw();
    }

    function zoomAt(px, py, factor) {
        const anchor = toMath(px, py);
        view.scale = clamp(view.scale * factor, 2, 50000);
        view.cx = anchor.x - (px - W / 2) / view.scale;
        view.cy = anchor.y + (py - H / 2) / view.scale;
        requestDraw();
    }

    function resetView() {
        view.cx = 0; view.cy = 0; view.scale = DEFAULT_SCALE;
        requestDraw();
    }

    function fitView() {
        const all = strokes.flat();
        if (!all.length) { resetView(); return; }
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of all) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
        view.cx = (x0 + x1) / 2;
        view.cy = (y0 + y1) / 2;
        view.scale = clamp(Math.min(W / ((x1 - x0) * 1.3 || 1), H / ((y1 - y0) * 1.3 || 1)), 2, 50000);
        requestDraw();
    }

    // ============================================================ input

    function pushHistory() {
        history.push(strokes.slice());
        if (history.length > 100) history.shift();
    }

    function undo() {
        if (!history.length) return;
        strokes = history.pop();
        scheduleAnalyze();
    }

    function clearAll() {
        if (!strokes.length) return;
        pushHistory();
        strokes = [];
        scheduleAnalyze();
    }

    function bindPointer() {
        canvas.addEventListener('contextmenu', e => e.preventDefault());

        canvas.addEventListener('pointerdown', e => {
            const p = localPoint(e);
            if (e.button === 1 || e.button === 2) {
                panning = { x: e.clientX, y: e.clientY };
                stage.classList.add('panning');
                canvas.setPointerCapture(e.pointerId);
                return;
            }
            if (e.button !== 0) return;
            canvas.setPointerCapture(e.pointerId);
            pushHistory();
            const start = [toMath(p.x, p.y)];
            strokes = settings.drawingMode === 'single' ? [start] : [...strokes, start];
            drawing = true;
            lastPx = p;
            setBadge('Drawing', 'busy');
            requestDraw();
        });

        canvas.addEventListener('pointermove', e => {
            const p = localPoint(e);
            pointerMath = toMath(p.x, p.y);
            if (panning) {
                view.cx -= (e.clientX - panning.x) / view.scale;
                view.cy += (e.clientY - panning.y) / view.scale;
                panning = { x: e.clientX, y: e.clientY };
            } else if (drawing) {
                const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
                const current = strokes[strokes.length - 1];
                for (const ev of events.length ? events : [e]) {
                    const q = localPoint(ev);
                    if (Math.hypot(q.x - lastPx.x, q.y - lastPx.y) < 1.5) continue;
                    current.push(toMath(q.x, q.y));
                    lastPx = q;
                }
            }
            requestDraw();
        });

        const finish = e => {
            if (panning) {
                panning = null;
                stage.classList.remove('panning');
            }
            if (!drawing) return;
            drawing = false;
            if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
            if (strokes[strokes.length - 1].length < 4) {
                // A click, not a stroke: forget it.
                strokes = history.pop() || [];
            }
            scheduleAnalyze();
        };
        canvas.addEventListener('pointerup', finish);
        canvas.addEventListener('pointercancel', finish);
        canvas.addEventListener('pointerleave', () => { pointerMath = null; requestDraw(); });

        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const p = localPoint(e);
            const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            zoomAt(p.x, p.y, Math.exp(-delta * 0.0015));
        }, { passive: false });

        window.addEventListener('keydown', e => {
            if (e.target.closest('input, select, textarea')) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
            else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearAll(); }
            else if (e.key === 'f' || e.key === 'F') fitView();
            else if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.25);
            else if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.25);
            else if (e.key === '0') resetView();
        });
    }

    // ============================================================ analysis

    let analyzeQueued = false;
    function scheduleAnalyze() {
        if (analyzeQueued) return;
        analyzeQueued = true;
        requestAnimationFrame(() => {
            analyzeQueued = false;
            analyze();
        });
    }

    function analyze() {
        analysis = M.analyzeStrokes(strokes, settings, view.scale);
        finishAnalysis();
    }

    function finishAnalysis() {
        syncControls();
        renderResults();
        requestDraw();
    }

    // ============================================================ drawing

    let drawQueued = false;
    function requestDraw() {
        if (drawQueued) return;
        drawQueued = true;
        requestAnimationFrame(() => { drawQueued = false; draw(); });
    }

    const C = {
        grid: 'rgba(86, 161, 255, 0.055)',
        gridMajor: 'rgba(86, 161, 255, 0.11)',
        axis: 'rgba(170, 179, 207, 0.42)',
        label: '#707C9D',
        raw: 'rgba(248, 250, 255, 0.24)',
        rawActive: 'rgba(248, 250, 255, 0.55)',
        fit: '#4DA6FF',
        fitGlow: 'rgba(77, 166, 255, 0.55)',
        closed: '#49D18B',
        closedGlow: 'rgba(73, 209, 139, 0.5)',
        areaFill: 'rgba(77, 166, 255, 0.13)',
        areaStroke: 'rgba(77, 166, 255, 0.38)',
        lebFill: 'rgba(73, 209, 139, 0.12)',
        lebStroke: 'rgba(73, 209, 139, 0.36)',
    };

    function niceStep(target) {
        const p = Math.pow(10, Math.floor(Math.log10(target)));
        const f = target / p;
        return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
    }

    const fmtTick = v => {
        const a = Math.abs(v);
        if (a >= 1e5 || (a > 0 && a < 1e-3)) return v.toExponential(0);
        return String(Number(v.toPrecision(6)));
    };

    function draw() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        drawGrid();
        if (analysis && analysis.type === 'function' && analysis.f && settings.showArea) drawArea();
        if (analysis && analysis.type === 'closed') drawClosed();
        if (settings.showRaw || drawing) drawStrokes();
        if (analysis && analysis.type === 'function') drawPieces();
        updateHud();
        $('#empty').hidden = strokes.length > 0;
        $('#zoom-reset').textContent = `${Math.round((view.scale / DEFAULT_SCALE) * 100)}%`;
    }

    function drawGrid() {
        const step = niceStep(90 / view.scale);
        const minor = step / 5;
        const tl = toMath(0, 0), br = toMath(W, H);

        const lines = (s, color) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = Math.ceil(tl.x / s) * s; x <= br.x; x += s) {
                const px = Math.round(toPx(x, 0).x) + 0.5;
                ctx.moveTo(px, 0); ctx.lineTo(px, H);
            }
            for (let y = Math.ceil(br.y / s) * s; y <= tl.y; y += s) {
                const py = Math.round(toPx(0, y).y) + 0.5;
                ctx.moveTo(0, py); ctx.lineTo(W, py);
            }
            ctx.stroke();
        };
        if (minor * view.scale >= 8) lines(minor, C.grid);
        lines(step, C.gridMajor);

        const origin = toPx(0, 0);
        const ax = clamp(origin.x, 0, W), ay = clamp(origin.y, 0, H);
        ctx.strokeStyle = C.axis;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ax, 0); ctx.lineTo(ax, H);
        ctx.moveTo(0, ay); ctx.lineTo(W, ay);
        ctx.stroke();

        ctx.font = '11px "Cascadia Mono", Consolas, monospace';
        ctx.fillStyle = C.label;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const labelY = ay > H - 22 ? ay - 18 : ay + 6;
        for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
            if (Math.abs(x) < step * 1e-6) continue;
            ctx.fillText(fmtTick(x), toPx(x, 0).x, labelY);
        }
        ctx.textAlign = ax < 60 ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        const labelX = ax < 60 ? ax + 6 : ax - 6;
        for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) {
            if (Math.abs(y) < step * 1e-6) continue;
            ctx.fillText(fmtTick(y), labelX, toPx(0, y).y);
        }
    }

    function strokePath(points) {
        ctx.beginPath();
        points.forEach((p, i) => {
            const q = toPx(p.x, p.y);
            if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
        });
        ctx.stroke();
    }

    function drawStrokes() {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = 3;
        strokes.forEach((s, i) => {
            ctx.strokeStyle = drawing && i === strokes.length - 1 ? C.rawActive : C.raw;
            if (s.length > 1) strokePath(s);
        });
    }

    /** Plot y = f(x) for one piece at one sample per pixel, breaking on gaps and blow-ups. */
    function plotPiece(piece) {
        const left = toMath(0, 0).x, right = toMath(W, 0).x;
        const a = Math.max(piece.minX, left), b = Math.min(piece.maxX, right);
        if (!(b > a)) return;
        const dx = 1 / view.scale;
        ctx.beginPath();
        let pen = false;
        for (let x = a; x <= b + dx * 0.5; x += dx) {
            const xx = Math.min(x, b);
            const y = M.evaluateModel(piece.fit, xx);
            const q = toPx(xx, y);
            if (!Number.isFinite(y) || Math.abs(q.y) > 1e5) { pen = false; continue; }
            if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; }
        }
        ctx.stroke();
    }

    function drawPieces() {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = C.fit;
        ctx.shadowColor = C.fitGlow;
        ctx.shadowBlur = 12;
        analysis.pieces.filter(p => p.fit).forEach(plotPiece);
        ctx.restore();
    }

    function drawArea() {
        const { f, domain: [a, b], method, n } = analysis;
        ctx.save();
        ctx.lineWidth = 1;

        if (method === 'lebesgue') {
            ctx.fillStyle = C.lebFill;
            ctx.strokeStyle = C.lebStroke;
            for (const s of analysis.strips) {
                const p = toPx(s.x0, s.y1), q = toPx(s.x1, s.y0);
                const w = q.x - p.x, h = q.y - p.y;
                if (w < 0.3) continue;
                ctx.fillRect(p.x, p.y, w, h);
                if (Math.abs(h) > 2.5) ctx.strokeRect(p.x, p.y, w, h);
            }
            ctx.restore();
            return;
        }

        ctx.fillStyle = C.areaFill;
        ctx.strokeStyle = C.areaStroke;
        const m = method === 'simpson' && n % 2 ? n + 1 : n;
        const h = (b - a) / m;
        const zero = toPx(0, 0).y;
        ctx.beginPath();
        const step = method === 'simpson' ? 2 : 1;
        for (let i = 0; i < m; i += step) {
            const xl = a + i * h, xr = a + (i + step) * h;
            const pl = toPx(xl, 0).x, pr = toPx(xr, 0).x;
            if (pr < 0 || pl > W) continue;
            if (method === 'trapezoid') {
                const yl = f(xl), yr = f(xr);
                if (!Number.isFinite(yl) || !Number.isFinite(yr)) continue;
                ctx.moveTo(pl, zero); ctx.lineTo(pl, toPx(0, yl).y); ctx.lineTo(pr, toPx(0, yr).y); ctx.lineTo(pr, zero); ctx.closePath();
            } else if (method === 'simpson') {
                // The parabola through the panel's three nodes is what Simpson integrates.
                const y0 = f(xl), y1 = f(xl + h), y2 = f(xr);
                if (![y0, y1, y2].every(Number.isFinite)) continue;
                ctx.moveTo(pl, zero);
                for (let k = 0; k <= 16; k++) {
                    const t = k / 16, s = 2 * t;
                    const y = y0 * (s - 1) * (s - 2) / 2 - y1 * s * (s - 2) + y2 * s * (s - 1) / 2;
                    ctx.lineTo(toPx(xl + t * 2 * h, 0).x, toPx(0, y).y);
                }
                ctx.lineTo(pr, zero); ctx.closePath();
            } else {
                const xs = method === 'left' ? xl : method === 'right' ? xr : (xl + xr) / 2;
                const y = f(xs);
                if (!Number.isFinite(y)) continue;
                const top = toPx(0, y).y;
                ctx.rect(pl, Math.min(top, zero), pr - pl, Math.abs(top - zero));
            }
        }
        ctx.fill();
        if ((b - a) / m * view.scale > 3) ctx.stroke();
        ctx.restore();
    }

    function drawClosed() {
        const { xs, ys } = analysis.fit.outline;
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < xs.length; i++) {
            const q = toPx(xs[i], ys[i]);
            if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
        }
        ctx.closePath();
        if (settings.showArea) {
            ctx.fillStyle = 'rgba(73, 209, 139, 0.11)';
            ctx.fill();
        }
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = C.closed;
        ctx.shadowColor = C.closedGlow;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.restore();
    }

    function updateHud() {
        const pts = strokes.reduce((n, s) => n + s.length, 0);
        const parts = [`${pts} pts`];
        if (pointerMath) parts.unshift(`x ${fmtTick(round(pointerMath.x))}   y ${fmtTick(round(pointerMath.y))}`);
        $('#hud').textContent = parts.join('   ·   ');
    }
    const round = v => Number(v.toPrecision(4));

    // ============================================================ results panel

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /** Formula markup produced by FRMath's formatter (numbers + <i>/<sup> only). */
    function formulaNode(html, className) {
        const node = el('div', className || 'formula');
        node.innerHTML = html; // eslint-disable-line no-unsanitized/property -- formatter output only
        return node;
    }

    function stat(label, value, quality) {
        const box = el('div', 'stat');
        box.append(el('div', 'stat-label', label), el('div', `stat-value ${quality || ''}`, value));
        return box;
    }

    function copyButton(label, payload) {
        const b = el('button', 'small', label);
        b.type = 'button';
        b.dataset.copy = payload;
        return b;
    }

    function setBadge(text, kind) {
        const badge = $('#status-badge');
        badge.textContent = text;
        badge.className = `badge ${kind || ''}`;
    }

    const MODEL_LABEL = {
        polynomial: f => `Polynomial · degree ${f.degree}`,
        fourier: f => `Fourier · ${f.harmonics} harmonic${f.harmonics === 1 ? '' : 's'}`,
        exponential: () => 'Exponential',
        logarithmic: () => 'Logarithmic',
        constant: () => 'Constant',
    };

    const METHOD_LABEL = {
        simpson: "Simpson's rule", trapezoid: 'Trapezoid rule', mid: 'Midpoint sum',
        left: 'Left Riemann sum', right: 'Right Riemann sum', lebesgue: 'Lebesgue sum',
    };

    const fmt = (v, sig) => (Number.isFinite(v) ? String(Number(v.toPrecision(sig || 6))) : '—');
    const quality = r2 => (r2 >= 0.99 ? 'good' : r2 >= 0.9 ? 'fair' : 'poor');
    const domainTex = p => `\\left\\{${M.texNum(p.minX)}\\le x\\le${M.texNum(p.maxX)}\\right\\}`;

    function renderResults() {
        const root = $('#results');
        root.replaceChildren();
        const sub = $('#results-sub');

        if (!analysis) {
            sub.textContent = 'Waiting for a stroke';
            setBadge('Idle');
            const ph = el('div', 'placeholder');
            ph.append(el('strong', '', 'No data yet'), el('span', '', 'Draw a stroke to see its formula, R², RMSE and area.'));
            root.append(ph);
            return;
        }
        if (analysis.type === 'error') {
            sub.textContent = 'Could not fit this stroke';
            setBadge('Error', 'warn');
            root.append(el('div', 'card error-card', analysis.message));
            return;
        }
        if (analysis.type === 'closed') { renderClosed(root, sub); return; }
        renderFunction(root, sub);
    }

    function renderFunction(root, sub) {
        const { pieces } = analysis;
        const good = pieces.filter(p => p.fit);
        sub.textContent = pieces.length > 1 ? `Piecewise function · ${pieces.length} segments` : 'Function y = f(x)';
        setBadge(good.length === pieces.length ? 'Fitted' : 'Partial', good.length === pieces.length ? 'ok' : 'warn');

        if (settings.showArea && analysis.f) root.append(areaCard());

        pieces.forEach((p, i) => {
            const card = el('div', p.error ? 'card error-card' : 'card');
            const head = el('div', 'card-head');
            const titles = el('div');
            titles.append(
                el('div', 'card-title', pieces.length > 1 ? `Segment ${i + 1}` : 'Fitted function'),
                el('div', 'card-meta', `x ∈ [${fmt(p.minX, 4)}, ${fmt(p.maxX, 4)}]`),
            );
            head.append(titles);
            if (p.fit) head.append(copyButton('Copy LaTeX', `y=${M.formatFit(p.fit).tex}${domainTex(p)}`));
            card.append(head);

            if (p.error) { card.append(el('div', '', p.error)); root.append(card); return; }

            const formula = M.formatFit(p.fit, { limit: 8 });
            card.append(el('div', 'card-meta', MODEL_LABEL[p.fit.model](p.fit)));
            const f = formulaNode(`<i>f</i>(<i>x</i>) = ${formula.html}`);
            f.style.marginTop = '8px';
            card.append(f);
            const notes = [];
            if (formula.note) notes.push(formula.note);
            if (p.fit.model === 'polynomial' && p.fit.degree < p.fit.requestedDegree) notes.push(`degree limited to ${p.fit.degree} by the number of distinct points`);
            if (p.fit.model === 'fourier' && p.fit.harmonics < p.fit.requestedHarmonics) notes.push(`limited to ${p.fit.harmonics} harmonics by the number of points (Nyquist)`);
            if (p.fit.model === 'fourier') notes.push('the line through the two end points is subtracted before the transform and added back after, so the series matches the stroke at both ends');
            notes.forEach(n => card.append(formulaNode(n, 'formula-note')));

            const stats = el('div', 'stats');
            stats.append(
                stat('R²', fmt(p.stats.r2, 5), quality(p.stats.r2)),
                stat('RMSE', fmt(p.stats.rmse, 3)),
                stat('Points', String(p.stats.n)),
            );
            card.append(stats);
            root.append(card);
        });

        if (good.length > 1) {
            const all = good.map(p => `y=${M.formatFit(p.fit).tex}${domainTex(p)}`).join('\n');
            const card = el('div', 'card');
            const head = el('div', 'card-head');
            head.append(el('div', 'card-title', 'All segments'), copyButton('Copy all', all));
            card.append(head, el('div', 'card-meta', 'One line per segment, in Desmos format.'));
            root.append(card);
        }
    }

    function areaCard() {
        const { area, reference, domain } = analysis;
        const card = el('div', 'card accent');
        const head = el('div', 'card-head');
        head.append(el('div', 'card-title', 'Signed area'), el('div', 'card-meta', `${METHOD_LABEL[analysis.method]} · N = ${analysis.n}`));
        const big = el('div', 'big-number', fmt(area, 7));
        big.append(el('small', '', 'units²'));
        const err = Math.abs(area - reference);
        // Relative to the unsigned area: the signed area can cancel to ~0.
        const rel = analysis.absolute > 1e-12 ? err / analysis.absolute : NaN;
        const kv = el('dl', 'kv');
        const row = (k, v) => kv.append(el('dt', '', k), el('dd', '', v));
        row('Reference (Gauss–Legendre)', fmt(reference, 10));
        row('Absolute error', fmt(err, 3));
        row('Error / ∫|f|', Number.isFinite(rel) ? `${fmt(rel * 100, 3)} %` : '—');
        row('Unsigned area ∫|f|', fmt(analysis.absolute, 8));
        row('Interval', `[${fmt(domain[0], 5)}, ${fmt(domain[1], 5)}]`);
        card.append(head, big, kv);
        return card;
    }

    function renderClosed(root, sub) {
        const { fit } = analysis;
        sub.textContent = `Closed curve · ${fit.harmonics} harmonic${fit.harmonics === 1 ? '' : 's'}`;
        setBadge('Fitted', 'ok');

        const area = el('div', 'card accent');
        const head = el('div', 'card-head');
        head.append(el('div', 'card-title', 'Enclosed area'), el('div', 'card-meta', fit.fittedArea >= 0 ? 'counter-clockwise' : 'clockwise'));
        const big = el('div', 'big-number', fmt(Math.abs(fit.fittedArea), 7));
        big.append(el('small', '', 'units²'));
        const kv = el('dl', 'kv');
        const row = (k, v) => kv.append(el('dt', '', k), el('dd', '', v));
        row('From coefficients  π Σ k|cₖ|²', fmt(Math.abs(fit.fittedArea), 8));
        row('Shoelace formula on the raw stroke', fmt(Math.abs(fit.rawArea), 8));
        row('Perimeter', fmt(fit.perimeter, 6));
        area.append(head, big, kv);
        root.append(area);

        const card = el('div', 'card');
        const h2 = el('div', 'card-head');
        h2.append(el('div', 'card-title', 'Parametric curve'), copyButton('Copy for Desmos', M.formatParametric(fit.coeffs)));
        card.append(h2);
        card.append(formulaNode('<i>z</i>(<i>t</i>) = Σ<sub>|<i>k</i>|≤' + fit.harmonics + '</sub> <i>c<sub>k</sub></i> <i>e</i><sup>2π<i>ikt</i></sup>, &nbsp;<i>t</i> ∈ [0, 1]'));
        card.append(formulaNode('<i>X</i>(<i>t</i>) = Re <i>z</i>(<i>t</i>), &nbsp;<i>Y</i>(<i>t</i>) = Im <i>z</i>(<i>t</i>)', 'formula-note'));
        const stats = el('div', 'stats');
        stats.append(
            stat('Harmonics', String(fit.harmonics)),
            stat('RMS deviation', fmt(fit.rmsError, 3)),
            stat('Terms', String(fit.coeffs.length)),
        );
        card.append(stats);

        // Dominant harmonics, largest first.
        const ranked = fit.coeffs.filter(c => c.k !== 0).map(c => ({ k: c.k, mag: Math.hypot(c.re, c.im) }))
            .sort((a, b) => b.mag - a.mag).slice(0, 6);
        if (ranked.length) {
            const table = el('table', 'harmonics-table');
            const hr = el('tr');
            hr.append(el('th', '', 'k'), el('th', '', '|cₖ|'), el('th', '', ''));
            table.append(hr);
            ranked.forEach(r => {
                const tr = el('tr');
                const bar = el('span', 'bar');
                bar.style.width = `${Math.max(2, (r.mag / ranked[0].mag) * 90)}px`;
                const barCell = el('td');
                barCell.append(bar);
                tr.append(el('td', '', String(r.k)), el('td', '', fmt(r.mag, 4)), barCell);
                table.append(tr);
            });
            card.append(table);
        }
        if (fit.harmonics < fit.requestedHarmonics) {
            card.append(el('div', 'formula-note', `Limited to ${fit.harmonics} harmonics by the number of points (Nyquist).`));
        }
        root.append(card);
    }

    async function onResultsClick(e) {
        const btn = e.target.closest('button[data-copy]');
        if (!btn) return;
        const ok = await copyText(btn.dataset.copy);
        toast(ok ? 'Copied to clipboard.' : 'Copy failed: the browser blocked clipboard access.');
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.append(area);
            area.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
            area.remove();
            return ok;
        }
    }

    let toastTimer = 0;
    function toast(message) {
        const t = $('#toast');
        t.textContent = message;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
    }

    function exportPng() {
        const out = document.createElement('canvas');
        out.width = canvas.width;
        out.height = canvas.height;
        const o = out.getContext('2d');
        const bg = o.createLinearGradient(0, 0, 0, out.height);
        bg.addColorStop(0, 'rgb(5, 13, 34)');
        bg.addColorStop(1, 'rgb(2, 5, 16)');
        o.fillStyle = bg;
        o.fillRect(0, 0, out.width, out.height);
        o.drawImage(canvas, 0, 0);
        out.toBlob(blob => {
            if (!blob) { toast('Could not export the image.'); return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'function-regression.png';
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
    }

    // ============================================================ boot

    function boot() {
        bindControls();
        bindPointer();
        syncControls();
        new ResizeObserver(resize).observe(stage);
        resize();
        renderResults();

        const reveal = () => document.body.classList.remove('booting');
        const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!settings.intro || reduced || !window.IDBSplash) { reveal(); return; }
        // Never leave the app hidden if the intro fails for any reason.
        const failsafe = setTimeout(reveal, 5000);
        try {
            const splash = window.IDBSplash.create({ name: settings.userName, product: 'Function Regression' });
            splash.onFullyVisible = () => {
                reveal();
                resize();
                splash.revealAfter(0);
            };
            splash.onFinished = () => clearTimeout(failsafe);
            splash.start();
        } catch (_) {
            reveal();
        }
    }

    boot();
})();
