// Face masks: every mask is original vector artwork drawn in code (js/masks.js, js/mask-art.js, js/mask-kit.js).
// This test renders each mask on a face frame, checks the artwork, the fit, the smoothing and the id migration,
// and saves contact sheets (PNG) so the result can be looked at.
//
//   NODE_PATH=<global node_modules> node tests/e2e/masks.mjs <scratch-dir>
//
// It needs the static server on :8765 (python3 -m http.server 8765 in the repo root). It uses the REAL FaceLandmarker when
// these exist (nothing of this is shipped in the repo):
//   <scratch>/mp/node_modules/@mediapipe/tasks-vision   npm i @mediapipe/tasks-vision@1.0.1   (in <scratch>/mp)
//   <scratch>/models/face_landmarker.task               the model URL in config.js (effects.faceModel)
//   <scratch>/portrait_640x480.png                      any portrait you may legally use, 640x480, face about 200 px wide
// (override with MP_DIR, MODELS_DIR, PORTRAIT). Without them it falls back to a synthetic face and synthetic landmarks.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2] || '.';
const MP = process.env.MP_DIR || path.join(SP, 'mp/node_modules/@mediapipe/tasks-vision');
const MODELS = process.env.MODELS_DIR || path.join(SP, 'models');
const PORTRAIT = process.env.PORTRAIT || path.join(SP, 'portrait_640x480.png');
const REAL = fs.existsSync(path.join(MP, 'vision_bundle.mjs')) && fs.existsSync(path.join(MODELS, 'face_landmarker.task')) && fs.existsSync(PORTRAIT);
const ROOT = '/home/user/ohmygoal';
const BASE = 'http://localhost:8765';

let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
console.log(REAL ? 'mode: REAL FaceLandmarker on a portrait' : 'mode: SYNTHETIC face and landmarks (no portrait / MediaPipe found in the scratch dir)');

// ------------------------------------------------------------------ 0. source rules: original artwork only
{
  const files = ['js/masks.js', 'js/mask-art.js', 'js/mask-kit.js'];
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''); // comments may talk about emoji; code may not use them
    if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/u.test(code)) bad.push(f + ': emoji / pictograph character');
    if (/\b(fillText|strokeText|measureText)\b|\.font\s*=/.test(code)) bad.push(f + ': text drawing (no text-glyph art)');
    if (/new Image\b|\bImage\(|createImageBitmap|\bfetch\(|XMLHttpRequest|data:image|\.(png|jpe?g|gif|webp|svg|avif)\b/i.test(code)) bad.push(f + ': image file / network use');
    if (!/original/i.test(src.slice(0, 900))) bad.push(f + ': missing the "original artwork" comment');
  }
  const eff = fs.readFileSync(path.join(ROOT, 'js/effects.js'), 'utf8');
  if (/\.emoji\b/.test(eff)) bad.push('effects.js: still draws mask.emoji');
  step('0. mask code is vector-only: no emoji, no text glyphs, no image files, "original artwork" notes present', bad.length === 0, bad.join('; '));
}

// ------------------------------------------------------------------ browser page
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/^(INFO|WARNING):/.test(m.text())) errors.push(m.text().slice(0, 200)); }); // (MediaPipe logs its INFO lines as console errors)
const mime = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm' };
await ctx.route(BASE + '/__masktest.html', r => r.fulfill({ body: '<!doctype html><meta charset=utf-8><body style="margin:0">', contentType: 'text/html' }));
if (REAL) {
  await ctx.route(BASE + '/__mp/**', r => { const f = MP + new URL(r.request().url()).pathname.replace('/__mp', ''); r.fulfill({ body: fs.readFileSync(f), contentType: mime[path.extname(f)] || 'application/octet-stream' }); });
  await ctx.route(BASE + '/__models/**', r => r.fulfill({ body: fs.readFileSync(MODELS + new URL(r.request().url()).pathname.replace('/__models', '')), contentType: 'application/octet-stream' }));
  await ctx.route(BASE + '/__portrait.png', r => r.fulfill({ body: fs.readFileSync(PORTRAIT), contentType: 'image/png' }));
}
await page.goto(BASE + '/__masktest.html');

