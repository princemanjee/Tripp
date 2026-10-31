// TURN credentials for a call. The browser sends its session token; when
// tripp.session_scope accepts it, this returns one short-lived ICE server entry
// for the Mac Studio coturn relay. The shared secret is the function secret
// TURN_SECRET and never reaches the browser.
//
// POST {token} -> {ok, iceServers: [{urls, username, credential}], ttl}
import postgres from 'npm:postgres@3.4.4';
import { cors, json } from '../_shared/http.js';
import { turnServer } from '../_shared/turn.js';

const TTL_SECONDS = 600;

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, origin);
  }
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: 'bad_request' }, 200, origin);
    }
    if (!body || typeof body.token !== 'string' || !body.token) {
      return json({ ok: false, error: 'bad_request' }, 200, origin);
    }
    const rows = await sql`select tripp.session_scope(${body.token}) as scope`;
    if (rows[0].scope === null) {
      return json({ ok: false, error: 'session' }, 200, origin);
    }
    // Read per request so a changed secret applies without a redeploy.
    const secret = Deno.env.get('TURN_SECRET') || '';
    if (!secret) {
      return json({ ok: false, error: 'setup' }, 200, origin);
    }
    const server = await turnServer(secret, TTL_SECONDS);
    return json({ ok: true, iceServers: [server], ttl: TTL_SECONDS }, 200, origin);
  } catch (e) {
    console.error('turn failed:', e instanceof Error ? e.message : 'unknown');
    return json({ ok: false, error: 'server' }, 200, origin);
  }
});
