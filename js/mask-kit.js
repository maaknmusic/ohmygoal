// =====================================================================
// Small drawing toolkit shared by the face-mask artwork (mask-art.js) and the mask renderer (masks.js).
// Everything the masks show is ORIGINAL artwork drawn in code (Canvas 2D paths, gradients, procedural
// noise): no emoji glyphs, no text-glyph art, no image files, nothing copied from any other app or set.
//
// Mask drawing space ("canonical face space"): the origin is the centre of the face oval, x runs ear to ear
// (-1 .. 1) and y runs forehead to chin (-AR .. AR), with the same unit on both axes for an average face.
// masks.js maps this space onto the tracked face (translate, roll, scale), so artwork only thinks in these units.
// =====================================================================

export const AR = 1.2; // half-height of the face oval in half-widths (forehead top y = -AR, chin y = +AR)

// Average face outline (right half, top to chin), measured from MediaPipe's face-oval landmarks.
const HALF = [[0, -1.2], [0.28, -1.19], [0.51, -1.16], [0.73, -1.09], [0.86, -0.98], [0.94, -0.83], [0.98, -0.68], [1, -0.48], [1, -0.28],
    [0.99, -0.08], [0.96, 0.14], [0.92, 0.38], [0.83, 0.59], [0.73, 0.74], [0.6, 0.88], [0.48, 1], [0.34, 1.1], [0.18, 1.18], [0, 1.2]];
export const OUTLINE = [...HALF, ...HALF.slice(1, -1).reverse().map(([x, y]) => [-x, y])];

/** Seeded random numbers, so generated artwork (cracks, stars, folds) is identical on every device and run. */
export function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const TAU = Math.PI * 2;

/** Colour helpers: colours are [r, g, b] arrays. */
export const hex = s => { const n = parseInt(s.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
/** Colour ramp: stops = [[pos, [r,g,b]], ...] sorted by pos. */
export function ramp(stops, t) {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) return mixc(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    }
    return stops[stops.length - 1][1];
}

/** Adds a smooth closed curve through the points (Catmull-Rom converted to Beziers) to the current path. */
export function smoothClosed(c, pts, sx = 1, sy = 1, k = 0.5) {
    const n = pts.length;
    const p = i => pts[(i + n) % n];
    c.moveTo(p(0)[0] * sx, p(0)[1] * sy);
    for (let i = 0; i < n; i++) {
        const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
        c.bezierCurveTo(
            (p1[0] + (p2[0] - p0[0]) * k / 3 * 1) * sx, (p1[1] + (p2[1] - p0[1]) * k / 3 * 1) * sy,
            (p2[0] - (p3[0] - p1[0]) * k / 3 * 1) * sx, (p2[1] - (p3[1] - p1[1]) * k / 3 * 1) * sy,
            p2[0] * sx, p2[1] * sy);
    }
    c.closePath();
}

/** Smooth open curve through the points. */
export function smoothOpen(c, pts, k = 0.5, move = true) {
    const n = pts.length;
    if (move) c.moveTo(pts[0][0], pts[0][1]);
    else c.lineTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < n - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
        c.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * k / 3, p1[1] + (p2[1] - p0[1]) * k / 3,
            p2[0] - (p3[0] - p1[0]) * k / 3, p2[1] - (p3[1] - p1[1]) * k / 3, p2[0], p2[1]);
    }
}

/** The face oval as the current path (grow / growY scale it about the centre). */
export function outlinePath(c, grow = 1, growY = grow, dy = 0) {
    c.beginPath();
    smoothClosed(c, dy ? OUTLINE.map(([x, y]) => [x, y + dy / growY]) : OUTLINE, grow, growY);
}

/** True when (x, y) is inside the average face outline (ray casting). */
export function insideOutline(x, y, grow = 1) {
    let inside = false;
    const n = OUTLINE.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = OUTLINE[i][0] * grow, yi = OUTLINE[i][1] * grow, xj = OUTLINE[j][0] * grow, yj = OUTLINE[j][1] * grow;
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** A four-pointed sparkle centred at (x, y) with radius r (the path is added, not filled). */
export function sparkle(c, x, y, r, pinch = 0.18) {
    c.moveTo(x, y - r);
    c.quadraticCurveTo(x + r * pinch, y - r * pinch, x + r, y);
    c.quadraticCurveTo(x + r * pinch, y + r * pinch, x, y + r);
    c.quadraticCurveTo(x - r * pinch, y + r * pinch, x - r, y);
    c.quadraticCurveTo(x - r * pinch, y - r * pinch, x, y - r);
    c.closePath();
}

/** A five-pointed star path. */
export function starPath(c, x, y, R, r = R * 0.45, rot = -Math.PI / 2) {
    for (let i = 0; i < 10; i++) {
        const a = rot + i * Math.PI / 5, d = i % 2 ? r : R;
        if (i) c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); else c.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    c.closePath();
}

/** Lazily made offscreen canvas in canonical space: (ex, ey) are the half extents, ppu pixels per unit. */
export function makeSprite(ex, ey, ppu, paint) {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(ex * 2 * ppu);
    cv.height = Math.ceil(ey * 2 * ppu);
    const c = cv.getContext('2d');
    c.setTransform(ppu, 0, 0, ppu, ex * ppu, ey * ppu);
    paint(c);
    return cv;
}

/** Delaunay triangulation (Bowyer-Watson) of a small point set: returns triangles as index triples. Used once, to build mask facets. */
export function delaunay(pts) {
    const n = pts.length;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const d = Math.max(maxX - minX, maxY - minY) * 20, mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
    const P = [...pts, [mx - d, my - d], [mx, my + d], [mx + d, my - d]];
    let tris = [[n, n + 1, n + 2]];
    const circ = ([a, b, c]) => {
        const [ax, ay] = P[a], [bx, by] = P[b], [cx, cy] = P[c];
        const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
        const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
        return [ux, uy, (ax - ux) ** 2 + (ay - uy) ** 2];
    };
    let cache = [circ(tris[0])];
    for (let i = 0; i < n; i++) {
        const [px, py] = P[i];
        const bad = [], keep = [], keepC = [];
        tris.forEach((t, k) => { const c = cache[k]; ((px - c[0]) ** 2 + (py - c[1]) ** 2 < c[2]) ? bad.push(t) : (keep.push(t), keepC.push(c)); });
        const edges = new Map();
        for (const t of bad) for (let e = 0; e < 3; e++) {
            const a = t[e], b = t[(e + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a;
            edges.set(key, edges.has(key) ? null : [a, b]);
        }
        for (const e of edges.values()) if (e) { const t = [e[0], e[1], i]; keep.push(t); keepC.push(circ(t)); }
        tris = keep; cache = keepC;
    }
    return tris.filter(t => t[0] < n && t[1] < n && t[2] < n);
}
