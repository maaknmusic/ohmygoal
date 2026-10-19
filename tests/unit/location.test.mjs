// Tests for js/location.js (opt-in approximate distance between chat partners).
// Run: timeout 60 node --test /tmp/claude-0/-home-user-ohmygoal/80ecaa61-e063-55be-81f7-87bba82dfd45/scratchpad/unit/location.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MODULE_URL = 'file:///home/user/ohmygoal/js/location.js';
const loc = await import(MODULE_URL);
const {
    DEFAULT_CELL_DEG, snapToCell, cellCenter, isValidCell, distanceKm, distanceBetweenCells,
    describeDistance, getApproxCell, parseLocMessage, locMessage,
} = loc;

function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const MUMBAI = { lat: 19.0760, lon: 72.8777 };
const DELHI = { lat: 28.6139, lon: 77.2090 };
const PUNE = { lat: 18.5204, lon: 73.8567 };
const LONDON = { lat: 51.5074, lon: -0.1278 };
const NEW_YORK = { lat: 40.7128, lon: -74.0060 };

const cellOf = (p, deg) => snapToCell(p.lat, p.lon, deg);
const kmBetween = (p, q, deg) => distanceBetweenCells(cellOf(p, deg), cellOf(q, deg), deg);
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected} +-${tol}, got ${actual}`);

// =====================================================================
// API surface
// =====================================================================

describe('module surface', () => {
    test('exports exactly the agreed API', () => {
        assert.deepEqual(Object.keys(loc).sort(), [
            'DEFAULT_CELL_DEG', 'MIN_CELL_DEG', 'cellCenter', 'describeDistance', 'distanceBetweenCells', 'distanceKm',
            'getApproxCell', 'isValidCell', 'locMessage', 'parseLocMessage', 'snapToCell',
        ]);
    });

    test('default cell is 0.05 degrees', () => {
        assert.equal(DEFAULT_CELL_DEG, 0.05);
    });

    test('source has no imports, logging, storage, network or DOM access', () => {
        const src = readFileSync(new URL(MODULE_URL), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
            .replace(/\s\/\/.*$/gm, '');
        assert.doesNotMatch(src, /^\s*import\b/m, 'no imports');
        assert.doesNotMatch(src, /\bconsole\b/, 'no logging');
        assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie|\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|postMessage/, 'no storage or network');
        assert.doesNotMatch(src, /\bdocument\b|\bwindow\b|querySelector|addEventListener/, 'no DOM');
        assert.doesNotMatch(src, /Date\.now|setTimeout|setInterval/, 'no clocks or timers');
        assert.doesNotMatch(src, /\bwatchPosition\b/, 'single fix only, never a watch');
    });
});

// =====================================================================
// snapToCell
// =====================================================================

describe('snapToCell', () => {
    test('floors (lon+180)/cell and (lat+90)/cell', () => {
        assert.deepEqual(snapToCell(0, 0), { x: 3600, y: 1800 });
        assert.deepEqual(snapToCell(MUMBAI.lat, MUMBAI.lon), { x: 5057, y: 2181 });
        assert.deepEqual(snapToCell(-90, -180), { x: 0, y: 0 });
    });

    test('result has exactly the integer keys x and y', () => {
        const c = snapToCell(51.5, -0.12);
        assert.deepEqual(Object.keys(c), ['x', 'y']);
        assert.ok(Number.isInteger(c.x) && Number.isInteger(c.y));
        assert.equal(Object.getPrototypeOf(c), Object.prototype);
    });

    test('lat exactly 90 and lon exactly 180 clamp to the last cell', () => {
        assert.deepEqual(snapToCell(90, 0), { x: 3600, y: 3599 });
        assert.deepEqual(snapToCell(0, 180), { x: 7199, y: 1800 });
        assert.deepEqual(snapToCell(90, 180), { x: 7199, y: 3599 });
        assert.deepEqual(snapToCell(-90, 180), { x: 7199, y: 0 });
        assert.deepEqual(snapToCell(90, -180), { x: 0, y: 3599 });
    });

    test('values a hair inside the edges stay in range', () => {
        assert.deepEqual(snapToCell(89.99999999999999, 179.99999999999997), { x: 7199, y: 3599 });
        assert.deepEqual(snapToCell(-89.99999999999999, -179.99999999999997), { x: 0, y: 0 });
    });

    test('never produces an index outside the grid for any cell size, at the extreme corners', () => {
        for (const deg of [0.01, 0.03, 0.05, 0.07, 0.1, 0.3, 0.5, 1, 3, 7, 10, 45, 90, 180]) {
            const w = Math.ceil(360 / deg - 1e-9);
            const h = Math.ceil(180 / deg - 1e-9);
            for (const [lat, lon] of [[90, 180], [90, -180], [-90, 180], [-90, -180], [0, 0]]) {
                const c = snapToCell(lat, lon, deg);
                assert.ok(c.x >= 0 && c.x < w && c.y >= 0 && c.y < h, `deg ${deg} at ${lat},${lon}`);
                assert.ok(isValidCell(c, deg));
            }
        }
    });

    test('negative zero maps to a normal cell', () => {
        assert.deepEqual(snapToCell(-0, -0), snapToCell(0, 0));
    });

    test('throws RangeError for non-finite, non-number and out-of-range input', () => {
        const bad = [
            [NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity], [90.0000001, 0], [-90.0000001, 0], [0, 180.0000001], [0, -180.0000001],
            ['10', 10], [10, '10'], [null, 0], [0, null], [undefined, 0], [0, undefined], [true, 0], [[], 0], [{}, 0],
            [10n, 0], [new Number(5), 0], [1e308, 0], [0, -1e308], [Symbol.iterator, 0],
        ];
        for (const [lat, lon] of bad) {
            assert.throws(() => snapToCell(lat, lon), RangeError, `${String(lat)}, ${String(lon)}`);
        }
        assert.throws(() => snapToCell(), RangeError);
    });

    test('throws RangeError for cell sizes that are not allowed', () => {
        for (const deg of [0, -0.05, NaN, Infinity, 181, 1e9, '0.05', null, 0.0099, 1e-9, [], {}]) {
            assert.throws(() => snapToCell(10, 10, deg), RangeError, String(deg));
        }
        assert.doesNotThrow(() => snapToCell(10, 10, 0.01));
        assert.doesNotThrow(() => snapToCell(10, 10, 180));
    });

    test('undefined cell size means the default', () => {
        assert.deepEqual(snapToCell(12.34, 56.78, undefined), snapToCell(12.34, 56.78, 0.05));
    });

    test('error messages never contain the offending value', () => {
        for (const [lat, lon] of [[123.456789, 10], [10, 234.567891], [NaN, 77.123456]]) {
            try {
                snapToCell(lat, lon);
                assert.fail('should have thrown');
            } catch (err) {
                const dump = [err.message, err.stack, String(err), JSON.stringify(Object.getOwnPropertyNames(err).map(k => err[k]))].join('|');
                assert.doesNotMatch(dump, /123\.4|234\.5|77\.12|456789|567891/);
            }
        }
    });
});

describe('snapping stability', () => {
    test('every point inside a cell maps to that cell (default grid, many cells)', () => {
        const rand = seeded(7);
        for (let n = 0; n < 400; n++) {
            const c = { x: Math.floor(rand() * 7200), y: Math.floor(rand() * 3600) };
            const lat0 = -90 + c.y * 0.05;
            const lon0 = -180 + c.x * 0.05;
            for (const fy of [0.02, 0.25, 0.5, 0.75, 0.98]) {
                for (const fx of [0.02, 0.25, 0.5, 0.75, 0.98]) {
                    assert.deepEqual(snapToCell(lat0 + fy * 0.05, lon0 + fx * 0.05), c, `cell ${c.x},${c.y} @ ${fx},${fy}`);
                }
            }
        }
    });

    test('every point inside a cell maps to that cell (other cell sizes, including uneven ones)', () => {
        const rand = seeded(11);
        for (const deg of [0.01, 0.07, 0.1, 0.5, 1, 7, 45, 180]) {
            const w = Math.ceil(360 / deg - 1e-9);
            const h = Math.ceil(180 / deg - 1e-9);
            for (let n = 0; n < 80; n++) {
                const c = { x: Math.floor(rand() * w), y: Math.floor(rand() * h) };
                const lat = Math.min(90, -90 + (c.y + 0.1 + rand() * 0.8) * deg);
                const lon = Math.min(180, -180 + (c.x + 0.1 + rand() * 0.8) * deg);
                assert.deepEqual(snapToCell(lat, lon, deg), c, `deg ${deg} cell ${c.x},${c.y}`);
            }
        }
    });

    test('a cell centre snaps back to its own cell', () => {
        const rand = seeded(3);
        for (const deg of [0.01, 0.05, 0.07, 0.1, 1, 7, 90, 180]) {
            const w = Math.ceil(360 / deg - 1e-9);
            const h = Math.ceil(180 / deg - 1e-9);
            const cells = [{ x: 0, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }, { x: w - 1, y: 0 }];
            for (let n = 0; n < 60; n++) cells.push({ x: Math.floor(rand() * w), y: Math.floor(rand() * h) });
            for (const c of cells) {
                const centre = cellCenter(c, deg);
                assert.deepEqual(snapToCell(centre.lat, centre.lon, deg), c, `deg ${deg} cell ${c.x},${c.y}`);
            }
        }
    });

    test('is deterministic', () => {
        for (let i = 0; i < 20; i++) {
            assert.deepEqual(snapToCell(MUMBAI.lat, MUMBAI.lon), snapToCell(MUMBAI.lat, MUMBAI.lon));
        }
        const a = snapToCell(1.23, 4.56);
        const b = snapToCell(1.23, 4.56);
        assert.notEqual(a, b, 'fresh object each time, so callers cannot share and mutate one');
        assert.deepEqual(a, b);
    });

    test('two points 100 m apart across a latitude border are in different cells but still Nearby', () => {
        const border = 19.05; // a cell edge on the default grid
        const south = snapToCell(border - 0.00045, 72.9125);
        const north = snapToCell(border + 0.00045, 72.9125);
        assert.notEqual(south.y, north.y);
        assert.equal(south.x, north.x);
        assert.equal(describeDistance(distanceBetweenCells(south, north)), 'Nearby (within 10 km)');
    });

    test('two points 100 m apart across a longitude border are in different cells but still Nearby', () => {
        const border = 72.85;
        const lat = 19.0125;
        const west = snapToCell(lat, border - 0.00047);
        const east = snapToCell(lat, border + 0.00047);
        assert.notEqual(west.x, east.x);
        assert.equal(west.y, east.y);
        const metres = distanceKm({ lat, lon: border - 0.00047 }, { lat, lon: border + 0.00047 }) * 1000;
        near(metres, 100, 5, 'the two raw points really are about 100 m apart');
        assert.equal(describeDistance(distanceBetweenCells(west, east)), 'Nearby (within 10 km)');
    });

    test('two points 100 m apart across a cell corner differ in both indices but are still Nearby', () => {
        const a = snapToCell(19.05 - 0.0003, 72.85 - 0.0003);
        const b = snapToCell(19.05 + 0.0003, 72.85 + 0.0003);
        assert.notEqual(a.x, b.x);
        assert.notEqual(a.y, b.y);
        assert.equal(describeDistance(distanceBetweenCells(a, b)), 'Nearby (within 10 km)');
    });

    test('all eight neighbours of a cell are Nearby, from the equator to high latitudes', () => {
        for (const lat of [0, 19, 45, 60, 75, 85, 89.9, -45, -85]) {
            const c = snapToCell(lat, 10);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const n = { x: c.x + dx, y: Math.min(3599, Math.max(0, c.y + dy)) };
                    assert.equal(describeDistance(distanceBetweenCells(c, n)), 'Nearby (within 10 km)', `lat ${lat} d ${dx},${dy}`);
                }
            }
        }
    });

    test('cells two apart at the equator are no longer Nearby', () => {
        const c = snapToCell(0.01, 10);
        const far = { x: c.x + 2, y: c.y };
        assert.equal(describeDistance(distanceBetweenCells(c, far)), '10–25 km away');
    });
});

// =====================================================================
// poles and the antimeridian
// =====================================================================

describe('poles and antimeridian', () => {
    test('north and south pole map to the top and bottom row', () => {
        assert.equal(snapToCell(90, 12).y, 3599);
        assert.equal(snapToCell(-90, 12).y, 0);
    });

    test('pole cell centres lie inside the valid range', () => {
        const north = cellCenter(snapToCell(90, 0));
        const south = cellCenter(snapToCell(-90, 0));
        near(north.lat, 89.975, 1e-9);
        near(south.lat, -89.975, 1e-9);
        assert.ok(north.lat <= 90 && south.lat >= -90);
    });

    test('every polar cell is Nearby to every other polar cell (the whole top row is within about 5.6 km)', () => {
        const top = { x: 0, y: 3599 };
        for (let x = 0; x < 7200; x += 7) {
            const km = distanceBetweenCells(top, { x, y: 3599 });
            assert.ok(Number.isFinite(km) && km < 6, `x ${x} gives ${km}`);
            assert.equal(describeDistance(km), 'Nearby (within 10 km)');
        }
    });

    test('lon 179.99 and -179.99 are 2 km apart in reality and in adjacent cells, so Nearby', () => {
        const east = snapToCell(0, 179.99);
        const west = snapToCell(0, -179.99);
        assert.equal(east.x, 7199);
        assert.equal(west.x, 0);
        near(distanceKm({ lat: 0, lon: 179.99 }, { lat: 0, lon: -179.99 }), 2.224, 0.01);
        near(distanceBetweenCells(east, west), 5.56, 0.05, 'centres are one cell apart across the antimeridian');
        assert.equal(describeDistance(distanceBetweenCells(east, west)), 'Nearby (within 10 km)');
    });

    test('lon exactly 180 and exactly -180 land in the cells either side of the antimeridian', () => {
        assert.equal(snapToCell(10, 180).x, 7199);
        assert.equal(snapToCell(10, -180).x, 0);
        assert.equal(describeDistance(distanceBetweenCells(snapToCell(10, 180), snapToCell(10, -180))), 'Nearby (within 10 km)');
    });

    test('antipodal and pole-to-pole distances are finite and about right', () => {
        near(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }), 20015.09, 0.5);
        near(distanceKm({ lat: 90, lon: 0 }, { lat: -90, lon: 0 }), 20015.09, 0.5);
        near(distanceKm({ lat: 10, lon: 20 }, { lat: -10, lon: -160 }), 20015.09, 0.5);
        near(distanceBetweenCells(snapToCell(90, 0), snapToCell(-90, 0)), 20015.09 - 2 * 2.7798, 1);
    });

    test('distanceKm never returns NaN around the antipode', () => {
        const rand = seeded(5);
        for (let i = 0; i < 2000; i++) {
            const lat = (rand() - 0.5) * 180;
            const lon = (rand() - 0.5) * 360;
            const antipode = { lat: -lat, lon: lon > 0 ? lon - 180 : lon + 180 };
            const km = distanceKm({ lat, lon }, antipode);
            assert.ok(Number.isFinite(km) && km > 20000 && km < 20016, `${km}`);
        }
    });

    test('a cell on the last column and one on the first column are never further apart than half the world', () => {
        const rand = seeded(9);
        for (let i = 0; i < 300; i++) {
            const a = { x: Math.floor(rand() * 7200), y: Math.floor(rand() * 3600) };
            const b = { x: Math.floor(rand() * 7200), y: Math.floor(rand() * 3600) };
            const km = distanceBetweenCells(a, b);
            assert.ok(km >= 0 && km <= 20016, `${km}`);
            near(km, distanceBetweenCells(b, a), 1e-9, 'symmetric');
        }
    });
});

// =====================================================================
// cellCenter
// =====================================================================

describe('cellCenter', () => {
    test('returns the middle of the cell', () => {
        const c = cellCenter({ x: 3600, y: 1800 });
        near(c.lat, 0.025, 1e-9);
        near(c.lon, 0.025, 1e-9);
        const m = cellCenter(snapToCell(MUMBAI.lat, MUMBAI.lon));
        near(m.lat, 19.075, 1e-9);
        near(m.lon, 72.875, 1e-9);
    });

    test('centre is within half a cell of any point in the cell', () => {
        const rand = seeded(21);
        for (let i = 0; i < 500; i++) {
            const lat = (rand() - 0.5) * 180;
            const lon = (rand() - 0.5) * 360;
            const c = cellCenter(snapToCell(lat, lon));
            assert.ok(Math.abs(c.lat - lat) <= 0.025 + 1e-9 && Math.abs(c.lon - lon) <= 0.025 + 1e-9);
        }
    });

    test('result is { lat, lon } only', () => {
        assert.deepEqual(Object.keys(cellCenter({ x: 5, y: 5 })), ['lat', 'lon']);
    });

    test('is clamped inside valid ranges at the edges of an uneven grid', () => {
        const deg = 7; // 360/7 and 180/7 do not divide evenly: the last cells are cut short
        const last = { x: Math.ceil(360 / deg) - 1, y: Math.ceil(180 / deg) - 1 };
        const c = cellCenter(last, deg);
        assert.ok(c.lat <= 90 && c.lat >= -90 && c.lon <= 180 && c.lon >= -180, JSON.stringify(c));
        assert.deepEqual(snapToCell(c.lat, c.lon, deg), last);
        assert.deepEqual(cellCenter({ x: 0, y: 0 }, 180), { lat: 0, lon: -90 }); // a cell as tall as the whole map
        assert.deepEqual(cellCenter({ x: 1, y: 0 }, 180), { lat: 0, lon: 90 });
        const cut = cellCenter({ x: 0, y: 25 }, 7); // 175..180 of 180: only 5 degrees tall
        near(cut.lat, 90 - 2.5, 1e-9);
    });

    test('throws RangeError for cells off the grid or malformed', () => {
        for (const c of [{ x: 7200, y: 0 }, { x: 0, y: 3600 }, { x: -1, y: 0 }, { x: 1.5, y: 0 }, null, undefined, [], 'x', { x: 1 }, { x: 1, y: 2, z: 3 }]) {
            assert.throws(() => cellCenter(c), RangeError);
        }
        assert.throws(() => cellCenter({ x: 1, y: 1 }, 0), RangeError);
    });
});

// =====================================================================
// isValidCell
// =====================================================================

describe('isValidCell', () => {
    test('accepts plain integer cells inside the grid', () => {
        for (const c of [{ x: 0, y: 0 }, { x: 7199, y: 3599 }, { x: 5057, y: 2181 }, { x: 0, y: 3599 }, { x: 7199, y: 0 }, { y: 3, x: 4 }]) {
            assert.equal(isValidCell(c), true, JSON.stringify(c));
        }
        assert.equal(isValidCell(Object.assign(Object.create(null), { x: 1, y: 2 })), true);
        assert.equal(isValidCell(Object.freeze({ x: 1, y: 2 })), true);
    });

    test('rejects the first index past each edge', () => {
        assert.equal(isValidCell({ x: 7200, y: 0 }), false);
        assert.equal(isValidCell({ x: 0, y: 3600 }), false);
        assert.equal(isValidCell({ x: -1, y: 0 }), false);
        assert.equal(isValidCell({ x: 0, y: -1 }), false);
    });

    test('bounds follow the cell size', () => {
        assert.equal(isValidCell({ x: 9000, y: 4500 }, 0.04), false);
        assert.equal(isValidCell({ x: 8999, y: 4499 }, 0.04), true);
        assert.equal(isValidCell({ x: 7200, y: 3600 }, 0.04), true);
        assert.equal(isValidCell({ x: 7200, y: 0 }, 0.05), false);
        assert.equal(isValidCell({ x: 359, y: 179 }, 1), true);
        assert.equal(isValidCell({ x: 360, y: 0 }, 1), false);
        assert.equal(isValidCell({ x: 51, y: 25 }, 7), true);
        assert.equal(isValidCell({ x: 52, y: 25 }, 7), false);
        assert.equal(isValidCell({ x: 0, y: 25 }, 7), true);
        assert.equal(isValidCell({ x: 0, y: 26 }, 7), false);
        assert.equal(isValidCell({ x: 1, y: 0 }, 180), true);
        assert.equal(isValidCell({ x: 2, y: 0 }, 180), false);
        assert.equal(isValidCell({ x: 0, y: 1 }, 180), false);
    });

    test('an unusable cell size makes everything invalid, without throwing', () => {
        for (const deg of [0, -1, NaN, Infinity, 181, '0.05', null, 0.001, {}, []]) {
            assert.equal(isValidCell({ x: 1, y: 1 }, deg), false, String(deg));
        }
    });

    test('rejects floats, NaN, Infinity, strings, booleans, null, bigint, boxed numbers', () => {
        const values = [1.5, 0.1, NaN, Infinity, -Infinity, '1', '', 'a', true, false, null, undefined, 1n, new Number(1), [], {}, [1], () => 1, Symbol('s')];
        for (const v of values) {
            assert.equal(isValidCell({ x: v, y: 1 }), false, `x=${String(typeof v === 'symbol' ? 'sym' : v)}`);
            assert.equal(isValidCell({ x: 1, y: v }), false, `y=${String(typeof v === 'symbol' ? 'sym' : v)}`);
        }
        assert.equal(isValidCell({ x: 1e21, y: 1 }), false);
        assert.equal(isValidCell({ x: 2 ** 53, y: 1 }), false);
    });

    test('rejects extra keys, missing keys and wrong key names', () => {
        assert.equal(isValidCell({ x: 1, y: 2, z: 3 }), false);
        assert.equal(isValidCell({ x: 1, y: 2, lat: 19.07, lon: 72.87 }), false, 'a cell carrying raw coordinates is never valid');
        assert.equal(isValidCell({ x: 1 }), false);
        assert.equal(isValidCell({ y: 1 }), false);
        assert.equal(isValidCell({}), false);
        assert.equal(isValidCell({ X: 1, Y: 2 }), false);
        assert.equal(isValidCell({ x: 1, y: 2, [Symbol('s')]: 3 }), false);
        const hidden = { x: 1, y: 2 };
        Object.defineProperty(hidden, 'z', { value: 3, enumerable: false });
        assert.equal(isValidCell(hidden), false);
    });

    test('rejects arrays, primitives and exotic objects', () => {
        for (const v of [[1, 2], [], [0, 0], Object.assign([1, 2], { x: 1, y: 2 }), 'xy', 12, null, undefined, true, 1n, Symbol('s'), () => ({ x: 1, y: 2 }),
            new Map([['x', 1], ['y', 2]]), new Date(), /re/, new Int8Array(2), new Error('x'), new Number(1)]) {
            assert.equal(isValidCell(v), false);
        }
        class Cell { constructor() { this.x = 1; this.y = 2; } }
        assert.equal(isValidCell(new Cell()), false, 'class instances are not plain objects');
    });

    test('rejects inherited and __proto__ tricks', () => {
        assert.equal(isValidCell(Object.create({ x: 1, y: 2 })), false);
        assert.equal(isValidCell(JSON.parse('{"__proto__":{"x":1,"y":2}}')), false);
        assert.equal(isValidCell(JSON.parse('{"x":1,"y":2,"__proto__":{}}')), false);
        assert.equal(isValidCell(JSON.parse('{"x":1,"__proto__":2}')), false);
        assert.equal(isValidCell(JSON.parse('{"x":1,"y":2,"constructor":{"prototype":{"x":1}}}')), false);
        assert.equal(isValidCell({ x: 1, y: 2, __proto__: { z: 1 } }), false, 'a non-plain prototype');
        assert.equal(isValidCell(Object.setPrototypeOf({ x: 1, y: 2 }, { evil: true })), false);
    });

    test('does not call getters or valueOf', () => {
        let calls = 0;
        const getter = { get x() { calls++; return 1; }, y: 2 };
        assert.equal(isValidCell(getter), false);
        assert.equal(isValidCell({ x: { valueOf() { calls++; return 1; } }, y: 2 }), false);
        assert.equal(isValidCell({ x: { toString() { calls++; return '1'; } }, y: 2 }), false);
        assert.equal(calls, 0);
    });

    test('does not throw for hostile objects', () => {
        const boom = () => { throw new Error('boom'); };
        const trap = new Proxy({}, { get: boom, has: boom, ownKeys: boom, getPrototypeOf: boom, getOwnPropertyDescriptor: boom });
        assert.equal(isValidCell(trap), false);
        assert.equal(isValidCell({ get x() { throw new Error('boom'); }, y: 1 }), false);
        assert.equal(isValidCell(new Proxy({ x: 1, y: 2 }, { ownKeys: boom })), false);
    });

    test('accepts -0 as zero (parseLocMessage normalises it)', () => {
        assert.equal(isValidCell({ x: -0, y: 0 }), true);
    });
});

// =====================================================================
// distance
// =====================================================================

describe('distanceKm', () => {
    test('zero for the same point and symmetric', () => {
        assert.equal(distanceKm(MUMBAI, MUMBAI), 0);
        assert.equal(distanceKm(MUMBAI, DELHI), distanceKm(DELHI, MUMBAI));
    });

    test('one degree of longitude on the equator is 111.195 km (R = 6371.0088)', () => {
        near(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 111.1949, 0.001);
        near(distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111.1949, 0.001);
        near(distanceKm({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }), 222.39, 0.01, 'wraps over the antimeridian the short way');
    });

    test('uses the mean Earth radius 6371.0088 km exactly', () => {
        const R = 6371.0088;
        near(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }), R * Math.PI / 2, 1e-6);
        near(distanceKm({ lat: 0, lon: 0 }, { lat: 90, lon: 0 }), R * Math.PI / 2, 1e-6);
        near(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }), R * Math.PI, 1e-6);
        near(distanceKm({ lat: 30, lon: 40 }, { lat: 30, lon: 40.5 }), R * Math.acos(Math.sin(30 * Math.PI / 180) ** 2 + Math.cos(30 * Math.PI / 180) ** 2 * Math.cos(0.5 * Math.PI / 180)), 1e-6);
    });

    test('known city pairs (unsnapped)', () => {
        near(distanceKm(MUMBAI, DELHI), 1150, 5);
        near(distanceKm(MUMBAI, PUNE), 119, 3);
        near(distanceKm(LONDON, NEW_YORK), 5570, 15);
    });

    test('returns NaN, and does not throw, for input that is not coordinates', () => {
        for (const [a, b] of [[null, MUMBAI], [MUMBAI, undefined], [{}, {}], [{ lat: NaN, lon: 0 }, MUMBAI], [{ lat: '1', lon: '2' }, MUMBAI],
            [[1, 2], [3, 4]], [MUMBAI, { lat: 0, lon: Infinity }], [1, 2], ['a', 'b']]) {
            assert.ok(Number.isNaN(distanceKm(a, b)));
        }
        assert.ok(Number.isNaN(distanceKm()));
    });
});

describe('distanceBetweenCells', () => {
    test('Mumbai to Delhi is about 1150 km within 20 km after snapping', () => {
        near(kmBetween(MUMBAI, DELHI), 1150, 20);
    });

    test('Mumbai to Pune is about 120 km', () => {
        near(kmBetween(MUMBAI, PUNE), 120, 10);
    });

    test('London to New York is about 5570 km', () => {
        near(kmBetween(LONDON, NEW_YORK), 5570, 30);
    });

    test('snapping moves each end by at most half a cell diagonal, so by under 4 km at this latitude', () => {
        for (const [p, q] of [[MUMBAI, DELHI], [MUMBAI, PUNE], [LONDON, NEW_YORK]]) {
            near(kmBetween(p, q), distanceKm(p, q), 8);
        }
    });

    test('same cell is 0 km and Nearby', () => {
        const c = snapToCell(MUMBAI.lat, MUMBAI.lon);
        assert.equal(distanceBetweenCells(c, c), 0);
        assert.equal(describeDistance(distanceBetweenCells(c, { ...c })), 'Nearby (within 10 km)');
    });

    test('uses the given cell size', () => {
        const a = snapToCell(10, 10, 1);
        const b = snapToCell(10, 12, 1);
        near(distanceBetweenCells(a, b, 1), 2 * 111.195 * Math.cos(10.5 * Math.PI / 180), 0.5);
    });

    test('is symmetric and throws RangeError for a cell that is not on the grid', () => {
        const a = snapToCell(MUMBAI.lat, MUMBAI.lon);
        const b = snapToCell(DELHI.lat, DELHI.lon);
        assert.equal(distanceBetweenCells(a, b), distanceBetweenCells(b, a));
        assert.throws(() => distanceBetweenCells(a, { x: 7200, y: 0 }), RangeError);
        assert.throws(() => distanceBetweenCells(null, b), RangeError);
        assert.throws(() => distanceBetweenCells(a, b, 0), RangeError);
    });
});

// =====================================================================
// describeDistance
// =====================================================================

describe('describeDistance', () => {
    test('English bands and edges', () => {
        const cases = [
            [0, 'Nearby (within 10 km)'], [9.99, 'Nearby (within 10 km)'], [10, '10–25 km away'], [24.99, '10–25 km away'],
            [25, '25–50 km away'], [49.99, '25–50 km away'], [50, '50–100 km away'], [99.99, '50–100 km away'],
            [100, '100–250 km away'], [249.99, '100–250 km away'], [250, 'about 250 km away'], [274.9, 'about 250 km away'],
            [275, 'about 300 km away'], [349, 'about 350 km away'], [351, 'about 350 km away'], [974.9, 'about 950 km away'],
            [999.9, 'about 1,000 km away'], [1000, 'about 1,000 km away'], [1049.9, 'about 1,000 km away'], [1050, 'about 1,100 km away'],
            [1150, 'about 1,200 km away'], [1234, 'about 1,200 km away'], [5570, 'about 5,600 km away'], [12345, 'about 12,300 km away'],
            [20000, 'about 20,000 km away'],
        ];
        for (const [km, text] of cases) assert.equal(describeDistance(km), text, String(km));
    });

    test('Hindi strings', () => {
        const cases = [
            [0, 'आस-पास (10 किमी के अंदर)'], [9.9, 'आस-पास (10 किमी के अंदर)'], [10, '10–25 किमी दूर'], [30, '25–50 किमी दूर'],
            [75, '50–100 किमी दूर'], [180, '100–250 किमी दूर'], [350, 'लगभग 350 किमी दूर'], [352, 'लगभग 350 किमी दूर'],
            [1150, 'लगभग 1,200 किमी दूर'], [5570, 'लगभग 5,600 किमी दूर'],
        ];
        for (const [km, text] of cases) assert.equal(describeDistance(km, 'hi'), text, String(km));
    });

    test('Hindi output is Devanagari text and keeps ASCII digits', () => {
        for (const km of [0, 15, 40, 80, 200, 500, 3000]) {
            const s = describeDistance(km, 'hi');
            assert.match(s, /\p{Script=Devanagari}/u);
            assert.doesNotMatch(s, /\b(?:km|away|about|Nearby)\b/);
        }
    });

    test('language is chosen from the tag; anything unknown is English; default is English', () => {
        assert.equal(describeDistance(500), describeDistance(500, 'en'));
        assert.equal(describeDistance(500, 'hi-IN'), 'लगभग 500 किमी दूर');
        assert.equal(describeDistance(500, 'HI'), 'लगभग 500 किमी दूर');
        assert.equal(describeDistance(500, 'hi_IN'), 'लगभग 500 किमी दूर');
        for (const lang of ['fr', 'xx', '', 'hindi', 'high', null, 5, {}, ['hi'], '__proto__', 'constructor']) {
            assert.equal(describeDistance(500, lang), 'about 500 km away', String(lang));
        }
        assert.equal(describeDistance(500, undefined), 'about 500 km away');
    });

    test('invalid, NaN, negative and impossible input returns an empty string', () => {
        for (const km of [NaN, -1, -0.001, -Infinity, Infinity, undefined, null, '100', '', [], {}, true, 5n, new Number(5), 1e21, 1e308, 50000]) {
            assert.equal(describeDistance(km), '', String(km));
            assert.equal(describeDistance(km, 'hi'), '', String(km));
        }
        assert.equal(describeDistance(), '');
        assert.equal(describeDistance(-0), 'Nearby (within 10 km)');
    });

    test('never reveals anything finer than the bands (scan 0..20000 km in 0.1 km steps, both languages)', () => {
        // Expected interval of tenths-of-a-km that may produce each string.
        const expected = new Map();
        const en = (...s) => s.join('');
        const add = (text, lo, hi) => expected.set(text, [lo, hi]);
        add('Nearby (within 10 km)', 0, 99);
        add('10–25 km away', 100, 249);
        add('25–50 km away', 250, 499);
        add('50–100 km away', 500, 999);
        add('100–250 km away', 1000, 2499);
        add('about 250 km away', 2500, 2749);
        for (let n = 300; n <= 950; n += 50) add(en('about ', n, ' km away'), n * 10 - 250, n * 10 + 249);
        add('about 1,000 km away', 9750, 10499);
        for (let n = 1100; n <= 19900; n += 100) add(`about ${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} km away`, n * 10 - 500, n * 10 + 499);
        add('about 20,000 km away', 199500, 200000); // the scan stops at 20,000

        assert.equal(expected.size, 211, 'a small fixed set: 5 bands + 16 steps up to 1,000 + 190 steps from 1,100');

        for (const lang of ['en', 'hi']) {
            const seen = new Map(); // text -> { lo, hi, count }
            for (let i = 0; i <= 200000; i++) {
                const text = describeDistance(i / 10, lang);
                assert.notEqual(text, '', `${i / 10} km`);
                const e = seen.get(text);
                if (e) { e.hi = i; e.count++; } else seen.set(text, { lo: i, hi: i, count: 1 });
            }
            assert.equal(seen.size, 211, `${lang}: number of distinct strings`);
            const widths = [];
            for (const [text, s] of seen) {
                assert.equal(s.count, s.hi - s.lo + 1, `${lang}: "${text}" must cover one unbroken stretch`);
                widths.push(s.hi - s.lo + 1);
            }
            assert.ok(Math.min(...widths) >= 99, `${lang}: every string covers at least ~10 km (tenths: ${Math.min(...widths)})`);
            if (lang === 'en') {
                assert.deepEqual([...seen.keys()].sort(), [...expected.keys()].sort());
                for (const [text, s] of seen) {
                    assert.deepEqual([s.lo, s.hi], expected.get(text), text);
                }
            }
        }
    });

    test('every output is one of three shapes, and the numbers are round', () => {
        const shapes = /^(?:Nearby \(within 10 km\)|\d+–\d+ km away|about ([\d,]+) km away)$/;
        for (let i = 0; i <= 20000; i += 3) {
            const km = i + (i % 10) / 10;
            const s = describeDistance(km);
            const m = shapes.exec(s);
            assert.ok(m, s);
            if (m[1]) {
                const n = Number(m[1].replace(/,/g, ''));
                assert.equal(n % (km < 1000 ? 50 : 100), 0, `${s} for ${km}`);
                assert.doesNotMatch(s, /\./);
            }
        }
    });

    test('thousands separator only from 1,000 up, and only commas', () => {
        assert.equal(describeDistance(900), 'about 900 km away');
        assert.equal(describeDistance(1200), 'about 1,200 km away');
        assert.equal(describeDistance(10000), 'about 10,000 km away');
        assert.doesNotMatch(describeDistance(1234), /\s\d{4}\s/);
    });

    test('no other text leaks: the output carries no raw input digits beyond the band', () => {
        assert.equal(describeDistance(123.456), '100–250 km away');
        assert.doesNotMatch(describeDistance(123.456), /123|456/);
        assert.doesNotMatch(describeDistance(5.4321), /5\.|4321/);
        assert.doesNotMatch(describeDistance(777.77), /777/);
    });
});

// =====================================================================
// parseLocMessage / locMessage
// =====================================================================

describe('locMessage and parseLocMessage', () => {
    test('locMessage builds { t: "loc", x, y }', () => {
        assert.deepEqual(locMessage({ x: 5057, y: 2181 }), { t: 'loc', x: 5057, y: 2181 });
        assert.deepEqual(Object.keys(locMessage({ x: 1, y: 2 })), ['t', 'x', 'y']);
        assert.deepEqual(locMessage(snapToCell(MUMBAI.lat, MUMBAI.lon)), { t: 'loc', x: 5057, y: 2181 });
        assert.deepEqual(locMessage({ x: -0, y: 0 }), { t: 'loc', x: 0, y: 0 });
        assert.ok(Object.is(locMessage({ x: -0, y: 0 }).x, 0));
    });

    test('locMessage refuses anything that is not exactly an integer cell (so coordinates can never ride along)', () => {
        for (const c of [{ x: 1, y: 2, lat: 19.07, lon: 72.87 }, { x: 1.5, y: 2 }, { x: -1, y: 2 }, { x: NaN, y: 2 }, { x: 1 }, null, undefined, [1, 2], 'cell', 5,
            { lat: 19.07, lon: 72.87 }, { x: '1', y: '2' }, Object.assign(Object.create({ x: 1, y: 2 }), {})]) {
            assert.throws(() => locMessage(c), RangeError);
        }
    });

    test('locMessage output never contains a key other than t, x, y even for a cell with a hidden extra', () => {
        const sneaky = { x: 3, y: 4 };
        Object.defineProperty(sneaky, 'lat', { value: 19.07, enumerable: false });
        assert.throws(() => locMessage(sneaky), RangeError);
    });

    test('round trip', () => {
        const rand = seeded(13);
        for (let i = 0; i < 200; i++) {
            const c = { x: Math.floor(rand() * 7200), y: Math.floor(rand() * 3600) };
            assert.deepEqual(parseLocMessage(locMessage(c)), c);
            assert.deepEqual(parseLocMessage(JSON.parse(JSON.stringify(locMessage(c)))), c);
        }
    });

    test('parse returns a fresh { x, y } with exactly two keys', () => {
        const msg = { t: 'loc', x: 10, y: 20 };
        const cell = parseLocMessage(msg);
        assert.deepEqual(cell, { x: 10, y: 20 });
        assert.deepEqual(Object.keys(cell), ['x', 'y']);
        assert.notEqual(cell, msg);
        cell.x = 99;
        assert.equal(msg.x, 10);
    });

    test('parse follows the cell size', () => {
        assert.deepEqual(parseLocMessage({ t: 'loc', x: 8999, y: 4000 }, 0.04), { x: 8999, y: 4000 });
        assert.equal(parseLocMessage({ t: 'loc', x: 9000, y: 4000 }, 0.04), null);
        assert.equal(parseLocMessage({ t: 'loc', x: 8999, y: 4000 }, 0.05), null);
        assert.equal(parseLocMessage({ t: 'loc', x: 0, y: 0 }, 0), null);
        assert.equal(parseLocMessage({ t: 'loc', x: 0, y: 0 }, NaN), null);
    });

    test('parse normalises -0 (JSON can carry it)', () => {
        const cell = parseLocMessage(JSON.parse('{"t":"loc","x":-0,"y":-0}'));
        assert.ok(Object.is(cell.x, 0) && Object.is(cell.y, 0));
    });

    test('parse rejects the wrong type tag, extra keys and missing keys', () => {
        const base = { t: 'loc', x: 1, y: 2 };
        for (const msg of [
            { ...base, t: 'LOC' }, { ...base, t: 'locx' }, { ...base, t: ' loc' }, { ...base, t: 'chat' }, { ...base, t: undefined }, { ...base, t: ['loc'] },
            { ...base, z: 1 }, { ...base, lat: 19.07 }, { ...base, lat: 19.07, lon: 72.87 },
            { t: 'loc', x: 1 }, { t: 'loc', y: 1 }, { x: 1, y: 2 }, { t: 'loc' }, { t: 'loc', x: 1, y: 2, t2: 'loc' },
            { t: 'loc', X: 1, Y: 2 }, {},
        ]) {
            assert.equal(parseLocMessage(msg), null, JSON.stringify(msg));
        }
    });

    test('parse rejects bad cell values', () => {
        for (const [x, y] of [[-1, 0], [0, -1], [7200, 0], [0, 3600], [1.5, 0], [0, 0.5], ['1', 2], [1, '2'], [NaN, 0], [0, Infinity], [null, 0], [undefined, 0],
            [true, 1], [[1], 2], [{ valueOf: () => 1 }, 2], [1e21, 0], [2 ** 53, 0], [1n, 2n]]) {
            assert.equal(parseLocMessage({ t: 'loc', x, y }), null, `${String(x)},${String(y)}`);
        }
    });

    test('parse never throws and returns null for non-objects', () => {
        const huge = 'x'.repeat(2_000_000);
        for (const msg of [null, undefined, 0, 1, NaN, '', 'loc', huge, true, false, 5n, Symbol('s'), [], ['loc', 1, 2], [{ t: 'loc', x: 1, y: 2 }], () => ({ t: 'loc', x: 1, y: 2 }),
            new Map([['t', 'loc']]), new Date(), /re/, new Int8Array(3), new Error('e'), new Number(1), new String('loc'), Object('loc'),
            JSON.parse('{"__proto__":{"t":"loc","x":1,"y":2}}'), JSON.parse('{"t":"loc","x":1,"y":2,"__proto__":{"polluted":true}}'),
            JSON.parse('{"t":"loc","x":1,"y":2,"constructor":{"prototype":{"polluted":true}}}'),
            Object.create({ t: 'loc', x: 1, y: 2 }), Object.setPrototypeOf({ t: 'loc', x: 1, y: 2 }, { polluted: true }),
        ]) {
            assert.equal(parseLocMessage(msg), null);
        }
        assert.equal(({}).polluted, undefined);
        assert.equal(Object.prototype.polluted, undefined);
    });

    test('parse ignores getters and hostile objects', () => {
        let calls = 0;
        assert.equal(parseLocMessage({ get t() { calls++; return 'loc'; }, x: 1, y: 2 }), null);
        assert.equal(parseLocMessage({ t: 'loc', get x() { throw new Error('boom'); }, y: 2 }), null);
        const boom = () => { throw new Error('boom'); };
        assert.equal(parseLocMessage(new Proxy({}, { get: boom, has: boom, ownKeys: boom, getPrototypeOf: boom, getOwnPropertyDescriptor: boom })), null);
        assert.equal(parseLocMessage(new Proxy({ t: 'loc', x: 1, y: 2 }, { ownKeys: boom })), null);
        assert.equal(calls, 0);
    });

    test('parse copes with a message with an enormous number of keys', () => {
        const msg = { t: 'loc', x: 1, y: 2 };
        for (let i = 0; i < 20000; i++) msg['k' + i] = i;
        assert.equal(parseLocMessage(msg), null);
    });

    test('parse copes with circular and deeply nested values', () => {
        const circular = { t: 'loc', x: 1, y: 2 };
        circular.self = circular;
        assert.equal(parseLocMessage(circular), null);
        let deep = {};
        for (let i = 0; i < 50000; i++) deep = { deep };
        assert.equal(parseLocMessage({ t: 'loc', x: deep, y: 1 }), null);
        assert.equal(parseLocMessage(deep), null);
    });
});

// =====================================================================
// getApproxCell
// =====================================================================

/** A fake navigator.geolocation that records its calls and lets each test decide what happens. */
function fakeGeo(behaviour) {
    const calls = [];
    return {
        calls,
        getCurrentPosition(success, error, options) {
            calls.push({ success, error, options, argc: arguments.length });
            behaviour?.(success, error, options);
        },
    };
}

const position = (latitude, longitude) => ({ coords: { latitude, longitude, accuracy: 25, altitude: null, heading: null, speed: null }, timestamp: 1 });

/** Everything an error could leak through, flattened to one string. */
function dumpError(err) {
    const own = Object.getOwnPropertyNames(err).map(k => `${k}=${String(err[k])}`).join('|');
    return [String(err), err.message, err.stack, own, JSON.stringify(err), err.cause === undefined ? '' : String(err.cause)].join('||');
}

async function withConsoleSpy(fn) {
    const names = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'];
    const saved = {};
    const calls = [];
    for (const n of names) { saved[n] = console[n]; console[n] = (...a) => calls.push([n, ...a]); }
    try {
        await fn();
    } finally {
        for (const n of names) console[n] = saved[n];
    }
    return calls;
}

describe('getApproxCell', () => {
    test('passes low-accuracy, cache-friendly options to the browser', async () => {
        const geo = fakeGeo((ok) => ok(position(MUMBAI.lat, MUMBAI.lon)));
        await getApproxCell({ geolocation: geo });
        assert.equal(geo.calls.length, 1);
        assert.deepEqual(geo.calls[0].options, { enableHighAccuracy: false, maximumAge: 600000, timeout: 8000 });
        assert.equal(typeof geo.calls[0].success, 'function');
        assert.equal(typeof geo.calls[0].error, 'function');
    });

    test('custom timeout is passed on; nonsense timeouts fall back to 8000', async () => {
        for (const [given, used] of [[3000, 3000], [15000, 15000], [0, 8000], [-5, 8000], [NaN, 8000], [Infinity, 8000], ['9', 8000], [null, 8000], [undefined, 8000]]) {
            const geo = fakeGeo((ok) => ok(position(1, 1)));
            await getApproxCell({ geolocation: geo, timeoutMs: given });
            assert.equal(geo.calls[0].options.timeout, used, String(given));
        }
    });

    test('resolves with the cell only', async () => {
        const geo = fakeGeo((ok) => ok(position(MUMBAI.lat, MUMBAI.lon)));
        const cell = await getApproxCell({ geolocation: geo });
        assert.deepEqual(cell, { x: 5057, y: 2181 });
        assert.deepEqual(Object.keys(cell), ['x', 'y']);
        assert.equal(Object.getPrototypeOf(cell), Object.prototype);
    });

    test('uses the given cell size', async () => {
        const geo = fakeGeo((ok) => ok(position(MUMBAI.lat, MUMBAI.lon)));
        assert.deepEqual(await getApproxCell({ geolocation: geo, cellDeg: 1 }), snapToCell(MUMBAI.lat, MUMBAI.lon, 1));
    });

    test('handles lat 90 / lon 180 from the browser', async () => {
        const cell = await getApproxCell({ geolocation: fakeGeo((ok) => ok(position(90, 180))) });
        assert.deepEqual(cell, { x: 7199, y: 3599 });
    });

    test('works when called with no arguments in an environment with no geolocation (Node)', async () => {
        await assert.rejects(getApproxCell(), err => err instanceof Error && err.code === 'unsupported');
        await assert.rejects(getApproxCell({}), err => err.code === 'unsupported');
    });

    test('rejects "unsupported" when geolocation is missing or has no getCurrentPosition', async () => {
        for (const geolocation of [undefined, null, {}, { getCurrentPosition: 'nope' }, 0, 'geo', []]) {
            await assert.rejects(getApproxCell({ geolocation: geolocation === undefined ? null : geolocation }), err => err instanceof Error && err.code === 'unsupported');
        }
    });

    test('maps GeolocationPositionError codes 1, 2 and 3', async () => {
        const cases = [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']];
        for (const [code, expected] of cases) {
            const geo = fakeGeo((ok, fail) => fail({ code, message: 'browser says no', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
            await assert.rejects(getApproxCell({ geolocation: geo }), err => {
                assert.ok(err instanceof Error);
                assert.equal(err.code, expected);
                return true;
            });
        }
    });

    test('unknown or missing error codes become "unavailable"', async () => {
        for (const e of [{ code: 0 }, { code: 4 }, { code: 99 }, { code: '1' }, { code: '__proto__' }, { code: null }, {}, null, undefined, 'denied', 3.5, { code: NaN }]) {
            const geo = fakeGeo((ok, fail) => fail(e));
            await assert.rejects(getApproxCell({ geolocation: geo }), err => err.code === 'unavailable', String(e && e.code));
        }
    });

    test('error codes are always one of the four documented', async () => {
        const allowed = new Set(['unsupported', 'denied', 'unavailable', 'timeout']);
        const scenarios = [
            { geolocation: null },
            { geolocation: fakeGeo((ok, fail) => fail({ code: 1 })) },
            { geolocation: fakeGeo((ok, fail) => fail({ code: 2 })) },
            { geolocation: fakeGeo((ok, fail) => fail({ code: 3 })) },
            { geolocation: fakeGeo((ok, fail) => fail({ code: 42 })) },
            { geolocation: fakeGeo(() => { throw new Error('SecurityError'); }) },
            { geolocation: fakeGeo((ok) => ok(position(NaN, 0))) },
            { geolocation: fakeGeo((ok) => ok(null)) },
        ];
        for (const s of scenarios) {
            await assert.rejects(getApproxCell(s), err => allowed.has(err.code));
        }
    });

    test('a synchronous throw from getCurrentPosition becomes "unavailable"', async () => {
        const geo = fakeGeo(() => { throw new Error('SecurityError: secret 19.0760,72.8777'); });
        await assert.rejects(getApproxCell({ geolocation: geo }), err => {
            assert.equal(err.code, 'unavailable');
            assert.doesNotMatch(dumpError(err), /19\.0760|72\.8777|secret/, 'the original error is not carried along');
            return true;
        });
    });

    test('an unusable fix (missing coords, NaN, out of range, strings) becomes "unavailable"', async () => {
        const fixes = [null, undefined, {}, { coords: null }, { coords: {} }, position(NaN, 1), position(1, Infinity), position(91, 0), position(0, 181),
            position('19.07', '72.87'), position(null, null), { coords: { latitude: 19.07 } }];
        for (const fix of fixes) {
            const geo = fakeGeo((ok) => ok(fix));
            await assert.rejects(getApproxCell({ geolocation: geo }), err => err.code === 'unavailable');
        }
    });

    test('a bad cell size rejects with RangeError and never asks for permission', async () => {
        for (const cellDeg of [0, -1, NaN, 0.001, 181, '0.05', null, Infinity]) {
            const geo = fakeGeo((ok) => ok(position(1, 1)));
            await assert.rejects(getApproxCell({ geolocation: geo, cellDeg }), RangeError, String(cellDeg));
            assert.equal(geo.calls.length, 0, 'getCurrentPosition must not be called');
        }
    });

    test('the first callback wins and later ones are ignored', async () => {
        const geo = fakeGeo((ok, fail) => { ok(position(MUMBAI.lat, MUMBAI.lon)); fail({ code: 1 }); ok(position(51, 0)); });
        assert.deepEqual(await getApproxCell({ geolocation: geo }), { x: 5057, y: 2181 });
        const geo2 = fakeGeo((ok, fail) => { fail({ code: 3 }); ok(position(51, 0)); });
        await assert.rejects(getApproxCell({ geolocation: geo2 }), err => err.code === 'timeout');
    });

    test('a request that never calls back stays pending (the browser timeout is what ends it) and leaves no timer', async () => {
        const geo = fakeGeo(); // never calls back
        const p = getApproxCell({ geolocation: geo, timeoutMs: 1234 });
        const state = await Promise.race([p.then(() => 'resolved', () => 'rejected'), new Promise(r => setImmediate(() => r('pending')))]);
        assert.equal(state, 'pending');
        assert.deepEqual(geo.calls[0].options, { enableHighAccuracy: false, maximumAge: 600000, timeout: 1234 });
        assert.equal(geo.calls[0].argc, 3);
    });

    test('only one fix is requested per call, never a watch', async () => {
        const geo = fakeGeo((ok) => ok(position(1, 1)));
        geo.watchPosition = () => assert.fail('watchPosition must not be used');
        await getApproxCell({ geolocation: geo });
        assert.equal(geo.calls.length, 1);
    });

    test('works with a real GeolocationPosition-like object whose coords are getters on a prototype', async () => {
        class Coords { get latitude() { return 19.0760; } get longitude() { return 72.8777; } }
        const geo = fakeGeo((ok) => ok({ coords: new Coords() }));
        assert.deepEqual(await getApproxCell({ geolocation: geo }), { x: 5057, y: 2181 });
    });
});

describe('raw coordinates never leak', () => {
    const LAT = 19.0760123;
    const LON = 72.8777456;
    const SECRETS = /19\.07|72\.87|0760123|8777456/;

    test('resolved value holds only the two cell indices', async () => {
        const cell = await getApproxCell({ geolocation: fakeGeo((ok) => ok(position(LAT, LON))) });
        assert.deepEqual(Object.getOwnPropertyNames(cell).sort(), ['x', 'y']);
        assert.deepEqual(Object.getOwnPropertySymbols(cell), []);
        assert.doesNotMatch(JSON.stringify(cell), SECRETS);
        assert.doesNotMatch(String(Object.values(cell)), SECRETS);
        assert.ok(Number.isInteger(cell.x) && Number.isInteger(cell.y));
    });

    test('snapToCell result holds only the two cell indices', () => {
        const cell = snapToCell(LAT, LON);
        assert.deepEqual(Object.getOwnPropertyNames(cell).sort(), ['x', 'y']);
        assert.doesNotMatch(JSON.stringify(cell), SECRETS);
    });

    test('the cell and the message carry nothing finer than the cell', () => {
        const cell = snapToCell(LAT, LON);
        const msg = JSON.stringify(locMessage(cell));
        assert.equal(msg, '{"t":"loc","x":5057,"y":2181}');
        assert.doesNotMatch(msg, SECRETS);
        const centre = cellCenter(cell);
        assert.ok(Math.abs(centre.lat - LAT) > 1e-4 || Math.abs(centre.lon - LON) > 1e-4, 'the centre is not the original point');
    });

    test('rejections contain no coordinates, whatever the failure', async () => {
        const geos = {
            denied: fakeGeo((ok, fail) => fail({ code: 1, message: `denied at ${LAT},${LON}` })),
            unavailable: fakeGeo((ok, fail) => fail({ code: 2, message: `lost ${LAT},${LON}` })),
            timeout: fakeGeo((ok, fail) => fail({ code: 3, message: `slow ${LAT},${LON}` })),
            thrown: fakeGeo(() => { throw new Error(`boom ${LAT},${LON}`); }),
            outOfRange: fakeGeo((ok) => ok(position(LAT + 100, LON + 200))),
            nonFinite: fakeGeo((ok) => ok(position(LAT, NaN))),
            unsupported: null,
        };
        for (const [name, geolocation] of Object.entries(geos)) {
            await assert.rejects(getApproxCell({ geolocation }), err => {
                assert.doesNotMatch(dumpError(err), SECRETS, name);
                assert.doesNotMatch(dumpError(err), /119\.07|272\.87|172\.87|119\.0760/, name);
                assert.equal(err.cause, undefined, name);
                assert.deepEqual(Object.getOwnPropertyNames(err).filter(k => !['stack', 'message', 'code'].includes(k)), [], name);
                return true;
            });
        }
    });

    test('snapToCell and cellCenter errors repeat no values', () => {
        for (const run of [() => snapToCell(LAT + 100, LON), () => snapToCell(LAT, LON + 200), () => snapToCell(LAT, LON, -LAT), () => cellCenter({ x: 99999, y: 1 })]) {
            try {
                run();
                assert.fail('should throw');
            } catch (err) {
                assert.ok(err instanceof RangeError);
                assert.doesNotMatch(dumpError(err), /119\.07|272\.87|19\.07|72\.87|99999/);
            }
        }
    });

    test('nothing is logged on success or on any failure', async () => {
        const calls = await withConsoleSpy(async () => {
            await getApproxCell({ geolocation: fakeGeo((ok) => ok(position(LAT, LON))) });
            for (const geolocation of [null, fakeGeo((ok, fail) => fail({ code: 1 })), fakeGeo(() => { throw new Error('x'); }), fakeGeo((ok) => ok(position(NaN, NaN)))]) {
                await getApproxCell({ geolocation }).catch(() => {});
            }
            try { snapToCell(LAT + 100, 0); } catch { /* expected */ }
            parseLocMessage({ t: 'loc', x: 1, y: 2 });
            parseLocMessage('garbage');
            describeDistance(123);
        });
        assert.deepEqual(calls, []);
    });

    test('the position object handed to the success callback is not retained or modified', async () => {
        const pos = position(LAT, LON);
        const before = JSON.stringify(pos);
        const cell = await getApproxCell({ geolocation: fakeGeo((ok) => ok(pos)) });
        assert.equal(JSON.stringify(pos), before);
        assert.ok(!Object.values(cell).includes(pos));
        assert.equal(Object.keys(cell).length, 2);
    });

    test('nothing is written to global state', async () => {
        const before = new Set(Object.getOwnPropertyNames(globalThis));
        await getApproxCell({ geolocation: fakeGeo((ok) => ok(position(LAT, LON))) });
        snapToCell(LAT, LON);
        const after = Object.getOwnPropertyNames(globalThis);
        assert.deepEqual(after.filter(k => !before.has(k)), []);
    });
});

// =====================================================================
// fuzzing
// =====================================================================

describe('fuzz', () => {
    const own = (pairs) => {
        const o = {};
        for (const [k, v] of pairs) Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
        return o;
    };

    const handmade = () => [
        null, undefined, true, false, 0, 1, -1, NaN, Infinity, -Infinity, 1.5, -0, 2 ** 53, 1e21, 5n, '', 'x', 'loc', '{"t":"loc","x":1,"y":2}', 'x'.repeat(100000), '\u0000', '\uD800',
        Symbol('s'), Symbol.iterator, () => 1, function () {}, class A {}, [], [1], [1, 2], [[]], [null], [{ x: 1, y: 2 }], ['t', 'loc'], new Array(5),
        {}, { x: 1 }, { y: 1 }, { x: 1, y: 2, z: 3 }, { t: 'loc' }, { t: 'loc', x: 1 }, { t: 'loc', x: 1, y: 2, z: 3 }, { t: 'loc', x: 1.5, y: 2 }, { t: 'loc', x: '1', y: '2' },
        { t: 'loc', x: -1, y: 2 }, { t: 'loc', x: 7200, y: 2 }, { t: 'loc', x: 1, y: 3600 }, { t: 'loc', x: NaN, y: 2 }, { t: 'loc', x: Infinity, y: 2 }, { t: 'loc', x: null, y: null },
        { t: 'loc', x: [1], y: [2] }, { t: 'loc', x: { valueOf: () => 1 }, y: { valueOf: () => 2 } }, { t: 'loc', x: true, y: false },
        { t: 'LOC', x: 1, y: 2 }, { t: 'loc ', x: 1, y: 2 }, { t: ['loc'], x: 1, y: 2 }, { t: { toString: () => 'loc' }, x: 1, y: 2 }, { t: new String('loc'), x: 1, y: 2 },
        { type: 'loc', x: 1, y: 2 }, { t: 'loc', lat: 19.07, lon: 72.87 }, { t: 'loc', x: 1, y: 2, lat: 19.07, lon: 72.87 },
        JSON.parse('{"__proto__":{"t":"loc","x":1,"y":2}}'), JSON.parse('{"t":"loc","x":1,"y":2,"__proto__":{"x":1}}'), JSON.parse('{"__proto__":{"x":1,"y":2}}'),
        JSON.parse('{"constructor":{"prototype":{"x":1,"y":2}}}'), JSON.parse('{"t":"loc","x":1,"y":2,"constructor":1}'), JSON.parse('{"t":"loc","x":1,"y":2,"prototype":1}'),
        JSON.parse('{"t":"loc","x":1e400,"y":2}'), JSON.parse('{"t":"loc","x":-1e400,"y":2}'), JSON.parse('{"t":"loc","x":1.0000000000000001,"y":2.5}'),
        Object.create({ t: 'loc', x: 1, y: 2 }), Object.create(Array.prototype), Object.create(null, { x: { value: 1 }, y: { value: 2 } }),
        Object.setPrototypeOf({ t: 'loc', x: 1, y: 2 }, { evil: 1 }), Object.setPrototypeOf({ t: 'loc', x: 1, y: 2 }, Array.prototype),
        new Map([['x', 1], ['y', 2]]), new Set([1, 2]), new Date(0), /re/g, new Int8Array(2), new Float64Array([1, 2]), new ArrayBuffer(8), new Error('e'), new Number(1), new String('loc'), new Boolean(true),
        new WeakMap(), Promise.resolve({ t: 'loc', x: 1, y: 2 }), Math, JSON, globalThis, Object, Object.prototype, Array.prototype,
        new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); }, getPrototypeOf() { throw new Error('boom'); } }),
        new Proxy({ t: 'loc', x: 1, y: 2 }, { getOwnPropertyDescriptor() { throw new Error('boom'); } }),
        { get x() { throw new Error('boom'); }, y: 1, t: 'loc' }, { get t() { return 'loc'; }, x: 1, y: 2 }, { x: 1, y: 2, [Symbol('s')]: 1 },
        Object.defineProperty({ t: 'loc', x: 1 }, 'y', { value: 2, enumerable: false }), Object.defineProperty({ t: 'loc', x: 1, y: 2 }, 'z', { value: 3, enumerable: false }),
        (() => { const c = { t: 'loc', x: 1, y: 2 }; c.me = c; return c; })(),
        (() => { let d = { t: 'loc', x: 1, y: 2 }; for (let i = 0; i < 20000; i++) d = { d }; return d; })(),
    ];

    // Oracle: written independently of the implementation.
    const oracleCell = (o, w, h) => {
        if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
        const keys = Reflect.ownKeys(o);
        if (keys.length !== 2 || !keys.includes('x') || !keys.includes('y')) return null;
        const { x, y } = o;
        const idx = (v, n) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n;
        return idx(x, w) && idx(y, h) ? { x: x + 0, y: y + 0 } : null;
    };

    const oracleMessage = (o, w, h) => {
        if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
        const keys = Reflect.ownKeys(o);
        if (keys.length !== 3 || !['t', 'x', 'y'].every(k => keys.includes(k)) || o.t !== 'loc') return null;
        return oracleCell({ x: o.x, y: o.y }, w, h);
    };

    const generated = (count, seed) => {
        const rand = seeded(seed);
        const keys = ['t', 'x', 'y', 'z', 'lat', 'lon', '__proto__', 'constructor', 'toString'];
        const vals = [0, 1, 2, 5, 100, 3000, 3599, 7199, -1, 7200, 3600, 1.5, NaN, Infinity, '1', '', null, undefined, true, [], {}, 'loc', 'chat', -0, 2 ** 53, 1e21, 5n, 19.07];
        const pick = () => vals[Math.floor(rand() * vals.length)];
        const out = [];
        for (let i = 0; i < count; i++) {
            const mode = rand();
            if (mode < 0.25) { out.push(own([['x', pick()], ['y', pick()]])); continue; } // a bare cell
            if (mode < 0.5) { out.push(own([['t', rand() < 0.8 ? 'loc' : pick()], ['x', pick()], ['y', pick()]])); continue; } // a message
            const pairs = [];
            const chosen = new Set();
            const n = Math.floor(rand() * 5);
            for (let j = 0; j < n; j++) chosen.add(keys[Math.floor(rand() * keys.length)]);
            if (rand() < 0.5) { chosen.add('x'); chosen.add('y'); }
            if (rand() < 0.4) chosen.add('t');
            for (const k of chosen) pairs.push([k, k === 't' && rand() < 0.7 ? 'loc' : vals[Math.floor(rand() * vals.length)]]);
            out.push(own(pairs));
        }
        return out;
    };

    test('handmade garbage: at least 200 values, none valid, none throws', () => {
        const garbage = [...handmade(), ...generated(400, 1).filter(v => oracleCell(v, 7200, 3600) === null && oracleMessage(v, 7200, 3600) === null)];
        assert.ok(garbage.length >= 200, `only ${garbage.length}`);
        const snapshot = Object.getOwnPropertyNames(Object.prototype).sort().join();
        let n = 0;
        for (const g of garbage) {
            n++;
            assert.doesNotThrow(() => isValidCell(g), `isValidCell #${n}`);
            assert.doesNotThrow(() => parseLocMessage(g), `parseLocMessage #${n}`);
            assert.equal(isValidCell(g), false, `isValidCell accepted garbage #${n}`);
            assert.equal(parseLocMessage(g), null, `parseLocMessage accepted garbage #${n}`);
            assert.equal(parseLocMessage(g, 0.5), null);
        }
        assert.equal(Object.getOwnPropertyNames(Object.prototype).sort().join(), snapshot, 'Object.prototype untouched');
        assert.equal(({}).x, undefined);
        assert.equal(({}).polluted, undefined);
    });

    test('garbage is also rejected whatever the cell size', () => {
        const rand = seeded(2);
        for (const g of handmade()) {
            for (const deg of [undefined, 0.05, 1, 7, 180, 0, NaN, 'a', null, {}, 0.001]) {
                assert.doesNotThrow(() => isValidCell(g, deg));
                assert.doesNotThrow(() => parseLocMessage(g, deg));
                assert.equal(parseLocMessage(g, deg), null);
            }
            assert.ok(rand() >= 0);
        }
    });

    test('1500 random messages agree with an independent oracle', () => {
        const messages = generated(1500, 42);
        let accepted = 0;
        let messagesAccepted = 0;
        for (const m of messages) {
            const cell = oracleCell(m, 7200, 3600);
            const expectedValid = cell !== null;
            assert.equal(isValidCell(m), expectedValid, `isValidCell ${safe(m)}`);
            const asMessage = oracleMessage(m, 7200, 3600);
            assert.deepEqual(parseLocMessage(m), asMessage, `parseLocMessage ${safe(m)}`);
            if (asMessage) messagesAccepted++;
            if (expectedValid) {
                assert.equal(parseLocMessage(m), null, `a bare cell is never a message ${safe(m)}`);
                accepted++;
                const msg = own([['t', 'loc'], ['x', m.x], ['y', m.y]]);
                assert.deepEqual(parseLocMessage(msg), cell);
                assert.equal(parseLocMessage(own([...Object.entries(msg), ['extra', 1]])), null);
            }
        }
        assert.ok(accepted > 20, `the generator should produce some valid cells (got ${accepted})`);
        assert.ok(messagesAccepted > 5, `and some valid messages (got ${messagesAccepted})`);
    });

    test('1500 random full messages agree with an independent oracle', () => {
        const rand = seeded(77);
        const vals = [0, 1, 5, 100, 3000, 3599, 7199, 7200, 3600, 1.5, NaN, Infinity, '1', null, undefined, true, [], {}, -1, -0, 2 ** 53, 1e21, 5n];
        const tags = ['loc', 'loc', 'loc', 'loc', 'loc', 'loc', 'LOC', '', 'chat', null, undefined, ['loc']];
        let accepted = 0;
        for (let i = 0; i < 1500; i++) {
            const t = tags[Math.floor(rand() * tags.length)];
            const x = vals[Math.floor(rand() * vals.length)];
            const y = vals[Math.floor(rand() * vals.length)];
            const msg = own([['t', t], ['x', x], ['y', y]]);
            const cell = oracleCell(own([['x', x], ['y', y]]), 7200, 3600);
            const want = t === 'loc' ? cell : null;
            assert.deepEqual(parseLocMessage(msg), want, `t=${String(t)} x=${String(x)} y=${String(y)}`);
            if (want) accepted++;
        }
        assert.ok(accepted > 30, `accepted ${accepted}`);
    });

    test('random valid cells always round trip through message, JSON and parse', () => {
        const rand = seeded(5);
        for (const deg of [undefined, 0.05, 0.01, 0.07, 1, 7, 180]) {
            const w = Math.ceil(360 / (deg ?? 0.05) - 1e-9);
            const h = Math.ceil(180 / (deg ?? 0.05) - 1e-9);
            for (let i = 0; i < 100; i++) {
                const c = { x: Math.floor(rand() * w), y: Math.floor(rand() * h) };
                assert.equal(isValidCell(c, deg), true);
                assert.deepEqual(parseLocMessage(JSON.parse(JSON.stringify(locMessage(c))), deg), c);
                assert.equal(isValidCell({ x: w, y: c.y }, deg), false);
                assert.equal(isValidCell({ x: c.x, y: h }, deg), false);
            }
        }
    });

    test('describeDistance and distanceKm survive garbage too', () => {
        for (const g of handmade()) {
            assert.doesNotThrow(() => describeDistance(g));
            assert.doesNotThrow(() => describeDistance(1, g));
            if (!throwsOnRead(g)) assert.doesNotThrow(() => distanceKm(g, g)); // garbage numbers and shapes, not objects that blow up when read
            if (typeof g !== 'number') assert.equal(describeDistance(g), '');
        }
    });

    function throwsOnRead(v) {
        try { void v?.lat; return false; } catch { return true; }
    }

    function safe(v) {
        try { return JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : Number.isNaN(x) ? 'NaN' : x === Infinity ? 'Infinity' : x)); } catch { return String(v); }
    }
});
