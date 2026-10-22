// ProfileSync: Google accounts keep their profile in the account, anonymous ones never touch the database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfileSync, buildProfile, parseProfile, firestoreIo, googleIdentity, SAVE_DELAY_MS } from '/home/user/ohmygoal/js/profile.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const AV = { e: '🦊', h: 200 };

/** A fake database + a fake app state. */
function rig({ remote = null, google = true, uid = 'u1', getErr = null, setErr = null, delayMs = 20, retryMs = [10, 20, 30] } = {}) {
    const db = new Map(remote ? [[uid, remote]] : []);
    const log = { gets: [], sets: [], applied: [], errors: [] };
    const local = { lang: '', nick: 'ChaiPanda', avatar: AV, interests: [], gender: 'x' };
    const id = { uid, google };
    const io = {
        async get(u) { log.gets.push(u); if (getErr && getErr.n-- > 0) throw getErr.e; return db.get(u) ?? null; },
        async set(u, d) { log.sets.push({ u, d }); if (setErr && setErr.n-- > 0) throw setErr.e; db.set(u, d); },
    };
    const sync = new ProfileSync({
        io, identity: () => id, getLocal: () => local, delayMs, retryMs, onError: e => log.errors.push(e),
        apply: p => { log.applied.push(p); Object.assign(local, p); },
    });
    return { sync, db, log, local, id };
}
const err = code => Object.assign(new Error(code), { code });

test('buildProfile: only fields the security rules accept, nothing else', () => {
    const d = buildProfile({ lang: 'hi', nick: 'Chai Panda', avatar: AV, interests: ['music', 'Gaming ', 'music', '', 5, 'x'.repeat(40)], gender: 'female', extra: 'nope' }, 1234);
    assert.deepEqual(Object.keys(d).sort(), ['avatar', 'gender', 'interests', 'lang', 'nick', 'updatedAt']);
    assert.equal(d.updatedAt, 1234);
    assert.deepEqual(d.avatar, AV);
    assert.deepEqual(d.interests, ['music', 'gaming', 'x'.repeat(24)]);
    assert.equal(d.lang, 'hi');
    // no language chosen: no lang key (the rules require a code from the list when the key exists)
    assert.equal('lang' in buildProfile({ lang: '', nick: 'A1', avatar: AV }), false);
    assert.equal('lang' in buildProfile({ lang: 'xx', nick: 'A1', avatar: AV }), false);
    // at most 5 interests, each at most 24
    const many = buildProfile({ interests: Array.from({ length: 9 }, (_, i) => 'tag' + i) });
    assert.equal(many.interests.length, 5);
    assert.ok(many.interests.every(t => t.length <= 24));
    // empty list is stored as an empty list (so clearing interests reaches the other devices), gender defaults to 'x'
    const bare = buildProfile({});
    assert.deepEqual(bare.interests, []);
    assert.equal(bare.gender, 'x');
    assert.equal('nick' in bare, false);
    assert.equal('avatar' in bare, false);
    for (const g of ['male', 'female', 'x', '']) assert.equal(buildProfile({ gender: g }).gender, g);
    assert.equal(buildProfile({ gender: 'robot' }).gender, 'x');
    // an avatar the app could not have generated is not stored; nick is the sanitised handle (<= 20)
    assert.equal('avatar' in buildProfile({ avatar: { e: '<script>', h: 5 } }), false);
    assert.equal('avatar' in buildProfile({ avatar: { e: '🦊', h: 400 } }), false);
    assert.ok(buildProfile({ nick: 'N'.repeat(60) }).nick.length <= 20);
    assert.equal('nick' in buildProfile({ nick: '98765 43210' }), false);
});

test('parseProfile: only valid fields of an untrusted document are kept', () => {
    assert.deepEqual(parseProfile(null), {});
    assert.deepEqual(parseProfile('x'), {});
    assert.deepEqual(parseProfile({ lang: 'es', nick: 'Sol', avatar: AV, interests: ['a', 'b'], gender: 'male', updatedAt: 5, evil: 1 }),
        { lang: 'es', nick: 'Sol', avatar: AV, interests: ['a', 'b'], gender: 'male' });
    assert.deepEqual(parseProfile({ lang: 'EN', nick: 5, avatar: 'x', interests: 'a', gender: 'robot' }), {});
    assert.deepEqual(parseProfile({ gender: '' }), { gender: 'x' });
    assert.equal(parseProfile({ interests: ['ok', {}, null, 7] }).interests.length, 1);
    assert.equal(parseProfile({ interests: Array.from({ length: 30 }, (_, i) => 't' + i) }).interests.length, 5);
});