// The face frame + landmarks (real or synthetic), the masks module, and helper functions used by the checks below.
const info = await page.evaluate(async ({ REAL }) => {
  const W = 640, H = 480;
  const M = await import('/js/masks.js?t=' + Date.now());
  window.M = M; window.W = W; window.H = H;
  const frame = document.createElement('canvas'); frame.width = W; frame.height = H;
  window.frame = frame;
  const fc = frame.getContext('2d');
  let lm;
  if (REAL) {
    const mp = await import('/__mp/vision_bundle.mjs');
    window.mp = mp;
    const vision = await mp.FilesetResolver.forVisionTasks('/__mp/wasm');
    window.vision = vision;
    const fl = await mp.FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: '/__models/face_landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1 });
    window.fl = fl;
    const img = new Image(); img.src = '/__portrait.png'; await img.decode();
    window.img = img;
    fc.drawImage(img, 0, 0, W, H);
    lm = fl.detect(frame).faceLandmarks[0];
    lm = lm && lm.map(p => ({ x: p.x, y: p.y, z: p.z }));
  } else {
    // A synthetic face: skin-toned oval, hair, eyes, brows, nose, mouth on a grey wall.
    const g = fc.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#9aa3ad'); g.addColorStop(1, '#6b7380'); fc.fillStyle = g; fc.fillRect(0, 0, W, H);
    fc.fillStyle = '#4a3322'; fc.beginPath(); fc.ellipse(320, 215, 112, 128, 0, 0, Math.PI * 2); fc.fill();
    fc.fillStyle = '#6a4a38'; fc.fillRect(250, 330, 140, 150);
    fc.fillStyle = '#d9a784'; fc.beginPath(); fc.ellipse(320, 245, 88, 105, 0, 0, Math.PI * 2); fc.fill();
    fc.fillStyle = '#fff'; for (const s of [-1, 1]) { fc.beginPath(); fc.ellipse(320 + s * 41, 202, 17, 8, 0, 0, Math.PI * 2); fc.fill(); }
    fc.fillStyle = '#3a2a22'; for (const s of [-1, 1]) { fc.beginPath(); fc.arc(320 + s * 41, 202, 6.5, 0, Math.PI * 2); fc.fill(); }
    fc.strokeStyle = '#3a2a22'; fc.lineWidth = 5; for (const s of [-1, 1]) { fc.beginPath(); fc.moveTo(320 + s * 20, 178); fc.lineTo(320 + s * 66, 172); fc.stroke(); }
    fc.strokeStyle = '#b5785a'; fc.lineWidth = 4; fc.beginPath(); fc.moveTo(320, 210); fc.lineTo(316, 252); fc.lineTo(328, 256); fc.stroke();
    fc.strokeStyle = '#8c3b3b'; fc.lineWidth = 6; fc.beginPath(); fc.moveTo(288, 288); fc.quadraticCurveTo(320, 308, 352, 288); fc.stroke();
    lm = synthLandmarks();
  }
  function synthLandmarks() {
    const cx = 320, cy = 245, hw = 88, hh = 105;
    const L = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
    const put = (i, x, y, z) => { L[i] = { x: (cx + x * hw) / W, y: (cy + y * hh) / H, z: z * hw / W }; };
    OVAL.forEach((i, k) => { const ph = -Math.PI / 2 + k * Math.PI / 18; put(i, Math.cos(ph), Math.sin(ph), 0.85 * Math.pow(Math.abs(Math.cos(ph)), 1.5)); });
    put(33, -0.672, -0.42, 0.45); put(133, -0.268, -0.387, 0.4); put(362, 0.242, -0.384, 0.4); put(263, 0.654, -0.42, 0.45);
    put(1, -0.02, 0.108, -0.5); put(13, -0.008, 0.342, -0.05); put(14, -0.015, 0.463, -0.05);
    return L;
  }
  window.synthLandmarks = synthLandmarks;
  window.baseLm = lm;
  return { landmarks: lm, count: M.MASKS.length, ids: M.MASKS.map(m => m.id) };
}, { REAL });
step('1. a face was found on the test frame (' + (REAL ? 'FaceLandmarker' : 'synthetic') + ')', Array.isArray(info.landmarks) && info.landmarks.length >= 468);

