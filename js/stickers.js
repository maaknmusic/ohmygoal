// Stickers and gifts: ORIGINAL artwork drawn in code (Canvas 2D), like the reactions. No emoji glyphs, no image files, nothing copied.
// Stickers are free and are sent as a chat message. Gifts are the same kind of picture that costs coins (bought with the payment
// system; see functions/wallet.js, which holds the real prices): the sender's coins are spent on the server, then a {t:'gift'}
// message makes the picture float over the other person's screen and stays in the chat.
//
// Wire protocol:  { t: 'sticker', id }   and   { t: 'gift', id }
import { TAU, rng } from './mask-kit.js';

/** Free stickers. */
export const STICKERS = Object.freeze([
    { id: 'chai', label: 'Chai?' }, { id: 'bat', label: 'Howzat' }, { id: 'notes', label: 'Music' }, { id: 'samosa', label: 'Samosa' },
    { id: 'kite', label: 'Kite' }, { id: 'diya', label: 'Diya' }, { id: 'moon', label: 'Night' }, { id: 'sun', label: 'Sunshine' },
].map(Object.freeze));

/** Gifts and their price in coins. functions/gifts.js has the same table; a test keeps the two equal. */
export const GIFTS = Object.freeze([
    { id: 'rose', label: 'Rose', coins: 5 }, { id: 'giftbox', label: 'Gift box', coins: 8 }, { id: 'cake', label: 'Cake', coins: 10 },
    { id: 'trophy', label: 'Trophy', coins: 15 }, { id: 'rocket', label: 'Rocket', coins: 20 }, { id: 'crown', label: 'Crown', coins: 30 },
    { id: 'ring', label: 'Ring', coins: 40 }, { id: 'fireworks', label: 'Fireworks', coins: 50 },
].map(Object.freeze));

const STICKER_IDS = new Map(STICKERS.map(s => [s.id, s]));
const GIFT_IDS = new Map(GIFTS.map(g => [g.id, g]));
export const stickerById = id => STICKER_IDS.get(id) || null;
export const giftById = id => GIFT_IDS.get(id) || null;

/** A validated sticker or gift message from the other person, or null. */
export function parseSticker(msg) { return msg && typeof msg === 'object' && typeof msg.id === 'string' && STICKER_IDS.has(msg.id) ? { id: msg.id } : null; }
export function parseGift(msg) { return msg && typeof msg === 'object' && typeof msg.id === 'string' && GIFT_IDS.has(msg.id) ? { id: msg.id } : null; }

const lin = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); for (const [p, col] of stops) g.addColorStop(p, col); return g; };
const rad = (c, x0, y0, r0, x1, y1, r1, stops) => { const g = c.createRadialGradient(x0, y0, r0, x1, y1, r1); for (const [p, col] of stops) g.addColorStop(p, col); return g; };
function spark(c, x, y, r, fill = '#fff') {
    c.fillStyle = fill; c.beginPath();
    c.moveTo(x, y - r); c.quadraticCurveTo(x + r * 0.12, y - r * 0.12, x + r, y); c.quadraticCurveTo(x + r * 0.12, y + r * 0.12, x, y + r);
    c.quadraticCurveTo(x - r * 0.12, y + r * 0.12, x - r, y); c.quadraticCurveTo(x - r * 0.12, y - r * 0.12, x, y - r); c.fill();
}
const fillStroke = (c, fill, stroke, w = 2.4) => { c.fillStyle = fill; c.fill(); c.lineWidth = w; c.strokeStyle = stroke; c.stroke(); };

