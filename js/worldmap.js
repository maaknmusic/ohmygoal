// =====================================================================
// Live world map: a spinning globe (MapLibre on OpenStreetMap) with glowing bubbles where people are online.
//
// Privacy first, and nothing here can change that:
//  - Nobody is on the map unless they turn on "Show me on the map" (off by default, 18+ and age-checked only).
//  - The phone rounds its position to a square of MAP_CELL_DEG degrees (about 28 km) the moment it is read, and only
//    the square's two numbers leave it (to mapPins/{uid}, which no phone can read).
//  - The server counts the squares (functions/worldmap.js) and publishes only "n people in this square" (counters/map).
//    So the map shows how many people are around a city, never who they are or where exactly.
//  - Turning it off deletes the pin at once. Leaving the page tries to delete it too; either way it stops counting within 6 minutes.
//  - The map does not zoom in past city level.
// Pure helpers first (tests/unit/worldmap.test.mjs), then the view.
// =====================================================================
import { cellCenter } from './location.js';

export const MAP_CELL_DEG = 0.25; // must match functions/worldmap.js
export const GRID_W = 1440;
export const GRID_H = 720;
export const PIN_BEAT_MS = 3 * 60000; // the server counts pins refreshed in the last 6 minutes
export const MAP_STALE_MS = 10 * 60000; // counters/map is rewritten every 2 minutes; older than this, the server job is not running
export const MAX_ZOOM = 9; // about city level: no street view of where people are
const MAX_CELLS = 20000;

const isIndex = (v, max) => Number.isInteger(v) && v >= 0 && v < max;

/** counters/map → { at, total, cells: [{ x, y, n }] }, or null when it is missing, malformed or stale. Never throws. */
export function readMapDoc(d, now = Date.now()) {
    try {
        if (!d || typeof d.at !== 'number' || !(Math.abs(now - d.at) < MAP_STALE_MS) || !Array.isArray(d.c) || d.c.length % 3) return null;
        const cells = [];
        for (let i = 0; i < d.c.length && cells.length < MAX_CELLS; i += 3) {
            const [x, y, n] = [d.c[i], d.c[i + 1], d.c[i + 2]];
            if (isIndex(x, GRID_W) && isIndex(y, GRID_H) && Number.isInteger(n) && n > 0 && n <= 1e6) cells.push({ x, y, n });
        }
        const total = Number.isInteger(d.total) && d.total >= 0 ? d.total : cells.reduce((s, c) => s + c.n, 0);
        return { at: d.at, total, cells };
    } catch {
        return null;
    }
}

/** Add me to my own square for display, when the server has not counted my pin yet (it counts every 2 minutes). */
export function withMe(map, myCell, pinnedAt) {
    if (!myCell || !isIndex(myCell.x, GRID_W) || !isIndex(myCell.y, GRID_H)) return map;
    const base = map || { at: 0, total: 0, cells: [] };
    if (base.at > pinnedAt) return base; // already counted
    const cells = base.cells.map(c => ({ ...c }));
    const mine = cells.find(c => c.x === myCell.x && c.y === myCell.y);
    if (mine) mine.n++; else cells.push({ x: myCell.x, y: myCell.y, n: 1 });
    return { ...base, total: base.total + 1, cells };
}

/** GeoJSON points at the centre of each square, for the map. */
export function toGeoJSON(cells) {
    return {
        type: 'FeatureCollection',
        features: cells.map(c => {
            const { lat, lon } = cellCenter({ x: c.x, y: c.y }, MAP_CELL_DEG);
            return { type: 'Feature', properties: { n: c.n }, geometry: { type: 'Point', coordinates: [lon, lat] } };
        }),
    };
}

export const peopleText = n => (n === 1 ? '1 person online around here' : `About ${n} people online around here`);
export const totalText = n => (n === 1 ? '1 on the map' : `${n} on the map`);

/** Firestore access: write and delete only my own square; read only the published counts. */
export function firestoreMapIo(transport) {
    const { db, fs, base } = transport.fb;
    const pinRef = () => fs.doc(db, ...base, 'mapPins', transport.uid);
    return {
        watch(cb) { return fs.onSnapshot(fs.doc(db, ...base, 'counters', 'map'), s => cb(s.data() || null), () => cb(null)); },
        setPin(cell) { return fs.setDoc(pinRef(), { x: cell.x, y: cell.y, ts: Date.now() }); },
        clearPin() { return fs.deleteDoc(pinRef()); },
    };
}

/** The local demo has no server: the map shows only you. */
export const demoMapIo = () => ({ watch(cb) { cb(null); return () => {}; }, async setPin() {}, async clearPin() {} });

function loadLib(cfg, doc, win) {
    if (win.maplibregl) return Promise.resolve(win.maplibregl);
    return new Promise((resolve, reject) => {
        const css = doc.createElement('link');
        css.rel = 'stylesheet'; css.href = cfg.cssUrl;
        doc.head.appendChild(css);
        const s = doc.createElement('script');
        s.src = cfg.libUrl; s.async = true;
        const timer = setTimeout(() => reject(new Error('timeout')), 20000);
        s.onload = () => { clearTimeout(timer); win.maplibregl ? resolve(win.maplibregl) : reject(new Error('no map')); };
        s.onerror = () => { clearTimeout(timer); reject(new Error('load failed')); };
        doc.head.appendChild(s);
    });
}

