// =====================================================================
// Face masks: tracking, fitting and drawing.
//
// ALL ARTWORK IS ORIGINAL AND DRAWN IN CODE (Canvas 2D paths, gradients, procedural noise; see mask-art.js and
// mask-kit.js). There are no emoji glyphs, no text-glyph art, no image files and nothing copied from any other
// app, character or stock set. The designs are generic (paper folds, mosaic tiles, gold-seamed ceramic, neon line
// art, filigree, glitch scanlines, porcelain, constellations, laurel leaves, a visor).
//
//  - FaceTracker turns MediaPipe FaceLandmarker landmarks into a smoothed face pose: centre, roll, width/height of
//    the face oval (ear to ear, forehead to chin), yaw, mouth opening. One-Euro filtering: calm when the head is
//    still, almost no lag when it moves fast.
//  - drawMask paints a mask onto the true camera frame (the local preview is mirrored by CSS only).
//  - migrateMask / migrateFx map effect ids saved by older versions onto the current set.
// =====================================================================
import { AR, clamp, makeSprite, outlinePath } from './mask-kit.js';
import { DESIGNS, SPRITE_PPU } from './mask-art.js';

// ---------------------------------------------------------------- One-Euro filter
const alphaOf = (dt, cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

/** One-Euro filter: strong smoothing at low speed (no jitter), light smoothing at high speed (no lag). `scale` normalises speed. */
class OneEuro {
    constructor(minCutoff, beta, dCutoff = 1.2) {
        this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
        this.x = null; this.dx = 0; this.t = 0; this.raw = 0;
    }
    reset() { this.x = null; this.dx = 0; }
    filter(v, t, scale = 1) {
        if (this.x === null) { this.x = v; this.dx = 0; this.t = t; this.raw = 0; return v; }
        const dt = Math.max(1e-3, t - this.t);
        this.t = t;
        this.raw = (v - this.x) / dt;
        this.dx += alphaOf(dt, this.dCutoff) * (this.raw / scale - this.dx);
        const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
        this.x += alphaOf(dt, cutoff) * (v - this.x);
        return this.x;
    }
}

// FaceLandmarker indices (MediaPipe face mesh topology).
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const EAR_L = 234, EAR_R = 454, EYE_L_OUT = 33, EYE_L_IN = 133, EYE_R_IN = 362, EYE_R_OUT = 263, NOSE = 1, LIP_TOP = 13, LIP_BOT = 14;
// Average positions of the features inside the face oval (fractions of the half-height / half-width), measured on frontal faces.
const EYE_Y = -0.405, NOSE_Y = 0.108, MOUTH_Y = 0.4;
// The mask is a little larger than the tracked oval so it still covers the face edge while the head moves, and sits a bit
// higher so it reaches the forehead.
const GROW_X = 1.06, GROW_Y = 1.06, LIFT = 0.035;
/** Head yaw from how far the nose tip sits off the middle of the face (the nose protrudes ~1.3 half-widths in front of the ear line). */
const NOSE_DEPTH = 1.3;

/**
 * Raw face pose from one set of landmarks (normalised image coordinates). Exported so it can be tested with synthetic
 * heads. `o` receives: cx, cy (px), angle (roll, rad), w, h (px, oval extent along the roll axes), earDist (px),
 * yaw (rad, positive = nose toward image right), fx, fy (feature offsets in canonical units), mouth (0..1).
 */
export function measureFace(lm, W, H, o = {}) {
    const X = i => lm[i].x * W, Y = i => lm[i].y * H;
    // In-plane roll from the eye line and the ear line together.
    const ax = (X(EYE_R_OUT) - X(EYE_L_OUT)) + (X(EAR_R) - X(EAR_L)) * 0.5;
    const ay = (Y(EYE_R_OUT) - Y(EYE_L_OUT)) + (Y(EAR_R) - Y(EAR_L)) * 0.5;
    const angle = Math.atan2(ay, ax);
    const c = Math.cos(angle), s = Math.sin(angle);
    // Extent of the face oval in the rolled frame: this is the visible silhouette, so it narrows as the head turns.
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let k = 0; k < OVAL.length; k++) {
        const i = OVAL[k], x = X(i), y = Y(i);
        const u = x * c + y * s, v = -x * s + y * c;
        if (u < u0) u0 = u; if (u > u1) u1 = u;
        if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, hw = Math.max(1, (u1 - u0) / 2), hh = Math.max(1, (v1 - v0) / 2);
    const uOf = i => X(i) * c + Y(i) * s, vOf = i => -X(i) * s + Y(i) * c;
    const eyeU = (uOf(EYE_L_OUT) + uOf(EYE_L_IN) + uOf(EYE_R_IN) + uOf(EYE_R_OUT)) / 4;
    const eyeV = (vOf(EYE_L_OUT) + vOf(EYE_L_IN) + vOf(EYE_R_IN) + vOf(EYE_R_OUT)) / 4;
    const noseU = uOf(NOSE), noseV = vOf(NOSE);
    const mouthU = (uOf(LIP_TOP) + uOf(LIP_BOT)) / 2, mouthV = (vOf(LIP_TOP) + vOf(LIP_BOT)) / 2;
    // Where the oval is centred, expressed back in image coordinates.
    o.cx = cu * c - cv * s;
    o.cy = cu * s + cv * c;
    o.angle = angle;
    o.w = hw * 2; o.h = hh * 2;
    o.earDist = Math.hypot(X(EAR_R) - X(EAR_L), Y(EAR_R) - Y(EAR_L));
    // Yaw: the nose tip slides toward the side the head turns to. Asymmetry between the cheek landmarks, relative to the face half-width.
    const asym = (noseU - (uOf(EAR_L) + uOf(EAR_R)) / 2) / (o.earDist / 2 || 1);
    o.yaw = Math.atan(clamp(asym, -2.5, 2.5) / NOSE_DEPTH);
    // The features (eyes, nose, mouth) as a block sit off-centre in the silhouette when the head turns or tilts.
    o.fx = clamp((0.4 * (eyeU - cu) + 0.2 * (noseU - cu) + 0.4 * (mouthU - cu)) / hw, -0.75, 0.75);
    o.fy = clamp(0.4 * ((eyeV - cv) / hh - EYE_Y) + 0.3 * ((noseV - cv) / hh - NOSE_Y) + 0.3 * ((mouthV - cv) / hh - MOUTH_Y), -0.3, 0.3) * AR;
    o.mouth = clamp(((vOf(LIP_BOT) - vOf(LIP_TOP)) / (2 * hh) - 0.015) / 0.12);
    return o;
}

/**
 * Smoothed face pose over time. `update(landmarks, W, H, nowMs)` returns the pose to draw, or null when there has been
 * no face for longer than HOLD_MS. A face lost for a moment keeps the mask on its last position (a single missed
 * detection must not flash the person's real face), then the caller hides everything.
 */
const HOLD_MS = 160;
export class FaceTracker {
    constructor() {
        const mk = (min, beta) => new OneEuro(min, beta);
        this.f = { cx: mk(1.4, 4), cy: mk(1.4, 4), angle: mk(1.2, 3), w: mk(1.1, 3), h: mk(1.1, 3), fx: mk(1.5, 3), fy: mk(1.5, 3), yaw: mk(1.5, 3), mouth: mk(5, 1) };
        this.raw = {};
        this.pose = { cx: 0, cy: 0, angle: 0, w: 1, h: 1, sx: 1, sy: 1, fx: 0, fy: 0, yaw: 0, mouth: 0, vx: 0, vy: 0, held: false, seenAt: 0 };
        this.lastSeen = -1e9;
        this.have = false;
        this.lastAngle = 0;
    }
    reset() { for (const k in this.f) this.f[k].reset(); this.have = false; this.lastSeen = -1e9; }
    update(lm, W, H, nowMs) {
        if (!lm) {
            if (this.have && nowMs - this.lastSeen <= HOLD_MS) { this.pose.held = true; return this.pose; }
            this.reset();
            return null;
        }
        // A long gap (tab in the background, slow device): jump straight to the new pose instead of gliding across the screen.
        if (this.have && nowMs - this.lastSeen > 700) this.reset();
        const t = nowMs / 1000, r = measureFace(lm, W, H, this.raw), f = this.f, p = this.pose;
        // Roll must not wrap around at +-PI.
        if (this.have) { let d = r.angle - this.lastAngle; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; r.angle = this.lastAngle + d; }
        this.lastAngle = r.angle;
        const size = Math.max(40, f.w.x ?? r.w);
        p.cx = f.cx.filter(r.cx, t, size);
        p.cy = f.cy.filter(r.cy, t, size);
        p.angle = f.angle.filter(r.angle, t, 1);
        p.w = f.w.filter(r.w, t, size);
        p.h = f.h.filter(r.h, t, size);
        p.fx = f.fx.filter(r.fx, t, 1);
        p.fy = f.fy.filter(r.fy, t, 1);
        p.yaw = f.yaw.filter(r.yaw, t, 1);
        p.mouth = f.mouth.filter(r.mouth, t, 1);
        p.vx = f.cx.raw; p.vy = f.cy.raw;
        // Canonical -> pixel scale, and a lift so the mask reaches the forehead.
        p.sx = p.w / 2 * GROW_X;
        p.sy = p.h / 2 / AR * GROW_Y;
        const lift = p.h * LIFT;
        p.cx += Math.sin(p.angle) * lift;
        p.cy -= Math.cos(p.angle) * lift;
        p.held = false;
        p.seenAt = nowMs;
        this.lastSeen = nowMs;
        this.have = true;
        return p;
    }
}

// ---------------------------------------------------------------- the mask set
const byId = new Map();
/** kind 'full' covers the whole face (anonymous); 'eyes' / 'crown' are accessories. Every option has a thumb(ctx, w, h) preview drawn in code. */
export const MASKS = [{ id: 'none', label: 'None' }];
for (const d of DESIGNS) {
    d.thumb = (c, w, h) => renderThumb(d, c, w, h);
    MASKS.push(d);
}
for (const m of MASKS) byId.set(m.id, m);

// Effect ids saved by older versions (emoji masks) keep working: they map onto an equivalent new mask.
const MASK_ALIASES = new Map(Object.entries({ dog: 'origami', cat: 'masquerade', panda: 'spirit', fox: 'neon', robot: 'glitch', alien: 'constellation', crown: 'laurel' }));

/** Maps any saved mask id (current, retired or unknown) onto a mask that exists. Unknown ids (or anything that is not a string) become 'none'. */
export function migrateMask(id) {
    if (typeof id !== 'string') return 'none';
    if (byId.has(id)) return id;
    return MASK_ALIASES.get(id) || 'none';
}
export const findMask = id => byId.get(migrateMask(id));

// ---------------------------------------------------------------- drawing
const IDEAL = { fx: 0, fy: 0, yaw: 0, mouth: 0, vx: 0, vy: 0, w: 1, h: 1 };
let active = null; // the design whose sprites are in memory (switching masks frees the previous ones)

function releaseSprites(d) { if (d) for (const L of d.layers) L.sprite = null; }

function paintLayers(c, d, g, t, env, direct) {
    const [ex, ey] = d.ext;
    const full = d.kind === 'full';
    for (const L of d.layers) {
        const depth = L.depth || 0;
        c.save();
        try {
            if (depth) {
                // A full mask never paints outside its own outline (features that slide off the edge when the head turns are cut there).
                if (full && (Math.abs(g.fx * depth) > 0.03 || Math.abs(g.fy * depth) > 0.03)) { outlinePath(c, 1.0); c.clip(); } // (nothing can spill while the features sit at home)
                // Features sit in front of the face outline: when the head turns they slide across it and bunch up (measured on real
                // landmarks: x' = shift + x * cos(yaw)^0.7).
                c.translate(g.fx * depth, g.fy * depth);
                const squeeze = Math.pow(Math.max(0.3, Math.cos(g.yaw)), 0.7 * depth);
                if (squeeze !== 1) c.scale(squeeze, 1);
            }
            if (L.static && !direct) {
                L.sprite ||= makeLayerSprite(d, L);
                c.drawImage(L.sprite, -ex, -ey, ex * 2, ey * 2);
            } else {
                L.paint(c, t, g, env);
            }
        } finally {
            c.restore();
        }
    }
}

function makeLayerSprite(d, L) {
    return makeSprite(d.ext[0], d.ext[1], SPRITE_PPU, c => L.paint(c, 0, IDEAL, null));
}

/**
 * Draw a mask on a tracked face. ctx is the output canvas context (true camera orientation), face the pose from
 * FaceTracker, t seconds (animation clock), env optional { video } for masks that use the camera picture (Mosaic).
 */
export function drawMask(ctx, d, face, t, env) {
    if (!d || d.id === 'none') return;
    if (active !== d) { releaseSprites(active); active = d; }
    ctx.save();
    try {
        ctx.translate(face.cx, face.cy);
        ctx.rotate(face.angle);
        ctx.scale(face.sx, face.sy);
        paintLayers(ctx, d, face, t, env, false);
    } finally {
        ctx.restore();
    }
}

/** The mask drawn large in the middle of the frame: shown while an anonymity mask is on but no face is found. */
export function drawMaskEmblem(ctx, d, W, H, t) {
    if (!d || d.id === 'none') return;
    const s = Math.min(W, H) * 0.3;
    ctx.save();
    try {
        ctx.translate(W / 2, H / 2);
        ctx.scale(s, s);
        ctx.globalAlpha = 0.95;
        paintLayers(ctx, d, IDEAL, t, null, true);
    } finally {
        ctx.restore();
    }
}

// ---------------------------------------------------------------- thumbnails (80x80 in the effect picker)
function renderThumb(d, c, w, h) {
    c.save();
    c.clearRect(0, 0, w, h);
    const bg = c.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#1e293b');
    bg.addColorStop(1, '#0b1020');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    const s = w * (d.kind === 'full' ? 0.335 : 0.26);
    c.translate(w / 2, h * (d.kind === 'crown' ? 0.62 : 0.54));
    c.scale(s, s);
    if (d.kind !== 'full') mannequin(c);
    // Thumbnails are static pictures, painted straight from the vector code.
    paintLayers(c, d, IDEAL, d.thumbT ?? 1.3, null, true);
    c.restore();
}

/** A neutral, faceless head and shoulders (muted grey-blue) for previewing accessories. */
function mannequin(c) {
    const sh = c.createLinearGradient(0, 1.3, 0, 2.2);
    sh.addColorStop(0, '#475569');
    sh.addColorStop(1, '#1e293b');
    c.fillStyle = sh;
    c.beginPath();
    c.ellipse(0, 2.15, 1.65, 0.85, 0, Math.PI, 0);
    c.fill();
    c.fillStyle = '#334155';
    c.fillRect(-0.32, 0.95, 0.64, 0.6);
    const hd = c.createRadialGradient(-0.3, -0.5, 0.1, 0, 0, 1.5);
    hd.addColorStop(0, '#94a3b8');
    hd.addColorStop(1, '#475569');
    c.fillStyle = hd;
    c.beginPath();
    c.ellipse(0, 0, 0.94, AR * 0.98, 0, 0, Math.PI * 2);
    c.fill();
}
