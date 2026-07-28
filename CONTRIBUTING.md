# Contributing to MemeCollagen

Thanks for taking an interest. Bug reports, ideas and pull requests are all welcome.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting set up

There is nothing to install. Clone the repo and open `index.html` in a browser.

```bash
git clone https://github.com/SciScend/meme-collagen.git
cd meme-collagen
xdg-open index.html
```

For anything involving storage or fonts it is worth also checking the served path, since a
few browsers treat `file://` differently:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

To run the tests you need Chrome or Chromium and Python 3. That is the entire toolchain.

## Running the tests

```bash
./tests/run.sh          # headless Chrome over http://
./tests/run.sh file     # the same suite over file://
```

Both must pass before a pull request can be merged; CI runs exactly these two commands. If
Chrome is somewhere unusual, point the runner at it: `CHROME=/path/to/chrome ./tests/run.sh`.

The runner copies the real app into a temporary directory, appends `tests/tests.js` to it and
drives it in a real browser. There is no mock and no duplicate copy of the app, so a test can
never pass against code that no longer exists.

## Adding a test

Tests live in `tests/tests.js`, inside `runTests()`, as plain assertions grouped by
`mark('section N')` markers. Add yours to the section it belongs to:

```js
const l = imageLayers()[0];
placeInRect(l, 0, 0, 500, 250);
ok('cover crop fills the frame', near(l.crop.sw / l.crop.sh, 2, 0.01), l.crop.sw / l.crop.sh);
```

`ok(name, condition, actual)` records one check; the third argument is printed only when the
check fails, so pass whatever you would want to see in that moment. `near(a, b, tol)` is there
because floating-point geometry is never exact.

Anything you can do with a pointer, a test can do too — `dragPointer()`, `pinch()` and `key()`
dispatch real `PointerEvent`s and `KeyboardEvent`s at the canvas. For anything visual, export
the canvas and assert on pixels with `countColor()` rather than eyeballing it.

Please add a test with any bug fix. Every bug found so far had a test that would have caught
it, and now does.

## Code style

- **Vanilla JavaScript, no dependencies.** This is a hard constraint, not a preference: the
  project's entire promise is that you can open one file and it works, offline, forever.
- **No ES modules.** Classic `<script>` tags only. Module imports are blocked by CORS on
  `file://`, and running from `file://` is the point. New files go in `index.html` in
  dependency order, after the files they use.
- Two-space indent, semicolons, `'use strict'` at the top of each file, single quotes.
- Keep to the existing shape: `model.js` owns state and geometry, `render.js` only draws,
  `interact.js` only handles input, `ui.js` only touches the panel and the DOM. A change that
  needs all four is usually a change that wants rethinking.
- Comments explain *why*, not *what*. The ones already in the code are the standard to match —
  most of them mark a trap someone (usually a browser) laid.

## Regenerating the screenshots

If you change the interface, refresh the images in the README:

```bash
./docs/screenshots.sh
```

It photographs the real app in three states, driven by `docs/demo.js`, so the README can never
show a version of the interface that no longer exists.

## Pull requests

1. Branch from `main`.
2. Make the change, add a test, run both test modes.
3. Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md).
4. Open the PR and describe what changed and why. Screenshots for anything visual, please.

Commit messages in the imperative mood, subject under ~72 characters, body explaining the
reasoning if it is not obvious:

```
Reflow pinned captions after a scale gesture

Scaling a template caption grew the block symmetrically about its
centre, so a caption pinned to the top edge crept off the canvas.
```

## Reporting a bug

Open an issue with the browser and OS, what you did, what happened, and what you expected.
If it is visual, a screenshot or the exported PNG says more than a paragraph. If you can
reproduce it from an empty canvas, the exact steps are gold.