/**
 * The map view. getIo() returns the data access (null until the app is connected), getCell() the person's square
 * (asks for location), canShow() a reason they may not be shown (or ''), onTalk() starts a chat.
 */
export function createWorldMap({ cfg, getIo, getCell, canShow, onTalk, toast, store, doc = document, win = window }) {
    const $ = id => doc.getElementById(id);
    const view = $('mapView'), canvas = $('mapCanvas'), msg = $('mapMsg'), totalEl = $('mapTotal'), showMe = $('mapShowMe');
    const reduced = () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let map = null, gl = null, unwatch = null, data = null, ready = false, spin = 0, spun = false, labels = [];
    let myCell = null, pinnedAt = 0, beat = 0, lastFocus = null;

    const say = text => { msg.textContent = text || ''; msg.classList.toggle('hidden', !text); };

    // ---------- being on the map ----------
    async function pin() {
        const io = getIo();
        if (!io || !myCell) return;
        try { await io.setPin(myCell); pinnedAt = Date.now(); render(); } catch (e) { console.warn('map pin failed', e?.code || e); }
    }
    function startBeat() {
        clearInterval(beat);
        pin();
        beat = setInterval(() => { if (doc.visibilityState !== 'hidden') pin(); }, PIN_BEAT_MS);
    }
    function stopBeat() {
        clearInterval(beat); beat = 0;
        const io = getIo();
        if (io) io.clearPin().catch(() => {});
    }
    let request = 0;
    async function setShowMe(on, { quiet = false } = {}) {
        const mine = ++request;
        if (!on) {
            showMe.checked = false; store.set('mapShow', false); myCell = null; pinnedAt = 0; stopBeat(); render();
            if (!quiet) toast('You’re hidden from the map.');
            return false;
        }
        const why = canShow();
        if (why) { showMe.checked = false; if (!quiet) toast(why, true); return false; }
        try {
            const cell = await getCell();
            if (mine !== request) return false; // turned off (or on again) while the position was found
            myCell = cell;
            showMe.checked = true; store.set('mapShow', true);
            startBeat();
            if (!quiet) toast('You’re on the map. Only a count for your area is shown.');
            return true;
        } catch (e) {
            if (mine !== request) return false;
            showMe.checked = false; store.set('mapShow', false);
            if (!quiet) toast(e?.code === 'denied' ? 'Location is blocked. Allow it in your browser settings to show yourself on the map.' : 'Couldn’t find your area right now.', true);
            return false;
        }
    }
    showMe.onchange = () => setShowMe(showMe.checked);
    // Leaving the page takes you off the map straight away; coming back puts you on again.
    win.addEventListener('pagehide', () => { if (beat) getIo()?.clearPin().catch(() => {}); });
    win.addEventListener('pageshow', e => { if (e.persisted && beat) pin(); });

    // ---------- drawing ----------
    function shown() { return myCell ? withMe(data, myCell, pinnedAt) : data; }
    function render() {
        const d = shown();
        totalEl.textContent = d ? totalText(d.total) : '';
        if (!ready) return;
        map.getSource('people').setData(toGeoJSON(d?.cells || []));
        if (d && !d.cells.length && !myCell) say('No one is on the map right now. Turn on “Show me on the map” to be the first.');
        else if (!d && !myCell) say('The map is warming up. People will appear here in a minute or two.');
        else say('');
        setTimeout(drawLabels, 300);
    }
    function onData(raw) { data = readMapDoc(raw); render(); }

    // Numbers on the bubbles (HTML, so no font server is needed).
    function drawLabels() {
        if (!ready) return;
        for (const m of labels) m.remove();
        labels = [];
        const seen = new Set();
        for (const f of map.queryRenderedFeatures({ layers: ['people'] })) {
            const n = f.properties.n;
            const key = f.geometry.coordinates.join(',');
            if (n < 2 || seen.has(key) || labels.length >= 150) continue;
            seen.add(key);
            const node = doc.createElement('div');
            node.className = 'map-count';
            node.textContent = n > 999 ? Math.round(n / 100) / 10 + 'k' : String(n);
            labels.push(new gl.Marker({ element: node }).setLngLat(f.geometry.coordinates).addTo(map));
        }
    }

    function popup(lngLat, n) {
        const box = doc.createElement('div');
        box.className = 'map-pop';
        const p = doc.createElement('p');
        p.textContent = peopleText(n);
        const b = doc.createElement('button');
        b.type = 'button'; b.className = 'map-talk'; b.textContent = 'Talk to someone';
        b.onclick = () => { close(); onTalk(); };
        box.append(p, b);
        new gl.Popup({ closeButton: true, maxWidth: '240px' }).setLngLat(lngLat).setDOMContent(box).addTo(map);
    }

    function spinGlobe() {
        cancelAnimationFrame(spin);
        if (spun || reduced()) return;
        const step = () => {
            if (!map || spun) return;
            if (map.getZoom() < 3) { const c = map.getCenter(); map.jumpTo({ center: [c.lng + 0.04, c.lat] }); }
            spin = requestAnimationFrame(step);
        };
        spin = requestAnimationFrame(step);
    }

    function style() {
        const dark = doc.documentElement.dataset.theme !== 'light';
        return {
            version: 8,
            projection: { type: 'globe' },
            sources: {
                osm: { type: 'raster', tiles: [cfg.tiles], tileSize: 256, maxzoom: 19, attribution: cfg.attribution },
                people: { type: 'geojson', data: toGeoJSON([]), cluster: true, clusterRadius: 44, clusterMaxZoom: MAX_ZOOM - 1, clusterProperties: { n: ['+', ['get', 'n']] } },
            },
            layers: [
                { id: 'bg', type: 'background', paint: { 'background-color': dark ? '#090a12' : '#e9e8f2' } },
                { id: 'osm', type: 'raster', source: 'osm', paint: dark ? { 'raster-brightness-max': 0.62, 'raster-saturation': -0.55, 'raster-contrast': 0.1 } : { 'raster-saturation': -0.2 } },
                { id: 'people-glow', type: 'circle', source: 'people', paint: {
                    'circle-color': '#ff2d7a', 'circle-blur': 1, 'circle-opacity': 0.55,
                    'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'n']], 1, 16, 10, 36, 100, 70] } },
                { id: 'people', type: 'circle', source: 'people', paint: {
                    'circle-color': '#ff2d7a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.95,
                    'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'n']], 1, 5, 10, 14, 100, 26] } },
            ],
        };
    }

    async function build() {
        say('Loading the map…');
        try { gl = await loadLib(cfg, doc, win); } catch { say('Couldn’t load the map. Check your connection and try again.'); return; }
        if (view.classList.contains('hidden')) return;
        map = new gl.Map({
            container: canvas, style: style(), center: [78, 20], zoom: canvas.clientWidth < 600 ? 1.25 : 1.6, minZoom: 0, maxZoom: MAX_ZOOM,
            attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false,
        });
        map.touchZoomRotate.disableRotation();
        win.__worldMap = map; // for tests and debugging
        const stopSpin = () => { spun = true; cancelAnimationFrame(spin); };
        for (const ev of ['mousedown', 'touchstart', 'wheel', 'dragstart']) map.on(ev, stopSpin);
        map.on('load', () => {
            ready = true;
            render();
            spinGlobe();
            if (myCell && !spun) { const { lat, lon } = cellCenter(myCell, MAP_CELL_DEG); map.jumpTo({ center: [lon, Math.max(-60, Math.min(60, lat))] }); }
        });
        map.on('moveend', drawLabels);
        map.on('click', 'people', async e => {
            const f = e.features?.[0];
            if (!f) return;
            const id = f.properties.cluster_id;
            if (id !== undefined && map.getZoom() < MAX_ZOOM - 1) {
                const zoom = await map.getSource('people').getClusterExpansionZoom(id);
                map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom, MAX_ZOOM) });
                return;
            }
            popup(f.geometry.coordinates, f.properties.n);
        });
        map.on('mouseenter', 'people', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'people', () => { map.getCanvas().style.cursor = ''; });
    }

    // ---------- open and close ----------
    function onKey(e) { if (e.key === 'Escape') close(); }
    function open() {
        lastFocus = doc.activeElement;
        view.classList.remove('hidden');
        doc.body.classList.add('map-open');
        doc.addEventListener('keydown', onKey);
        $('mapClose').focus();
        const io = getIo();
        if (!unwatch && io) unwatch = io.watch(onData);
        if (!map) build(); else { map.resize(); render(); spinGlobe(); }
    }
    function close() {
        view.classList.add('hidden');
        doc.body.classList.remove('map-open');
        doc.removeEventListener('keydown', onKey);
        cancelAnimationFrame(spin);
        if (unwatch) { unwatch(); unwatch = null; } // no reads while the map is closed
        lastFocus?.focus?.();
    }
    $('mapClose').onclick = close;

    return {
        open, close, setShowMe,
        /** At start-up: put back someone who chose to be on the map, without prompting (only if location is already allowed). */
        async resume() {
            if (!store.get('mapShow', false)) return;
            const state = await win.navigator?.permissions?.query({ name: 'geolocation' }).then(s => s.state, () => 'prompt');
            if (state === 'granted') setShowMe(true, { quiet: true }); else { store.set('mapShow', false); showMe.checked = false; }
        },
        /** The app has connected: start reading if the map is already open, and put back someone who chose to be on it. */
        connected() {
            if (!view.classList.contains('hidden') && !unwatch && getIo()) unwatch = getIo().watch(onData);
            return this.resume();
        },
        get on() { return !!beat; },
    };
}
