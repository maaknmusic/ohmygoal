// =====================================================================
// Virtual backgrounds for the video effects.
//
// ORIGINAL ARTWORK: every scene below is drawn in code (Canvas 2D paths, gradients and procedural
// noise). There are no image files, no emoji or font glyphs and no third-party artwork or code in
// this file; the scenes are generic (no real landmarks, brands or recognisable characters).
//
// Each scene is built once into a cached canvas at the output size (rebuilt when the size changes);
// animated scenes also have a cheap per-frame overlay (twinkling, drifting, running rain ...).
// =====================================================================

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Small deterministic random generator, so every scene looks the same every time. */
function rng(seed) {
    let a = seed | 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
}
function context(c) {
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    return g;
}

// ---- colour helpers -------------------------------------------------
function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Vertical or diagonal gradient from [offset, '#hex' | [r,g,b], alpha?] stops. */
function gradient(g, x0, y0, x1, y1, stops) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    for (const [o, c, a = 1] of stops) gr.addColorStop(o, css(typeof c === 'string' ? rgb(c) : c, a));
    return gr;
}
function radial(g, x, y, r0, r1, stops, x1 = x, y1 = y) {
    const gr = g.createRadialGradient(x, y, r0, x1, y1, r1);
    for (const [o, c, a = 1] of stops) gr.addColorStop(o, css(typeof c === 'string' ? rgb(c) : c, a));
    return gr;
}
/** Soft light blob. */
function glow(g, x, y, r, color, a = 1, mode = 'lighter') {
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = mode;
    const c = typeof color === 'string' ? rgb(color) : color;
    g.fillStyle = radial(g, x, y, 0, r, [[0, c, a], [0.35, c, a * 0.45], [1, c, 0]]);
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.globalCompositeOperation = prev;
}

// ---- value noise (fractal) -----------------------------------------
function hash2(x, y, s) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct = 5, gain = 0.5) {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, y * f, s + i * 17); norm += amp; amp *= gain; f *= 2.03; }
    return sum / norm;
}
/** Paint colorFn(nx, ny) -> [r,g,b,a(0..1)] into a small canvas (cheap), to be drawn scaled up with smoothing. */
function paintField(w, h, colorFn) {
    const c = makeCanvas(w, h), g = context(c), img = g.createImageData(c.width, c.height), d = img.data;
    for (let y = 0, i = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++, i += 4) {
            const col = colorFn(x / c.width, y / c.height, x, y);
            d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = clamp(col[3], 0, 1) * 255;
        }
    }
    g.putImageData(img, 0, 0);
    return c;
}

let grainTile = null;
/** Fine film grain: hides banding in the big smooth gradients. */
function grain(g, w, h, amount = 0.05) {
    if (!grainTile) {
        grainTile = makeCanvas(128, 128);
        const tg = grainTile.getContext('2d'), img = tg.createImageData(128, 128), r = rng(7);
        for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
        tg.putImageData(img, 0, 0);
    }
    g.save();
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = amount;
    g.fillStyle = g.createPattern(grainTile, 'repeat');
    g.fillRect(0, 0, w, h);
    g.restore();
}
function vignette(g, w, h, strength = 0.35, color = [0, 0, 0]) {
    g.fillStyle = radial(g, w / 2, h / 2, Math.min(w, h) * 0.35, Math.hypot(w, h) * 0.62, [[0, color, 0], [1, color, strength]]);
    g.fillRect(0, 0, w, h);
}

/** A star: soft dot, optionally with a small four-point glint. */
function star(g, x, y, r, color, a, spikes = false) {
    g.fillStyle = css(color, a);
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    if (r > 1.1) glow(g, x, y, r * 5, color, a * 0.35);
    if (spikes) {
        g.strokeStyle = css(color, a * 0.5); g.lineWidth = Math.max(0.6, r * 0.35);
        const L = r * 9;
        g.beginPath(); g.moveTo(x - L, y); g.lineTo(x + L, y); g.moveTo(x, y - L); g.lineTo(x, y + L); g.stroke();
    }
}

// =====================================================================
// SCENES. Each build(w, h) returns { base: canvas, overlay?(g, t) }. Sizes are relative to w and h.
// =====================================================================

// ---- Studio: clean, soft-lit seamless backdrop -----------------------
function buildStudio(w, h) {
    const base = makeCanvas(w, h), g = context(base);
    g.fillStyle = radial(g, w * 0.5, h * 0.36, 0, Math.hypot(w, h) * 0.72, [[0, '#f1f2f5'], [0.45, '#d3d7de'], [1, '#8f98a8']]);
    g.fillRect(0, 0, w, h);
    // Soft key light from the upper left and a cooler fill from the right.
    glow(g, w * 0.18, h * 0.05, h * 0.9, [255, 244, 226], 0.42, 'source-over');
    glow(g, w * 0.92, h * 0.3, h * 0.8, [190, 210, 240], 0.22, 'source-over');
    // The seamless paper curves into the floor: a very soft horizon and a shadow near the bottom.
    g.fillStyle = gradient(g, 0, h * 0.62, 0, h, [[0, '#2a3140', 0], [0.35, '#2a3140', 0.1], [1, '#232a38', 0.42]]);
    g.fillRect(0, h * 0.62, w, h * 0.38);
    // Two faint, very wide light shafts.
    g.save();
    g.globalCompositeOperation = 'screen';
    for (const [x, a] of [[0.12, 0.1], [0.34, 0.06]]) {
        g.fillStyle = gradient(g, w * x, 0, w * (x + 0.28), h, [[0, '#ffffff', a], [1, '#ffffff', 0]]);
        g.beginPath(); g.moveTo(w * x, 0); g.lineTo(w * (x + 0.16), 0); g.lineTo(w * (x + 0.5), h); g.lineTo(w * (x + 0.2), h); g.closePath(); g.fill();
    }
    g.restore();
    vignette(g, w, h, 0.3, [20, 26, 40]);
    grain(g, w, h, 0.06);
    return { base };
}


// ---- Mumbai dusk: generic bay-city skyline, sky, sea shimmer, lit windows ---------------
function palm(g, x, y, hgt, lean, color, r) {
    const topX = x + lean * hgt, topY = y - hgt;
    const cx = x + lean * hgt * 0.15, cy = y - hgt * 0.55;
    const pt = t => [(1 - t) * (1 - t) * x + 2 * (1 - t) * t * cx + t * t * topX, (1 - t) * (1 - t) * y + 2 * (1 - t) * t * cy + t * t * topY];
    g.fillStyle = color; g.strokeStyle = color;
    g.beginPath();
    const left = [], right = [];
    for (let i = 0; i <= 14; i++) { const t = i / 14, [px, py] = pt(t), wd = lerp(hgt * 0.03, hgt * 0.014, t); left.push([px - wd, py]); right.push([px + wd, py]); }
    g.moveTo(...left[0]); for (const p of left) g.lineTo(...p); for (const p of right.reverse()) g.lineTo(...p); g.closePath(); g.fill();
    // Fronds: an arched rib with short leaflets on both sides, drawn as one path.
    const n = 12, L0 = hgt * 0.46;
    g.lineWidth = Math.max(1, hgt * 0.006);
    g.beginPath();
    for (let k = 0; k < n; k++) {
        const a = -Math.PI * 1.02 + (k / (n - 1)) * Math.PI * 2.04 + (r() - 0.5) * 0.15;
        const L = L0 * (0.75 + r() * 0.35);
        const c = [topX + Math.cos(a) * L * 0.5, topY + Math.sin(a) * L * 0.5 - L * 0.3];
        const e = [topX + Math.cos(a) * L, topY + Math.sin(a) * L + L * 0.28];
        const q = t => [(1 - t) * (1 - t) * topX + 2 * (1 - t) * t * c[0] + t * t * e[0], (1 - t) * (1 - t) * topY + 2 * (1 - t) * t * c[1] + t * t * e[1]];
        g.moveTo(topX, topY);
        for (let i = 1; i <= 20; i++) g.lineTo(...q(i / 20));
        for (let i = 2; i <= 20; i++) {
            const t = i / 20, [px, py] = q(t), [qx, qy] = q(Math.min(1, t + 0.02));
            const tx = qx - px, ty = qy - py, tl = Math.hypot(tx, ty) || 1;
            const len = L * 0.2 * Math.sin(Math.PI * (0.15 + t * 0.85)) ** 0.8;
            for (const s of [-1, 1]) { g.moveTo(px, py); g.lineTo(px + (-ty / tl * s) * len + tx / tl * len * 0.5, py + (tx / tl * s) * len + ty / tl * len * 0.5 + len * 0.45); }
        }
    }
    g.stroke();
}

function skyline(g, r, w, y0, o) {
    let x = -o.wMax * 0.6;
    while (x < w) {
        const bw = lerp(o.wMin, o.wMax, r());
        const env = 0.28 + 0.72 * fbm(x / w * 2.2 + 3.1, o.seed, 4);
        const bh = lerp(o.hMin, o.hMax, r()) * env;
        const top = y0 - bh, kind = r();
        g.fillStyle = o.fill;
        g.beginPath();
        if (kind < 0.2) { // slanted roof
            g.moveTo(x, y0 + 2); g.lineTo(x, top + bh * 0.05); g.lineTo(x + bw, top - bh * 0.04); g.lineTo(x + bw, y0 + 2);
        } else {
            g.rect(x, top, bw, bh + 2);
            if (kind < 0.45) g.rect(x + bw * 0.18, top - bh * 0.1, bw * 0.64, bh * 0.1 + 1);              // setback
            else if (kind < 0.62) { g.moveTo(x + bw * 0.42, top); g.lineTo(x + bw * 0.5, top - bw * 1.7); g.lineTo(x + bw * 0.58, top); } // spire
            else if (kind < 0.7) g.rect(x + bw * 0.45, top - bw * 0.7, bw * 0.1, bw * 0.7);                // antenna
        }
        g.fill();
        if (o.windows) {
            const ww = o.windows.size, wh = ww * 1.5, px = ww * 2.1, py = wh * 2.0, m = ww * 1.2;
            for (let wy = top + m + wh; wy < y0 - wh; wy += py) {
                for (let wx = x + m; wx < x + bw - m - ww * 0.5; wx += px) {
                    if (r() > o.windows.p) continue;
                    const col = pick(r, o.windows.colors), a = 0.5 + r() * 0.5;
                    g.fillStyle = css(col, a);
                    g.fillRect(wx, wy, ww, wh);
                    if (r() < 0.12) o.lights.push([wx + ww / 2, wy + wh / 2, col]);
                }
            }
        }
        x += bw + lerp(0, o.gap, r());
    }
}

