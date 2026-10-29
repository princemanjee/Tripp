// Tripp live client. Binds an anonymous Supabase Auth user to a Tripp session
// token (m_live_bind), then opens private Realtime channels that the database
// authorizes per conversation. Needs vendor/supabase-*.js and config.js first.
(function () {
	'use strict';

	var root = typeof window !== 'undefined' ? window : globalThis;
	var peerId = root.crypto.randomUUID();
	var client = null;

	function start(token) {
		var cfg = root.APP_CONFIG;
		if (!cfg || !root.supabase) return Promise.reject(new Error('live'));
		return stop().then(function () {
			var c = root.supabase.createClient(cfg.url, cfg.key, {
				auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
			});
			return c.auth.signInAnonymously().then(function (r) {
				if (r.error) throw new Error('live');
				return c.rpc('m_live_bind', { p_token: token });
			}).then(function (r) {
				if (r.error || !r.data) throw new Error('live');
				if (!r.data.ok) throw new Error(r.data.error === 'no_user' || r.data.error === 'expired' ? r.data.error : 'live');
				return c.realtime.setAuth().then(function () {
					client = c;
					return { scope: Number(r.data.scope) };
				});
			}).catch(function (e) {
				var msg = e && (e.message === 'no_user' || e.message === 'expired') ? e.message : 'live';
				return c.auth.signOut().catch(function () {}).then(function () { throw new Error(msg); });
			});
		});
	}

	function channel(topic, presenceKey) {
		if (!client) throw new Error('live');
		return client.channel(topic, {
			config: { private: true, broadcast: { self: false }, presence: { key: presenceKey || '' } }
		});
	}

	function stop() {
		var c = client;
		if (!c) return Promise.resolve();
		client = null;
		return Promise.resolve().then(function () { return c.removeAllChannels(); })
			.catch(function () {})
			.then(function () { return c.auth.signOut(); })
			.catch(function () {})
			.then(function () {});
	}

	root.TrippLive = { start: start, channel: channel, stop: stop, peerId: peerId };
})();
