// Live security test: channel authorization against the real project.
// Needs TRIPP_DB_PASSWORD. Writes nothing to tripp.events and never reads message bodies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const URL = 'https://ohhkzjsdabdimlrgnagw.supabase.co';
const KEY = 'sb_publishable_BKvG3mZolQFylaMMtiS9bw_sI1ZUFlq';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

let db, convId, guestToken, adminToken, guestKey;
const uids = [];
const clients = [];
const log = [];
let U, G, G2, A; // unbound anon, bound guest, second bound guest (public listener), bound admin
let gConv, aConv, aAdmin; // shared channels
const adminGot = [];
const convGot = [];

async function anon() {
  const c = createClient(URL, KEY, opts);
  const { data, error } = await c.auth.signInAnonymously();
  assert.ifError(error);
  uids.push(data.user.id);
  clients.push(c);
  return c;
}

async function bind(c, token) {
  const { data, error } = await c.rpc('m_live_bind', { p_token: token });
  assert.ifError(error);
  assert.equal(data.ok, true);
  await c.realtime.setAuth();
  return data.scope;
}

// Resolves with the first terminal status.
function sub(channel, label, ms = 12000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('TIMED_OUT_LOCAL'), ms);
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(t);
        if (status !== 'SUBSCRIBED') log.push(`${label}: ${status} ${err ? err.message : ''}`);
        resolve(status);
      }
    });
  });
}

const priv = (c, topic, extra = {}) =>
  c.channel(topic, { config: { private: true, broadcast: { self: false }, ...extra } });

async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(100);
  }
  return fn();
}