function buildMumbai(w, h) {
    const base = makeCanvas(w, h), g = context(base), r = rng(11);
    const u = Math.min(w, h * 1.5), y0 = Math.round(h * 0.64);
    // Sky
    g.fillStyle = gradient(g, 0, 0, 0, y0, [[0, '#0f1238'], [0.26, '#2a2370'], [0.5, '#76388c'], [0.7, '#d84e7c'], [0.86, '#ff8c52'], [1, '#ffc47a']]);
    g.fillRect(0, 0, w, y0 + 2);
    for (let i = 0; i < 80; i++) { const y = r() * y0 * 0.5; star(g, r() * w, y, 0.35 + r() * 0.7, [255, 240, 226], (0.2 + r() * 0.6) * (1 - y / (y0 * 0.5))); }
    // Sun and haze
    const sx = w * 0.77, sy = y0 - h * 0.13;
    glow(g, sx, sy, h * 0.7, [255, 130, 85], 0.5, 'screen');
    glow(g, sx, sy, h * 0.26, [255, 214, 150], 0.85, 'screen');
    g.fillStyle = css([255, 244, 208], 0.96); g.beginPath(); g.arc(sx, sy, h * 0.05, 0, TAU); g.fill();
    // Underlit cloud streaks
    for (const [seed, y1, y2, a] of [[3, 0.1, 0.5, 0.5], [9, 0.34, 0.62, 0.62]]) {
        const cl = paintField(150, 36, (nx, ny) => {
            const f = fbm(nx * 2.6, ny * 9, seed, 5);
            const al = smooth(0.5, 0.74, f) * Math.sin(Math.PI * clamp(ny, 0, 1)) ** 0.6;
            return [...mixc([128, 86, 176], [255, 168, 118], ny ** 0.8), al];
        });
        g.globalAlpha = a;
        g.drawImage(cl, 0, y0 * y1, w, y0 * (y2 - y1));
        g.globalAlpha = 1;
    }
    // Sea
    g.fillStyle = gradient(g, 0, y0, 0, h, [[0, '#ffa56a'], [0.1, '#e4647a'], [0.35, '#6a2f7c'], [1, '#15153f']]);
    g.fillRect(0, y0, w, h - y0);
    glow(g, sx, y0, h * 0.5, [255, 190, 120], 0.35, 'screen');
    // Skylines: far (hazy), mid (dark, lit windows), near towers at the edges only
    const lights = [];
    const sea0 = [255, 150, 110];
    skyline(g, r, w, y0, { fill: gradient(g, 0, y0 - h * 0.3, 0, y0, [[0, '#6a3b82'], [1, '#c05a7e']]), hMin: h * 0.07, hMax: h * 0.26, wMin: u * 0.02, wMax: u * 0.055, gap: u * 0.01, seed: 21 });
    g.fillStyle = css(sea0, 0.25); g.fillRect(0, y0 - h * 0.03, w, h * 0.03); // haze at the base of the far layer
    skyline(g, r, w, y0, { fill: gradient(g, 0, y0 - h * 0.3, 0, y0, [[0, '#2b1a4e'], [1, '#43224f']]), hMin: h * 0.05, hMax: h * 0.2, wMin: u * 0.022, wMax: u * 0.06, gap: u * 0.008, seed: 5,
        windows: { size: Math.max(1.7, u * 0.0046), p: 0.42, colors: [[255, 214, 128], [255, 232, 170], [255, 196, 110], [190, 226, 255]] }, lights });
    // Shore strip with a row of street lights
    g.fillStyle = '#1a0f33'; g.fillRect(0, y0, w, h * 0.012);
    for (let x = r() * u * 0.01; x < w; x += u * (0.008 + r() * 0.01)) { lights.push([x, y0 + h * 0.004, [255, 214, 140]]); glow(g, x, y0 + h * 0.004, u * 0.012, [255, 210, 140], 0.55); }
    // Reflections of the lights in the water
    g.save();
    for (const [lx, ly, col] of lights) {
        const n = 3 + ((r() * 4) | 0), depth = h * (0.08 + r() * 0.12);
        for (let k = 0; k < n; k++) {
            const t = (k + r() * 0.8) / n;
            g.fillStyle = css(col, (1 - t) * 0.3);
            g.fillRect(lx + (r() - 0.5) * u * 0.005 * (1 + t * 2), y0 + h * 0.012 + t * depth + r() * h * 0.006, Math.max(1.5, u * 0.003) * (1 + t * 1.5), 1 + r() * 2);
        }
    }
    g.restore();
    // Long faint swell lines give the water some texture
    g.save(); g.globalCompositeOperation = 'screen';
    for (let i = 0; i < 70; i++) {
        const t = Math.pow(r(), 1.3), y = y0 + h * 0.03 + t * (h - y0), len = lerp(u * 0.06, u * 0.3, t) * (0.4 + r());
        g.fillStyle = css([255, 170, 200], 0.04 + 0.06 * (1 - t));
        g.fillRect(r() * w - len / 2, y, len, Math.max(1, lerp(1, 2.5, t)));
    }
    g.restore();
    // Static glints in the sun's path (the overlay twinkles brighter ones on top)
    const glints = [];
    for (let i = 0; i < 110; i++) {
        const t = Math.pow(r(), 1.4), y = y0 + h * 0.012 + t * (h - y0 - h * 0.02);
        const spread = lerp(u * 0.025, u * 0.2, t), x = sx + (r() + r() + r() - 1.5) * spread * 1.6;
        glints.push({ x, y, len: lerp(u * 0.012, u * 0.05, t) * (0.5 + r()), th: lerp(1, 2.6, t), ph: r() * TAU, sp: 0.8 + r() * 1.6, a: (1 - t * 0.55) * (0.35 + r() * 0.4) });
        g.fillStyle = css([255, 222, 160], glints[i].a * 0.28);
        g.fillRect(x, y, glints[i].len, glints[i].th);
    }
    // Two small sailing boats
    for (const [bx, by, s] of [[0.2, 0.012, 1], [0.55, 0.02, 0.8]]) {
        const x = w * bx, y = y0 + h * by, k = u * 0.03 * s;
        g.fillStyle = '#1b1038';
        g.beginPath(); g.moveTo(x - k, y); g.lineTo(x + k * 1.1, y); g.lineTo(x + k * 0.7, y + k * 0.35); g.lineTo(x - k * 0.7, y + k * 0.35); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(x, y - k * 0.1); g.lineTo(x, y - k * 2); g.lineTo(x + k * 0.9, y - k * 0.15); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(x - k * 0.1, y - k * 0.1); g.lineTo(x - k * 0.1, y - k * 1.5); g.lineTo(x - k * 0.75, y - k * 0.15); g.closePath(); g.fill();
    }
    // Palms in the corners (foreground silhouettes)
    const palmH = Math.min(h * 0.6, u * 0.46);
    palm(g, w * 0.03, h * 1.01, palmH, 0.13, '#0d0722', r);
    palm(g, w * 0.97, h * 1.01, palmH * 0.85, -0.12, '#0d0722', r);
    vignette(g, w, h, 0.32, [10, 4, 30]);
    grain(g, w, h, 0.05);
    return {
        base,
        overlay(c, t) {
            c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgb(255,226,170)';
            for (const q of glints) { c.globalAlpha = q.a * (0.15 + 0.85 * Math.max(0, Math.sin(t * q.sp + q.ph))) * 0.9; c.fillRect(q.x, q.y, q.len, q.th); }
            c.restore();
        },
    };
}


// ---- Aurora: ribbons of light over stars, mountains and a still lake ----------------------
function buildCurtain(CW, CH, seed, c0, c1, c2) {
    const cv = makeCanvas(CW, CH), g = context(cv);
    const spr = makeCanvas(1, 160), sg = spr.getContext('2d');
    sg.fillStyle = gradient(sg, 0, 0, 0, 160, [[0, c2, 0], [0.38, c2, 0.1], [0.7, c1, 0.5], [0.9, c0, 1], [1, c0, 0]]);
    sg.fillRect(0, 0, 1, 160);
    g.globalCompositeOperation = 'lighter';
    const step = 3;
    const fold = nx => CH * 0.76 + Math.sin(nx * TAU * 1.7 + seed) * CH * 0.12 + Math.sin(nx * TAU * 4.3 + seed * 2) * CH * 0.045 + Math.sin(nx * TAU * 9.1 + seed * 3) * CH * 0.01;
    for (let x = 0; x < CW; x += step) {
        const nx = x / CW, yb = fold(nx);
        const slope = Math.abs(fold(nx + 0.004) - fold(nx - 0.004)) / (CW * 0.008);   // folds seen edge-on are brighter
        const ray = 0.5 + 0.5 * fbm(nx * 30, seed, 3);
        const env = 0.15 + 0.85 * smooth(0.25, 0.7, fbm(nx * 2.4 + seed, 1.7, 3));
        const hgt = CH * (0.28 + 0.62 * fbm(nx * 5 + seed, 3.3, 3)) * (0.6 + 0.4 * ray) * (0.8 + 0.5 * clamp(slope, 0, 1));
        g.globalAlpha = clamp(ray * env * (0.55 + 0.9 * clamp(slope * 1.3, 0, 1)), 0, 1);
        g.drawImage(spr, 0, 0, 1, 160, x - 1, yb - hgt, step + 2, hgt);
    }
    return cv;
}

