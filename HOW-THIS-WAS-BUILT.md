# How this was built

MemeCollagen was written by an AI agent — [Claude Code](https://claude.com/claude-code) running
Claude Opus 5 in auto mode — from **four short prompts in a single session** on 28 July 2026.
The numbers below come from the session transcript, not from memory.

| | |
|---|---|
| Human prompts | **4**, about 456 characters in total |
| Active time | **~1 h 13 min** (spread over an 8-hour evening, mostly idle) |
| Agent turns / tool calls | 231 / 128 |
| Application code | 2,436 lines across 6 files |
| Tests | 569 lines, **85 browser tests**, passing over `http://` and `file://` |

The first prompt asked for three features — upload an image, add text boxes, change text size
and colour — and invited the agent to say what was missing. It proposed seven additions, and the
second prompt, all eight words of it, approved them:

> grate - do all of them. And make sure it works.

Undo/redo, autosave, cropping and rotation, text wrapping and alignment, touch and pinch
gestures, custom font upload and collage templates all came from that sentence. The two
remaining prompts asked for documentation that follows GitHub conventions, and settled the
name. Everything else in this repository — the test suite, the CI workflow, the issue and PR
templates, the contributing guide, the changelog — the agent decided to write on its own.

**Worth stating plainly**, because the interesting part of a demonstration is where it strains:

- The tests are the agent's own. They prove the app does what it was built to do and does not
  regress; they cannot prove the specification was right.
- The session filled its context window once and needed compacting mid-build.
- Auto mode means all 128 tool calls ran without step-by-step approval, including the agent
  writing and running its own headless-Chrome tests. That self-verification is the part worth
  paying attention to.

The point of publishing it is not the memes. It is a concrete, inspectable answer to *what can
an AI agent actually finish?* — published by [SciScend](https://sciscend.com/), which teaches
this kind of work.

## How it is built

Eight source files, plain `<script>` tags, no modules — which is precisely what lets it run
from a `file://` URL, where ES module imports are blocked by CORS.

| Path | Purpose |
| --- | --- |
| `index.html` | Markup: toolbar, canvas stage, side panel |
| `styles.css` | All styling |
| `fonts.css` | Bundled Anton + Oswald, embedded as base64 |
| `store.js` | Image and font assets, autosave, undo history |
| `model.js` | Document state, geometry, text layout, collage layouts, templates |
| `render.js` | Canvas drawing: layers, crop overlay, selection handles, export |
| `interact.js` | Pointer, touch and keyboard editing |
| `ui.js` | Side panel, importing, exporting, boot |
| `tests/` | Headless browser test suite |
| `docs/` | Screenshots and the script that regenerates them |

Three decisions carry most of the design:

- **A layer holds an asset id, never an `<img>`.** That makes the whole document plain JSON,
  which in turn makes undo and autosave nearly free — a snapshot is one `JSON.stringify`.
- **Everything is centre-anchored and may be rotated.** Hit testing transforms the pointer into
  each layer's own space rather than tracking rotated corners around the canvas.
- **Imported images are capped at 1600px on the long edge,** so autosave stays inside the
  browser's storage quota.
