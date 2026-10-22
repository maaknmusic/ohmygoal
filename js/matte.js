// =====================================================================
// Person matte + background blur maths for the video effects (js/effects.js).
// Pure canvas / typed-array code, no libraries and no images: everything here is
// original code written for this project.
//
//  Matte      turns the segmenter's raw person-confidence mask into a stable, soft alpha matte:
//             motion-adaptive temporal smoothing (no flicker, no ghosting), a smoothstep soft
//             threshold that also contracts the edge a little (kills the halo of background that
//             the model lets through), output as an alpha canvas that the caller upsamples smoothly.
//  BackdropBlur  a real gaussian-looking background blur that never bleeds the person's colours
//             into the background (normalised convolution at low resolution, like a lens would).
//             It is plain JavaScript on a tiny image, so it looks the same in every browser
//             (no dependency on ctx.filter, which Safari lacks).
// =====================================================================

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Look-up tables so the per-pixel loop has no branches or divisions.
const LUT_N = 1024;
function edgeTable(lo, hi) {
    const t = new Uint8ClampedArray(LUT_N + 1);
    for (let i = 0; i <= LUT_N; i++) t[i] = Math.round(smoothstep(lo, hi, i / LUT_N) * 255);
    return t;
}
function weightTable(a0, a1, d0, d1) {
    const t = new Float32Array(257);
    for (let i = 0; i <= 256; i++) t[i] = a0 + (a1 - a0) * smoothstep(d0, d1, i / 255);
    return t;
}

export class Matte {
    /**
     * @param {object} o
     *   lo, hi    soft-threshold window on the smoothed confidence, canvas path only (a bit above 0.5 on purpose: contracts the edge)
     *   still     blend weight for a pixel that barely changed (noise): small = very stable
     *   moving    blend weight for a pixel that changed a lot (real movement): large = follows fast
     */
    constructor({ lo = 0.5, hi = 0.7, still = 0.22, moving = 0.9, d0 = 0.05, d1 = 0.4, erode = 0.6 } = {}) {
        this.edge = edgeTable(lo, hi);
        this.erode = erode;    // canvas path only: 0 = none, 1 = a full model pixel
        this.weight = weightTable(still, moving, d0, d1);
        this.w = 0; this.h = 0;
        this.soft = null;      // Float32Array: temporally smoothed confidence (also used as blur weights)
        this.conf8 = null;     // the same as bytes (0..255), for the GPU refinement
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.image = null;
        this.frames = 0;
    }

    reset() { this.soft = null; this.frames = 0; }

