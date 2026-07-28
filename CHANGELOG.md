# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
