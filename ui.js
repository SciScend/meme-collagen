/* ui.js — the side panel, the toolbar, importing, exporting, and boot. */

'use strict';

const el = id => document.getElementById(id);

const panels = {
  canvas: el('panel-canvas'),
  text: el('panel-text'),
  image: el('panel-image'),
  crop: el('panel-crop'),
};

const statusEl = el('status');
let statusTimer = null;

function setStatus(msg) {
  statusEl.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.textContent = 'Ready'; }, 4500);
}

/* ------------------------------------------------------------- selection */

function select(id) {
  if (state.cropId && state.cropId !== id) state.cropId = null;
  state.selectedId = id;
  syncPanel();
  render();
}

function enterCrop(id) {
  const l = layerById(id);
  if (!l || l.type !== 'image') return;
  state.selectedId = id;
  state.cropId = id;
  normalizeCrop(l);
  syncPanel();
  render();
  setStatus('Drag the picture to reposition it, scroll to zoom.');
}

function exitCrop() {
  state.cropId = null;
  syncPanel();
  render();
  commit();
}

/** Change the selected layer, redraw, and record an undo step. */
function edit(fn, immediate) {
  const l = selected();
  if (!l) return;
  fn(l);
  reflow(l);
  render();
  syncPanel();
  immediate ? commit() : debouncedCommit();
}

/* ------------------------------------------------------------ panel sync */

function syncPanel() {
  const l = selected();
  const kind = state.cropId ? 'crop' : l ? l.type : 'canvas';
  for (const [name, node] of Object.entries(panels)) {
    node.classList.toggle('hidden', name !== kind);
  }

  if (kind === 'canvas') {
    el('bg-color').value = state.bg;
    el('bg-value').textContent = state.bg;
    el('layout-gap').value = layoutGap.value;
    el('layout-gap-value').textContent = layoutGap.value + 'px';
    markActiveRatio();
    return;
  }

  if (kind === 'crop') {
    const z = Math.round(cropZoom(l) * 100);
    el('crop-zoom').value = clamp(z, 100, 400);
    el('crop-zoom-value').textContent = z + '%';
    return;
  }

  if (l.type === 'text') {
    if (document.activeElement !== el('text-content')) el('text-content').value = l.text;
    el('text-size').value = clamp(l.size, 10, 400);
    el('text-size-value').textContent = Math.round(l.size) + 'px';
    el('text-color').value = l.color;
    el('text-color-value').textContent = l.color;
    el('text-font').value = l.font;
    el('text-outline').value = clamp(l.strokeWidth, 0, 30);
    el('text-outline-value').textContent = Math.round(l.strokeWidth) + 'px';
    el('text-outline-color').value = l.stroke;
    el('text-upper').classList.toggle('active', l.upper);
    el('text-bold').classList.toggle('active', l.bold);
    el('text-rot').value = Math.round(l.rot || 0);
    el('text-rot-value').textContent = Math.round(l.rot || 0) + '°';

    const wrapping = l.boxW > 0;
    el('text-nowrap').checked = !wrapping;
    el('text-wrap').disabled = !wrapping;
    const pct = wrapping ? Math.round(l.boxW / state.w * 100) : 100;
    el('text-wrap').value = clamp(pct, 10, 100);
    el('text-wrap-value').textContent = wrapping ? pct + '%' : 'off';

    for (const chip of document.querySelectorAll('#align-chips .chip')) {
      chip.classList.toggle('active', chip.dataset.align === l.align);
    }
    el('text-bubble').classList.toggle('active', !!l.bubble);
    el('text-tail').classList.toggle('active', !!(l.bubble && l.bubble.tail));
    el('text-tail').disabled = !l.bubble;
    el('bubble-fill').value = l.bubble ? l.bubble.fill : '#ffffff';
    el('bubble-stroke').value = l.bubble ? l.bubble.stroke : '#111111';
    return;
  }

  const a = getAsset(l.assetId);
  const pct = a ? Math.round(l.w / a.w * 100) : 100;
  el('image-scale').value = clamp(pct, 5, 300);
  el('image-scale-value').textContent = pct + '%';
  el('image-rot').value = Math.round(l.rot || 0);
  el('image-rot-value').textContent = Math.round(l.rot || 0) + '°';
  el('image-border').value = clamp(l.border || 0, 0, 40);
  el('image-border-value').textContent = Math.round(l.border || 0) + 'px';
  el('image-border-color').value = l.borderColor || '#ffffff';
  el('image-flip').classList.toggle('active', !!l.flip);
}

