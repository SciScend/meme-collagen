/* interact.js — mouse, touch and keyboard editing on the canvas.
 *
 * One finger drags/resizes/rotates; two fingers pinch to scale and rotate.
 * Every gesture ends with commit(), which is what creates an undo step. */

'use strict';

/** pointerId -> position in canvas coordinates */
const pointers = new Map();

let gesture = null;

function pointerPos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (state.w / r.width),
    y: (e.clientY - r.top) * (state.h / r.height),
  };
}

function centroidOf(pts) {
  const n = pts.length;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
}

/* ------------------------------------------------------------ gesture start */

function beginPinch() {
  const [a, b] = [...pointers.values()];
  const mid = centroidOf([a, b]);
  // Fingers rarely land exactly on the layer, so fall back to whatever is under
  // the pinch — otherwise the first touch would just deselect everything.
  const l = croppingLayer() || selected() || layerAt(mid) || layerAt(a) || layerAt(b);
  if (!l) return;
  if (!state.cropId && state.selectedId !== l.id) select(l.id);
  gesture = {
    mode: 'pinch',
    id: l.id,
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    angle: Math.atan2(b.y - a.y, b.x - a.x) / DEG,
    mid,
    start: { x: l.x, y: l.y, w: l.w, h: l.h, size: l.size, boxW: l.boxW, rot: l.rot || 0 },
  };
}

function beginSingle(e, p) {
  const cropping = croppingLayer();

  if (cropping) {
    if (hitTest(cropping, p)) {
      gesture = { mode: 'croppan', id: cropping.id, last: p };
    }
    return;
  }

  const sel = selected();
  if (sel) {
    const h = handleAt(sel, p);
    if (h) {
      const local = toLocal(sel, p);
      gesture = {
        mode: h.kind,
        id: sel.id,
        handle: h.name,
        startDist: Math.hypot(local.x, local.y) || 1,
        startAngle: Math.atan2(p.y - sel.y, p.x - sel.x) / DEG,
        start: { w: sel.w, h: sel.h, size: sel.size, boxW: sel.boxW, rot: sel.rot || 0 },
      };
      return;
    }
  }

  const hit = layerAt(p);
  select(hit ? hit.id : null);
  if (hit) gesture = { mode: 'move', id: hit.id, dx: p.x - hit.x, dy: p.y - hit.y };
}

/** Pointer capture keeps a drag alive outside the canvas, but browsers throw if
 *  the pointer is already gone — never let that abort the gesture. */
function capturePointer(id, on) {
  try {
    if (on) canvas.setPointerCapture(id);
    else if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  } catch { /* not capturable; dragging still works */ }
}

canvas.addEventListener('pointerdown', e => {
  capturePointer(e.pointerId, true);
  pointers.set(e.pointerId, pointerPos(e));

  if (pointers.size === 2) beginPinch();
  else if (pointers.size === 1) beginSingle(e, pointers.get(e.pointerId));
});

/* ------------------------------------------------------------ gesture move */

function applyPinch(l) {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return;
  const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const angle = Math.atan2(b.y - a.y, b.x - a.x) / DEG;
  const mid = centroidOf([a, b]);
  const k = clamp(dist / gesture.dist, 0.05, 20);

  l.rot = gesture.start.rot + (angle - gesture.angle);
  l.x = gesture.start.x + (mid.x - gesture.mid.x);
  l.y = gesture.start.y + (mid.y - gesture.mid.y);
  unpin(l);

  if (l.type === 'image') {
    l.w = Math.max(20, gesture.start.w * k);
    l.h = Math.max(20, gesture.start.h * k);
  } else {
    l.size = clamp(Math.round(gesture.start.size * k), 8, 600);
    if (gesture.start.boxW > 0) l.boxW = Math.max(20, gesture.start.boxW * k);
  }
}

function applyScale(l, p) {
  const local = toLocal(l, p);
  const k = clamp((Math.hypot(local.x, local.y) || 1) / gesture.startDist, 0.05, 20);
  if (l.type === 'image') {
    l.w = Math.max(20, gesture.start.w * k);
    l.h = Math.max(20, gesture.start.h * k);
  } else {
    l.size = clamp(Math.round(gesture.start.size * k), 8, 600);
    if (gesture.start.boxW > 0) l.boxW = Math.max(20, gesture.start.boxW * k);
  }
}

function applyRotate(l, p, shift) {
  const angle = Math.atan2(p.y - l.y, p.x - l.x) / DEG;
  let rot = gesture.start.rot + (angle - gesture.startAngle);
  const snap = shift ? 15 : 0;
  if (snap) rot = Math.round(rot / snap) * snap;
  else if (Math.abs(rot % 90) < 2.5) rot = Math.round(rot / 90) * 90;  // gentle magnet
  l.rot = ((rot + 180) % 360 + 360) % 360 - 180;
}

