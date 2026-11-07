// The live world map: who is online, city by city. Run by countOnline (functions/stats.js) every other minute.
//
// Privacy first. Nobody is on the map unless they turned on "Show me on the map". Their phone rounds the position to a
// square of MAP_CELL_DEG degrees (about 28 km) and keeps only the square's numbers; that is all it writes, to
// mapPins/{uid}. Phones can never read mapPins (firestore.rules): this job counts the squares and publishes only
// "n people in square (x, y)" to counters/map. So no phone ever learns who is where, only how many people are around a city.
// Turning it off deletes the pin at once; a pin that is not refreshed for PIN_WINDOW_MS (the app was closed) stops counting.
import { publicCol, publicDoc } from './common.js';

export const MAP_CELL_DEG = 0.25; // must match js/worldmap.js
export const GRID_W = 360 / MAP_CELL_DEG; // 1440
export const GRID_H = 180 / MAP_CELL_DEG; // 720
export const PIN_WINDOW_MS = 6 * 60000; // phones refresh their pin every 3 minutes while the app is open
export const PIN_DELETE_MS = 60 * 60000; // pins older than this are deleted
export const MAX_CELLS = 20000; // keeps counters/map far below the 1 MB document limit
export const mapRef = () => publicDoc('counters/map');

const isIndex = (v, max) => Number.isInteger(v) && v >= 0 && v < max;

/** Count pins per square. Returns { total, c } where c is flat [x, y, n, x, y, n, ...], busiest squares first. Bad pins are skipped. */
export function tallyPins(pins) {
    const counts = new Map();
    let total = 0;
    for (const p of pins) {
        if (!p || !isIndex(p.x, GRID_W) || !isIndex(p.y, GRID_H)) continue;
        const key = p.y * GRID_W + p.x;
        counts.set(key, (counts.get(key) || 0) + 1);
        total++;
    }
    const cells = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, MAX_CELLS);
    return { total, c: cells.flatMap(([key, n]) => [key % GRID_W, Math.floor(key / GRID_W), n]) };
}

/** Rewrite counters/map from the fresh pins, and clear out a batch of long-dead ones. */
export async function saveMapCells(now = Date.now()) {
    const snap = await publicCol('mapPins').where('ts', '>', now - PIN_WINDOW_MS).select('x', 'y').get();
    const { total, c } = tallyPins(snap.docs.map(d => d.data()));
    await mapRef().set({ at: now, total, c });
    const dead = await publicCol('mapPins').where('ts', '<', now - PIN_DELETE_MS).limit(300).get();
    await Promise.all(dead.docs.map(d => d.ref.delete()));
    return { total, cells: c.length / 3, deleted: dead.size };
}
