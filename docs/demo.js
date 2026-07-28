/* demo.js — fills the canvas with placeholder pictures and captions so that
 * docs/screenshots.sh can photograph the app. Not loaded by the app itself.
 *
 * ?scene=collage | crop | bubble picks what to set up. */

window.addEventListener('load', () => setTimeout(async () => {
  await ensureFontsReady();
  const mk = (w, h, c1, c2, label) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffffff'; x.font = 'bold 90px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label, w / 2, h / 2);
    return c.toDataURL();
  };
  const dataURLs = [
    mk(900, 600, '#c0392b', '#8e2de2', 'A'),
    mk(600, 900, '#2980b9', '#26d0ce', 'B'),
    mk(800, 800, '#11998e', '#38ef7d', 'C'),
    mk(900, 700, '#f2994a', '#f2c94c', 'D'),
  ];
  state.ratioLocked = true; state.w = 1000; state.h = 1000;
  for (const d of dataURLs) addImageLayer(await addAsset(d));
  layoutGap.value = 14;
  applyLayout('grid');

  const scene = new URLSearchParams(location.search).get('scene') || 'collage';

  if (scene === 'collage') {
    templates.topbottom();
    const texts = state.layers.filter(l => l.type === 'text');
    texts[0].text = 'four pictures, one canvas';
    texts[1].text = 'wrapping, outlines, the works';
    texts.forEach(reflow);   // the app does this via edit(); we set .text directly
    const s = addSticker('🔥'); s.x = 830; s.y = 500; s.rot = -18; s.size = 190;
    const s2 = addSticker('💯'); s2.x = 180; s2.y = 500; s2.rot = 14; s2.size = 150;
    select(texts[0].id);
  } else if (scene === 'bubble') {
    state.layers = state.layers.slice(0, 1);
    placeInRect(state.layers[0], 0, 0, state.w, state.h);
    const label = templates.bubble();
    const b = state.layers[state.layers.length - 1];
    b.text = 'Pinch me, rotate me, drag my tail';
    b.size = 54; b.boxW = 420; b.x = 340; b.y = 260; b.rot = -4;
    b.bubble.tail = { x: 60, y: 260 };
    select(b.id);
  } else if (scene === 'crop') {
    const l = imageLayers()[0];
    select(l.id);
    enterCrop(l.id);
    setCropZoom(l, 1.9);
  }
  render(); syncPanel();
  document.title = 'READY';
}, 300));
