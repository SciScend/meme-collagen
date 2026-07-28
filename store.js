/* store.js — assets (images + fonts), autosave, and the undo/redo history.
 *
 * Layers never hold an <img>; they hold an assetId. Everything about a project
 * is therefore plain JSON, which is what makes undo and autosave cheap. */

'use strict';

/* ------------------------------------------------------------------ assets */

/** assetId -> {id, dataURL, img, w, h} */
const assetMap = new Map();

/** Imported pictures are capped at this size on the long edge. Keeps autosave
 *  under the browser's storage quota and keeps rendering fast. */
const MAX_IMPORT_PX = 1600;

let assetSeq = 1;

/** Decode a data URL into an <img>. */
function decodeImage(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode image'));
    img.src = dataURL;
  });
}

/** Shrink oversized imports; leaves small pictures byte-for-byte alone. */
function downscale(img, dataURL) {
  const long = Math.max(img.width, img.height);
  if (long <= MAX_IMPORT_PX && dataURL.length < 900e3) return { dataURL, img };

  const k = Math.min(MAX_IMPORT_PX / long, 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  const cx = c.getContext('2d');
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(img, 0, 0, c.width, c.height);
  // PNG keeps transparency; JPEG is dramatically smaller for photos.
  const hasAlpha = /^data:image\/(png|webp|gif)/.test(dataURL);
  return { dataURL: c.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', 0.88) };
}

/** Register a picture and return its asset record (decoding/shrinking first). */
async function addAsset(dataURL, id) {
  let img = await decodeImage(dataURL);
  if (!id) {
    const small = downscale(img, dataURL);
    if (small.dataURL !== dataURL) {
      dataURL = small.dataURL;
      img = small.img || await decodeImage(dataURL);
    }
  }
  const asset = {
    id: id || 'a' + assetSeq++,
    dataURL,
    img,
    w: img.naturalWidth,
    h: img.naturalHeight,
  };
  assetMap.set(asset.id, asset);
  if (id) assetSeq = Math.max(assetSeq, (parseInt(id.slice(1), 10) || 0) + 1);
  return asset;
}

function getAsset(id) {
  return assetMap.get(id) || null;
}

/* ------------------------------------------------------------------- fonts */

/** Fonts offered in the dropdown. `custom` entries carry a dataURL so they can
 *  be restored from the saved project. */
const fontList = [
  { label: 'Anton (meme classic)', css: '"Anton", Impact, "Arial Narrow Bold", sans-serif' },
  { label: 'Oswald (Cyrillic too)', css: '"Oswald", Impact, sans-serif' },
  { label: 'Impact', css: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' },
  { label: 'Arial Black', css: '"Arial Black", Arial, sans-serif' },
  { label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
  { label: 'Comic Sans', css: '"Comic Sans MS", "Comic Neue", cursive' },
  { label: 'Courier New', css: '"Courier New", monospace' },
];

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** custom font family name -> dataURL (persisted with the project) */
const customFonts = new Map();

async function addCustomFont(name, dataURL) {
  const family = name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, '').replace(/["']/g, '');
  const face = new FontFace(family, `url(${dataURL})`);
  await face.load();
  document.fonts.add(face);
  customFonts.set(family, dataURL);
  const css = `"${family}", sans-serif`;
  if (!fontList.some(f => f.css === css)) {
    fontList.push({ label: family + ' (yours)', css, custom: true });
  }
  return css;
}

/** Make sure every font a project uses is measurable before we lay text out. */
async function ensureFontsReady() {
  const sizes = ['64px'];
  const jobs = [];
  for (const f of fontList) {
    for (const s of sizes) jobs.push(document.fonts.load(`${s} ${f.css}`).catch(() => {}));
    jobs.push(document.fonts.load(`bold ${sizes[0]} ${f.css}`).catch(() => {}));
  }
  await Promise.all(jobs);
  await document.fonts.ready;
}

/* ----------------------------------------------------------------- storage */

/* IndexedDB is preferred (roomy), but Chrome forbids it on file:// URLs, so we
 * fall back to localStorage and finally to "this session only". */

const DB_NAME = 'meme-collage';
const STORE_NAME = 'projects';
const SAVE_KEY = 'meme-collage:current';

const storage = {
  mode: 'pending',   // 'idb' | 'local' | 'none'
  db: null,
};

function openDB() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (err) {
      reject(err);
      return;
    }
    if (!req) { reject(new Error('no indexedDB')); return; }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB blocked'));
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

async function initStorage() {
  try {
    storage.db = await openDB();
    storage.mode = 'idb';
  } catch {
    try {
      localStorage.setItem(SAVE_KEY + ':probe', '1');
      localStorage.removeItem(SAVE_KEY + ':probe');
      storage.mode = 'local';
    } catch {
      storage.mode = 'none';
    }
  }
  return storage.mode;
}

function idbPut(value) {
  return new Promise((resolve, reject) => {
    const tx = storage.db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, 'current');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function idbGet() {
  return new Promise((resolve, reject) => {
    const tx = storage.db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get('current');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/** Everything needed to rebuild the editor from scratch. */
function serializeProject() {
  const usedAssets = new Set(state.layers.filter(l => l.type === 'image').map(l => l.assetId));
  return {
    version: 2,
    project: snapshot(),
    assets: [...assetMap.values()]
      .filter(a => usedAssets.has(a.id))
      .map(a => ({ id: a.id, dataURL: a.dataURL })),
    fonts: [...customFonts].map(([family, dataURL]) => ({ family, dataURL })),
    savedAt: Date.now(),
  };
}

let saveTimer = null;
let saveWarned = false;

function scheduleSave() {
  if (storage.mode === 'none' || storage.mode === 'pending') return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, 700);
}

async function saveProject() {
  if (storage.mode === 'none' || storage.mode === 'pending') return;
  const payload = serializeProject();
  try {
    if (storage.mode === 'idb') {
      await idbPut(payload);
    } else {
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    }
    saveWarned = false;
  } catch (err) {
    if (!saveWarned) {
      saveWarned = true;
      setStatus('Too large to autosave — download your PNG to keep it.');
    }
  }
}

async function clearSaved() {
  try {
    if (storage.mode === 'idb') await idbPut(null);
    else if (storage.mode === 'local') localStorage.removeItem(SAVE_KEY);
  } catch { /* nothing worth reporting */ }
}

/** Rebuild the last session. Returns true if anything was restored. */
async function loadProject() {
  let payload = null;
  try {
    payload = storage.mode === 'idb' ? await idbGet()
      : storage.mode === 'local' ? JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')
      : null;
  } catch { return false; }

  if (!payload || !payload.project) return false;

  for (const f of payload.fonts || []) {
    try { await addCustomFont(f.family, f.dataURL); } catch { /* skip broken font */ }
  }
  for (const a of payload.assets || []) {
    try { await addAsset(a.dataURL, a.id); } catch { /* skip broken image */ }
  }

  // Drop layers whose picture failed to come back.
  const parsed = JSON.parse(payload.project);
  parsed.layers = parsed.layers.filter(l => l.type !== 'image' || assetMap.has(l.assetId));
  restoreSnapshot(JSON.stringify(parsed));
  return state.layers.length > 0;
}

/* ------------------------------------------------------------ undo history */

const HISTORY_LIMIT = 80;

const histState = {
  past: [],
  future: [],
  current: null,
};

/** A snapshot is just the JSON of the document — assets live outside it. */
function snapshot() {
  return JSON.stringify({
    w: state.w,
    h: state.h,
    bg: state.bg,
    nextId: state.nextId,
    ratioLocked: state.ratioLocked,
    layers: state.layers,
  });
}

function restoreSnapshot(json) {
  const o = JSON.parse(json);
  state.w = o.w;
  state.h = o.h;
  state.bg = o.bg;
  state.nextId = o.nextId;
  state.ratioLocked = !!o.ratioLocked;
  state.layers = o.layers;
  if (!state.layers.some(l => l.id === state.selectedId)) state.selectedId = null;
  state.cropId = null;
}

function historyInit() {
  histState.current = snapshot();
  histState.past.length = 0;
  histState.future.length = 0;
  updateHistoryButtons();
}

/** Record the current document as one undo step. Cheap no-op if nothing moved. */
function commit() {
  const now = snapshot();
  if (now === histState.current) return;
  histState.past.push(histState.current);
  if (histState.past.length > HISTORY_LIMIT) histState.past.shift();
  histState.future.length = 0;
  histState.current = now;
  updateHistoryButtons();
  scheduleSave();
}

function undo() {
  if (!histState.past.length) return;
  histState.future.push(histState.current);
  histState.current = histState.past.pop();
  restoreSnapshot(histState.current);
  afterHistoryMove('Undo');
}

function redo() {
  if (!histState.future.length) return;
  histState.past.push(histState.current);
  histState.current = histState.future.pop();
  restoreSnapshot(histState.current);
  afterHistoryMove('Redo');
}

function afterHistoryMove(label) {
  updateHistoryButtons();
  syncPanel();
  render();
  scheduleSave();
  setStatus(label);
}

function updateHistoryButtons() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = !histState.past.length;
  if (r) r.disabled = !histState.future.length;
}