function markActiveRatio() {
  for (const chip of document.querySelectorAll('#ratio-chips .chip')) {
    chip.classList.toggle('active', +chip.dataset.w === state.w && +chip.dataset.h === state.h);
  }
}

/* -------------------------------------------------------------- importing */

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(file);
  });
}

async function loadFiles(files) {
  const picked = [...files].filter(f => f.type.startsWith('image/'));
  if (!picked.length) return;
  setStatus(picked.length > 1 ? `Loading ${picked.length} images…` : 'Loading…');

  let added = 0;
  for (const file of picked) {
    try {
      const asset = await addAsset(await readAsDataURL(file));
      // The first picture on an empty canvas decides the canvas shape.
      if (!state.layers.length && !state.ratioLocked) {
        const k = Math.min(1400 / asset.w, 1400 / asset.h, 1);
        state.w = Math.round(asset.w * k);
        state.h = Math.round(asset.h * k);
      }
      select(addImageLayer(asset).id);
      added++;
    } catch {
      setStatus(`Could not read ${file.name}`);
    }
  }

  if (added > 1) applyLayout('grid');
  render();
  syncPanel();
  commit();
  if (added) setStatus(`Added ${added} image${added > 1 ? 's' : ''}`);
}

el('file-input').addEventListener('change', e => {
  loadFiles(e.target.files);
  e.target.value = '';
});

stage.addEventListener('dragover', e => {
  e.preventDefault();
  stage.classList.add('dragover');
});
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
stage.addEventListener('drop', e => {
  e.preventDefault();
  stage.classList.remove('dragover');
  loadFiles(e.dataTransfer.files);
});

window.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) loadFiles(files);
});

/* ------------------------------------------------------------------ fonts */

function rebuildFontSelect() {
  const sel = el('text-font');
  const keep = sel.value;
  sel.innerHTML = '';
  for (const f of fontList) {
    const o = document.createElement('option');
    o.value = f.css;
    o.textContent = f.label;
    sel.appendChild(o);
  }
  if (keep) sel.value = keep;
}

el('btn-upload-font').addEventListener('click', () => el('font-input').click());

el('font-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const css = await addCustomFont(file.name, await readAsDataURL(file));
    rebuildFontSelect();
    edit(l => { l.font = css; }, true);
    setStatus(`Loaded font ${file.name}`);
  } catch {
    setStatus('That font file could not be loaded.');
  }
});

/* ------------------------------------------------------------- text panel */

el('text-content').addEventListener('input', e => edit(l => { l.text = e.target.value; }));
el('text-size').addEventListener('input', e => edit(l => { l.size = +e.target.value; }));
el('text-color').addEventListener('input', e => edit(l => { l.color = e.target.value; }));
el('text-font').addEventListener('change', e => edit(l => { l.font = e.target.value; }, true));
el('text-outline').addEventListener('input', e => edit(l => { l.strokeWidth = +e.target.value; }));
el('text-outline-color').addEventListener('input', e => edit(l => { l.stroke = e.target.value; }));
el('text-upper').addEventListener('click', () => edit(l => { l.upper = !l.upper; }, true));
el('text-bold').addEventListener('click', () => edit(l => { l.bold = !l.bold; }, true));
el('text-rot').addEventListener('input', e => edit(l => { l.rot = +e.target.value; }));

el('text-wrap').addEventListener('input', e => edit(l => {
  l.boxW = Math.round(state.w * (+e.target.value / 100));
}));
el('text-nowrap').addEventListener('change', e => edit(l => {
  l.boxW = e.target.checked ? 0 : Math.round(state.w * 0.9);
}, true));

