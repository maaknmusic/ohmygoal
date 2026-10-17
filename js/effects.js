// =====================================================================
// Video effects: background blur/replacement, face masks and color filters.
// Runs on-device with MediaPipe (person segmentation + face landmarks); the
// processed canvas becomes the video track that is shown and sent.
// =====================================================================

export const BACKGROUNDS = [
    { id: 'none', label: 'None' },
    { id: 'blur', label: 'Blur' },
    { id: 'studio', label: 'Studio', colors: ['#1f2937', '#4b5563'] },
    { id: 'sunset', label: 'Sunset', colors: ['#f97316', '#db2777'] },
    { id: 'ocean', label: 'Ocean', colors: ['#0ea5e9', '#1e3a8a'] },
    { id: 'forest', label: 'Forest', colors: ['#16a34a', '#14532d'] },
];

// kind 'full' covers the whole face (anonymous); 'eyes' / 'crown' are accessories.
export const MASKS = [
    { id: 'none', label: 'None' },
    { id: 'shades', label: '🕶️', kind: 'eyes', emoji: '🕶️' },
    { id: 'crown', label: '👑', kind: 'crown', emoji: '👑' },
    { id: 'dog', label: '🐶', kind: 'full', emoji: '🐶' },
    { id: 'cat', label: '🐱', kind: 'full', emoji: '🐱' },
    { id: 'panda', label: '🐼', kind: 'full', emoji: '🐼' },
    { id: 'fox', label: '🦊', kind: 'full', emoji: '🦊' },
    { id: 'robot', label: '🤖', kind: 'full', emoji: '🤖' },
    { id: 'alien', label: '👽', kind: 'full', emoji: '👽' },
];

export const FILTERS = [
    { id: 'none', label: 'None', css: 'none' },
    { id: 'beauty', label: 'Beauty', css: 'brightness(1.06) saturate(1.08)', soften: true },
    { id: 'warm', label: 'Warm', css: 'sepia(0.25) saturate(1.3) hue-rotate(-8deg)' },
    { id: 'cool', label: 'Cool', css: 'saturate(1.1) hue-rotate(12deg) brightness(1.03)' },
    { id: 'bw', label: 'B&W', css: 'grayscale(1) contrast(1.1)' },
    { id: 'vintage', label: 'Vintage', css: 'sepia(0.5) contrast(0.95) brightness(1.05)' },
    { id: 'vivid', label: 'Vivid', css: 'saturate(1.6) contrast(1.1)' },
];

