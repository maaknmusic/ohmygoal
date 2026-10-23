// App Check: the browser side starts only when it should and never breaks the site; every callable function carries the shared switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startAppCheck } from '/home/user/ohmygoal/js/appcheck.js';
import { callOpts, ENFORCE_APP_CHECK } from '/home/user/ohmygoal/functions/common.js';

const fakeModule = () => {
    const calls = [];
    class ReCaptchaV3Provider { constructor(key) { this.key = key; this.kind = 'v3'; } }
    class ReCaptchaEnterpriseProvider { constructor(key) { this.key = key; this.kind = 'enterprise'; } }
    return { calls, mod: { ReCaptchaV3Provider, ReCaptchaEnterpriseProvider, initializeAppCheck: (app, opts) => { calls.push({ app, opts }); return { token: 'x' }; } } };
};

test('without a site key, in the emulator, or without an app, nothing is started and nothing is loaded', async () => {
    let loaded = 0;
    const loadModule = async () => { loaded++; return fakeModule().mod; };
    for (const [app, cfg, o] of [[{}, undefined], [{}, {}], [{}, { siteKey: '' }], [{}, { siteKey: '   ' }], [{}, { siteKey: 5 }], [{}, { siteKey: null }], [null, { siteKey: 'k' }], [{}, { siteKey: 'k' }, { emulators: { auth: 'x' } }]]) {
        assert.equal(await startAppCheck(app, cfg, { loadModule, ...o }), null, JSON.stringify(cfg));
    }
    assert.equal(loaded, 0);
});

test('with a site key it starts App Check with Fraud Defense (reCAPTCHA Enterprise) and automatic token refresh', async () => {
    const { calls, mod } = fakeModule();
    const urls = [];
    const app = { name: 'app' };
    const res = await startAppCheck(app, { siteKey: ' 6Lc-test-key ' }, { loadModule: async u => { urls.push(u); return mod; } });
    assert.deepEqual(res, { token: 'x' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].app, app);
    assert.equal(calls[0].opts.provider.key, '6Lc-test-key');
    assert.equal(calls[0].opts.provider.kind, 'enterprise');
    assert.equal(calls[0].opts.isTokenAutoRefreshEnabled, true);
    assert.match(urls[0], /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app-check\.js$/);
});

test('provider "v3" still selects the classic reCAPTCHA v3 provider; anything else means Enterprise', async () => {
    for (const [provider, kind] of [['v3', 'v3'], ['enterprise', 'enterprise'], [undefined, 'enterprise'], ['nonsense', 'enterprise']]) {
        const { calls, mod } = fakeModule();
        await startAppCheck({}, { siteKey: 'k', provider }, { loadModule: async () => mod });
        assert.equal(calls[0].opts.provider.kind, kind, String(provider));
    }
});

test('a failure to load or start never throws: the site carries on without App Check', async () => {
    const warn = console.warn; console.warn = () => {};
    try {
        assert.equal(await startAppCheck({}, { siteKey: 'k' }, { loadModule: async () => { throw new Error('blocked by an ad blocker'); } }), null);
        assert.equal(await startAppCheck({}, { siteKey: 'k' }, { loadModule: async () => ({ ReCaptchaEnterpriseProvider: class {}, initializeAppCheck() { throw new Error('bad key'); } }) }), null);
    } finally { console.warn = warn; }
});

test('callOpts adds the shared App Check switch and keeps the function’s own options', () => {
    const o = callOpts({ secrets: ['s'], timeoutSeconds: 20 });
    assert.equal(o.enforceAppCheck, ENFORCE_APP_CHECK);
    assert.deepEqual(o.secrets, ['s']);
    assert.equal(o.timeoutSeconds, 20);
    assert.deepEqual(Object.keys(callOpts()), ['enforceAppCheck']);
    // a function cannot quietly opt out by passing its own value
    assert.equal(callOpts({ enforceAppCheck: false }).enforceAppCheck, false);
});

test('every callable function is created through callOpts, so the switch reaches all of them', () => {
    const dir = '/home/user/ohmygoal/functions/';
    let total = 0;
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
        const src = fs.readFileSync(dir + f, 'utf8');
        for (const m of src.matchAll(/onCall\(([^\n]*)/g)) {
            total++;
            assert.ok(m[1].startsWith('callOpts('), `${f}: onCall(${m[1].slice(0, 40)} is missing callOpts`);
        }
    }
    assert.ok(total >= 18, `found only ${total} callable functions`);
});

test('the switch defaults to off, and the site key in config.js looks like a real key (or is empty to keep App Check off)', () => {
    const env = fs.readFileSync('/home/user/ohmygoal/functions/.env', 'utf8');
    assert.match(env, /^ENFORCE_APP_CHECK=false$/m);
    const cfg = fs.readFileSync('/home/user/ohmygoal/config.js', 'utf8');
    assert.match(cfg, /appCheck: \{ siteKey: '([\w-]{40})?' \}/);
});
