// Address and publishable key of the backing project. Both are public by design:
// the key can only call the password-checked functions, nothing else.
// `functions` is where the Edge Functions live; `notice` is shown on the sign-in
// screen and its version is sent with each sign-in as the recorded consent.
window.APP_CONFIG = {
	url: 'https://ohhkzjsdabdimlrgnagw.supabase.co',
	key: 'sb_publishable_BKvG3mZolQFylaMMtiS9bw_sI1ZUFlq',
	functions: 'https://ohhkzjsdabdimlrgnagw.supabase.co/functions/v1',
	notice: {
		version: 1,
		text: 'Everything you do here is recorded: when you visit, your IP address and approximate location, your device and browser, and every message and file. Records are kept and may be shared with legal counsel or produced in legal proceedings. Tick the box to continue.'
	}
};
