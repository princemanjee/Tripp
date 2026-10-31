// Tripp live client. Binds an anonymous Supabase Auth user to a Tripp session
// token (m_live_bind), then opens private Realtime channels that the database
// authorizes per conversation. Needs vendor/supabase-*.js and config.js first.
(function () {
	'use strict';

	var root = typeof window !== 'undefined' ? window : globalThis;
	var peerId = root.crypto.randomUUID();
	var client = null;

	// Bumped by every start() and stop(). A start() whose generation is no longer
	// current tears down whatever it built and rejects.
	var gen = 0;

	function fail(code) {
		var e = new Error(code || 'live');
		e.tripp = true;
		return e;
	}

	function teardown(c) {
		return Promise.resolve().then(function () { return c.removeAllChannels(); })
			.catch(function () {})
			.then(function () { c.auth.stopAutoRefresh(); return c.auth.signOut(); })
			.then(function (r) {
				if (r && r.error) return c.auth.signOut({ scope: 'local' });
			})
			.catch(function () {})
			.then(function () {});
	}

	function start(token) {
		var cfg = root.APP_CONFIG;
		if (!cfg || !root.supabase) return Promise.reject(new Error('live'));
		var my = ++gen;
		var old = client;
		client = null;
		return (old ? teardown(old) : Promise.resolve()).then(function () {
			var c = root.supabase.createClient(cfg.url, cfg.key, {
				auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
			});
			function current() { if (gen !== my) throw fail('live'); }
			return c.auth.signInAnonymously().then(function (r) {
				current();
				if (r.error) throw fail('live');
				return c.rpc('m_live_bind', { p_token: token });
			}).then(function (r) {
				current();
				if (r.error || !r.data) throw fail('live');
				if (!r.data.ok) throw fail(r.data.error);
				return c.realtime.setAuth().then(function () {
					current();
					client = c;
					return { scope: Number(r.data.scope) };
				});
			}).catch(function (e) {
				return teardown(c).then(function () { throw e && e.tripp ? e : fail('live'); });
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
		gen++;
		var c = client;
		client = null;
		return c ? teardown(c) : Promise.resolve();
	}

	root.TrippLive = { start: start, channel: channel, stop: stop, peerId: peerId };
})();