for (const chip of document.querySelectorAll('#align-chips .chip')) {
  chip.addEventListener('click', () => edit(l => { l.align = chip.dataset.align; }, true));
}

el('text-bubble').addEventListener('click', () => edit(l => {
  l.bubble = l.bubble ? null : { fill: '#ffffff', stroke: '#111111', tail: null };
  if (l.bubble && l.color === '#ffffff') l.color = '#111111';
  if (l.bubble) l.strokeWidth = 0;
}, true));

el('text-tail').addEventListener('click', () => edit(l => {
  if (!l.bubble) return;
  const s = layerSize(l);
  l.bubble.tail = l.bubble.tail ? null : { x: s.w * 0.1, y: s.h / 2 + s.h * 0.5 };
}, true));

el('bubble-fill').addEventListener('input', e => edit(l => {
  if (l.bubble) l.bubble.fill = e.target.value;
}));
el('bubble-stroke').addEventListener('input', e => edit(l => {
  if (l.bubble) l.bubble.stroke = e.target.value;
}));

const swatchBar = el('text-swatches');
for (const colour of ['#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffcc00',
                      '#34c759', '#4c8dff', '#af52de', '#ff2d94', '#8e8e93']) {
  const b = document.createElement('button');
  b.style.background = colour;
  b.title = colour;
  b.addEventListener('click', () => edit(l => { l.color = colour; }, true));
  swatchBar.appendChild(b);
}

/* ------------------------------------------------------------ image panel */

el('image-scale').addEventListener('input', e => edit(l => {
  const a = getAsset(l.assetId);
  if (!a) return;
  const k = +e.target.value / 100;
  const ratio = l.h / l.w;
  l.w = a.w * k;
  l.h = l.w * ratio;
}));
el('image-rot').addEventListener('input', e => edit(l => { l.rot = +e.target.value; }));
el('image-rot-left').addEventListener('click', () => edit(l => {
  l.rot = ((l.rot || 0) - 90 + 540) % 360 - 180;
}, true));
el('image-rot-right').addEventListener('click', () => edit(l => {
  l.rot = ((l.rot || 0) + 90 + 540) % 360 - 180;
}, true));
el('image-flip').addEventListener('click', () => edit(l => { l.flip = !l.flip; }, true));
el('image-border').addEventListener('input', e => edit(l => { l.border = +e.target.value; }));
el('image-border-color').addEventListener('input', e => edit(l => {
  l.borderColor = e.target.value;
}));

el('image-fit').addEventListener('click', () => edit(l => {
  const a = getAsset(l.assetId);
  if (!a) return;
  const k = Math.min(state.w / a.w, state.h / a.h) * 0.95;
  l.w = a.w * k;
  l.h = a.h * k;
  l.x = state.w / 2;
  l.y = state.h / 2;
  l.crop = { sx: 0, sy: 0, sw: a.w, sh: a.h };
}, true));

el('image-cover').addEventListener('click', () => edit(l => {
  l.rot = 0;
  placeInRect(l, 0, 0, state.w, state.h);
}, true));

el('btn-crop').addEventListener('click', () => {
  const l = selected();
  if (l) enterCrop(l.id);
});

el('crop-zoom').addEventListener('input', e => {
  const l = croppingLayer();
  if (!l) return;
  setCropZoom(l, +e.target.value / 100);
  el('crop-zoom-value').textContent = e.target.value + '%';
  render();
});
el('crop-reset').addEventListener('click', () => {
  const l = croppingLayer();
  if (!l) return;
  uncrop(l);
  normalizeCrop(l);
  syncPanel();
  render();
});
el('crop-done').addEventListener('click', exitCrop);

/* --------------------------------------------------------- layer actions */

for (const [prefix] of [['text'], ['image']]) {
  el(`${prefix}-front`).addEventListener('click', () => {
    if (reorderLayer(state.selectedId, 1)) { render(); commit(); }
  });
  el(`${prefix}-back`).addEventListener('click', () => {
    if (reorderLayer(state.selectedId, -1)) { render(); commit(); }
  });
  el(`${prefix}-dupe`).addEventListener('click', () => {
    const l = selected();
    if (l) { select(duplicateLayer(l).id); commit(); }
  });
  el(`${prefix}-delete`).addEventListener('click', () => {
    removeLayer(state.selectedId);
    select(null);
    commit();
  });
}

