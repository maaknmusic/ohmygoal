// Stickers and gifts: the wire messages, the price table (client and server must agree), and that every picture draws cleanly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STICKERS, GIFTS, stickerById, giftById, parseSticker, parseGift, drawSticker } from '/home/user/ohmygoal/js/stickers.js';
import { GIFTS as SERVER_GIFTS, COIN_PACKS, DAILY_COINS, DAILY_COINS_PREMIUM } from '/home/user/ohmygoal/functions/gifts.js';

test('eight free stickers and eight gifts, all with different ids and names', () => {
    assert.equal(STICKERS.length, 8); assert.equal(GIFTS.length, 8);
    const ids = [...STICKERS, ...GIFTS].map(x => x.id);
    assert.equal(new Set(ids).size, 16);
    assert.equal(new Set([...STICKERS, ...GIFTS].map(x => x.label)).size, 16);
    assert.ok(Object.isFrozen(STICKERS) && Object.isFrozen(STICKERS[0]) && Object.isFrozen(GIFTS[0]));
    assert.equal(stickerById('chai').label, 'Chai?');
    assert.equal(stickerById('rose'), null);       // a gift is not a free sticker
    assert.equal(giftById('chai'), null);
    for (const bad of ['__proto__', 'constructor', 'toString', '', null, 5]) { assert.equal(stickerById(bad), null); assert.equal(giftById(bad), null); }
});

test('the client price list equals the server’s (the server is the one that charges)', () => {
    assert.deepEqual(Object.fromEntries(GIFTS.map(g => [g.id, g.coins])), { ...SERVER_GIFTS });
    for (const g of GIFTS) assert.ok(Number.isInteger(g.coins) && g.coins > 0);
    // a gift never costs more than the biggest pack, and the cheapest gift is within reach of a day's free coins after a couple of days
    assert.ok(Math.max(...GIFTS.map(g => g.coins)) <= Math.max(...Object.values(COIN_PACKS).map(p => p.coins)));
    assert.ok(DAILY_COINS_PREMIUM > DAILY_COINS && DAILY_COINS > 0);
});

test('coin packs: whole rupees in paise, more coins per rupee as the pack grows', () => {
    const packs = Object.values(COIN_PACKS);
    for (const p of packs) { assert.ok(Number.isInteger(p.coins) && p.coins > 0); assert.ok(p.amount % 100 === 0); assert.ok(p.label.includes(String(p.coins))); }
    const rate = packs.map(p => p.coins / p.amount);
    for (let i = 1; i < rate.length; i++) assert.ok(rate[i] >= rate[i - 1]);
    assert.equal(Object.getPrototypeOf(COIN_PACKS) === Object.prototype || Object.isFrozen(COIN_PACKS), true);
});

test('wire messages: only known ids, only of the right kind, nothing extra', () => {
    assert.deepEqual(parseSticker({ t: 'sticker', id: 'kite', x: '<b>' }), { id: 'kite' });
    assert.equal(parseSticker({ id: 'rose' }), null);          // a gift sent as a free sticker
    assert.deepEqual(parseGift({ t: 'gift', id: 'rose' }), { id: 'rose' });
    assert.equal(parseGift({ id: 'kite' }), null);
    for (const bad of [null, undefined, 5, 'chai', [], {}, { id: null }, { id: ['chai'] }, { id: { toString: () => 'chai' } }, { id: '__proto__' }, { id: 'CHAI' }, { id: 'chai ' }, { id: 'x'.repeat(9999) }]) {
        assert.equal(parseSticker(bad), null, JSON.stringify(bad)); assert.equal(parseGift(bad), null, JSON.stringify(bad));
    }
});

/** A recording context that fails on non-finite numbers. */
function recorder() {
    const calls = [];
    const grad = { addColorStop(p) { assert.ok(p >= 0 && p <= 1); } };
    return { calls, ctx: new Proxy({}, {
        get(t, k) {
            if (k in t) return t[k];
            if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a) => { a.forEach(v => assert.ok(Number.isFinite(v))); return grad; };
            return (...a) => { for (const v of a) { if (typeof v === 'number') assert.ok(Number.isFinite(v), `${String(k)}(${a})`); if (typeof v === 'object' && v && !Array.isArray(v)) throw new Error(`${String(k)} got an object`); } calls.push(String(k)); };
        },
        set(t, k, v) { t[k] = v; return true; },
    }) };
}

test('every sticker and gift draws cleanly, balanced, without text or images', () => {
    for (const { id } of [...STICKERS, ...GIFTS]) {
        const { ctx, calls } = recorder();
        assert.equal(drawSticker(ctx, id), true, id);
        assert.equal(calls.filter(c => c === 'save').length, calls.filter(c => c === 'restore').length, id);
        assert.ok(calls.filter(c => c === 'fill' || c === 'stroke').length >= 4, id);
        assert.equal(calls.filter(c => c === 'fillText' || c === 'drawImage').length, 0, id);
    }
    assert.equal(drawSticker(recorder().ctx, 'nope'), false);
});

test('no emoji in the artwork source', () => {
    const src = fs.readFileSync('/home/user/ohmygoal/js/stickers.js', 'utf8');
    assert.equal(/\p{Extended_Pictographic}/u.test(src), false);
});
