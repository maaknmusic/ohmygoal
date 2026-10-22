// =====================================================================
// Reactions: ORIGINAL artwork drawn in code (Canvas 2D paths and gradients). No emoji glyphs, no image files,
// nothing copied from any other app, set or font. Each sprite is drawn in a 100 x 100 box.
//
// This module is also the wire protocol for reactions: { t: 'react', e: <id>, n: <1..MAX_BURST> }.
// Everything that arrives from the other person goes through parseReaction(), which accepts only known ids
// (plus the six emoji that older versions of the app sent, mapped to their new ids) and a whole-number count.
// =====================================================================
import { rng, TAU } from './mask-kit.js';

/** premium: only people with Premium can send it (everyone can see it). */
export const REACTIONS = [
    { id: 'heart', label: 'Heart' },
    { id: 'laugh', label: 'Laugh' },
    { id: 'fire', label: 'Fire' },
    { id: 'cheer', label: 'Cheer' },
    { id: 'lotus', label: 'Lotus' },
    { id: 'wow', label: 'Wow' },
    { id: 'star', label: 'Star', premium: true },
    { id: 'party', label: 'Party', premium: true },
    { id: 'balloon', label: 'Balloon', premium: true },
    { id: 'rainbow', label: 'Rainbow', premium: true },
    { id: 'gem', label: 'Gem', premium: true },
    { id: 'bolt', label: 'Spark', premium: true },
];

const BY_ID = new Map(REACTIONS.map(r => [r.id, r]));
/** Older versions of the app sent these emoji over the wire. We never draw them, we draw their new twin. */
const LEGACY = new Map([['❤️', 'heart'], ['😂', 'laugh'], ['🔥', 'fire'], ['👏', 'cheer'], ['🙏', 'lotus'], ['😮', 'wow']]);

export const MAX_BURST = 12;      // sprites in one message
export const HOLD_MAX = 10;       // sprites from one press-and-hold
export const SEND_CAP = 24;       // sprites you can send in the window below
export const RECEIVE_CAP = 30;    // sprites we show from the other person in the window below
export const RATE_WINDOW_MS = 4000;

export const reactionById = id => BY_ID.get(id) || null;

/** A validated reaction from an untrusted message, or null. */
export function parseReaction(msg) {
    if (!msg || typeof msg !== 'object') return null;
    const e = msg.e;
    if (typeof e !== 'string' || e.length > 16) return null;
    const id = BY_ID.has(e) ? e : LEGACY.get(e);
    if (!id) return null;
    const n = Number.isInteger(msg.n) ? Math.min(MAX_BURST, Math.max(1, msg.n)) : 1;
    return { id, n };
}

/** Sliding-window budget. Drops old stamps from `times` (in place) and records up to `n` new ones.
 *  Returns how many of the n were allowed (0 when the window is full). */
export function takeBudget(times, now, n, cap, windowMs = RATE_WINDOW_MS) {
    while (times.length && now - times[0] >= windowMs) times.shift();
    const granted = Math.max(0, Math.min(n, cap - times.length));
    for (let i = 0; i < granted; i++) times.push(now);
    return granted;
}

// ---------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------
const lin = (c, x0, y0, x1, y1, stops) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    for (const [p, col] of stops) g.addColorStop(p, col);
    return g;
};
const rad = (c, x0, y0, r0, x1, y1, r1, stops) => {
    const g = c.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (const [p, col] of stops) g.addColorStop(p, col);
    return g;
};
const INK = '#4a2418';

/** A four-pointed sparkle centred at (x, y). */
function sparkle(c, x, y, r, fill = '#fff', alpha = 1) {
    c.save();
    c.globalAlpha = alpha;
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(x, y - r);
    c.quadraticCurveTo(x + r * 0.12, y - r * 0.12, x + r, y);
    c.quadraticCurveTo(x + r * 0.12, y + r * 0.12, x, y + r);
    c.quadraticCurveTo(x - r * 0.12, y + r * 0.12, x - r, y);
    c.quadraticCurveTo(x - r * 0.12, y - r * 0.12, x, y - r);
    c.closePath();
    c.fill();
    c.restore();
}

function gloss(c, x, y, rx, ry, rot, alpha = 0.55) {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.fillStyle = lin(c, 0, -ry, 0, ry, [[0, `rgba(255,255,255,${alpha})`], [1, 'rgba(255,255,255,0)']]);
    c.beginPath();
    c.ellipse(0, 0, rx, ry, 0, 0, TAU);
    c.fill();
    c.restore();
}

