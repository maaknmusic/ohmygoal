// =====================================================================
// Video effects: background blur/replacement, face masks and color filters.
// Runs on-device with MediaPipe (person segmentation + face landmarks); the
// processed canvas becomes the video track that is shown and sent.
// =====================================================================

// Backgrounds are original scenes drawn in code (see backgrounds.js); the person matte and the background blur
// maths live in matte.js. Re-exported here so app.js keeps importing everything from effects.js.
import { BACKGROUNDS, migrateBackground, makeBackdrop, backdropVersion, BLUR_SIGMA } from './backgrounds.js';
import { Matte, BackdropBlur } from './matte.js';
import { MatteGL } from './matte-gl.js';
export { BACKGROUNDS, migrateBackground };

// Face masks (kind 'full' covers the whole face = anonymous; 'eyes' / 'crown' are accessories) are original vector artwork
// drawn in code: see masks.js. Re-exported here so app.js keeps importing them from effects.js.
import { MASKS, FaceTracker, drawMask, drawMaskEmblem, findMask, migrateMask } from './masks.js';
export { MASKS, migrateMask };

/** Effect choices saved by older versions: retired ids are mapped onto current ones. (Mask ids: migrateMask in masks.js.) */
export function migrateFx(fx) {
    const out = { ...fx };
    out.mask = migrateMask(out.mask);
    return out;
}

export const FILTERS = [
    { id: 'none', label: 'None', css: 'none' },
    { id: 'beauty', label: 'Beauty', css: 'brightness(1.06) saturate(1.08)', soften: true },
    { id: 'warm', label: 'Warm', css: 'sepia(0.25) saturate(1.3) hue-rotate(-8deg)' },
    { id: 'cool', label: 'Cool', css: 'saturate(1.1) hue-rotate(12deg) brightness(1.03)' },
    { id: 'bw', label: 'B&W', css: 'grayscale(1) contrast(1.1)' },
    { id: 'vintage', label: 'Vintage', css: 'sepia(0.5) contrast(0.95) brightness(1.05)' },
    { id: 'vivid', label: 'Vivid', css: 'saturate(1.6) contrast(1.1)' },
];

// Output quality tiers: long side of the processed frame (never more than the camera gives). The tier adapts to the
// device (see adapt()): 2 = 960 px with edge light-wrap, 1 = 640 px, 0 = 480 px for very slow devices.
const TIER_SIZE = [480, 640, 960];
const FPS = 24;
const SEG_SIZE = 256; // the segmentation model works on 256 x 256 anyway: feed it exactly that

/** True when ctx.filter really works (Safari has no canvas filters, and `'filter' in ctx` is not a reliable test). */
let filterOk;
function canvasFilterWorks() {
    if (filterOk === undefined) {
        try {
            const c = document.createElement('canvas'); c.width = c.height = 4;
            const g = c.getContext('2d', { willReadFrequently: true });
            g.filter = 'brightness(0)'; g.fillStyle = '#fff'; g.fillRect(0, 0, 4, 4);
            filterOk = g.getImageData(1, 1, 1, 1).data[0] === 0;
        } catch { filterOk = false; }
    }
    return filterOk;
}

/** A timer driven from a worker, so frames keep flowing when the tab is in the background. */
function workerTicker(ms, fn) {
    try {
        const src = `setInterval(() => postMessage(0), ${ms});`;
        const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        w.onmessage = fn;
        return () => w.terminate();
    } catch {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
    }
}

