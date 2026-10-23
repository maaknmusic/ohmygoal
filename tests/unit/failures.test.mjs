// Plain-language failure copy: every case says what happened and what to do, and never leaks a raw error code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaErrorText, matchFailure, connectionLostCopy, CAMERA_UNAVAILABLE } from '/home/user/ohmygoal/js/failures.js';

test('media errors name the device and the fix', () => {
    assert.match(mediaErrorText({ name: 'NotAllowedError' }, 'video'), /camera is blocked.*site settings/);
    assert.match(mediaErrorText({ name: 'NotAllowedError' }, 'voice'), /microphone is blocked/);
    assert.match(mediaErrorText({ name: 'SecurityError' }, 'text'), /camera or microphone is blocked/);
    assert.match(mediaErrorText({ name: 'NotFoundError' }, 'video'), /No camera was found/);
    assert.match(mediaErrorText({ name: 'NotReadableError' }, 'voice'), /microphone is being used by another app/);
    assert.match(mediaErrorText({ name: 'OverconstrainedError' }, 'video'), /doesn’t support/);
    assert.match(mediaErrorText({ name: 'Whatever' }, 'video'), /couldn’t be started/);
    assert.match(mediaErrorText(null, 'video'), /couldn’t be started/);
    assert.match(mediaErrorText(undefined), /camera or microphone/);
});

test('only "device missing or busy" errors allow falling back from video to voice', () => {
    for (const n of ['NotFoundError', 'NotReadableError', 'OverconstrainedError']) assert.ok(CAMERA_UNAVAILABLE.has(n), n);
    assert.ok(!CAMERA_UNAVAILABLE.has('NotAllowedError')); // the person said no: don't sneak a microphone request in
    assert.ok(!CAMERA_UNAVAILABLE.has('SecurityError'));
});

test('matching failures: offline wins, then known codes, then a generic message', () => {
    assert.equal(matchFailure({ code: 'permission-denied' }, false).title, 'You’re offline');
    assert.equal(matchFailure({ code: 'permission-denied' }).title, 'Couldn’t start matching');
    assert.equal(matchFailure({ code: 'unavailable' }).title, 'Couldn’t reach the server');
    assert.equal(matchFailure({ code: 'deadline-exceeded' }).title, 'Couldn’t reach the server');
    assert.equal(matchFailure(new Error('Network request failed')).title, 'Couldn’t reach the server');
    const generic = matchFailure(new Error('INTERNAL: secret-stack-trace'));
    assert.equal(generic.title, 'Matching failed');
    assert.ok(!/INTERNAL|secret/.test(generic.sub), 'raw error text must not reach the screen');
    assert.equal(matchFailure(undefined).title, 'Matching failed');
});

test('a lost connection explains itself differently before and after the chat started', () => {
    const never = connectionLostCopy({ opened: false });
    assert.equal(never.title, 'Couldn’t connect');
    assert.match(never.sub, /blocking video calls/);
    assert.doesNotMatch(never.sub, /TURN/); // the old text was developer jargon
    assert.match(connectionLostCopy({ opened: false, hideIp: true }).sub, /privacy relay.*Hide my IP address/);
    assert.equal(connectionLostCopy({ opened: true, online: false }).title, 'You’re offline');
    assert.deepEqual(connectionLostCopy({ opened: true, online: true }), { title: 'Stranger disconnected', sub: 'Their connection dropped.' });
    assert.equal(connectionLostCopy({ opened: true, leftTitle: 'Call ended' }).title, 'Call ended');
});