/** The round, glossy face used by the laugh and wow sprites. */
function faceDisc(c, hue) {
    const [a, b, d] = hue;
    c.fillStyle = rad(c, 40, 34, 4, 50, 52, 46, [[0, a], [0.55, b], [1, d]]);
    c.beginPath();
    c.arc(50, 52, 41, 0, TAU);
    c.fill();
    c.strokeStyle = 'rgba(120,60,10,0.35)';
    c.lineWidth = 2;
    c.stroke();
    gloss(c, 38, 26, 20, 9, -0.5, 0.5);
}

function drawHeart(c) {
    const path = () => {
        c.beginPath();
        c.moveTo(50, 90);
        c.bezierCurveTo(16, 66, 4, 46, 9, 29);
        c.bezierCurveTo(14, 12, 40, 8, 50, 29);
        c.bezierCurveTo(60, 8, 86, 12, 91, 29);
        c.bezierCurveTo(96, 46, 84, 66, 50, 90);
        c.closePath();
    };
    path();
    c.fillStyle = rad(c, 36, 30, 3, 50, 52, 52, [[0, '#ff9db3'], [0.4, '#ff3f6c'], [1, '#c20f43']]);
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(120,0,30,0.45)';
    c.stroke();
    gloss(c, 30, 28, 14, 7, -0.7, 0.7);
    gloss(c, 66, 30, 6, 3, 0.6, 0.35);
    sparkle(c, 80, 14, 8, '#fff', 0.95);
}