function ridge(g, w, baseY, amp, seed, fill, rough = 5) {
    g.fillStyle = fill; g.beginPath(); g.moveTo(0, g.canvas.height);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, baseY - amp * (fbm(x / w * 2.6, seed, rough) * 1.3 - 0.35));
    g.lineTo(w, g.canvas.height); g.closePath(); g.fill();
}

function buildAurora(w, h) {
    const base = makeCanvas(w, h), g = context(base), r = rng(17);
    const u = Math.min(w, h * 1.5), lakeY = Math.round(h * 0.8);
    g.fillStyle = gradient(g, 0, 0, 0, lakeY, [[0, '#01030a'], [0.5, '#041229'], [0.85, '#0a2c3f'], [1, '#13484c']]);
    g.fillRect(0, 0, w, lakeY);
    // faint Milky Way band
    const mw = paintField(120, 68, (nx, ny) => { const d = Math.abs((ny - 0.2) - (nx - 0.5) * 0.55); const f = fbm(nx * 6, ny * 6, 9, 5); return [190, 205, 255, smooth(0.28, 0, d) * smooth(0.35, 0.8, f) * 0.28]; });
    g.drawImage(mw, 0, 0, w, h * 0.8);
    for (let i = 0; i < 360; i++) {
        const y = r() * lakeY * 0.95, big = r() < 0.06;
        star(g, r() * w, y, (big ? 1.2 + r() * 1.2 : 0.35 + r() * 0.65) * (u / 960 * 0.9 + 0.35), pick(r, [[255, 255, 255], [200, 220, 255], [255, 240, 210]]), 0.3 + r() * 0.7, big && r() < 0.4);
    }
    // Distant ridges
    ridge(g, w, lakeY - h * 0.06, h * 0.22, 4, gradient(g, 0, lakeY - h * 0.3, 0, lakeY, [[0, '#0e2f3c'], [1, '#0a1f2c']]));
    ridge(g, w, lakeY - h * 0.01, h * 0.17, 8, gradient(g, 0, lakeY - h * 0.25, 0, lakeY, [[0, '#071824'], [1, '#05121b']]));
    // Pines on the near ridge (simple dark spikes)
    g.fillStyle = '#030a10';
    for (let i = 0; i < 70; i++) {
        const x = r() * w, hh = h * (0.03 + r() * 0.06), ww = hh * 0.34, y = lakeY + 1;
        if (x > w * 0.28 && x < w * 0.72 && r() < 0.8) continue;
        g.beginPath(); g.moveTo(x - ww, y); g.lineTo(x, y - hh); g.lineTo(x + ww, y); g.closePath(); g.fill();
    }
    // Lake: a mirror of the sky above it, darker and a bit rippled
    const mirror = makeCanvas(w, h - lakeY), mg = context(mirror);
    mg.translate(0, mirror.height); mg.scale(1, -1);
    mg.drawImage(base, 0, lakeY - mirror.height, w, mirror.height, 0, 0, w, mirror.height);
    g.fillStyle = '#020a12'; g.fillRect(0, lakeY, w, h - lakeY);
    g.globalAlpha = 0.5; g.drawImage(mirror, 0, lakeY); g.globalAlpha = 1;
    for (let i = 0; i < 40; i++) { g.fillStyle = css([140, 255, 220], 0.025 + r() * 0.03); g.fillRect(r() * w, lakeY + r() * (h - lakeY), u * (0.05 + r() * 0.2), 1); }
    g.fillStyle = gradient(g, 0, lakeY - 2, 0, lakeY + 6, [[0, '#000', 0.5], [1, '#000', 0]]); g.fillRect(0, lakeY - 2, w, 8);
    vignette(g, w, h, 0.4, [0, 2, 8]);
    grain(g, w, h, 0.05);

    const CW = Math.round(w * 1.4), CH = Math.round(h * 0.66);
    const layers = [
        { cv: buildCurtain(CW, CH, 1.3, [120, 255, 170], [60, 220, 200], [150, 100, 255]), sp: 1, ph: 0.4, a: 0.95, dy: 0 },
        { cv: buildCurtain(CW, CH, 4.1, [90, 255, 200], [50, 190, 255], [190, 90, 255]), sp: 0.7, ph: 2.1, a: 0.7, dy: -0.03 },
        { cv: buildCurtain(CW, CH, 7.7, [200, 120, 255], [110, 130, 255], [255, 90, 190]), sp: 1.3, ph: 4.2, a: 0.42, dy: 0.02 },
    ];
    const S = 22, top = lakeY - CH * 0.98;
    return {
        base,
        overlay(c, t) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            const sw = CW / 1.4 * 1.0 / S;
            for (const L of layers) {
                const xoff = (CW - w) * (0.5 + 0.5 * Math.sin(t * 0.06 * L.sp + L.ph));
                const breathe = L.a * (0.72 + 0.28 * Math.sin(t * 0.35 * L.sp + L.ph * 2));
                for (let pass = 0; pass < 2; pass++) {
                    c.globalAlpha = pass ? breathe * 0.28 : breathe;
                    for (let i = 0; i < S; i++) {
                        const wob = Math.sin(i * 0.5 + t * 0.55 * L.sp + L.ph) * h * 0.014, sc = 1 + 0.05 * Math.sin(i * 0.33 - t * 0.4 + L.ph);
                        const y = top + L.dy * h + wob;
                        if (!pass) c.drawImage(L.cv, xoff + i * sw, 0, sw, CH, i * sw, y + CH * (1 - sc), sw + 1, CH * sc);
                        else c.drawImage(L.cv, xoff + i * sw, 0, sw, CH, i * sw, lakeY + (lakeY - (y + CH)) , sw + 1, CH * sc * 0.55);
                    }
                }
            }
            c.restore();
        },
    };
}

// ---- Bokeh: soft out-of-focus lights drifting slowly ------------------------------
function bokehSprite(color, soft) {
    const cv = makeCanvas(96, 96), g = cv.getContext('2d');
    g.fillStyle = radial(g, 48, 48, 0, 48, [[0, color, 0.3], [0.72, color, 0.38 - soft * 0.12], [0.9, color, 0.52 - soft * 0.38], [1, color, 0]]);
    g.fillRect(0, 0, 96, 96);
    return cv;
}
const BOKEH_COLORS = [[255, 233, 196], [255, 179, 71], [255, 190, 100], [255, 111, 145], [255, 150, 120], [88, 224, 208], [167, 139, 250]];

function buildBokeh(w, h) {
    const base = makeCanvas(w, h), g = context(base), r = rng(23);
    const u = Math.min(w, h * 1.4);
    g.fillStyle = gradient(g, 0, 0, w, h, [[0, '#0a1c3a'], [0.55, '#1b1f52'], [1, '#3a1450']]);
    g.fillRect(0, 0, w, h);
    glow(g, w * 0.15, h * 0.2, h * 0.7, [60, 140, 220], 0.35, 'screen');
    glow(g, w * 0.85, h * 0.8, h * 0.8, [220, 70, 140], 0.33, 'screen');
    glow(g, w * 0.7, h * 0.15, h * 0.5, [255, 170, 80], 0.2, 'screen');
    vignette(g, w, h, 0.3, [4, 2, 20]);
    const sprites = BOKEH_COLORS.map(c => [bokehSprite(c, 0), bokehSprite(c, 1)]);
    const discs = [];
    for (let i = 0; i < 58; i++) {
        const depth = r(); // 0 far .. 1 near
        discs.push({ x: r() * (w + 200) - 100, y: r() * (h + 200) - 100, rad: u * lerp(0.02, 0.1, depth ** 1.3) * (0.7 + r() * 0.6), vx: (r() - 0.35) * u * 0.006 * (0.4 + depth), vy: -u * (0.002 + r() * 0.006) * (0.4 + depth),
            a: lerp(0.35, 0.8, r()) * (1 - depth * 0.25), sp: 0.3 + r() * 0.8, ph: r() * TAU, s: sprites[(r() * sprites.length) | 0][depth > 0.6 ? 1 : 0] });
    }
    grain(g, w, h, 0.045);
    return {
        base,
        overlay(c, t) {
            c.save(); c.globalCompositeOperation = 'lighter';
            const mw = w + 200, mh = h + 200;
            for (const d of discs) {
                const x = (((d.x + d.vx * t * 10) % mw) + mw) % mw - 100, y = (((d.y + d.vy * t * 10) % mh) + mh) % mh - 100;
                c.globalAlpha = d.a * (0.78 + 0.22 * Math.sin(t * d.sp + d.ph));
                c.drawImage(d.s, x - d.rad, y - d.rad, d.rad * 2, d.rad * 2);
            }
            c.restore();
        },
    };
}

// ---- Cozy room: warm lamp, shelf with books, plants ---------------------------------
function leaf(g, x, y, len, wid, ang, fill) {
    g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = fill;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.5, -wid, len, 0); g.quadraticCurveTo(len * 0.5, wid, 0, 0); g.fill(); g.restore();
}
function frame(g, x, y, fw, fh, art, u) {
    const b = u * 0.012;
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x + b * 0.8, y + b * 1.2, fw + b * 2, fh + b * 2);
    g.fillStyle = '#4a3020'; g.fillRect(x - b, y - b, fw + b * 2, fh + b * 2);
    g.fillStyle = '#f1e8d6'; g.fillRect(x, y, fw, fh);
    const m = Math.min(fw, fh) * 0.1;
    g.save(); g.beginPath(); g.rect(x + m, y + m, fw - m * 2, fh - m * 2); g.clip();
    art(g, x + m, y + m, fw - m * 2, fh - m * 2);
    g.restore();
}

