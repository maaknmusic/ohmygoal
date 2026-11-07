// Live world map (js/worldmap.js, functions/worldmap.js) in the real page against the emulators. MapLibre comes from the npm
// package in SP/ml (npm i maplibre-gl@5.24.0) instead of jsDelivr, and every map tile is a local picture.
// Checks: off by default; only adults who passed the age check can turn it on; the phone writes only its ~28 km square; nobody
// can read or forge anyone's pin; the server publishes counts only; turning it off removes you; a reload puts you back without
// asking; no zooming past city level; fits a phone.
// Needs: emulators (auth, firestore, functions) with SP/emu, the firebase npm package in SP/fb, a static server on 8765.
import { createRequire } from 'module';
import fs from 'fs';
import { execFileSync } from 'child_process';
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const SP = process.argv[2];
const FB = SP + '/fb/node_modules/firebase/';
const ML = SP + '/ml/node_modules/maplibre-gl/dist/';
const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8')
  .replace(/firebase: \{[\s\S]*?\n    \},/, `firebase: { apiKey: 'fake-key', authDomain: 'demo-ohmygoal.firebaseapp.com', projectId: 'demo-ohmygoal', appId: '1:1:web:1' },
    emulators: { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080], functions: ['127.0.0.1', 5001] },`);
const tile = fs.readFileSync('/home/user/ohmygoal/icons/icon-192.png');
const { snapToCell } = await import('/home/user/ohmygoal/js/location.js');
const DELHI = { latitude: 28.6139, longitude: 77.209 }, MUMBAI = { latitude: 19.076, longitude: 72.8777 };
const cellOf = g => snapToCell(g.latitude, g.longitude, 0.25);

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'] });
const logs = [];
let tiles = 0, osmTiles = 0;
async function device(name, { geo, adult = true, width = 1280, height = 800, ctx: given } = {}) {
  const ctx = given || await browser.newContext({ permissions: ['camera', 'microphone', 'geolocation'], geolocation: geo, serviceWorkers: 'block', viewport: { width, height } });
  if (!given) {
    await ctx.addInitScript(() => { try { localStorage.setItem('ac.safetyBrief', 'true'); localStorage.setItem('ac.hideIp', 'false'); } catch { /* storage off */ } });
    if (adult) await ctx.addInitScript(() => localStorage.setItem('ac.ageVerifiedUntil', String(Date.now() + 864e5)));
    await ctx.route('**/config.js', r => r.fulfill({ body: cfg, contentType: 'text/javascript' }));
    await ctx.route('https://www.gstatic.com/firebasejs/11.6.1/*', r => r.fulfill({ body: fs.readFileSync(FB + r.request().url().split('/').pop()), contentType: 'text/javascript' }));
    await ctx.route(/jsdelivr|fonts\.g|country\.is|googlesyndication/, r => {
      const m = r.request().url().match(/maplibre-gl@5\.24\.0\/dist\/(maplibre-gl\.(js|css))$/);
      return m ? r.fulfill({ body: fs.readFileSync(ML + m[1]), contentType: m[2] === 'js' ? 'text/javascript' : 'text/css' }) : r.abort();
    });
    await ctx.route(/tile\.openstreetmap\.org/, r => { tiles++; if (/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(r.request().url())) osmTiles++; return r.fulfill({ body: tile, contentType: 'image/png' }); });
  }
  const p = await ctx.newPage();
  p.on('pageerror', e => logs.push(name + ' PAGEERR ' + e.message));
  p.on('console', m => { if (/permission|failed|error/i.test(m.text()) && !/Failed to load resource|nudity|face-api|signal listener|WebGL|GPU stall|GroupMarkerNotSet/i.test(m.text())) logs.push(name + ': ' + m.text().slice(0, 200)); });
  await p.goto('http://localhost:8765/index.html');
  await p.fill('#nickInput', name);
  if (adult) await p.check('#ageCheck');
  await p.waitForFunction(() => document.getElementById('startBtn').textContent === 'Start chatting', null, { timeout: 20000 });
  return { p, ctx };
}
const step = (n, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${extra}`);
const sdk = (p, fn, arg) => p.evaluate(async ([src, arg]) => {
  const app = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js');
  const authM = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js');
  const f = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const a = app.getApp(); const auth = authM.getAuth(a); const db = f.getFirestore(a);
  const base = ['artifacts', 'anon-connect', 'public', 'data'];
  const tryIt = async fn => { try { await fn(); return 'ALLOWED'; } catch (e) { return e.code; } };
  return await (eval(src))({ auth, db, f, base, tryIt, arg });
}, [fn.toString(), arg]);
// The server job (functions/worldmap.js saveMapCells), run with the Admin SDK against the emulator.
function serverCount(clearFirst = false) {
  const out = execFileSync('node', ['-e', `import('./worldmap.js').then(async m => { const { publicCol } = await import('./common.js');
    if (${clearFirst}) { for (const d of (await publicCol('mapPins').get()).docs) await d.ref.delete(); }
    const pins = (await publicCol('mapPins').get()).docs.map(d => ({ id: d.id, ...d.data() }));
    const r = await m.saveMapCells(); const doc = (await m.mapRef().get()).data();
    console.log(JSON.stringify({ r, doc, pins })); process.exit(0); })`], { cwd: SP + '/emu/functions', env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: 'demo-ohmygoal', APP_ID: 'anon-connect' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.trim().split('\n').pop());
}
const toasts = p => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
const until = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

serverCount(true); // a clean start: no pins from earlier runs
const { p: A } = await device('Asha', { geo: DELHI });

// ---- 1. the button, the globe, off by default
await A.click('#mapBtn');
const opened = await until(A, () => !document.getElementById('mapView').classList.contains('hidden') && window.__worldMap?.loaded());
step('1a. "Live world map" opens a full-screen globe (MapLibre, globe projection, OpenStreetMap tiles)', opened && await A.evaluate(() => window.__worldMap.getProjection()?.type === 'globe') && osmTiles > 0, JSON.stringify({ opened, osmTiles }));
step('1b. "Show me on the map" is off by default, and the attribution to OpenStreetMap is shown', await A.evaluate(() => !document.getElementById('mapShowMe').checked) && /OpenStreetMap/.test(await A.textContent('#mapView')));
step('1c. you cannot zoom in past city level', await A.evaluate(() => window.__worldMap.getMaxZoom()) === 9);
step('1d. the empty map says so', await until(A, () => /No one is on the map|warming up/.test(document.getElementById('mapMsg').textContent)));

// ---- 2. turning it on: only your ~28 km square is written, and nobody can read it back
await A.click('.map-switch');
const on = await until(A, () => document.getElementById('mapShowMe').checked && /You’re on the map/.test([...document.querySelectorAll('.toast')].map(t => t.textContent).join(' ')));
step('2a. an adult who passed the age check turns it on; it says only a count for the area is shown', on, await toasts(A));
const s1 = serverCount();
const pinA = s1.pins[0];
step('2b. the phone wrote only its square (x, y) and a time: no coordinates, no name', s1.pins.length === 1 && JSON.stringify(Object.keys(pinA).sort()) === JSON.stringify(['id', 'ts', 'x', 'y']) && pinA.x === cellOf(DELHI).x && pinA.y === cellOf(DELHI).y, JSON.stringify(s1.pins));
step('2c. the server publishes only counts per square: {at, total, c:[x, y, n]}', s1.doc.total === 1 && JSON.stringify(s1.doc.c) === JSON.stringify([cellOf(DELHI).x, cellOf(DELHI).y, 1]) && JSON.stringify(Object.keys(s1.doc).sort()) === '["at","c","total"]', JSON.stringify(s1.doc));

// ---- 3. someone under the age check cannot be shown
const { p: C } = await device('Chen', { geo: DELHI, adult: false });
await C.click('#mapBtn');
await until(C, () => window.__worldMap?.loaded());
await C.click('.map-switch');
await C.waitForTimeout(800);
step('3a. without confirming 18+ (and the age check), the switch stays off and nothing is written', await C.evaluate(() => !document.getElementById('mapShowMe').checked) && /18\+/.test(await toasts(C)) && serverCount().pins.length === 1, await toasts(C));

// ---- 4. a second person in Mumbai; the first sees both, live
const { p: B, ctx: ctxB } = await device('Bilal', { geo: MUMBAI });
await B.click('#mapBtn');
await until(B, () => window.__worldMap?.loaded());
await B.click('.map-switch');
await until(B, () => document.getElementById('mapShowMe').checked);
await B.waitForTimeout(800);
const s2 = serverCount();
step('4a. the server counts both squares', s2.doc.total === 2 && s2.doc.c.length === 6, JSON.stringify(s2.doc));
const live = await until(A, () => document.getElementById('mapTotal').textContent === '2 on the map');
step('4b. the open map updates by itself: "2 on the map"', live, await A.textContent('#mapTotal'));
step('4c. it draws a bubble for them', await until(A, () => window.__worldMap.queryRenderedFeatures({ layers: ['people'] }).length > 0));

// ---- 5. tapping a bubble: how many people, and a way to talk
await A.evaluate(() => { const m = window.__worldMap; m.jumpTo({ center: [72.875, 19.125], zoom: 6 }); });
await A.waitForTimeout(1200);
const pt = await A.evaluate(([lon, lat]) => { const m = window.__worldMap; const r = m.getCanvas().getBoundingClientRect(); const q = m.project([lon, lat]); return { x: r.left + q.x, y: r.top + q.y }; }, [72.875, 19.125]);
await A.mouse.click(pt.x, pt.y);
const pop = await until(A, () => !!document.querySelector('.map-pop'), null, 5000);
step('5a. tapping Mumbai\'s bubble says "1 person online around here" and offers "Talk to someone", with no name or profile', pop && /^1 person online around here\s*Talk to someone$/.test((await A.textContent('.map-pop')).trim()), pop ? await A.textContent('.map-pop') : 'no popup');

// ---- 6. nobody can read or forge pins, or the counts
const attacks = await sdk(A, async ({ auth, db, f, base, tryIt, arg }) => {
  const pin = id => f.doc(db, ...base, 'mapPins', id);
  const me = auth.currentUser.uid;
  return {
    readOther: await tryIt(() => f.getDoc(pin(arg))),
    readOwn: await tryIt(() => f.getDoc(pin(me))),
    list: await tryIt(() => f.getDocs(f.collection(db, ...base, 'mapPins'))),
    writeOther: await tryIt(() => f.setDoc(pin(arg), { x: 1, y: 1, ts: Date.now() })),
    deleteOther: await tryIt(() => f.deleteDoc(pin(arg))),
    withCoords: await tryIt(() => f.setDoc(pin(me), { x: 1, y: 1, ts: Date.now(), lat: 28.61 })),
    fineGrid: await tryIt(() => f.setDoc(pin(me), { x: 2000, y: 1, ts: Date.now() })),
    notWhole: await tryIt(() => f.setDoc(pin(me), { x: 1.5, y: 1, ts: Date.now() })),
    oldTime: await tryIt(() => f.setDoc(pin(me), { x: 1, y: 1, ts: Date.now() - 3600000 })),
    fakeCounts: await tryIt(() => f.setDoc(f.doc(db, ...base, 'counters', 'map'), { at: Date.now(), total: 999, c: [1, 1, 999] })),
    readCounts: await tryIt(() => f.getDoc(f.doc(db, ...base, 'counters', 'map'))),
  };
}, s2.pins.find(x => x.id !== pinA.id).id);
const denied = ['readOther', 'readOwn', 'list', 'writeOther', 'deleteOther', 'withCoords', 'fineGrid', 'notWhole', 'oldTime', 'fakeCounts'];
step('6a. nobody can read pins (not even their own), forge someone else\'s, add coordinates, use a finer grid, or fake the counts', denied.every(k => attacks[k] === 'permission-denied') && attacks.readCounts === 'ALLOWED', JSON.stringify(attacks));

// ---- 7. turning it off removes you at once
await A.click('.map-switch');
await until(A, () => !document.getElementById('mapShowMe').checked);
await A.waitForTimeout(800);
const s3 = serverCount();
step('7a. turning it off deletes the pin straight away; the next count no longer has you', s3.pins.length === 1 && s3.doc.total === 1 && /hidden from the map/.test(await toasts(A)), JSON.stringify(s3.doc));

// ---- 8. coming back: someone who chose to be on the map is put back without asking; leaving takes them off
await B.close();
await new Promise(r => setTimeout(r, 800));
const gone = serverCount();
const { p: B2 } = await device('Bilal', { ctx: ctxB });
await until(B2, () => document.getElementById('mapShowMe').checked, null, 15000);
await B2.waitForTimeout(1000);
const back = serverCount();
step('8a. closing the page takes you off the map; opening it again puts you back without asking (location already allowed)', gone.doc.total === 0 && back.doc.total === 1 && back.pins.length === 1, JSON.stringify({ gone: gone.doc.total, back: back.doc.total }));

// ---- 9. stale counts are not shown as live
const stale = await A.evaluate(async () => (await import('/js/worldmap.js')).readMapDoc({ at: Date.now() - 11 * 60000, total: 5, c: [1, 1, 5] }));
step('9a. counts older than 10 minutes (server job stopped) are not shown', stale === null);

// ---- 10. a phone
const { p: P } = await device('Pia', { geo: DELHI, width: 360, height: 740 });
await P.click('#mapBtn');
await until(P, () => window.__worldMap?.loaded());
const fit = await P.evaluate(() => ({ sx: document.documentElement.scrollWidth, panel: document.querySelector('.map-panel').getBoundingClientRect(), canvas: document.getElementById('mapCanvas').getBoundingClientRect().height, close: document.getElementById('mapClose').getBoundingClientRect() }));
step('10a. on a 360 px phone: no sideways scroll, the switch panel and close button are on screen, the globe gets the rest', fit.sx <= 360 && fit.panel.bottom <= 740 && fit.panel.top > 300 && fit.canvas > 300 && fit.close.right <= 360 && fit.close.width >= 44, JSON.stringify(fit));
await P.screenshot({ path: SP + '/worldmap-phone.png' });
await P.keyboard.press('Escape');
step('10b. Escape closes it and the page is back', await P.evaluate(() => document.getElementById('mapView').classList.contains('hidden') && !document.body.classList.contains('map-open')));

await A.evaluate(() => { const m = window.__worldMap; m.jumpTo({ center: [77, 22], zoom: 3.2 }); });
await A.waitForTimeout(1500);
await A.screenshot({ path: SP + '/worldmap-desktop.png' });
step('11. no page errors', !logs.length, logs.join('\n'));
await browser.close();
