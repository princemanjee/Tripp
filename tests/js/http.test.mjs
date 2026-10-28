import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, cors, json } from '../../supabase/functions/_shared/http.js';

test('clientIp takes the first x-forwarded-for entry', () => {
  const h = new Headers({ 'x-forwarded-for': '203.0.113.9,203.0.113.9, 3.2.58.242' });
  assert.equal(clientIp(h), '203.0.113.9');
});

test('clientIp trims the first entry', () => {
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '  203.0.113.9 , 1.1.1.1' })), '203.0.113.9');
});

test('clientIp falls back to cf-connecting-ip', () => {
  assert.equal(clientIp(new Headers({ 'cf-connecting-ip': ' 203.0.113.9 ' })), '203.0.113.9');
});

test('clientIp treats empty values as missing', () => {
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '', 'cf-connecting-ip': '203.0.113.9' })), '203.0.113.9');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': ' , 1.1.1.1', 'cf-connecting-ip': '203.0.113.9' })), '203.0.113.9');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '', 'cf-connecting-ip': '' })), 'unknown');
});

test('clientIp returns unknown with neither header', () => {
  assert.equal(clientIp(new Headers()), 'unknown');
});

test('cors allows exactly the two origins', () => {
  for (const o of ['https://cv.princerehman.com', 'http://localhost:8000']) {
    const c = cors(o);
    assert.equal(c['access-control-allow-origin'], o);
    assert.equal(c.vary, 'origin');
    assert.equal(c['access-control-allow-methods'], 'POST, OPTIONS');
    assert.equal(c['access-control-allow-headers'], 'content-type, apikey, authorization, x-client-info');
  }
});

test('cors omits allow-origin for other origins but keeps vary', () => {
  for (const o of ['https://evil.example', 'https://cv.princerehman.com/', null, undefined]) {
    const c = cors(o);
    assert.equal('access-control-allow-origin' in c, false);
    assert.equal(c.vary, 'origin');
  }
});

test('json builds a Response with headers and status', async () => {
  const r = json({ a: 1 }, 201, 'http://localhost:8000');
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('content-type'), 'application/json');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8000');
  assert.equal(r.headers.get('vary'), 'origin');
  assert.deepEqual(await r.json(), { a: 1 });
});

test('json defaults to 200', () => {
  assert.equal(json({}).status, 200);
});