function buildCozy(w, h) {
    const base = makeCanvas(w, h), g = context(base), r = rng(41);
    const u = Math.min(h, w * 0.75), floorY = Math.round(h * 0.8);
    // Wall and floor
    g.fillStyle = gradient(g, 0, 0, 0, floorY, [[0, '#4c7070'], [1, '#365658']]); g.fillRect(0, 0, w, floorY);
    const wood = gradient(g, 0, floorY, 0, h, [[0, '#8d6039'], [1, '#4a301f']]);
    g.fillStyle = wood; g.fillRect(0, floorY, w, h - floorY);
    g.strokeStyle = 'rgba(30,16,8,0.35)'; g.lineWidth = 1;
    for (let i = 1; i <= 5; i++) { const y = floorY + (h - floorY) * (i / 6) ** 1.25; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let row = 0; row < 6; row++) { const y0 = floorY + (h - floorY) * (row / 6) ** 1.25, y1 = floorY + (h - floorY) * ((row + 1) / 6) ** 1.25; for (let x = (row % 2) * u * 0.1 + r() * u * 0.1; x < w; x += u * (0.2 + r() * 0.2)) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); } }
    g.fillStyle = '#eee4d2'; g.fillRect(0, floorY - u * 0.03, w, u * 0.03);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, floorY, w, u * 0.012);
    // A subtle wall panel line
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, floorY - u * 0.27, w, u * 0.006);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, floorY - u * 0.27 + u * 0.006, w, u * 0.5 * 0.01);

    // Framed pictures (abstract, made of simple shapes)
    frame(g, w * 0.06, h * 0.14, u * 0.4, u * 0.28, (c, x, y, fw, fh) => {
        c.fillStyle = gradient(c, 0, y, 0, y + fh, [[0, '#f6c79a'], [1, '#f08a7a']]); c.fillRect(x, y, fw, fh);
        c.fillStyle = '#fff1c9'; c.beginPath(); c.arc(x + fw * 0.68, y + fh * 0.42, fh * 0.17, 0, TAU); c.fill();
        c.fillStyle = '#7a8f6a'; c.beginPath(); c.moveTo(x, y + fh); c.quadraticCurveTo(x + fw * 0.3, y + fh * 0.45, x + fw * 0.62, y + fh); c.fill();
        c.fillStyle = '#365e55'; c.beginPath(); c.moveTo(x + fw * 0.35, y + fh); c.quadraticCurveTo(x + fw * 0.75, y + fh * 0.5, x + fw * 1.1, y + fh); c.fill();
    }, u);
    frame(g, w * 0.06 + u * 0.46, h * 0.2, u * 0.17, u * 0.22, (c, x, y, fw, fh) => {
        c.fillStyle = '#e9dcc2'; c.fillRect(x, y, fw, fh);
        c.fillStyle = '#c4573b'; c.beginPath(); c.arc(x + fw * 0.5, y + fh * 0.62, fw * 0.32, Math.PI, 0); c.lineTo(x + fw * 0.82, y + fh); c.lineTo(x + fw * 0.18, y + fh); c.fill();
        c.fillStyle = '#2f5d57'; c.beginPath(); c.arc(x + fw * 0.5, y + fh * 0.25, fw * 0.14, 0, TAU); c.fill();
    }, u);

    // Shelf with books, a plant and a vase (right)
    const sx0 = w * 0.6, sw = w * 0.26, sy = h * 0.38;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(sx0, sy + u * 0.02, sw, u * 0.05);
    g.fillStyle = '#b38559'; g.fillRect(sx0, sy, sw, u * 0.022);
    g.fillStyle = '#d7aa7a'; g.fillRect(sx0, sy, sw, u * 0.006);
    let bx = sx0 + sw * 0.28;
    const bookCols = ['#c4553b', '#e0a458', '#3d6b8e', '#6b8f71', '#efe1c3', '#8a4f7d', '#2f4858', '#d97b53'];
    for (let i = 0; i < 12 && bx < sx0 + sw * 0.8; i++) {
        const bw = u * (0.022 + r() * 0.02), bh = u * (0.09 + r() * 0.08), col = pick(r, bookCols);
        g.save(); g.translate(bx, sy);
        if (i === 7) g.rotate(-0.2), g.translate(-bw * 0.4, 0);
        g.fillStyle = col; g.fillRect(0, -bh, bw, bh);
        g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(bw * 0.15, -bh * 0.82, bw * 0.7, Math.max(1, u * 0.004));
        g.fillRect(bw * 0.15, -bh * 0.2, bw * 0.7, Math.max(1, u * 0.004));
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(bw * 0.86, -bh, bw * 0.14, bh);
        g.restore();
        bx += bw + (i === 6 ? u * 0.05 : u * 0.002);
    }
    // vase with dry grass on the shelf's right
    const vx = sx0 + sw * 0.9, vh = u * 0.09;
    g.strokeStyle = '#d9c79c'; g.lineWidth = Math.max(1, u * 0.004);
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(vx, sy - vh * 0.6); g.quadraticCurveTo(vx + (i - 2.5) * u * 0.02, sy - vh * 1.4, vx + (i - 2.5) * u * 0.035, sy - vh * (2 + r() * 0.6)); g.stroke(); }
    g.fillStyle = '#d98a5b'; g.beginPath(); g.moveTo(vx - u * 0.025, sy - vh); g.quadraticCurveTo(vx - u * 0.05, sy - vh * 0.4, vx - u * 0.03, sy); g.lineTo(vx + u * 0.03, sy); g.quadraticCurveTo(vx + u * 0.05, sy - vh * 0.4, vx + u * 0.025, sy - vh); g.closePath(); g.fill();
    // trailing pothos on the shelf's left
    const px = sx0 + sw * 0.1;
    g.fillStyle = '#e9e1d2'; g.beginPath(); g.moveTo(px - u * 0.04, sy - u * 0.06); g.lineTo(px + u * 0.04, sy - u * 0.06); g.lineTo(px + u * 0.028, sy); g.lineTo(px - u * 0.028, sy); g.closePath(); g.fill();
    for (let i = 0; i < 6; i++) {
        let x = px + (i - 2.5) * u * 0.012, y = sy - u * 0.05, dx = (i - 2.5) * 0.4, len = u * (0.1 + r() * 0.22);
        g.strokeStyle = '#2d5a3a'; g.lineWidth = Math.max(1, u * 0.003); g.beginPath(); g.moveTo(x, y);
        const pts = [];
        for (let k = 1; k <= 10; k++) { x += dx * u * 0.004 + Math.sin(k * 0.9 + i) * u * 0.003; y += len / 10; pts.push([x, y]); g.lineTo(x, y); }
        g.stroke();
        for (const [lx, ly] of pts) leaf(g, lx, ly, u * 0.03, u * 0.014, r() * TAU, r() < 0.5 ? '#3f7d4c' : '#58a05d');
    }
    for (let i = 0; i < 9; i++) leaf(g, px + (r() - 0.5) * u * 0.05, sy - u * 0.06, u * 0.045, u * 0.02, -Math.PI / 2 + (r() - 0.5) * 2.4, i % 2 ? '#3f7d4c' : '#58a05d');

    // Floor lamp on the right, with a warm light cone
    const lx = w * 0.93, lamp = [255, 200, 120];
    glow(g, lx, h * 0.4, h * 1.05, lamp, 0.32, 'screen');
    g.fillStyle = '#2b1d16'; g.fillRect(lx - u * 0.004, h * 0.46, u * 0.008, floorY - h * 0.46 + u * 0.03);
    g.beginPath(); g.ellipse(lx, floorY + u * 0.035, u * 0.07, u * 0.016, 0, 0, TAU); g.fill();
    const sh = u * 0.15, sw2 = u * 0.1;
    g.save(); g.globalCompositeOperation = 'screen';
    g.fillStyle = gradient(g, 0, h * 0.2, 0, h * 0.48, [[0, 'rgb(255,200,120)', 0], [1, 'rgb(255,200,120)', 0.22]]);
    g.beginPath(); g.moveTo(lx - sw2 * 0.6, h * 0.46 - sh); g.lineTo(lx - sw2 * 1.8, h * 0.15); g.lineTo(lx + sw2 * 1.8, h * 0.15); g.lineTo(lx + sw2 * 0.6, h * 0.46 - sh); g.fill();
    g.restore();
    g.fillStyle = gradient(g, lx - sw2, 0, lx + sw2, 0, [[0, '#f2cf9a'], [0.5, '#ffe9bf'], [1, '#f0c58c']]);
    g.beginPath(); g.moveTo(lx - sw2 * 0.6, h * 0.46 - sh); g.lineTo(lx + sw2 * 0.6, h * 0.46 - sh); g.lineTo(lx + sw2, h * 0.46); g.lineTo(lx - sw2, h * 0.46); g.closePath(); g.fill();
    glow(g, lx, h * 0.46 - sh * 0.5, u * 0.14, lamp, 0.5, 'screen');

    // Snake plant in a terracotta pot (left)
    const px2 = w * 0.1, potW = u * 0.13, potH = u * 0.14, potY = floorY + u * 0.04;
    for (let i = 0; i < 9; i++) {
        const t = i / 8, ang = (t - 0.5) * 0.7 + (r() - 0.5) * 0.12, hh = u * (0.3 + 0.3 * Math.sin(t * Math.PI)) * (0.8 + r() * 0.3), ww = u * (0.026 + r() * 0.012);
        g.save(); g.translate(px2 + (t - 0.5) * potW * 0.5, potY - potH); g.rotate(ang);
        g.fillStyle = '#b9c45f'; g.beginPath(); g.moveTo(-ww, 0); g.quadraticCurveTo(-ww * 1.15, -hh * 0.5, 0, -hh); g.quadraticCurveTo(ww * 1.15, -hh * 0.5, ww, 0); g.closePath(); g.fill();
        g.fillStyle = gradient(g, -ww, 0, ww, 0, [[0, '#244d33'], [0.5, '#3b7a49'], [1, '#2a5a38']]);
        g.beginPath(); g.moveTo(-ww * 0.75, 0); g.quadraticCurveTo(-ww * 0.88, -hh * 0.5, 0, -hh * 0.96); g.quadraticCurveTo(ww * 0.88, -hh * 0.5, ww * 0.75, 0); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(160,210,140,0.35)'; g.lineWidth = Math.max(1, u * 0.003);
        for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(-ww * 0.6, -hh * k * 0.18); g.quadraticCurveTo(0, -hh * (k * 0.18 + 0.04), ww * 0.6, -hh * k * 0.18); g.stroke(); }
        g.restore();
    }
    g.fillStyle = gradient(g, px2 - potW / 2, 0, px2 + potW / 2, 0, [[0, '#a24b2c'], [0.4, '#d36e45'], [1, '#8f3f25']]);
    g.beginPath(); g.moveTo(px2 - potW * 0.5, potY - potH); g.lineTo(px2 + potW * 0.5, potY - potH); g.lineTo(px2 + potW * 0.38, potY); g.lineTo(px2 - potW * 0.38, potY); g.closePath(); g.fill();
    g.fillStyle = '#c3603b'; g.fillRect(px2 - potW * 0.56, potY - potH - u * 0.016, potW * 1.12, u * 0.03);

    // Fairy lights along the top
    const bulbs = [];
    g.strokeStyle = 'rgba(20,12,8,0.7)'; g.lineWidth = Math.max(1, u * 0.002); g.beginPath();
    for (let i = 0; i <= 60; i++) { const t = i / 60, x = t * w, y = h * 0.035 + Math.sin(t * Math.PI * 3) * h * 0.02 + (1 - (2 * ((t * 3) % 1) - 1) ** 2) * h * 0.03; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    for (let i = 1; i < 30; i++) {
        const t = i / 30, x = t * w, y = h * 0.035 + Math.sin(t * Math.PI * 3) * h * 0.02 + (1 - (2 * ((t * 3) % 1) - 1) ** 2) * h * 0.03;
        bulbs.push({ x, y: y + u * 0.012, ph: r() * TAU, sp: 0.8 + r() * 1.6 });
    }
    for (const b of bulbs) { glow(g, b.x, b.y, u * 0.03, [255, 214, 140], 0.55, 'screen'); g.fillStyle = '#fff2cf'; g.beginPath(); g.arc(b.x, b.y, u * 0.0055, 0, TAU); g.fill(); }
    vignette(g, w, h, 0.34, [18, 8, 4]);
    grain(g, w, h, 0.05);
    const gl = makeCanvas(64, 64), gg = gl.getContext('2d'); gg.fillStyle = radial(gg, 32, 32, 0, 32, [[0, [255, 226, 160], 1], [0.2, [255, 214, 140], 0.6], [1, [255, 200, 120], 0]]); gg.fillRect(0, 0, 64, 64);
    return {
        base,
        overlay(c, t) {
            c.save(); c.globalCompositeOperation = 'lighter';
            for (const b of bulbs) { c.globalAlpha = 0.18 + 0.4 * (0.5 + 0.5 * Math.sin(t * b.sp + b.ph)); c.drawImage(gl, b.x - u * 0.035, b.y - u * 0.035, u * 0.07, u * 0.07); }
            c.restore();
        },
    };
}

