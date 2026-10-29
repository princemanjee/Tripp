// End-to-end call scenarios for Tripp (Stages 2-3, Task 8).
//
// Run (site/ served on http://localhost:8000, for example `python -m http.server 8000` inside site/):
//   TRIPP_DB_PASSWORD=... node tests/e2e/calls.mjs
//
// Seven scenarios, each checked in both UIs and against the tripp.events rows of the call.
// The admin signs in with a temporary tripp.sessions row (the `open` Edge Function is
// intercepted for the admin page only). Guests sign in through the real `open` for a
// temporary conversation. Everything the run creates is deleted at the end; the ids of the
// visits and events it created are printed. Message bodies are never read.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'));
const pg = require('pg');
const { chromium } = require('playwright');

const BASE = 'http://localhost:8000/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);

if (!process.env.TRIPP_DB_PASSWORD) {
  console.error('TRIPP_DB_PASSWORD is not set.');
  process.exit(2);
}
const db = new pg.Client({ host: 'db.ohhkzjsdabdimlrgnagw.supabase.co', port: 5432, user: 'postgres', database: 'postgres', password: process.env.TRIPP_DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await db.connect();

const PASS = 'e2e-calls-' + randomBytes(6).toString('hex');
const adminTokens = [];
let convId = null, browser = null, startedAt, origSeen, pre;
const consoleLines = [];
const results = [];
let currentName = '';
const failures = [];

// Test-only instrumentation injected before the page's own scripts: records every
// RTCPeerConnection and every media stream, CSP violations, a controllable page visibility
// and an optional getUserMedia delay. Nothing in site/ is changed.
const INIT = `
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  (() => {
    const P = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = function (cfg) { const pc = new P(cfg); window.__pcs.push(pc); return pc; };
    window.RTCPeerConnection.prototype = P.prototype;
  })();
  // Realtime call frames (sent and received) with timestamps, for diagnosing a failed scenario.
  window.__wsLog = [];
  (() => {
    const W = window.WebSocket, t0 = Date.now();
    const note = (dir, d) => { try { if (typeof d === 'string' && d.includes('"event":"call"')) { const m = JSON.parse(d); const pl = m.payload && (m.payload.payload || m.payload); window.__wsLog.push(dir + ' +' + (Date.now() - t0) + ' ' + pl.t + ' call=' + String(pl.call).slice(0, 8) + ' from=' + String(pl.from).slice(0, 6)); } } catch (e) { /* not json */ } };
    window.WebSocket = function (...a) { const ws = new W(...a); const send = ws.send.bind(ws); ws.send = (d) => { note('out', d); return send(d); }; ws.addEventListener('message', (e) => note('in ', e.data)); return ws; };
    window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  })();
  window.__hid = false; window.__gumDelay = 0; window.__streams = [];
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return window.__hid; } });
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return window.__hid ? 'hidden' : 'visible'; } });
  (() => { const md = navigator.mediaDevices; const g = md.getUserMedia.bind(md); md.getUserMedia = async (c) => { if (window.__gumDelay) await new Promise((r) => setTimeout(r, window.__gumDelay)); const s = await g(c); window.__streams.push(s); return s; }; })();
`;

// ---- page-side probes (run through page.evaluate; waitForFunction is blocked by the CSP) ----
const pConnected = () => { const p = window.__pcs[window.__pcs.length - 1]; return Boolean(p) && (p.iceConnectionState === 'connected' || p.iceConnectionState === 'completed'); };
const pLocked = () => !document.getElementById('lock').hidden;
const pIncoming = () => document.getElementById('call-incoming').open;
const pPanel = () => document.getElementById('call-panel').open;
const pStatus = () => document.getElementById('call-status').textContent;
const pBlanked = () => document.body.classList.contains('is-blanked');
const pTracks = () => window.__streams.flatMap((s) => s.getTracks().map((t) => t.readyState));
const pPcStates = () => window.__pcs.map((p) => p.connectionState);
const endedText = () => { const t = document.getElementById('call-status').textContent; return t === 'Call ended' || t === 'No answer' || t === 'Call failed' ? t : null; };

async function poll(page, fn, arg, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    await sleep(100);
  }
  throw new Error('timeout waiting for ' + what);
}

function check(name, cond, extra) {
  const ok = Boolean(cond);
  results.push({ scenario: currentName, name, ok });
  log((ok ? '  ok   ' : '  FAIL ') + name + (extra === undefined ? '' : ' [' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) + ']'));
  if (!ok) failures.push(currentName + ': ' + name);
  return ok;
}