function drawLaugh(c) {
    c.save();
    c.translate(50, 52);
    c.rotate(-0.17);
    c.translate(-50, -52);
    faceDisc(c, ['#ffe97a', '#ffc233', '#f08a14']);
    // blush
    c.fillStyle = 'rgba(255,90,90,0.28)';
    c.beginPath(); c.ellipse(24, 62, 8, 5, 0, 0, TAU); c.ellipse(76, 62, 8, 5, 0, 0, TAU); c.fill();
    // eyes squeezed shut with laughing
    c.strokeStyle = INK; c.lineWidth = 5.5; c.lineCap = 'round';
    c.beginPath(); c.arc(33, 46, 8.5, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    c.beginPath(); c.arc(67, 46, 8.5, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    // wide open mouth with teeth and tongue
    c.beginPath();
    c.moveTo(24, 58);
    c.quadraticCurveTo(50, 64, 76, 58);
    c.bezierCurveTo(76, 84, 62, 90, 50, 90);
    c.bezierCurveTo(38, 90, 24, 84, 24, 58);
    c.closePath();
    c.fillStyle = '#6e1b2a';
    c.fill();
    c.save();
    c.clip();
    c.fillStyle = '#fff';
    c.fillRect(20, 54, 60, 10);
    c.fillStyle = lin(c, 0, 74, 0, 92, [[0, '#ff7b92'], [1, '#e23a5f']]);
    c.beginPath(); c.ellipse(50, 90, 18, 14, 0, 0, TAU); c.fill();
    c.restore();
    c.strokeStyle = INK; c.lineWidth = 2.5; c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(24, 58); c.quadraticCurveTo(50, 64, 76, 58);
    c.bezierCurveTo(76, 84, 62, 90, 50, 90); c.bezierCurveTo(38, 90, 24, 84, 24, 58);
    c.stroke();
    c.restore();
    // tears of joy flying off both sides
    for (const [x, y, s] of [[10, 40, 1], [90, 40, -1]]) {
        c.save();
        c.translate(x, y);
        c.scale(s, 1);
        c.fillStyle = lin(c, 0, -10, 0, 8, [[0, '#d8f3ff'], [1, '#4ab4f0']]);
        c.beginPath();
        c.moveTo(0, -11);
        c.bezierCurveTo(7, -2, 7, 6, 0, 8);
        c.bezierCurveTo(-7, 6, -7, -2, 0, -11);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.beginPath(); c.ellipse(-2, -1, 1.6, 3.2, 0.3, 0, TAU); c.fill();
        c.restore();
    }
}

function drawFire(c) {
    const flame = (grad, pts) => {
        c.beginPath();
        c.moveTo(...pts[0]);
        for (let i = 1; i < pts.length; i++) c.bezierCurveTo(...pts[i]);
        c.closePath();
        c.fillStyle = grad;
        c.fill();
    };
    flame(lin(c, 0, 6, 0, 96, [[0, '#ffc02b'], [0.45, '#ff6a1f'], [1, '#d9231f']]), [
        [50, 5],
        [57, 24, 82, 34, 82, 62],
        [82, 82, 68, 95, 50, 95],
        [32, 95, 18, 82, 18, 62],
        [18, 46, 28, 40, 33, 27],
        [36, 36, 40, 39, 45, 38],
        [43, 26, 43, 15, 50, 5],
    ]);
    flame(lin(c, 0, 34, 0, 92, [[0, '#ffe45a'], [1, '#ff9a1f']]), [
        [50, 34],
        [56, 46, 70, 52, 70, 70],
        [70, 83, 61, 92, 50, 92],
        [39, 92, 30, 83, 30, 70],
        [30, 60, 35, 56, 38, 48],
        [42, 54, 45, 54, 47, 52],
        [46, 44, 47, 40, 50, 34],
    ]);
    flame(lin(c, 0, 58, 0, 92, [[0, '#fffbe0'], [1, '#ffe27a']]), [
        [50, 58],
        [54, 66, 60, 70, 60, 79],
        [60, 87, 55, 92, 50, 92],
        [45, 92, 40, 87, 40, 79],
        [40, 70, 46, 66, 50, 58],
    ]);
    gloss(c, 34, 62, 5, 12, 0.25, 0.4);
    sparkle(c, 86, 22, 6, '#ffe9a0', 0.95);
    sparkle(c, 14, 40, 4.5, '#ffd07a', 0.9);
}

function drawCheer(c) {
    // Two clapping hands meeting with impact lines (applause).
    const hand = flip => {
        c.save();
        c.translate(50, 84);
        c.rotate(flip * 0.42);
        c.scale(flip, 1);
        const skin = lin(c, -14, -50, 14, 0, [[0, '#ffe2b8'], [1, '#f2a96a']]);
        // four fingers
        c.fillStyle = skin; c.strokeStyle = 'rgba(140,70,20,0.55)'; c.lineWidth = 2;
        [[-13, -46, 7], [-5, -52, 7.4], [4, -51, 7.2], [12, -44, 6.4]].forEach(([x, top, w]) => {
            c.beginPath();
            c.roundRect(x - w / 2, top, w, 30, w / 2);
            c.fill(); c.stroke();
        });
        // palm
        c.beginPath();
        c.moveTo(-17, -22);
        c.lineTo(17, -22);
        c.bezierCurveTo(21, -6, 17, 6, 9, 12);
        c.lineTo(-9, 12);
        c.bezierCurveTo(-17, 6, -21, -6, -17, -22);
        c.closePath();
        c.fill(); c.stroke();
        // thumb
        c.beginPath();
        c.ellipse(-17, -6, 5.6, 11, -0.5, 0, TAU);
        c.fill(); c.stroke();
        c.restore();
    };
    hand(-1);
    hand(1);
    // impact lines
    c.strokeStyle = '#ffb02e'; c.lineWidth = 4.5; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(50, 4); c.lineTo(50, 15);
    c.moveTo(27, 12); c.lineTo(33, 22);
    c.moveTo(73, 12); c.lineTo(67, 22);
    c.moveTo(12, 30); c.lineTo(22, 36);
    c.moveTo(88, 30); c.lineTo(78, 36);
    c.stroke();
    sparkle(c, 90, 66, 6, '#fff', 0.9);
    sparkle(c, 10, 64, 5, '#fff3b0', 0.9);
}

function drawLotus(c) {
    const petal = (rot, len, w, tip, base) => {
        c.save();
        c.translate(50, 80);
        c.rotate(rot);
        c.beginPath();
        c.moveTo(0, 0);
        c.bezierCurveTo(-w, -len * 0.3, -w * 0.8, -len * 0.8, 0, -len);
        c.bezierCurveTo(w * 0.8, -len * 0.8, w, -len * 0.3, 0, 0);
        c.closePath();
        c.fillStyle = lin(c, 0, -len, 0, 0, [[0, tip], [1, base]]);
        c.fill();
        c.lineWidth = 1.6;
        c.strokeStyle = 'rgba(160,30,100,0.35)';
        c.stroke();
        c.restore();
    };
    // water ripple
    c.fillStyle = lin(c, 0, 82, 0, 96, [[0, 'rgba(110,220,230,0.9)'], [1, 'rgba(40,150,190,0.5)']]);
    c.beginPath(); c.ellipse(50, 88, 40, 8, 0, 0, TAU); c.fill();
    petal(-1.2, 40, 13, '#ffc3e0', '#e8499a');
    petal(1.2, 40, 13, '#ffc3e0', '#e8499a');
    petal(-0.78, 50, 14, '#ffd3e8', '#f0589f');
    petal(0.78, 50, 14, '#ffd3e8', '#f0589f');
    petal(-0.36, 58, 14, '#fff0f7', '#ff6fb0');
    petal(0.36, 58, 14, '#fff0f7', '#ff6fb0');
    petal(0, 64, 14, '#ffffff', '#ff7fb9');
    c.fillStyle = rad(c, 48, 72, 1, 50, 76, 8, [[0, '#fff3a0'], [1, '#f0a81c']]);
    c.beginPath(); c.ellipse(50, 78, 9, 5, 0, 0, TAU); c.fill();
    sparkle(c, 84, 22, 8, '#ffe9a0', 0.95);
    sparkle(c, 16, 34, 5, '#fff', 0.9);
}

function drawWow(c) {
    faceDisc(c, ['#ffe97a', '#ffc233', '#f08a14']);
    // raised eyebrows
    c.strokeStyle = INK; c.lineWidth = 4.5; c.lineCap = 'round';
    c.beginPath(); c.arc(32, 41, 11, Math.PI * 1.2, Math.PI * 1.75); c.stroke();
    c.beginPath(); c.arc(68, 41, 11, Math.PI * 1.25, Math.PI * 1.8); c.stroke();
    // wide round eyes with a catch light
    for (const x of [33, 67]) {
        c.fillStyle = '#fff';
        c.beginPath(); c.ellipse(x, 52, 9.5, 11.5, 0, 0, TAU); c.fill();
        c.lineWidth = 2; c.strokeStyle = 'rgba(90,40,10,0.5)'; c.stroke();
        c.fillStyle = INK;
        c.beginPath(); c.arc(x, 53, 5, 0, TAU); c.fill();
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(x - 1.8, 50.5, 1.8, 0, TAU); c.fill();
    }
    // small round "o" mouth
    c.fillStyle = '#6e1b2a';
    c.beginPath(); c.ellipse(50, 77, 8, 10, 0, 0, TAU); c.fill();
    c.fillStyle = '#e8506f';
    c.beginPath(); c.ellipse(50, 82, 5, 4, 0, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,90,90,0.26)';
    c.beginPath(); c.ellipse(21, 68, 7, 4.5, 0, 0, TAU); c.ellipse(79, 68, 7, 4.5, 0, 0, TAU); c.fill();
    // little "!" lines
    c.strokeStyle = '#ffb02e'; c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(90, 12); c.lineTo(84, 22); c.moveTo(97, 24); c.lineTo(88, 28); c.moveTo(10, 12); c.lineTo(16, 22); c.moveTo(3, 24); c.lineTo(12, 28); c.stroke();
}

function drawStar(c) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU - Math.PI / 2;
        const r = i % 2 ? 21 : 46;
        pts.push([50 + Math.cos(a) * r, 54 + Math.sin(a) * r]);
    }
    const path = () => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); };
    path();
    c.lineJoin = 'round'; c.lineWidth = 10; c.strokeStyle = '#f59a12'; c.stroke();
    path();
    c.fillStyle = rad(c, 42, 38, 2, 50, 54, 48, [[0, '#fff2a0'], [0.5, '#ffd23a'], [1, '#f5a31a']]);
    c.fill();
    // facet: the lit half of each arm
    c.fillStyle = 'rgba(255,255,255,0.32)';
    c.beginPath();
    c.moveTo(50, 54); c.lineTo(pts[0][0], pts[0][1]); c.lineTo(pts[1][0], pts[1][1]); c.closePath();
    c.moveTo(50, 54); c.lineTo(pts[4][0], pts[4][1]); c.lineTo(pts[5][0], pts[5][1]); c.closePath();
    c.moveTo(50, 54); c.lineTo(pts[8][0], pts[8][1]); c.lineTo(pts[9][0], pts[9][1]); c.closePath();
    c.fill();
    sparkle(c, 82, 14, 8, '#fff', 0.95);
    sparkle(c, 12, 80, 6, '#fff3b0', 0.9);
}

