// =====================================================================
// Face-mask artwork. ORIGINAL: every design below is drawn in code with Canvas 2D paths, gradients and procedural
// noise. No emoji glyphs, no text-glyph art, no image files, nothing copied from any app, character or stock set.
//
// A design is { id, label, kind, ext, layers }. Artwork is painted in canonical face space (see mask-kit.js):
// x -1..1 ear to ear, y -AR..AR forehead to chin. `ext` is the half size of the sprite sheet used to cache static
// layers. Each layer { depth, static, paint(c, t, g, env) }: `depth` (0..1) is how far in front of the face outline
// it sits (it slides sideways when the head turns), `static` layers are painted once into a sprite and re-used,
// the others are painted every frame (t = seconds, g = face pose with mouth opening etc., env = { video }).
// =====================================================================
import { AR, OUTLINE, TAU, delaunay, rng, clamp, lerp, smooth, hex, mixc, rgba, ramp, smoothClosed, outlinePath, insideOutline, sparkle, starPath } from './mask-kit.js';

export const SPRITE_PPU = 200;

/** Pixels per canonical unit of the context (for blur radii that must follow the scale). */
const ppu = c => c.getTransform().a;
/** Fills the current path and lets it cast a soft shadow on whatever is behind (the mask sits on the face, not in it). */
function shadowFill(c, blur = 0.055, dy = 0.03, alpha = 0.42) {
    c.save();
    c.shadowColor = `rgba(0,0,0,${alpha})`; c.shadowBlur = blur * ppu(c); c.shadowOffsetY = dy * ppu(c);
    c.fill();
    c.restore();
}
/** A static layer that only casts a shadow (the mask itself is painted by the layer above it). */
const shadowLayer = fill => ({ depth: 0, static: true, paint(c) { outlinePath(c, 1.0); c.fillStyle = fill; shadowFill(c); } });

// ===================================================================== Shades (free, eyes)
// A sleek wrap-around visor: slim silver frame, dark brow bar, mirrored sky-to-violet lens and a glint that sweeps across.
function visorPath(c) {
    const R = [[0, -0.86], [0.5, -0.9], [0.96, -0.88], [1.14, -0.72], [1.12, -0.5], [0.98, -0.3], [0.76, -0.19], [0.5, -0.17], [0.26, -0.24], [0.1, -0.34], [0, -0.36]];
    const pts = [...R, ...R.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
    c.beginPath();
    smoothClosed(c, pts, 1, 1, 0.42);
}
function shades() {
    return {
        id: 'shades', label: 'Visor', kind: 'eyes', ext: [1.5, 1.2],
        layers: [{
            depth: 0.9,
            paint(c, t) {
                // soft shadow cast on the face
                c.save();
                c.shadowColor = 'rgba(0,0,0,0.38)'; c.shadowBlur = 0.06 * ppu(c); c.shadowOffsetY = 0.035 * ppu(c);
                visorPath(c); c.fillStyle = '#0b1022'; c.fill();
                c.restore();
                // temple arms
                c.lineCap = 'round';
                for (const s of [-1, 1]) {
                    const g = c.createLinearGradient(s * 1.05, 0, s * 1.34, 0);
                    g.addColorStop(0, '#cbd5e1'); g.addColorStop(1, 'rgba(148,163,184,0)');
                    c.strokeStyle = g; c.lineWidth = 0.05;
                    c.beginPath(); c.moveTo(s * 1.08, -0.7); c.lineTo(s * 1.36, -0.6); c.stroke();
                }
                // mirrored lens
                visorPath(c);
                const lens = c.createLinearGradient(0, -0.9, 0, -0.15);
                lens.addColorStop(0, '#0a1230'); lens.addColorStop(0.4, '#1d4fa8'); lens.addColorStop(0.72, '#7048e0'); lens.addColorStop(1, '#e056d9');
                c.fillStyle = lens; c.fill();
                c.save(); c.clip();
                const sky = c.createLinearGradient(-1.1, -0.9, 1.1, -0.2);
                sky.addColorStop(0, 'rgba(165,225,255,0)'); sky.addColorStop(0.45, 'rgba(165,225,255,0.3)'); sky.addColorStop(1, 'rgba(165,225,255,0)');
                c.fillStyle = sky; c.fillRect(-1.3, -1, 2.6, 0.9);
                c.strokeStyle = 'rgba(255,255,255,0.2)'; c.lineWidth = 0.012;
                c.beginPath(); c.moveTo(-1.2, -0.56); c.bezierCurveTo(-0.4, -0.63, 0.4, -0.5, 1.2, -0.58); c.stroke();
                // dark brow bar across the top
                const bar = c.createLinearGradient(0, -0.92, 0, -0.7);
                bar.addColorStop(0, '#05070f'); bar.addColorStop(0.7, '#12182b'); bar.addColorStop(1, 'rgba(18,24,43,0)');
                c.fillStyle = bar; c.fillRect(-1.3, -0.95, 2.6, 0.27);
                // a glint sweeps over the lens every few seconds
                const k = clamp((t % 5.2) / 1.3);
                if (k < 1) {
                    const gx = lerp(-1.6, 1.6, smooth(k));
                    c.save();
                    c.transform(1, 0, -0.55, 1, 0, 0);
                    const gl = c.createLinearGradient(gx - 0.22, 0, gx + 0.22, 0);
                    gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
                    c.fillStyle = gl; c.fillRect(gx - 0.25, -1.1, 0.5, 1.2);
                    c.restore();
                }
                c.restore();
                // slim silver frame
                visorPath(c);
                const fr = c.createLinearGradient(-1.1, -0.9, 1.1, -0.2);
                fr.addColorStop(0, '#f1f5f9'); fr.addColorStop(0.5, '#94a3b8'); fr.addColorStop(1, '#e2e8f0');
                c.lineWidth = 0.03; c.lineJoin = 'round'; c.strokeStyle = fr; c.stroke();
                // nose pads
                c.fillStyle = 'rgba(226,232,240,0.6)';
                for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * 0.1, -0.3, 0.022, 0.045, s * 0.4, 0, TAU); c.fill(); }
            },
        }],
    };
}

// ===================================================================== Laurel (accessory)
// A golden laurel wreath around the head with a soft halo and a few twinkles.
function leaf(c, x, y, ang, len, wid, light) {
    c.save();
    c.translate(x, y); c.rotate(ang);
    const g = c.createLinearGradient(0, -wid, 0, wid);
    g.addColorStop(0, light ? '#fff1a8' : '#f5d462'); g.addColorStop(0.5, '#d4a22a'); g.addColorStop(1, '#8a5f12');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(len * 0.4, -wid * 1.15, len, 0);
    c.quadraticCurveTo(len * 0.4, wid * 1.1, 0, 0);
    c.fill();
    c.lineWidth = 0.008; c.strokeStyle = 'rgba(94,60,6,0.7)';
    c.beginPath(); c.moveTo(len * 0.05, 0); c.lineTo(len * 0.9, 0); c.stroke();
    c.restore();
}
function laurel() {
    const CX = 0, CY = -0.5, RX = 1.12, RY = 0.98;
    const at = th => [CX + RX * Math.cos(th), CY + RY * Math.sin(th)];
    const sparks = [[-1.1, -1.2, 0.0], [0.95, -1.35, 1.7], [-0.45, -1.62, 3.1], [1.18, -0.75, 4.4], [0.35, -1.7, 5.2], [-1.2, -0.55, 2.4]];
    return {
        id: 'laurel', label: 'Laurel', kind: 'crown', ext: [1.7, 2.0],
        layers: [{
            depth: 0, static: true,
            paint(c) {
                for (const side of [-1, 1]) {
                    const N = 12;
                    const th = k => (side < 0 ? Math.PI * 0.86 + k * Math.PI * 0.58 : Math.PI * 0.14 - k * Math.PI * 0.58);
                    c.save();
                    c.shadowColor = 'rgba(40,20,0,0.4)'; c.shadowBlur = 0.04 * ppu(c); c.shadowOffsetY = 0.02 * ppu(c);
                    // stem
                    c.beginPath();
                    for (let i = 0; i <= 40; i++) { const [x, y] = at(th(i / 40)); i ? c.lineTo(x, y) : c.moveTo(x, y); }
                    c.lineWidth = 0.034; c.lineCap = 'round'; c.strokeStyle = '#a8761b'; c.stroke();
                    c.restore();
                    for (let i = N - 1; i >= 0; i--) {
                        const k = i / (N - 1), [x, y] = at(th(k));
                        const [x2, y2] = at(th(k + 0.01));
                        const dir = Math.atan2(y2 - y, x2 - x);
                        const len = lerp(0.34, 0.2, k), wid = lerp(0.085, 0.055, k);
                        // growth direction is along the stem; one leaf pointing outward, one inward
                        const grow = dir;
                        leaf(c, x, y, grow - 0.62, len, wid, false);
                        leaf(c, x, y, grow + 0.55, len * 0.9, wid * 0.95, true);
                    }
                    // berries near the base
                    for (let i = 0; i < 3; i++) {
                        const [x, y] = at(th(0.05 + i * 0.09));
                        const bx = x + side * 0.0, by = y + 0.06;
                        const bg = c.createRadialGradient(bx - 0.01, by - 0.01, 0.003, bx, by, 0.035);
                        bg.addColorStop(0, '#fff6c2'); bg.addColorStop(1, '#b9831a');
                        c.fillStyle = bg; c.beginPath(); c.arc(bx, by, 0.034, 0, TAU); c.fill();
                    }
                }
                // a small gem where the branches meet
                const [gx, gy] = at(-Math.PI / 2);
                const gg = c.createRadialGradient(gx - 0.02, gy - 0.02, 0.005, gx, gy, 0.08);
                gg.addColorStop(0, '#ffffff'); gg.addColorStop(0.35, '#7dd3fc'); gg.addColorStop(1, '#1d4ed8');
                c.fillStyle = gg;
                c.beginPath(); c.moveTo(gx, gy - 0.1); c.lineTo(gx + 0.07, gy); c.lineTo(gx, gy + 0.1); c.lineTo(gx - 0.07, gy); c.closePath(); c.fill();
                c.lineWidth = 0.014; c.strokeStyle = '#d4a22a'; c.stroke();
            },
        }, {
            depth: 0,
            paint(c, t) {
                // halo glow breathing behind the wreath top, and twinkles
                const k = 0.5 + 0.5 * Math.sin(t * 1.6);
                c.save();
                c.globalCompositeOperation = 'lighter';
                const hg = c.createRadialGradient(0, -1.35, 0.1, 0, -1.35, 1.1);
                hg.addColorStop(0, `rgba(255,220,120,${0.16 + 0.08 * k})`); hg.addColorStop(1, 'rgba(255,220,120,0)');
                c.fillStyle = hg; c.fillRect(-1.6, -2.4, 3.2, 2.4);
                for (const [x, y, ph] of sparks) {
                    const a = clamp(Math.sin(t * 2.2 + ph) * 0.5 + 0.55);
                    if (a < 0.05) continue;
                    c.fillStyle = `rgba(255,246,200,${a})`;
                    c.beginPath(); sparkle(c, x, y, 0.06 + 0.07 * a); c.fill();
                }
                c.restore();
            },
        }],
    };
}

