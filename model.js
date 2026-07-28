/* model.js — the document, its geometry, and the operations that change it.
 *
 * Every layer is positioned by its CENTRE (x, y) and may be rotated (rot, in
 * degrees). All hit testing happens in the layer's own un-rotated space. */

'use strict';

const state = {
  w: 1000,
  h: 1000,
  bg: '#ffffff',
  layers: [],
  selectedId: null,
  cropId: null,          // layer currently being cropped, if any
  nextId: 1,
  ratioLocked: false,    // true once the user picks a canvas shape themselves
};

/** Scratch context used purely for text measurement. */
const measureCtx = document.createElement('canvas').getContext('2d');

const DEG = Math.PI / 180;

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* ------------------------------------------------------------ layer lookup */

function selected() {
  return state.layers.find(l => l.id === state.selectedId) || null;
}

function layerById(id) {
  return state.layers.find(l => l.id === id) || null;
}

function croppingLayer() {
  return state.cropId ? layerById(state.cropId) : null;
}

/* --------------------------------------------------------------- text flow */

/** Break one paragraph into lines no wider than `maxW`. Long unbreakable words
 *  are split character by character so nothing ever escapes the box. */
function wrapParagraph(text, maxW) {
  if (!text) return [''];
  const words = text.split(/(\s+)/);
  const lines = [];
  let line = '';

  const push = () => { lines.push(line.replace(/\s+$/, '')); line = ''; };

  for (const word of words) {
    if (measureCtx.measureText(line + word).width <= maxW || !line.trim()) {
      // A single word longer than the box has to be broken up.
      if (!line.trim() && measureCtx.measureText(word).width > maxW && word.trim()) {
        let chunk = '';
        for (const ch of word) {
          if (chunk && measureCtx.measureText(chunk + ch).width > maxW) {
            lines.push(chunk);
            chunk = '';
          }
          chunk += ch;
        }
        line = chunk;
        continue;
      }
      line += word;
    } else {
      push();
      if (word.trim()) line = word;
    }
  }
  push();
  return lines.length ? lines : [''];
}

function fontString(l) {
  return `${l.bold ? 'bold ' : ''}${Math.max(1, l.size)}px ${l.font}`;
}

/** Lay a text layer out: the lines, the line height, and the box they fill. */
function layoutText(l) {
  measureCtx.font = fontString(l);
  const raw = (l.upper ? l.text.toUpperCase() : l.text).split('\n');
  const lines = l.boxW > 0
    ? raw.flatMap(p => wrapParagraph(p, l.boxW))
    : raw;

  const natural = lines.reduce((m, t) => Math.max(m, measureCtx.measureText(t).width), 1);
  const lineHeight = l.size * 1.15;
  return {
    lines,
    lineHeight,
    w: l.boxW > 0 ? Math.max(l.boxW, 1) : natural,
    h: lines.length * lineHeight,
  };
}

/** Padding around the text: room for the outline, or the bubble's inner margin. */
function textPad(l) {
  return l.bubble ? l.size * 0.5 + 6 : l.strokeWidth;
}

/* -------------------------------------------------------------- geometry */

/** Un-rotated size of a layer, in canvas pixels. */
function layerSize(l) {
  if (l.type === 'image') {
    const b = l.border || 0;
    return { w: l.w + b * 2, h: l.h + b * 2 };
  }
  const lay = layoutText(l);
  const pad = textPad(l);
  return { w: lay.w + pad * 2, h: lay.h + pad * 2, lay, pad };
}

/** World point -> the layer's local space (origin at its centre, un-rotated). */
function toLocal(l, p) {
  const dx = p.x - l.x;
  const dy = p.y - l.y;
  const a = -(l.rot || 0) * DEG;
  return {
    x: dx * Math.cos(a) - dy * Math.sin(a),
    y: dx * Math.sin(a) + dy * Math.cos(a),
  };
}

/** Layer-local point -> world coordinates. */
function toWorld(l, p) {
  const a = (l.rot || 0) * DEG;
  return {
    x: l.x + p.x * Math.cos(a) - p.y * Math.sin(a),
    y: l.y + p.x * Math.sin(a) + p.y * Math.cos(a),
  };
}

function hitTest(l, p) {
  const s = layerSize(l);
  const q = toLocal(l, p);
  return Math.abs(q.x) <= s.w / 2 && Math.abs(q.y) <= s.h / 2;
}

function layerAt(p) {
  for (let i = state.layers.length - 1; i >= 0; i--) {
    if (hitTest(state.layers[i], p)) return state.layers[i];
  }
  return null;
}

/** Handle size in canvas pixels — roughly constant on screen. */
function handleSize() {
  return Math.max(10, Math.round(Math.max(state.w, state.h) / 75));
}