// ---- Monsoon window: blurred city lights seen through rain-streaked glass -----------------
function lightDisc(g, spr, x, y, rad, a) { g.globalAlpha = a; g.drawImage(spr, x - rad, y - rad, rad * 2, rad * 2); }
/** A water droplet on the glass: a small upside-down, magnified view of what is behind it. */
function drop(g, src, w, h, x, y, rx, ry, k = 1.7) {
    g.save();
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.clip();
    g.translate(x, y); g.scale(-1, -1);
    const sw = rx * 2 * k, sh = ry * 2 * k;
    const sx = clamp(x - sw / 2, 0, w - sw), sy = clamp(y - sh / 2, 0, h - sh);
    g.drawImage(src, sx, sy, sw, sh, -rx, -ry, rx * 2, ry * 2);
    g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.45;   // the droplet gathers light: brighter than the misted glass around it
    g.drawImage(src, sx, sy, sw, sh, -rx, -ry, rx * 2, ry * 2);
    g.restore();
    // darker rim towards the bottom, bright rim towards the top, small specular
    g.save();
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.clip();
    g.fillStyle = gradient(g, 0, y - ry, 0, y + ry, [[0, [255, 255, 255], 0.2], [0.45, [255, 255, 255], 0], [1, [0, 8, 28], 0.3]]);
    g.fillRect(x - rx, y - ry, rx * 2, ry * 2);
    g.restore();
    g.strokeStyle = 'rgba(210,230,255,0.28)'; g.lineWidth = 1;
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.ellipse(x - rx * 0.35, y - ry * 0.42, Math.max(0.8, rx * 0.22), Math.max(0.8, ry * 0.16), -0.5, 0, TAU); g.fill();
}

function buildMonsoon(w, h) {
    const r = rng(31), u = Math.min(w, h * 1.4);
    const clear = makeCanvas(w, h), g = context(clear);
    g.fillStyle = gradient(g, 0, 0, 0, h, [[0, '#060b22'], [0.55, '#0f1b42'], [1, '#1a2b5c']]);
    g.fillRect(0, 0, w, h);
    glow(g, w * 0.28, h * 0.78, h * 0.7, [255, 150, 70], 0.26, 'screen');
    glow(g, w * 0.78, h * 0.72, h * 0.6, [70, 130, 255], 0.24, 'screen');
    const palette = [[255, 190, 90], [255, 190, 90], [255, 170, 70], [255, 236, 210], [255, 236, 210], [255, 80, 70], [90, 230, 190], [110, 160, 255], [110, 160, 255]];
    const sprites = new Map();
    const spr = c => { const k = c.join(); if (!sprites.has(k)) sprites.set(k, bokehSprite(c, 1)); return sprites.get(k); };
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 130; i++) {
        const t = r(), y = h * (0.28 + 0.78 * Math.pow(t, 0.85)), rad = u * lerp(0.012, 0.07, Math.pow(r(), 1.6));
        lightDisc(g, spr(pick(r, palette)), r() * w, y, rad, 0.3 + r() * 0.6);
    }
    // vertical reflections of lights on a wet road
    for (let i = 0; i < 46; i++) {
        const x = r() * w, y = h * (0.68 + r() * 0.2), len = h * (0.08 + r() * 0.16), wd = u * (0.008 + r() * 0.012);
        g.globalAlpha = 0.16 + r() * 0.16; g.drawImage(spr(pick(r, palette)), x - wd, y, wd * 2, len);
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    // Misted glass
    const fogged = makeCanvas(w, h), fg = context(fogged);
    fg.drawImage(clear, 0, 0);
    const fog = paintField(160, 90, (nx, ny) => { const f = fbm(nx * 4, ny * 4, 5, 5); return [168, 188, 220, smooth(0.35, 0.8, f) * 0.26 + 0.06]; });
    fg.drawImage(fog, 0, 0, w, h);
    // Drops that have already run: a clear trail above each one
    const total = Math.round(70 * (u / 540) ** 0.5 + 30);
    for (let i = 0; i < total; i++) {
        const x = r() * w, y = r() * h, rad = u * lerp(0.004, 0.014, r() ** 1.6), long = r() < 0.22;
        if (long) {
            const len = u * (0.04 + r() * 0.14);
            for (const [k, a] of [[1, 0.3], [0.7, 0.3], [0.4, 0.3]]) {   // a soft-edged strip of clear glass
                fg.save(); fg.globalAlpha = a;
                fg.beginPath(); fg.rect(x - rad * 0.45 * k, y - len, rad * 0.9 * k, len); fg.clip();
                fg.drawImage(clear, 0, 0); fg.restore();
            }
        }
        drop(fg, clear, w, h, x, y, rad, rad * 1.25);
    }
    // Soft reflections on the glass and a dark window frame at both edges
    fg.save(); fg.globalCompositeOperation = 'screen';
    fg.fillStyle = gradient(fg, 0, 0, w, h, [[0, '#fff', 0], [0.3, '#fff', 0.05], [0.4, '#fff', 0], [1, '#fff', 0]]); fg.fillRect(0, 0, w, h);
    fg.restore();
    vignette(fg, w, h, 0.5, [2, 4, 14]);
    grain(fg, w, h, 0.05);
    for (const x of [0, w - u * 0.035]) { fg.fillStyle = gradient(fg, x, 0, x + u * 0.035, 0, x ? [[0, '#05080f', 0], [0.4, '#05080f', 1], [1, '#0b1220']] : [[0, '#0b1220'], [0.6, '#05080f', 1], [1, '#05080f', 0]]); fg.fillRect(x, 0, u * 0.035, h); }
    // Running drops (animated overlay)
    const runners = [];
    for (let i = 0; i < 12; i++) runners.push({ x: (i + r()) / 12 * w, rad: u * lerp(0.006, 0.012, r()), per: 10 + r() * 14, ph: r() * 30, wob: r() * TAU, trail: u * (0.15 + r() * 0.25) });
    return {
        base: fogged,
        overlay(c, t) {
            for (const d of runners) {
                const f = ((t + d.ph) / d.per) % 1, yy = -h * 0.08 + (f + 0.04 * Math.sin(f * TAU * 3)) * h * 1.18, x = d.x + Math.sin(f * 9 + d.wob) * u * 0.004;
                if (yy < -d.rad * 2) continue;
                const y0 = Math.max(0, yy - d.trail), tw = d.rad * 0.9;
                if (yy > y0) { c.globalAlpha = 0.5; for (const k of [1, 0.65, 0.35]) c.drawImage(clear, x - tw * k / 2, y0, tw * k, yy - y0, x - tw * k / 2, y0, tw * k, yy - y0); c.globalAlpha = 1; }
                drop(c, clear, w, h, x, yy, d.rad, d.rad * 1.3);
            }
        },
    };
}

