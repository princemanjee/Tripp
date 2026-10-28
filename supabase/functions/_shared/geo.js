// Geo-IP lookup for the Edge Functions, via ip-api.com.
//
// Never rejects: any failure (network, timeout, bad payload, status other than
// success) returns the same shape with 'unknown' strings, null coordinates and
// source 'none'. Private, loopback and unknown addresses skip the request
// entirely. Plain ESM using only globals present in both Deno and Node.

const NONE = Object.freeze({
  isp: 'unknown', org: 'unknown', country: 'unknown', region: 'unknown',
  city: 'unknown', lat: null, lon: null, source: 'none',
});

// 10/8, 172.16/12, 192.168/16, 127/8, ::1, fc00::/7, fe80::/10, 'unknown'.
function isPrivate(ip) {
  const s = String(ip).trim().toLowerCase().replace(/^::ffff:/, '');
  if (!s || s === 'unknown') return true;
  if (/^(10|127)\./.test(s) || /^192\.168\./.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return true;
  if (s === '::1' || s === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(s)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(s)) return true;
  return false;
}

const str = (v) => (typeof v === 'string' && v ? v : 'unknown');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function lookupGeo(ip, opts = {}) {
  const doFetch = opts.fetch || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 1500;
  if (isPrivate(ip)) return { ...NONE };

  const ctrl = new AbortController();
  let timer;
  try {
    // The race guarantees a prompt answer even if a fetch ignores the abort.
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => { ctrl.abort(); reject(new Error('timeout')); }, timeoutMs);
    });
    const url = 'http://ip-api.com/json/' + encodeURIComponent(ip) +
      '?fields=status,country,regionName,city,lat,lon,isp,org';
    const work = (async () => {
      const res = await doFetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    })();
    work.catch(() => {}); // a late failure after the timeout is not unhandled
    const d = await Promise.race([work, timedOut]);
    if (!d || d.status !== 'success') return { ...NONE };
    return {
      isp: str(d.isp), org: str(d.org), country: str(d.country),
      region: str(d.regionName), city: str(d.city),
      lat: num(d.lat), lon: num(d.lon), source: 'ip-api.com',
    };
  } catch {
    return { ...NONE };
  } finally {
    clearTimeout(timer);
  }
}
