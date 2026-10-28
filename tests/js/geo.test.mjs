import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupGeo } from '../../supabase/functions/_shared/geo.js';

const NONE = { isp: 'unknown', org: 'unknown', country: 'unknown', region: 'unknown', city: 'unknown', lat: null, lon: null, source: 'none' };
const okFetch = (payload, calls = []) => async (url) => {
  calls.push(url);
  return { ok: true, json: async () => payload };
};

test('lookupGeo maps a success payload', async () => {
  const calls = [];
  const f = okFetch({ status: 'success', country: 'Canada', regionName: 'Ontario', city: 'Toronto', lat: 43.65, lon: -79.38, isp: 'Bell', org: 'Bell Canada' }, calls);
  const g = await lookupGeo('203.0.113.9', { fetch: f });
  assert.deepEqual(g, { isp: 'Bell', org: 'Bell Canada', country: 'Canada', region: 'Ontario', city: 'Toronto', lat: 43.65, lon: -79.38, source: 'ip-api.com' });
  assert.equal(calls[0], 'http://ip-api.com/json/203.0.113.9?fields=status,country,regionName,city,lat,lon,isp,org');
});

test('lookupGeo: status fail gives unknowns', async () => {
  assert.deepEqual(await lookupGeo('203.0.113.9', { fetch: okFetch({ status: 'fail' }) }), NONE);
});

test('lookupGeo: non-numeric lat/lon become null', async () => {
  const g = await lookupGeo('203.0.113.9', { fetch: okFetch({ status: 'success', country: 'X', lat: '1', lon: null }) });
  assert.equal(g.lat, null);
  assert.equal(g.lon, null);
  assert.equal(g.source, 'ip-api.com');
  assert.equal(g.city, 'unknown');
});

test('lookupGeo: a fetch that never resolves times out', async () => {
  const hang = () => new Promise(() => {});
  const t = Date.now();
  const g = await lookupGeo('203.0.113.9', { fetch: hang });
  assert.ok(Date.now() - t < 1700);
  assert.deepEqual(g, NONE);
});

test('lookupGeo: a fetch that rejects or returns non-ok gives unknowns', async () => {
  assert.deepEqual(await lookupGeo('203.0.113.9', { fetch: async () => { throw new Error('x'); } }), NONE);
  assert.deepEqual(await lookupGeo('203.0.113.9', { fetch: async () => ({ ok: false, json: async () => ({}) }) }), NONE);
  assert.deepEqual(await lookupGeo('203.0.113.9', { fetch: async () => ({ ok: true, json: async () => { throw new Error('bad'); } }) }), NONE);
});

test('lookupGeo: private, loopback and unknown skip the fetch', async () => {
  const ips = ['10.0.0.5', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'unknown', ''];
  for (const ip of ips) {
    let called = false;
    const g = await lookupGeo(ip, { fetch: async () => { called = true; return { ok: true, json: async () => ({}) }; } });
    assert.equal(called, false, ip);
    assert.deepEqual(g, NONE, ip);
  }
});

test('lookupGeo: 172.32.x is public and is fetched', async () => {
  const calls = [];
  await lookupGeo('172.32.0.1', { fetch: okFetch({ status: 'fail' }, calls) });
  assert.equal(calls.length, 1);
});