// ---- Deep space: nebula, stars, ringed planet ------------------------------------------
function buildSpace(w, h) {
    const base = makeCanvas(w, h), g = context(base), r = rng(53), u = Math.min(w, h * 1.5);
    g.fillStyle = '#02030b'; g.fillRect(0, 0, w, h);
    const nebula = (seed, off, stops) => paintField(220, 124, (nx, ny) => {
        const qx = fbm(nx * 2.1 + off, ny * 2.1, seed, 4), qy = fbm(nx * 2.1 + 5.2, ny * 2.1 + off, seed + 1, 4);
        const f = fbm(nx * 2.5 + qx * 2, ny * 2.5 + qy * 2, seed + 2, 5);
        let col = stops[0][1], a = 0;
        for (let i = 0; i < stops.length - 1; i++) {
            const [t0, c0, a0] = stops[i], [t1, c1, a1] = stops[i + 1];
            if (f >= t0 && f <= t1) { const k = (f - t0) / (t1 - t0); col = mixc(c0, c1, k); a = lerp(a0, a1, k); }
            else if (f > t1 && i === stops.length - 2) { col = c1; a = a1; }
        }
        return [col[0], col[1], col[2], a];
    });
    g.save(); g.globalCompositeOperation = 'screen';
    g.drawImage(nebula(3, 0, [[0.4, [60, 20, 130], 0], [0.55, [90, 30, 160], 0.55], [0.68, [200, 50, 140], 0.7], [0.8, [255, 140, 110], 0.8]]), 0, 0, w, h);
    g.globalAlpha = 0.8;
    g.drawImage(nebula(11, 7, [[0.42, [10, 60, 120], 0], [0.56, [20, 130, 170], 0.5], [0.72, [90, 220, 220], 0.6]]), 0, 0, w, h);
    g.restore();
    // dark dust lanes
    g.drawImage(paintField(160, 90, (nx, ny) => [2, 3, 12, smooth(0.55, 0.78, fbm(nx * 3.2 + 9, ny * 3.2, 21, 5)) * 0.5]), 0, 0, w, h);
    const tints = [[255, 255, 255], [200, 220, 255], [255, 236, 210], [255, 200, 170], [175, 200, 255]];
    for (let i = 0; i < 900; i++) star(g, r() * w, r() * h, 0.3 + r() ** 3 * 0.9, pick(r, tints), 0.25 + r() * 0.7);
    const sparkle = [];
    for (let i = 0; i < 26; i++) {
        const s = { x: r() * w, y: r() * h, r: 0.9 + r() * 1.5, c: pick(r, tints), ph: r() * TAU, sp: 0.5 + r() * 1.5 };
        sparkle.push(s); star(g, s.x, s.y, s.r, s.c, 0.8, r() < 0.5);
    }
    // Ringed planet (upper right)
    const px = w * 0.83, py = h * 0.3, R = h * 0.15;
    const ring = (front) => {
        g.save(); g.translate(px, py); g.rotate(-0.32); g.scale(1, 0.26);
        for (const [rr, lw, col, a] of [[1.9, 0.14, [210, 190, 160], 0.5], [1.68, 0.1, [170, 150, 130], 0.55], [1.5, 0.07, [230, 215, 190], 0.6]]) {
            g.strokeStyle = css(col, a); g.lineWidth = R * lw;
            g.beginPath(); g.arc(0, 0, R * rr, front ? 0 : Math.PI, front ? Math.PI : TAU); g.stroke();
        }
        g.restore();
    };
    ring(false);
    g.save(); g.beginPath(); g.arc(px, py, R, 0, TAU); g.clip();
    g.fillStyle = gradient(g, 0, py - R, 0, py + R, [[0, '#5b86c9'], [0.25, '#7ea5d6'], [0.45, '#3d68ad'], [0.62, '#9bb9dd'], [0.8, '#2f5693'], [1, '#496fb0']]); g.fillRect(px - R, py - R, R * 2, R * 2);
    for (let i = 0; i < 16; i++) { const y = py - R + r() * R * 2; g.fillStyle = css(pick(r, [[255, 255, 255], [20, 40, 100], [150, 200, 255]]), 0.06 + r() * 0.08); g.fillRect(px - R, y, R * 2, R * (0.03 + r() * 0.08)); }
    g.fillStyle = radial(g, px - R * 0.42, py - R * 0.4, R * 0.2, R * 1.35, [[0, [255, 255, 255], 0.12], [0.5, [0, 0, 20], 0.15], [1, [0, 0, 12], 0.92]]); g.fillRect(px - R, py - R, R * 2, R * 2);
    g.restore();
    glow(g, px - R * 0.1, py - R * 0.1, R * 1.4, [110, 160, 255], 0.22, 'screen');
    ring(true);
    // Small warm moon (lower left)
    const mx = w * 0.12, my = h * 0.72, mr = h * 0.06;
    g.save(); g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.clip();
    g.fillStyle = gradient(g, mx - mr, my - mr, mx + mr, my + mr, [[0, '#ffd9a8'], [1, '#c9785a']]); g.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    for (let i = 0; i < 7; i++) { g.fillStyle = 'rgba(120,60,40,0.22)'; g.beginPath(); g.arc(mx + (r() - 0.5) * mr * 1.4, my + (r() - 0.5) * mr * 1.4, mr * (0.08 + r() * 0.15), 0, TAU); g.fill(); }
    g.fillStyle = radial(g, mx - mr * 0.5, my - mr * 0.45, mr * 0.2, mr * 1.6, [[0, [0, 0, 0], 0], [0.5, [10, 5, 20], 0.25], [1, [5, 3, 15], 0.95]]); g.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    g.restore();
    glow(g, mx, my, mr * 2.2, [255, 170, 120], 0.15, 'screen');
    vignette(g, w, h, 0.35, [0, 0, 6]);
    grain(g, w, h, 0.045);
    const shoot = { x0: w * 0.1, y0: h * 0.08, dx: w * 0.34, dy: h * 0.2, per: 13, ph: 6 };
    return {
        base,
        overlay(c, t) {
            c.save(); c.globalCompositeOperation = 'lighter';
            for (const s of sparkle) { c.globalAlpha = 0.5 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph)); c.fillStyle = css(s.c, 1); c.beginPath(); c.arc(s.x, s.y, s.r * 0.9, 0, TAU); c.fill(); }
            const f = ((t + shoot.ph) % shoot.per) / 1.1;
            if (f >= 0 && f < 1) {
                const hx = shoot.x0 + shoot.dx * f, hy = shoot.y0 + shoot.dy * f, tx = hx - shoot.dx * 0.22, ty = hy - shoot.dy * 0.22;
                c.globalAlpha = Math.sin(f * Math.PI);
                c.strokeStyle = gradient(c, tx, ty, hx, hy, [[0, [255, 255, 255], 0], [1, [255, 255, 255], 1]]); c.lineWidth = Math.max(1, u * 0.002);
                c.beginPath(); c.moveTo(tx, ty); c.lineTo(hx, hy); c.stroke();
            }
            c.restore();
        },
    };
}

// ---- Forest: layered misty trees with light shafts ----------------------------------------
function conifer(g, x, y, hgt, color) {
    const tiers = 6, wMax = hgt * 0.21;
    g.fillStyle = color;
    g.fillRect(x - hgt * 0.012, y - hgt * 0.12, hgt * 0.024, hgt * 0.12);
    for (let i = 0; i < tiers; i++) {
        const top = y - hgt * (1 - i * 0.135), bot = top + hgt * 0.3, wd = wMax * (0.28 + 0.72 * (i + 1) / tiers);
        g.beginPath();
        g.moveTo(x, top);
        g.quadraticCurveTo(x + wd * 0.35, top + (bot - top) * 0.55, x + wd, bot);
        g.quadraticCurveTo(x, bot - (bot - top) * 0.12, x - wd, bot);
        g.quadraticCurveTo(x - wd * 0.35, top + (bot - top) * 0.55, x, top);
        g.fill();
    }
}
function mistBand(w, h, seed, tint, amp) {
    return paintField(160, 22, (nx, ny) => {
        const f = fbm(nx * 3.2, ny * 2.2, seed, 5), env = Math.sin(Math.PI * clamp(ny, 0, 1)) ** 1.4;
        return [tint[0], tint[1], tint[2], smooth(0.3, 0.75, f) * env * amp];
    });
}