function drawParty(c) {
    // a cone launcher with the burst coming out of it
    c.save();
    c.translate(24, 80);
    c.rotate(-0.6);
    c.beginPath(); c.moveTo(0, -30); c.lineTo(-17, 8); c.lineTo(17, 8); c.closePath();
    c.fillStyle = lin(c, -17, 0, 17, 0, [[0, '#ff7a1a'], [1, '#ffb83a']]);
    c.fill();
    c.save(); c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 4;
    for (const y of [-14, -4]) { c.beginPath(); c.moveTo(-20, y + 6); c.lineTo(20, y - 6); c.stroke(); }
    c.restore();
    c.fillStyle = '#e8438a';
    c.beginPath(); c.ellipse(0, 8, 17, 4.5, 0, 0, TAU); c.fill();
    c.restore();
    // streamers
    c.lineWidth = 3.4; c.lineCap = 'round';
    for (const [col, p] of [['#38c6ff', [38, 58, 50, 40, 40, 28, 58, 18]], ['#ff4d6d', [42, 62, 62, 56, 66, 40, 84, 40]], ['#2ecf7a', [36, 52, 40, 34, 60, 36, 62, 20]]]) {
        c.strokeStyle = col;
        c.beginPath(); c.moveTo(p[0], p[1]); c.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]); c.stroke();
    }
    // confetti
    const r = rng(11);
    const cols = ['#ff4d6d', '#ffd23a', '#38c6ff', '#7a5cff', '#2ecf7a', '#ff8a3a'];
    for (let i = 0; i < 16; i++) {
        const x = 34 + r() * 60, y = 6 + r() * 56;
        c.fillStyle = cols[i % cols.length];
        c.save(); c.translate(x, y); c.rotate(r() * TAU);
        if (i % 3 === 0) { c.beginPath(); c.arc(0, 0, 3, 0, TAU); c.fill(); } else c.fillRect(-3.4, -1.8, 6.8, 3.6);
        c.restore();
    }
    sparkle(c, 88, 14, 7, '#fff', 0.95);
}

