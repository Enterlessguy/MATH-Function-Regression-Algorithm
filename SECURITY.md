# Security

## Reporting a problem

Please report vulnerabilities through GitHub's
[private advisory form](https://github.com/Enterlessguy/MATH-Function-Regression-Algorithm/security/advisories/new),
not in a public issue. Include your browser and version and the steps to
reproduce. You should get a reply within a week.

## What the page does

- **No network requests.** All scripts, styles, fonts and images are files in
  this repository. The Content-Security-Policy (`default-src 'none'`,
  `connect-src 'none'`) makes the browser block anything else.
- **No dependencies.** There is no third-party code, at runtime or at build
  time.
- **No `eval`, `new Function`, inline scripts or inline styles.** The CSP
  blocks them.
- **Settings stay in the browser.** They are stored in `localStorage` under
  `idb.function-regression.v1`, along with the optional greeting name. On
  load, each value is checked against a list of allowed values or clamped to
  its range.
- **HTML output.** The greeting name is only drawn on a canvas. Results are
  inserted with `textContent`. The single `innerHTML` use is for formulas,
  and its content comes from the number formatter only: digits, signs and
  fixed `<i>`/`<sup>` tags.
- **Clipboard.** The copy buttons write to the clipboard. The page never
  reads it.