export class Effects {
    constructor(cfg) {
        this.cfg = cfg;
        this.settings = { background: 'none', mask: 'none', filter: 'none' };
        this.vision = null;
        this.segmenter = null;
        this.landmarker = null;
        this.loading = null;
        this.video = document.createElement('video');
        this.video.muted = true;
        this.video.playsInline = true;
        this.out = document.createElement('canvas');
        this.ctx = this.out.getContext('2d');
        this.person = document.createElement('canvas');
        this.pctx = this.person.getContext('2d');
        this.small = document.createElement('canvas');
        this.sctx = this.small.getContext('2d');
        this.mid = document.createElement('canvas');
        this.midctx = this.mid.getContext('2d');
        this.supportsFilter = canvasFilterWorks();
        // Person matte (temporal smoothing + soft threshold), segmentation input and background blur: see matte.js
        this.matte = new Matte();
        this.segIn = document.createElement('canvas');
        this.segIn.width = this.segIn.height = SEG_SIZE;
        this.segctx = this.segIn.getContext('2d');
        this.segctx.imageSmoothingQuality = 'high';
        this.bgBlur = null; // created the first time a blur background is used
        this.backdrop = null; // the cached scene for the current background and size
        this.lastMatteTs = 0;
        this.gl = undefined; // GPU matte refinement (matte-gl.js), created on first use; this.glOff = true falls back to the canvas path
        // Output quality tier (see TIER_SIZE). Phones and small laptops start one tier lower and move up if they keep up.
        const weak = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '') || (navigator.hardwareConcurrency || 8) <= 4;
        this.quality = weak ? 1 : 2;
        this.adaptive = true;
        this.costEma = 0; this.slowFrames = 0; this.fastFrames = 0; this.lastTierChange = 0; this.upDelay = 12000;
        this.face = null; // smoothed face geometry
        this.track = null;
        this.stopTicker = null;
        this.lastTs = 0;
        this.busy = false;
    }

    get active() {
        const s = this.settings;
        return s.background !== 'none' || s.mask !== 'none' || s.filter !== 'none';
    }

    /** Load MediaPipe and the models a setting needs. Safe to call repeatedly. */
    async ensureModels() {
        const needSeg = this.settings.background !== 'none';
        const needFace = this.settings.mask !== 'none';
        if ((!needSeg || this.segmenter) && (!needFace || this.landmarker)) return;
        this.loading ||= (async () => {
            const mp = this.mp ||= await import(this.cfg.libUrl);
            this.vision ||= await mp.FilesetResolver.forVisionTasks(this.cfg.wasmUrl);
            const create = async (Task, opts) => {
                for (const delegate of ['GPU', 'CPU']) {
                    try { return await Task.createFromOptions(this.vision, { ...opts, baseOptions: { ...opts.baseOptions, delegate } }); }
                    catch (e) { if (delegate === 'CPU') throw e; }
                }
            };
            if (this.settings.background !== 'none' && !this.segmenter) {
                this.segmenter = await create(mp.ImageSegmenter, {
                    baseOptions: { modelAssetPath: this.cfg.segmenterModel },
                    runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
                });
            }
            if (this.settings.mask !== 'none' && !this.landmarker) {
                this.landmarker = await create(mp.FaceLandmarker, {
                    baseOptions: { modelAssetPath: this.cfg.faceModel },
                    runningMode: 'VIDEO', numFaces: 1,
                });
            }
        })();
        try { await this.loading; } finally { this.loading = null; }
        return this.ensureModels(); // a setting may have changed while loading
    }

    /** Start processing a camera stream. Returns the processed video track. */
    async start(sourceStream) {
        this.video.srcObject = sourceStream;
        await this.video.play().catch(() => {});
        if (!this.track) {
            this.track = this.out.captureStream(FPS).getVideoTracks()[0];
            this.stopTicker = workerTicker(Math.round(1000 / FPS), () => this.frame());
        }
        return this.track;
    }

    setSource(sourceStream) {
        this.video.srcObject = sourceStream;
        this.video.play().catch(() => {});
    }

    async set(partial) {
        Object.assign(this.settings, partial);
        await this.ensureModels();
    }

    stop() {
        this.stopTicker?.();
        this.stopTicker = null;
        this.track?.stop();
        this.track = null;
        this.video.srcObject = null;
    }

    frame() {
        const v = this.video;
        const now = performance.now();
        if (this.busy || now < (this.nextAt || 0) || !v.videoWidth || v.readyState < 2) return;
        this.busy = true;
        try { this.render(v); } catch (e) { console.warn('effects frame', e); } finally {
            this.busy = false;
            // On slow devices, drop frames instead of freezing the page: wait 1.5x the last render time.
            const took = performance.now() - now;
            this.nextAt = now + Math.max(1000 / FPS, took * 1.5);
            this.adapt(took, now);
        }
    }

    render(v) {
        const [W, H] = this.outSize(v);
        for (const c of [this.out, this.person]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        const ts = Math.max(performance.now(), this.lastTs + 1);
        this.lastTs = ts;
        const s = this.settings;
        const filter = FILTERS.find(f => f.id === s.filter) || FILTERS[0];
        const ctx = this.ctx;

        // 1. The person layer (whole frame, with color filter)
        const drawFrame = (target, tctx) => {
            if (this.supportsFilter) tctx.filter = filter.css;
            tctx.drawImage(v, 0, 0, target.width, target.height);
            if (filter.soften) {
                // Soft-focus "beauty": blend a blurred copy on top.
                tctx.globalAlpha = 0.35;
                tctx.drawImage(this.blurred(v, 0.12), 0, 0, target.width, target.height);
                tctx.globalAlpha = 1;
            }
            if (this.supportsFilter) tctx.filter = 'none';
        };

        // 2. Background: the person cut out of the camera frame over a new scene or a blurred copy of the room.
        // (If the segmenter is not ready the frame is shown as it is: the app only starts this once the models loaded.)
        if (s.background !== 'none' && this.segmenter) this.drawWithBackground(v, ts, W, H, s.background, filter, drawFrame);
        else drawFrame(this.out, ctx);

        // 3. Face mask
        const mask = findMask(s.mask);
        if (mask && mask.id !== 'none' && this.landmarker) {
            let drawn = false;
            try {
                const face = this.trackFace(v, ts, W, H);
                if (face) { this.drawMask(mask, face, ts, W, H); drawn = true; }
            } catch (e) { console.warn('face mask failed on this frame', e); }
            if (!drawn && mask.kind === 'full') {
                // Face not found (or the mask failed) while an anonymity mask is on: hide everything rather than reveal the face.
                ctx.drawImage(this.blurred(v, 0.03), 0, 0, W, H);
                ctx.fillStyle = 'rgba(15,23,42,0.35)';
                ctx.fillRect(0, 0, W, H);
                drawMaskEmblem(ctx, mask, W, H, ts / 1000); // the mask's own vector artwork, drawn large in the middle
            }
        }
    }

    /** Output size for this camera frame: long side per quality tier, never upscaled, even numbers (encoders like them). */
    outSize(v) {
        const vw = v.videoWidth, vh = v.videoHeight;
        const k = Math.min(1, TIER_SIZE[this.quality] / Math.max(vw, vh));
        return [Math.max(2, Math.round(vw * k / 2) * 2), Math.max(2, Math.round(vh * k / 2) * 2)];
    }

    /** Move between quality tiers: a slow device keeps its frame rate, a fast one gets the sharper picture. */
    adapt(took, now) {
        if (!this.adaptive) return;
        const budget = 1000 / FPS;
        this.costEma = this.costEma ? this.costEma * 0.9 + took * 0.1 : took;
        if (this.costEma > budget * 1.1) { this.slowFrames++; this.fastFrames = 0; }
        else if (this.costEma < budget * 0.45) { this.fastFrames++; this.slowFrames = 0; }
        else this.slowFrames = this.fastFrames = 0;
        if (this.slowFrames > 24 && this.quality > 0) {
            // Dropping right after a recent upgrade means the higher tier does not suit this device: wait longer before trying again.
            if (now - this.lastTierChange < 30000) this.upDelay = Math.min(this.upDelay * 2, 240000);
            this.setQuality(this.quality - 1, now);
        } else if (this.fastFrames > 120 && this.quality < 2 && now - this.lastTierChange > this.upDelay) this.setQuality(this.quality + 1, now);
    }
    setQuality(q, now = performance.now()) {
        this.quality = q; this.lastTierChange = now; this.slowFrames = this.fastFrames = 0; this.costEma = 0;
    }

    /** The camera person over a background. Never shows the raw camera: if no matte exists yet, only the background is drawn. */
    drawWithBackground(v, ts, W, H, bgId, filter, drawFrame) {
        const ctx = this.ctx, p = this.pctx, st = this.stats ||= {};
        const tier = this.quality, t0 = performance.now();
        const gl = this.glMatte();                            // GPU edge refinement, or null (then the canvas path below is used)
        const matte = this.updateMatte(v, ts, !gl);          // truthy once a matte exists (an alpha canvas on the canvas path)
        const t1 = performance.now();
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

        // Background
        let scene = null;
        const level = BLUR_SIGMA[bgId];
        if (level) {
            this.bgBlur ||= new BackdropBlur(96);
            const n = this.bgBlur.n, sigma = level * Math.max(W, H);
            // The blurred room changes slowly: on the weaker tiers it is refreshed every second frame (the person is still current every frame).
            if (tier === 2 || !this.blurTiny || (this.blurTick = (this.blurTick || 0) + 1) % 2 === 0) {
                this.blurTiny = this.bgBlur.render(this.segIn, this.matte.frames ? this.matte.soft : null, this.matte.w, this.matte.h, sigma / (W / n), sigma / (H / n));
            }
            let tiny = this.blurTiny;
            if (this.supportsFilter && filter.css !== 'none') { // the colour filter is applied to the tiny image: much cheaper than at full size
                this.tinyF ||= document.createElement('canvas');
                if (this.tinyF.width !== n) this.tinyF.width = this.tinyF.height = n;
                const g = this.tinyF.getContext('2d'); g.filter = filter.css; g.drawImage(tiny, 0, 0); g.filter = 'none';
                tiny = this.tinyF;
            }
            ctx.drawImage(tiny, 0, 0, W, H);
        } else {
            let bd = this.backdrop;
            if (!bd || bd.id !== bgId || bd.w !== W || bd.h !== H || bd.version !== backdropVersion(bgId)) bd = this.backdrop = makeBackdrop(bgId, W, H);
            ctx.drawImage(bd.base, 0, 0);
            bd.overlay?.(ctx, ts / 1000);
            scene = bd;
        }
        const t2 = performance.now();
        if (!matte) { st.seg = t1 - t0; st.bg = t2 - t1; return; }

        // Person: the camera pixels through the matte.
        p.globalCompositeOperation = 'source-over';
        p.globalAlpha = 1;
        p.clearRect(0, 0, W, H);
        if (gl) {
            try { this.personGL(gl, v, W, H, scene, tier, drawFrame); }
            catch (e) { console.warn('matte gl failed, using the canvas path', e); this.glOff = true; return; } // this frame: background only
            st.seg = t1 - t0; st.bg = t2 - t1; st.person = performance.now() - t2;
            return;
        }
        // Canvas path: smooth upsample of the matte (a hair of feathering where canvas filters exist), then the camera pixels through it.
        p.imageSmoothingEnabled = true; p.imageSmoothingQuality = 'high';
        const feather = tier > 0 && this.supportsFilter;
        if (feather) p.filter = `blur(${(W / 960 * 0.8).toFixed(2)}px)`;
        p.drawImage(matte, 0, 0, W, H);
        if (feather) p.filter = 'none';
        p.globalCompositeOperation = 'source-in';
        drawFrame(this.person, p);
        // Light wrap: the new background's colour spills a little onto the person's edge. It also covers the thin fringe of the
        // old room that survives the matte.
        if (scene && tier === 2) {
            const ring = this.matte.ringCanvas();
            const g = this.wrap ||= document.createElement('canvas').getContext('2d');
            if (g.canvas.width !== ring.width || g.canvas.height !== ring.height) { g.canvas.width = ring.width; g.canvas.height = ring.height; }
            g.globalCompositeOperation = 'copy'; g.drawImage(ring, 0, 0);
            g.globalCompositeOperation = 'source-in'; g.imageSmoothingQuality = 'high'; g.drawImage(scene.small, 0, 0, g.canvas.width, g.canvas.height);
            p.globalCompositeOperation = 'source-atop'; p.globalAlpha = 0.6;
            p.drawImage(g.canvas, 0, 0, W, H);
            p.globalAlpha = 1;
        }
        p.globalCompositeOperation = 'source-over';
        ctx.drawImage(this.person, 0, 0);
        const t3 = performance.now();
        st.seg = t1 - t0; st.bg = t2 - t1; st.person = t3 - t2;
    }

    /** Smooth, portable blur of the camera frame (used by the beauty filter and the "face not found" screen): scale is the
     *  fraction of the output size. The small copy is enlarged in two smooth steps, so there are no visible blocks. */
    blurred(v, scale) {
        const W = this.out.width || 640, H = this.out.height || Math.round(W * v.videoHeight / v.videoWidth);
        const w = Math.max(8, Math.round(W * scale)), h = Math.max(6, Math.round(H * scale));
        if (this.small.width !== w || this.small.height !== h) { this.small.width = w; this.small.height = h; }
        this.sctx.imageSmoothingQuality = 'high';
        this.sctx.drawImage(v, 0, 0, w, h);
        const mw = Math.min(Math.round(W / 2), w * 3), mh = Math.min(Math.round(H / 2), h * 3);
        if (this.mid.width !== mw || this.mid.height !== mh) { this.mid.width = mw; this.mid.height = mh; }
        this.midctx.imageSmoothingQuality = 'high';
        this.midctx.drawImage(this.small, 0, 0, mw, mh);
        return this.mid;
    }

    /** The GPU matte refiner, created on first use. null when WebGL2 is unavailable or failed: the canvas path is used then. */
    glMatte() {
        if (this.glOff) return null;
        if (this.gl === undefined) this.gl = MatteGL.create();
        if (!this.gl || !this.gl.ok) { this.glOff = true; return null; } // also covers a lost context
        return this.gl;
    }

    /** Person layer on the GPU: camera pixels (with the colour filter) x a full-resolution, edge-snapped, anti-aliased matte, plus light wrap. */
    personGL(gl, v, W, H, scene, tier, drawFrame) {
        const p = this.pctx, m = this.matte, wrap = Boolean(scene) && tier === 2;
        gl.resize(W, H);
        gl.upload(m.conf8, m.w, m.h, v, wrap ? scene.small : null);
        drawFrame(this.person, p);
        const prm = { t: 0.6, soft: 0.06, radius: tier === 0 ? 0 : 3.5 * W / 960, wrap: 0.55, ...this.glParams };
        p.globalCompositeOperation = 'destination-in';
        p.drawImage(gl.draw(0, prm), 0, 0);
        if (wrap) { p.globalCompositeOperation = 'source-atop'; p.drawImage(gl.draw(1, prm), 0, 0); }
        p.globalCompositeOperation = 'source-over';
        this.ctx.drawImage(this.person, 0, 0);
    }

    /** Person matte for this frame from the segmenter, smoothed over time (Matte in matte.js). Returns the alpha canvas when
     *  wantCanvas, true when only the matte bytes were made, null when there is no matte yet. */
    updateMatte(v, ts, wantCanvas = true) {
        const m = this.matte;
        const last = () => (m.frames ? (wantCanvas ? m.canvas : true) : null); // keep using the last matte, never the raw camera
        if (ts - this.lastMatteTs > 700) m.reset(); // coming back after a pause: start from the new frame instead of blending with an old one
        this.lastMatteTs = ts;
        this.segctx.drawImage(v, 0, 0, SEG_SIZE, SEG_SIZE);
        let res;
        try { res = this.segmenter.segmentForVideo(this.segIn, ts); }
        catch (e) { console.warn('segmenter', e); return last(); }
        const mask = res.confidenceMasks?.[0];
        if (!mask) { res.close?.(); return last(); }
        const out = m.update(mask.getAsFloat32Array(), mask.width, mask.height, wantCanvas);
        res.close?.();
        return wantCanvas ? out : true;
    }

    /** Face pose for this frame (smoothed, null when no face was seen for a moment): see FaceTracker in masks.js. */
    trackFace(v, ts, W, H) {
        const res = this.landmarker.detectForVideo(v, ts);
        this.tracker ||= new FaceTracker();
        this.face = this.tracker.update(res.faceLandmarks?.[0], W, H, ts);
        return this.face;
    }

    drawMask(mask, f, ts, W, H) {
        const env = this.maskEnv ||= { video: this.video, W, H };
        env.W = W; env.H = H;
        drawMask(this.ctx, mask, f, ts / 1000, env);
    }
}
