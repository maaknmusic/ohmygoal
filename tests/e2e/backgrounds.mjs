// End-to-end checks for the background effects: js/backgrounds.js (scenes), js/matte.js + js/matte-gl.js (person matte,
// background blur) and the Effects pipeline in js/effects.js. Runs the REAL Effects class in headless Chromium.
//
//   NODE_PATH=<global node_modules> node tests/e2e/backgrounds.mjs <scratch-dir>
//
// Two layers of checks:
//  1. Synthetic (always): the segmenter is replaced by a stub that returns a noisy ellipse, the camera is a drawn test
//     picture with a person-like ellipse. Strong pixel-level assertions (person kept, background replaced, blur does not
//     bleed, no raw-camera fallback, quality tiers, ids, thumbnails, photo picker ...).
//  2. Real pipeline (when available): MediaPipe's selfie segmenter on a portrait photo. Needs, under <scratch-dir> or the
//     env vars PORTRAIT, MP_DIR, MODELS_DIR:
//       PORTRAIT   portrait photo you may legally use (do NOT commit it to the repo)         default <scratch>/astronaut.png
//       MP_DIR     npm i @mediapipe/tasks-vision@1.0.1 -> node_modules/@mediapipe/tasks-vision default <scratch>/mp/node_modules/@mediapipe/tasks-vision
//       MODELS_DIR folder with selfie_segmenter.tflite (storage.googleapis.com/mediapipe-models/...) default <scratch>/models
//     If any is missing those checks are skipped (and said so).
import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire((process.env.NODE_PATH || '/opt/node22/lib/node_modules') + '/')('playwright');
const SP = process.argv[2] || '.';
const PORTRAIT = process.env.PORTRAIT || SP + '/astronaut.png';
const MP_DIR = process.env.MP_DIR || SP + '/mp/node_modules/@mediapipe/tasks-vision';
const MODELS_DIR = process.env.MODELS_DIR || SP + '/models';
const real = [PORTRAIT, MP_DIR + '/vision_bundle.mjs', MODELS_DIR + '/selfie_segmenter.tflite'].every(f => fs.existsSync(f));
const BASE = 'http://127.0.0.1:8765';