// ===================================================================== Origami
// A low-poly paper-fold face. Key points sit on the face (brows, eyes, nose, mouth, jaw); they are joined into
// triangular facets and lit like folded paper, with a lamp that drifts slowly across.
function origamiRelief(x, y) {
    const G = (cx, cy, sx, sy, a) => a * Math.exp(-((x - cx) ** 2 / (2 * sx * sx) + (y - cy) ** 2 / (2 * sy * sy)));
    const dome = 0.55 * Math.sqrt(Math.max(0, 1 - (x * x) / 1.2 - (y / (AR * 1.12)) ** 2 * 0.8));
    return dome
        + G(0, -0.1, 0.1, 0.4, 0.4) + G(0, 0.15, 0.2, 0.12, 0.3)               // nose ridge and tip
        - G(-0.47, -0.47, 0.22, 0.09, 0.22) - G(0.47, -0.47, 0.22, 0.09, 0.22)  // eye hollows
        + G(-0.45, -0.78, 0.3, 0.07, 0.16) + G(0.45, -0.78, 0.3, 0.07, 0.16)    // brow ridges
        + G(-0.58, 0.1, 0.22, 0.2, 0.15) + G(0.58, 0.1, 0.22, 0.2, 0.15)        // cheekbones
        - G(0, 0.4, 0.3, 0.04, 0.12) + G(0, 0.66, 0.22, 0.09, 0.12);            // mouth line, chin
}
const ORIGAMI_KEYS = (() => {
    const half = [[0.2, -1.0], [0.45, -0.95], [0.7, -0.85], [0.86, -0.68], [0.5, -0.78], [0.3, -0.62], [0.12, -0.7], [0.62, -0.52], [0.84, -0.46], [0.7, -0.3], [0.42, -0.22], [0.5, -0.42],
        [0.24, -0.45], [0.47, -0.58], [0.47, -0.37], [0.7, -0.46], [0.15, -0.2], [0.1, 0.02], [0.22, 0.16], [0.1, 0.22], [0.3, 0.02], [0.78, -0.05], [0.56, 0.12], [0.88, 0.2], [0.62, 0.35],
        [0.4, 0.42], [0.18, 0.4], [0.24, 0.56], [0.7, 0.62], [0.45, 0.8], [0.22, 0.98], [0.9, 0.42], [0.35, 0.7], [0.6, 0.5], [0.34, 0.14]];
    const pts = [[0, -1.12], [0, -0.92], [0, -0.7], [0, -0.45], [0, -0.2], [0, 0.04], [0, 0.2], [0, 0.4], [0, 0.58], [0, 0.82], [0, 1.18]];
    for (const [x, y] of half) { pts.push([x, y]); pts.push([-x, y]); }
    // boundary: points along the outline
    for (let i = 1; i < OUTLINE.length; i += 2) if (OUTLINE[i][0] !== 0) pts.push([OUTLINE[i][0] * 1.0, OUTLINE[i][1] * 1.0]);
    return pts;
})();
function origami() {
    const r = rng(31);
    const tri = delaunay(ORIGAMI_KEYS);
    const S = 2.6;
    const faces = tri.map(([a, b, c]) => {
        const A = ORIGAMI_KEYS[a], B = ORIGAMI_KEYS[b], C = ORIGAMI_KEYS[c];
        const za = origamiRelief(A[0], A[1]) * S, zb = origamiRelief(B[0], B[1]) * S, zc = origamiRelief(C[0], C[1]) * S;
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = zb - za, vx = C[0] - A[0], vy = C[1] - A[1], vz = zc - za;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1;
        const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3;
        return { p: [A, B, C], n: [nx / l, ny / l, nz / l], cx, cy, jit: r() };
    });
    // paper colours drift from aqua through blue and violet to rose across the face
    const HUE = [[0, hex('#4fd6d0')], [0.3, hex('#4f8df0')], [0.62, hex('#8a6cf2')], [1, hex('#f283c8')]];
    const WHITE = [255, 255, 255];
    const fills = new Array(faces.length);
    const inEye = (x, y) => { const ax = Math.abs(x); return Math.abs(ax - 0.47) < 0.26 && Math.abs(y + 0.47) < 0.075 + 0.1 * (0.26 - Math.abs(ax - 0.47)); };
    // The folded-paper mesh is painted into its own canvas a few times a second (the lamp moves slowly) and drawn from there.
    function renderMesh(c, t) {
        outlinePath(c, 1.0);
        c.save();
        c.clip();
        const az = -0.8 + Math.sin(t * 0.6) * 0.6, el = 0.8;
        const lx = Math.cos(az) * Math.cos(el), ly = -Math.sin(az) * Math.cos(el), lz = Math.sin(el);
        faces.forEach((f, i) => {
            const d = clamp(f.n[0] * lx + f.n[1] * ly + f.n[2] * lz);
            const hue = ramp(HUE, clamp(0.5 + f.cx * 0.42 - f.cy * 0.3));
            let col = mixc(hue, WHITE, 0.36);
            const lit = 0.68 + 0.5 * d + (f.jit - 0.5) * 0.06;
            col = [col[0] * lit, col[1] * lit, col[2] * lit * 1.03];
            col = mixc(col, WHITE, clamp((d - 0.8) * 1.8));
            if (inEye(f.cx, f.cy)) col = mixc([28, 34, 90], col, 0.12 + 0.2 * d);
            fills[i] = rgba(col);
            c.fillStyle = fills[i];
            c.beginPath();
            c.moveTo(f.p[0][0], f.p[0][1]); c.lineTo(f.p[1][0], f.p[1][1]); c.lineTo(f.p[2][0], f.p[2][1]);
            c.closePath();
            c.fill();
        });
        // fold creases
        c.lineJoin = 'round';
        c.lineWidth = 0.008; c.strokeStyle = 'rgba(30,40,110,0.32)';
        c.beginPath();
        for (const f of faces) { c.moveTo(f.p[0][0], f.p[0][1]); c.lineTo(f.p[1][0], f.p[1][1]); c.lineTo(f.p[2][0], f.p[2][1]); c.closePath(); }
        c.stroke();
        c.restore();
        outlinePath(c, 1.0);
        c.lineWidth = 0.022; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.stroke();
        outlinePath(c, 1.011);
        c.lineWidth = 0.01; c.strokeStyle = 'rgba(48,62,150,0.5)'; c.stroke();
    }
    let mesh = null, meshStep = -1;
    const MPPU = 170;
    return {
        id: 'origami', label: 'Origami', kind: 'full', ext: [1.3, 1.5], thumbT: 0.4,
        layers: [shadowLayer('#8c95cf'), {
            depth: 0,
            paint(c, t) {
                const step = Math.floor(t * 4);
                if (step !== meshStep) {
                    meshStep = step;
                    if (!mesh) { mesh = document.createElement('canvas'); mesh.width = Math.ceil(2.6 * MPPU); mesh.height = Math.ceil(3.0 * MPPU); }
                    const mc = mesh.getContext('2d');
                    mc.setTransform(1, 0, 0, 1, 0, 0); mc.clearRect(0, 0, mesh.width, mesh.height);
                    mc.setTransform(MPPU, 0, 0, MPPU, 1.3 * MPPU, 1.5 * MPPU);
                    renderMesh(mc, step / 4);
                }
                c.drawImage(mesh, -1.3, -1.5, 2.6, 3.0);
            },
        }, {
            depth: 1, static: true,
            paint(c) {
                // closed eyes as folded lids, brows and mouth
                c.lineCap = 'round'; c.lineJoin = 'round';
                for (const s of [-1, 1]) {
                    const ex = s * 0.47, ey = -0.46;
                    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 0.012;
                    c.beginPath(); c.moveTo(ex - 0.25, ey + 0.05); c.lineTo(ex + 0.02, ey + 0.1); c.lineTo(ex + 0.25, ey - 0.0); c.stroke();
                    c.strokeStyle = 'rgba(25,32,92,0.85)'; c.lineWidth = 0.026;
                    c.beginPath(); c.moveTo(ex + s * 0.3, ey - 0.27); c.lineTo(ex + s * 0.02, ey - 0.33); c.lineTo(ex - s * 0.28, ey - 0.24); c.stroke();
                }
                c.strokeStyle = 'rgba(25,32,92,0.8)'; c.lineWidth = 0.022;
                c.beginPath(); c.moveTo(-0.3, 0.38); c.lineTo(-0.1, 0.45); c.lineTo(0.1, 0.45); c.lineTo(0.3, 0.38); c.stroke();
            },
        }],
    };
}