function buildForest(w, h) {
    const base = makeCanvas(w, h), g = context(base), r = rng(67), u = Math.min(w, h * 1.5);
    g.fillStyle = gradient(g, 0, 0, w * 0.4, h, [[0, '#f4f6d6'], [0.35, '#cfe6bd'], [0.7, '#8fc2a0'], [1, '#4f8f78']]);
    g.fillRect(0, 0, w, h);
    glow(g, w * 0.12, 0, h * 0.9, [255, 250, 205], 0.55, 'screen');
    // far hills
    ridge(g, w, h * 0.62, h * 0.18, 5, gradient(g, 0, h * 0.4, 0, h * 0.65, [[0, '#b4d8b0'], [1, '#9cc9a6']]), 4);
    g.drawImage(mistBand(w, h, 3, [235, 248, 225], 0.7), 0, h * 0.45, w, h * 0.22);
    // rows of conifers, each darker and larger
    const rows = [
        { n: 46, y: 0.66, h0: 0.14, h1: 0.24, col: '#8ec3a2', mist: [3, [225, 243, 220], 0.55, 0.52] },
        { n: 26, y: 0.77, h0: 0.28, h1: 0.46, col: '#5da081', mist: [8, [215, 236, 214], 0.5, 0.64] },
        { n: 15, y: 0.9, h0: 0.5, h1: 0.8, col: '#337560', mist: null },
    ];
    for (const row of rows) {
        for (let i = 0; i < row.n; i++) {
            const x = (i + r() * 0.8) / row.n * (w + 100) - 50, hh = h * lerp(row.h0, row.h1, r());
            conifer(g, x, h * row.y + (r() - 0.5) * h * 0.03, hh, row.col);
        }
        if (row.mist) g.drawImage(mistBand(w, h, row.mist[0], row.mist[1], row.mist[2]), 0, h * (row.mist[3] - 0.08), w, h * 0.3);
    }
    // forest floor
    g.fillStyle = gradient(g, 0, h * 0.84, 0, h, [[0, '#2f6a55', 0], [0.25, '#2a6350', 0.85], [1, '#143a2c']]); g.fillRect(0, h * 0.84, w, h * 0.16);
    // near trunks at the sides (and one slim one in the middle distance)
    const trunks = [[0.03, 0.07], [0.13, 0.04], [0.9, 0.06], [0.97, 0.09], [0.82, 0.03]];
    for (const [fx, fw] of trunks) {
        const x = w * fx, tw = u * fw * 1.2, lean = (r() - 0.5) * 0.04;
        g.fillStyle = gradient(g, x - tw, 0, x + tw, 0, [[0, '#2f5f4a'], [0.45, '#1f4535'], [1, '#12291f']]);
        g.beginPath(); g.moveTo(x - tw * 0.9, h * 1.02); g.lineTo(x - tw * 0.6 + lean * h, -h * 0.02); g.lineTo(x + tw * 0.6 + lean * h, -h * 0.02); g.lineTo(x + tw * 0.95, h * 1.02); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(8,20,14,0.35)'; g.lineWidth = Math.max(1, u * 0.002);
        for (let k = 0; k < 14; k++) { const o = (r() - 0.5) * tw * 1.5; g.beginPath(); g.moveTo(x + o, h * 1.02); g.bezierCurveTo(x + o * 0.9 + lean * h * 0.3, h * 0.6, x + o * 0.7 + lean * h * 0.6, h * 0.3, x + o * 0.6 + lean * h, -h * 0.02); g.stroke(); }
        g.strokeStyle = 'rgba(190,230,170,0.16)';
        g.beginPath(); g.moveTo(x - tw * 0.55, h); g.lineTo(x - tw * 0.4 + lean * h, 0); g.stroke();
    }
    // foliage clusters at the top corners
    for (const [cx, dir] of [[0, 1], [w, -1]]) for (let i = 0; i < 26; i++) {
        g.fillStyle = css(mixc([24, 60, 44], [52, 110, 70], r()), 0.9);
        g.beginPath(); g.ellipse(cx + dir * r() * w * 0.24, r() * h * 0.2 - h * 0.02, u * (0.04 + r() * 0.06), u * (0.02 + r() * 0.04), r() * 3, 0, TAU); g.fill();
    }
    // ferns at the bottom
    for (const [fx, dir] of [[0.02, 1], [0.12, 1], [0.95, -1], [0.85, -1], [0.3, 1], [0.7, -1]]) {
        for (let k = 0; k < 9; k++) {
            const a = -Math.PI / 2 + dir * (0.2 + k * 0.17) * (r() < 0.5 ? 1 : 0.8), L = u * (0.12 + r() * 0.16), x = w * fx, y = h * 1.01;
            g.strokeStyle = css(mixc([20, 70, 45], [60, 130, 80], r()), 0.95); g.lineWidth = Math.max(1, u * 0.004);
            const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L + L * 0.25;
            g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * L * 0.5, y + Math.sin(a) * L * 0.9, ex, ey); g.stroke();
            for (let i = 3; i < 16; i++) {
                const t = i / 16, qx = (1 - t) ** 2 * x + 2 * (1 - t) * t * (x + Math.cos(a) * L * 0.5) + t * t * ex, qy = (1 - t) ** 2 * y + 2 * (1 - t) * t * (y + Math.sin(a) * L * 0.9) + t * t * ey;
                const ll = L * 0.17 * (1 - t * 0.7);
                g.beginPath(); g.moveTo(qx, qy); g.lineTo(qx - ll * 0.8, qy + ll * 0.3); g.moveTo(qx, qy); g.lineTo(qx + ll * 0.8, qy + ll * 0.3); g.stroke();
            }
        }
    }
    vignette(g, w, h, 0.26, [6, 24, 16]);
    grain(g, w, h, 0.045);
    // Animated: light shafts that slowly breathe, drifting mist and dust motes
    const rays = makeCanvas(w, h), rg = context(rays);
    rg.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
        const x0 = w * (0.0 + i * 0.1 + r() * 0.05), wd = u * (0.025 + r() * 0.04), x1 = x0 + w * (0.3 + r() * 0.16), amp = 0.5 + r() * 0.5;
        for (let k = 0; k < 6; k++) {   // stacked, narrowing copies = a shaft with soft edges
            const f = 1 - k / 6 * 0.8;
            rg.fillStyle = gradient(rg, x0, 0, x1, h, [[0, [255, 250, 210], 0.11 * amp], [0.7, [255, 245, 200], 0.035 * amp], [1, [255, 245, 200], 0]]);
            rg.beginPath(); rg.moveTo(x0 - wd * f * 0.5, 0); rg.lineTo(x0 + wd * (1 + f * 0.5), 0); rg.lineTo(x1 + wd * 2.4 * f + wd, h); rg.lineTo(x1 - wd * f, h); rg.closePath(); rg.fill();
        }
    }
    const mist = [mistBand(w, h, 41, [240, 252, 235], 0.8), mistBand(w, h, 77, [230, 248, 232], 0.7)];
    const motes = Array.from({ length: 34 }, () => ({ x: r() * w, y: r() * h * 0.8, rad: 0.6 + r() * 1.4, ph: r() * TAU, sp: 0.15 + r() * 0.35, a: 0.3 + r() * 0.6 }));
    return {
        base,
        overlay(c, t) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.globalAlpha = 0.65 + 0.35 * Math.sin(t * 0.4);
            c.drawImage(rays, 0, 0);
            c.globalCompositeOperation = 'source-over';
            mist.forEach((m, i) => {
                const ww = w * 1.5, off = ((t * (6 + i * 4) + i * 300) % ww + ww) % ww;
                c.globalAlpha = 0.65 - i * 0.15;
                const y = h * (0.5 + i * 0.22), hh = h * 0.26;
                c.drawImage(m, -off, y, ww, hh); c.drawImage(m, ww - off, y, ww, hh);
            });
            c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgb(255,250,220)';
            for (const m of motes) { c.globalAlpha = m.a * (0.4 + 0.6 * Math.sin(t * m.sp * 3 + m.ph)) * 0.7; c.beginPath(); c.arc(m.x + Math.sin(t * m.sp + m.ph) * u * 0.02, (m.y - t * u * 0.004 * (1 + m.sp) % (h * 0.8) + h * 0.8) % (h * 0.8), m.rad, 0, TAU); c.fill(); }
            c.restore();
        },
    };
}

const SCENES = {
    studio: buildStudio,
    mumbai: buildMumbai,
    aurora: buildAurora,
    bokeh: buildBokeh,
    cozy: buildCozy,
    monsoon: buildMonsoon,
    space: buildSpace,
    forest: buildForest,
};

// =====================================================================
// "Your photo": an image the person picks from their own device. It is decoded and kept in memory only
// (nothing is uploaded or stored) and is forgotten when the page closes.
// =====================================================================
let photo = null;        // canvas, long side <= PHOTO_MAX
let photoVersion = 0;
const PHOTO_MAX = 1920;
const PHOTO_MAX_BYTES = 40 * 1024 * 1024;

export const hasCustomPhoto = () => Boolean(photo);

/** Decode an image File (any size, EXIF rotation respected where the browser supports it) into the in-memory photo. */
export async function setCustomPhoto(file) {
    let cleanup = () => {};
    try {
        if (!file || !/^image\//.test(file.type || '') || file.size > PHOTO_MAX_BYTES) return false;
        let src;
        try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); cleanup = () => src.close?.(); }
        catch {
            const url = URL.createObjectURL(file);
            cleanup = () => URL.revokeObjectURL(url);
            src = new Image();
            src.src = url;
            await src.decode();
        }
        const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
        if (!sw || !sh) return false;
        const k = Math.min(1, PHOTO_MAX / Math.max(sw, sh));       // huge photos are downscaled
        const c = makeCanvas(sw * k, sh * k), g = context(c);
        g.drawImage(src, 0, 0, c.width, c.height);
        photo = c;
        photoVersion++;
        return true;
    } catch (e) {
        console.warn('background photo failed', e);
        return false;
    } finally { cleanup(); }
}
export function clearCustomPhoto() { photo = null; photoVersion++; }

/** Open the device's file picker. Resolves true once a photo is loaded, false when cancelled or unusable. Call it from a click. */
export function pickCustomPhoto() {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        document.body.append(input);
        let done = false;
        const finish = ok => { if (done) return; done = true; window.removeEventListener('focus', onFocus); input.remove(); resolve(ok); };
        // Older browsers have no "cancel" event: the window regains focus when the dialog closes without a choice.
        const onFocus = () => setTimeout(() => { if (!input.files?.length) finish(false); }, 1200);
        input.addEventListener('change', async () => finish(await setCustomPhoto(input.files?.[0])));
        input.addEventListener('cancel', () => finish(false));
        window.addEventListener('focus', onFocus);
        input.click();
    });
}