test('anonymous accounts never read or write the database', async () => {
    const r = rig({ google: false });
    r.sync.check();
    r.sync.touch();
    await r.sync.flush();
    await wait(60);
    assert.deepEqual(r.log.gets, []);
    assert.deepEqual(r.log.sets, []);
    assert.equal(r.sync.active, false);
});

test('first Google sign-in with no document creates it from the values on this device', async () => {
    const r = rig();
    r.local.lang = 'ta'; r.local.interests = ['cricket'];
    r.sync.check();
    await wait(60);
    assert.deepEqual(r.log.gets, ['u1']);
    assert.equal(r.log.sets.length, 1);
    const doc = r.db.get('u1');
    assert.equal(doc.lang, 'ta');
    assert.equal(doc.nick, 'ChaiPanda');
    assert.deepEqual(doc.interests, ['cricket']);
    assert.ok(Number.isFinite(doc.updatedAt));
    assert.deepEqual(r.log.applied, []); // nothing to apply when the account had nothing
});

test('an existing document is applied to this device and not written back', async () => {
    const r = rig({ remote: { lang: 'hi', nick: 'Sitara', avatar: { e: '🐼', h: 10 }, interests: ['music'], gender: 'female', updatedAt: 1 } });
    r.sync.check();
    await wait(60);
    assert.equal(r.log.applied.length, 1);
    assert.equal(r.local.lang, 'hi');
    assert.equal(r.local.nick, 'Sitara');
    assert.deepEqual(r.local.avatar, { e: '🐼', h: 10 });
    assert.deepEqual(r.local.interests, ['music']);
    assert.equal(r.local.gender, 'female');
    assert.deepEqual(r.log.sets, [], 'a pure read must not write');
});

test('a value the account lacks (language chosen before signing in) is kept and added to the account', async () => {
    const r = rig({ remote: { nick: 'Sitara', avatar: { e: '🐼', h: 10 }, interests: [], gender: 'x', updatedAt: 1 } });
    r.local.lang = 'fr';
    r.sync.check();
    await wait(60);
    assert.equal(r.local.lang, 'fr');
    assert.equal(r.db.get('u1').lang, 'fr');
    assert.equal(r.db.get('u1').nick, 'Sitara');
});

test('local edits are saved once after a short pause, only when something changed', async () => {
    const r = rig();
    r.sync.check();
    await wait(60);
    const base = r.log.sets.length;
    r.local.lang = 'de'; r.sync.touch();
    r.local.nick = 'Neu'; r.sync.touch();
    r.local.interests = ['a']; r.sync.touch();
    await wait(5);
    assert.equal(r.log.sets.length, base, 'debounced');
    await wait(60);
    assert.equal(r.log.sets.length, base + 1, 'one write for three edits');
    assert.equal(r.db.get('u1').lang, 'de');
    r.sync.touch();
    await wait(60);
    assert.equal(r.log.sets.length, base + 1, 'no change, no write');
});

test('applying the account must not count as a local edit', async () => {
    const r = rig({ remote: { lang: 'hi', nick: 'Sitara', avatar: { e: '🐼', h: 10 }, interests: [], gender: 'x', updatedAt: 1 } });
    // the app's store.set() calls touch() while applying
    const apply = r.sync.applyRemote;
    r.sync.applyRemote = p => { apply(p); r.sync.touch(); };
    r.sync.check();
    await wait(80);
    assert.deepEqual(r.log.sets, []);
});

test('edits before the account was read are not written (they could overwrite it)', async () => {
    const r = rig({ remote: { lang: 'hi', nick: 'Sitara', avatar: { e: '🐼', h: 10 }, interests: [], gender: 'x', updatedAt: 1 } });
    r.sync.touch();           // before check(): not signed in to the sync yet
    r.sync.check();
    r.sync.touch();           // the read is still on its way
    await wait(80);
    assert.deepEqual(r.log.sets, []);
    assert.equal(r.local.lang, 'hi');
});

test('offline / failing reads and writes are quiet, retried, and never write blindly', async () => {
    const r = rig({ remote: { lang: 'hi', nick: 'Sitara', avatar: { e: '🐼', h: 10 }, interests: [], gender: 'x', updatedAt: 1 }, getErr: { n: 2, e: err('unavailable') } });
    r.local.lang = 'es';
    r.sync.check();
    await wait(25);
    assert.deepEqual(r.log.sets, [], 'while the read keeps failing nothing is written');
    await wait(120);
    assert.equal(r.log.gets.length, 3, 'read retried until it worked');
    assert.equal(r.local.lang, 'hi', 'the account wins once it was read');
    assert.equal(r.log.errors.length, 2);

    const w = rig({ setErr: { n: 2, e: err('unavailable') } });
    w.sync.check();
    await wait(150);
    assert.ok(w.log.sets.length >= 3);
    assert.ok(w.db.has('u1'), 'the write got through on a retry');
});