// ===================================================================== Mosaic
// The face turns into a grid of glossy tiles. Each tile takes the brightness of the camera picture under it and
// shows it through a cool ice-to-aqua colour ramp (the real colours and skin tone never appear).
const MOSAIC_RAMP = [[0, hex('#070b2a')], [0.22, hex('#1c2a8c')], [0.45, hex('#2b6fe0')], [0.7, hex('#2fd0e6')], [0.88, hex('#9cf5df')], [1, hex('#effffb')]];
function mosaic() {
    const COLS = 9, ROWS = 11, SW = 2.0, SH = 2.4, X0 = -SW / 2, Y0 = -SH / 2, CW = SW / COLS, CH = SH / ROWS;
    const cellIn = [];
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        let hit = false;
        for (let a = 0; a < 3 && !hit; a++) for (let b = 0; b < 3 && !hit; b++) hit = insideOutline(X0 + (i + a / 2) * CW, Y0 + (j + b / 2) * CH, 1.0);
        cellIn.push(hit);
    }
    const lum = new Float32Array(COLS * ROWS);
    let lo = 60, hi = 190, primed = false;
    let big = null, bctx = null;
    const OV = 4; // the picture is sampled OV x OV times per tile, then averaged
    function sample(g, video, W, H) {
        if (!big) {
            big = document.createElement('canvas'); big.width = COLS * OV; big.height = ROWS * OV;
            bctx = big.getContext('2d');
            bctx.imageSmoothingQuality = 'high';
        }
        // the face region (rotated with the head) of the camera picture, shrunk onto a tiny canvas
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        bctx.fillStyle = '#808080'; bctx.fillRect(0, 0, big.width, big.height);
        bctx.setTransform(big.width / SW, 0, 0, big.height / SH, 0, 0);
        bctx.translate(-X0, -Y0);
        bctx.scale(1 / g.sx, 1 / g.sy);
        bctx.rotate(-g.angle);
        bctx.translate(-g.cx, -g.cy);
        bctx.drawImage(video, 0, 0, W, H);
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        const px = bctx.getImageData(0, 0, big.width, big.height).data, stride = big.width * 4;
        let mn = 255, mx = 0;
        for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
            let sum = 0;
            for (let b = 0; b < OV; b++) for (let a = 0; a < OV; a++) {
                const o = (j * OV + b) * stride + (i * OV + a) * 4;
                sum += 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
            }
            const k = j * COLS + i, L = sum / (OV * OV);
            lum[k] = primed ? lum[k] + (L - lum[k]) * 0.55 : L;
            if (cellIn[k]) { if (lum[k] < mn) mn = lum[k]; if (lum[k] > mx) mx = lum[k]; }
        }
        primed = true;
        lo += (mn - lo) * 0.1; hi += (Math.max(mx, mn + 40) - hi) * 0.1;
    }
    return {
        id: 'mosaic', label: 'Mosaic', kind: 'full', ext: [1.3, 1.5], thumbT: 0.7,
        layers: [shadowLayer('#050824'), {
            depth: 0,
            paint(c, t, g, env) {
                const live = env && env.video;
                if (live) sample(g, env.video, env.W, env.H);
                c.save();
                outlinePath(c, 1.0);
                c.clip();
                c.fillStyle = '#050824';
                c.fillRect(X0, Y0, SW, SH); // dark grout: the face never shows through the gaps between tiles
                for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
                    const k = j * COLS + i;
                    if (!cellIn[k]) continue;
                    const x = X0 + i * CW, y = Y0 + j * CH;
                    let v;
                    if (live) v = (lum[k] - lo) / Math.max(30, hi - lo);
                    else { const dx = (x + CW / 2 + 0.25) / 1.1, dy = (y + CH / 2 + 0.35) / 1.4; v = 0.95 - 0.55 * (dx * dx + dy * dy) + (Math.abs(x + CW / 2) > 0.2 && Math.abs(y + CH / 2 + 0.45) < 0.16 ? -0.3 : 0); }
                    v = clamp(v + 0.05 * Math.sin(t * 1.7 + k * 1.9));
                    c.fillStyle = rgba(ramp(MOSAIC_RAMP, v));
                    c.fillRect(x + 0.012, y + 0.012, CW - 0.024, CH - 0.024);
                }
                // glossy tile edges, batched: light on the top-left, shade on the bottom-right
                c.beginPath();
                for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
                    if (!cellIn[j * COLS + i]) continue;
                    const x = X0 + i * CW, y = Y0 + j * CH;
                    c.rect(x + 0.012, y + 0.012, CW - 0.024, 0.02); c.rect(x + 0.012, y + 0.032, 0.02, CH - 0.044);
                }
                c.fillStyle = 'rgba(255,255,255,0.22)'; c.fill();
                c.beginPath();
                for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
                    if (!cellIn[j * COLS + i]) continue;
                    const x = X0 + i * CW, y = Y0 + j * CH;
                    c.rect(x + 0.012, y + CH - 0.034, CW - 0.024, 0.022); c.rect(x + CW - 0.034, y + 0.012, 0.022, CH - 0.046);
                }
                c.fillStyle = 'rgba(0,10,40,0.28)'; c.fill();
                c.restore();
                outlinePath(c, 1.0);
                c.lineWidth = 0.02; c.strokeStyle = 'rgba(190,240,255,0.55)'; c.stroke();
            },
        }],
    };
}