function drawBalloon(c) {
    c.strokeStyle = 'rgba(80,60,100,0.75)'; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(50, 78); c.bezierCurveTo(44, 84, 56, 88, 49, 96); c.stroke();
    c.beginPath(); c.moveTo(50, 8);
    c.bezierCurveTo(78, 8, 82, 36, 74, 54);
    c.bezierCurveTo(68, 66, 58, 72, 50, 74);
    c.bezierCurveTo(42, 72, 32, 66, 26, 54);
    c.bezierCurveTo(18, 36, 22, 8, 50, 8);
    c.closePath();
    c.fillStyle = rad(c, 38, 28, 3, 50, 42, 44, [[0, '#d9a8ff'], [0.45, '#9a52f0'], [1, '#5b1fb8']]);
    c.fill();
    c.lineWidth = 2.5; c.strokeStyle = 'rgba(50,10,110,0.4)'; c.stroke();
    c.beginPath(); c.moveTo(50, 73); c.lineTo(43, 82); c.lineTo(57, 82); c.closePath();
    c.fillStyle = '#6a28c8'; c.fill();
    gloss(c, 38, 26, 8, 15, 0.45, 0.8);
    sparkle(c, 84, 18, 7, '#fff', 0.9);
}

function drawRainbow(c) {
    const bands = ['#ff3b5c', '#ff9a1f', '#ffd93a', '#3ed17a', '#2fa8ff', '#7a5cff'];
    c.lineCap = 'butt';
    bands.forEach((col, i) => {
        c.strokeStyle = col; c.lineWidth = 7.2;
        c.beginPath(); c.arc(50, 74, 44 - i * 6.6, Math.PI, 0); c.stroke();
    });
    const cloud = (x, y, s) => {
        c.save(); c.translate(x, y); c.scale(s, s);
        c.fillStyle = lin(c, 0, -14, 0, 8, [[0, '#ffffff'], [1, '#d6e6ff']]);
        c.beginPath();
        c.arc(-11, 0, 9, 0, TAU); c.arc(0, -6, 11, 0, TAU); c.arc(12, 0, 9, 0, TAU); c.rect(-11, -1, 23, 9);
        c.fill();
        c.restore();
    };
    cloud(15, 78, 0.95);
    cloud(85, 78, 0.95);
    sparkle(c, 50, 14, 6, '#fff', 0.9);
}