// ------------------------------------------------------------------ 2. catalogue: ids, labels, kinds, thumbnails
{
  const r = await page.evaluate(() => {
    const out = { rows: [], dup: false };
    const seen = new Set();
    for (const m of window.M.MASKS) {
      if (seen.has(m.id)) out.dup = true;
      seen.add(m.id);
      let thumb = null;
      if (m.id !== 'none') {
        const c = document.createElement('canvas'); c.width = c.height = 80;
        const cx = c.getContext('2d');
        try { m.thumb(cx, 80, 80); } catch (e) { thumb = 'ERR ' + e.message; }
        if (!thumb) {
          const d = cx.getImageData(0, 0, 80, 80).data;
          const bins = new Set();
          for (let i = 0; i < d.length; i += 4 * 7) bins.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
          thumb = bins.size;
        }
      }
      out.rows.push({ id: m.id, label: m.label, kind: m.kind, hasThumb: typeof m.thumb === 'function', thumb });
    }
    return out;
  });
  const real = r.rows.filter(m => m.id !== 'none');
  const full = real.filter(m => m.kind === 'full'), eyes = real.filter(m => m.kind === 'eyes'), crown = real.filter(m => m.kind === 'crown');
  step('2a. 8-12 options, unique ids, a human label and a thumb() for every one, ' + `${full.length} full + ${eyes.length} eyes + ${crown.length} crown`,
    !r.dup && real.length >= 8 && real.length <= 12 && real.every(m => m.label && m.label.length <= 16 && !/[^\x20-\x7e]/.test(m.label) && m.hasThumb) && full.length >= 6 && eyes.length >= 1 && crown.length >= 1, JSON.stringify(real.map(m => m.id)));
  step('2b. "shades" is still there (the free mask) and the old ids are gone from the picker', real.some(m => m.id === 'shades') && !real.some(m => ['dog', 'cat', 'panda', 'fox', 'robot', 'alien'].includes(m.id)));
  step('2c. every thumb() draws a real picture without throwing (not blank)', real.every(m => typeof m.thumb === 'number' && m.thumb > 12), real.map(m => `${m.id}:${m.thumb}`).join(' '));
}

// ------------------------------------------------------------------ 3. migration of ids saved by older versions
{
  const r = await page.evaluate(async () => {
    const E = await import('/js/effects.js?t=' + Date.now());
    const ids = window.M.MASKS.map(m => m.id);
    const old = ['shades', 'crown', 'dog', 'cat', 'panda', 'fox', 'robot', 'alien'];
    return {
      map: Object.fromEntries(old.map(o => [o, E.migrateFx({ background: 'blur', mask: o, filter: 'beauty' }).mask])),
      ids,
      unknown: [E.migrateFx({ mask: 'zebra' }).mask, E.migrateFx({}).mask, E.migrateFx({ mask: null }).mask, E.migrateFx({ mask: '__proto__' }).mask, E.migrateFx({ mask: 'constructor' }).mask],
      keepsOthers: JSON.stringify(E.migrateFx({ background: 'blur', mask: 'dog', filter: 'warm' })) ,
      keep: E.migrateFx({ mask: 'neon' }).mask + E.migrateFx({ mask: 'none' }).mask,
      reexport: E.MASKS === window.M.MASKS || E.MASKS.length === window.M.MASKS.length,
      found: window.M.findMask('crown')?.id + ',' + window.M.findMask('dog')?.kind + ',' + window.M.findMask('nope')?.id,
    };
  });
  const full = new Set(['origami', 'masquerade', 'spirit', 'neon', 'glitch', 'constellation', 'mosaic', 'kintsugi']);
  step('3a. old animal masks (dog cat panda fox robot alien) map to new FULL-FACE masks, crown to the new crown, shades to shades',
    ['dog', 'cat', 'panda', 'fox', 'robot', 'alien'].every(o => r.ids.includes(r.map[o]) && full.has(r.map[o])) && r.map.crown === 'laurel' && r.map.shades === 'shades', JSON.stringify(r.map));
  step('3b. unknown / missing / hostile ids become "none"; current ids are kept; other effect fields untouched', r.unknown.every(u => u === 'none') && r.keep === 'neonnone' && /"background":"blur"/.test(r.keepsOthers) && /"filter":"warm"/.test(r.keepsOthers), JSON.stringify(r.unknown) + r.keepsOthers);
  step('3c. effects.js still exports MASKS (from masks.js) and findMask resolves old ids', r.reexport && r.found === 'laurel,full,none', r.found);
}

