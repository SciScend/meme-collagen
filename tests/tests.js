/* Headless test suite. Loaded after ui.js; drives the real UI. */
'use strict';

const results = [];
const pre = document.createElement('pre');
pre.id = 'results';
document.addEventListener('DOMContentLoaded', () => document.body.appendChild(pre));
function flush() { pre.textContent = results.join('\n'); }
function ok(name, cond, extra) {
  results.push((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || extra === undefined ? '' : '  -> ' + extra));
  flush();
}
function mark(m) { results.push('....  ' + m); flush(); }
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 0.75 : tol); }

function makeImage(w, h, color) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, w, h);
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, w / 2, h / 2);
  return c.toDataURL('image/png');
}

function fileFromDataURL(dataURL, name) {
  const [head, b64] = dataURL.split(',');
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

/* pointer helpers -------------------------------------------------------- */

function clientOf(p) {
  const r = canvas.getBoundingClientRect();
  return { clientX: r.left + p.x * (r.width / state.w), clientY: r.top + p.y * (r.height / state.h) };
}
function pev(type, p, id, extra) {
  canvas.dispatchEvent(new PointerEvent(type, Object.assign(
    { bubbles: true, pointerId: id || 1, isPrimary: (id || 1) === 1 }, clientOf(p), extra || {})));
}
function dragPointer(from, to, extra) {
  pev('pointerdown', from, 1, extra);
  pev('pointermove', to, 1, extra);
  pev('pointerup', to, 1, extra);
}
function pinch(a0, b0, a1, b1) {
  pev('pointerdown', a0, 1);
  pev('pointerdown', b0, 2);
  pev('pointermove', a1, 1);
  pev('pointermove', b1, 2);
  pev('pointerup', a1, 1);
  pev('pointerup', b1, 2);
}
function key(k, opts) {
  window.dispatchEvent(new KeyboardEvent('keydown', Object.assign(
    { key: k, bubbles: true, cancelable: true }, opts || {})));
}

/* pixel helper ----------------------------------------------------------- */

function exportPixels(scale) {
  const out = renderToCanvas(scale || 1);
  return { c: out, ctx: out.getContext('2d') };
}
function countColor(imgData, pred) {
  let n = 0;
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) if (pred(d[i], d[i + 1], d[i + 2], d[i + 3])) n++;
  return n;
}

/* ------------------------------------------------------------------ tests */

