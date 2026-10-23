// Tonight's rooms: ids are validated, the IST schedule says what is busy, and the text is readable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, THEME_IDS, OPEN, themeId, themeById, isBusy, nextBusy, busyNow, featured, scheduleText } from '/home/user/ohmygoal/js/rooms.js';

// 2026-10-21 is a Wednesday. IST = UTC + 5:30.
const ist = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const WED = (h, mi) => ist(2026, 10, 21, h, mi);
const SAT = (h, mi) => ist(2026, 10, 24, h, mi);
const SUN = (h, mi) => ist(2026, 10, 25, h, mi);

test('theme ids are known, unique and frozen; everything else is open chat', () => {
    assert.equal(new Set(THEME_IDS).size, THEMES.length);
    assert.ok(THEMES.length >= 5);
    assert.ok(Object.isFrozen(THEMES) && Object.isFrozen(THEMES[0]));
    for (const id of THEME_IDS) { assert.equal(themeId(id), id); assert.equal(themeById(id).id, id); assert.ok(themeById(id).name && themeById(id).blurb); }
    for (const bad of ['', 'nope', '__proto__', 'constructor', 'toString', 'STUDY', ' study', 5, null, undefined, {}, [], ['study']]) assert.equal(themeId(bad), '', String(bad));
    assert.equal(themeById('nope'), OPEN);
    assert.equal(themeById('__proto__'), OPEN);
});

test('busy windows follow IST, not the visitor’s own time zone', () => {
    const study = themeById('study');
    assert.equal(isBusy(study, WED(20, 0)), true);
    assert.equal(isBusy(study, WED(21, 59)), true);
    assert.equal(isBusy(study, WED(22, 0)), false);
    assert.equal(isBusy(study, WED(19, 59)), false);
    assert.equal(isBusy(study, SAT(20, 30)), false);   // not on Saturday
    assert.equal(isBusy(study, SUN(19, 30)), true);    // Sunday has its own, earlier, window
});

test('a window that runs past midnight belongs to the day it started on', () => {
    const late = themeById('latenight');
    assert.equal(isBusy(late, WED(23, 30)), true);
    assert.equal(isBusy(late, WED(2, 0)), true);        // Wednesday 2 am is the tail of Tuesday night
    assert.equal(isBusy(late, WED(3, 0)), false);
    assert.equal(isBusy(late, WED(12, 0)), false);
    const game = themeById('gaming');                  // Fri and Sat 9 pm to 1 am
    assert.equal(isBusy(game, SAT(0, 30)), true);       // Friday night's tail
    assert.equal(isBusy(game, SUN(0, 30)), true);       // Saturday night's tail
    assert.equal(isBusy(game, SUN(1, 0)), false);
    assert.equal(isBusy(game, WED(0, 30)), false);
});

test('the week wraps: Saturday night runs into Sunday', () => {
    const t = { windows: [{ days: [6], from: 23, to: 27 }] };
    assert.equal(isBusy(t, SUN(2, 0)), true);
    assert.equal(isBusy(t, SUN(3, 0)), false);
});

test('nextBusy finds the next start, and never one in the past', () => {
    const study = themeById('study');
    assert.equal(nextBusy(study, WED(19, 0)), WED(20, 0));
    assert.equal(nextBusy(study, WED(20, 30)), ist(2026, 10, 22, 20, 0));   // next is Thursday
    const cricket = themeById('cricket');
    assert.equal(nextBusy(cricket, SUN(23, 59)), ist(2026, 10, 28, 19, 0)); // Sunday night -> next Wednesday
    assert.equal(nextBusy({ windows: [] }, WED(1, 0)), null);
    assert.equal(nextBusy(OPEN, WED(1, 0)), null);
    for (const t of THEMES) for (let h = 0; h < 24 * 8; h += 5) { const now = WED(0, 0) + h * 3600000; assert.ok(nextBusy(t, now) > now, t.id); }
});

test('busyNow and featured', () => {
    assert.deepEqual(busyNow(WED(21, 0)).map(t => t.id), ['study', 'cricket']);
    assert.deepEqual(busyNow(WED(12, 0)), []);
    assert.deepEqual(featured(WED(21, 0)).theme.id, 'study');
    assert.equal(featured(WED(21, 0)).busy, true);
    const f = featured(WED(12, 0));
    assert.equal(f.busy, false);
    assert.ok(f.at > WED(12, 0) && f.at <= WED(12, 0) + 24 * 3600000);
});

test('schedule text is readable', () => {
    assert.equal(scheduleText(themeById('study')), 'Mon, Tue, Wed, Thu, Fri 8 pm–10 pm IST · Sun 7 pm–9 pm IST');
    assert.equal(scheduleText(themeById('latenight')), 'Every day 11 pm–3 am IST');
    assert.equal(scheduleText(OPEN), 'Any time');
});

import fs from 'node:fs';
import { compatible } from '/home/user/ohmygoal/js/transport.js';

test('the database rules list exactly the themes in rooms.js', () => {
    const rules = fs.readFileSync('/home/user/ohmygoal/firestore.rules', 'utf8');
    const m = rules.match(/d\.get\('theme', ''\) in \[([^\]]*)\]/);
    assert.ok(m, 'validQueue checks the theme');
    const ids = m[1].split(',').map(s => s.trim().replace(/'/g, ''));
    assert.deepEqual(ids, ['', ...THEME_IDS]);
});

test('matching: same room or both open; never across rooms', () => {
    assert.equal(compatible({}, {}), true);
    assert.equal(compatible({ theme: 'cricket' }, { theme: 'cricket' }), true);
    assert.equal(compatible({ theme: 'cricket' }, {}), false);
    assert.equal(compatible({}, { theme: 'study' }), false);
    assert.equal(compatible({ theme: 'cricket' }, { theme: 'study' }), false);
    assert.equal(compatible({ theme: '' }, {}), true);
});
