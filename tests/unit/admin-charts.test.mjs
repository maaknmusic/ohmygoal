// The pure parts of the admin charts: axis maximums, number formats, line points and CSV safety.
import test from 'node:test';
import assert from 'node:assert/strict';
import { niceMax, compact, rupees, linePoints, toCsv } from '/home/user/ohmygoal/js/admin-charts.js';

test('niceMax rounds up to 1, 2, 5 times a power of ten', () => {
    assert.equal(niceMax(0), 1); assert.equal(niceMax(-5), 1); assert.equal(niceMax(NaN), 1); assert.equal(niceMax(Infinity), 1);
    assert.equal(niceMax(1), 1); assert.equal(niceMax(1.1), 2); assert.equal(niceMax(3), 5); assert.equal(niceMax(5.1), 10);
    assert.equal(niceMax(73), 100); assert.equal(niceMax(240), 500); assert.equal(niceMax(1234), 2000);
    for (const v of [0.3, 7, 19, 101, 9999, 123456]) assert.ok(niceMax(v) >= v);
});

test('compact and rupees', () => {
    assert.equal(compact(0), '0'); assert.equal(compact(12), '12'); assert.equal(compact(1500), '1.5k'); assert.equal(compact(1000), '1k');
    assert.equal(compact(12500), '13k'); assert.equal(compact(2500000), '2.5M'); assert.equal(compact(NaN), '0'); assert.equal(compact(0.456), '0.46');
    assert.equal(rupees(0), '₹0'); assert.equal(rupees(149), '₹149'); assert.equal(rupees(123456.4), '₹1,23,456'); assert.equal(rupees(NaN), '₹0'); assert.equal(rupees(undefined), '₹0');
});

test('line points span the width and invert y', () => {
    assert.deepEqual(linePoints([0, 5, 10], 100, 50, 10), [[0, 50], [50, 25], [100, 0]]);
    assert.deepEqual(linePoints([7], 100, 50, 10), [[50, 15]]);
    assert.deepEqual(linePoints([-5, 0], 10, 10, 0), [[0, 10], [10, 10]]);   // negatives clamp to zero, a zero max can't divide by zero
    assert.deepEqual(linePoints([], 10, 10, 1), []);
});

test('CSV: quoting, line endings, and spreadsheet formulas are defused', () => {
    assert.equal(toCsv([['a', 'b'], [1, 2]]), 'a,b\r\n1,2\r\n');
    assert.equal(toCsv([['he said "hi", ok']]), '"he said ""hi"", ok"\r\n');
    assert.equal(toCsv([['line\nbreak']]), '"line\nbreak"\r\n');
    assert.equal(toCsv([[null, undefined, 0, false]]), ',,0,false\r\n');
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd']) assert.ok(toCsv([[evil]]).startsWith(evil.includes(',') || evil.includes('"') ? '"\'' : "'"), evil);
    assert.equal(toCsv([['plain-dash', 'a=b']]), 'plain-dash,a=b\r\n');   // only a LEADING character matters
});