/** The interactive handles of a layer, in world coordinates. */
function handlesOf(l) {
  const s = layerSize(l);
  const hw = s.w / 2, hh = s.h / 2;
  const out = [
    { name: 'nw', kind: 'scale', ...toWorld(l, { x: -hw, y: -hh }) },
    { name: 'ne', kind: 'scale', ...toWorld(l, { x: hw, y: -hh }) },
    { name: 'se', kind: 'scale', ...toWorld(l, { x: hw, y: hh }) },
    { name: 'sw', kind: 'scale', ...toWorld(l, { x: -hw, y: hh }) },
    { name: 'rot', kind: 'rotate', ...toWorld(l, { x: 0, y: -hh - handleSize() * 2.2 }) },
  ];
  if (l.type === 'text') {
    out.push({ name: 'w', kind: 'width', ...toWorld(l, { x: -hw, y: 0 }) });
    out.push({ name: 'e', kind: 'width', ...toWorld(l, { x: hw, y: 0 }) });
    if (l.bubble && l.bubble.tail) {
      out.push({ name: 'tail', kind: 'tail', ...toWorld(l, l.bubble.tail) });
    }
  }
  return out;
}

function handleAt(l, p) {
  const r = handleSize() * 1.3;
  return handlesOf(l).find(h => Math.hypot(p.x - h.x, p.y - h.y) <= r) || null;
}

/* ----------------------------------------------------------------- cropping */

/** Force the crop rectangle to match the frame's aspect ratio and stay inside
 *  the source image. This is what makes every frame a "cover" fill. */
function normalizeCrop(l) {
  const a = getAsset(l.assetId);
  if (!a) return;
  if (!l.crop) l.crop = { sx: 0, sy: 0, sw: a.w, sh: a.h };
  const c = l.crop;
  const target = l.w / l.h;

  // Grow/shrink the crop to the frame's aspect, keeping its centre.
  const cx = c.sx + c.sw / 2;
  const cy = c.sy + c.sh / 2;
  let sw = c.sw, sh = c.sh;
  if (sw / sh > target) sw = sh * target; else sh = sw / target;

  // Never larger than the source.
  const fit = Math.min(a.w / sw, a.h / sh, 1e9);
  if (fit < 1) { sw *= fit; sh *= fit; }

  c.sw = sw;
  c.sh = sh;
  c.sx = clamp(cx - sw / 2, 0, Math.max(0, a.w - sw));
  c.sy = clamp(cy - sh / 2, 0, Math.max(0, a.h - sh));
}

/** The largest region of the frame's aspect that the source can supply, kept
 *  centred on the current crop. Used whenever a frame is (re)placed, so that
 *  re-running layouts never zooms progressively further in. */
function coverCrop(l) {
  const a = getAsset(l.assetId);
  if (!a) return;
  const c = l.crop || { sx: 0, sy: 0, sw: a.w, sh: a.h };
  const cx = c.sx + c.sw / 2;
  const cy = c.sy + c.sh / 2;
  const target = l.w / l.h;
  const sw = Math.min(a.w, a.h * target);
  const sh = sw / target;
  l.crop = {
    sw, sh,
    sx: clamp(cx - sw / 2, 0, Math.max(0, a.w - sw)),
    sy: clamp(cy - sh / 2, 0, Math.max(0, a.h - sh)),
  };
}

/** Zoom level of the crop: 1 = the largest region the frame can show. */
function cropZoom(l) {
  const a = getAsset(l.assetId);
  if (!a || !l.crop) return 1;
  const base = Math.min(a.w / (l.w / l.h), a.h) * (l.w / l.h);
  return base / l.crop.sw;
}

function setCropZoom(l, zoom) {
  const a = getAsset(l.assetId);
  if (!a) return;
  const c = l.crop;
  const cx = c.sx + c.sw / 2;
  const cy = c.sy + c.sh / 2;
  const target = l.w / l.h;
  let sw = Math.min(a.w, a.h * target) / clamp(zoom, 1, 8);
  let sh = sw / target;
  c.sw = sw; c.sh = sh;
  c.sx = clamp(cx - sw / 2, 0, Math.max(0, a.w - sw));
  c.sy = clamp(cy - sh / 2, 0, Math.max(0, a.h - sh));
}

/** Reset to the whole picture, reshaping the frame so nothing is cut off. */
function uncrop(l) {
  const a = getAsset(l.assetId);
  if (!a) return;
  l.crop = { sx: 0, sy: 0, sw: a.w, sh: a.h };
  l.h = l.w * (a.h / a.w);
}

/* ------------------------------------------------------------- layer edits */