// ------------------------------------------------------------------ 4. pose maths (Node side: masks.js has no DOM work at import)
const { measureFace, FaceTracker } = await import(ROOT + '/js/masks.js?t=' + Date.now());
const W = 640, H = 480;
const base = info.landmarks;
const mid = [(base[234].x + base[454].x) / 2, (base[234].y + base[454].y) / 2], midZ = (base[234].z + base[454].z) / 2;
/** Rotate the 3D landmarks: yaw (positive = nose turns toward image right), pitch, then in-plane roll. */
const rot3 = (lm, yawDeg = 0, pitchDeg = 0, rollDeg = 0) => {
  const a = -yawDeg * Math.PI / 180, b = pitchDeg * Math.PI / 180, c = rollDeg * Math.PI / 180;
  return lm.map(p => {
    let X = (p.x - mid[0]) * W, Y = (p.y - mid[1]) * H, Z = (p.z - midZ) * W;
    const X1 = X * Math.cos(a) + Z * Math.sin(a), Z1 = -X * Math.sin(a) + Z * Math.cos(a);
    const Y2 = Y * Math.cos(b) - Z1 * Math.sin(b);
    const X3 = X1 * Math.cos(c) - Y2 * Math.sin(c), Y3 = X1 * Math.sin(c) + Y2 * Math.cos(c);
    return { x: X3 / W + mid[0], y: Y3 / H + mid[1], z: Z1 / W };
  });
};
const pose0 = measureFace(base, W, H, {});
{
  const rows = [-45, -30, -15, 0, 15, 30, 45].map(y => ({ y, o: measureFace(rot3(base, y), W, H, {}) }));
  const est = rows.map(r => +(r.o.yaw * 180 / Math.PI).toFixed(1));
  step('4a. yaw estimate follows a turning head (within 8 degrees from -45 to +45)', rows.every(r => Math.abs(r.o.yaw * 180 / Math.PI - r.y) <= 8 + Math.abs(pose0.yaw * 180 / Math.PI)), est.join(' '));
  const w0 = rows.find(r => r.y === 0).o.w, w45 = rows.find(r => r.y === 45).o.w, wm45 = rows.find(r => r.y === -45).o.w;
  step('4b. the mask narrows when the head turns (silhouette width at 45 degrees < 95% of frontal) and the features slide toward the turn', w45 < 0.95 * w0 && wm45 < 0.95 * w0 && rows.find(r => r.y === 30).o.fx > 0.2 && rows.find(r => r.y === -30).o.fx < -0.2, `w ${w0.toFixed(0)} -> ${w45.toFixed(0)} / ${wm45.toFixed(0)}`);
  const rolls = [-40, -20, 0, 20, 40].map(r => ({ r, a: measureFace(rot3(base, 0, 0, r), W, H, {}).angle * 180 / Math.PI }));
  step('4c. roll follows the head tilt (within 2 degrees from -40 to +40)', rolls.every(x => Math.abs(x.a - x.r - pose0.angle * 180 / Math.PI) < 2), rolls.map(x => x.a.toFixed(1)).join(' '));
  const size = measureFace(base.map(p => ({ x: (p.x - mid[0]) * 1.5 + mid[0], y: (p.y - mid[1]) * 1.5 + mid[1], z: p.z * 1.5 })), W, H, {});
  step('4d. scale: a face 1.5x larger measures 1.5x wider and taller; the centre follows', Math.abs(size.w / pose0.w - 1.5) < 0.03 && Math.abs(size.h / pose0.h - 1.5) < 0.03);
}
{
  // smoothing: still head with landmark noise, and a fast move
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const noisy = (dx, dy, s) => base.map(p => ({ x: p.x + (dx + (rnd() - 0.5) * 2 * s) / W, y: p.y + (dy + (rnd() - 0.5) * 2 * s) / H, z: p.z }));
  const tr = new FaceTracker(); const raw = [], out = [];
  for (let i = 0; i < 150; i++) { const l = noisy(0, 0, 1.0); raw.push(measureFace(l, W, H, {}).cx); out.push(tr.update(l, W, H, 1000 + i * 42).cx); }
  const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
  step('4e. a still head does not jitter: smoothed output noise is under half of the raw landmark noise', sd(out.slice(20)) < 0.5 * sd(raw.slice(20)), `raw ${sd(raw.slice(20)).toFixed(2)}px -> ${sd(out.slice(20)).toFixed(2)}px`);
  const t2 = new FaceTracker();
  for (let i = 0; i < 30; i++) t2.update(noisy(0, 0, 0), W, H, 1000 + i * 42);
  const c0 = t2.pose.cx; const track = [];
  for (let i = 0; i < 6; i++) track.push(t2.update(noisy(60, 0, 0), W, H, 2260 + i * 42).cx - c0);
  step('4f. a fast move (60 px in one frame) is followed with almost no lag: 80% there after 3 frames, 95% after 6', track[2] > 48 && track[5] > 57, track.map(x => x.toFixed(0)).join(' '));
  const t3 = new FaceTracker(); let lag = 0;
  for (let i = 0; i < 60; i++) { const p = t3.update(noisy(i * 1.5, 0, 0), W, H, 1000 + i * 42); if (i > 20) lag = Math.max(lag, i * 1.5 - (p.cx - (measureFace(base, W, H, {}).cx))); }
  step('4g. steady slow movement (1.5 px per frame) lags by less than 6 px', lag < 6, 'max lag ' + lag.toFixed(1));
  const t4 = new FaceTracker();
  t4.update(base, W, H, 1000); t4.update(base, W, H, 1042);
  const held = t4.update(undefined, W, H, 1100), wasHeld = held && held.held === true; // (the pose object is reused, so read it right away)
  const gone = t4.update(undefined, W, H, 1300);
  const back = t4.update(base, W, H, 1342);
  step('4h. a face missed for ~60 ms keeps the mask in place; after ~250 ms the tracker reports no face (caller hides everything); it recovers', wasHeld && gone === null && back && back.held === false);
  const t5 = new FaceTracker(); t5.update(base, W, H, 1000); t5.update(base, W, H, 1042);
  const jumped = t5.update(noisy(200, 0, 0), W, H, 5000);
  step('4i. after a long gap (tab was in the background) the mask jumps to the new position instead of gliding across the screen', Math.abs(jumped.cx - measureFace(noisy(200, 0, 0), W, H, {}).cx) < 15);
}