    /** Alpha values (0..255, canvas size) of the last canvas-path update, for tests. */
    alpha() {
        const px = this.image?.data; if (!px) return null;
        const a = new Uint8Array(this.canvas.width * this.canvas.height);
        for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3];
        return a;
    }

    /** conf: Float32Array(w*h) person confidence 0..1. Returns the alpha canvas (w x h). */
    update(conf, w, h, wantCanvas = true) {
        const n = w * h;
        if (this.w !== w || this.h !== h || !this.soft) {
            this.w = w; this.h = h;
            this.soft = new Float32Array(n);
            this.conf8 = new Uint8Array(n);
            this.soft.set(conf.length === n ? conf : conf.subarray(0, n));
            this.frames = 0;
        }
        const soft = this.soft, c8 = this.conf8, wt = this.weight;
        const first = this.frames++ === 0;
        for (let i = 0, j = 3; i < n; i++, j += 4) {
            let c = conf[i];
            if (!(c >= 0)) c = 0; else if (c > 1) c = 1; // also catches NaN
            const p = soft[i];
            const d = c > p ? c - p : p - c;
            const s = first ? c : p + (c - p) * wt[(d * 255) | 0];
            soft[i] = s;
            c8[i] = (s * 255 + 0.5) | 0;
        }
        if (wantCanvas) this.paint();
        return this.canvas;
    }

    /**
     * Canvas path: the soft confidence enlarged 2x with bilinear weights (0.75 / 0.25), THEN thresholded, so the contour is
     * found at twice the model's resolution (thresholding first and enlarging later would smear the edge by a whole model pixel).
     * The alpha canvas is 2w x 2h.
     */
    paint() {
        const { w, h, soft, edge } = this, W2 = w * 2, H2 = h * 2;
        if (this.canvas.width !== W2 || this.canvas.height !== H2) {
            this.canvas.width = W2; this.canvas.height = H2;
            this.image = this.ctx.createImageData(W2, H2);
            this.row = new Float32Array(w);
        }
        const px = this.image.data, row = this.row, last = w - 1;
        // Erode a little first: the model's mask runs about one model pixel past the real outline, which shows as a halo of the old room.
        const er = this.eroded ||= new Float32Array(w * h), k = this.erode;
        for (let y = 0; y < h; y++) {
            const u = (y > 0 ? y - 1 : y) * w, m = y * w, d = (y < h - 1 ? y + 1 : y) * w;
            for (let x = 0; x < w; x++) {
                const c = soft[m + x];
                let lo = soft[u + x]; const b = soft[d + x], l = soft[m + (x > 0 ? x - 1 : x)], r = soft[m + (x < last ? x + 1 : x)];
                if (b < lo) lo = b; if (l < lo) lo = l; if (r < lo) lo = r;
                er[m + x] = lo < c ? c - (c - lo) * k : c;
            }
        }
        for (let oy = 0; oy < H2; oy++) {
            const r0 = oy >> 1, r1 = oy & 1 ? (r0 + 1 < h ? r0 + 1 : r0) : (r0 > 0 ? r0 - 1 : r0);
            const o0 = r0 * w, o1 = r1 * w;
            for (let x = 0; x < w; x++) row[x] = 0.75 * er[o0 + x] + 0.25 * er[o1 + x];
            let j = oy * W2 * 4 + 3;
            for (let x = 0; x < w; x++, j += 8) {
                const v = row[x], l = x > 0 ? row[x - 1] : v, r = x < last ? row[x + 1] : v;
                px[j] = edge[((0.75 * v + 0.25 * l) * LUT_N) | 0];
                px[j + 4] = edge[((0.75 * v + 0.25 * r) * LUT_N) | 0];
            }
        }
        this.ctx.putImageData(this.image, 0, 0);
    }

    /**
     * The inner edge band of the matte (alpha only, at model resolution) as a canvas: where the person's silhouette meets the
     * background = alpha minus its 3x3 minimum. Canvas path only; the light wrap tints this band with the new background's colours.
     */
    ringCanvas() {
        const { w, h, edge } = this, n = w * h, src = this.eroded;
        if (!this.ring || this.ring.n !== n) {
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            this.ring = { n, canvas: c, ctx, img: ctx.createImageData(w, h), a: new Uint8Array(n), tmp: new Uint8Array(n) };
        }
        const { a, tmp, img, ctx, canvas } = this.ring, out = img.data;
        for (let i = 0; i < n; i++) a[i] = edge[(src[i] * LUT_N) | 0];
        for (let y = 0; y < h; y++) {                       // horizontal minimum
            const o = y * w;
            for (let x = 0; x < w; x++) {
                let m = a[o + x]; const l = a[o + (x > 0 ? x - 1 : x)], r = a[o + (x < w - 1 ? x + 1 : x)];
                if (l < m) m = l; if (r < m) m = r;
                tmp[o + x] = m;
            }
        }
        for (let y = 0; y < h; y++) {                       // vertical minimum, then ring = alpha - minimum
            const u = (y > 0 ? y - 1 : y) * w, o = y * w, d = (y < h - 1 ? y + 1 : y) * w;
            for (let x = 0; x < w; x++) {
                let m = tmp[o + x]; const t = tmp[u + x], b = tmp[d + x];
                if (t < m) m = t; if (b < m) m = b;
                const k = a[o + x] - m;
                out[(o + x) * 4 + 3] = k > 0 ? k : 0;
            }
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
    }
}

// ---------------------------------------------------------------------
// Box blur on interleaved 4-channel float images (running sums, cost independent of the radius).
// Three passes per axis approximate a gaussian.
function boxH(src, dst, w, h, r) {
    const inv = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
        const o = y * w * 4;
        let s0 = src[o] * (r + 1), s1 = src[o + 1] * (r + 1), s2 = src[o + 2] * (r + 1), s3 = src[o + 3] * (r + 1);
        for (let k = 0; k < r; k++) { const q = o + Math.min(k, w - 1) * 4; s0 += src[q]; s1 += src[q + 1]; s2 += src[q + 2]; s3 += src[q + 3]; }
        for (let x = 0; x < w; x++) {
            const a = o + (x + r < w ? x + r : w - 1) * 4, b = o + (x - r - 1 >= 0 ? x - r - 1 : 0) * 4, d = o + x * 4;
            s0 += src[a] - src[b]; s1 += src[a + 1] - src[b + 1]; s2 += src[a + 2] - src[b + 2]; s3 += src[a + 3] - src[b + 3];
            dst[d] = s0 * inv; dst[d + 1] = s1 * inv; dst[d + 2] = s2 * inv; dst[d + 3] = s3 * inv;
        }
    }
}
function boxV(src, dst, w, h, r, acc) {
    const inv = 1 / (2 * r + 1), row = w * 4;
    for (let i = 0; i < row; i++) acc[i] = src[i] * (r + 1);
    for (let k = 0; k < r; k++) { const q = Math.min(k, h - 1) * row; for (let i = 0; i < row; i++) acc[i] += src[q + i]; }
    for (let y = 0; y < h; y++) {
        const a = (y + r < h ? y + r : h - 1) * row, b = (y - r - 1 >= 0 ? y - r - 1 : 0) * row, d = y * row;
        for (let i = 0; i < row; i++) { acc[i] += src[a + i] - src[b + i]; dst[d + i] = acc[i] * inv; }
    }
}
/** A gaussian of standard deviation (sx, sy) pixels: `passes` box passes per axis (radii from the sigma). */
function gauss(img, tmp, acc, w, h, sx, sy, passes = 3) {
    const radius = s => Math.max(0, Math.round((Math.sqrt(12 * s * s / passes + 1) - 1) / 2));
    const rx = radius(sx), ry = radius(sy);
    for (let k = 0; k < passes; k++) {
        if (rx) { boxH(img, tmp, w, h, rx); img.set(tmp); }
        if (ry) { boxV(img, tmp, w, h, ry, acc); img.set(tmp); }
    }
}