function buildPhoto(w, h) {
    const base = makeCanvas(w, h), g = context(base);
    const k = Math.max(w / photo.width, h / photo.height), dw = photo.width * k, dh = photo.height * k;   // cover-fit
    g.drawImage(photo, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return { base };
}

// =====================================================================
// Public API
// =====================================================================
/** Ids saved by older versions (and unknown ids) resolve to something that exists. */
const ALIASES = { sunset: 'mumbai', ocean: 'aurora' };
export function migrateBackground(id) {
    const v = ALIASES[id] || id;
    if (v === 'none' || v === 'blur' || v === 'blur-strong') return v;
    if (v === 'photo') return photo ? 'photo' : 'none';   // the photo only lives for the session
    return SCENES[v] ? v : 'none';
}

/** Blur options handled by effects.js: strength as a fraction of the long side (standard deviation). */
export const BLUR_SIGMA = { blur: 0.02, 'blur-strong': 0.042 };

/** A scene ready to draw at w x h: { id, w, h, version, base (canvas), overlay(ctx, t) | null, small (tiny copy for light wrap) }. */
export function makeBackdrop(id, w, h) {
    const key = ALIASES[id] || id;
    const scene = key === 'photo' && photo ? buildPhoto(w, h) : (SCENES[key] || SCENES.studio)(w, h);   // unknown ids and a missing photo: Studio, never the raw camera
    const small = makeCanvas(48, 48 * h / w), sg = context(small);
    sg.drawImage(scene.base, 0, 0, small.width, small.height);
    return { id, w, h, version: key === 'photo' ? photoVersion : 0, base: scene.base, overlay: scene.overlay || null, small };
}
export const backdropVersion = id => (id === 'photo' ? photoVersion : 0);

// ---- thumbnails for the picker: drawn by the same code, rendered once and cached ----
// Building nine scenes takes a moment, so the first request draws a plain colour tile at once and the real picture follows when the
// browser is idle (one thumbnail at a time, so the page never stalls); later requests are instant.
const thumbCache = new Map();
const thumbWaiting = new Map();   // key -> [{ ctx, w, h }] tiles to fill in when ready
const thumbQueue = [];
let thumbPump = false;
const idle = f => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 400 }) : setTimeout(f, 30));
function pumpThumbs() {
    if (thumbPump) return;
    thumbPump = true;
    const next = () => {
        const job = thumbQueue.shift();
        if (!job) { thumbPump = false; for (const r of thumbIdle.splice(0)) r(); return; }
        try { job(); } catch (e) { console.warn('thumbnail failed', e); }
        idle(next);
    };
    idle(next);
}
const thumbIdle = [];
/** Resolves when every queued thumbnail has been drawn (used by tests). */
export const thumbsReady = () => new Promise(r => { if (!thumbPump && !thumbQueue.length) r(); else thumbIdle.push(r); });
function cachedThumb(key, size, draw, tint = '#2b3150') {
    return (ctx, w, h) => {
        const c = thumbCache.get(key);
        if (c) { ctx.drawImage(c, 0, 0, w, h); return; }
        ctx.fillStyle = tint; ctx.fillRect(0, 0, w, h);
        let waiting = thumbWaiting.get(key);
        if (!waiting) {
            thumbWaiting.set(key, waiting = []);
            thumbQueue.push(() => {
                const cv = makeCanvas(w, h);
                draw(context(cv), w, h);
                thumbCache.set(key, cv);
                for (const t of thumbWaiting.get(key) || []) t.ctx.drawImage(cv, 0, 0, t.w, t.h);
                thumbWaiting.delete(key);
            });
            pumpThumbs();
        }
        waiting.push({ ctx, w, h });
    };
}
function sceneThumb(id, tint) {
    return cachedThumb(id, 80, (g, w, h) => {
        const big = makeCanvas(w * 2, h * 2), bg = context(big);
        const scene = SCENES[id](big.width, big.height);
        bg.drawImage(scene.base, 0, 0);
        scene.overlay?.(bg, 2.5);
        g.drawImage(big, 0, 0, w, h);
    }, tint);
}
/** Head-and-shoulders pictogram, used by the blur thumbnails. */
function personIcon(g, w, h) {
    g.fillStyle = 'rgba(18,22,38,0.94)';
    g.beginPath(); g.arc(w * 0.5, h * 0.4, w * 0.15, 0, TAU); g.fill();
    g.beginPath(); g.moveTo(w * 0.16, h * 1.02); g.quadraticCurveTo(w * 0.18, h * 0.64, w * 0.5, h * 0.62); g.quadraticCurveTo(w * 0.82, h * 0.64, w * 0.84, h * 1.02); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(1, w * 0.012);
    g.beginPath(); g.arc(w * 0.5, h * 0.4, w * 0.15, Math.PI * 1.1, Math.PI * 1.75); g.stroke();
}
function blurThumb(level) {
    return cachedThumb('blur' + level, 80, (g, w, h) => {
        const src = makeCanvas(w, h), sg = context(src), r = rng(5);
        sg.fillStyle = gradient(sg, 0, 0, w, h, [[0, '#2a3f7a'], [1, '#7a3d6b']]); sg.fillRect(0, 0, w, h);
        for (let i = 0; i < 9; i++) { sg.fillStyle = css(pick(r, BOKEH_COLORS), 0.85); sg.beginPath(); sg.arc(r() * w, r() * h, w * (0.05 + r() * 0.09), 0, TAU); sg.fill(); }
        sg.fillStyle = 'rgba(255,255,255,0.8)';
        for (let i = 0; i < 4; i++) sg.fillRect(w * (0.08 + i * 0.22), h * 0.12, w * 0.12, h * 0.05);
        // smooth blur by repeated halving and doubling (no ctx.filter needed)
        let cur = src;
        const steps = level === 1 ? 1 : 3;
        for (let i = 0; i < steps; i++) { const c = makeCanvas(cur.width / 2, cur.height / 2); context(c).drawImage(cur, 0, 0, c.width, c.height); cur = c; }
        for (let i = 0; i < steps; i++) { const c = makeCanvas(cur.width * 2, cur.height * 2); context(c).drawImage(cur, 0, 0, c.width, c.height); cur = c; }
        g.drawImage(cur, 0, 0, w, h);
        personIcon(g, w, h);
    }, '#6b6f9b');
}
const photoPlaceholder = cachedThumb('photo', 80, (g, w, h) => {
    g.fillStyle = gradient(g, 0, 0, 0, h, [[0, '#8fc7f0'], [1, '#f6d9b0']]); g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(w * 0.7, h * 0.3, w * 0.11, 0, TAU); g.fill();
    g.fillStyle = '#5d8f78'; g.beginPath(); g.moveTo(0, h * 0.85); g.lineTo(w * 0.32, h * 0.42); g.lineTo(w * 0.6, h * 0.85); g.fill();
    g.fillStyle = '#3f7260'; g.beginPath(); g.moveTo(w * 0.35, h * 0.9); g.lineTo(w * 0.72, h * 0.5); g.lineTo(w * 1.05, h * 0.9); g.fill();
    g.fillStyle = 'rgba(15,20,35,0.78)'; g.beginPath(); g.arc(w * 0.78, h * 0.78, w * 0.17, 0, TAU); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = w * 0.045; g.lineCap = 'round';
    g.beginPath(); g.moveTo(w * 0.78, h * 0.68); g.lineTo(w * 0.78, h * 0.88); g.moveTo(w * 0.68, h * 0.78); g.lineTo(w * 0.88, h * 0.78); g.stroke();
}, '#8fc7f0');

/** The picker tile of "Your photo": a picture-and-plus icon until a photo is chosen, then the chosen photo itself. */
function photoThumb(ctx, w, h) {
    if (!photo) return photoPlaceholder(ctx, w, h);
    const key = 'photo#' + photoVersion;
    for (const k of [...thumbCache.keys()]) if (k.startsWith('photo#') && k !== key) thumbCache.delete(k);
    cachedThumb(key, 80, (g, cw, ch) => {
        const k = Math.max(cw / photo.width, ch / photo.height);
        g.drawImage(photo, (cw - photo.width * k) / 2, (ch - photo.height * k) / 2, photo.width * k, photo.height * k);
        g.fillStyle = 'rgba(15,20,35,0.7)'; g.beginPath(); g.arc(cw * 0.8, ch * 0.8, cw * 0.15, 0, TAU); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = cw * 0.04; g.lineCap = 'round';   // a small pencil-less "change" mark: two arcs with arrow tips
        g.beginPath(); g.arc(cw * 0.8, ch * 0.8, cw * 0.06, Math.PI * 0.2, Math.PI * 1.3); g.stroke();
        g.beginPath(); g.arc(cw * 0.8, ch * 0.8, cw * 0.06, Math.PI * 1.2, Math.PI * 2.3); g.stroke();
    }, '#444b66')(ctx, w, h);
}

export const BACKGROUNDS = [
    { id: 'none', label: 'None' },
    { id: 'blur', label: 'Blur', thumb: blurThumb(1) },
    { id: 'blur-strong', label: 'Strong blur', thumb: blurThumb(2) },
    { id: 'mumbai', label: 'Mumbai dusk', thumb: sceneThumb('mumbai', '#5b2a86') },
    { id: 'aurora', label: 'Aurora', thumb: sceneThumb('aurora', '#08283a') },
    { id: 'bokeh', label: 'Bokeh lights', thumb: sceneThumb('bokeh', '#26285e') },
    { id: 'cozy', label: 'Cozy room', thumb: sceneThumb('cozy', '#3b5d5d') },
    { id: 'monsoon', label: 'Monsoon window', thumb: sceneThumb('monsoon', '#16224a') },
    { id: 'space', label: 'Deep space', thumb: sceneThumb('space', '#1b1040') },
    { id: 'studio', label: 'Studio', thumb: sceneThumb('studio', '#cfd4dc') },
    { id: 'forest', label: 'Misty forest', thumb: sceneThumb('forest', '#5a9a7a') },
    // The person picks the image from their device (see pickCustomPhoto): it never leaves the device.
    // pick(active): call it from the click handler; resolves true when the option can be applied (a photo was chosen, or one is already loaded
    // and this tile is not the active one: then it is simply selected). Clicking the active tile again lets the person change the photo.
    { id: 'photo', label: 'Your photo', thumb: photoThumb, pick: active => (photo && !active ? Promise.resolve(true) : pickCustomPhoto()) },
];
export const buildScene = (id, w, h) => SCENES[id](w, h);