function applyCropPan(l, p) {
  const a = getAsset(l.assetId);
  if (!a) return;
  const d = { x: p.x - gesture.last.x, y: p.y - gesture.last.y };
  const ang = -(l.rot || 0) * DEG;
  let lx = d.x * Math.cos(ang) - d.y * Math.sin(ang);
  const ly = d.x * Math.sin(ang) + d.y * Math.cos(ang);
  if (l.flip) lx = -lx;   // a mirrored picture pans the other way
  l.crop.sx = clamp(l.crop.sx - lx * (l.crop.sw / l.w), 0, Math.max(0, a.w - l.crop.sw));
  l.crop.sy = clamp(l.crop.sy - ly * (l.crop.sh / l.h), 0, Math.max(0, a.h - l.crop.sh));
  gesture.last = p;
}

canvas.addEventListener('pointermove', e => {
  const p = pointerPos(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

  if (!gesture) {
    updateCursor(p);
    return;
  }

  const l = layerById(gesture.id);
  if (!l) return;

  switch (gesture.mode) {
    case 'pinch': applyPinch(l); break;
    case 'move': l.x = p.x - gesture.dx; l.y = p.y - gesture.dy; unpin(l); break;
    case 'scale': applyScale(l, p); break;
    case 'rotate': applyRotate(l, p, e.shiftKey); break;
    case 'width': {
      const local = toLocal(l, p);
      l.boxW = Math.max(30, Math.abs(local.x) * 2 - textPad(l) * 2);
      break;
    }
    case 'tail': l.bubble.tail = toLocal(l, p); break;
    case 'croppan': applyCropPan(l, p); break;
  }

  if (gesture.mode === 'scale' || gesture.mode === 'width') reflow(l);
  render();
  syncPanel();
});

function updateCursor(p) {
  if (croppingLayer()) {
    canvas.style.cursor = hitTest(croppingLayer(), p) ? 'grab' : 'default';
    return;
  }
  const sel = selected();
  const h = sel && handleAt(sel, p);
  canvas.style.cursor = h
    ? (h.kind === 'rotate' ? 'grab' : h.kind === 'width' ? 'ew-resize' : 'nwse-resize')
    : layerAt(p) ? 'move' : 'default';
}

/* ------------------------------------------------------------- gesture end */

function endPointer(e) {
  pointers.delete(e.pointerId);
  capturePointer(e.pointerId, false);
  if (gesture && pointers.size === 0) {
    gesture = null;
    commit();
  } else if (gesture && gesture.mode === 'pinch' && pointers.size < 2) {
    gesture = null;
    commit();
  }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('dblclick', e => {
  const p = pointerPos(e);
  if (croppingLayer()) { exitCrop(); return; }
  const l = layerAt(p);
  if (!l) return;
  select(l.id);
  if (l.type === 'text') document.getElementById('text-content').select();
  else enterCrop(l.id);
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

/* Wheel: zoom the crop while cropping, otherwise resize the selection. */
canvas.addEventListener('wheel', e => {
  const cropping = croppingLayer();
  const l = cropping || selected();
  if (!l) return;
  e.preventDefault();
  const k = e.deltaY < 0 ? 1.06 : 1 / 1.06;

  if (cropping) {
    setCropZoom(l, cropZoom(l) * k);
  } else if (l.type === 'image') {
    l.w = Math.max(20, l.w * k);
    l.h = Math.max(20, l.h * k);
  } else {
    l.size = clamp(Math.round(l.size * k), 8, 600);
    if (l.boxW > 0) l.boxW = Math.max(20, l.boxW * k);
    reflow(l);
  }
  render();
  syncPanel();
  debouncedCommit();
}, { passive: false });

let commitTimer = null;
function debouncedCommit() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(commit, 400);
}

/* --------------------------------------------------------------- keyboard */

window.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if (e.key === 'Escape') {
    if (croppingLayer()) exitCrop();
    else select(null);
    return;
  }
  if (typing) return;

  const l = selected();
  if (mod && e.key.toLowerCase() === 'd' && l) {
    e.preventDefault();
    select(duplicateLayer(l).id);
    commit();
    return;
  }
  if (!l) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    removeLayer(l.id);
    select(null);
    commit();
  } else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? 20 : 2;
    if (e.key === 'ArrowLeft') l.x -= step;
    if (e.key === 'ArrowRight') l.x += step;
    if (e.key === 'ArrowUp') l.y -= step;
    if (e.key === 'ArrowDown') l.y += step;
    unpin(l);
    render();
    debouncedCommit();
  } else if (e.key === '[' || e.key === ']') {
    if (reorderLayer(l.id, e.key === ']' ? 1 : -1)) {
      render();
      commit();
    }
  }
});
