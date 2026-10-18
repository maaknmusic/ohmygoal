// =====================================================================
// Opt-in "roughly how far apart are we" for two chat partners, privacy first.
// A position is snapped to a coarse grid cell on the person's own device and
// the raw coordinates are dropped on the spot. Only the integer cell indices
// are ever shared (straight to the chat partner, and only when both opted in),
// distances are measured between cell centres, and the app only ever shows
// them as coarse bands (describeDistance). Exact distances between strangers
// would let anyone pin down a home address with a few spoofed positions.
// Pure functions, except getApproxCell, which asks the browser for a position
// (injectable for tests). Nothing here stores, logs or returns raw
// coordinates, and error messages never contain the values that caused them.
// =====================================================================

export const DEFAULT_CELL_DEG = 0.05; // about 5.5 km north-south
export const MIN_CELL_DEG = 0.01; // about 1.1 km; a finer grid stops being "approximate", so it is refused

const EARTH_RADIUS_KM = 6371.0088;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_AGE_MS = 600000; // a fix up to 10 minutes old is fine, and it saves battery

// ---------- the grid ----------

/** Cells across (w) and down (h); throws RangeError for a cell size that is not allowed. */
function gridSize(cellDeg) {
    if (typeof cellDeg !== 'number' || !(cellDeg >= MIN_CELL_DEG && cellDeg <= 180)) throw new RangeError('cell size out of range');
    // The tiny allowance stops floating-point noise turning 360 / 0.05 into 7201 cells.
    return { w: Math.ceil(360 / cellDeg - 1e-9), h: Math.ceil(180 / cellDeg - 1e-9) };
}

const within = (v, limit) => typeof v === 'number' && v >= -limit && v <= limit; // false for NaN and Infinity
const isIndex = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

/**
 * The cell { x, y } that contains a position (x counts from 180 W, y from the south pole).
 * Lat 90 and lon 180 fall in the last cell. Throws RangeError for anything not a finite,
 * in-range number; the message never repeats the value.
 */
export function snapToCell(lat, lon, cellDeg = DEFAULT_CELL_DEG) {
    const { w, h } = gridSize(cellDeg);
    if (!within(lat, 90) || !within(lon, 180)) throw new RangeError('coordinates out of range');
    return {
        x: Math.min(w - 1, Math.floor((lon + 180) / cellDeg)),
        y: Math.min(h - 1, Math.floor((lat + 90) / cellDeg)),
    };
}

/** Middle of cell i along an axis `span` degrees long (the last cell is cut short if the grid does not divide evenly). */
function middle(i, cellDeg, span) {
    const lo = i * cellDeg;
    return (lo + Math.min(span, lo + cellDeg)) / 2;
}

/** The { lat, lon } centre of a cell. Throws RangeError for a cell that is not on the grid. */
export function cellCenter(cell, cellDeg = DEFAULT_CELL_DEG) {
    gridSize(cellDeg);
    if (!isValidCell(cell, cellDeg)) throw new RangeError('not a valid cell');
    return { lat: middle(cell.y, cellDeg, 180) - 90, lon: middle(cell.x, cellDeg, 360) - 180 };
}

// ---------- validating what a peer sends ----------

const isPlainObject = o => {
    if (typeof o !== 'object' || o === null) return false;
    const proto = Object.getPrototypeOf(o);
    return proto === Object.prototype || proto === null;
};

/** The own data values of `obj`, in the order of `names`, when its keys are exactly `names`; else null. Never calls a getter, never throws. */
function exactValues(obj, names) {
    try {
        if (!isPlainObject(obj)) return null;
        const keys = Reflect.ownKeys(obj); // includes symbols and non-enumerable keys, so no extras can hide
        if (keys.length !== names.length) return null;
        const values = [];
        for (const name of names) {
            const d = Object.getOwnPropertyDescriptor(obj, name);
            if (!d || !d.enumerable || !('value' in d)) return null;
            values.push(d.value);
        }
        return values;
    } catch {
        return null;
    }
}

/** True only for a plain { x, y } of integers inside the grid for that cell size; never throws. */
export function isValidCell(c, cellDeg = DEFAULT_CELL_DEG) {
    try {
        const { w, h } = gridSize(cellDeg);
        const v = exactValues(c, ['x', 'y']);
        return v !== null && isIndex(v[0], w) && isIndex(v[1], h);
    } catch {
        return false;
    }
}

/** The cell from a peer message { t: 'loc', x, y }, or null. Exactly those keys; never throws. */
export function parseLocMessage(msg, cellDeg = DEFAULT_CELL_DEG) {
    const v = exactValues(msg, ['t', 'x', 'y']);
    if (!v || v[0] !== 'loc') return null;
    const cell = { x: v[1], y: v[2] };
    return isValidCell(cell, cellDeg) ? { x: cell.x + 0, y: cell.y + 0 } : null; // + 0 turns -0 into 0
}

