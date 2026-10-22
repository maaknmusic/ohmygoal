// The server and the client must offer exactly the same translation languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS as server } from '../../functions/languages.js';
import { LANGS as client } from '../../js/languages.js';

const EXPECTED = 'en hi bn ta te mr gu kn ml pa ur or as ne es fr de pt it nl ru uk pl tr ar fa he id ms th vi zh zh-TW ja ko sw fil el cs sv ro hu da fi nb'.split(' ');

test('both language lists contain exactly the 45 agreed codes, in sync', () => {
  assert.deepEqual(server.map(l => l.code).sort(), [...EXPECTED].sort());
  assert.deepEqual(client.map(l => l.code).sort(), [...EXPECTED].sort());
  assert.equal(new Set(client.map(l => l.code)).size, 45);
  for (const l of client) assert.ok(l.en && l.native, `client entry needs en + native: ${l.code}`);
  for (const l of server) assert.ok(l.en, `server entry needs en: ${l.code}`);
  const s = Object.fromEntries(server.map(l => [l.code, l.en])), c = Object.fromEntries(client.map(l => [l.code, l.en]));
  assert.deepEqual(s, c, 'English names must match');
});
