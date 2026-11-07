// Live world map: the published counts are read safely, the server counts squares correctly, and the privacy rules hold
// (js/worldmap.js, functions/worldmap.js, firestore.rules). The real page is in tests/e2e/worldmap-emulator.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readMapDoc, withMe, toGeoJSON, peopleText, totalText, MAP_CELL_DEG, GRID_W, GRID_H, MAP_STALE_MS, MAX_ZOOM } from '../../js/worldmap.js';
import { snapToCell, cellCenter } from '../../js/location.js';

const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const now = 1_800_000_000_000;

test('client and server use the same ~28 km grid, and the map stops at city level', async () => {
    const server = read('functions/worldmap.js');
    assert.match(server, /export const MAP_CELL_DEG = 0\.25;/);
    assert.equal(MAP_CELL_DEG, 0.25);
    assert.equal(GRID_W, 360 / MAP_CELL_DEG);
    assert.equal(GRID_H, 180 / MAP_CELL_DEG);
    assert.ok(MAX_ZOOM <= 9);
    const delhi = snapToCell(28.6139, 77.209, MAP_CELL_DEG);
    const c = cellCenter(delhi, MAP_CELL_DEG);
    assert.ok(Math.abs(c.lat - 28.6139) <= 0.125 && Math.abs(c.lon - 77.209) <= 0.125, 'the bubble sits at the middle of the square, not on the person');
});

test('readMapDoc: fresh, well-formed counts only; anything odd is dropped, never thrown', () => {
    assert.deepEqual(readMapDoc({ at: now, total: 3, c: [1, 2, 2, 3, 4, 1] }, now), { at: now, total: 3, cells: [{ x: 1, y: 2, n: 2 }, { x: 3, y: 4, n: 1 }] });
    assert.equal(readMapDoc({ at: now - MAP_STALE_MS - 1, total: 1, c: [1, 1, 1] }, now), null, 'stale: the server job stopped');
    assert.equal(readMapDoc(null, now), null);
    assert.equal(readMapDoc({ at: now, c: [1, 2] }, now), null, 'not whole triples');
    assert.equal(readMapDoc({ at: 'x', c: [] }, now), null);
    const odd = readMapDoc({ at: now, c: [-1, 0, 1, GRID_W, 0, 1, 0, GRID_H, 1, 1.5, 1, 1, 1, 1, 0, 1, 1, -2, 2, 2, 7] }, now);
    assert.deepEqual(odd.cells, [{ x: 2, y: 2, n: 7 }], 'off-grid, fractional and non-positive entries are skipped');
    assert.equal(odd.total, 7, 'total falls back to the sum');
    const getter = { at: now, get c() { throw new Error('boom'); } };
    assert.equal(readMapDoc(getter, now), null);
});

test('withMe: you see yourself straight away, and are not counted twice once the server has you', () => {
    const d = { at: now, total: 2, cells: [{ x: 5, y: 5, n: 2 }] };
    assert.deepEqual(withMe(d, { x: 5, y: 5 }, now + 1).cells, [{ x: 5, y: 5, n: 3 }]);
    assert.equal(withMe(d, { x: 5, y: 5 }, now + 1).total, 3);
    assert.deepEqual(withMe(d, { x: 9, y: 9 }, now + 1).cells, [{ x: 5, y: 5, n: 2 }, { x: 9, y: 9, n: 1 }]);
    assert.equal(withMe(d, { x: 5, y: 5 }, now - 1), d, 'already counted');
    assert.equal(d.cells[0].n, 2, 'the input is not changed');
    assert.deepEqual(withMe(null, { x: 1, y: 1 }, now).cells, [{ x: 1, y: 1, n: 1 }]);
    assert.equal(withMe(d, { x: -1, y: 1 }, now + 1), d);
});

test('toGeoJSON puts one point per square at its centre, carrying only the count', () => {
    const g = toGeoJSON([{ x: 1028, y: 474, n: 4 }]);
    assert.equal(g.features.length, 1);
    assert.deepEqual(g.features[0].properties, { n: 4 });
    const { lat, lon } = cellCenter({ x: 1028, y: 474 }, MAP_CELL_DEG);
    assert.deepEqual(g.features[0].geometry.coordinates, [lon, lat]);
});