const ART = {
    chai(c) {
        c.strokeStyle = 'rgba(160,160,180,0.9)'; c.lineWidth = 3.4; c.lineCap = 'round';
        for (const x of [38, 52, 66]) { c.beginPath(); c.moveTo(x, 36); c.bezierCurveTo(x - 8, 28, x + 8, 20, x, 10); c.stroke(); }
        c.beginPath(); c.moveTo(22, 44); c.lineTo(78, 44); c.lineTo(70, 84); c.quadraticCurveTo(50, 92, 30, 84); c.closePath();
        fillStroke(c, lin(c, 0, 44, 0, 90, [[0, '#d98a4e'], [1, '#a35a2a']]), '#6e3a18');
        c.fillStyle = '#e9b27a'; c.beginPath(); c.ellipse(50, 44, 28, 6, 0, 0, TAU); c.fill(); c.strokeStyle = '#6e3a18'; c.lineWidth = 2.4; c.stroke();
        c.fillStyle = '#7a4a2a'; c.beginPath(); c.ellipse(50, 45, 24, 4, 0, 0, TAU); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.28)'; c.beginPath(); c.ellipse(36, 66, 4, 12, 0.2, 0, TAU); c.fill();
    },
    bat(c) {
        c.save(); c.translate(50, 50); c.rotate(0.7);
        c.beginPath(); c.roundRect(-5, -44, 10, 34, 4); fillStroke(c, '#2a2a3a', '#111', 2);
        c.beginPath(); c.roundRect(-14, -14, 28, 62, 8); fillStroke(c, lin(c, -14, 0, 14, 0, [[0, '#f1cf8e'], [0.5, '#e3b76a'], [1, '#c58f45']]), '#7a5222');
        c.strokeStyle = 'rgba(122,82,34,0.5)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-4, -8); c.lineTo(-4, 44); c.moveTo(4, -8); c.lineTo(4, 44); c.stroke();
        c.restore();
        c.beginPath(); c.arc(76, 78, 13, 0, TAU); fillStroke(c, rad(c, 72, 73, 2, 76, 78, 14, [[0, '#ff6a5a'], [1, '#c61f1f']]), '#7a0f0f');
        c.strokeStyle = '#fff'; c.lineWidth = 1.6; c.beginPath(); c.arc(76, 78, 8, 0.6, 2.4); c.stroke();
    },
    notes(c) {
        const note = (x, y) => { c.beginPath(); c.ellipse(x, y, 10, 7.5, -0.4, 0, TAU); c.fillStyle = '#6a3fe0'; c.fill(); };
        note(32, 74); note(68, 66);
        c.strokeStyle = '#6a3fe0'; c.lineWidth = 4.4; c.lineCap = 'round';
        c.beginPath(); c.moveTo(40, 72); c.lineTo(40, 26); c.moveTo(76, 64); c.lineTo(76, 18); c.stroke();
        c.beginPath(); c.moveTo(38, 28); c.lineTo(78, 18); c.lineTo(78, 32); c.lineTo(38, 42); c.closePath(); fillStroke(c, lin(c, 38, 20, 78, 40, [[0, '#ff4d9a'], [1, '#8a4ef0']]), '#4a24b0', 2);
        spark(c, 14, 30, 6, '#ffd23a'); spark(c, 88, 52, 5, '#fff');
    },
    samosa(c) {
        c.beginPath(); c.moveTo(50, 12); c.bezierCurveTo(58, 40, 80, 62, 92, 80); c.quadraticCurveTo(50, 94, 8, 80); c.bezierCurveTo(22, 62, 42, 40, 50, 12);
        fillStroke(c, lin(c, 0, 12, 0, 90, [[0, '#f3c46a'], [1, '#c8812c']]), '#8a4f12');
        c.strokeStyle = 'rgba(138,79,18,0.55)'; c.lineWidth = 2; c.lineCap = 'round';
        for (let i = 0; i < 7; i++) { c.beginPath(); c.moveTo(24 + i * 8.5, 80); c.quadraticCurveTo(26 + i * 8, 74, 24 + i * 8.5, 68); c.stroke(); }
        const r = rng(3); c.fillStyle = 'rgba(138,79,18,0.5)';
        for (let i = 0; i < 14; i++) { c.beginPath(); c.arc(32 + r() * 36, 46 + r() * 26, 1.7, 0, TAU); c.fill(); }
        c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath(); c.ellipse(44, 44, 4, 14, 0.45, 0, TAU); c.fill();
    },
    kite(c) {
        const q = (pts, fill) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fillStyle = fill; c.fill(); };
        q([[50, 6], [82, 38], [50, 62], [18, 38]], '#ff4d6d'); q([[50, 6], [82, 38], [50, 38]], '#ffb02e'); q([[18, 38], [50, 62], [50, 38]], '#2fa8ff');
        c.lineJoin = 'round'; c.lineWidth = 2.4; c.strokeStyle = '#7a1a30'; c.beginPath(); c.moveTo(50, 6); c.lineTo(82, 38); c.lineTo(50, 62); c.lineTo(18, 38); c.closePath(); c.stroke();
        c.beginPath(); c.moveTo(50, 6); c.lineTo(50, 62); c.moveTo(18, 38); c.lineTo(82, 38); c.stroke();
        c.strokeStyle = '#7a1a30'; c.lineWidth = 2.2; c.lineCap = 'round'; c.beginPath(); c.moveTo(50, 62); c.bezierCurveTo(40, 72, 62, 80, 50, 94); c.stroke();
        for (const [x, y, col] of [[46, 74, '#ffd23a'], [54, 84, '#38c6ff']]) { c.fillStyle = col; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 7, y - 4); c.lineTo(x - 7, y + 4); c.closePath(); c.fill(); }
    },
    diya(c) {
        c.beginPath(); c.moveTo(14, 58); c.bezierCurveTo(14, 84, 86, 84, 86, 58); c.quadraticCurveTo(50, 70, 14, 58); fillStroke(c, lin(c, 0, 58, 0, 84, [[0, '#d9772f'], [1, '#9a4a14']]), '#5e2c08');
        c.beginPath(); c.ellipse(50, 58, 36, 7, 0, 0, TAU); fillStroke(c, '#f0a45a', '#5e2c08');
        c.beginPath(); c.moveTo(50, 8); c.bezierCurveTo(62, 24, 66, 38, 50, 54); c.bezierCurveTo(34, 38, 38, 24, 50, 8); fillStroke(c, lin(c, 0, 8, 0, 54, [[0, '#ffd23a'], [1, '#ff6a1f']]), '#b83a0a', 2);
        c.beginPath(); c.moveTo(50, 28); c.bezierCurveTo(56, 38, 56, 46, 50, 52); c.bezierCurveTo(44, 46, 44, 38, 50, 28); c.fillStyle = '#fff6c0'; c.fill();
        spark(c, 82, 22, 6, '#ffe9a0'); spark(c, 18, 30, 5, '#ffd07a');
    },
    moon(c) {
        c.beginPath(); c.arc(50, 50, 38, 0.5, Math.PI * 2 - 0.5); c.arc(66, 46, 30, Math.PI * 2 - 0.9, 0.9, true); c.closePath();
        fillStroke(c, lin(c, 20, 10, 70, 90, [[0, '#fff3b0'], [1, '#f2b84a']]), '#b8801a');
        spark(c, 74, 26, 8, '#fff6c0'); spark(c, 84, 62, 5, '#fff'); spark(c, 62, 84, 6, '#ffe9a0');
    },
    sun(c) {
        c.strokeStyle = '#ffa31f'; c.lineWidth = 5; c.lineCap = 'round';
        for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; c.beginPath(); c.moveTo(50 + Math.cos(a) * 33, 50 + Math.sin(a) * 33); c.lineTo(50 + Math.cos(a) * 44, 50 + Math.sin(a) * 44); c.stroke(); }
        c.beginPath(); c.arc(50, 50, 27, 0, TAU); fillStroke(c, rad(c, 42, 40, 2, 50, 50, 30, [[0, '#fff3a0'], [0.6, '#ffc21f'], [1, '#ff8a1f']]), '#c26a0a');
        c.fillStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.ellipse(41, 38, 8, 4, -0.6, 0, TAU); c.fill();
    },
    rose(c) {
        c.strokeStyle = '#2e8a4a'; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(50, 52); c.bezierCurveTo(46, 70, 54, 82, 50, 96); c.stroke();
        for (const [x, y, s] of [[54, 76, 1], [46, 66, -1]]) { c.save(); c.translate(x, y); c.scale(s, 1); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(18, -10, 24, 4); c.quadraticCurveTo(10, 14, 0, 0); fillStroke(c, '#3fae5f', '#1e6a38', 1.6); c.restore(); }
        c.beginPath(); c.moveTo(50, 54); c.bezierCurveTo(22, 52, 18, 20, 50, 10); c.bezierCurveTo(82, 20, 78, 52, 50, 54); fillStroke(c, rad(c, 44, 28, 2, 50, 34, 30, [[0, '#ff6a7a'], [0.6, '#e01e4a'], [1, '#a0102e']]), '#6e0a1e');
        c.strokeStyle = 'rgba(110,10,30,0.7)'; c.lineWidth = 2.2; c.beginPath(); c.arc(50, 30, 9, 0.3, 5); c.moveTo(38, 22); c.quadraticCurveTo(50, 14, 62, 22); c.stroke();
        spark(c, 80, 14, 6, '#fff');
    },
    giftbox(c) {
        c.beginPath(); c.roundRect(14, 42, 72, 46, 6); fillStroke(c, lin(c, 0, 42, 0, 88, [[0, '#7a5cff'], [1, '#4a2fc8']]), '#2a1a7a');
        c.beginPath(); c.roundRect(10, 30, 80, 16, 5); fillStroke(c, lin(c, 0, 30, 0, 46, [[0, '#9a82ff'], [1, '#6a4aef']]), '#2a1a7a');
        c.fillStyle = '#ffd23a'; c.fillRect(44, 30, 12, 58); c.strokeStyle = '#b8801a'; c.lineWidth = 1.6; c.strokeRect(44, 30, 12, 58);
        for (const s of [-1, 1]) { c.save(); c.translate(50, 30); c.scale(s, 1); c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(8, -26, 30, -22, 24, -6); c.bezierCurveTo(20, 4, 8, 4, 0, 0); fillStroke(c, '#ffc21f', '#b8801a', 2); c.restore(); }
        c.beginPath(); c.arc(50, 28, 6, 0, TAU); fillStroke(c, '#ffd23a', '#b8801a', 2);
    },
    cake(c) {
        c.beginPath(); c.roundRect(12, 60, 76, 28, 6); fillStroke(c, lin(c, 0, 60, 0, 88, [[0, '#ffb3c6'], [1, '#ff7a9a']]), '#a83a5a');
        c.beginPath(); c.roundRect(24, 38, 52, 26, 6); fillStroke(c, lin(c, 0, 38, 0, 64, [[0, '#fff0f5'], [1, '#ffc6d6']]), '#a83a5a');
        c.fillStyle = '#fff'; c.beginPath(); c.moveTo(12, 62); for (let x = 12; x <= 88; x += 12) c.quadraticCurveTo(x + 6, 76, x + 12, 62); c.lineTo(88, 60); c.lineTo(12, 60); c.closePath(); c.fill();
        c.strokeStyle = '#a83a5a'; c.lineWidth = 2; c.stroke();
        c.fillStyle = '#7a4a2a'; c.beginPath(); c.moveTo(24, 40); for (let x = 24; x <= 76; x += 13) c.quadraticCurveTo(x + 6, 52, x + 13, 40); c.lineTo(76, 38); c.lineTo(24, 38); c.closePath(); c.fill();
        c.fillStyle = '#38c6ff'; c.fillRect(46, 20, 8, 20); c.fillStyle = '#fff'; c.fillRect(46, 26, 8, 3); c.fillRect(46, 33, 8, 3);
        c.beginPath(); c.moveTo(50, 6); c.bezierCurveTo(57, 12, 57, 18, 50, 21); c.bezierCurveTo(43, 18, 43, 12, 50, 6); c.fillStyle = '#ffb02e'; c.fill();
        for (const [x, y, col] of [[22, 74, '#ffd23a'], [40, 78, '#38c6ff'], [60, 74, '#7a5cff'], [78, 78, '#2ecf7a']]) { c.fillStyle = col; c.beginPath(); c.arc(x, y, 3, 0, TAU); c.fill(); }
    },
    trophy(c) {
        c.strokeStyle = '#d99a1a'; c.lineWidth = 6; c.lineCap = 'round';
        c.beginPath(); c.moveTo(26, 24); c.bezierCurveTo(6, 22, 8, 50, 30, 52); c.moveTo(74, 24); c.bezierCurveTo(94, 22, 92, 50, 70, 52); c.stroke();
        c.beginPath(); c.moveTo(24, 14); c.lineTo(76, 14); c.bezierCurveTo(76, 52, 64, 62, 50, 62); c.bezierCurveTo(36, 62, 24, 52, 24, 14);
        fillStroke(c, lin(c, 24, 14, 76, 62, [[0, '#ffe27a'], [0.5, '#ffc21f'], [1, '#e08f12']]), '#a8650a');
        c.fillStyle = 'rgba(255,255,255,0.45)'; c.beginPath(); c.ellipse(36, 32, 4, 14, 0.15, 0, TAU); c.fill();
        c.fillStyle = '#e09a1a'; c.fillRect(44, 62, 12, 14); c.beginPath(); c.roundRect(30, 76, 40, 12, 4); fillStroke(c, lin(c, 0, 76, 0, 88, [[0, '#8a5a2a'], [1, '#5a3412']]), '#3a200a', 2);
        spark(c, 50, 36, 7, '#fff');
    },
    rocket(c) {
        c.beginPath(); c.moveTo(50, 90); c.bezierCurveTo(38, 82, 36, 92, 50, 100); c.bezierCurveTo(64, 92, 62, 82, 50, 90); c.fillStyle = '#ff8a1f'; c.fill();
        c.beginPath(); c.moveTo(50, 70); c.bezierCurveTo(40, 80, 44, 94, 50, 98); c.bezierCurveTo(56, 94, 60, 80, 50, 70); c.fillStyle = '#ffe45a'; c.fill();
        for (const s of [-1, 1]) { c.save(); c.translate(50, 60); c.scale(s, 1); c.beginPath(); c.moveTo(12, -6); c.lineTo(30, 14); c.lineTo(28, 24); c.lineTo(12, 18); c.closePath(); fillStroke(c, '#e0304a', '#7a1020', 2); c.restore(); }
        c.beginPath(); c.moveTo(50, 4); c.bezierCurveTo(70, 22, 70, 52, 62, 76); c.lineTo(38, 76); c.bezierCurveTo(30, 52, 30, 22, 50, 4); fillStroke(c, lin(c, 30, 0, 70, 0, [[0, '#cfd6e8'], [0.5, '#ffffff'], [1, '#aab4cc']]), '#5a6482');
        c.beginPath(); c.moveTo(50, 4); c.bezierCurveTo(60, 12, 64, 22, 64, 30); c.lineTo(36, 30); c.bezierCurveTo(36, 22, 40, 12, 50, 4); c.fillStyle = '#e0304a'; c.fill();
        c.beginPath(); c.arc(50, 46, 9, 0, TAU); fillStroke(c, rad(c, 47, 43, 1, 50, 46, 10, [[0, '#cfeeff'], [1, '#2f78d0']]), '#2a3c6a');
        spark(c, 84, 20, 6, '#fff'); spark(c, 14, 50, 5, '#ffe9a0');
    },
    crown(c) {
        c.beginPath(); c.moveTo(10, 76); c.lineTo(6, 28); c.lineTo(32, 50); c.lineTo(50, 16); c.lineTo(68, 50); c.lineTo(94, 28); c.lineTo(90, 76); c.closePath();
        c.lineJoin = 'round'; fillStroke(c, lin(c, 0, 16, 0, 76, [[0, '#ffe27a'], [0.6, '#ffc21f'], [1, '#e08f12']]), '#a8650a', 3);
        c.beginPath(); c.roundRect(8, 72, 84, 14, 5); fillStroke(c, lin(c, 0, 72, 0, 86, [[0, '#ffd23a'], [1, '#d98a12']]), '#a8650a', 2.4);
        for (const [x, y, col] of [[50, 54, '#e0304a'], [28, 62, '#2fa8ff'], [72, 62, '#2ecf7a']]) { c.beginPath(); c.arc(x, y, 6, 0, TAU); fillStroke(c, col, 'rgba(0,0,0,0.35)', 1.6); }
        for (const [x, y] of [[6, 26], [50, 14], [94, 26]]) { c.beginPath(); c.arc(x, y, 5, 0, TAU); fillStroke(c, '#fff3b0', '#a8650a', 2); }
        spark(c, 36, 38, 5, '#fff');
    },
    ring(c) {
        c.beginPath(); c.arc(50, 64, 26, 0, TAU); c.lineWidth = 9; c.strokeStyle = '#a8650a'; c.stroke(); c.lineWidth = 6; c.strokeStyle = lin(c, 24, 40, 76, 90, [[0, '#fff0a0'], [0.5, '#ffc21f'], [1, '#d98a12']]); c.stroke();
        c.beginPath(); c.moveTo(34, 22); c.lineTo(66, 22); c.lineTo(76, 36); c.lineTo(50, 52); c.lineTo(24, 36); c.closePath();
        c.lineJoin = 'round'; fillStroke(c, lin(c, 24, 22, 76, 52, [[0, '#d8f6ff'], [0.5, '#7fd0ff'], [1, '#3a8be0']]), '#1f5fb8', 2.4);
        c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(24, 36); c.lineTo(76, 36); c.moveTo(42, 22); c.lineTo(36, 36); c.lineTo(50, 52); c.lineTo(64, 36); c.lineTo(58, 22); c.stroke();
        spark(c, 30, 12, 7, '#fff'); spark(c, 84, 26, 5, '#cfeeff');
    },
    fireworks(c) {
        const burst = (x, y, r, cols, seed) => {
            const g = rng(seed); c.lineCap = 'round';
            for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + g() * 0.2; c.strokeStyle = cols[i % cols.length]; c.lineWidth = 3.4; c.beginPath(); c.moveTo(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.35); c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); c.stroke(); c.fillStyle = cols[i % cols.length]; c.beginPath(); c.arc(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5), 2.6, 0, TAU); c.fill(); }
        };
        burst(34, 36, 22, ['#ff4d6d', '#ffd23a', '#fff'], 1); burst(70, 30, 18, ['#38c6ff', '#7a5cff', '#fff'], 2); burst(58, 70, 20, ['#2ecf7a', '#ffb02e', '#ff4d9a'], 3);
        c.strokeStyle = 'rgba(255,210,120,0.8)'; c.lineWidth = 3; c.setLineDash([3, 5]); c.beginPath(); c.moveTo(20, 96); c.quadraticCurveTo(26, 70, 34, 40); c.stroke(); c.setLineDash([]);
        spark(c, 86, 62, 6, '#fff'); spark(c, 16, 70, 5, '#ffe9a0');
    },
};

