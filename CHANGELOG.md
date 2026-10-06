# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A GitHub link in the toolbar, and a "Created by: SciScend" credit in the status bar.
- A welcome card on the empty canvas, in place of the faint "Drop images here" hint at the
  bottom: what the tool is for, **Add pictures** and **Start with text** buttons, the three
  steps from picture to PNG, and a note that nothing is uploaded. It shrinks to fit small
  canvases and phones, and stays hidden while a saved session is still loading.
- While the canvas is empty it is drawn as a dashed drop target, and clicking anywhere on it
  opens the file picker.

### Changed

- The README now covers only using the app; the story of how it was built and the code layout
  moved to [HOW-THIS-WAS-BUILT.md](HOW-THIS-WAS-BUILT.md).
- The status bar shows the credit on the left, messages in the centre and the shortcut hints
  on the right. It no longer says "Ready" when there is nothing to report.
- **Download PNG** is shown as an ordinary button until there is something to download, so a
  new visitor's eye goes to adding pictures first.

### Fixed

- The test runner waits for the suite to finish in real time instead of in Chrome's virtual
  time, which ran ahead while an autosave was being written to disk. The autosave section
  failed on most CI runs because of it, and occasionally on local runs.

## [1.0.0] - 2026-07-28

First release.

### Added

- **Pictures** — add by button, drag-and-drop or clipboard paste; move, scale, rotate (with
  15° snapping on <kbd>Shift</kbd>), flip, rotate by 90°, and an optional border.
- **Crop & zoom** with a dimmed canvas, a ghost of the area being cut away, and rule-of-thirds
  guides.
- **Collage layouts** — grid, rows, columns, big + side, filmstrip, with an adjustable gap.
  Frames are filled edge to edge by matching the crop to the frame's aspect.
- **Text** — size, colour, font, uppercase, bold, and a configurable outline; alignment,
  wrap width and word wrapping with a character-level fallback for unbreakable words.
- **Speech bubbles** with a draggable tail, and 30 emoji stickers.
- **Templates** — top & bottom captions, caption bar, demotivational poster, speech bubble.
  Template captions are pinned to the canvas edge so they grow inwards rather than off it.
- **Fonts** — Anton and Oswald bundled as base64 (Oswald covers Cyrillic), plus upload of your
  own `.ttf`/`.otf`/`.woff`/`.woff2`, stored with the project.
- **Undo/redo**, 80 steps deep, over JSON snapshots of the document.
- **Autosave** to IndexedDB, degrading to local storage and then to memory-only, with the
  active mode reported in the status line.
- **PNG export** at 1×, 2× or 3×, without editing chrome.
- **Touch support** — one finger to drag, resize and rotate; two to pinch, twist and pan.
- Headless-browser test suite of 85 checks, run over both `http://` and `file://`.

[Unreleased]: https://github.com/SciScend/meme-collagen/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/SciScend/meme-collagen/releases/tag/v1.0.0
