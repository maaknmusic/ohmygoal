// The visit log (functions/visits.js): addresses read and checked, device lines, one row per half hour, the admin search,
// the place lookup and its cache limits, the retention, the wiring, and the Privacy Policy saying all of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { plainIp, isPublic, reportedIps, deviceText, visitId, geoFrom, parseQuery, placesWanted, VISIT_BUCKET_MS, VISIT_KEEP_MS, GEO_KEEP_MS } from '../../functions/visits.js';

const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('addresses: full IPv6 kept (not cut to /64), mapped IPv4 unwrapped, junk refused', () => {
    assert.equal(plainIp('49.36.12.7'), '49.36.12.7');
    assert.equal(plainIp('2401:4900:1C2A:8F00::5'), '2401:4900:1c2a:8f00::5');
    assert.equal(plainIp('[2401:4900::1]'), '2401:4900::1');
    assert.equal(plainIp('::ffff:49.36.12.7'), '49.36.12.7');
    for (const bad of ['', 'localhost', '1.2.3', '999.1.1.1', '<script>', '49.36.12.7, 1.1.1.1']) assert.equal(plainIp(bad), '', bad);
});

test('public addresses only: private, loopback, link-local, carrier-shared and multicast are not', () => {
    for (const ip of ['49.36.12.7', '8.8.8.8', '2401:4900::1']) assert.ok(isPublic(ip), ip);
    for (const ip of ['10.0.0.1', '192.168.1.5', '172.20.0.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', 'ff02::1', '::']) assert.ok(!isPublic(ip), ip);
});

test('reported addresses: right protocol, public, not the one the server saw; anything else dropped', () => {
    assert.deepEqual(reportedIps({ v4: '49.36.12.7', v6: '2401:4900::1' }, '49.36.12.7'), { v6: '2401:4900::1' });
    assert.deepEqual(reportedIps({ v4: '49.36.12.7', v6: '2401:4900::1' }, '2401:4900::1'), { v4: '49.36.12.7' });
    assert.deepEqual(reportedIps({ v4: '2401:4900::1', v6: '49.36.12.7' }, 'x'), {}, 'swapped protocols');
    assert.deepEqual(reportedIps({ v4: '192.168.0.2', v6: 'fe80::1' }, 'x'), {});
    assert.deepEqual(reportedIps({ v4: ['8.8.8.8', '1.1.1.1'], v6: 7 }, 'x'), {}, 'not strings');
    assert.deepEqual(reportedIps(null, 'x'), {});
    assert.deepEqual(reportedIps('junk', 'x'), {});
});

test('device lines: the right browser (Edge, Samsung, Safari are not "Chrome"), the system and the phone model', () => {
    const ua = {
        pixel: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        reduced: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        samsung: 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
        firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
    };
    assert.equal(deviceText(ua.pixel), 'Chrome 131 · Android 14 · Pixel 7');
    assert.equal(deviceText(ua.reduced), 'Chrome 131 · Android 10', 'the reduced user agent hides the model ("K")');
    assert.equal(deviceText(ua.iphone), 'Safari 17 · iOS 17 · iPhone');
    assert.equal(deviceText(ua.edge), 'Edge 131 · Windows 10/11');
    assert.equal(deviceText(ua.samsung), 'Samsung Internet 25 · Android 13 · SM-A536E');
    assert.equal(deviceText(ua.firefox), 'Firefox 132 · Linux');
    assert.equal(deviceText(''), '');
    assert.ok(deviceText('x'.repeat(5000)).length <= 120);
});

test('one row per account + address + device per half hour', () => {
    const t = 1_800_000_000_000 - (1_800_000_000_000 % VISIT_BUCKET_MS);
    assert.equal(visitId('u1', '1.2.3.4', 'f', t), visitId('u1', '1.2.3.4', 'f', t + VISIT_BUCKET_MS - 1));
    assert.notEqual(visitId('u1', '1.2.3.4', 'f', t), visitId('u1', '1.2.3.4', 'f', t + VISIT_BUCKET_MS));
    assert.notEqual(visitId('u1', '1.2.3.4', 'f', t), visitId('u1', '1.2.3.5', 'f', t));
    assert.notEqual(visitId('u1', '1.2.3.4', 'f', t), visitId('u2', '1.2.3.4', 'f', t));
    assert.notEqual(visitId('u1', '1.2.3.4', 'f', t), visitId('u1', '1.2.3.4', 'g', t));
    assert.match(visitId('u1', '1.2.3.4', 'f', t), /^\d+_[a-f0-9]{24}$/, 'no address or account in the document name');
});

test('the admin search understands IPs, emails, device IDs and account IDs', () => {
    assert.deepEqual(parseQuery(''), { type: 'latest' });
    assert.deepEqual(parseQuery(' 49.36.12.7 '), { type: 'ip', value: '49.36.12.7' });
    assert.deepEqual(parseQuery('2401:4900:1C2A::5'), { type: 'ip', value: '2401:4900:1c2a::5' });
    assert.deepEqual(parseQuery('Name@Gmail.com'), { type: 'email', value: 'name@gmail.com' });
    assert.deepEqual(parseQuery('a1b2c3d4e5f60718'), { type: 'fp', value: 'a1b2c3d4e5f60718' });
    assert.deepEqual(parseQuery('Xy7KfLmNoPqRsTuVwXyZ12345678'), { type: 'uid', value: 'Xy7KfLmNoPqRsTuVwXyZ12345678' });
    assert.deepEqual(parseQuery('drop table; <b>'), { type: 'invalid' });
});

