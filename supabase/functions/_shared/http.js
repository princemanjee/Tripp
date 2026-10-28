// HTTP helpers for the Edge Functions: client IP, CORS and JSON responses.
//
// Plain ESM using only globals present in both Deno and Node (Headers,
// Response). The client IP rule comes from the Task 1 spike on the live
// platform: it overwrites any x-forwarded-for the client sends, and the first
// entry of what remains is the real client address.

const ALLOWED_ORIGINS = ['https://cv.princerehman.com', 'http://localhost:8000'];

// First x-forwarded-for entry, else cf-connecting-ip, else 'unknown'.
// Empty or blank values count as missing.
export function clientIp(headers) {
  const first = (headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (first) return first;
  const cf = (headers.get('cf-connecting-ip') || '').trim();
  return cf || 'unknown';
}

// Allow-origin is sent only for an exact match on one of the two origins;
// vary is always sent so caches never mix up answers for different origins.
export function cors(origin) {
  const h = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, apikey, authorization, x-client-info',
    vary: 'origin',
  };
  if (ALLOWED_ORIGINS.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}

export function json(body, status = 200, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...cors(origin),
    },
  });
}
