/* render.js — everything that paints pixels.
 *
 * drawScene() is shared by the screen and the PNG export; the selection
 * outline and crop overlay are drawn separately so they never end up in a file. */

'use strict';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const hint = document.getElementById('hint');

const ACCENT = '#4c8dff';

function roundRectPath(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

/** Run `fn` with the canvas moved and rotated into the layer's own space. */
function inLayerSpace(c, l, fn) {
  c.save();
  c.translate(l.x, l.y);
  if (l.rot) c.rotate(l.rot * DEG);
  fn();
  c.restore();
}

/* ------------------------------------------------------------------ layers */

function drawImageLayer(c, l) {
  const a = getAsset(l.assetId);
  if (!a) return;
  const crop = l.crop || { sx: 0, sy: 0, sw: a.w, sh: a.h };

  inLayerSpace(c, l, () => {
    if (l.border > 0) {
      c.fillStyle = l.borderColor || '#ffffff';
      c.fillRect(-l.w / 2 - l.border, -l.h / 2 - l.border,
                 l.w + l.border * 2, l.h + l.border * 2);
    }
    c.save();
    if (l.flip) c.scale(-1, 1);
    c.drawImage(a.img, crop.sx, crop.sy, crop.sw, crop.sh,
                -l.w / 2, -l.h / 2, l.w, l.h);
    c.restore();
  });
}

function drawTextLayer(c, l) {
  const s = layerSize(l);
  const { lay, pad } = s;

  inLayerSpace(c, l, () => {
    if (l.bubble) {
      c.beginPath();
      roundRectPath(c, -s.w / 2, -s.h / 2, s.w, s.h, Math.min(s.h, s.w) * 0.22);
      if (l.bubble.tail) {
        const t = l.bubble.tail;
        const top = t.y < 0;
        const edgeY = top ? -s.h / 2 : s.h / 2;
        const half = Math.max(8, s.w * 0.08);
        const cx = clamp(t.x, -s.w / 2 + half * 2, s.w / 2 - half * 2);
        c.moveTo(cx - half, edgeY);
        c.lineTo(t.x, t.y);
        c.lineTo(cx + half, edgeY);
        c.closePath();
      }
      // Stroke first, then fill: hides the seam where the tail meets the body.
      c.lineJoin = 'round';
      c.lineWidth = Math.max(3, l.size * 0.11);   // half is hidden by the fill
      c.strokeStyle = l.bubble.stroke;
      c.stroke();
      c.fillStyle = l.bubble.fill;
      c.fill();
    }

    c.font = fontString(l);
    c.textBaseline = 'middle';
    c.textAlign = l.align === 'left' ? 'left' : l.align === 'right' ? 'right' : 'center';
    const anchorX = l.align === 'left' ? -lay.w / 2 : l.align === 'right' ? lay.w / 2 : 0;
    c.lineJoin = 'round';
    c.miterLimit = 2;

    lay.lines.forEach((line, i) => {
      const y = -s.h / 2 + pad + lay.lineHeight * (i + 0.5);
      if (l.strokeWidth > 0) {
        c.strokeStyle = l.stroke;
        c.lineWidth = l.strokeWidth * 2;   // half of it hides under the fill
        c.strokeText(line, anchorX, y);
      }
      c.fillStyle = l.color;
      c.fillText(line, anchorX, y);
    });
  });
}

function drawScene(c) {
  c.save();
  c.fillStyle = state.bg;
  c.fillRect(0, 0, state.w, state.h);
  for (const l of state.layers) {
    if (l.type === 'image') drawImageLayer(c, l);
    else drawTextLayer(c, l);
  }
  c.restore();
}

/* ------------------------------------------------------------ crop overlay */

/** Dim the document, show the whole source picture faintly, and keep the part
 *  inside the frame bright — the usual "what am I cutting off" view. */
function drawCropOverlay(c, l) {
  const a = getAsset(l.assetId);
  if (!a) return;
  const crop = l.crop;
  const k = l.w / crop.sw;

  c.save();
  c.fillStyle = 'rgba(12,14,18,0.62)';
  c.fillRect(0, 0, state.w, state.h);

  inLayerSpace(c, l, () => {
    c.save();
    if (l.flip) c.scale(-1, 1);
    c.globalAlpha = 0.4;
    c.drawImage(a.img, -l.w / 2 - crop.sx * k, -l.h / 2 - crop.sy * k, a.w * k, a.h * k);
    c.restore();

    c.save();
    c.beginPath();
    c.rect(-l.w / 2, -l.h / 2, l.w, l.h);
    c.clip();
    if (l.flip) c.scale(-1, 1);
    c.drawImage(a.img, crop.sx, crop.sy, crop.sw, crop.sh, -l.w / 2, -l.h / 2, l.w, l.h);
    c.restore();

    // Framing guides.
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = Math.max(1, state.w / 900);
    c.beginPath();
    for (let i = 1; i < 3; i++) {
      c.moveTo(-l.w / 2 + (l.w * i) / 3, -l.h / 2);
      c.lineTo(-l.w / 2 + (l.w * i) / 3, l.h / 2);
      c.moveTo(-l.w / 2, -l.h / 2 + (l.h * i) / 3);
      c.lineTo(l.w / 2, -l.h / 2 + (l.h * i) / 3);
    }
    c.stroke();
  });
  c.restore();
}

/* -------------------------------------------------------- selection chrome */

function drawHandle(c, h, size) {
  c.beginPath();
  if (h.kind === 'rotate' || h.kind === 'tail') c.arc(h.x, h.y, size * 0.6, 0, Math.PI * 2);
  else c.rect(h.x - size / 2, h.y - size / 2, size, size);
  c.fillStyle = h.kind === 'tail' ? '#ffcc00' : ACCENT;
  c.fill();
  c.lineWidth = Math.max(1, size * 0.14);
  c.strokeStyle = '#ffffff';
  c.stroke();
}

function drawChrome(c) {
  const cropping = croppingLayer();
  const l = cropping || selected();
  if (!l) return;

  if (cropping) drawCropOverlay(c, cropping);

  const s = layerSize(l);
  c.save();
  c.strokeStyle = cropping ? '#ffcc00' : ACCENT;
  c.lineWidth = Math.max(2, state.w / 400);

  inLayerSpace(c, l, () => {
    if (!cropping) c.setLineDash([9, 6]);
    c.strokeRect(-s.w / 2, -s.h / 2, s.w, s.h);
  });

  if (!cropping) {
    const size = handleSize();
    const hs = handlesOf(l);
    const rotH = hs.find(h => h.kind === 'rotate');
    if (rotH) {
      const top = toWorld(l, { x: 0, y: -s.h / 2 });
      c.setLineDash([]);
      c.beginPath();
      c.moveTo(top.x, top.y);
      c.lineTo(rotH.x, rotH.y);
      c.stroke();
    }
    for (const h of hs) drawHandle(c, h, size);
  }
  c.restore();
}

/* ------------------------------------------------------------------ screen */

/** Letterbox the canvas into the stage. Done in JS so the on-screen size is
 *  always an exact multiple of the canvas aspect ratio. */
function fitToStage() {
  const pad = 40;
  const k = Math.min(
    (stage.clientWidth - pad) / state.w,
    (stage.clientHeight - pad) / state.h,
    1
  );
  canvas.style.width = Math.max(1, Math.round(state.w * k)) + 'px';
  canvas.style.height = Math.max(1, Math.round(state.h * k)) + 'px';
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  const pxW = Math.round(state.w * dpr);
  if (canvas.width !== pxW || canvas.height !== Math.round(state.h * dpr)) {
    canvas.width = pxW;
    canvas.height = Math.round(state.h * dpr);
  }
  fitToStage();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScene(ctx);
  drawChrome(ctx);
  hint.classList.toggle('hidden', state.layers.length > 0);
}

/** Render the document on its own canvas at `scale`, with no editing chrome. */
function renderToCanvas(scale) {
  const out = document.createElement('canvas');
  out.width = Math.round(state.w * scale);
  out.height = Math.round(state.h * scale);
  const c = out.getContext('2d');
  c.scale(scale, scale);
  drawScene(c);
  return out;
}