// ------------------------------------------------------------------ 5. render every mask on the face frame
const render = await page.evaluate(({ landmarks }) => {
  const M = window.M, W = window.W, H = window.H;
  const frame = window.frame;
  const work = document.createElement('canvas'); work.width = W; work.height = H;
  const wc = work.getContext('2d', { willReadFrequently: true });
  const fc = frame.getContext('2d', { willReadFrequently: true });
  const raw = fc.getImageData(0, 0, W, H);
  const tr = new M.FaceTracker();
  let face;
  for (let i = 0; i < 10; i++) face = tr.update(landmarks, W, H, 1000 + i * 42);
  // face-centre region: an ellipse covering 75% of the oval
  const rx = face.w / 2 * 0.75, ry = face.h / 2 * 0.75;
  const inRegion = (x, y) => ((x - face.cx) / rx) ** 2 + ((y - face.cy) / ry) ** 2 <= 1;
  const skin = (r, g, b) => { const Cb = 128 - 0.169 * r - 0.331 * g + 0.5 * b, Cr = 128 + 0.5 * r - 0.419 * g - 0.081 * b; return Cb >= 77 && Cb <= 127 && Cr >= 133 && Cr <= 173; };
  const stats = img => {
    let n = 0, sk = 0, same = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!inRegion(x, y)) continue;
      const i = (y * W + x) * 4; n++;
      if (skin(img.data[i], img.data[i + 1], img.data[i + 2])) sk++;
      if (Math.max(Math.abs(img.data[i] - raw.data[i]), Math.abs(img.data[i + 1] - raw.data[i + 1]), Math.abs(img.data[i + 2] - raw.data[i + 2])) <= 20) same++;
    }
    return { n, skin: sk / n, same: same / n };
  };
  const out = { pose: { cx: face.cx, cy: face.cy, w: face.w, h: face.h, angle: face.angle }, raw: stats(raw), masks: [], errors: [] };
  const video = frame;
  for (const m of M.MASKS) {
    if (m.id === 'none') continue;
    const row = { id: m.id, kind: m.kind, ts: [] };
    for (const t of [0.4, 2.9]) {
      wc.drawImage(frame, 0, 0);
      try { M.drawMask(wc, m, face, t, { video, W, H }); } catch (e) { out.errors.push(m.id + ' ' + e.stack); }
      const img = wc.getImageData(0, 0, W, H);
      row.ts.push(stats(img));
    }
    out.masks.push(row);
  }
  // timing: median of 7 runs of 20 draws each at 640x480 (software canvas in headless Chromium, so a pessimistic number)
  out.timing = {};
  for (const m of M.MASKS) {
    if (m.id === 'none') continue;
    wc.drawImage(frame, 0, 0); M.drawMask(wc, m, face, 0, { video, W, H }); // warm up (sprites)
    const runs = [];
    for (let r = 0; r < 7; r++) {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) { M.drawMask(wc, m, face, (r * 20 + i) / 24, { video, W, H }); wc.getImageData(0, 0, 1, 1); } // (the read forces the canvas to actually draw)
      runs.push((performance.now() - t0) / 20);
    }
    runs.sort((a, b) => a - b);
    out.timing[m.id] = runs[3];
  }
  return out;
}, { landmarks: base });
step('5a. every mask draws on the face frame at two moments without throwing', render.errors.length === 0 && render.masks.length >= 8, render.errors.join(' | ').slice(0, 300));
step('5b. sanity: the classifier sees skin on the unmasked face centre (' + (render.raw.skin * 100).toFixed(0) + '% skin-like)', render.raw.skin > 0.5);
{
  const fullRows = render.masks.filter(m => m.kind === 'full');
  const worst = fullRows.map(m => ({ id: m.id, skin: Math.max(...m.ts.map(t => t.skin)), same: Math.max(...m.ts.map(t => t.same)) }));
  step('5c. FULL masks hide the face centre: at most 3% of its pixels equal the original ones and under 8% are skin-coloured (gold trim counts as skin-like), at both moments',
    worst.every(w => w.skin < 0.08 && w.same < 0.03), worst.map(w => `${w.id}:${(w.skin * 100).toFixed(1)}%/${(w.same * 100).toFixed(1)}%`).join(' '));
  const eyes = render.masks.filter(m => m.kind === 'crown');
  step('5d. crown accessories leave the face centre essentially untouched (they sit on the head, not over the face)', eyes.every(m => m.ts.every(t => t.same > 0.9)), eyes.map(m => m.id + ':' + (m.ts[0].same * 100).toFixed(0) + '%').join(' '));
  const vis = render.masks.filter(m => m.kind === 'eyes');
  step('5e. the visor changes the eye band of the face (some pixels differ) but leaves the mouth area', vis.every(m => m.ts[0].same < 0.9 && m.ts[0].same > 0.3), vis.map(m => m.id + ':' + (m.ts[0].same * 100).toFixed(0) + '% unchanged').join(' '));
  const slow = Object.entries(render.timing).filter(([, ms]) => ms > 25);
  step('5f. drawing cost: every mask under 25 ms per frame even on this software canvas', slow.length === 0, Object.entries(render.timing).map(([k, v]) => `${k}:${v.toFixed(1)}`).join(' '));
}