export class BackdropBlur {
    /** size: resolution of the working image (square; the camera frame is squashed into it). */
    constructor(size = 96) {
        this.n = size;
        this.src = document.createElement('canvas');           // camera frame, tiny
        this.src.width = this.src.height = size;
        this.sctx = this.src.getContext('2d', { willReadFrequently: true });
        this.sctx.imageSmoothingQuality = 'high';
        this.canvas = document.createElement('canvas');        // blurred result, tiny (draw it scaled up, smoothing on)
        this.canvas.width = this.canvas.height = size;
        this.ctx = this.canvas.getContext('2d');
        this.image = this.ctx.createImageData(size, size);
        const N = size * size * 4;
        this.p = new Float32Array(N); this.q = new Float32Array(N); this.tmp = new Float32Array(N); this.acc = new Float32Array(size * 4);
    }

    /**
     * @param {CanvasImageSource} frame   the camera frame (any size/aspect, it is squashed to the working size)
     * @param {Float32Array|null} conf    person confidence (cw*ch) or null (blur everything)
     * @param {number} sigmaX,sigmaY      blur standard deviation in WORKING-image pixels, per axis
     * @returns the tiny blurred canvas
     */
    render(frame, conf, cw, ch, sigmaX, sigmaY) {
        const n = this.n, N = n * n, { p, q, tmp, acc } = this;
        this.sctx.drawImage(frame, 0, 0, n, n);
        const rgba = this.sctx.getImageData(0, 0, n, n).data;
        // Channel 3 = "this pixel is background" (1 - person). Person pixels get 0, so the blur only ever mixes background colours;
        // channels 0..2 are the colours multiplied by it.
        const have = conf && cw > 0 && ch > 0;
        let sw = 0, sr = 0, sg = 0, sb = 0;
        for (let y = 0; y < n; y++) {
            const row = have ? Math.min(ch - 1, Math.floor((y + 0.5) / n * ch)) * cw : 0;
            for (let x = 0; x < n; x++) {
                const i = (y * n + x) * 4;
                let wgt = 1;
                if (have) wgt = 1 - smoothstep(0.03, 0.25, conf[row + Math.min(cw - 1, Math.floor((x + 0.5) / n * cw))]);
                const r = rgba[i] * wgt, g = rgba[i + 1] * wgt, b = rgba[i + 2] * wgt;
                p[i] = r; p[i + 1] = g; p[i + 2] = b; p[i + 3] = wgt;
                sw += wgt; sr += r; sg += g; sb += b;
            }
        }
        // Mean background colour: what is left where no background is within reach.
        const mr = sw > 1 ? sr / sw : 90, mg = sw > 1 ? sg / sw : 90, mb = sw > 1 ? sb / sw : 90;
        // A much wider blur of the same weighted colours fills places where no background is within reach of the normal blur
        // (the middle of a big person, or a wrongly detected patch), instead of one flat average colour.
        if (have) { q.set(p); gauss(q, tmp, acc, n, n, sigmaX * 3.5, sigmaY * 3.5, 2); }
        gauss(p, tmp, acc, n, n, sigmaX, sigmaY);
        const out = this.image.data, eps = 0.03;
        for (let i = 0; i < N * 4; i += 4) {
            const d = p[i + 3] + eps;
            let r = (p[i] + eps * mr) / d, g = (p[i + 1] + eps * mg) / d, b = (p[i + 2] + eps * mb) / d;
            if (have) {
                const cover = smoothstep(0.02, 0.3, p[i + 3]);   // 1 = plenty of background within reach
                if (cover < 1) {
                    const dw = q[i + 3] + eps, wr = (q[i] + eps * mr) / dw, wg = (q[i + 1] + eps * mg) / dw, wb = (q[i + 2] + eps * mb) / dw;
                    r = wr + (r - wr) * cover; g = wg + (g - wg) * cover; b = wb + (b - wb) * cover;
                }
            }
            out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
        }
        this.ctx.putImageData(this.image, 0, 0);
        return this.canvas;
    }
}