/**
 * The message to send the chat partner: { t: 'loc', x, y }. Copies only x and y. A cell that is
 * not exactly { x, y } of non-negative integers throws RangeError instead of being sent
 * (so a cell that somehow carries coordinates never goes out); the grid bounds are the receiver's check.
 */
export function locMessage(cell) {
    const v = exactValues(cell, ['x', 'y']);
    if (!v || !isIndex(v[0], Infinity) || !isIndex(v[1], Infinity)) throw new RangeError('not a cell');
    return { t: 'loc', x: v[0] + 0, y: v[1] + 0 };
}

// ---------- distance ----------

const toRad = deg => deg * Math.PI / 180;
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Great-circle (haversine) distance in km between two { lat, lon }; NaN if a coordinate is not a finite number. */
export function distanceKm(a, b) {
    if (!isNum(a?.lat) || !isNum(a?.lon) || !isNum(b?.lat) || !isNum(b?.lon)) return NaN;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    const s = Math.min(1, Math.max(0, h)); // rounding can push h just outside 0..1 (near the antipode)
    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Distance in km between the centres of two cells (throws RangeError for a cell that is not on the grid). */
export function distanceBetweenCells(cellA, cellB, cellDeg = DEFAULT_CELL_DEG) {
    return distanceKm(cellCenter(cellA, cellDeg), cellCenter(cellB, cellDeg));
}

// ---------- coarse bands ----------

const LIMITS = [10, 25, 50, 100, 250]; // upper edges (exclusive) of the fixed bands
const MAX_KM = 40100; // longer than the Earth is round, so not a distance

const TEXT = {
    en: {
        bands: ['Nearby (within 10 km)', '10–25 km away', '25–50 km away', '50–100 km away', '100–250 km away'],
        about: n => `about ${n} km away`,
    },
    hi: {
        bands: ['आस-पास (10 किमी के अंदर)', '10–25 किमी दूर', '25–50 किमी दूर', '50–100 किमी दूर', '100–250 किमी दूर'],
        about: n => `लगभग ${n} किमी दूर`,
    },
};

const group = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); // 1200 -> '1,200'

/**
 * A short phrase for a distance, in coarse bands only: under 10 / 25 / 50 / 100 / 250 km a fixed
 * band, then "about N km" with N rounded to 50 km (below 1000) or 100 km. '' for anything that is
 * not a plausible distance. lang is 'en' (default) or 'hi'; anything else is English.
 */
export function describeDistance(km, lang = 'en') {
    if (typeof km !== 'number' || !Number.isFinite(km) || km < 0 || km > MAX_KM) return '';
    const text = typeof lang === 'string' && /^hi(?:[-_]|$)/i.test(lang) ? TEXT.hi : TEXT.en;
    const band = LIMITS.findIndex(limit => km < limit);
    if (band >= 0) return text.bands[band];
    const step = km < 1000 ? 50 : 100;
    return text.about(group(Math.round(km / step) * step));
}

// ---------- asking the browser ----------

const FAILURES = {
    unsupported: 'Location is not supported here',
    denied: 'Location permission was denied',
    unavailable: 'Location is unavailable',
    timeout: 'Location request timed out',
};

function failure(code) {
    const err = new Error(FAILURES[code]);
    err.code = code;
    return err;
}

/** GeolocationPositionError.code: 1 permission denied, 2 position unavailable, 3 timeout. */
function failureCode(error) {
    switch (error?.code) {
        case 1: return 'denied';
        case 3: return 'timeout';
        default: return 'unavailable';
    }
}

/**
 * The cell the person is in, from one low-accuracy browser position fix. The raw coordinates are
 * snapped inside the success callback and go no further: the Promise resolves with { x, y } only.
 * Rejects with an Error whose code is 'unsupported', 'denied', 'unavailable' or 'timeout'
 * (a bad cellDeg rejects with a RangeError instead, before anyone is asked for permission).
 * The browser's own timeout does not run while the permission prompt is open.
 */
export function getApproxCell({ cellDeg = DEFAULT_CELL_DEG, timeoutMs = DEFAULT_TIMEOUT_MS, geolocation = globalThis.navigator?.geolocation } = {}) {
    return new Promise((resolve, reject) => {
        gridSize(cellDeg); // throws inside the executor, which rejects the Promise
        if (typeof geolocation?.getCurrentPosition !== 'function') {
            reject(failure('unsupported'));
            return;
        }
        const onPosition = position => {
            try {
                resolve(snapToCell(position.coords.latitude, position.coords.longitude, cellDeg));
            } catch {
                reject(failure('unavailable')); // an unusable fix; nothing from it is kept
            }
        };
        const onError = error => reject(failure(failureCode(error)));
        const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
        try {
            geolocation.getCurrentPosition(onPosition, onError, { enableHighAccuracy: false, maximumAge: MAX_AGE_MS, timeout });
        } catch {
            reject(failure('unavailable'));
        }
    });
}