// ---- database ----
async function callRows(afterId) {
  return (await db.query(
    "select id::int as id, type, scope::int as scope, detail from tripp.events where id > $1 and type like 'call\\_%' and detail->>'conversation' = $2 order by id",
    [afterId, String(convId)])).rows;
}
async function maxEvent() { return Number((await db.query('select coalesce(max(id),0) m from tripp.events')).rows[0].m); }
// Waits until the rows satisfy `ready`, then returns them (or whatever there is after the timeout).
async function rowsWhen(afterId, ready, ms = 15000) {
  const end = Date.now() + ms;
  let rows = await callRows(afterId);
  while (!ready(rows) && Date.now() < end) { await sleep(400); rows = await callRows(afterId); }
  return rows;
}
const show = (rows) => rows.forEach((r) => log('    ' + r.id + ' ' + r.type + ' scope=' + r.scope + ' ' + JSON.stringify({ ...r.detail, call: String(r.detail.call).slice(0, 8), conversation: undefined })));
const ofType = (rows, t) => rows.filter((r) => r.type === t);

// ---- browser side ----
function hook(page, who) {
  page.on('pageerror', (e) => { log('  pageerror ' + who + ': ' + e.message); consoleLines.push(who + ' pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(currentName + ' ' + who + ' ' + m.type() + ': ' + m.text()); });
}
async function newAdmin() {
  const tok = randomBytes(24).toString('hex');
  adminTokens.push(tok);
  await db.query('insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash($1), null)', [tok]);
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(INIT);
  await ctx.route('**/functions/v1/open', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, token: tok, role: 'admin' }) }));
  const page = await ctx.newPage();
  hook(page, 'admin');
  await page.goto(BASE);
  await page.fill('#lock-password', 'x');
  await page.click('#lock-submit');
  await page.waitForSelector('.conv-item[data-id="' + convId + '"]', { timeout: 10000 });
  await page.click('.conv-item[data-id="' + convId + '"]');
  return { ctx, page, name: 'admin' };
}
async function newGuest(name = 'guest') {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  hook(page, name);
  await page.goto(BASE);
  await page.fill('#lock-password', PASS);
  await page.click('#lock-submit');
  await page.waitForSelector('#portal:not([hidden])', { timeout: 10000 });
  return { ctx, page, name };
}
async function callButtonsReady(...peers) {
  for (const p of peers) await p.page.locator('#call-audio').waitFor({ state: 'visible', timeout: 20000 });
}
// Ends whatever is still going on a page, so the audit record has no dangling call_start.
async function settle(p) {
  try {
    if (await p.page.evaluate(pIncoming)) await p.page.click('#call-decline', { timeout: 3000 });
    else if (await p.page.evaluate(pPanel)) {
      const b = p.page.locator('#call-hangup');
      if (await b.isVisible()) await b.click({ timeout: 3000 });
    }
  } catch (e) { /* page may already be locked or closed */ }
}
// TRIPP_ONLY=7 (or 1,3) runs only those scenarios.
const only = process.env.TRIPP_ONLY ? process.env.TRIPP_ONLY.split(',') : null;
async function scenario(name, fn) {
  if (only && !only.includes(name.split('.')[0])) return;
  currentName = name;
  log('\n== ' + name);
  const open = [];
  const before = await maxEvent();
  try {
    await fn(open, before);
  } catch (e) {
    check('scenario ran without error', false, e.message);
    try { log('    rows so far:'); show(await callRows(before)); } catch (e2) { /* ignore */ }
    for (const p of open) {
      try { log('    ws ' + p.name + ': ' + JSON.stringify(await p.page.evaluate(() => window.__wsLog))); } catch (e2) { /* ignore */ }
      try { log('    state ' + p.name + ': status=' + JSON.stringify(await p.page.evaluate(pStatus)) + ' panel=' + (await p.page.evaluate(pPanel)) + ' incoming=' + (await p.page.evaluate(pIncoming)) + ' pcs=' + JSON.stringify(await p.page.evaluate(pPcStates))); } catch (e2) { /* ignore */ }
    }
  } finally {
    for (const p of open) await settle(p);
    await sleep(1500);
    for (const p of open) { try { await p.ctx.close(); } catch (e) { /* ignore */ } }
  }
}

