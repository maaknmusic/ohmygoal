// Small SVG charts for the admin dashboard: no library, no network. Everything is built with DOM calls (never innerHTML) and the
// pure parts (scales, formatting, CSV) are exported so they can be tested.
const NS = 'http://www.w3.org/2000/svg';

/** A round maximum for an axis: 1, 2, 5 times a power of ten above the largest value. */
export function niceMax(v) {
    if (!Number.isFinite(v) || v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** Compact numbers for axes and tiles: 1.2k, 3.4M. */
export function compact(n) {
    if (!Number.isFinite(n)) return '0';
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n * 100) / 100);
}

/** Rupees with the Indian grouping: ₹1,23,456. */
export const rupees = n => '₹' + (Number.isFinite(n) ? Math.round(n) : 0).toLocaleString('en-IN');

/** Points of a line for values spread across `w` pixels and scaled to `max` in `h` pixels (y grows downward). */
export function linePoints(values, w, h, max) {
    const n = values.length;
    return values.map((v, i) => [n === 1 ? w / 2 : (i / (n - 1)) * w, h - (Math.max(0, v) / (max || 1)) * h]);
}

/** CSV text for rows (arrays). Quotes, commas, newlines and leading =,+,-,@ (spreadsheet formulas) are made safe. */
export function toCsv(rows) {
    const cell = v => {
        let s = v == null ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const el = (tag, attrs = {}, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
};

export const PALETTE = ['#d9266c', '#6366f1', '#10b981', '#f59e0b', '#38bdf8', '#a855f7'];

/**
 * Bars (stacked) or a line over time.
 * @param {HTMLElement} box   container to fill
 * @param {{labels: string[], series: {name: string, values: number[], color?: string}[], type?: 'bars'|'line', format?: (n:number)=>string}} o
 */
export function timeChart(box, { labels, series, type = 'bars', format = compact }) {
    const W = 640, H = 200, L = 40, B = 24, T = 8, R = 8;
    const w = W - L - R, hh = H - T - B;
    const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
    const max = niceMax(type === 'line' ? Math.max(0, ...series.flatMap(s => s.values)) : Math.max(0, ...totals));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart', preserveAspectRatio: 'xMidYMid meet' });
    svg.appendChild(el('title', {}, series.map(s => s.name).join(', ')));
    for (let i = 0; i <= 4; i++) {
        const y = T + hh - (i / 4) * hh;
        svg.appendChild(el('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid' }));
        svg.appendChild(el('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', class: 'tick' }, format((i / 4) * max)));
    }
    const n = labels.length;
    const step = Math.max(1, Math.ceil(n / 7));
    labels.forEach((lab, i) => { if (i % step === 0 || i === n - 1) svg.appendChild(el('text', { x: L + (n === 1 ? w / 2 : type === 'line' ? (i / (n - 1)) * w : ((i + 0.5) / n) * w), y: H - 6, 'text-anchor': 'middle', class: 'tick' }, lab.slice(5))); });
    series.forEach((s, si) => { s.color ||= PALETTE[si % PALETTE.length]; });
    if (type === 'line') {
        series.forEach(s => {
            const pts = linePoints(s.values, w, hh, max).map(([x, y]) => `${(L + x).toFixed(1)},${(T + y).toFixed(1)}`);
            svg.appendChild(el('polyline', { points: pts.join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }));
            pts.forEach((p, i) => { const [x, y] = p.split(','); const c = el('circle', { cx: x, cy: y, r: 3, fill: s.color }); c.appendChild(el('title', {}, `${labels[i]}: ${format(s.values[i])} ${s.name}`)); svg.appendChild(c); });
        });
    } else {
        const bw = Math.max(2, w / n - 3);
        labels.forEach((lab, i) => {
            let y = T + hh;
            series.forEach(s => {
                const v = Math.max(0, s.values[i] || 0), bh = (v / max) * hh;
                if (bh <= 0) return;
                y -= bh;
                const r = el('rect', { x: (L + (i / n) * w + 1.5).toFixed(1), y: y.toFixed(1), width: bw.toFixed(1), height: bh.toFixed(1), fill: s.color, rx: 2 });
                r.appendChild(el('title', {}, `${lab}: ${format(v)} ${s.name}`));
                svg.appendChild(r);
            });
        });
    }
    const legend = document.createElement('div');
    legend.className = 'legend';
    for (const s of series) { const i = document.createElement('span'); const dot = document.createElement('i'); dot.style.background = s.color; i.append(dot, document.createTextNode(s.name)); legend.appendChild(i); }
    box.replaceChildren(svg, ...(series.length > 1 ? [legend] : []));
}

/** Horizontal bars for a few labelled numbers. */
export function barList(box, items, { format = compact } = {}) {
    const rows = items.filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    if (!rows.length) { const p = document.createElement('p'); p.className = 'help'; p.textContent = 'Nothing yet.'; box.replaceChildren(p); return; }
    const max = Math.max(...rows.map(x => x.value));
    box.replaceChildren(...rows.map((x, i) => {
        const row = document.createElement('div'); row.className = 'bar-row';
        const name = document.createElement('span'); name.className = 'bar-name'; name.textContent = x.label;
        const track = document.createElement('span'); track.className = 'bar-track';
        const fill = document.createElement('i'); fill.style.width = `${Math.max(3, (x.value / max) * 100)}%`; fill.style.background = PALETTE[i % PALETTE.length];
        track.appendChild(fill);
        const val = document.createElement('b'); val.textContent = format(x.value);
        row.append(name, track, val);
        return row;
    }));
}