/* --------------------------------------------------------- canvas panel */

el('bg-color').addEventListener('input', e => {
  state.bg = e.target.value;
  el('bg-value').textContent = state.bg;
  render();
  debouncedCommit();
});

for (const chip of document.querySelectorAll('#ratio-chips .chip')) {
  chip.addEventListener('click', () => {
    state.ratioLocked = true;
    state.w = +chip.dataset.w;
    state.h = +chip.dataset.h;
    if (imageLayers().length) applyLayout('grid');
    markActiveRatio();
    render();
    commit();
  });
}

for (const chip of document.querySelectorAll('#layout-chips .chip')) {
  chip.addEventListener('click', () => {
    const n = applyLayout(chip.dataset.layout);
    render();
    commit();
    setStatus(n ? `Arranged ${n} image${n > 1 ? 's' : ''}` : 'Add some images first');
  });
}

el('layout-gap').addEventListener('input', e => {
  layoutGap.value = +e.target.value;
  el('layout-gap-value').textContent = layoutGap.value + 'px';
});

for (const chip of document.querySelectorAll('#template-chips .chip')) {
  chip.addEventListener('click', () => {
    const label = templates[chip.dataset.template]();
    select(state.layers[state.layers.length - 1].id);
    commit();
    setStatus(label + ' applied');
  });
}

const STICKERS = ['😂', '😍', '🤔', '😱', '😎', '🥲', '💀', '🔥', '💯', '👀',
                  '👍', '👎', '🙌', '🤡', '🐱', '🐶', '🍕', '☕', '⭐', '❤️',
                  '💩', '🎉', '⚡', '💡', '🚀', '🏆', '❓', '❗', '💬', '✅'];

const stickerGrid = el('sticker-grid');
for (const emoji of STICKERS) {
  const b = document.createElement('button');
  b.textContent = emoji;
  b.title = 'Add ' + emoji;
  b.addEventListener('click', () => {
    select(addSticker(emoji).id);
    commit();
  });
  stickerGrid.appendChild(b);
}

el('btn-clear').addEventListener('click', async () => {
  if (state.layers.length && !confirm('Remove every image and text box?')) return;
  state.layers = [];
  state.selectedId = null;
  state.cropId = null;
  await clearSaved();
  select(null);
  commit();
  setStatus('Cleared');
});

/* ------------------------------------------------------------- toolbar */

el('btn-add-image').addEventListener('click', () => el('file-input').click());
el('btn-add-text').addEventListener('click', () => {
  select(addTextLayer().id);
  commit();
  el('text-content').select();
});
el('btn-undo').addEventListener('click', undo);
el('btn-redo').addEventListener('click', redo);

el('btn-download').addEventListener('click', async () => {
  if (!state.layers.length) {
    setStatus('Nothing to export yet — add an image or some text first.');
    return;
  }
  await ensureFontsReady();
  const scale = +el('export-scale').value || 1;
  renderToCanvas(scale).toBlob(blob => {
    if (!blob) { setStatus('Export failed — try a smaller resolution.'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meme-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus(`Saved PNG at ${Math.round(state.w * scale)}×${Math.round(state.h * scale)}`);
  }, 'image/png');
});

window.addEventListener('resize', render);

/* ----------------------------------------------------------------- boot */

async function boot() {
  rebuildFontSelect();
  syncPanel();
  render();

  await ensureFontsReady();
  const mode = await initStorage();

  let restored = false;
  try {
    restored = await loadProject();
  } catch {
    restored = false;
  }

  historyInit();
  syncPanel();
  render();

  const note = el('storage-note');
  if (mode === 'none') {
    note.textContent = 'This browser blocks storage here, so work is not saved between visits.';
  } else if (mode === 'local') {
    note.textContent = 'Saved automatically in this browser (local storage).';
  }
  if (restored) setStatus('Restored your last session');
}

boot();