// ===================================================================== Kintsugi
// A dark glazed ceramic mask repaired with seams of gold. The cracks are grown from a fixed seed; a gleam runs along them.
function growCracks() {
    const r = rng(8), out = [];
    const walk = (x, y, ang, len, w, depth) => {
        const pts = [[x, y]];
        let a = ang;
        const n = Math.max(3, Math.round(len / 0.08));
        for (let i = 0; i < n; i++) {
            a += (r() - 0.5) * 0.6;
            x += Math.cos(a) * 0.08; y += Math.sin(a) * 0.08;
            pts.push([x, y]);
            if (depth < 2 && i > 2 && i < n - 2 && r() < 0.13) walk(x, y, a + (r() < 0.5 ? -1 : 1) * (0.55 + r() * 0.5), len * (0.28 + r() * 0.3), w * 0.6, depth + 1);
        }
        out.push({ pts, w });
    };
    walk(0.55, -1.25, 1.95, 1.7, 0.058, 0);   // from the forehead, down across the right brow and cheek
    walk(-1.05, 0.08, 0.15, 1.15, 0.05, 0);   // in from the left ear
    walk(0.15, 1.25, -2.0, 0.85, 0.042, 0);   // up from the chin
    walk(-0.62, -1.25, 1.25, 0.8, 0.04, 0);   // from the left of the forehead
    return out;
}
function kintsugi() {
    const cracks = growCracks();
    let crackPath = null;
    const goldRamp = c => { const g = c.createLinearGradient(-1, -1.2, 1, 1.2); g.addColorStop(0, '#b98524'); g.addColorStop(0.3, '#f3d77a'); g.addColorStop(0.55, '#c8901f'); g.addColorStop(0.8, '#f7e39a'); g.addColorStop(1, '#a8731a'); return g; };
    return {
        id: 'kintsugi', label: 'Kintsugi', kind: 'full', ext: [1.3, 1.5], thumbT: 0.5,
        layers: [{
            depth: 0, static: true,
            paint(c) {
                // glazed ceramic base
                outlinePath(c, 1.0);
                const base = c.createRadialGradient(-0.4, -0.65, 0.05, -0.1, -0.1, 1.75);
                base.addColorStop(0, '#454c80'); base.addColorStop(0.35, '#232850'); base.addColorStop(0.75, '#111530'); base.addColorStop(1, '#070916');
                c.fillStyle = base; shadowFill(c);
                c.save(); c.clip();
                const soft = (x, y, rx, ry, rot, rgb, a) => { c.save(); c.translate(x, y); c.rotate(rot); c.scale(rx, ry); const g = c.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fill(); c.restore(); };
                // sculpted form: shadowed eye sockets, lit brow, cheek, nose and chin
                for (const s of [-1, 1]) soft(s * 0.47, -0.46, 0.36, 0.2, 0, '0,0,12', 0.4);
                soft(-0.45, -0.9, 0.6, 0.16, -0.15, '255,255,255', 0.16);
                soft(-0.58, 0.16, 0.3, 0.38, 0.15, '170,185,255', 0.12);
                soft(0.58, 0.2, 0.24, 0.3, -0.1, '170,185,255', 0.07);
                soft(-0.03, -0.12, 0.07, 0.4, 0, '190,205,255', 0.14);
                soft(0, 0.95, 0.3, 0.12, 0, '190,205,255', 0.1);
                const ns = c.createLinearGradient(0.02, 0, 0.32, 0);
                ns.addColorStop(0, 'rgba(0,0,10,0)'); ns.addColorStop(1, 'rgba(0,0,10,0.35)');
                c.fillStyle = ns; c.beginPath(); c.ellipse(0.12, 0.0, 0.18, 0.34, 0, 0, TAU); c.fill();
                // glaze: bright gloss streak and hairline craquelure
                const streak = c.createLinearGradient(-0.9, -1, -0.1, -0.5);
                streak.addColorStop(0, 'rgba(255,255,255,0)'); streak.addColorStop(0.5, 'rgba(255,255,255,0.22)'); streak.addColorStop(1, 'rgba(255,255,255,0)');
                c.fillStyle = streak; c.beginPath(); c.moveTo(-0.95, -0.85); c.lineTo(-0.6, -1.1); c.lineTo(-0.1, -0.8); c.lineTo(-0.5, -0.55); c.closePath(); c.fill();
                const rr = rng(5);
                c.strokeStyle = 'rgba(190,200,255,0.07)'; c.lineWidth = 0.004;
                for (let i = 0; i < 80; i++) {
                    let x = (rr() - 0.5) * 2, y = (rr() - 0.5) * 2.4, a = rr() * TAU;
                    c.beginPath(); c.moveTo(x, y);
                    for (let k = 0; k < 5; k++) { a += (rr() - 0.5) * 1.4; x += Math.cos(a) * 0.09; y += Math.sin(a) * 0.09; c.lineTo(x, y); }
                    c.stroke();
                }
                // a patch repaired solidly in gold
                c.beginPath();
                c.moveTo(0.4, 0.58); c.lineTo(0.52, 0.4); c.lineTo(0.7, 0.44); c.lineTo(0.82, 0.58); c.lineTo(0.72, 0.66); c.lineTo(0.76, 0.82); c.lineTo(0.56, 0.8); c.lineTo(0.5, 0.7); c.closePath();
                const patch = c.createLinearGradient(0.42, 0.42, 0.8, 0.8);
                patch.addColorStop(0, '#f6dc83'); patch.addColorStop(0.5, '#c58f22'); patch.addColorStop(1, '#8a5a12');
                c.fillStyle = patch; c.fill();
                c.lineWidth = 0.01; c.strokeStyle = 'rgba(255,245,190,0.85)'; c.stroke();
                c.save(); c.clip();
                c.strokeStyle = 'rgba(110,70,10,0.5)'; c.lineWidth = 0.008;
                c.beginPath(); c.moveTo(0.4, 0.64); c.lineTo(0.6, 0.58); c.lineTo(0.7, 0.52); c.moveTo(0.56, 0.8); c.lineTo(0.64, 0.64); c.lineTo(0.78, 0.6); c.stroke();
                c.restore();
                // gold seams, tapering along their length
                c.lineCap = 'round';
                for (const k of cracks) {
                    const n = k.pts.length - 1;
                    for (let i = 0; i < n; i++) {
                        const w = k.w * (1 - 0.75 * i / n);
                        const [x0, y0] = k.pts[i], [x1, y1] = k.pts[i + 1];
                        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
                        c.lineWidth = w * 2.4; c.strokeStyle = 'rgba(255,200,90,0.1)'; c.stroke();
                        c.lineWidth = w; c.strokeStyle = goldRamp(c); c.stroke();
                        c.lineWidth = w * 0.28; c.strokeStyle = 'rgba(255,248,205,0.85)';
                        c.beginPath(); c.moveTo(x0 - w * 0.12, y0 - w * 0.12); c.lineTo(x1 - w * 0.12, y1 - w * 0.12); c.stroke();
                    }
                }
                c.restore();
                outlinePath(c, 1.0);
                const rim = c.createLinearGradient(-1, -1.2, 1, 1.2);
                rim.addColorStop(0, 'rgba(210,220,255,0.6)'); rim.addColorStop(0.5, 'rgba(210,220,255,0.0)'); rim.addColorStop(1, 'rgba(120,140,255,0.3)');
                c.lineWidth = 0.026; c.strokeStyle = rim; c.stroke();
            },
        }, {
            depth: 1, static: true,
            paint(c) {
                // calm closed eyes, brows and a small mouth: fine gold line
                c.lineCap = 'round'; c.lineJoin = 'round';
                const gold = goldRamp(c);
                for (const s of [-1, 1]) {
                    c.strokeStyle = gold;
                    c.lineWidth = 0.032;
                    c.beginPath(); c.moveTo(s * 0.72, -0.5); c.quadraticCurveTo(s * 0.47, -0.34, s * 0.22, -0.5); c.stroke();
                    c.lineWidth = 0.011; c.strokeStyle = 'rgba(247,226,150,0.7)';
                    c.beginPath(); c.moveTo(s * 0.68, -0.58); c.quadraticCurveTo(s * 0.47, -0.74, s * 0.26, -0.6); c.stroke();
                    c.strokeStyle = gold; c.lineWidth = 0.022;
                    c.beginPath(); c.moveTo(s * 0.86, -0.78); c.quadraticCurveTo(s * 0.52, -0.94, s * 0.16, -0.78); c.stroke();
                }
                c.lineWidth = 0.02; c.strokeStyle = gold;
                c.beginPath(); c.moveTo(-0.26, 0.46); c.quadraticCurveTo(0, 0.56, 0.26, 0.46); c.stroke();
                c.lineWidth = 0.011; c.strokeStyle = 'rgba(243,215,122,0.7)';
                c.beginPath(); c.moveTo(-0.01, -0.3); c.quadraticCurveTo(-0.05, -0.05, -0.13, 0.16); c.quadraticCurveTo(0, 0.24, 0.13, 0.16); c.stroke();
            },
        }, {
            depth: 0,
            paint(c, t) {
                // a gleam travelling along the gold seams
                crackPath ||= (() => { const p = new Path2D(); for (const k of cracks) { p.moveTo(k.pts[0][0], k.pts[0][1]); for (let i = 1; i < k.pts.length; i++) p.lineTo(k.pts[i][0], k.pts[i][1]); } return p; })();
                outlinePath(c, 1.0);
                c.save(); c.clip();
                c.globalCompositeOperation = 'lighter';
                c.lineCap = 'round';
                c.setLineDash([0.18, 1.9]);
                c.lineDashOffset = -t * 0.9;
                c.lineWidth = 0.05; c.strokeStyle = 'rgba(255,190,70,0.2)'; c.stroke(crackPath);
                c.lineWidth = 0.018; c.strokeStyle = 'rgba(255,244,190,0.7)'; c.stroke(crackPath);
                c.setLineDash([]);
                c.restore();
            },
        }],
    };
}

// ===================================================================== Neon
// A dark glass face-plate with glowing line art. Eyes look around, the mouth follows yours, a scan beam sweeps down.
function glow(c, color, w, draw) {
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.globalCompositeOperation = 'lighter';
    for (const [m, a] of [[5, 0.07], [3, 0.12], [1.7, 0.25]]) { c.lineWidth = w * m; c.strokeStyle = rgba(color, a); c.beginPath(); draw(c); c.stroke(); }
    c.globalCompositeOperation = 'source-over';
    c.lineWidth = w * 0.7; c.strokeStyle = rgba(mixc(color, [255, 255, 255], 0.65)); c.beginPath(); draw(c); c.stroke();
    c.restore();
}
function neon() {
    const CY = hex('#18e0ff'), MG = hex('#ff3fd8'), VI = hex('#8a6bff');
    return {
        id: 'neon', label: 'Neon', kind: 'full', ext: [1.3, 1.5], thumbT: 0.9,
        layers: [{
            depth: 0, static: true,
            paint(c) {
                outlinePath(c, 1.0);
                const g = c.createRadialGradient(0, -0.2, 0.1, 0, 0, 1.6);
                g.addColorStop(0, '#101a45'); g.addColorStop(0.6, '#080d27'); g.addColorStop(1, '#03050f');
                c.fillStyle = g; shadowFill(c);
                c.save(); c.clip();
                // faint perspective grid
                c.strokeStyle = 'rgba(24,224,255,0.09)'; c.lineWidth = 0.006;
                for (let i = -8; i <= 8; i++) { c.beginPath(); c.moveTo(i * 0.05, 0.6); c.lineTo(i * 0.5, 1.5); c.stroke(); }
                for (let k = 0; k < 7; k++) { const y = 0.6 + (k * k) * 0.025 + k * 0.02; c.beginPath(); c.moveTo(-1.2, y); c.lineTo(1.2, y); c.stroke(); }
                // soft colour wash
                const w = c.createLinearGradient(-1, -1, 1, 1);
                w.addColorStop(0, 'rgba(138,107,255,0.22)'); w.addColorStop(0.5, 'rgba(138,107,255,0)'); w.addColorStop(1, 'rgba(255,63,216,0.2)');
                c.fillStyle = w; c.fillRect(-1.3, -1.4, 2.6, 2.8);
                c.restore();
                // glowing rim
                glow(c, CY, 0.022, cc => { outlinePath(cc, 0.985); });
                // circuit traces and a forehead emblem
                for (const s of [-1, 1]) {
                    glow(c, VI, 0.012, cc => { cc.moveTo(s * 0.9, -0.2); cc.lineTo(s * 0.74, -0.2); cc.lineTo(s * 0.64, -0.08); cc.lineTo(s * 0.64, 0.25); });
                    glow(c, VI, 0.012, cc => { cc.moveTo(s * 0.8, 0.42); cc.lineTo(s * 0.62, 0.42); cc.lineTo(s * 0.54, 0.54); });
                    glow(c, CY, 0.014, cc => { cc.moveTo(s * 0.86, -0.78); cc.quadraticCurveTo(s * 0.5, -0.98, s * 0.2, -0.84); });
                    glow(c, CY, 0.014, cc => { cc.moveTo(s * 0.18, 0.3); cc.lineTo(s * 0.18, 0.12); cc.lineTo(s * 0.12, 0.2); });
                }
                glow(c, MG, 0.016, cc => { cc.moveTo(0, -1.08); cc.lineTo(0.12, -0.92); cc.lineTo(0, -0.76); cc.lineTo(-0.12, -0.92); cc.closePath(); });
                glow(c, CY, 0.016, cc => { cc.moveTo(0, -0.42); cc.lineTo(0, -0.02); cc.lineTo(-0.14, 0.17); cc.lineTo(0.14, 0.17); });
                // chin lines
                glow(c, MG, 0.012, cc => { cc.moveTo(-0.3, 0.9); cc.quadraticCurveTo(0, 1.02, 0.3, 0.9); });
                glow(c, VI, 0.01, cc => { cc.moveTo(-0.16, 1.0); cc.quadraticCurveTo(0, 1.08, 0.16, 1.0); });
            },
        }, {
            depth: 1,
            paint(c, t, g) {
                const look = Math.sin(t * 0.8) * 0.035, bob = Math.sin(t * 1.3) * 0.01;
                for (const s of [-1, 1]) {
                    const ex = s * 0.47, ey = -0.47;
                    glow(c, MG, 0.02, cc => { cc.moveTo(ex - 0.24, ey + 0.02); cc.quadraticCurveTo(ex, ey - 0.2, ex + 0.24, ey + 0.02); cc.quadraticCurveTo(ex, ey + 0.16, ex - 0.24, ey + 0.02); });
                    glow(c, CY, 0.018, cc => { cc.arc(ex + look, ey + bob, 0.085, 0, TAU); });
                    c.fillStyle = 'rgba(255,255,255,0.95)'; c.beginPath(); c.arc(ex + look - 0.03, ey + bob - 0.03, 0.017, 0, TAU); c.fill();
                    glow(c, CY, 0.013, cc => { cc.moveTo(ex - 0.28, ey - 0.2); cc.quadraticCurveTo(ex, ey - 0.34, ex + 0.28, ey - 0.2); });
                }
                // mouth: a smile that opens when you do
                const o = g.mouth * 0.14;
                glow(c, MG, 0.02, cc => { cc.moveTo(-0.3, 0.42); cc.quadraticCurveTo(0, 0.58 + o * 1.4, 0.3, 0.42); if (o > 0.02) cc.quadraticCurveTo(0, 0.42 + o * 0.5, -0.3, 0.42); });
                // scan beam
                const k = ((t * 0.35) % 1.4) - 0.2, y = lerp(-1.3, 1.3, k);
                c.save(); outlinePath(c, 1.0); c.clip();
                c.globalCompositeOperation = 'lighter';
                const sb = c.createLinearGradient(0, y - 0.22, 0, y + 0.04);
                sb.addColorStop(0, 'rgba(24,224,255,0)'); sb.addColorStop(0.7, 'rgba(24,224,255,0.14)'); sb.addColorStop(0.9, 'rgba(120,240,255,0.3)'); sb.addColorStop(1, 'rgba(180,250,255,0)');
                c.fillStyle = sb; c.fillRect(-1.3, y - 0.22, 2.6, 0.26);
                c.restore();
            },
        }],
    };
}

