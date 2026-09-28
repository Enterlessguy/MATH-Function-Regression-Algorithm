# Security

## Reporting a problem

Please report vulnerabilities privately through GitHub's
[security advisory form](https://github.com/Enterlessguy/MATH-Function-Regression-Algorithm/security/advisories/new)
rather than in a public issue. Include your browser, its version and the
steps to reproduce. You should get a reply within a week.

## What Function Regression does and does not do

- **No network access.** The page loads no scripts, styles or fonts from
  anywhere else. The Content-Security-Policy (`default-src 'none'`,
  `connect-src 'none'`) makes the browser refuse any request the page did not
  ship with, so a future change cannot quietly add one.
- **No third-party code.** There are no runtime or build dependencies, so
  there is no supply chain to compromise.
- **No `eval`.** No in-browser compilation, no `new Function`, and no inline
  scripts or styles. The CSP forbids them.
- **Local data only.** Settings, including the optional greeting name, are
  kept in `localStorage` under `idb.function-regression.v1`. When they are
  read back, every value is checked against an allow-list or clamped to its
  range, so a tampered entry can't inject anything.
- **Text is text.** The greeting name is only drawn on a canvas. Results are
  built with `textContent`. The one `innerHTML` use renders formula markup
  that comes only from the internal number formatter (digits, signs and fixed
  `<i>`/`<sup>` tags). Your drawing and settings never reach it.
- **Clipboard is write-only.** Copy buttons write LaTeX to the clipboard. The
  page never reads the clipboard.
