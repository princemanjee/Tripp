// TURN REST API credentials (coturn use-auth-secret): the username is
// "<unix expiry>:<label>" and the password is base64(HMAC-SHA1(secret, username)).
// coturn checks the expiry only when an allocation is created; an allocation
// already made keeps working past it. Plain ESM using only Web Crypto and
// globals present in both Deno and Node.

export const TURN_URLS = [
  'turn:coturn.princerehman.com:3478?transport=udp',
  'turn:coturn.princerehman.com:3478?transport=tcp',
  'turns:coturn.princerehman.com:5349?transport=tcp',
];

// One ICE server entry valid for ttlSeconds from nowMs.
export async function turnServer(secret, ttlSeconds, nowMs = Date.now(), label = 'tripp') {
  if (typeof secret !== 'string' || !secret) throw new Error('turn secret missing');
  const username = Math.floor(nowMs / 1000) + ttlSeconds + ':' + label;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(username)));
  let bin = '';
  for (const b of mac) bin += String.fromCharCode(b);
  return { urls: TURN_URLS.slice(), username, credential: btoa(bin) };
}
