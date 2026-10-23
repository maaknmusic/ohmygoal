// Moving visitors from the old Firebase addresses to ohmygoal.app: which addresses move, and what is kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { moveTarget, NEW_HOST } = createRequire(import.meta.url)('/home/user/ohmygoal/js/move-domain.js');

const loc = (hostname, pathname = '/', search = '', hash = '') => ({ hostname, pathname, search, hash });

test('the target domain is ohmygoal.app', () => assert.equal(NEW_HOST, 'ohmygoal.app'));

test('the old Firebase addresses move, keeping the path, query and hash', () => {
    assert.equal(moveTarget(loc('ohmygoal.web.app')), 'https://ohmygoal.app/');
    assert.equal(moveTarget(loc('ohmygoal-c8a4a.web.app', '/legal.html', '?a=1', '#privacy')), 'https://ohmygoal.app/legal.html?a=1#privacy');
    assert.equal(moveTarget(loc('ohmygoal-c8a4a.firebaseapp.com', '/', '?mode=video')), 'https://ohmygoal.app/?mode=video');
    assert.equal(moveTarget(loc('OhMyGoal.WEB.APP', '/x')), 'https://ohmygoal.app/x');
});

test('every other address stays where it is', () => {
    for (const h of ['ohmygoal.app', 'www.ohmygoal.app', 'localhost', '127.0.0.1', 'raw.githack.com', 'example.com', 'web.app', 'firebaseapp.com', 'evilweb.app', 'ohmygoal.web.app.evil.com', '']) {
        // "web.app" and "firebaseapp.com" on their own have no site name in front, and look-alikes end somewhere else
        assert.equal(moveTarget(loc(h)), null, h);
    }
});

test('?noredirect=1 keeps you on the old address (for testing and for the admin)', () => {
    assert.equal(moveTarget(loc('ohmygoal.web.app', '/', '?noredirect=1')), null);
    assert.equal(moveTarget(loc('ohmygoal.web.app', '/', '?x=1&noredirect=1')), null);
    assert.equal(moveTarget(loc('ohmygoal.web.app', '/', '?noredirect=10')), 'https://ohmygoal.app/?noredirect=10');
});

test('it never produces anything but an https link to our own domain', () => {
    for (const p of ['/', '//evil.com', '/\\evil.com', '/a/../b', '/?x=//evil.com']) {
        const t = moveTarget(loc('ohmygoal.web.app', p));
        assert.ok(t.startsWith('https://ohmygoal.app/') || t.startsWith('https://ohmygoal.app//') || t.startsWith('https://ohmygoal.app/\\'), t);
        assert.equal(new URL(t).hostname, 'ohmygoal.app', t);
    }
});