// ===================================================================== Masquerade
// A glossy plum mask trimmed in gold: swept eye wings, scrollwork filigree, beaded edge and a ruby on the brow.
function scroll(c, x, y, r0, turns, rot, dir = 1) {
    c.beginPath();
    for (let i = 0; i <= 40; i++) {
        const k = i / 40, a = rot + dir * k * turns * TAU, r = r0 * (1 - k * 0.92);
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        i ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.stroke();
}
function masquerade() {
    return {
        id: 'masquerade', label: 'Masquerade', kind: 'full', ext: [1.3, 1.5], thumbT: 0.3,
        layers: [{
            depth: 0, static: true,
            paint(c) {
                const gold = c.createLinearGradient(-1.2, -1.2, 1.2, 1.2);
                gold.addColorStop(0, '#8a5a12'); gold.addColorStop(0.25, '#f7e08c'); gold.addColorStop(0.5, '#c78f21'); gold.addColorStop(0.75, '#ffe9a3'); gold.addColorStop(1, '#9a6616');
                c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 0.05 * ppu(c); c.shadowOffsetY = 0.03 * ppu(c);
                // base plum lacquer + wings
                const plum = c.createRadialGradient(-0.4, -0.7, 0.1, 0, 0, 1.7);
                plum.addColorStop(0, '#6c2a8f'); plum.addColorStop(0.5, '#3a1260'); plum.addColorStop(1, '#170726');
                c.fillStyle = plum;
                outlinePath(c, 1.0); c.fill();
                c.shadowColor = 'transparent';
                c.save(); outlinePath(c, 1.0); c.clip();
                // satin sheen
                const sh = c.createLinearGradient(-1, -1.2, 0.6, 1);
                sh.addColorStop(0, 'rgba(255,255,255,0.28)'); sh.addColorStop(0.35, 'rgba(255,255,255,0.0)'); sh.addColorStop(1, 'rgba(255,255,255,0.0)');
                c.fillStyle = sh; c.fillRect(-1.3, -1.4, 2.6, 2.8);
                const gl = c.createRadialGradient(-0.45, -0.3, 0.02, -0.45, -0.3, 0.5);
                gl.addColorStop(0, 'rgba(255,255,255,0.16)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
                c.fillStyle = gl; c.fillRect(-1.2, -1, 1.5, 1.6);
                // forehead lattice
                c.strokeStyle = 'rgba(247,224,140,0.3)'; c.lineWidth = 0.008;
                for (let i = -5; i <= 5; i++) {
                    c.beginPath(); c.moveTo(i * 0.16 - 0.5, -1.25); c.lineTo(i * 0.16 + 0.5, -0.8); c.stroke();
                    c.beginPath(); c.moveTo(i * 0.16 + 0.5, -1.25); c.lineTo(i * 0.16 - 0.5, -0.8); c.stroke();
                }
                c.restore();
                // beaded gold edge
                outlinePath(c, 1.0); c.lineWidth = 0.05; c.strokeStyle = gold; c.stroke();
                outlinePath(c, 1.0); c.lineWidth = 0.012; c.strokeStyle = 'rgba(255,245,200,0.7)'; c.stroke();
                const n = OUTLINE.length;
                for (let i = 0; i < n * 2; i++) {
                    const a = OUTLINE[i % n], b = OUTLINE[(i + 1) % n];
                    if (i >= n) continue;
                    const x = (a[0] + b[0]) / 2 * 0.985, y = (a[1] + b[1]) / 2 * 0.985;
                    const pg = c.createRadialGradient(x - 0.01, y - 0.01, 0.002, x, y, 0.03);
                    pg.addColorStop(0, '#fff8dc'); pg.addColorStop(1, '#b98524');
                    c.fillStyle = pg; c.beginPath(); c.arc(x, y, 0.026, 0, TAU); c.fill();
                }
            },
        }, {
            depth: 1, static: true,
            paint(c) {
                const gold = c.createLinearGradient(-1.2, -1.2, 1.2, 1.2);
                gold.addColorStop(0, '#8a5a12'); gold.addColorStop(0.25, '#f7e08c'); gold.addColorStop(0.5, '#c78f21'); gold.addColorStop(0.75, '#ffe9a3'); gold.addColorStop(1, '#9a6616');
                c.lineCap = 'round'; c.lineJoin = 'round';
                for (const s of [-1, 1]) {
                    // eye: glossy black almond in a gold rim, with lashes of scrollwork
                    const ex = s * 0.47, ey = -0.46;
                    c.beginPath(); c.moveTo(ex - 0.3, ey + 0.06); c.quadraticCurveTo(ex - 0.02, ey - 0.28, ex + 0.3, ey - 0.02); c.quadraticCurveTo(ex, ey + 0.2, ex - 0.3, ey + 0.06); c.closePath();
                    const eg = c.createLinearGradient(0, ey - 0.2, 0, ey + 0.15); eg.addColorStop(0, '#05010a'); eg.addColorStop(1, '#2a1244');
                    c.fillStyle = eg; c.fill(); c.lineWidth = 0.03; c.strokeStyle = gold; c.stroke();
                    c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.ellipse(ex - 0.06 * s, ey - 0.03, 0.045, 0.02, -0.4 * s, 0, TAU); c.fill();
                    // gold liner sweeping from the eye to the temple, ending in a turquoise jewel
                    c.strokeStyle = gold; c.lineWidth = 0.026;
                    c.beginPath(); c.moveTo(s * 0.72, -0.47); c.quadraticCurveTo(s * 0.86, -0.54, s * 0.93, -0.66); c.stroke();
                    const jg = c.createRadialGradient(s * 0.93 - 0.01, -0.67, 0.003, s * 0.93, -0.66, 0.05);
                    jg.addColorStop(0, '#d9fff8'); jg.addColorStop(0.5, '#25c7b5'); jg.addColorStop(1, '#0a6a72');
                    c.fillStyle = jg; c.beginPath(); c.arc(s * 0.93, -0.66, 0.042, 0, TAU); c.fill();
                    c.lineWidth = 0.012; c.strokeStyle = gold; c.stroke();
                    // brow arc with scroll
                    c.strokeStyle = gold; c.lineWidth = 0.034;
                    c.beginPath(); c.moveTo(s * 0.12, -0.75); c.quadraticCurveTo(s * 0.5, -0.98, s * 0.92, -0.74); c.stroke();
                    c.lineWidth = 0.016;
                    scroll(c, s * 0.97, -0.62, 0.12, 1.6, s > 0 ? 0.3 : Math.PI - 0.3, s > 0 ? 1 : -1);
                    scroll(c, s * 0.62, -0.84, 0.07, 1.4, Math.PI / 2, s > 0 ? -1 : 1);
                    // cheek filigree
                    c.lineWidth = 0.02;
                    c.beginPath(); c.moveTo(s * 0.22, -0.24); c.quadraticCurveTo(s * 0.62, -0.18, s * 0.88, 0.04); c.stroke();
                    c.lineWidth = 0.015;
                    scroll(c, s * 0.7, 0.16, 0.16, 1.7, 0.2, s > 0 ? 1 : -1);
                    scroll(c, s * 0.46, 0.0, 0.09, 1.5, -0.4, s > 0 ? -1 : 1);
                    scroll(c, s * 0.5, 0.68, 0.14, 1.6, -0.3, s > 0 ? -1 : 1);
                    c.lineWidth = 0.02;
                    c.beginPath(); c.moveTo(s * 0.88, 0.32); c.quadraticCurveTo(s * 0.7, 0.58, s * 0.38, 0.8); c.stroke();
                    // small pearls
                    for (const [px, py] of [[0.36, -0.15], [0.58, -0.1], [0.78, -0.02]]) {
                        const pg = c.createRadialGradient(s * px - 0.008, py - 0.008, 0.002, s * px, py, 0.026);
                        pg.addColorStop(0, '#ffffff'); pg.addColorStop(1, '#d4a22a');
                        c.fillStyle = pg; c.beginPath(); c.arc(s * px, py, 0.022, 0, TAU); c.fill();
                    }
                }
                // nose: gold bridge ornament
                c.strokeStyle = gold; c.lineWidth = 0.022;
                c.beginPath(); c.moveTo(0, -0.38); c.quadraticCurveTo(-0.05, -0.1, 0, 0.12); c.stroke();
                c.lineWidth = 0.016;
                c.beginPath(); c.moveTo(-0.15, 0.2); c.quadraticCurveTo(0, 0.3, 0.15, 0.2); c.stroke();
                scroll(c, -0.17, 0.12, 0.06, 1.3, -0.5, -1); scroll(c, 0.17, 0.12, 0.06, 1.3, Math.PI + 0.5, 1);
                // lips: a small ruby smile
                const lg = c.createLinearGradient(0, 0.38, 0, 0.6); lg.addColorStop(0, '#ff4d6d'); lg.addColorStop(1, '#8b0a2a');
                c.fillStyle = lg;
                c.beginPath(); c.moveTo(-0.2, 0.46); c.quadraticCurveTo(-0.08, 0.4, 0, 0.43); c.quadraticCurveTo(0.08, 0.4, 0.2, 0.46); c.quadraticCurveTo(0, 0.6, -0.2, 0.46); c.closePath(); c.fill();
                c.lineWidth = 0.014; c.strokeStyle = gold; c.stroke();
                c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 0.01; c.beginPath(); c.moveTo(-0.08, 0.47); c.quadraticCurveTo(0, 0.5, 0.08, 0.47); c.stroke();
            },
        }, {
            depth: 0,
            paint(c, t) {
                // ruby in the middle of the brow with a twinkle
                const gx = 0, gy = -0.92;
                const rg = c.createRadialGradient(gx - 0.03, gy - 0.04, 0.005, gx, gy, 0.12);
                rg.addColorStop(0, '#ffd1dc'); rg.addColorStop(0.3, '#ff2f5c'); rg.addColorStop(1, '#6b0720');
                c.beginPath(); c.moveTo(gx, gy - 0.14); c.lineTo(gx + 0.1, gy); c.lineTo(gx, gy + 0.14); c.lineTo(gx - 0.1, gy); c.closePath();
                c.fillStyle = rg; c.fill();
                c.lineWidth = 0.022; c.strokeStyle = '#e2b13d'; c.lineJoin = 'round'; c.stroke();
                const a = clamp(Math.sin(t * 2.4) * 0.6 + 0.45);
                c.save(); c.globalCompositeOperation = 'lighter';
                c.fillStyle = `rgba(255,240,235,${a * 0.8})`; c.beginPath(); sparkle(c, gx - 0.03, gy - 0.04, 0.05 + 0.04 * a, 0.12); c.fill();
                c.restore();
            },
        }],
    };
}

// ===================================================================== Glitch
// A corrupted digital face: a blocky glyph split into red, green and blue copies that slip sideways and shear in bursts.
function glitch() {
    let glyphs = null;
    const glyph = c => {
        c.fillStyle = '#fff';
        // eyes: wide bars with a notch, brows, nose and mouth, all built from blocks
        for (const s of [-1, 1]) {
            c.fillRect(s * 0.47 - 0.24, -0.52, 0.48, 0.1);
            c.fillRect(s * 0.47 - 0.1, -0.42, 0.2, 0.07);
            c.fillRect(s * 0.47 - (s > 0 ? 0.3 : 0.18), -0.74, 0.48, 0.04);
            c.fillRect(s * 0.9 - 0.03, -0.6, 0.06, 0.5);
        }
        c.fillRect(-0.04, -0.34, 0.08, 0.5); c.fillRect(-0.04, 0.12, 0.2, 0.06);
        c.fillRect(-0.34, 0.42, 0.68, 0.07); c.fillRect(-0.34, 0.36, 0.06, 0.06); c.fillRect(0.28, 0.36, 0.06, 0.06);
        c.fillRect(-0.18, 0.56, 0.36, 0.035);
        c.fillRect(-0.6, 0.78, 0.2, 0.05); c.fillRect(0.4, 0.78, 0.2, 0.05); c.fillRect(-0.9, -0.95, 0.3, 0.04); c.fillRect(0.55, -0.95, 0.35, 0.04);
        // a few stray pixels
        const r = rng(3);
        for (let i = 0; i < 26; i++) c.fillRect((r() - 0.5) * 1.9, (r() - 0.5) * 2.3, 0.03 + r() * 0.05, 0.03);
    };
    const tint = col => makeTinted(col, glyph);
    function makeTinted(col, draw) {
        const cv = document.createElement('canvas'); cv.width = 220; cv.height = 260;
        const c = cv.getContext('2d');
        c.setTransform(100, 0, 0, 100, 110, 130);
        draw(c);
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = 'source-in'; c.fillStyle = col; c.fillRect(0, 0, 220, 260);
        return cv;
    }
    return {
        id: 'glitch', label: 'Glitch', kind: 'full', ext: [1.3, 1.5], thumbT: 1.9,
        layers: [{
            depth: 0, static: true,
            paint(c) {
                outlinePath(c, 1.0);
                const g = c.createLinearGradient(0, -1.2, 0, 1.2);
                g.addColorStop(0, '#181830'); g.addColorStop(1, '#07070f');
                c.fillStyle = g; shadowFill(c);
                c.save(); c.clip();
                const r = rng(9);
                // noisy blocks
                for (let i = 0; i < 40; i++) {
                    c.fillStyle = `rgba(${r() < 0.5 ? '0,255,230' : '255,0,170'},${0.05 + r() * 0.1})`;
                    c.fillRect((r() - 0.5) * 2.4, (r() - 0.5) * 2.8, 0.1 + r() * 0.4, 0.015 + r() * 0.03);
                }
                // scanlines
                c.fillStyle = 'rgba(0,0,0,0.35)';
                for (let y = -1.3; y < 1.3; y += 0.034) c.fillRect(-1.3, y, 2.6, 0.012);
                c.restore();
                outlinePath(c, 1.0); c.lineWidth = 0.02; c.strokeStyle = 'rgba(255,255,255,0.3)'; c.stroke();
            },
        }, {
            depth: 1,
            paint(c, t) {
                glyphs ||= { r: tint('#ff2d55'), g: tint('#00ffa8'), b: tint('#2f6bff'), w: tint('#ffffff') };
                const block = Math.floor(t * 14), rnd = rng(block * 977 + 13);
                c.save(); outlinePath(c, 1.0); c.clip();
                const burst = rnd() < 0.2 || (t % 3.4) < 0.22;
                const split = burst ? 0.05 + rnd() * 0.06 : 0.02 + 0.006 * Math.sin(t * 3);
                c.save();
                c.globalCompositeOperation = 'lighter';
                const sheet = (img, dx, dy = 0) => c.drawImage(img, -1.1 + dx, -1.3 + dy, 2.2, 2.6);
                if (!burst) {
                    sheet(glyphs.r, -split); sheet(glyphs.g, 0); sheet(glyphs.b, split);
                } else {
                    // sheared horizontal slices, each shifted by its own amount
                    const sl = 9; const rows = [];
                    for (let k = 0; k < sl; k++) rows.push(rnd());
                    for (let k = 0; k < sl; k++) {
                        const y0 = k / sl, h = 1 / sl, shift = rows[k] < 0.4 ? (rows[k] - 0.2) * 0.9 : 0;
                        for (const [img, d] of [[glyphs.r, -split], [glyphs.g, 0], [glyphs.b, split]]) {
                            c.drawImage(img, 0, y0 * 260, 220, h * 260 + 1, -1.1 + d + shift, -1.3 + y0 * 2.6, 2.2, h * 2.6 + 0.005);
                        }
                    }
                    // colour block artefacts
                    for (let k = 0; k < 4; k++) {
                        c.fillStyle = ['rgba(255,45,85,0.45)', 'rgba(0,255,168,0.4)', 'rgba(47,107,255,0.5)', 'rgba(255,255,255,0.35)'][k];
                        c.fillRect((rnd() - 0.5) * 2, (rnd() - 0.5) * 2.4, 0.2 + rnd() * 0.5, 0.03 + rnd() * 0.05);
                    }
                }
                c.restore();
                // bright scan bar crawling down
                c.save(); outlinePath(c, 1.0); c.clip();
                const y = ((t * 0.5) % 1.3) * 3 - 1.5;
                const sb = c.createLinearGradient(0, y - 0.2, 0, y + 0.2);
                sb.addColorStop(0, 'rgba(255,255,255,0)'); sb.addColorStop(0.5, 'rgba(255,255,255,0.12)'); sb.addColorStop(1, 'rgba(255,255,255,0)');
                c.fillStyle = sb; c.fillRect(-1.3, y - 0.2, 2.6, 0.4);
                c.restore();
                c.restore();
            },
        }],
    };
}

// ===================================================================== Spirit
// A smooth pearl-lavender porcelain mask. Its eyes are calm; when you open your mouth the mask smiles and opens too.
function spirit() {
    return {
        id: 'spirit', label: 'Spirit', kind: 'full', ext: [1.3, 1.5], thumbT: 0.2,
        layers: [{
            depth: 0, static: true,
            paint(c) {
                c.save();
                c.shadowColor = 'rgba(30,10,70,0.35)'; c.shadowBlur = 0.06 * ppu(c); c.shadowOffsetY = 0.03 * ppu(c);
                outlinePath(c, 1.0);
                const g = c.createRadialGradient(-0.35, -0.6, 0.1, 0, 0, 1.7);
                g.addColorStop(0, '#fffbff'); g.addColorStop(0.45, '#e9defc'); g.addColorStop(0.85, '#b9a4ee'); g.addColorStop(1, '#9a86df');
                c.fillStyle = g; c.fill();
                c.restore();
                c.save(); outlinePath(c, 1.0); c.clip();
                // pastel iridescence
                const iri = c.createLinearGradient(-1, -1.2, 1, 1.2);
                iri.addColorStop(0, 'rgba(255,170,210,0.22)'); iri.addColorStop(0.5, 'rgba(160,255,230,0.0)'); iri.addColorStop(1, 'rgba(140,190,255,0.28)');
                c.fillStyle = iri; c.fillRect(-1.3, -1.4, 2.6, 2.8);
                // gloss
                const gl = (x, y, rx, ry, rot, a) => { c.save(); c.translate(x, y); c.rotate(rot); c.scale(rx, ry); const q = c.createRadialGradient(0, 0, 0, 0, 0, 1); q.addColorStop(0, `rgba(255,255,255,${a})`); q.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = q; c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fill(); c.restore(); };
                gl(-0.42, -0.82, 0.5, 0.2, -0.3, 0.75); gl(-0.55, 0.35, 0.22, 0.36, 0.2, 0.3);
                // soft cheeks
                gl(-0.58, 0.2, 0.26, 0.17, 0, 0.0);
                for (const s of [-1, 1]) {
                    const q = c.createRadialGradient(s * 0.58, 0.2, 0, s * 0.58, 0.2, 0.26); q.addColorStop(0, 'rgba(255,140,180,0.5)'); q.addColorStop(1, 'rgba(255,140,180,0)');
                    c.fillStyle = q; c.fillRect(s * 0.58 - 0.3, -0.1, 0.6, 0.6);
                }
                // rim shading
                outlinePath(c, 1.0);
                const rim = c.createRadialGradient(0, 0, 0.7, 0, 0, 1.45); rim.addColorStop(0, 'rgba(90,60,170,0)'); rim.addColorStop(1, 'rgba(90,60,170,0.3)');
                c.fillStyle = rim; c.fill();
                c.restore();
                // forehead flower: three petals and a gold bead
                for (let i = 0; i < 3; i++) {
                    c.save(); c.translate(0, -0.78); c.rotate(i * TAU / 3 + Math.PI);
                    const pg = c.createLinearGradient(0, 0, 0, -0.22); pg.addColorStop(0, '#7a5cf0'); pg.addColorStop(1, '#5ad1c9');
                    c.fillStyle = pg; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(0.1, -0.12, 0, -0.24); c.quadraticCurveTo(-0.1, -0.12, 0, 0); c.fill();
                    c.restore();
                }
                const bg = c.createRadialGradient(-0.01, -0.8, 0.002, 0, -0.78, 0.04); bg.addColorStop(0, '#fff6c8'); bg.addColorStop(1, '#d6a02a');
                c.fillStyle = bg; c.beginPath(); c.arc(0, -0.78, 0.034, 0, TAU); c.fill();
                // a small curve for the nose
                c.strokeStyle = 'rgba(110,80,190,0.45)'; c.lineWidth = 0.016; c.lineCap = 'round';
                c.beginPath(); c.moveTo(-0.07, 0.08); c.quadraticCurveTo(0, 0.17, 0.07, 0.08); c.stroke();
                c.beginPath(); c.moveTo(0.01, -0.28); c.quadraticCurveTo(0.05, -0.08, 0.02, 0.06); c.stroke();
            },
        }, {
            depth: 1,
            paint(c, t, g) {
                const happy = clamp(g.mouth * 1.6);
                // blink every few seconds
                const bt = (t % 4.6), blink = bt < 0.14 ? Math.sin(bt / 0.14 * Math.PI) : 0;
                c.lineCap = 'round'; c.lineJoin = 'round';
                for (const s of [-1, 1]) {
                    const ex = s * 0.47, ey = -0.46;
                    // calm: crescent curving down; happy: crescent curving up
                    const bend = lerp(0.1, -0.12, happy) * (1 - 0.8 * blink);
                    c.strokeStyle = '#3d2f85'; c.lineWidth = 0.05;
                    c.beginPath(); c.moveTo(ex - 0.2, ey); c.quadraticCurveTo(ex, ey + bend * 2, ex + 0.2, ey); c.stroke();
                    c.strokeStyle = 'rgba(61,47,133,0.55)'; c.lineWidth = 0.016;
                    c.beginPath(); c.moveTo(ex - 0.26, ey - 0.02); c.lineTo(ex - 0.3, ey - 0.06); c.stroke();
                    c.beginPath(); c.moveTo(ex + 0.26, ey - 0.02); c.lineTo(ex + 0.3, ey - 0.06); c.stroke();
                    // brows
                    c.strokeStyle = 'rgba(61,47,133,0.5)'; c.lineWidth = 0.022;
                    c.beginPath(); c.moveTo(ex - 0.22, -0.7 - happy * 0.03); c.quadraticCurveTo(ex, -0.8 - happy * 0.05, ex + 0.22, -0.7 - happy * 0.03); c.stroke();
                    // twinkle at the outer corner when smiling
                    if (happy > 0.2) { c.fillStyle = `rgba(255,230,150,${happy})`; c.beginPath(); sparkle(c, s * 0.86, -0.54, 0.05 + 0.04 * Math.sin(t * 6)); c.fill(); }
                }
                // mouth
                const o = g.mouth;
                if (o < 0.12) {
                    c.strokeStyle = '#a23c78'; c.lineWidth = 0.034;
                    c.beginPath(); c.moveTo(-0.16, 0.46); c.quadraticCurveTo(0, 0.56 + o * 0.4, 0.16, 0.46); c.stroke();
                } else {
                    const w = 0.17 + 0.06 * o, h = 0.05 + 0.2 * o;
                    c.beginPath(); c.moveTo(-w, 0.45); c.quadraticCurveTo(0, 0.45 + h * 0.2, w, 0.45); c.quadraticCurveTo(0, 0.5 + h * 2, -w, 0.45); c.closePath();
                    const mg = c.createLinearGradient(0, 0.45, 0, 0.45 + h * 1.3); mg.addColorStop(0, '#5a1442'); mg.addColorStop(1, '#c94b88');
                    c.fillStyle = mg; c.fill(); c.lineWidth = 0.022; c.strokeStyle = '#a23c78'; c.stroke();
                }
            },
        }],
    };
}



// ===================================================================== Constellation
// A night-sky face-plate: the features are drawn as a constellation of twinkling stars joined by fine lines.
const STARS = {
    browL: [[-0.86, -0.64], [-0.64, -0.8], [-0.38, -0.8], [-0.14, -0.7]],
    eyeL: [[-0.7, -0.46], [-0.47, -0.58], [-0.24, -0.46], [-0.47, -0.36]],
    nose: [[0, -0.5], [0, -0.1], [-0.17, 0.16], [0, 0.22], [0.17, 0.16]],
    mouth: [[-0.4, 0.4], [-0.2, 0.5], [0, 0.46], [0.2, 0.5], [0.4, 0.4]],
    cheekL: [[-0.82, -0.1], [-0.62, 0.22], [-0.3, 0.14]],
    jawL: [[-0.88, 0.2], [-0.68, 0.7], [-0.4, 1.0], [-0.14, 1.12]],
    crown: [[-0.5, -1.0], [0, -1.1], [0.5, -1.0]],
};
function constellation() {
    const mir = a => a.map(([x, y]) => [-x, y]);
    const eyeL = STARS.eyeL, eyeR = mir(STARS.eyeL);
    const sets = [STARS.browL, mir(STARS.browL), eyeL, eyeR, STARS.nose, STARS.mouth, STARS.cheekL, mir(STARS.cheekL), STARS.jawL, mir(STARS.jawL), STARS.crown];
    const closed = new Set([eyeL, eyeR]);
    const nodes = [];
    sets.forEach(s => s.forEach(p => nodes.push(p)));
    let glowSpr = null;
    const r = rng(41), dust = [];
    for (let i = 0; i < 90; i++) { let x, y; do { x = (r() - 0.5) * 2.2; y = (r() - 0.5) * 2.6; } while (!insideOutline(x, y, 0.97)); dust.push([x, y, r() * TAU, 0.3 + r() * 0.7]); }
    return {
        id: 'constellation', label: 'Constellation', kind: 'full', ext: [1.3, 1.5], thumbT: 0.8,
        layers: [{
            depth: 0, static: true,
            paint(c) {
                outlinePath(c, 1.0);
                const g = c.createRadialGradient(0, -0.3, 0.1, 0, 0, 1.7);
                g.addColorStop(0, '#231a5c'); g.addColorStop(0.55, '#0e0f33'); g.addColorStop(1, '#05061a');
                c.fillStyle = g; shadowFill(c);
                c.save(); c.clip();
                c.globalCompositeOperation = 'lighter';
                for (const [x, y, rad, col] of [[-0.5, 0.35, 0.9, '40,200,190'], [0.55, -0.5, 0.85, '200,70,220'], [0.1, 0.95, 0.7, '70,110,255'], [-0.2, -0.95, 0.6, '110,90,255']]) {
                    const q = c.createRadialGradient(x, y, 0, x, y, rad); q.addColorStop(0, `rgba(${col},0.22)`); q.addColorStop(1, `rgba(${col},0)`);
                    c.fillStyle = q; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
                }
                c.restore();
                outlinePath(c, 0.985); c.lineWidth = 0.014; c.strokeStyle = 'rgba(160,190,255,0.5)'; c.stroke();
            },
        }, {
            depth: 1, static: true,
            paint(c) {
                c.lineWidth = 0.011; c.lineJoin = 'round'; c.strokeStyle = 'rgba(170,205,255,0.8)';
                for (const s of sets) {
                    c.beginPath(); s.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); if (closed.has(s)) c.closePath(); c.stroke();
                }
                c.lineWidth = 0.006; c.strokeStyle = 'rgba(170,200,255,0.3)';
                c.beginPath(); c.moveTo(-0.24, -0.46); c.lineTo(-0.14, -0.7); c.moveTo(0.24, -0.46); c.lineTo(0.14, -0.7); c.moveTo(-0.17, 0.16); c.lineTo(-0.4, 0.4); c.moveTo(0.17, 0.16); c.lineTo(0.4, 0.4); c.stroke();
            },
        }, {
            depth: 1,
            paint(c, t) {
                c.save();
                c.globalCompositeOperation = 'lighter';
                // dust stars: three brightness groups, batched into one path each
                for (let gI = 0; gI < 3; gI++) {
                    c.fillStyle = `rgba(210,225,255,${0.25 + 0.2 * Math.sin(t * (0.9 + gI * 0.6) + gI * 2)})`;
                    c.beginPath();
                    for (let i = gI; i < dust.length; i += 3) { const d = dust[i]; c.rect(d[0] - 0.008 * d[3], d[1] - 0.008 * d[3], 0.016 * d[3] + 0.006, 0.016 * d[3] + 0.006); }
                    c.fill();
                }
                // main stars: a shared glow picture plus a sparkle each (no gradients built per frame)
                glowSpr ||= (() => {
                    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
                    const g = cv.getContext('2d'), q = g.createRadialGradient(32, 32, 0, 32, 32, 32);
                    q.addColorStop(0, 'rgba(255,255,255,0.85)'); q.addColorStop(0.25, 'rgba(150,190,255,0.32)'); q.addColorStop(1, 'rgba(150,190,255,0)');
                    g.fillStyle = q; g.fillRect(0, 0, 64, 64);
                    return cv;
                })();
                c.fillStyle = '#fff';
                nodes.forEach(([x, y], i) => {
                    const a = 0.7 + 0.3 * Math.sin(t * 2.1 + i * 1.7), R = (i % 4 === 0 ? 0.038 : 0.026) + 0.014 * a;
                    c.globalAlpha = a;
                    c.drawImage(glowSpr, x - R * 3.2, y - R * 3.2, R * 6.4, R * 6.4);
                    c.globalAlpha = 0.95 * a;
                    c.beginPath(); sparkle(c, x, y, R * 1.6, 0.12); c.fill();
                });
                c.globalAlpha = 1;
                // a shooting star every few seconds
                const k = (t % 6) / 1.1;
                if (k < 1) {
                    const x = lerp(-1.1, 0.7, k), y = lerp(-1.0, 0.2, k);
                    const sg = c.createLinearGradient(x, y, x - 0.5, y - 0.28);
                    sg.addColorStop(0, `rgba(255,255,255,${1 - k})`); sg.addColorStop(1, 'rgba(255,255,255,0)');
                    c.save(); outlinePath(c, 1.0); c.clip();
                    c.strokeStyle = sg; c.lineWidth = 0.02; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 0.5, y - 0.28); c.stroke();
                    c.restore();
                }
                c.restore();
            },
        }],
    };
}