async function runTests() {
  await ensureFontsReady();

  // --- 0. bundled fonts
  mark('section 0');
  ok('bundled font Anton is available', document.fonts.check('64px Anton'));
  ok('bundled font Oswald is available', document.fonts.check('bold 64px Oswald'));

  // --- 1. import images through the real file pipeline
  mark('section 1');
  state.ratioLocked = true;
  state.w = 1000; state.h = 1000;
  const files = [
    fileFromDataURL(makeImage(800, 400, '#c0392b'), 'a.png'),
    fileFromDataURL(makeImage(400, 800, '#2980b9'), 'b.png'),
    fileFromDataURL(makeImage(600, 600, '#27ae60'), 'c.png'),
  ];
  await loadFiles(files);
  ok('three images imported', imageLayers().length === 3, imageLayers().length);
  ok('assets registered', assetMap.size >= 3, assetMap.size);

  // --- 2. collage layouts
  mark('section 2');
  layoutGap.value = 10;
  applyLayout('grid');
  const gridRects = layoutRects('grid', 3, 10);
  const first = imageLayers()[0];
  ok('grid places image at cell centre',
     near(first.x, gridRects[0].x + gridRects[0].w / 2) && near(first.y, gridRects[0].y + gridRects[0].h / 2),
     `${first.x},${first.y}`);
  ok('grid cell is filled exactly', near(first.w, gridRects[0].w) && near(first.h, gridRects[0].h));
  ok('crop matches frame aspect (cover, no squash)',
     near(first.crop.sw / first.crop.sh, first.w / first.h, 0.01),
     (first.crop.sw / first.crop.sh).toFixed(3) + ' vs ' + (first.w / first.h).toFixed(3));
  const a0 = getAsset(first.assetId);
  ok('crop stays inside the source image',
     first.crop.sx >= -0.01 && first.crop.sy >= -0.01 &&
     first.crop.sx + first.crop.sw <= a0.w + 0.01 &&
     first.crop.sy + first.crop.sh <= a0.h + 0.01);

  for (const name of ['rows', 'cols', 'feature', 'strip', 'grid']) {
    const n = applyLayout(name);
    const insideCanvas = imageLayers().every(l =>
      l.x - l.w / 2 >= -1 && l.y - l.h / 2 >= -1 &&
      l.x + l.w / 2 <= state.w + 1 && l.y + l.h / 2 <= state.h + 1);
    ok(`layout "${name}" keeps images on canvas (${n})`, insideCanvas);
  }

  // Regression: re-running layouts must not zoom the crop in a little further
  // each time (normalizeCrop only ever shrinks; placeInRect must use cover).
  applyLayout('grid');
  const cropA = { ...imageLayers()[0].crop };
  applyLayout('cols');
  applyLayout('grid');
  const cropB = imageLayers()[0].crop;
  ok('repeating layouts does not creep the crop inwards',
     near(cropA.sw, cropB.sw, 0.5) && near(cropA.sh, cropB.sh, 0.5),
     `${cropA.sw.toFixed(1)}x${cropA.sh.toFixed(1)} -> ${cropB.sw.toFixed(1)}x${cropB.sh.toFixed(1)}`);
  const aa = getAsset(imageLayers()[0].assetId);
  const tgt = imageLayers()[0].w / imageLayers()[0].h;
  ok('layout crop uses the largest area the frame can show',
     near(cropB.sw, Math.min(aa.w, aa.h * tgt), 0.5), cropB.sw);

  // --- 3. undo / redo
  mark('section 3');
  applyLayout('grid');
  commit();
  const beforeUndo = imageLayers()[0].x;
  applyLayout('cols');
  commit();
  const afterLayout = imageLayers()[0].x;
  ok('layout change moved the image', !near(beforeUndo, afterLayout));
  undo();
  ok('undo restores position', near(imageLayers()[0].x, beforeUndo), imageLayers()[0].x);
  redo();
  ok('redo re-applies position', near(imageLayers()[0].x, afterLayout));
  undo();

  const countBefore = state.layers.length;
  select(addTextLayer().id);
  commit();
  ok('text layer added', state.layers.length === countBefore + 1);
  undo();
  ok('undo removes the new text layer', state.layers.length === countBefore, state.layers.length);
  redo();
  ok('redo brings the text layer back', state.layers.length === countBefore + 1);

  const deep = state.layers.length;
  for (let i = 0; i < 5; i++) { addSticker('⭐'); commit(); }
  for (let i = 0; i < 5; i++) undo();
  ok('five-step undo chain works', state.layers.length === deep, state.layers.length);
  ok('redo button is enabled after undo', document.getElementById('btn-redo').disabled === false);

  // --- 4. text wrapping + alignment
  mark('section 4');
  const t = selected() && selected().type === 'text' ? selected() : addTextLayer();
  select(t.id);
  t.text = 'wrapping should break this long sentence into several separate lines';
  t.upper = false;
  t.size = 60;
  t.boxW = 400;
  let lay = layoutText(t);
  ok('text wraps into multiple lines', lay.lines.length > 1, lay.lines.length);
  measureCtx.font = fontString(t);
  const widest = Math.max(...lay.lines.map(s => measureCtx.measureText(s).width));
  ok('no wrapped line exceeds the box', widest <= t.boxW + 0.5, widest.toFixed(1) + ' > ' + t.boxW);

  t.text = 'Supercalifragilisticexpialidocious';
  t.boxW = 150;
  lay = layoutText(t);
  measureCtx.font = fontString(t);
  const widest2 = Math.max(...lay.lines.map(s => measureCtx.measureText(s).width));
  ok('an unbreakable word is split to fit', widest2 <= t.boxW + 0.5, widest2.toFixed(1));

  t.boxW = 0;
  ok('wrapping off gives a single line', layoutText(t).lines.length === 1);
  t.text = 'line one\nline two';
  ok('explicit newlines still split', layoutText(t).lines.length === 2);

  // Alignment: isolate one text layer on a plain background and find the
  // left-most inked pixel for each alignment.
  const keep = state.layers.slice();
  state.layers = [];
  const at = defaultText({ text: 'align me', upper: false, boxW: 600, size: 60,
                           color: '#ff0000', strokeWidth: 0, x: 500, y: 500 });
  const bgKeep = state.bg;
  state.bg = '#ffffff';
  const inkLeft = () => {
    const d = exportPixels(1).ctx.getImageData(0, 0, state.w, state.h).data;
    for (let x = 0; x < state.w; x++) {
      for (let y = 400; y < 600; y++) {
        const i = (y * state.w + x) * 4;
        if (d[i] > 150 && d[i + 1] < 90 && d[i + 2] < 90) return x;
      }
    }
    return -1;
  };
  const widths = {};
  for (const al of ['left', 'center', 'right']) { at.align = al; widths[al] = inkLeft(); }
  const box = { lo: 500 - at.boxW / 2, hi: 500 + at.boxW / 2 };
  ok('left align starts at the left edge of the box',
     widths.left >= box.lo - 2 && widths.left < box.lo + 40, JSON.stringify(widths));
  ok('alignment order is left < centre < right',
     widths.left < widths.center && widths.center < widths.right, JSON.stringify(widths));
  ok('right-aligned text ends at the right edge of the box',
     widths.right > box.lo + 100, JSON.stringify(widths));
  state.layers = keep;
  state.bg = bgKeep;

  // --- 5. rotation + hit testing in rotated space
  mark('section 5');
  const r = addTextLayer();
  select(r.id);
  r.text = 'ROTATE'; r.boxW = 0; r.x = 500; r.y = 500; r.rot = 0;
  const size = layerSize(r);
  const rightEdge = { x: r.x + size.w / 2 - 4, y: r.y };
  const aboveTop = { x: r.x, y: r.y - size.h / 2 - 6 };
  ok('hit test inside unrotated box', hitTest(r, rightEdge));
  ok('hit test outside unrotated box', !hitTest(r, aboveTop));
  r.rot = 90;
  ok('after 90deg the old right edge is outside', !hitTest(r, rightEdge));
  ok('after 90deg the point above is inside', hitTest(r, aboveTop));
  r.rot = 0;

  // --- 6. dragging, corner scaling, rotation handle, pinch
  mark('section 6');
  const img = imageLayers()[0];
  select(img.id);
  applyLayout('grid');
  img.rot = 0;
  const sx = img.x, sy = img.y;
  dragPointer({ x: img.x, y: img.y }, { x: img.x + 60, y: img.y + 40 });
  ok('drag moves by the cursor delta', near(img.x - sx, 60) && near(img.y - sy, 40),
     `${(img.x - sx).toFixed(1)},${(img.y - sy).toFixed(1)}`);

  select(img.id);
  const wBefore = img.w, hBefore = img.h;
  const corner = handlesOf(img).find(h => h.name === 'se');
  const centre = { x: img.x, y: img.y };
  const far = { x: centre.x + (corner.x - centre.x) * 2, y: centre.y + (corner.y - centre.y) * 2 };
  dragPointer(corner, far);
  ok('corner handle scales x2', near(img.w / wBefore, 2, 0.05) && near(img.h / hBefore, 2, 0.05),
     (img.w / wBefore).toFixed(3));

  const rotHandle = handlesOf(img).find(h => h.kind === 'rotate');
  dragPointer(rotHandle, { x: img.x + 200, y: img.y });
  ok('rotation handle rotates to ~90deg', near(Math.abs(img.rot), 90, 3), img.rot);
  img.rot = 0;

  // Pinch, on an isolated layer so the fingers can only land on it.
  const keep6 = state.layers.slice();
  state.layers = [];
  const txt = defaultText({ text: 'PINCH ME', boxW: 0, size: 60, x: 500, y: 500, rot: 0 });
  select(txt.id);
  ok('pinch target is under both fingers', hitTest(txt, { x: 400, y: 500 }) && hitTest(txt, { x: 600, y: 500 }));
  const sizeBefore = txt.size;
  pinch({ x: 400, y: 500 }, { x: 600, y: 500 }, { x: 300, y: 500 }, { x: 700, y: 500 });
  ok('two-finger pinch scales text ~x2', near(txt.size / sizeBefore, 2, 0.15), txt.size / sizeBefore);
  txt.rot = 0;
  pinch({ x: 400, y: 500 }, { x: 600, y: 500 }, { x: 500, y: 400 }, { x: 500, y: 600 });
  ok('two-finger twist rotates ~90deg', near(Math.abs(txt.rot), 90, 5), txt.rot);

  // A pinch that starts on empty canvas should still grab the layer under it.
  txt.rot = 0; txt.size = 60;
  select(null);
  pinch({ x: 500, y: 60 }, { x: 500, y: 940 }, { x: 500, y: 30 }, { x: 500, y: 970 });
  ok('pinch with no prior selection grabs the layer under the fingers',
     state.selectedId === txt.id && txt.size > 60, `${state.selectedId} size=${txt.size}`);

  // Pinch drags the layer with the fingers' midpoint.
  txt.rot = 0; txt.size = 60; txt.x = 500; txt.y = 500;
  select(txt.id);
  pinch({ x: 450, y: 500 }, { x: 550, y: 500 }, { x: 550, y: 600 }, { x: 650, y: 600 });
  ok('pinch also pans the layer', near(txt.x, 600, 2) && near(txt.y, 600, 2), `${txt.x},${txt.y}`);

  state.layers = keep6;
  select(null);

  // --- 7. cropping
  mark('section 7');
  const ci = imageLayers()[1];
  select(ci.id);
  ci.rot = 0;
  placeInRect(ci, 100, 100, 400, 200);
  enterCrop(ci.id);
  ok('crop mode shows the crop panel', !document.getElementById('panel-crop').classList.contains('hidden'));
  const z1 = cropZoom(ci);
  setCropZoom(ci, 2);
  ok('zoom shrinks the crop window', cropZoom(ci) > z1 && ci.crop.sw < getAsset(ci.assetId).w);
  ok('crop keeps frame aspect while zooming', near(ci.crop.sw / ci.crop.sh, ci.w / ci.h, 0.01));
  const sxBefore = ci.crop.sx;
  dragPointer({ x: ci.x, y: ci.y }, { x: ci.x - 50, y: ci.y });
  ok('dragging pans the crop window', ci.crop.sx > sxBefore, `${sxBefore} -> ${ci.crop.sx}`);
  ok('pan is clamped inside the source', ci.crop.sx + ci.crop.sw <= getAsset(ci.assetId).w + 0.01);
  exitCrop();
  ok('crop mode exits', state.cropId === null);
  uncrop(ci);
  ok('reset crop shows the whole picture',
     ci.crop.sx === 0 && ci.crop.sy === 0 && ci.crop.sw === getAsset(ci.assetId).w);

  // --- 8. speech bubble + stickers
  mark('section 8');
  const b = addTextLayer();
  select(b.id);
  b.text = 'hello'; b.boxW = 0; b.x = 500; b.y = 300;
  b.bubble = { fill: '#ff00ff', stroke: '#000000', tail: null };
  b.color = '#000000'; b.strokeWidth = 0;
  const noTail = layerSize(b);
  b.bubble.tail = { x: 20, y: noTail.h / 2 + 120 };
  const e8 = exportPixels(1);
  const magenta = countColor(e8.ctx.getImageData(0, 0, state.w, state.h),
                             (r2, g2, b2, a2) => r2 > 200 && g2 < 60 && b2 > 200 && a2 === 255);
  ok('bubble fill is painted', magenta > 500, magenta);
  const tailWorld = toWorld(b, b.bubble.tail);
  const tailPixel = e8.ctx.getImageData(Math.round(tailWorld.x), Math.round(tailWorld.y - 8), 1, 1).data;
  ok('bubble tail reaches its handle point',
     (tailPixel[0] > 150 && tailPixel[2] > 150) || tailPixel[0] < 60,
     [...tailPixel].join(','));
  ok('bubble tail handle is exposed for dragging', handlesOf(b).some(h => h.kind === 'tail'));

  const stickerCount = state.layers.length;
  const st = addSticker('🔥');
  ok('sticker added as its own layer', state.layers.length === stickerCount + 1 && st.sticker === true);
  ok('sticker has no outline', st.strokeWidth === 0);

  // --- 9. export
  mark('section 9');
  await ensureFontsReady();
  const out2 = renderToCanvas(2);
  ok('2x export doubles the pixels', out2.width === state.w * 2 && out2.height === state.h * 2,
     `${out2.width}x${out2.height}`);
  ok('export paints the background', out2.getContext('2d').getImageData(1, 1, 1, 1).data[3] === 255);
  const blob = await new Promise(res => out2.toBlob(res, 'image/png'));
  ok('export produces a PNG blob', blob && blob.type === 'image/png' && blob.size > 2000, blob && blob.size);
  const chromeFree = renderToCanvas(1).getContext('2d').getImageData(0, 0, state.w, state.h);
  const accentPixels = countColor(chromeFree, (r2, g2, b2) =>
    Math.abs(r2 - 0x4c) < 6 && Math.abs(g2 - 0x8d) < 6 && Math.abs(b2 - 0xff) < 6);
  ok('export contains no selection chrome', accentPixels < 40, accentPixels);

  // --- 10. persistence round trip
  mark('section 10');
  commit();
  const before = snapshot();
  await saveProject();
  const savedMode = storage.mode;
  state.layers = [];
  state.selectedId = null;
  render();
  const restored = await loadProject();
  ok(`project restored from storage (${savedMode})`, restored && state.layers.length > 0,
     `mode=${savedMode} layers=${state.layers.length}`);
  const afterJSON = JSON.parse(snapshot());
  const beforeJSON = JSON.parse(before);
  ok('restored layer count matches', afterJSON.layers.length === beforeJSON.layers.length,
     `${afterJSON.layers.length} vs ${beforeJSON.layers.length}`);
  ok('restored images still resolve to assets',
     afterJSON.layers.filter(l => l.type === 'image').every(l => !!getAsset(l.assetId)));
  ok('restored canvas size matches', afterJSON.w === beforeJSON.w && afterJSON.h === beforeJSON.h);

  // --- 11. templates
  mark('section 11');
  for (const name of Object.keys(templates)) {
    const layersBefore = state.layers.length;
    const label = templates[name]();
    ok(`template "${name}" adds content and returns a label`,
       typeof label === 'string' && state.layers.length > layersBefore);
  }
  const bubbleLayer = state.layers.filter(l => l.bubble).pop();
  ok('speech-bubble template produces a bubble with a tail', !!bubbleLayer && !!bubbleLayer.bubble.tail);

  // Template captions must sit fully inside the canvas even when they wrap.
  for (const name of ['topbottom', 'bar', 'demotivational']) {
    state.layers = state.layers.filter(l => l.type === 'image');
    const n0 = state.layers.length;
    templates[name]();
    const fresh = state.layers.slice(n0);
    const inside = fresh.every(l => {
      const sz = layerSize(l);
      return l.y - sz.h / 2 >= -1 && l.y + sz.h / 2 <= state.h + 1;
    });
    ok(`template "${name}" keeps its captions on the canvas`, inside,
       fresh.map(l => `${(l.y - layerSize(l).h / 2).toFixed(0)}..${(l.y + layerSize(l).h / 2).toFixed(0)}`).join(' '));
  }

  // Typing a longer caption into a pinned block must grow it inwards, which is
  // what happens when a user applies a template and then types their own text.
  state.layers = state.layers.filter(l => l.type === 'image');
  const nT = state.layers.length;
  templates.topbottom();
  const topCap = state.layers[nT];
  const botCap = state.layers[nT + 1];
  select(topCap.id);
  const contentBox = document.getElementById('text-content');
  contentBox.value = 'four pictures on one canvas and a caption long enough to wrap twice over';
  contentBox.dispatchEvent(new Event('input', { bubbles: true }));
  ok('typing a long caption keeps the pinned top block on canvas',
     layoutText(topCap).lines.length > 1 && topCap.y - layerSize(topCap).h / 2 >= -1,
     `${layoutText(topCap).lines.length} lines, top=${(topCap.y - layerSize(topCap).h / 2).toFixed(0)}`);
  select(botCap.id);
  contentBox.value = 'and the bottom one grows upwards instead of falling off the edge';
  contentBox.dispatchEvent(new Event('input', { bubbles: true }));
  ok('the pinned bottom block grows upwards',
     botCap.y + layerSize(botCap).h / 2 <= state.h + 1,
     `bottom=${(botCap.y + layerSize(botCap).h / 2).toFixed(0)} of ${state.h}`);

  // Dragging a pinned block releases the pin.
  select(topCap.id);
  dragPointer({ x: topCap.x, y: topCap.y }, { x: topCap.x, y: topCap.y + 150 });
  ok('dragging releases the edge pin', topCap.edge === null && near(topCap.y, topCap.y));
  contentBox.value = 'now it stays where I put it';
  contentBox.dispatchEvent(new Event('input', { bubbles: true }));
  const yAfter = topCap.y;
  contentBox.value = 'now it stays where I put it even with a much longer line of text';
  contentBox.dispatchEvent(new Event('input', { bubbles: true }));
  ok('an unpinned block no longer snaps back to the edge', near(topCap.y, yAfter, 0.01));

  // ... and still when the caption is long enough to wrap several times.
  state.layers = state.layers.filter(l => l.type === 'image');
  const n1 = state.layers.length;
  templates.topbottom();
  const top = state.layers[n1];
  top.text = 'a really long caption that will definitely wrap onto three or four separate lines';
  snapToEdge(top, 'top');
  ok('a wrapped caption still fits after snapping',
     layoutText(top).lines.length > 2 && top.y - layerSize(top).h / 2 >= -1,
     `${layoutText(top).lines.length} lines, top=${(top.y - layerSize(top).h / 2).toFixed(0)}`);

  // Crop overlay must never leak into an exported file.
  const co = imageLayers()[0];
  enterCrop(co.id);
  const withOverlay = renderToCanvas(1).getContext('2d').getImageData(0, 0, state.w, state.h);
  exitCrop();
  const withoutOverlay = renderToCanvas(1).getContext('2d').getImageData(0, 0, state.w, state.h);
  let diff = 0;
  for (let i = 0; i < withOverlay.data.length; i += 4) {
    if (withOverlay.data[i] !== withoutOverlay.data[i]) diff++;
  }
  ok('crop overlay is not baked into the export', diff === 0, diff + ' pixels differ');

  // --- 12. custom font upload path
  mark('section 12');
  try {
    const fontsBefore = fontList.length;
    const css = await addCustomFont('TestFace', TEST_FONT_DATAURL);
    ok('custom font registers a new family', fontList.length === fontsBefore + 1 && /TestFace/.test(css));
    ok('custom font is usable for measurement', document.fonts.check('40px "TestFace"'));
    ok('custom font is remembered for saving', customFonts.has('TestFace'));
  } catch (err) {
    ok('custom font upload', false, err.message);
  }

  // --- 13. keyboard
  mark('section 13');
  const kl = addTextLayer();
  select(kl.id);
  const kx = kl.x;
  key('ArrowRight');
  ok('arrow key nudges the layer', near(kl.x, kx + 2), kl.x - kx);
  key('ArrowRight', { shiftKey: true });
  ok('shift+arrow nudges further', near(kl.x, kx + 22), kl.x - kx);
  const nBefore = state.layers.length;
  key('d', { ctrlKey: true });
  ok('ctrl+D duplicates', state.layers.length === nBefore + 1);
  key('Delete');
  ok('Delete removes the selection', state.layers.length === nBefore);
  key('z', { ctrlKey: true });
  ok('ctrl+Z undoes the delete', state.layers.length === nBefore + 1, state.layers.length);

  // --- done
  const checks = results.filter(r => !r.startsWith('....'));
  const failed = checks.filter(r => r.startsWith('FAIL')).length;
  results.push('');
  results.push(`${checks.length - failed}/${checks.length} passed`);
  flush();
  document.title = failed ? `TESTS-FAILED-${failed}` : 'TESTS-PASSED';
}

window.addEventListener('load', () => {
  setTimeout(() => {
    runTests().catch(err => {
      document.title = 'TESTS-CRASHED';
      results.push('CRASH: ' + (err && err.stack || err));
      flush();
    });
  }, 400);
});
