// Encrypted attachments. The browser encrypts every file before it leaves, so
// the private `tripp-media` bucket holds only ciphertext. This function hands
// out short-lived signed URLs after the token checks in tripp.media_reserve and
// tripp.media_readable, and empties the Storage trash queue.
//
// POST {action, token, ...}:
//   upload_url    {conversation?, kind, bytes} -> {ok, path, signed_url}
//   download_url  {attachment}                 -> {ok, signed_url}
//   sweep         (no token)                   -> {ok, removed}
import postgres from 'npm:postgres@3.4.4';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { cors, json } from '../_shared/http.js';

const BUCKET = 'tripp-media';
const DOWNLOAD_SECONDS = 60;
const SWEEP_LIMIT = 100;

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 });
const storage = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from(BUCKET);

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

async function uploadUrl(body: any) {
  const conversation = body.conversation === undefined || body.conversation === null ? null : body.conversation;
  if (typeof body.token !== 'string' || typeof body.kind !== 'string'
      || !(conversation === null || isId(conversation))
      || typeof body.bytes !== 'number' || !Number.isSafeInteger(body.bytes)) {
    return { ok: false, error: 'bad_request' };
  }
  const rows = await sql`select tripp.media_reserve(${body.token}, ${conversation}, ${body.kind}, ${body.bytes}) as r`;
  const reserved = rows[0].r;
  if (!reserved || !reserved.ok) return reserved;
  const { data, error } = await storage.createSignedUploadUrl(reserved.path);
  if (error || !data) throw new Error('signed upload url: ' + (error ? error.message : 'no data'));
  return { ok: true, path: reserved.path, signed_url: data.signedUrl };
}

async function downloadUrl(body: any) {
  if (typeof body.token !== 'string' || !isId(body.attachment)) {
    return { ok: false, error: 'bad_request' };
  }
  const rows = await sql`select tripp.media_readable(${body.token}, ${body.attachment}) as r`;
  const readable = rows[0].r;
  if (!readable || !readable.ok) return readable;
  const { data, error } = await storage.createSignedUrl(readable.path, DOWNLOAD_SECONDS);
  if (error || !data) throw new Error('signed url: ' + (error ? error.message : 'no data'));
  return { ok: true, signed_url: data.signedUrl };
}

// Paths stay queued until Storage confirms the remove, so a failure here is retried next time.
async function sweep() {
  const rows = await sql`select tripp.media_trash_take(${SWEEP_LIMIT}) as path`;
  const paths: string[] = rows.map((row: any) => row.path);
  if (!paths.length) return { ok: true, removed: 0 };
  const { error } = await storage.remove(paths);
  if (error) throw new Error('remove: ' + error.message);
  await sql`select tripp.media_trash_done(array(select jsonb_array_elements_text(${JSON.stringify(paths)}::text::jsonb)))`;
  return { ok: true, removed: paths.length };
}

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
    if (!body || typeof body.action !== 'string') {
      return json({ ok: false, error: 'bad_request' }, 200, origin);
    }
    if (body.action === 'upload_url') return json(await uploadUrl(body), 200, origin);
    if (body.action === 'download_url') return json(await downloadUrl(body), 200, origin);
    if (body.action === 'sweep') return json(await sweep(), 200, origin);
    return json({ ok: false, error: 'bad_request' }, 200, origin);
  } catch (e) {
    console.error('media failed:', e instanceof Error ? e.message : 'unknown');
    return json({ ok: false, error: 'server' }, 200, origin);
  }
});
