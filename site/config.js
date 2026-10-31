// Address and publishable key of the backing project. Both are public by design:
// the key can only call the password-checked functions, nothing else.
// `functions` is where the Edge Functions live. `iceServers` is used by calls;
// `turn` is the Edge Function that adds the TURN relay after them, per call.
window.APP_CONFIG = {
	url: 'https://ohhkzjsdabdimlrgnagw.supabase.co',
	key: 'sb_publishable_BKvG3mZolQFylaMMtiS9bw_sI1ZUFlq',
	functions: 'https://ohhkzjsdabdimlrgnagw.supabase.co/functions/v1',
	iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }],
	turn: 'turn'
};
