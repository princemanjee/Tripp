// Sign-in. Checks the password through tripp.open_session, recording the visit
// (IP, device, approximate location, consent version) on the way.
import postgres from 'npm:postgres@3.4.4';
import { parseUserAgent } from '../_shared/ua.js';
import { lookupGeo } from '../_shared/geo.js';
import { clientIp, cors, json } from '../_shared/http.js';

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
    if (!body || typeof body.password !== 'string') {
      return json({ ok: false, error: 'bad_request' }, 200, origin);
    }
    const nv = Number(body.notice_version);
    const noticeVersion = Number.isInteger(nv) ? nv : 0;

    const ua = (req.headers.get('user-agent') || '').slice(0, 512);
    const { os, browser } = parseUserAgent(ua);
    const ip = clientIp(req.headers);
    const geo = await lookupGeo(ip);

    const rows = await sql`select tripp.open_session(${body.password}, ${ip}, ${ua}, ${os}, ${browser}, ${JSON.stringify(geo)}::text::jsonb, ${noticeVersion}) as r`;
    return json(rows[0].r, 200, origin);
  } catch (e) {
    console.error('open failed:', e instanceof Error ? e.message : 'unknown');
    return json({ ok: false, error: 'server' }, 200, origin);
  }
});