// ------------------------------------------------------------------ 6. the "face not found" emblem and switching masks frees memory
{
  const r = await page.evaluate(() => {
    const M = window.M, W = window.W, H = window.H;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d', { willReadFrequently: true });
    const res = [];
    for (const m of M.MASKS.filter(m => m.kind === 'full')) {
      cx.fillStyle = '#334'; cx.fillRect(0, 0, W, H);
      try { M.drawMaskEmblem(cx, m, W, H, 1.2); } catch (e) { res.push([m.id, 'ERR ' + e.message]); continue; }
      const d = cx.getImageData(W / 2 - 60, H / 2 - 60, 120, 120).data;
      const bins = new Set();
      for (let i = 0; i < d.length; i += 4 * 5) bins.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
      res.push([m.id, bins.size]);
    }
    return res;
  });
  step('6a. the face-not-found emblem is drawn with each full mask\'s own vector artwork (varied picture in the middle, no exceptions)', r.every(([, n]) => typeof n === 'number' && n > 8), JSON.stringify(r));
  const freed = await page.evaluate(() => {
    const M = window.M, W = window.W, H = window.H;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const cx = c.getContext('2d');
    const tr = new M.FaceTracker(); const f = tr.update(window.baseLm, W, H, 1000);
    const a = M.MASKS.find(m => m.id === 'origami'), b = M.MASKS.find(m => m.id === 'kintsugi');
    M.drawMask(cx, a, f, 0, null); M.drawMask(cx, a, f, 0, null);
    M.drawMask(cx, b, f, 0, null);
    return { aSprites: a.layers.filter(l => l.sprite).length, bSprites: b.layers.filter(l => l.sprite).length };
  });
  step('6b. switching masks releases the previous mask\'s cached sprites', freed.aSprites === 0 && freed.bSprites >= 1, JSON.stringify(freed));
}