test('places: only the place and the network are kept from IPinfo, cleaned and cut short; nothing for private addresses', () => {
    assert.deepEqual(geoFrom({ ip: '1.2.3.4', city: 'New Delhi', region: 'Delhi', country: 'in', org: 'AS24560 Bharti Airtel', timezone: 'Asia/Kolkata', loc: '28.6,77.2', postal: '110001', hostname: 'x' }),
        { city: 'New Delhi', region: 'Delhi', country: 'IN', org: 'AS24560 Bharti Airtel', tz: 'Asia/Kolkata' });
    assert.equal(geoFrom({ ip: '10.0.0.1', bogon: true }), null);
    assert.equal(geoFrom(null), null);
    assert.equal(geoFrom({ city: 'A\u0000\u001bB'.padEnd(500, 'x') }).city.length, 60);
});

test('places saved at visit time: each address of a row gets one, a changed address gets a new one, private ones none', () => {
    assert.deepEqual(placesWanted({ ip: '49.36.12.7', r6: '2401:4900::1' }), [['g', '49.36.12.7'], ['g6', '2401:4900::1']]);
    assert.deepEqual(placesWanted({ ip: '49.36.12.7', g: { ip: '49.36.12.7', city: 'Delhi' } }), [], 'already saved: nothing to do (so saving it does not loop)');
    assert.deepEqual(placesWanted({ ip: '49.36.12.7', r4: '1.1.1.1', g4: { ip: '8.8.8.8' } }), [['g', '49.36.12.7'], ['g4', '1.1.1.1']], 'the device reported a new address: its place again');
    assert.deepEqual(placesWanted({ ip: '10.0.0.1' }), []);
    assert.deepEqual(placesWanted(null), []);
    const v = read('functions/visits.js');
    assert.match(v, /export const onVisitWritten = onDocumentWritten\(\{ document: 'artifacts\/anon-connect\/private\/data\/visits\/\{visitId\}', retry: false \}/);
    assert.match(read('functions/index.js'), /export \{ onVisitWritten \} from '\.\/visits\.js';/);
});

test('kept 90 days (cached places 7), swept with the other records; only the server can touch them', () => {
    assert.equal(VISIT_KEEP_MS, 90 * 86400000);
    assert.equal(GEO_KEEP_MS, 7 * 86400000);
    const mod = read('functions/moderation.js');
    assert.match(mod, /\['visits', 'last', VISIT_KEEP_MS\]/);
    assert.match(mod, /\['ipgeo', 'at', GEO_KEEP_MS\]/);
    assert.match(read('functions/visits.js'), /privateCol\('visits'\)/);
    const rules = read('firestore.rules');
    assert.doesNotMatch(rules, /match \/(visits|ipgeo)/, 'no client rule: the private tree is closed to every phone');
    assert.doesNotMatch(rules, /match \/artifacts\/anon-connect\/private/);
});

test('wiring: every check-in is logged without ever blocking it; the admin action answers only admins', () => {
    const mod = read('functions/moderation.js');
    assert.match(mod, /await recordVisit\(\{ uid: who\.uid, ip: who\.addr, fp: who\.fp, token: request\.auth\.token, req: request\.rawRequest, reported: request\.data\?\.ips \}\)\n\s+\.catch\(/);
    const adminFn = mod.slice(mod.indexOf('export const admin = onCall'));
    assert.match(adminFn, /const email = requireAdmin\(request\);[\s\S]*case 'visits': \{[\s\S]*return listVisits\(request\.data\.q\);/);
    const access = read('js/access.js');
    assert.match(access, /api4\.ipify\.org\?format=json/);
    assert.match(access, /api6\.ipify\.org\?format=json/);
    assert.match(access, /within\(ownAddresses\(\), 1500\)/, 'a slow lookup is not waited for');
    assert.match(access, /credentials: 'omit', referrerPolicy: 'no-referrer'/);
    assert.match(read('admin.html'), /<button data-tab="visits">Visits<\/button>/);
    assert.match(read('admin.html'), /IP address data powered by <a href="https:\/\/ipinfo\.io"/);
});

test('the Privacy Policy says what is logged, why, who sees it, the services used and how long it is kept', () => {
    const legal = read('legal.html');
    assert.match(legal, /<li><b>Visit log \(fraud and abuse prevention\):<\/b>[^<]*IP address our server sees[^<]*ipify[^<]*device identifier[^<]*email[^<]*Only the site’s administrators[^<]*IPinfo and saved with the record[^<]*deleted 90 days after the visit\.<\/li>/);
    assert.match(legal, /ipify \(tells your device its own IPv4 and IPv6 address, for the visit log\) and IPinfo/);
    assert.match(read('config.js'), /policiesUpdated: '19 November 2026'/);
});
