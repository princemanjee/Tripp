import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { turnServer, TURN_URLS } from '../../supabase/functions/_shared/turn.js';

test('turnServer builds the coturn REST API username and HMAC-SHA1 credential', async () => {
  const s = await turnServer('s3cret', 600, 1_700_000_000_000);
  assert.equal(s.username, '1700000600:tripp');
  assert.equal(s.credential, createHmac('sha1', 's3cret').update('1700000600:tripp').digest('base64'));
  assert.deepEqual(s.urls, TURN_URLS);
});

test('turnServer refuses an empty secret', async () => {
  await assert.rejects(() => turnServer('', 600));
});
