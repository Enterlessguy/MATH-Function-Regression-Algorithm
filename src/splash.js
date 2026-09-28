/*
 * Startup animation, ported from the Schedule I Control Center intro and
 * shared with I-DB Macro.
 *
 * Phases: fade in (720 ms, ease-out cubic), hold while the main window is
 * built (at least 900 ms), fade out (680 ms, ease-in quadratic).
 */
(function () {
    'use strict';

    const FADE_IN_MS = 720;
    const FADE_OUT_MS = 680;
    const MIN_HOLD_MS = 900;

    const UI_FONT = '"Segoe UI", Inter, "Noto Sans", Cantarell, "DejaVu Sans", sans-serif';
    const WELCOME_FONT = '"Control Center Script"';

    const rgba = (r, g, b, a) => `rgba(${r}, ${g}, ${b}, ${a / 255})`;

    function create(options) {
        const opts = options || {};
        const greeting = opts.name ? `Welcome, ${opts.name}` : 'Welcome';
        const product = (opts.product || '').toUpperCase();

        const canvas = document.createElement('canvas');
        canvas.className = 'splash';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.opacity = '0';
        const ctx = canvas.getContext('2d');

        const cube = new Image();
        cube.src = 'assets/cube.png';

        let opacity = 0;
        let raf = 0;
        let fadingOut = false;
        let onVisible = null;
        let onFinished = null;

        function paint() {
            const dpr = window.devicePixelRatio || 1;
            const w = window.innerWidth, h = window.innerHeight;
            if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
                canvas.width = Math.round(w * dpr);
                canvas.height = Math.round(h * dpr);
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const bg = ctx.createLinearGradient(0, 0, 0, h);
            bg.addColorStop(0, 'rgb(5, 13, 34)');
            bg.addColorStop(1, 'rgb(2, 5, 16)');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, w, h);
            grid(w, h);

            const scale = Math.max(0.72, Math.min(1.18, Math.min(w / 1450, h / 850)));
            const cx = w / 2;
            const cubeSize = 190 * scale;
            const cubeCy = h * 0.39;

            glow(cx, cubeCy + cubeSize * 0.12, 420 * scale, 250 * scale);
            const cubeTop = cubeCy - cubeSize / 2;
            if (cube.complete && cube.naturalWidth) {
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(cube, cx - cubeSize / 2, cubeTop, cubeSize, cubeSize);
            }

            const titleTop = cubeTop + cubeSize + 26 * scale;
            brand('Intelligence Database', cx, titleTop, 30 * scale);
            const welcomeTop = titleTop + 72 * scale;
            welcome(greeting, cx, welcomeTop, 31 * scale);

            const ruleY = welcomeTop + 54 * scale;
            ctx.strokeStyle = rgba(40, 144, 255, 90);
            ctx.lineWidth = Math.max(1, 1.4 * scale);
            ctx.beginPath();
            ctx.moveTo(cx - 118 * scale, ruleY);
            ctx.lineTo(cx + 118 * scale, ruleY);
            ctx.stroke();

            if (product) {
                const px = Math.max(1, Math.round(11 * scale));
                ctx.font = `600 ${px}px ${UI_FONT}`;
                if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.max(1, px * 0.35)}px`;
                ctx.fillStyle = '#707C9D';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(product, cx, ruleY + 14 * scale);
                if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
            }
        }

        function grid(w, h) {
            ctx.strokeStyle = rgba(86, 161, 255, 9);
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = 0.5; x < w; x += 52) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
            for (let y = 0.5; y < h; y += 52) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
            ctx.stroke();
            // Vignette: darker at the top and bottom, clear through the middle.
            const v = ctx.createLinearGradient(0, 0, 0, h);
            v.addColorStop(0, rgba(3, 7, 20, 205 * 0.85));
            v.addColorStop(0.48, rgba(2, 5, 16, 205 * 0.08));
            v.addColorStop(1, rgba(2, 5, 16, 205));
            ctx.fillStyle = v;
            ctx.fillRect(0, 0, w, h);
        }

        function ellipseGlow(cx, cy, w, h, inner, outer) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(1, h / w);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 2);
            g.addColorStop(0, inner);
            g.addColorStop(1, outer);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function glow(cx, cy, w, h) {
            ellipseGlow(cx, cy, w, h, rgba(32, 134, 255, 105), rgba(4, 10, 28, 0));
        }

        function brand(text, cx, top, px) {
            ctx.font = `700 ${Math.max(1, Math.round(px))}px ${UI_FONT}`;
            const width = ctx.measureText(text).width;
            const height = px * 1.33;
            ellipseGlow(cx, top + height / 2, width + 84, height + 36,
                rgba(30, 103, 206, 25), rgba(30, 103, 206, 0));
            ctx.fillStyle = 'rgb(30, 103, 206)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(text, cx, top);
        }

        function welcome(text, cx, top, px) {
            ctx.font = `${Math.max(1, Math.round(px))}px ${WELCOME_FONT}, ${UI_FONT}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            const m = ctx.measureText(text);
            const left = cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 + m.actualBoundingBoxLeft;
            const baseline = top + m.actualBoundingBoxAscent;
            ctx.lineJoin = 'round';
            ctx.lineWidth = Math.max(3, px * 0.18);
            ctx.strokeStyle = rgba(69, 146, 255, 32);
            ctx.strokeText(text, left, baseline);
            ctx.fillStyle = 'rgb(218, 229, 249)';
            ctx.fillText(text, left, baseline);
        }

        function animate(from, to, ms, ease, done) {
            cancelAnimationFrame(raf);
            const start = performance.now();
            const step = now => {
                const p = Math.min(1, (now - start) / ms);
                opacity = from + (to - from) * ease(p);
                canvas.style.opacity = String(opacity);
                if (p < 1) raf = requestAnimationFrame(step);
                else done();
            };
            raf = requestAnimationFrame(step);
        }

        function fadeOut() {
            if (fadingOut) return;
            fadingOut = true;
            animate(opacity, 0, FADE_OUT_MS, p => p * p, () => {
                window.removeEventListener('resize', paint);
                window.removeEventListener('keydown', onKey, true);
                canvas.remove();
                if (onFinished) onFinished();
            });
        }

        function onKey(e) {
            if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                fadeOut();
            }
        }

        return {
            /** Show and fade in; resolves fonts first so the greeting never flashes. */
            start() {
                document.body.appendChild(canvas);
                window.addEventListener('resize', paint);
                window.addEventListener('keydown', onKey, true);
                canvas.addEventListener('click', fadeOut);
                const fonts = document.fonts ? document.fonts.load(`31px ${WELCOME_FONT}`).catch(() => null) : null;
                const image = cube.decode ? cube.decode().catch(() => null) : null;
                const ready = Promise.race([
                    Promise.all([fonts, image]),
                    new Promise(r => setTimeout(r, 400)),
                ]);
                ready.then(() => {
                    paint();
                    animate(0, 1, FADE_IN_MS, p => 1 - (1 - p) ** 3, () => { if (onVisible) onVisible(); });
                });
                // Late assets repaint in place.
                cube.onload = paint;
            },
            revealAfter(holdMs) {
                setTimeout(fadeOut, Math.max(MIN_HOLD_MS, holdMs || 0));
            },
            skip: fadeOut,
            set onFullyVisible(fn) { onVisible = fn; },
            set onFinished(fn) { onFinished = fn; },
        };
    }

    window.IDBSplash = { create };
})();