function addImageLayer(asset) {
  const fit = Math.min(state.w / asset.w, state.h / asset.h, 1) * 0.9;
  const layer = {
    id: state.nextId++,
    type: 'image',
    assetId: asset.id,
    x: state.w / 2,
    y: state.h / 2,
    w: asset.w * fit,
    h: asset.h * fit,
    rot: 0,
    flip: false,
    border: 0,
    borderColor: '#ffffff',
    crop: { sx: 0, sy: 0, sw: asset.w, sh: asset.h },
  };
  state.layers.push(layer);
  return layer;
}

function defaultText(over) {
  const layer = {
    id: state.nextId++,
    type: 'text',
    text: 'YOUR TEXT HERE',
    x: state.w / 2,
    y: state.h * 0.12,
    rot: 0,
    size: Math.round(state.h * 0.085),
    color: '#ffffff',
    font: fontList[0].css,
    bold: false,
    upper: true,
    align: 'center',
    boxW: Math.round(state.w * 0.9),
    stroke: '#000000',
    strokeWidth: Math.max(2, Math.round(state.h * 0.008)),
    bubble: null,
    edge: null,        // set when a template pins it to an edge
  };
  Object.assign(layer, over || {});
  state.layers.push(layer);
  return layer;
}

function addTextLayer() {
  const n = state.layers.filter(l => l.type === 'text').length;
  return defaultText({ y: clamp(state.h * 0.12 + n * 40, 40, state.h - 40) });
}

function addSticker(emoji) {
  return defaultText({
    text: emoji,
    upper: false,
    boxW: 0,
    strokeWidth: 0,
    font: EMOJI_FONT,
    size: Math.round(state.h * 0.16),
    x: state.w / 2,
    y: state.h / 2,
    sticker: true,
  });
}

function duplicateLayer(l) {
  const copy = JSON.parse(JSON.stringify(l));
  copy.id = state.nextId++;
  copy.x += 24;
  copy.y += 24;
  state.layers.push(copy);
  return copy;
}

function removeLayer(id) {
  state.layers = state.layers.filter(l => l.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  if (state.cropId === id) state.cropId = null;
}

function reorderLayer(id, dir) {
  const i = state.layers.findIndex(l => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.layers.length) return false;
  [state.layers[i], state.layers[j]] = [state.layers[j], state.layers[i]];
  return true;
}

function imageLayers() {
  return state.layers.filter(l => l.type === 'image');
}

/** Place an image so it exactly fills the given rectangle (cropping as needed). */
function placeInRect(l, rx, ry, rw, rh) {
  l.x = rx + rw / 2;
  l.y = ry + rh / 2;
  l.w = rw;
  l.h = rh;
  l.rot = 0;
  coverCrop(l);
}

/* ------------------------------------------------------- collage layouts */

const layoutGap = { value: 12 };

/** Rectangles for `n` pictures under the named layout. */
function layoutRects(name, n, gap) {
  const W = state.w, H = state.h;
  const rects = [];
  const cell = (col, row, cols, rows, colSpan = 1, rowSpan = 1) => {
    const cw = (W - gap * (cols + 1)) / cols;
    const ch = (H - gap * (rows + 1)) / rows;
    return {
      x: gap + col * (cw + gap),
      y: gap + row * (ch + gap),
      w: cw * colSpan + gap * (colSpan - 1),
      h: ch * rowSpan + gap * (rowSpan - 1),
    };
  };

  if (name === 'rows') {
    for (let i = 0; i < n; i++) rects.push(cell(0, i, 1, n));
  } else if (name === 'cols') {
    for (let i = 0; i < n; i++) rects.push(cell(i, 0, n, 1));
  } else if (name === 'strip') {
    const cols = Math.min(n, 4);
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) rects.push(cell(i % cols, Math.floor(i / cols), cols, rows));
  } else if (name === 'feature' && n > 1) {
    const side = n - 1;
    rects.push({
      x: gap,
      y: gap,
      w: (W - gap * 3) * 0.62,
      h: H - gap * 2,
    });
    const sx = gap * 2 + (W - gap * 3) * 0.62;
    const sw = (W - gap * 3) * 0.38;
    const sh = (H - gap * (side + 1)) / side;
    for (let i = 0; i < side; i++) {
      rects.push({ x: sx, y: gap + i * (sh + gap), w: sw, h: sh });
    }
  } else {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) rects.push(cell(i % cols, Math.floor(i / cols), cols, rows));
  }
  return rects;
}

function applyLayout(name) {
  const imgs = imageLayers();
  if (!imgs.length) return 0;
  const rects = layoutRects(name, imgs.length, layoutGap.value);
  imgs.forEach((l, i) => {
    const r = rects[i] || rects[rects.length - 1];
    placeInRect(l, r.x, r.y, r.w, r.h);
  });
  return imgs.length;
}

/* ---------------------------------------------------------------- templates */