function drawGem(c) {
    const P = { tl: [24, 28], tr: [76, 28], r: [95, 46], b: [50, 94], l: [5, 46], ml: [36, 28], mr: [64, 28], cl: [36, 46], cr: [64, 46] };
    const tri = (pts, fill) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fillStyle = fill; c.fill(); };
    // crown
    tri([P.l, P.tl, P.ml, [30, 46]], '#7fd8ff');
    tri([P.tl, P.ml, [50, 46], [30, 46]], '#bdeaff');
    tri([P.ml, P.mr, P.cr, P.cl], '#e9f9ff');
    tri([P.mr, P.tr, P.r, [70, 46]], '#4aa8ee');
    tri([P.tr, P.mr, [50, 46], [70, 46]], '#8fd0ff');
    // pavilion
    tri([P.l, [30, 46], P.b], '#3a8be0');
    tri([[30, 46], [50, 46], P.b], '#62b4f5');
    tri([[50, 46], [70, 46], P.b], '#2f78d0');
    tri([[70, 46], P.r, P.b], '#1f5fb8');
    c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = 'rgba(15,60,140,0.65)';
    c.beginPath(); c.moveTo(...P.tl); c.lineTo(...P.tr); c.lineTo(...P.r); c.lineTo(...P.b); c.lineTo(...P.l); c.closePath(); c.stroke();
    c.lineWidth = 1.6; c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.beginPath(); c.moveTo(...P.l); c.lineTo(...P.r); c.moveTo(...P.ml); c.lineTo(30, 46); c.moveTo(...P.mr); c.lineTo(70, 46); c.stroke();
    sparkle(c, 30, 20, 9, '#fff', 0.95);
    sparkle(c, 88, 80, 6, '#cfeeff', 0.9);
}

function drawBolt(c) {
    const path = () => {
        c.beginPath();
        c.moveTo(60, 3); c.lineTo(20, 55); c.lineTo(45, 55); c.lineTo(34, 97); c.lineTo(82, 40); c.lineTo(55, 40); c.lineTo(68, 3);
        c.closePath();
    };
    c.lineJoin = 'round';
    path(); c.lineWidth = 9; c.strokeStyle = '#ee8a12'; c.stroke();
    path(); c.fillStyle = lin(c, 40, 3, 60, 97, [[0, '#fff7a8'], [0.5, '#ffd830'], [1, '#ff9f1c']]); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2.4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(60, 12); c.lineTo(30, 52); c.stroke();
    sparkle(c, 86, 18, 8, '#fff', 0.95);
    sparkle(c, 12, 80, 6, '#fff3b0', 0.9);
}

const DRAW = { heart: drawHeart, laugh: drawLaugh, fire: drawFire, cheer: drawCheer, lotus: drawLotus, wow: drawWow, star: drawStar, party: drawParty, balloon: drawBalloon, rainbow: drawRainbow, gem: drawGem, bolt: drawBolt };

/** Draws sprite `id` into a 100 x 100 box at the context's current transform. */
export function drawSprite(c, id) {
    const draw = DRAW[id];
    if (!draw || !BY_ID.has(id)) return false;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    draw(c);
    c.restore();
    return true;
}

// ---------------------------------------------------------------------
// Bitmaps: each sprite is drawn once and kept as a PNG data URL, so a burst of 12 floating images costs nothing.
// ---------------------------------------------------------------------
const MARGIN = 8; // units of empty space around the 100 x 100 art, for the soft shadow
const urls = new Map();

export function renderSprite(id, px = 128, doc = document) {
    if (!BY_ID.has(id)) return null;
    const art = doc.createElement('canvas');
    art.width = art.height = px;
    const s = px / (100 + MARGIN * 2);
    const c = art.getContext('2d');
    c.setTransform(s, 0, 0, s, MARGIN * s, MARGIN * s);
    drawSprite(c, id);
    const out = doc.createElement('canvas');
    out.width = out.height = px;
    const o = out.getContext('2d');
    o.shadowColor = 'rgba(0,0,0,0.32)';
    o.shadowBlur = px * 0.05;
    o.shadowOffsetY = px * 0.025;
    o.drawImage(art, 0, 0);
    return out;
}

export function spriteURL(id) {
    if (!BY_ID.has(id)) return '';
    let u = urls.get(id);
    if (!u) {
        try { u = renderSprite(id, 128).toDataURL('image/png'); } catch { u = ''; }
        urls.set(id, u);
    }
    return u;
}
