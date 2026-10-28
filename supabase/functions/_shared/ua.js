// User-agent parsing for the Edge Functions.
//
// Reads a User-Agent header into a coarse operating system and browser, enough
// for the sign-in record and nothing more. Plain ESM with no Deno-only APIs, so
// the Node tests and the Edge Functions run the same file. The checks are
// ordered on purpose: browsers that disguise themselves as Chrome (Edge, Opera,
// Samsung Internet) are tested first, and Chrome before Safari.

export function parseUserAgent(ua) {
  const s = typeof ua === 'string' ? ua : '';
  return { os: detectOs(s), browser: detectBrowser(s) };
}

function detectOs(s) {
  if (/iPhone|iPad|iPod/.test(s)) return 'iOS';
  // iPad in desktop mode claims to be a Mac but still sends "Mobile/".
  if (/Macintosh/.test(s) && /Mobile\//.test(s)) return 'iOS';
  if (/Android/.test(s)) return 'Android';
  if (/Windows/.test(s)) return 'Windows';
  if (/Macintosh|Mac OS X/.test(s)) return 'macOS';
  if (/Linux|X11|CrOS/.test(s)) return 'Linux';
  return 'other';
}

function detectBrowser(s) {
  if (/Edg(e|A|iOS)?\//.test(s)) return 'Edge';
  if (/OPR\/|Opera|OPiOS/.test(s)) return 'Opera';
  if (/SamsungBrowser\//.test(s)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(s)) return 'Firefox';
  if (/Chrome\/|Chromium\/|CriOS\//.test(s)) return 'Chrome';
  if (/Safari\//.test(s)) return 'Safari';
  return 'other';
}