const OUT_WIDTH = 640;
const FPS = 24;

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
        this.maskCanvas = document.createElement('canvas');
        this.mctx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
        this.small = document.createElement('canvas');
        this.sctx = this.small.getContext('2d');
        this.supportsFilter = 'filter' in this.ctx;
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
        }
    }

    render(v) {
        const W = OUT_WIDTH, H = Math.round(W * v.videoHeight / v.videoWidth);
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

        // 2. Background
        const seg = s.background !== 'none' && this.segmenter;
        if (seg) {
            const mask = this.segment(v, ts);
            const bg = BACKGROUNDS.find(b => b.id === s.background);
            if (bg.id === 'blur') ctx.drawImage(this.blurred(v, 0.06), 0, 0, W, H);
            else {
                const g = ctx.createLinearGradient(0, 0, W, H);
                g.addColorStop(0, bg.colors[0]);
                g.addColorStop(1, bg.colors[1]);
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, W, H);
            }
            if (mask) {
                const p = this.pctx;
                p.globalCompositeOperation = 'source-over';
                p.clearRect(0, 0, W, H);
                p.drawImage(mask, 0, 0, W, H);
                p.globalCompositeOperation = 'source-in';
                drawFrame(this.person, p);
                p.globalCompositeOperation = 'source-over';
                ctx.drawImage(this.person, 0, 0);
            } else {
                drawFrame(this.out, ctx);
            }
        } else {
            drawFrame(this.out, ctx);
        }

        // 3. Face mask
        const mask = MASKS.find(m => m.id === s.mask);
        if (mask && mask.id !== 'none' && this.landmarker) {
            const face = this.trackFace(v, ts, W, H);
            if (face) this.drawMask(mask, face);
            else if (mask.kind === 'full') {
                // Face not found while an anonymity mask is on: hide everything rather than reveal the face.
                ctx.drawImage(this.blurred(v, 0.03), 0, 0, W, H);
                ctx.fillStyle = 'rgba(15,23,42,0.35)';
                ctx.fillRect(0, 0, W, H);
                ctx.font = `${Math.round(H * 0.3)}px serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(mask.emoji, W / 2, H / 2);
            }
        }
    }

    /** Cheap, portable blur: downscale then upscale with smoothing. */
    blurred(v, scale) {
        const w = Math.max(8, Math.round(OUT_WIDTH * scale));
        const h = Math.max(6, Math.round(w * v.videoHeight / v.videoWidth));
        if (this.small.width !== w || this.small.height !== h) { this.small.width = w; this.small.height = h; }
        this.sctx.imageSmoothingQuality = 'high';
        this.sctx.drawImage(v, 0, 0, w, h);
        return this.small;
    }

    /** Person mask as a canvas (alpha = person confidence). */
    segment(v, ts) {
        const res = this.segmenter.segmentForVideo(v, ts);
        const m = res.confidenceMasks?.[0];
        if (!m) { res.close?.(); return null; }
        const { width, height } = m;
        const data = m.getAsFloat32Array();
        if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
            this.maskCanvas.width = width; this.maskCanvas.height = height;
            this.maskImage = this.mctx.createImageData(width, height);
        }
        const px = this.maskImage.data;
        for (let i = 0; i < data.length; i++) {
            // Sharpen the edge a little so hair/shoulders don't ghost.
            const a = Math.min(1, Math.max(0, (data[i] - 0.25) / 0.5));
            px[i * 4 + 3] = a * 255;
        }
        this.mctx.putImageData(this.maskImage, 0, 0);
        res.close?.();
        return this.maskCanvas;
    }

    trackFace(v, ts, W, H) {
        const res = this.landmarker.detectForVideo(v, ts);
        const lm = res.faceLandmarks?.[0];
        if (!lm) { this.face = null; return null; }
        const P = i => ({ x: lm[i].x * W, y: lm[i].y * H });
        const le = P(33), re = P(263), top = P(10), chin = P(152), nose = P(1);
        const eyeDist = Math.hypot(re.x - le.x, re.y - le.y);
        const next = {
            eyes: { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 },
            angle: Math.atan2(re.y - le.y, re.x - le.x),
            eyeDist, top, nose,
            faceH: Math.hypot(chin.x - top.x, chin.y - top.y),
        };
        // Exponential smoothing to stop the mask from jittering.
        const f = this.face, k = 0.5;
        const mix = (a, b) => a + (b - a) * k;
        const mixP = (a, b) => ({ x: mix(a.x, b.x), y: mix(a.y, b.y) });
        this.face = f ? {
            eyes: mixP(f.eyes, next.eyes), angle: mix(f.angle, next.angle), eyeDist: mix(f.eyeDist, next.eyeDist),
            top: mixP(f.top, next.top), nose: mixP(f.nose, next.nose), faceH: mix(f.faceH, next.faceH),
        } : next;
        return this.face;
    }

    drawMask(mask, f) {
        const ctx = this.ctx;
        const at = (x, y, size, angle) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.font = `${Math.round(size)}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(mask.emoji, 0, 0);
            ctx.restore();
        };
        if (mask.kind === 'eyes') at(f.eyes.x, f.eyes.y + f.eyeDist * 0.05, f.eyeDist * 2.1, f.angle);
        else if (mask.kind === 'crown') {
            const up = f.faceH * 0.32;
            at(f.top.x + Math.sin(f.angle) * up, f.top.y - Math.cos(f.angle) * up, f.eyeDist * 2.0, f.angle);
        } else at(f.nose.x, f.nose.y - f.faceH * 0.05, f.faceH * 1.35, f.angle);
    }
}