test('texts', () => {
    assert.equal(peopleText(1), '1 person online around here');
    assert.equal(peopleText(12), 'About 12 people online around here');
    assert.equal(totalText(1), '1 on the map');
    assert.equal(totalText(40), '40 on the map');
});

test('server: tallyPins counts per square, busiest first, and skips bad pins', async () => {
    const { tallyPins, MAX_CELLS } = await import('../../functions/worldmap.js');
    const r = tallyPins([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 3 }, { x: 1, y: 1 }, null, { x: 1440, y: 0 }, { x: 0, y: 720 }, { x: 1.5, y: 1 }, { x: '1', y: 1 }]);
    assert.deepEqual(r, { total: 4, c: [1, 1, 3, 2, 3, 1] });
    assert.deepEqual(tallyPins([]), { total: 0, c: [] });
    const many = Array.from({ length: MAX_CELLS + 50 }, (_, i) => ({ x: i % 1440, y: Math.floor(i / 1440) }));
    assert.equal(tallyPins(many).c.length, MAX_CELLS * 3, 'the published document stays small');
});

test('server: the count runs every other minute inside countOnline, and publishes nothing but counts', () => {
    const stats = read('functions/stats.js');
    assert.match(stats, /import \{ saveMapCells \} from '\.\/worldmap\.js';/);
    assert.match(stats, /% 2 === 0\) try \{ await saveMapCells\(\); \}/);
    const server = read('functions/worldmap.js');
    assert.match(server, /\.select\('x', 'y'\)/);
    assert.match(server, /await mapRef\(\)\.set\(\{ at: now, total, c \}\);/);
});

test('rules: pins are write-only for their owner, with exactly a square and a time; nobody can read them', () => {
    const rules = read('firestore.rules');
    const block = rules.slice(rules.indexOf('match /mapPins/{uid}'), rules.indexOf('match /presence/{uid}'));
    assert.match(block, /allow read: if false;/);
    assert.match(block, /request\.auth\.uid == uid/);
    assert.match(block, /keys\(\)\.hasOnly\(\['x', 'y', 'ts'\]\)/);
    assert.match(block, /data\.x is int && request\.resource\.data\.x >= 0 && request\.resource\.data\.x < 1440/);
    assert.match(block, /data\.y is int && request\.resource\.data\.y >= 0 && request\.resource\.data\.y < 720/);
    assert.match(block, /recentTs\(request\.resource\.data\.ts\)/);
    const counters = rules.slice(rules.indexOf('match /counters/{id}'));
    assert.match(counters, /allow write: if false;/);
});

test('the app: off by default, 18+ and the age check first, reads only while the map is open, OpenStreetMap credited', () => {
    const app = read('js/app.js');
    const map = read('js/worldmap.js');
    assert.match(app, /if \(!el\.ageCheck\.checked\) return 'Please confirm you are 18\+ to continue\.';/);
    assert.match(app, /if \(!ageVerified\(\)\) return/);
    assert.match(app, /getCell: \(\) => getApproxCell\(\{ cellDeg: MAP_CELL_DEG \}\)/);
    assert.match(app, /maplibre-gl@5\.24\.0\/dist\/maplibre-gl\.js/);
    assert.match(app, /© OpenStreetMap contributors/);
    assert.match(map, /if \(unwatch\) \{ unwatch\(\); unwatch = null; \}/);
    assert.match(map, /store\.get\('mapShow', false\)/);
    assert.match(map, /permissions\?\.query\(\{ name: 'geolocation' \}\)/, 'never asks for location on its own at start-up');
    const html = read('index.html');
    assert.match(html, /<input type="checkbox" id="mapShowMe" role="switch">/);
    assert.doesNotMatch(html, /id="mapShowMe"[^>]*checked/);
    assert.match(read('sw.js'), /'js\/worldmap\.js'/);
    assert.match(read('legal.html'), /Live world map/);
});
