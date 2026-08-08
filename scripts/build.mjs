/**
 * build.mjs: zero-dependency bundler.
 *
 * Produces dist/topographic-core.html: a single self-contained file that runs
 * by double-clicking (file://) with no local server and no Node.js.
 *
 * How it works: every ES module in src/ is wrapped in an IIFE with its
 * imports destructured from earlier-defined module variables, and the web
 * worker is inlined as a Blob source string. No dependencies, no toolchain.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

// module name -> file (math core lives in src/math/, app code in src/)
const MODULE_FILES = {
  evaluate: join(SRC, 'math/evaluate.js'),
  matrix: join(SRC, 'math/matrix.js'),
  format: join(SRC, 'math/format.js'),
  integrate: join(SRC, 'math/integrate.js'),
  regression: join(SRC, 'math/regression.js'),
  analysis: join(SRC, 'analysis.js'),
  state: join(SRC, 'state.js'),
  renderer: join(SRC, 'renderer.js'),
  ui: join(SRC, 'ui.js'),
  main: join(SRC, 'main.js'),
  worker: join(SRC, 'worker.js'),
};

// Dependency-safe definition order (post-order DFS of the import graph).
const MAIN_MODULES = ['evaluate', 'matrix', 'format', 'integrate', 'regression', 'analysis', 'state', 'renderer', 'ui', 'main'];
const WORKER_MODULES = ['evaluate', 'matrix', 'integrate', 'regression', 'analysis', 'worker'];

const IMPORT_RE = /^import\s+\{([^}]*)\}\s+from\s+'([^']+)';\s*$/gm;
const EXPORT_DECL_RE = /^export\s+(async\s+)?(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]*)\};\s*$/gm;

function readModule(name) {
  return readFileSync(MODULE_FILES[name], 'utf8');
}

/** Strip imports/exports and collect exported names for one module. */
function transpile(name, src, opts = {}) {
  const exported = [];
  for (const m of src.matchAll(EXPORT_DECL_RE)) exported.push(m[3]);
  for (const m of src.matchAll(EXPORT_LIST_RE)) {
    for (const part of (m[1] || '').split(',')) {
      const p = part.trim();
      if (!p) continue;
      exported.push(p.split(/\s+as\s+/)[0].trim());
    }
  }

  // imports → `const { a, b } = __mod_<name>;`
  src = src.replace(IMPORT_RE, (_, namesStr, spec) => {
    const mod = spec.replace(/^.*\//, '').replace(/\.js$/, '');
    const names = namesStr.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => {
        const parts = s.split(/\s+as\s+/);
        return parts.length === 2 ? `${parts[1]}: ${parts[0]}` : parts[0];
      });
    return `const { ${names.join(', ')} } = __mod_${mod};`;
  });

  // strip export keywords
  src = src.replace(EXPORT_DECL_RE, (_, asyncKw, kind, nm) => `${asyncKw || ''}${kind} ${nm}`);
  src = src.replace(EXPORT_LIST_RE, '// (re-exports inlined by the bundler)');

  if (opts.isMain) {
    // Classic scripts have no import.meta; run the worker from an inlined Blob.
    src = src.replace(
      "const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });",
      "const w = new Worker(URL.createObjectURL(new Blob([__TOPOCORE_WORKER_SRC__], { type: 'application/javascript' })));",
    );
    src = `const __TOPOCORE_WORKER_SRC__ = ${JSON.stringify(opts.workerSrc)};\n${src}`;
  }

  return { src, exported: [...new Set(exported)] };
}

/** Bundle a module list into an IIFE-wrapped classic script. */
function bundleModules(names, opts = {}) {
  const parts = [];
  for (const name of names) {
    let src = readModule(name);
    const t = transpile(name, src, opts);
    const exports = t.exported.length ? `return { ${t.exported.join(', ')} };` : 'return {};';
    parts.push(`const __mod_${name} = (() => {\n${t.src}\n${exports}\n})();\n`);
  }
  return parts.join('\n');
}

// 1) worker bundle (string embedded in the main bundle)
const workerSrc = bundleModules(WORKER_MODULES);

// 2) main bundle
const mainJs = bundleModules(MAIN_MODULES, { isMain: true, workerSrc });

// 3) sanity: the emitted classic script must be valid JS with no import.meta.
new vm.Script(mainJs, { filename: 'bundle-check.js' });
if (/import\.meta/.test(mainJs)) throw new Error('import.meta survived bundling');
if (/^\s*import\s/m.test(mainJs)) throw new Error('import statement survived bundling');

// 4) HTML shell
const styles = readFileSync(join(ROOT, 'styles.css'), 'utf8');
const html = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '    <meta charset="UTF-8">',
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '    <title>Topographic Core | Sketch Regression Engine</title>',
  '    <meta name="description" content="Draw a function by hand; get polynomial, exponential, logarithmic, Fourier and measure-theoretic analyses back: areas, LaTeX and Desmos-ready curves.">',
  '    <!-- Styling + LaTeX still load from CDNs (internet needed); all app code is bundled locally. -->',
  '    <script src="https://cdn.tailwindcss.com"></script>',
  '    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">',
  '    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js" defer></script>',
  '    <style>',
  styles,
  '    </style>',
  '</head>',
  '<body class="bg-slate-950">',
  '    <div id="root"></div>',
  '    <div id="toasts" class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end pointer-events-none"></div>',
  '    <script>',
  mainJs,
  '    </script>',
  '</body>',
  '</html>',
].join('\n');

const outDir = join(ROOT, 'dist');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'topographic-core.html');
writeFileSync(outFile, html);
console.log(`Built ${outFile} (${(html.length / 1024).toFixed(1)} KB)`);