test('permission-denied stops writing until the next sign-in', async () => {
    const r = rig({ setErr: { n: 99, e: err('permission-denied') } });
    r.sync.check();
    await wait(60);
    assert.equal(r.log.sets.length, 1);
    r.local.lang = 'it'; r.sync.touch();
    await wait(80);
    assert.equal(r.log.sets.length, 1, 'no further attempts');
    // signing out and in again starts over
    r.id.google = false; r.sync.check();
    r.id.google = true; r.sync.check();
    await wait(60);
    assert.equal(r.log.sets.length, 2);
});

test('signing out stops everything; another account is read afresh', async () => {
    const r = rig({ remote: { lang: 'hi', nick: 'Sitara', avatar: { e: '🐼', h: 10 }, interests: [], gender: 'x', updatedAt: 1 } });
    r.sync.check();
    await wait(40);
    r.local.lang = 'ja'; r.sync.touch();
    r.id.google = false; r.sync.check();   // signed out before the pause ended
    await wait(80);
    assert.equal(r.log.sets.length, 0);
    assert.equal(r.sync.active, false);
    r.local.lang = 'ko'; r.sync.touch();
    await wait(60);
    assert.equal(r.log.sets.length, 0, 'anonymous again: nothing leaves');
    r.id.google = true; r.id.uid = 'u2'; r.sync.check();
    await wait(60);
    assert.deepEqual(r.log.gets, ['u1', 'u2']);
    assert.ok(r.db.has('u2'));
});

test('a slow read for a previous sign-in cannot apply to the new one', async () => {
    let release;
    const gate = new Promise(r => { release = r; });
    const local = { lang: '', nick: 'A1', avatar: AV, interests: [], gender: 'x' };
    const id = { uid: 'old', google: true };
    const applied = [];
    const sync = new ProfileSync({
        io: { get: async u => { if (u === 'old') await gate; return u === 'old' ? { lang: 'hi', updatedAt: 1 } : { lang: 'fr', updatedAt: 1 }; }, set: async () => {} },
        identity: () => id, getLocal: () => local, apply: p => applied.push(p), delayMs: 10,
    });
    sync.check();
    id.uid = 'new'; sync.check();
    await wait(30);
    release();
    await wait(30);
    assert.deepEqual(applied.map(p => p.lang), ['fr']);
});

test('flush() saves immediately (page hidden) and never throws', async () => {
    const r = rig({ delayMs: 10000 });
    r.sync.check();
    await wait(30);
    r.local.lang = 'sv'; r.sync.touch();
    assert.equal(await r.sync.flush(), true);
    assert.equal(r.db.get('u1').lang, 'sv');
    const bad = rig({ setErr: { n: 9, e: err('unavailable') } });
    bad.sync.check(); await wait(30);
    assert.equal(await bad.sync.flush(), false);
});

test('firestoreIo / googleIdentity use the profiles document and the Google provider only', async () => {
    const calls = [];
    const fb = {
        db: 'DB', base: ['artifacts', 'anon-connect', 'public', 'data'],
        fs: {
            doc: (...a) => { calls.push(['doc', ...a]); return a.join('/'); },
            getDoc: async ref => ({ exists: () => ref.endsWith('profiles/u1'), data: () => ({ lang: 'hi' }) }),
            setDoc: async (ref, d) => { calls.push(['set', ref, d]); },
        },
        auth: { currentUser: null },
    };
    const io = firestoreIo(fb);
    assert.deepEqual(await io.get('u1'), { lang: 'hi' });
    assert.equal(await io.get('u2'), null);
    await io.set('u1', { lang: 'hi' });
    assert.deepEqual(calls.at(-1), ['set', 'DB/artifacts/anon-connect/public/data/profiles/u1', { lang: 'hi' }]);
    const ident = googleIdentity(fb);
    assert.equal(ident().google, false);
    fb.auth.currentUser = { uid: 'a', isAnonymous: true, providerData: [] };
    assert.equal(ident().google, false);
    fb.auth.currentUser = { uid: 'a', isAnonymous: false, providerData: [{ providerId: 'password' }] };
    assert.equal(ident().google, false);
    fb.auth.currentUser = { uid: 'a', isAnonymous: false, providerData: [{ providerId: 'google.com' }] };
    assert.deepEqual(ident(), { uid: 'a', google: true });
    assert.equal(SAVE_DELAY_MS, 1500);
});