let failures = 0;
const step = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`); };
const skip = (n, why) => console.log(`SKIP ${n} (${why})`);

// The page: a camera made of a canvas (captureStream), the Effects class, and helpers.
const HTML = `<!doctype html><meta charset="utf-8"><body style="margin:0"><script type="module">
const { Effects } = await import('/js/effects.js');
const B = await import('/js/backgrounds.js');
const M = await import('/js/matte.js');
const q = new URLSearchParams(location.search);
const W = 1280, H = 720;
const cam = document.createElement('canvas'); cam.width = W; cam.height = H;
const cg = cam.getContext('2d');
let seed = 4242; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / 0.7071; };
let img = null;
if (q.get('real')) { img = new Image(); img.src = '${BASE}/__portrait.png'; await img.decode(); }
// Camera picture. Synthetic: green vertical stripes with an orange person-like ellipse. Real: the portrait. Optional noise and shift.
function drawFrame({ noise = 0, dx = 0 } = {}) {
  if (img) {
    cg.fillStyle = '#808080'; cg.fillRect(0, 0, W, H);
    const srcH = Math.min(img.height, img.width * H / W);
    cg.drawImage(img, 0, 0, img.width, srcH, dx, 0, W, H);
  } else {
    for (let x = 0; x < W; x += 40) { cg.fillStyle = (x / 40) % 2 ? '#2e8b57' : '#9be3b4'; cg.fillRect(x, 0, 40, H); }
    cg.fillStyle = '#e8590c'; cg.beginPath(); cg.ellipse(W * 0.5 + dx, H * 0.55, W * 0.18, H * 0.36, 0, 0, Math.PI * 2); cg.fill();
  }
  if (noise) {
    const d = cg.getImageData(0, 0, W, H), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const n = gauss() * noise; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
    cg.putImageData(d, 0, 0);
  }
}
// Stub segmenter for the synthetic runs: a soft ellipse (matching the drawn person) plus noise.
function stubSegmenter(noise = 0.03) {
  return { calls: 0, segmentForVideo() {
    this.calls++;
    const n = 256, d = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const e = Math.hypot(((x + 0.5) / n - 0.5) / 0.18, ((y + 0.5) / n - 0.55) / 0.36);
      d[y * n + x] = Math.min(1, Math.max(0, 0.5 + (1 - e) * 3 + (rnd() - 0.5) * 2 * noise));
    }
    return { confidenceMasks: [{ width: n, height: n, getAsFloat32Array: () => d }], close() {} };
  } };
}
const video = document.createElement('video'); video.muted = true; video.playsInline = true; document.body.append(video);
video.srcObject = cam.captureStream(30);
drawFrame(); await video.play();
setInterval(() => cg.fillRect(0, 0, 1, 1), 30);
const cfg = { libUrl: '${BASE}/__mp/vision_bundle.mjs', wasmUrl: '${BASE}/__mp/wasm', segmenterModel: '${BASE}/__models/selfie_segmenter.tflite', faceModel: '${BASE}/__models/face_landmarker.task' };
const fx = new Effects(cfg);
const nextFrame = () => new Promise(r => setTimeout(r, 70));
for (let i = 0; i < 100 && !(video.videoWidth && video.readyState >= 2); i++) await new Promise(r => setTimeout(r, 50));
const px = (c, x, y) => { const g = c.getContext('2d'); return Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)); };
const patchStd = (c, x, y, w, h) => { const d = c.getContext('2d').getImageData(x, y, w, h).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; s += l; s2 += l * l; n++; } const m = s / n; return Math.sqrt(Math.max(0, s2 / n - m * m)); };
window.T = { fx, B, M, cam, video, drawFrame, stubSegmenter, nextFrame, px, patchStd, W, H, rnd };
window.__ready = true;
</script>`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function openPage(realMode) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.route(/127\.0\.0\.1:8765\/__t\.html/, r => r.fulfill({ body: HTML, contentType: 'text/html' }));
  if (realMode) {
    await ctx.route(BASE + '/__portrait.png', r => r.fulfill({ path: PORTRAIT, contentType: 'image/png' }));
    await ctx.route(BASE + '/__mp/**', r => { const f = MP_DIR + '/' + r.request().url().split('/__mp/')[1].split('?')[0]; r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' }); });
    await ctx.route(BASE + '/__models/*', r => r.fulfill({ path: MODELS_DIR + '/' + r.request().url().split('/').pop(), contentType: 'application/octet-stream' }));
  }
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if ((m.type() === 'error' && !/Failed to load resource/.test(m.text())) || (m.type() === 'warning' && /effects frame|matte gl/.test(m.text()))) errors.push(m.type() + ': ' + m.text().slice(0, 200)); });
  await page.goto(BASE + '/__t.html' + (realMode ? '?real=1' : ''));
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  return { ctx, page };
}

// =====================================================================  1. ids, registry, thumbnails, scenes (no camera needed)
{
  const { ctx, page } = await openPage(false);
  const r = await page.evaluate(async () => {
    const { B } = T; const out = {};
    out.mig = Object.fromEntries(['none', 'blur', 'blur-strong', 'sunset', 'ocean', 'studio', 'forest', 'mumbai', 'aurora', 'bokeh', 'cozy', 'monsoon', 'space', 'photo', 'rubbish', undefined, null].map(k => [String(k), B.migrateBackground(k)]));
    out.ids = B.BACKGROUNDS.map(b => b.id);
    out.labels = B.BACKGROUNDS.every(b => typeof b.label === 'string' && b.label.length > 1);
    out.unique = new Set(out.ids).size === out.ids.length;
    out.reexport = (await import('/js/effects.js')).BACKGROUNDS === B.BACKGROUNDS;
    out.thumbs = {};
    // First request: a plain tile at once, the real picture is drawn when the browser is idle (and later requests are instant).
    const tiles = {};
    for (const b of B.BACKGROUNDS) { if (b.id === 'none') continue; const c = document.createElement('canvas'); c.width = c.height = 80; b.thumb(c.getContext('2d'), 80, 80); tiles[b.id] = c; }
    out.placeholderFirst = Object.values(tiles).every(c => T.patchStd(c, 0, 0, 80, 80) < 1);
    await B.thumbsReady();
    out.filledIn = Object.values(tiles).filter(c => T.patchStd(c, 0, 0, 80, 80) > 8).length;   // the waiting tiles were filled in by themselves
    for (const b of B.BACKGROUNDS) {
      if (b.id === 'none') continue;
      const c = document.createElement('canvas'); c.width = c.height = 80;
      try { b.thumb(c.getContext('2d'), 80, 80); out.thumbs[b.id] = T.patchStd(c, 0, 0, 80, 80); } catch (e) { out.thumbs[b.id] = 'ERR ' + e.message; }
    }
    // Every scene: builds at three aspect ratios, an overlay frame draws, animated overlays change the picture over time.
    out.scenes = {};
    for (const id of ['mumbai', 'aurora', 'bokeh', 'cozy', 'monsoon', 'space', 'studio', 'forest']) {
      const res = { ok: true, sizes: [], animated: false, buildMs: [] };
      for (const [w, h] of [[960, 540], [960, 720], [540, 960]]) {
        try {
          const t0 = performance.now(); const bd = B.makeBackdrop(id, w, h); res.buildMs.push(Math.round(performance.now() - t0));
          const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
          g.drawImage(bd.base, 0, 0);
          res.sizes.push(bd.base.width === w && bd.base.height === h && bd.small.width === 48 && Math.abs(bd.small.height - 48 * h / w) < 1.5 && T.patchStd(c, 0, 0, w, h) > 8);
          if (bd.overlay) {
            const a = document.createElement('canvas'); a.width = w; a.height = h; a.getContext('2d').drawImage(bd.base, 0, 0); bd.overlay(a.getContext('2d'), 1.0);
            const b2 = document.createElement('canvas'); b2.width = w; b2.height = h; b2.getContext('2d').drawImage(bd.base, 0, 0); bd.overlay(b2.getContext('2d'), 9.0);
            const da = a.getContext('2d').getImageData(0, 0, w, h).data, db = b2.getContext('2d').getImageData(0, 0, w, h).data;
            let diff = 0; for (let i = 0; i < da.length; i += 16) diff += Math.abs(da[i] - db[i]);
            if (diff > 200) res.animated = true;
            // the lighter version used on slow devices also draws and also moves
            const l1 = document.createElement('canvas'); l1.width = w; l1.height = h; l1.getContext('2d').drawImage(bd.base, 0, 0); bd.overlay(l1.getContext('2d'), 1.0, true);
            const l2 = document.createElement('canvas'); l2.width = w; l2.height = h; l2.getContext('2d').drawImage(bd.base, 0, 0); bd.overlay(l2.getContext('2d'), 9.0, true);
            const dl1 = l1.getContext('2d').getImageData(0, 0, w, h).data, dl2 = l2.getContext('2d').getImageData(0, 0, w, h).data;
            let dl = 0; for (let i = 0; i < dl1.length; i += 16) dl += Math.abs(dl1[i] - dl2[i]);
            res.liteAnimated = (res.liteAnimated !== false) && dl > 100;
          }
        } catch (e) { res.ok = false; res.err = e.message; }
      }
      out.scenes[id] = res;
    }
    // Retired / unknown ids still produce a scene and keep the requested id (so the cache hits).
    const bs = B.makeBackdrop('sunset', 320, 180), bo = B.makeBackdrop('nonsense', 320, 180);
    const mm = B.makeBackdrop('mumbai', 320, 180), px = (c, x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
    out.aliasKeepsId = bs.id === 'sunset' && bo.id === 'nonsense' && bs.base.width === 320 && bo.base.width === 320
      && [[10, 10], [160, 100], [300, 170]].every(([x, y]) => px(bs.base, x, y).join() === px(mm.base, x, y).join());
    return out;
  });
  step('1a. retired ids map to scenes that exist (sunset->mumbai, ocean->aurora), unknown -> none, blur ids kept',
    r.mig.sunset === 'mumbai' && r.mig.ocean === 'aurora' && r.mig.studio === 'studio' && r.mig.forest === 'forest' && r.mig.none === 'none' && r.mig.blur === 'blur' && r.mig['blur-strong'] === 'blur-strong' && r.mig.rubbish === 'none' && r.mig.undefined === 'none' && r.mig.null === 'none', JSON.stringify(r.mig));
  step('1b. "photo" is only valid once a photo is loaded (session only)', r.mig.photo === 'none');
  step('1c. list: none, blur, blur-strong + 8 scenes + photo, unique ids, labels, re-exported from effects.js',
    r.ids.join() === 'none,blur,blur-strong,mumbai,aurora,bokeh,cozy,monsoon,space,studio,forest,photo' && r.unique && r.labels && r.reexport, r.ids.join());
  step('1d. every option except None draws its own non-blank thumbnail (plain tile first, picture when idle, instant afterwards)', Object.values(r.thumbs).every(v => typeof v === 'number' && v > 8) && Object.keys(r.thumbs).length === 11 && r.placeholderFirst && r.filledIn === 11, `${JSON.stringify(r.thumbs)} filledIn ${r.filledIn}`);
  for (const [id, s] of Object.entries(r.scenes)) {
    step(`1e. scene ${id}: builds at 960x540, 960x720 and 540x960 (not blank), build ${s.buildMs.join('/')} ms`, s.ok && s.sizes.length === 3 && s.sizes.every(Boolean), s.err || '');
  }
  step('1f. animated scenes move (mumbai, aurora, bokeh, cozy, monsoon, space, forest), also in their light version for slow devices; studio is still',
    ['mumbai', 'aurora', 'bokeh', 'cozy', 'monsoon', 'space', 'forest'].every(id => r.scenes[id].animated && r.scenes[id].liteAnimated) && !r.scenes.studio.animated);
  step('1g. a retired id (sunset) draws the same scene as its replacement (mumbai); unknown ids still give a scene; the requested id is kept', r.aliasKeepsId);
  await ctx.close();
}

// =====================================================================  2. matte maths (temporal stability, motion), blur without bleed
{
  const { ctx, page } = await openPage(false);
  const r = await page.evaluate(async () => {
    const { M } = T; const out = {};
    const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
    const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
    // static picture, per-frame noise on the model output: the matte must not flicker
    const mk = (cx, noise) => { const c = new Float32Array(65536); for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const e = Math.hypot((x - cx) / 70, (y - 128) / 90); c[y * 256 + x] = clamp01(0.5 + (1 - e) * 3 + (T.rnd() - 0.5) * 2 * noise); } return c; };
    const m = new M.Matte(); const frames = [];
    for (let i = 0; i < 40; i++) { const c = mk(128, 0.12); m.update(c, 256, 256, false); frames.push({ c, s: Float32Array.from(m.soft) }); }
    const oldA = c => clamp01((c - 0.25) / 0.5), newA = s => smooth(0.54, 0.66, s);
    const band = frames[0].c.map((_, i) => { let lo = 1, hi = 0; for (const f of frames) { const a = oldA(f.c[i]); lo = Math.min(lo, a); hi = Math.max(hi, a); } return hi > 0.02 && lo < 0.98 ? 1 : 0; });
    const mean = (fn, key) => { let s = 0, n = 0; for (let t = 5; t < 40; t++) for (let i = 0; i < 65536; i++) if (band[i]) { s += Math.abs(fn(frames[t][key][i]) - fn(frames[t - 1][key][i])); n++; } return s / n; };
    out.flickerOld = mean(oldA, 'c'); out.flickerNew = mean(newA, 's');
    // motion: the blob jumps 14 model-pixels per frame; the smoothed matte must follow (no ghost trail, no missing person)
    const m2 = new M.Matte(); let ghost = 0, miss = 0, person = 0;
    for (let i = 0; i < 14; i++) { const c = mk(60 + i * 10, 0.02); m2.update(c, 256, 256, false); if (i >= 3) for (let k = 0; k < 65536; k++) { const inst = oldA(c[k]), sm = newA(m2.soft[k]); if (inst > 0.9) person++; if (sm > 0.5 && inst < 0.1) ghost++; if (sm < 0.5 && inst > 0.9) miss++; } }
    out.ghostPct = 100 * ghost / person; out.missPct = 100 * miss / person;
    // NaN / out of range input must not poison the matte
    const bad = new Float32Array(65536).fill(NaN); bad[5] = 7; bad[6] = -3; const m3 = new M.Matte(); m3.update(bad, 256, 256, false); m3.update(bad, 256, 256, false);
    out.finite = Array.from(m3.soft).every(v => v >= 0 && v <= 1);
    // blur never bleeds the person's colour: red person on a green striped background
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d');
    for (let x = 0; x < 640; x += 20) { g.fillStyle = (x / 20) % 2 ? '#2e8b57' : '#9be3b4'; g.fillRect(x, 0, 20, 360); }
    g.fillStyle = '#ff0000'; g.fillRect(220, 40, 200, 320);
    const conf = new Float32Array(65536); for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) conf[y * 256 + x] = (x / 256 >= 220 / 640 && x / 256 <= 420 / 640 && y / 256 >= 40 / 360) ? 1 : 0;
    const bb = new M.BackdropBlur(96); const tiny = bb.render(c, conf, 256, 256, 2, 4);
    const d = tiny.getContext('2d').getImageData(0, 0, 96, 96).data;
    // Excess red anywhere in the blurred result (the background has none: its red is never above its green)
    let anyRed = 0; for (let i = 0; i < d.length; i += 4) anyRed = Math.max(anyRed, d[i] - d[i + 1]);
    out.blurMaxRedExcess = anyRed;
    return out;
  });
  step('2a. matte flicker on a static picture is at least 4x lower than the old hard threshold on raw confidence', r.flickerNew * 4 < r.flickerOld, `old ${r.flickerOld.toFixed(4)} new ${r.flickerNew.toFixed(4)} (mean |delta alpha| in the edge band)`);
  step('2b. fast motion (14 model px per frame): no ghost trail, nothing missing', r.ghostPct < 1 && r.missPct < 1, `ghost ${r.ghostPct.toFixed(2)}% miss ${r.missPct.toFixed(2)}%`);
  step('2c. NaN / out-of-range model output cannot poison the matte', r.finite);
  step('2d. background blur never mixes the person\'s colour into the background (red person, green stripes)', r.blurMaxRedExcess < 12, `max red excess ${r.blurMaxRedExcess.toFixed(1)}`);
  await ctx.close();
}

// =====================================================================  3. the Effects pipeline with a stub segmenter (no models needed)
async function pipelineChecks(label, realMode) {
  const { ctx, page } = await openPage(realMode);
  const tag = n => `${label} ${n}`;
  const ready = await page.evaluate(async real => {
    const { fx } = T;
    fx.adaptive = false; fx.quality = 2;
    if (real) { fx.settings.background = 'blur'; await fx.ensureModels(); } else fx.segmenter = T.stubSegmenter();
    return { gl: Boolean(fx.glMatte()) };
  }, realMode);
  console.log(`INFO ${label}: ${ready.gl ? 'WebGL2 matte refinement is available (checked both the GPU and the canvas path)' : 'no WebGL2 in this browser: only the canvas path is checked'}`);
  const ids = ['blur', 'blur-strong', 'mumbai', 'aurora', 'bokeh', 'cozy', 'monsoon', 'space', 'studio', 'forest', 'sunset', 'ocean', 'photo'];
  for (const mode of ready.gl ? ['gpu', 'canvas'] : ['canvas']) {
    const res = await page.evaluate(async ([ids, mode, realMode]) => {
      const { fx, video } = T; fx.glOff = mode === 'canvas'; if (mode === 'gpu') fx.gl = undefined;
      const out = {};
      for (const id of ids) {
        fx.settings.background = id; fx.settings.mask = 'none'; fx.settings.filter = 'none';
        let err = null;
        try { for (let i = 0; i < 7; i++) { T.drawFrame({ noise: 3 }); await T.nextFrame(); fx.render(video); } } catch (e) { err = e.message; }
        const o = fx.out;
        out[id] = { err, size: [o.width, o.height], std: T.patchStd(o, 0, 0, o.width, o.height) };
        if (!realMode) {
          const cx = Math.round(o.width * 0.5), cy = Math.round(o.height * 0.55);
          const camC = T.px(T.cam, 640, 396);                       // person centre in the camera picture
          out[id].centre = T.px(o, cx, cy); out[id].cam = camC;
          out[id].corner = T.px(o, 20, 20); out[id].corner2 = T.px(o, o.width - 20, o.height - 20);
          out[id].stripeStd = T.patchStd(o, 20, 20, 200, 60);       // local contrast of the background (camera stripes: ~45)
          const bd = fx.backdrop; if (bd && id !== 'blur' && id !== 'blur-strong') { out[id].bdCorner = T.px(bd.base, 20, 20); }
        }
      }
      return out;
    }, [ids, mode, realMode]);
    for (const id of ids) {
      const s = res[id];
      step(tag(`3b. ${mode} path, background ${id}: 7 frames render without exceptions at 960x540`), !s.err && s.size[0] === 960 && s.size[1] === 540 && s.std > 6, s.err || `std ${s.std.toFixed(0)}`);
    }
    if (!realMode) {
      const near = (a, b, t) => a.every((v, i) => Math.abs(v - b[i]) <= t);
      step(tag(`3c. ${mode} path: the person is kept untouched inside the matte (all backgrounds)`), ids.every(id => near(res[id].centre, res[id].cam, 14)), ids.map(id => res[id].centre.join(',') + '/' + res[id].cam.join(',')).slice(0, 2).join(' '));
      step(tag(`3d. ${mode} path: scenes replace the room (corner differs from the camera stripes)`), ['mumbai', 'aurora', 'bokeh', 'cozy', 'monsoon', 'space', 'studio', 'forest'].every(id => !near(res[id].corner, [46, 139, 87], 30) && !near(res[id].corner, [155, 227, 180], 30)));
      step(tag(`3e. ${mode} path: blur flattens the stripes (local contrast drops 3x) and strong blur more than blur`), res.blur.stripeStd * 3 < 45 && res['blur-strong'].stripeStd <= res.blur.stripeStd + 1, `std ${res.blur.stripeStd.toFixed(1)} / ${res['blur-strong'].stripeStd.toFixed(1)}`);
    }
  }
  // fail closed: no matte available -> the camera is never shown; once one exists, it is reused
  const fc = await page.evaluate(async real => {
    const { fx, video } = T; fx.glOff = false; fx.gl = undefined;
    fx.settings.background = 'studio';
    const seg = fx.segmenter, boom = () => { throw new Error('segmenter down'); };
    const out = {};
    fx.matte.reset(); fx.segmenter = { segmentForVideo: boom };
    T.drawFrame(); await T.nextFrame(); fx.render(video);
    const cx = Math.round(fx.out.width * 0.5), cy = Math.round(fx.out.height * 0.55);
    out.noMatteCentre = T.px(fx.out, cx, cy); out.cam = T.px(T.cam, 640, 396); out.bd = T.px(fx.backdrop.base, cx, cy);
    fx.segmenter = seg; T.drawFrame(); await T.nextFrame(); fx.render(video); fx.render(video);
    fx.segmenter = { segmentForVideo: boom };
    T.drawFrame(); await T.nextFrame(); fx.render(video);
    out.keptMatteCentre = T.px(fx.out, cx, cy);
    fx.segmenter = seg;
    return out;
  }, realMode);
  const near3 = (a, b, t) => a.every((v, i) => Math.abs(v - b[i]) <= t);
  step(tag('3g. segmenter failing before any matte exists: only the background is drawn, never the raw camera'), near3(fc.noMatteCentre, fc.bd, 30) && !near3(fc.noMatteCentre, fc.cam, 30), `centre ${fc.noMatteCentre} cam ${fc.cam} bg ${fc.bd}`);
  if (!realMode) step(tag('3h. segmenter failing after a matte exists: the last matte is reused (person stays)'), near3(fc.keptMatteCentre, fc.cam, 30), `centre ${fc.keptMatteCentre}`);
  // quality tiers and adaptation
  const q = await page.evaluate(async () => {
    const { fx, video } = T; const out = {};
    fx.settings.background = 'mumbai'; fx.adaptive = true; fx.setQuality(2); out.start = fx.quality;
    out.sizes = [];
    for (const k of [2, 1, 0]) { fx.setQuality(k); out.sizes.push(fx.outSize(video).join('x')); }
    fx.setQuality(2);
    const t0 = performance.now(); for (let i = 0; i < 30; i++) fx.adapt(120, t0 + i * 130); out.afterSlow = fx.quality;
    for (let i = 0; i < 30; i++) fx.adapt(120, t0 + 4000 + i * 130); out.afterVerySlow = fx.quality;
    // a fast device is promoted again, but only after the waiting time
    for (let i = 0; i < 200; i++) fx.adapt(6, t0 + 5000 + i * 40); out.tooSoon = fx.quality;
    for (let i = 0; i < 200; i++) fx.adapt(6, t0 + 400000 + i * 40); out.afterFast = fx.quality;
    fx.adaptive = false; fx.setQuality(2);
    return out;
  });
  step(tag('3i. quality tiers give 960x540 / 640x360 / 480x270 for a 1280x720 camera (never upscaled)'), q.sizes.join() === '960x540,640x360,480x270', q.sizes.join());
  step(tag('3j. a device that cannot hold 24 fps steps down (2 -> 1 -> 0); a fast one steps up again only after the waiting time'), q.afterSlow === 1 && q.afterVerySlow === 0 && q.tooSoon === 0 && q.afterFast >= 1, JSON.stringify(q));
  await ctx.close();
}
await pipelineChecks('synthetic', false);

// =====================================================================  4. "Your photo": picker, huge image, bad files
{
  const { ctx, page } = await openPage(false);
  const sample = SP + '/photo-test.png';
  const png = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 1500, 2000); g.fillStyle = '#0000ff'; g.fillRect(1500, 0, 1500, 2000); return c.toDataURL('image/png'); });
  fs.writeFileSync(sample, Buffer.from(png.split(',')[1], 'base64'));
  const photoTile = await page.evaluate(() => { const b = T.B.BACKGROUNDS.find(x => x.id === 'photo'); return { hasPick: typeof b.pick === 'function' }; });
  step('4a. the "Your photo" option has a pick() that opens the file picker from a click', photoTile.hasPick);
  // The picker: a hidden <input type=file>. Drive it with Playwright's file chooser.
  const chooser = page.waitForEvent('filechooser', { timeout: 8000 });
  const picked = page.evaluate(() => T.B.BACKGROUNDS.find(x => x.id === 'photo').pick(false));
  (await chooser).setFiles(sample);
  const ok = await picked;
  const after = await page.evaluate(() => {
    const { B } = T; const bd = B.makeBackdrop('photo', 960, 540);
    return { has: B.hasCustomPhoto(), mig: B.migrateBackground('photo'), left: T.px(bd.base, 10, 270), right: T.px(bd.base, 950, 270), w: bd.base.width };
  });
  step('4b. picking a 3000x2000 image works and the photo is cover-fitted (left red, right blue, fills the frame)', ok === true && after.has && after.mig === 'photo' && after.left[0] > 200 && after.left[2] < 40 && after.right[2] > 200 && after.right[0] < 40 && after.w === 960, JSON.stringify(after));
  // when a photo is already loaded and the tile is not the active one, pick(false) just selects it (no dialog)
  const reuse = await page.evaluate(async () => (await T.B.BACKGROUNDS.find(x => x.id === 'photo').pick(false)));
  step('4c. with a photo already loaded, choosing the tile selects it without a dialog', reuse === true);
  const bad = await page.evaluate(async () => {
    const { B } = T; const r = {};
    r.text = await B.setCustomPhoto(new File(['hello'], 'x.png', { type: 'text/plain' }));
    r.corrupt = await B.setCustomPhoto(new File([new Uint8Array(500)], 'x.png', { type: 'image/png' }));
    r.huge = await B.setCustomPhoto(new File([new Uint8Array(41 * 1024 * 1024)], 'x.png', { type: 'image/png' }));
    r.none = await B.setCustomPhoto(null);
    r.stillHas = B.hasCustomPhoto();
    return r;
  });
  step('4d. a non-image, a corrupt file, an oversized file (>40 MB) and no file are all refused, and the earlier photo is kept', bad.text === false && bad.corrupt === false && bad.huge === false && bad.none === false && bad.stillHas === true, JSON.stringify(bad));
  const tile = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = c.height = 80; T.B.BACKGROUNDS.find(x => x.id === 'photo').thumb(c.getContext('2d'), 80, 80); await T.B.thumbsReady(); return { l: T.px(c, 6, 20), r: T.px(c, 74, 20) }; });
  step('4e. once chosen, the tile shows the person\'s own photo', tile.l[0] > 200 && tile.r[2] > 200, JSON.stringify(tile));
  const used = await page.evaluate(async () => {
    const { fx, video } = T; fx.segmenter = T.stubSegmenter(); fx.adaptive = false; fx.quality = 2; fx.settings.background = 'photo';
    for (let i = 0; i < 5; i++) { T.drawFrame(); await T.nextFrame(); fx.render(video); }
    return { corner: T.px(fx.out, 12, 12), corner2: T.px(fx.out, fx.out.width - 12, 12) };
  });
  step('4f. the Effects pipeline draws the chosen photo behind the person', used.corner[0] > 200 && used.corner2[2] > 200, JSON.stringify(used));
  const cleared = await page.evaluate(() => { T.B.clearCustomPhoto(); return { has: T.B.hasCustomPhoto(), mig: T.B.migrateBackground('photo') }; });
  step('4g. forgetting the photo makes "photo" resolve to none again (nothing remembered across sessions)', !cleared.has && cleared.mig === 'none');
  fs.rmSync(sample, { force: true });
  await ctx.close();
}

// =====================================================================  5. real MediaPipe segmenter on a portrait (when available)
if (real) {
  await pipelineChecks('real', true);
  const { ctx, page } = await openPage(true);
  await page.evaluate(async () => { const { fx } = T; fx.adaptive = false; fx.quality = 2; fx.settings.background = 'blur'; await fx.ensureModels(); });
  const r = await page.evaluate(async () => {
    const { fx, video, M } = T; const out = {};
    const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
    const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
    const g = fx.segctx;
    const grab = ts => { g.drawImage(video, 0, 0, 256, 256); const res = fx.segmenter.segmentForVideo(fx.segIn, ts); const d = Float32Array.from(res.confidenceMasks[0].getAsFloat32Array()); res.close(); return d; };
    const oldA = c => clamp01((c - 0.25) / 0.5), newA = s => smooth(0.54, 0.66, s);
    const matte = new M.Matte(); let ts = performance.now() + 1000; const frames = [];
    for (let i = 0; i < 30; i++) { T.drawFrame({ noise: 8 }); await T.nextFrame(); const c = grab(ts += 41); matte.update(c, 256, 256, false); frames.push({ c, s: Float32Array.from(matte.soft) }); }
    const n = 65536, band = new Uint8Array(n);
    for (const f of frames) for (let i = 0; i < n; i++) { const a = oldA(f.c[i]); if (a > 0.02 && a < 0.98) band[i] = 1; }
    const stat = (fn, key) => { let s = 0, c = 0; for (let t = 4; t < frames.length; t++) for (let i = 0; i < n; i++) if (band[i]) { s += Math.abs(fn(frames[t][key][i]) - fn(frames[t - 1][key][i])); c++; } return s / c; };
    out.old = stat(oldA, 'c'); out.new = stat(newA, 's');
    // person found at all: share of confident-person pixels in a sensible range for a head-and-shoulders portrait
    let person = 0; for (let i = 0; i < n; i++) if (matte.soft[i] > 0.6) person++;
    out.personShare = person / n;
    return out;
  });
  step('5a. real segmenter, noisy static portrait: matte flicker is at least 4x lower than the old pipeline', r.new * 4 < r.old, `old ${r.old.toFixed(4)} new ${r.new.toFixed(4)}`);
  step('5b. real segmenter finds the person (10-80% of the frame is person)', r.personShare > 0.1 && r.personShare < 0.8, (r.personShare * 100).toFixed(0) + '%');
  const t = await page.evaluate(async () => {
    const { fx, video } = T; const tm = {};
    for (const mode of ['gpu', 'canvas']) {
      fx.glOff = mode === 'canvas'; if (mode === 'gpu') fx.gl = undefined;
      fx.settings.background = 'mumbai';
      const tot = [], seg = [];
      for (let i = 0; i < 14; i++) { T.drawFrame({ noise: 3 }); await T.nextFrame(); const t0 = performance.now(); fx.render(video); fx.ctx.getImageData(0, 0, 1, 1); const d = performance.now() - t0; if (i >= 4) { tot.push(d); seg.push(fx.stats.seg); } }
      const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
      tm[mode] = { total: med(tot), seg: med(seg) };
    }
    return tm;
  });
  console.log(`INFO render() per frame in headless Chromium (software GL, CPU segmenter, shared machine): gpu path ${t.gpu.total.toFixed(0)} ms (segmentation ${t.gpu.seg.toFixed(0)} ms), canvas path ${t.canvas.total.toFixed(0)} ms (segmentation ${t.canvas.seg.toFixed(0)} ms)`);
  step('5c. frame cost is sane (under 2 s even on a shared software-GL runner)', t.gpu.total < 2000 && t.canvas.total < 2000);
  await ctx.close();
} else skip('5. real MediaPipe segmenter on a portrait', 'need PORTRAIT, MP_DIR and MODELS_DIR (see the top of this file)');

step('6. no page errors or effects warnings during the whole run', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