before(async () => {
  assert.ok(process.env.TRIPP_DB_PASSWORD, 'TRIPP_DB_PASSWORD is not set');
  db = new pg.Client({
    host: 'db.ohhkzjsdabdimlrgnagw.supabase.co', port: 5432, user: 'postgres', database: 'postgres',
    password: process.env.TRIPP_DB_PASSWORD, ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  const pw = randomBytes(12).toString('hex');
  convId = Number((await db.query(
    "insert into tripp.conversations (label, hash) values ('live-test', extensions.crypt($1, extensions.gen_salt('bf', 4))) returning id", [pw]
  )).rows[0].id);
  guestToken = 'live-guest-' + randomBytes(16).toString('hex');
  adminToken = 'live-admin-' + randomBytes(16).toString('hex');
  guestKey = 'k-' + randomBytes(4).toString('hex');
  await db.query('insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash($1), $2)', [guestToken, convId]);
  await db.query('insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash($1), null)', [adminToken]);

  U = await anon();
  G = await anon();
  G2 = await anon();
  A = await anon();
  assert.equal(await bind(G, guestToken), convId);
  assert.equal(await bind(G2, guestToken), convId);
  assert.equal(await bind(A, adminToken), 0);
});

after(async () => {
  if (!db) return;
  for (const c of clients) { try { await c.removeAllChannels(); } catch {} }
  try {
    if (uids.length) {
      await db.query('delete from tripp.live_bindings where uid = any($1::uuid[])', [uids]);
      await db.query('delete from auth.users where id = any($1::uuid[])', [uids]);
    }
    await db.query('delete from tripp.sessions where token_hash = any(array[tripp.token_hash($1), tripp.token_hash($2)])', [guestToken, adminToken]);
    if (convId) await db.query('delete from tripp.conversations where id = $1', [convId]);
  } finally {
    await db.end();
    if (log.length) console.log('non-SUBSCRIBED reasons:\n  ' + log.join('\n  '));
  }
});

test('unbound anonymous user is denied conv:A', async () => {
  const ch = priv(U, `conv:${convId}`);
  assert.equal(await sub(ch, 'unbound conv:A'), 'CHANNEL_ERROR');
  await U.removeChannel(ch);
});

test('bound guest: own conversation yes, other conversation and admin no', async () => {
  const bad = priv(G, `conv:${convId + 1000}`);
  assert.equal(await sub(bad, 'guest other conv'), 'CHANNEL_ERROR');
  await G.removeChannel(bad);
  const adm = priv(G, 'admin');
  assert.equal(await sub(adm, 'guest admin'), 'CHANNEL_ERROR');
  await G.removeChannel(adm);
  gConv = priv(G, `conv:${convId}`, { presence: { key: guestKey } });
  gConv.on('presence', { event: 'sync' }, () => {});
  assert.equal(await sub(gConv, 'guest own conv'), 'SUBSCRIBED');
});

test('bound admin subscribes to admin and conv:A', async () => {
  aAdmin = priv(A, 'admin');
  aAdmin.on('broadcast', { event: '*' }, (m) => adminGot.push(m));
  assert.equal(await sub(aAdmin, 'admin admin'), 'SUBSCRIBED');
  aConv = priv(A, `conv:${convId}`);
  aConv.on('broadcast', { event: '*' }, (m) => convGot.push(m));
  aConv.on('presence', { event: 'sync' }, () => {});
  assert.equal(await sub(aConv, 'admin conv'), 'SUBSCRIBED');
});

test('guest broadcast on conv:A reaches the admin', async () => {
  const r = await gConv.send({ type: 'broadcast', event: 'call', payload: { n: 'g1' } });
  assert.equal(r, 'ok');
  assert.ok(await waitFor(() => convGot.some((m) => m.event === 'call' && m.payload?.n === 'g1'), 5000));
});

test('guest send to admin is not delivered', async () => {
  const ch = priv(G, 'admin');
  // Not subscribed (denied), so this is the explicit REST path.
  try { await ch.httpSend('call', { n: 'evil' }); } catch {}
  await sleep(3000);
  assert.ok(!adminGot.some((m) => m.payload?.n === 'evil'), 'admin received a guest send');
  await G.removeChannel(ch);
});

test('realtime.send from pg reaches the admin', async () => {
  await db.query("select realtime.send('{\"n\":\"pg1\"}'::jsonb, 'pgsend', 'admin', true)");
  assert.ok(await waitFor(() => adminGot.some((m) => m.event === 'pgsend' && m.payload?.n === 'pg1'), 5000));
});

test('presence: admin sees the guest key', async () => {
  const r = await gConv.track({ who: 'guest' });
  assert.equal(r, 'ok');
  assert.ok(await waitFor(() => Object.keys(aConv.presenceState()).includes(guestKey), 5000));
});

test('public channels never receive private traffic', async () => {
  const got = { G2conv: [], G2admin: [], Uconv: [], Uadmin: [] };
  const pub = (c, topic, bucket) => {
    const ch = c.channel(topic, { config: { private: false, broadcast: { self: false } } });
    ch.on('broadcast', { event: '*' }, (m) => got[bucket].push(m));
    return ch;
  };
  const chs = [
    [pub(G2, `conv:${convId}`, 'G2conv'), 'G2 public conv:A'],
    [pub(G2, 'admin', 'G2admin'), 'G2 public admin'],
    [pub(U, `conv:${convId}`, 'Uconv'), 'U public conv:A'],
    [pub(U, 'admin', 'Uadmin'), 'U public admin'],
  ];
  const statuses = [];
  for (const [ch, label] of chs) statuses.push(label + '=' + (await sub(ch, label)));
  console.log('public subscribe statuses: ' + statuses.join(', '));

  // Positive control: a public sender reaches a public listener, so the listeners work.
  const st = statuses.map((x) => x.split('=')[1]);
  for (const s of st) assert.ok(s === 'CHANNEL_ERROR' || s === 'SUBSCRIBED', 'unexpected public status ' + s);
  if (st.includes('SUBSCRIBED')) {
    assert.ok(st[0] === 'SUBSCRIBED' && st[2] === 'SUBSCRIBED', 'a public subscribe succeeded but the control cannot run');
    await chs[2][0].send({ type: 'broadcast', event: 'ctl', payload: { n: 'ctl' } });
    assert.ok(await waitFor(() => got.G2conv.some((m) => m.event === 'ctl'), 5000), 'control: public listener hears public send');
  }

  // Private traffic.
  await gConv.send({ type: 'broadcast', event: 'call', payload: { n: 'private-g' } });
  await db.query("select realtime.send('{\"n\":\"private-pg-conv\"}'::jsonb, 'pgsend', $1, true)", [`conv:${convId}`]);
  await db.query("select realtime.send('{\"n\":\"private-pg-admin\"}'::jsonb, 'pgsend', 'admin', true)");
  await sleep(3500);

  const leaked = Object.entries(got).flatMap(([k, v]) =>
    v.filter((m) => m.event !== 'ctl').map((m) => `${k}: ${m.event} ${JSON.stringify(m.payload)}`));
  assert.deepEqual(leaked, [], 'BLOCKED: private traffic readable on public channels: ' + leaked.join('; '));
  for (const [ch] of chs) await ch.unsubscribe();
});

test('after the guest session row is deleted, a new subscribe is denied', async () => {
  await G.removeAllChannels();
  await db.query('delete from tripp.sessions where token_hash = tripp.token_hash($1)', [guestToken]);
  const ch = priv(G, `conv:${convId}`);
  assert.equal(await sub(ch, 'guest after session deleted'), 'CHANNEL_ERROR');
});