// ------------------------------------------------------------------ 7. contact sheets
{
  const sheets = await page.evaluate(({ landmarks, REAL }) => {
    const M = window.M, W = window.W, H = window.H;
    const frame = window.frame;
    const ids = M.MASKS.filter(m => m.id !== 'none');
    const mk = (cols, rows, C) => { const s = document.createElement('canvas'); s.width = cols * C; s.height = rows * C; const c = s.getContext('2d'); c.fillStyle = '#111'; c.fillRect(0, 0, s.width, s.height); return [s, c]; };
    const work = document.createElement('canvas'); work.width = W; work.height = H; const wc = work.getContext('2d');
    const tr = new M.FaceTracker(); let face;
    for (let i = 0; i < 10; i++) face = tr.update(landmarks, W, H, 1000 + i * 42);
    const cell = (sc, k, cols, C, f, label) => {
      const s = C / (f.w * 2.1);
      sc.save(); sc.translate((k % cols) * C, Math.floor(k / cols) * C); sc.beginPath(); sc.rect(0, 0, C, C); sc.clip();
      sc.translate(C / 2, C / 2); sc.scale(s, s); sc.translate(-f.cx, -f.cy + f.h * 0.2); sc.drawImage(work, 0, 0); sc.restore();
    };
    const C = 320, cols = 4, rows = Math.ceil((ids.length + 1) / cols);
    const [s1, c1] = mk(cols, rows, C);
    wc.drawImage(frame, 0, 0); cell(c1, 0, cols, C, face);
    ids.forEach((m, k) => { wc.drawImage(frame, 0, 0); M.drawMask(wc, m, face, 1.3 + k * 0.37, { video: frame, W, H }); cell(c1, k + 1, cols, C, face); });
    // pose strip: the masks over the head outline drawn from the (rotated) landmarks, to see the fit when the head turns and tilts
    const rot = (lm, yawDeg, rollDeg) => {
      const mid = [(lm[234].x + lm[454].x) / 2, (lm[234].y + lm[454].y) / 2], mz = (lm[234].z + lm[454].z) / 2;
      const a = -yawDeg * Math.PI / 180, c = rollDeg * Math.PI / 180;
      return lm.map(p => { const X = (p.x - mid[0]) * W, Y = (p.y - mid[1]) * H, Z = (p.z - mz) * W; const X1 = X * Math.cos(a) + Z * Math.sin(a), Z1 = -X * Math.sin(a) + Z * Math.cos(a); return { x: (X1 * Math.cos(c) - Y * Math.sin(c)) / W + mid[0], y: (X1 * Math.sin(c) + Y * Math.cos(c)) / H + mid[1], z: Z1 / W }; });
    };
    const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
    const poses = [[-45, 0], [-25, 12], [0, 0], [25, -12], [45, 0]];
    const pick = ['origami', 'kintsugi', 'neon', 'masquerade', 'spirit', 'laurel', 'shades', 'stars'].filter(id => ids.some(m => m.id === id));
    const [s2, c2] = mk(poses.length, pick.length, 220);
    pick.forEach((id, r) => poses.forEach(([yaw, roll], k) => {
      const t2 = new M.FaceTracker(); let f;
      const l2 = rot(landmarks, yaw, roll);
      for (let i = 0; i < 10; i++) f = t2.update(l2, W, H, 1000 + i * 42);
      wc.fillStyle = '#58606c'; wc.fillRect(0, 0, W, H);
      // a plain head: the landmark oval filled with a neutral tone, eyes and mouth as dots
      wc.fillStyle = '#c9a58d'; wc.beginPath(); OVAL.forEach((i, n) => (n ? wc.lineTo(l2[i].x * W, l2[i].y * H) : wc.moveTo(l2[i].x * W, l2[i].y * H))); wc.fill();
      wc.fillStyle = '#4a3a33'; for (const i of [33, 263, 1, 13, 14]) { wc.beginPath(); wc.arc(l2[i].x * W, l2[i].y * H, 4, 0, 7); wc.fill(); }
      M.drawMask(wc, M.MASKS.find(m => m.id === id), f, 1.3, { video: work, W, H });
      const s = 220 / (f.w * 2.2);
      c2.save(); c2.translate(k * 220, r * 220); c2.beginPath(); c2.rect(0, 0, 220, 220); c2.clip(); c2.translate(110, 110); c2.scale(s, s); c2.translate(-f.cx, -f.cy + f.h * 0.15); c2.drawImage(work, 0, 0); c2.restore();
    }));
    return { s1: s1.toDataURL('image/png').split(',')[1], s2: s2.toDataURL('image/png').split(',')[1] };
  }, { landmarks: base, REAL });
  fs.mkdirSync(SP, { recursive: true });
  fs.writeFileSync(path.join(SP, 'masks-contact-sheet.png'), Buffer.from(sheets.s1, 'base64'));
  fs.writeFileSync(path.join(SP, 'masks-pose-strip.png'), Buffer.from(sheets.s2, 'base64'));
  step('7. contact sheets saved', fs.statSync(path.join(SP, 'masks-contact-sheet.png')).size > 20000, path.join(SP, 'masks-contact-sheet.png') + ' , ' + path.join(SP, 'masks-pose-strip.png'));
}