try {
  startedAt = (await db.query('select now() as n')).rows[0].n;
  pre = {
    ev: await maxEvent(),
    vi: Number((await db.query('select coalesce(max(id),0) m from tripp.visits')).rows[0].m),
  };
  origSeen = (await db.query('select audit_seen from tripp.settings where id=1')).rows[0].audit_seen;
  convId = Number((await db.query("insert into tripp.conversations (label, hash) values ('T', extensions.crypt($1, extensions.gen_salt('bf', 10))) returning id", [PASS])).rows[0].id);
  log('temporary conversation T=' + convId);
  browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

  // 1. Guest audio call, admin answers, admin hangs up.
  await scenario('1. guest audio call, admin answers and hangs up', async (open, before) => {
    const a = await newAdmin(); open.push(a);
    const g = await newGuest(); open.push(g);
    await callButtonsReady(a, g);
    await g.page.click('#call-audio');
    await poll(a.page, pIncoming, null, 15000, 'admin incoming dialog');
    check('admin sees the incoming dialog', true, await a.page.evaluate(() => document.getElementById('call-incoming-text').textContent));
    check('guest shows Calling', (await g.page.evaluate(pStatus)) === 'Calling', await g.page.evaluate(pStatus));
    await a.page.click('#call-answer');
    await poll(a.page, pConnected, null, 20000, 'admin connected');
    await poll(g.page, pConnected, null, 20000, 'guest connected');
    check('both sides connected, panels open', (await a.page.evaluate(pPanel)) && (await g.page.evaluate(pPanel)));
    await sleep(3000);
    await a.page.click('#call-hangup');
    await poll(g.page, endedText, null, 10000, 'guest Call ended');
    check('guest UI shows Call ended', true);
    check('admin UI shows Call ended or panel already closed', (await a.page.evaluate(pStatus)) === 'Call ended' || !(await a.page.evaluate(pPanel)));
    const rows = await rowsWhen(before, (r) => ofType(r, 'call_end').length >= 2);
    show(rows);
    const start = ofType(rows, 'call_start'), ans = ofType(rows, 'call_answer'), ends = ofType(rows, 'call_end');
    check('one call_start, scope T, kind audio', start.length === 1 && start[0].scope === convId && start[0].detail.kind === 'audio');
    check('one call_answer, scope 0', ans.length === 1 && ans[0].scope === 0);
    check('two call_end, both hangup', ends.length === 2 && ends.every((e) => e.detail.reason === 'hangup'));
    const adminEnd = ends.find((e) => e.scope === 0);
    check('admin call_end duration_s >= 2', adminEnd && adminEnd.detail.duration_s >= 2, adminEnd && adminEnd.detail.duration_s);
    check('relay is host, srflx or prflx on both ends', ends.length === 2 && ends.every((e) => ['host', 'srflx', 'prflx'].includes(e.detail.relay)), ends.map((e) => e.detail.relay));
    check('all rows belong to one call id', new Set(rows.map((r) => r.detail.call)).size === 1);
  });

  // 2. Admin calls, guest declines.
  await scenario('2. admin calls, guest declines', async (open, before) => {
    const a = await newAdmin(); open.push(a);
    const g = await newGuest(); open.push(g);
    await callButtonsReady(a, g);
    await a.page.click('#call-audio');
    await poll(g.page, pIncoming, null, 15000, 'guest incoming dialog');
    check('guest sees Incoming call', (await g.page.evaluate(() => document.getElementById('call-incoming-text').textContent)) === 'Incoming call');
    await g.page.click('#call-decline');
    await poll(a.page, endedText, null, 10000, 'admin call ended');
    check('admin UI shows Call ended', (await a.page.evaluate(pStatus)) === 'Call ended' || !(await a.page.evaluate(pPanel)));
    check('guest incoming dialog closed', !(await g.page.evaluate(pIncoming)));
    await rowsWhen(before, (r) => ofType(r, 'call_end').length >= 1);
    await sleep(1500);
    const rows = await callRows(before);
    show(rows);
    const start = ofType(rows, 'call_start'), ends = ofType(rows, 'call_end');
    check('call_start scope 0, conversation T', start.length === 1 && start[0].scope === 0 && start[0].detail.conversation === convId);
    check('caller logs exactly one call_end, reason declined', ends.length === 1 && ends[0].scope === 0 && ends[0].detail.reason === 'declined');
    check('no call_answer', ofType(rows, 'call_answer').length === 0);
  });

  // 3. Admin calls, nobody answers (waits the real 45 s ring timeout).
  await scenario('3. admin calls, nobody answers', async (open, before) => {
    const a = await newAdmin(); open.push(a);
    const g = await newGuest(); open.push(g);
    await callButtonsReady(a, g);
    await a.page.click('#call-audio');
    await poll(g.page, pIncoming, null, 15000, 'guest incoming dialog');
    const t0 = Date.now();
    const txt = await poll(a.page, endedText, null, 60000, 'admin No answer');
    const secs = Math.round((Date.now() - t0) / 1000);
    check('admin UI shows No answer after about 45 s', txt === 'No answer' && secs >= 40 && secs <= 55, txt + ' after ' + secs + ' s');
    await poll(g.page, () => !document.getElementById('call-incoming').open, null, 10000, 'guest dialog closed');
    check('guest incoming dialog closed', true);
    const rows = await rowsWhen(before, (r) => ofType(r, 'call_end').length >= 1);
    show(rows);
    const ends = ofType(rows, 'call_end');
    check('call_start then one call_end, reason missed, scope 0', ofType(rows, 'call_start').length === 1 && ends.length === 1 && ends[0].scope === 0 && ends[0].detail.reason === 'missed');
    check('no call_answer', ofType(rows, 'call_answer').length === 0);
  });

  // 4. Guest in a call fires blur.
  await scenario('4. guest in a call fires blur', async (open, before) => {
    const a = await newAdmin(); open.push(a);
    const g = await newGuest(); open.push(g);
    await callButtonsReady(a, g);
    await a.page.click('#call-video');
    await poll(g.page, pIncoming, null, 15000, 'guest incoming dialog');
    await g.page.click('#call-answer');
    await poll(a.page, pConnected, null, 20000, 'admin connected');
    await poll(g.page, pConnected, null, 20000, 'guest connected');
    check('guest has live tracks before the blur', (await g.page.evaluate(pTracks)).some((s) => s === 'live'));
    const t0 = Date.now();
    await g.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    check('guest is locked', await g.page.evaluate(pLocked));
    await poll(a.page, endedText, null, 10000, 'admin Call ended');
    check('admin UI shows Call ended within 10 s', true, (Date.now() - t0) + ' ms');
    const tracks = await g.page.evaluate(pTracks);
    check('every guest track has readyState ended', tracks.length > 0 && tracks.every((s) => s === 'ended'), tracks);
    check('guest peer connection closed', (await g.page.evaluate(pPcStates)).every((s) => s === 'closed'));
    const rows = await rowsWhen(before, (r) => ofType(r, 'call_end').length >= 2);
    show(rows);
    const ends = ofType(rows, 'call_end');
    const gEnd = ends.find((e) => e.scope === convId), aEnd = ends.find((e) => e.scope === 0);
    check('guest call_end reason lock', gEnd && gEnd.detail.reason === 'lock', gEnd && gEnd.detail.reason);
    check('admin call_end reason hangup or failed', aEnd && ['hangup', 'failed'].includes(aEnd.detail.reason), aEnd && aEnd.detail.reason);
  });

  // 5. Guest is mid permission prompt when it loses focus.
  await scenario('5. guest loses focus during the media prompt', async (open, before) => {
    const a = await newAdmin(); open.push(a);
    const g = await newGuest(); open.push(g);
    await callButtonsReady(a, g);
    await g.page.evaluate(() => { window.__gumDelay = 3500; });
    await a.page.click('#call-audio');
    await poll(g.page, pIncoming, null, 15000, 'guest incoming dialog');
    await g.page.click('#call-answer');
    await sleep(400);
    await g.page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.__hid = true; document.dispatchEvent(new Event('visibilitychange')); });
    check('page is blanked while the prompt is up', await g.page.evaluate(pBlanked));
    check('guest is not locked', !(await g.page.evaluate(pLocked)));
    await sleep(500);
    await g.page.evaluate(() => { window.__hid = false; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    check('blank cleared once focus is back', !(await g.page.evaluate(pBlanked)));
    await poll(a.page, pConnected, null, 25000, 'admin connected');
    await poll(g.page, pConnected, null, 25000, 'guest connected');
    check('call proceeds and connects on both sides', true);
    check('guest still not locked', !(await g.page.evaluate(pLocked)));
    check('guest tracks live', (await g.page.evaluate(pTracks)).every((s) => s === 'live'));
    await a.page.click('#call-hangup');
    await poll(g.page, endedText, null, 10000, 'guest Call ended');
    const rows = await rowsWhen(before, (r) => ofType(r, 'call_end').length >= 2);
    show(rows);
    check('start, answer and two ends logged', ofType(rows, 'call_start').length === 1 && ofType(rows, 'call_answer').length === 1 && ofType(rows, 'call_end').length === 2);
  });

  // 6. Two guest tabs on T; admin calls; tab 1 answers.
  await scenario('6. two guest tabs, one answers', async (open, before) => {
    const a = await newAdmin(); open.push(a);
    const g1 = await newGuest('guest1'); open.push(g1);
    const g2 = await newGuest('guest2'); open.push(g2);
    await callButtonsReady(a, g1, g2);
    await a.page.click('#call-audio');
    await poll(g1.page, pIncoming, null, 15000, 'tab 1 incoming');
    await poll(g2.page, pIncoming, null, 15000, 'tab 2 incoming');
    check('both tabs ring', true);
    await g1.page.click('#call-answer');
    const t0 = Date.now();
    await poll(g2.page, () => !document.getElementById('call-incoming').open, null, 3000, 'tab 2 stops ringing');
    check('tab 2 stops ringing within 3 s', true, (Date.now() - t0) + ' ms');
    await poll(a.page, pConnected, null, 20000, 'admin connected');
    await poll(g1.page, pConnected, null, 20000, 'tab 1 connected');
    check('admin and tab 1 connected, tab 2 idle', !(await g2.page.evaluate(pPanel)) && (await g2.page.evaluate(() => window.__pcs.length)) === 0);
    await sleep(1500);
    await a.page.click('#call-hangup');
    await poll(g1.page, endedText, null, 10000, 'tab 1 Call ended');
    await sleep(1500);
    const rows = await rowsWhen(before, (r) => ofType(r, 'call_end').length >= 2);
    show(rows);
    check('exactly one call_answer', ofType(rows, 'call_answer').length === 1);
    check('one call id, one start, two ends', new Set(rows.map((r) => r.detail.call)).size === 1 && ofType(rows, 'call_start').length === 1 && ofType(rows, 'call_end').length === 2);
    check('tab 2 is still signed in and not in a call', !(await g2.page.evaluate(pLocked)) && !(await g2.page.evaluate(pPanel)));
  });

  // 7. Glare: both press Call within 100 ms (retried up to 3 times if the two rings did not cross).
  await scenario('7. glare', async (open, before) => {
    let rows = [], attempt, a, g;
    for (attempt = 1; attempt <= 3; attempt++) {
      a = await newAdmin(); open.push(a);
      g = await newGuest(); open.push(g);
      await callButtonsReady(a, g);
      const mark = await maxEvent();
      const click = () => document.getElementById('call-audio').click();
      await Promise.all([a.page.evaluate(click), g.page.evaluate(click)]);
      await sleep(4000);
      rows = await rowsWhen(mark, (r) => ofType(r, 'call_start').length >= 2, 6000);
      if (ofType(rows, 'call_start').length >= 2) break;
      log('  attempt ' + attempt + ' did not cross (starts: ' + ofType(rows, 'call_start').length + '), retrying');
      await settle(a); await settle(g); await sleep(2500);
    }
    check('both rings crossed (two call_start rows)', ofType(rows, 'call_start').length === 2, 'attempt ' + attempt);
    await poll(a.page, pConnected, null, 20000, 'admin connected');
    await poll(g.page, pConnected, null, 20000, 'guest connected');
    check('exactly one call connects: one connected peer connection per side', (await a.page.evaluate(pPcStates)).filter((s) => s === 'connected').length === 1 && (await g.page.evaluate(pPcStates)).filter((s) => s === 'connected').length === 1);
    await sleep(1500);
    await a.page.click('#call-hangup');
    await poll(g.page, endedText, null, 10000, 'guest Call ended');
    const all = await rowsWhen(before, (r) => ofType(r, 'call_end').length >= 3, 15000);
    show(all);
    const starts = ofType(all, 'call_start').filter((s) => rows.some((x) => x.id === s.id)), answers = ofType(all, 'call_answer');
    const ids = starts.map((s) => s.detail.call);
    check('two distinct call ids', new Set(ids).size === 2);
    check('exactly one call_answer (among the crossed calls)', answers.filter((x) => ids.includes(x.detail.call)).length === 1);
    const win = answers.length ? answers[answers.length - 1].detail.call : null;
    const lose = ids.find((i) => i !== win);
    const loseEnds = all.filter((r) => r.type === 'call_end' && r.detail.call === lose);
    check('losing id has exactly one call_end, reason hangup', loseEnds.length === 1 && loseEnds[0].detail.reason === 'hangup', loseEnds.map((e) => e.detail.reason + '/' + e.detail.relay));
    check('losing id has no call_answer', all.filter((r) => r.type === 'call_answer' && r.detail.call === lose).length === 0);
    check('smaller call id won', win !== null && ids.every((i) => win <= i));
    check('winning id has two call_end rows', all.filter((r) => r.type === 'call_end' && r.detail.call === win).length === 2);
  });
} catch (e) {
  log('FATAL ' + e.message);
  failures.push('fatal: ' + e.message);
} finally {
  try { if (browser) await browser.close(); } catch (e) { /* ignore */ }
  try {
    // A call_start with no call_end would be a dangling call: report it.
    if (convId) {
      const rows = await callRows(pre.ev);
      const byCall = new Map();
      for (const r of rows) {
        const c = byCall.get(r.detail.call) || { s: 0, e: 0 };
        if (r.type === 'call_start') c.s++;
        if (r.type === 'call_end') c.e++;
        byCall.set(r.detail.call, c);
      }
      const dangling = [...byCall].filter(([, c]) => c.s > 0 && c.e === 0).map(([k]) => k);
      currentName = 'audit';
      check('no dangling call_start (every started call has a call_end)', dangling.length === 0, dangling);
    }
    const evAll = (await db.query('select id::int as id, type, scope::int as scope from tripp.events where id > $1 order by id', [pre.ev])).rows;
    const viAll = (await db.query('select id::int as id, scope::int as scope from tripp.visits where id > $1 order by id', [pre.vi])).rows;
    log('\nvisit ids created: ' + viAll.map((v) => v.id).join(', '));
    log('event ids created (' + evAll.length + '): ' + evAll.map((e) => e.id + ':' + e.type + '@' + e.scope).join(', '));
    await db.query('update tripp.settings set audit_seen = $1 where id=1', [origSeen]);
    for (const t of adminTokens) await db.query('delete from tripp.sessions where token_hash = tripp.token_hash($1)', [t]);
    if (convId) {
      await db.query('delete from tripp.sessions where conversation_id = $1', [convId]);
      await db.query('delete from tripp.conversations where id = $1', [convId]);
    }
    const u = (await db.query('select id from auth.users where is_anonymous and created_at > $1', [startedAt])).rows.map((r) => r.id);
    if (u.length) {
      await db.query('delete from tripp.live_bindings where uid = any($1::uuid[])', [u]);
      await db.query('delete from auth.users where id = any($1::uuid[])', [u]);
    }
    log('cleanup: deleted conversation ' + convId + ', ' + adminTokens.length + ' admin sessions, ' + u.length + ' anonymous users');
    const chain = (await db.query("select tripp.verify_chain('events') as e, tripp.verify_chain('visits') as v")).rows[0];
    log('verify_chain events=' + JSON.stringify(chain.e) + ' visits=' + JSON.stringify(chain.v));
    if (!chain.e.ok || !chain.v.ok) failures.push('verify_chain not ok');
  } catch (e) { log('CLEANUP ERROR ' + e.message); failures.push('cleanup: ' + e.message); }
  log('console errors/warnings: ' + JSON.stringify(consoleLines));
  await db.end();
  const pass = results.filter((r) => r.ok).length;
  log('\n' + pass + '/' + results.length + ' checks passed; ' + (failures.length ? 'FAILED: ' + failures.join(' | ') : 'ALL PASSED'));
  process.exitCode = failures.length ? 1 : 0;
}