const MARGIN = 10;
const urls = new Map();

/** Draws one sticker or gift into a 100 x 100 box at the context's current transform. */
export function drawSticker(c, id) {
    const art = ART[id];
    if (!art || !(STICKER_IDS.has(id) || GIFT_IDS.has(id))) return false;
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; art(c); c.restore();
    return true;
}

/** The picture with a white sticker edge and a soft shadow, as a canvas. */
export function renderSticker(id, px = 160, doc = document) {
    if (!STICKER_IDS.has(id) && !GIFT_IDS.has(id)) return null;
    const s = px / (100 + MARGIN * 2);
    const make = () => { const k = doc.createElement('canvas'); k.width = k.height = px; return k; };
    const art = make(); const ac = art.getContext('2d');
    ac.setTransform(s, 0, 0, s, MARGIN * s, MARGIN * s);
    drawSticker(ac, id);
    // the white edge: the picture's silhouette drawn all around it, then the picture on top
    const edge = make(); const ec = edge.getContext('2d');
    const r = 3.2 * s;
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; ec.drawImage(art, Math.cos(a) * r, Math.sin(a) * r); }
    ec.globalCompositeOperation = 'source-in'; ec.fillStyle = '#fff'; ec.fillRect(0, 0, px, px);
    ec.globalCompositeOperation = 'source-over'; ec.drawImage(art, 0, 0);
    const out = make(); const oc = out.getContext('2d');
    oc.shadowColor = 'rgba(0,0,0,0.3)'; oc.shadowBlur = px * 0.045; oc.shadowOffsetY = px * 0.02;
    oc.drawImage(edge, 0, 0);
    return out;
}

export function stickerURL(id) {
    if (!STICKER_IDS.has(id) && !GIFT_IDS.has(id)) return '';
    let u = urls.get(id);
    if (!u) { try { u = renderSticker(id).toDataURL('image/png'); } catch { u = ''; } urls.set(id, u); }
    return u;
}