/** Pin a text block against the top or bottom edge, allowing for however many
 *  lines it wrapped into. The layer remembers the pin, so typing a longer
 *  caption grows it inwards instead of pushing it off the canvas. */
function snapToEdge(l, edge, margin) {
  l.edge = edge;
  if (margin !== undefined) l.edgeMargin = margin;
  const m = l.edgeMargin === undefined ? state.h * 0.025 : l.edgeMargin;
  const s = layerSize(l);
  l.y = edge === 'top' ? m + s.h / 2 : state.h - m - s.h / 2;
}

/** Re-apply an edge pin after anything that changes a text block's height. */
function reflow(l) {
  if (l && l.type === 'text' && l.edge) snapToEdge(l, l.edge);
}

/** Moving a block by hand releases its pin. */
function unpin(l) {
  if (l) l.edge = null;
}

/** Caption/style presets. Each returns a short description for the status bar. */
const templates = {
  topbottom() {
    const imgs = imageLayers();
    if (imgs.length === 1) placeInRect(imgs[0], 0, 0, state.w, state.h);
    else applyLayout('grid');
    const common = {
      boxW: Math.round(state.w * 0.92),
      size: Math.round(state.h * 0.09),
      strokeWidth: Math.max(3, Math.round(state.h * 0.009)),
    };
    snapToEdge(defaultText({ ...common, text: 'TOP TEXT' }), 'top');
    snapToEdge(defaultText({ ...common, text: 'BOTTOM TEXT' }), 'bottom');
    return 'Top & bottom captions';
  },

  bar() {
    const barH = Math.round(state.h * 0.16);
    const imgs = imageLayers();
    if (imgs.length) {
      const rects = layoutRects('grid', imgs.length, layoutGap.value);
      // Squash the layout into the area below the caption bar.
      imgs.forEach((l, i) => {
        const r = rects[i];
        const k = (state.h - barH) / state.h;
        placeInRect(l, r.x, barH + r.y * k, r.w, r.h * k);
      });
    }
    state.bg = '#ffffff';
    snapToEdge(defaultText({
      text: 'When you finally ship it',
      upper: false,
      color: '#111111',
      strokeWidth: 0,
      size: Math.round(barH * 0.42),
      boxW: Math.round(state.w * 0.94),
      font: fontList[4].css,
    }), 'top', barH * 0.18);
    return 'Caption bar';
  },

  demotivational() {
    state.bg = '#000000';
    const imgs = imageLayers();
    const frameW = state.w * 0.76;
    const frameH = state.h * 0.6;
    if (imgs.length === 1) {
      placeInRect(imgs[0], (state.w - frameW) / 2, state.h * 0.08, frameW, frameH);
      imgs[0].border = Math.max(2, Math.round(state.w * 0.004));
      imgs[0].borderColor = '#ffffff';
    } else if (imgs.length > 1) {
      const rects = layoutRects('grid', imgs.length, layoutGap.value);
      imgs.forEach((l, i) => {
        const r = rects[i];
        placeInRect(l, (state.w - frameW) / 2 + r.x * (frameW / state.w),
                    state.h * 0.08 + r.y * (frameH / state.h),
                    r.w * (frameW / state.w), r.h * (frameH / state.h));
        l.border = Math.max(2, Math.round(state.w * 0.003));
        l.borderColor = '#ffffff';
      });
    }
    const title = defaultText({
      text: 'DESPAIR',
      color: '#ffffff',
      strokeWidth: 0,
      size: Math.round(state.h * 0.1),
      font: fontList[5].css,
      boxW: Math.round(state.w * 0.8),
    });
    const sub = defaultText({
      text: 'It is always darkest just before it goes pitch black.',
      upper: false,
      color: '#dddddd',
      strokeWidth: 0,
      size: Math.round(state.h * 0.038),
      font: fontList[5].css,
      boxW: Math.round(state.w * 0.8),
    });
    // Stack the caption up from the bottom edge so neither block runs off.
    snapToEdge(sub, 'bottom', state.h * 0.045);
    title.y = sub.y - layerSize(sub).h / 2 - layerSize(title).h / 2 - state.h * 0.005;
    return 'Demotivational poster';
  },

  bubble() {
    const t = defaultText({
      text: 'Say something',
      upper: false,
      color: '#111111',
      strokeWidth: 0,
      size: Math.round(state.h * 0.05),
      boxW: Math.round(state.w * 0.42),
      x: state.w * 0.32,
      y: state.h * 0.22,
      font: fontList[4].css,
      bubble: { fill: '#ffffff', stroke: '#111111', tail: null },
    });
    const s = layerSize(t);
    t.bubble.tail = { x: s.w * 0.1, y: s.h / 2 + state.h * 0.1 };
    return 'Speech bubble';
  },
};
