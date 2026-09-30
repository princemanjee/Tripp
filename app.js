(function () {
	'use strict';

	// Never take a password over plain HTTP, whatever the host's redirect settings are.
	if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
		location.replace('https://' + location.host + location.pathname);
		return;
	}

	var config = window.APP_CONFIG || {};
	var POLL_MS = 15000;
	var IDLE_MS = 10 * 60 * 1000;

	// The session token lives in memory only, so closing or reloading the tab locks the portal.
	var token = null;
	var role = null;
	var lastSignature = '';
	var pollTimer = null;
	var idleTimer = null;

	var el = {};
	['lock', 'lock-form', 'lock-password', 'lock-submit', 'lock-status', 'portal', 'sync',
		'open-keys', 'lock-now', 'thread', 'compose', 'compose-body', 'compose-send',
		'compose-status', 'keys', 'keys-form', 'keys-role', 'keys-new', 'keys-again',
		'keys-status', 'keys-cancel', 'keys-save'].forEach(function (id) {
		el[id] = document.getElementById(id);
	});

	var ERRORS = {
		denied: 'That password was not accepted.',
		locked: 'Too many wrong tries. Wait 15 minutes, then try again.',
		expired: 'Locked after a period without activity. Enter your password again.',
		empty: 'Write something before sending.',
		too_long: 'That message is too long. The limit is 10,000 characters.',
		empty_key: 'Enter a password.',
		same_as_other: 'That is already the other person\'s password. The password is the only thing that tells the two of you apart, so they have to differ.',
		forbidden: 'Only the owner can change passwords.',
		bad_role: 'Pick whose password to change.',
		network: 'Could not reach the server. Check your connection and try again.',
		setup: 'This page is not connected to its server yet.'
	};

	function setStatus(node, code) {
		node.textContent = code ? (ERRORS[code] || 'Something went wrong. Try again.') : '';
		node.classList.toggle('is-error', Boolean(code));
	}

	// Calls one database function. Always resolves to an object with `ok`.
	function rpc(name, args) {
		if (!config.url || !config.key) {
			return Promise.resolve({ ok: false, error: 'setup' });
		}
		var headers = { 'Content-Type': 'application/json', 'apikey': config.key };
		// Legacy anon keys are JWTs and also go in Authorization; publishable keys do not.
		if (config.key.indexOf('sb_') !== 0) {
			headers['Authorization'] = 'Bearer ' + config.key;
		}
		return fetch(config.url + '/rest/v1/rpc/' + name, {
			method: 'POST',
			headers: headers,
			body: JSON.stringify(args),
			cache: 'no-store',
			referrerPolicy: 'no-referrer'
		}).then(function (response) {
			if (!response.ok) {
				return { ok: false, error: 'network' };
			}
			return response.json();
		}).then(function (data) {
			return data && typeof data === 'object' ? data : { ok: false, error: 'network' };
		}).catch(function () {
			return { ok: false, error: 'network' };
		});
	}

	function formatTime(iso) {
		var date = new Date(iso);
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	function renderThread(messages) {
		var signature = messages.length + ':' + (messages.length ? messages[messages.length - 1].id : 0);
		if (signature === lastSignature) {
			return;
		}
		lastSignature = signature;

		var thread = el['thread'];
		var nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
		thread.textContent = '';

		if (!messages.length) {
			var empty = document.createElement('p');
			empty.className = 'empty';
			empty.textContent = 'Nothing here yet. Anything either of you writes will show up in this space.';
			thread.appendChild(empty);
			return;
		}

		messages.forEach(function (message) {
			var item = document.createElement('article');
			item.className = message.mine ? 'message is-mine' : 'message';
			var body = document.createElement('p');
			body.className = 'message-body';
			body.textContent = message.body;
			var meta = document.createElement('p');
			meta.className = 'message-meta';
			meta.textContent = (message.mine ? 'You' : 'Them') + ', ' + formatTime(message.at);
			item.appendChild(body);
			item.appendChild(meta);
			thread.appendChild(item);
		});

		if (nearBottom) {
			thread.scrollTop = thread.scrollHeight;
		}
	}

	function refresh() {
		if (!token) {
			return Promise.resolve();
		}
		return rpc('m_list', { p_token: token }).then(function (result) {
			if (!token) {
				return;
			}
			if (result.ok) {
				renderThread(result.messages || []);
				el['sync'].textContent = 'Up to date at ' + new Date().toLocaleTimeString(undefined, { timeStyle: 'short' });
				el['sync'].classList.remove('is-error');
			} else if (result.error === 'expired') {
				lock('expired');
			} else {
				el['sync'].textContent = 'Not connected. Retrying.';
				el['sync'].classList.add('is-error');
			}
		});
	}

	function resetIdle() {
		clearTimeout(idleTimer);
		if (token) {
			idleTimer = setTimeout(function () { lock('expired'); }, IDLE_MS);
		}
	}

	function unlock(result) {
		token = result.token;
		role = result.role;
		lastSignature = '';
		el['thread'].textContent = '';
		el['lock'].hidden = true;
		el['portal'].hidden = false;
		el['open-keys'].hidden = role !== 'owner';
		el['sync'].textContent = 'Loading';
		document.title = 'Notes';
		refresh().then(function () {
			el['thread'].scrollTop = el['thread'].scrollHeight;
		});
		pollTimer = setInterval(function () {
			if (!document.hidden) {
				refresh();
			}
		}, POLL_MS);
		resetIdle();
		el['compose-body'].focus();
	}

	function lock(reason) {
		var old = token;
		token = null;
		role = null;
		clearInterval(pollTimer);
		clearTimeout(idleTimer);
		if (old) {
			rpc('m_close', { p_token: old });
		}
		if (el['keys'].open) {
			el['keys'].close();
		}
		el['keys-form'].reset();
		el['compose'].reset();
		el['thread'].textContent = '';
		lastSignature = '';
		el['portal'].hidden = true;
		el['lock'].hidden = false;
		document.title = 'Sign in';
		setStatus(el['lock-status'], reason || '');
		el['lock-password'].value = '';
		el['lock-password'].focus();
	}

	el['lock-form'].addEventListener('submit', function (event) {
		event.preventDefault();
		var password = el['lock-password'].value;
		el['lock-submit'].disabled = true;
		setStatus(el['lock-status'], '');
		el['lock-status'].textContent = 'Checking';
		rpc('m_open', { p_password: password }).then(function (result) {
			el['lock-submit'].disabled = false;
			el['lock-password'].value = '';
			if (result.ok && result.token) {
				setStatus(el['lock-status'], '');
				unlock(result);
			} else {
				setStatus(el['lock-status'], result.error || 'network');
				el['lock-password'].focus();
			}
		});
	});

	el['compose'].addEventListener('submit', function (event) {
		event.preventDefault();
		var body = el['compose-body'].value;
		if (!body.trim()) {
			setStatus(el['compose-status'], 'empty');
			return;
		}
		el['compose-send'].disabled = true;
		setStatus(el['compose-status'], '');
		el['compose-status'].textContent = 'Sending';
		rpc('m_post', { p_token: token, p_body: body }).then(function (result) {
			el['compose-send'].disabled = false;
			if (result.ok) {
				el['compose-body'].value = '';
				setStatus(el['compose-status'], '');
				refresh().then(function () {
					el['thread'].scrollTop = el['thread'].scrollHeight;
				});
			} else if (result.error === 'expired') {
				// The draft is dropped with the session; say so on the lock screen.
				lock('expired');
			} else {
				setStatus(el['compose-status'], result.error || 'network');
			}
		});
	});

	el['compose-body'].addEventListener('keydown', function (event) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			el['compose'].requestSubmit();
		}
	});

	el['lock-now'].addEventListener('click', function () { lock(''); });

	el['open-keys'].addEventListener('click', function () {
		el['keys-form'].reset();
		setStatus(el['keys-status'], '');
		el['keys'].showModal();
	});

	el['keys-cancel'].addEventListener('click', function () {
		el['keys-form'].reset();
		el['keys'].close();
	});

	el['keys-form'].addEventListener('submit', function (event) {
		event.preventDefault();
		var next = el['keys-new'].value;
		if (next !== el['keys-again'].value) {
			setStatus(el['keys-status'], '');
			el['keys-status'].textContent = 'The two entries do not match. Type the new password again.';
			el['keys-status'].classList.add('is-error');
			return;
		}
		var target = el['keys-role'].value;
		el['keys-save'].disabled = true;
		setStatus(el['keys-status'], '');
		el['keys-status'].textContent = 'Saving';
		rpc('m_setkey', { p_token: token, p_role: target, p_new: next }).then(function (result) {
			el['keys-save'].disabled = false;
			if (result.ok) {
				el['keys-form'].reset();
				el['keys-role'].value = target;
				setStatus(el['keys-status'], '');
				el['keys-status'].textContent = target === 'owner'
					? 'Your password is changed. Use the new one next time.'
					: 'Their password is changed. Give them the new one.';
			} else if (result.error === 'expired') {
				lock('expired');
			} else {
				setStatus(el['keys-status'], result.error || 'network');
			}
		});
	});

	['pointerdown', 'keydown', 'scroll'].forEach(function (name) {
		window.addEventListener(name, resetIdle, { passive: true, capture: true });
	});

	document.addEventListener('visibilitychange', function () {
		if (!document.hidden && token) {
			refresh();
		}
	});
}());