// ------------------------------------------------------------------ 8. the real pipeline: Effects class with the portrait as the camera (real mode only)
if (REAL) {
  const live = await page.evaluate(async () => {
    const W = window.W, H = window.H;
    const E = await import('/js/effects.js?t=' + Date.now());
    const cfg = { libUrl: '/__mp/vision_bundle.mjs', wasmUrl: '/__mp/wasm', faceModel: '/__models/face_landmarker.task', segmenterModel: '/__models/selfie_segmenter.tflite' };
    const cam = document.createElement('canvas'); cam.width = W; cam.height = H;
    const cc = cam.getContext('2d');
    const draw = () => { cc.drawImage(window.img, 0, 0, W, H); };
    draw();
    const stream = cam.captureStream(24);
    const timer = setInterval(draw, 40);
    const fx = new E.Effects(cfg);
    const res = { shots: {}, errors: [] };
    const grab = () => { const c = document.createElement('canvas'); c.width = fx.out.width; c.height = fx.out.height; c.getContext('2d').drawImage(fx.out, 0, 0); return c; };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    try {
      await fx.set({ background: 'none', mask: 'none', filter: 'none' });
      await fx.set({ background: 'none', mask: 'origami', filter: 'none' });
      await fx.start(stream);
      await sleep(2500);
      res.face = fx.face ? { cx: fx.face.cx, cy: fx.face.cy, w: fx.face.w, h: fx.face.h } : null;
      res.outSize = [fx.out.width, fx.out.height];
      let prev = grab().toDataURL('image/png');
      res.shots.origami = prev.split(',')[1];
      for (const id of ['mosaic', 'kintsugi', 'laurel', 'shades']) {
        await fx.set({ mask: id });
        // wait (up to 15 s: the software-only test browser is slow) until a frame with the new mask has been drawn
        let png = prev;
        for (let i = 0; i < 60 && png === prev; i++) { await sleep(250); png = grab().toDataURL('image/png'); }
        await sleep(600);
        png = grab().toDataURL('image/png');
        res.shots[id] = png.split(',')[1]; prev = png;
      }
      // the camera shows no face (blank wall): a full mask must hide everything and draw its emblem
      await fx.set({ mask: 'neon' }); await sleep(600);
      const c0 = cam.getContext('2d');
      clearInterval(timer);
      const blank = setInterval(() => { c0.fillStyle = '#556'; c0.fillRect(0, 0, W, H); }, 40);
      await sleep(1200);
      res.noFace = { face: fx.face, shot: grab().toDataURL('image/png').split(',')[1] };
      clearInterval(blank);
    } catch (e) { res.errors.push(e.stack || String(e)); }
    fx.stop();
    return res;
  });
  step('8a. real pipeline: Effects (segmenter-free) loads FaceLandmarker, tracks the portrait and draws masks without errors', live.errors.length === 0 && live.face && Math.abs(live.face.w - 176) < 40, JSON.stringify(live.face) + ' ' + live.errors.join('|').slice(0, 300));
  for (const [id, b64] of Object.entries(live.shots)) fs.writeFileSync(path.join(SP, `live-${id}.png`), Buffer.from(b64, 'base64'));
  if (live.noFace) fs.writeFileSync(path.join(SP, 'live-noface-emblem.png'), Buffer.from(live.noFace.shot, 'base64'));
  step('8b. real pipeline: each mask picked in turn really changes the output frame (5 different pictures)', new Set(Object.values(live.shots)).size === 5, 'screenshots in ' + SP);
  step('8c. real pipeline: with no face in view a full mask hides everything (tracker returns no face) and shows its emblem', live.noFace && live.noFace.face === null && live.noFace.shot.length > 1000);
}

step('9. no page errors while rendering', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