// ===================================================================== Star band (accessory)
// A pearl headband with two springy antennae topped by glowing stars. The stars bounce when your head moves.
function starBand() {
    const CX = 0, CY = -0.5, RX = 1.06, RY = 0.98;
    const arc = th => [CX + RX * Math.cos(th), CY + RY * Math.sin(th)];
    const base = side => { const x = side * 0.46, y = CY - RY * Math.sqrt(1 - (x / RX) ** 2); return [x, y]; };
    const rest = side => [side * 0.78, -2.12];
    // spring state per antenna: displacement of the star from its rest position (canonical units)
    const sp = [{ x: 0, y: 0, vx: 0, vy: 0 }, { x: 0, y: 0, vx: 0, vy: 0 }];
    let lastT = null, lastVx = 0, lastVy = 0;
    const star = (c, x, y, R, rot) => {
        c.save();
        c.translate(x, y); c.rotate(rot);
        c.globalCompositeOperation = 'lighter';
        const gl = c.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 2.3);
        gl.addColorStop(0, 'rgba(255,214,102,0.5)'); gl.addColorStop(1, 'rgba(255,214,102,0)');
        c.fillStyle = gl; c.fillRect(-R * 2.3, -R * 2.3, R * 4.6, R * 4.6);
        c.globalCompositeOperation = 'source-over';
        c.lineJoin = 'round';
        c.beginPath(); starPath(c, 0, 0, R, R * 0.48);
        const g = c.createLinearGradient(-R, -R, R, R);
        g.addColorStop(0, '#fff6b8'); g.addColorStop(0.5, '#ffc933'); g.addColorStop(1, '#ee8a0a');
        c.fillStyle = g; c.fill();
        c.lineWidth = R * 0.14; c.strokeStyle = '#ffe58a'; c.stroke();
        c.beginPath(); starPath(c, 0, 0, R * 0.5, R * 0.24); c.fillStyle = 'rgba(255,255,255,0.55)'; c.fill();
        c.restore();
    };
    return {
        id: 'stars', label: 'Star band', kind: 'crown', ext: [1.8, 2.7],
        layers: [{
            depth: 0,
            paint(c, t, g) {
                // spring physics driven by how the head accelerates
                const dt = lastT === null ? 0 : clamp(t - lastT, 0, 0.05);
                lastT = t;
                const sxp = Math.max(20, g.sx || 90);
                const ax = dt ? (g.vx - lastVx) / dt / sxp : 0, ay = dt ? (g.vy - lastVy) / dt / sxp : 0;
                lastVx = g.vx || 0; lastVy = g.vy || 0;
                const cosA = Math.cos(g.angle || 0), sinA = Math.sin(g.angle || 0);
                // head acceleration in the mask's own frame (the mask is rotated with the head)
                const lax = (ax * cosA + ay * sinA), lay = (-ax * sinA + ay * cosA);
                for (let k = 0; k < 2; k++) {
                    const s = sp[k];
                    for (let i = 0; i < 2 && dt; i++) {
                        const h = dt / 2;
                        s.vx += (-70 * s.x - 5.5 * s.vx - lax * 0.012) * h;
                        s.vy += (-70 * s.y - 5.5 * s.vy - lay * 0.012) * h;
                        s.x = clamp(s.x + s.vx * h, -0.7, 0.7); s.y = clamp(s.y + s.vy * h, -0.5, 0.5);
                    }
                    if (!dt) { s.x = s.y = s.vx = s.vy = 0; }
                }
                // a gentle idle sway so the stars are alive even when you sit still
                const sway = [Math.sin(t * 2.0) * 0.03, Math.sin(t * 2.0 + 1.3) * 0.03];
                c.lineCap = 'round';
                // headband
                c.save();
                c.shadowColor = 'rgba(0,0,0,0.3)'; c.shadowBlur = 0.04 * ppu(c); c.shadowOffsetY = 0.02 * ppu(c);
                c.beginPath();
                for (let i = 0; i <= 40; i++) { const [x, y] = arc(Math.PI * (1.06 + 0.88 * i / 40)); i ? c.lineTo(x, y) : c.moveTo(x, y); }
                const bg = c.createLinearGradient(-1.1, 0, 1.1, 0);
                bg.addColorStop(0, '#9d8bf0'); bg.addColorStop(0.5, '#f4efff'); bg.addColorStop(1, '#8a7ae6');
                c.lineWidth = 0.075; c.strokeStyle = bg; c.stroke();
                c.restore();
                c.beginPath();
                for (let i = 0; i <= 40; i++) { const [x, y] = arc(Math.PI * (1.06 + 0.88 * i / 40)); i ? c.lineTo(x, y - 0.018) : c.moveTo(x, y - 0.018); }
                c.lineWidth = 0.014; c.strokeStyle = 'rgba(255,255,255,0.8)'; c.stroke();
                // antennae
                [-1, 1].forEach((side, k) => {
                    const [bx, by] = base(side), [rx, ry] = rest(side), s = sp[k];
                    const tx = rx + s.x + sway[k] * side, ty = ry + s.y;
                    const dx = tx - bx, dy = ty - by, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
                    c.beginPath();
                    const N = 34;
                    for (let i = 0; i <= N; i++) {
                        const u = i / N, off = Math.sin(u * Math.PI * 9) * 0.045 * Math.min(1, u * 8) * (1 - u * 0.3);
                        const px = bx + dx * u + nx * off, py = by + dy * u + ny * off;
                        i ? c.lineTo(px, py) : c.moveTo(px, py);
                    }
                    const sg = c.createLinearGradient(bx, by, tx, ty);
                    sg.addColorStop(0, '#d5d9e6'); sg.addColorStop(1, '#8e97b0');
                    c.lineWidth = 0.022; c.strokeStyle = sg; c.stroke();
                    star(c, tx, ty, 0.2, Math.atan2(s.vx, 1) * 0.6 + sway[k] * 2);
                });
            },
        }],
    };
}

export const DESIGNS = [shades(), laurel(), starBand(), origami(), mosaic(), kintsugi(), neon(), masquerade(), glitch(), spirit(), constellation()];
