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
	var CONFIRM_MS = 4000;

	// The session token lives in memory only, so closing or reloading the tab locks the portal.
	var token = null;
	var role = null;                 // 'admin' or 'guest'
	var conversations = [];          // admin only
	var current = null;              // admin only: the open conversation id
	var viewArchived = false;        // admin only
	var editing = null;              // admin only: conversation id in the settings dialog, null for new
	var pendingDelete = null;        // admin only: message id waiting for its second click
	var pendingTimer = null;
	var lastSignature = '';
	var pollTimer = null;
	var idleTimer = null;

	var el = {};
	['lock', 'lock-form', 'lock-password', 'lock-submit', 'lock-status', 'portal', 'sidebar',
		'new-conv', 'conv-list', 'open-admin-key', 'lock-now-side', 'pane', 'back', 'pane-title',
		'sync', 'toggle-archived', 'conv-settings', 'lock-now', 'archived-banner', 'leave-archived',
		'thread', 'compose', 'compose-body', 'compose-send', 'compose-status', 'conv-dialog',
		'conv-form', 'conv-dialog-title', 'conv-label', 'conv-password', 'conv-password-again',
		'conv-hint', 'conv-status', 'conv-delete', 'conv-cancel', 'conv-save', 'admin-key-dialog',
		'admin-key-form', 'admin-key-new', 'admin-key-again', 'admin-key-status', 'admin-key-cancel',
		'admin-key-save', 'conv-hold-row', 'conv-hold', 'retention-days', 'retention-status',
		'retention-save'].forEach(function (id) {
		el[id] = document.getElementById(id);
	});

	var ERRORS = {
		denied: 'That password was not accepted.',
		locked: 'Too many wrong tries. Wait 15 minutes, then try again.',
		expired: 'Locked after a period without activity. Enter your password again.',
		empty: 'Write something before sending.',
		too_long: 'That message is too long. The limit is 10,000 characters.',
		empty_key: 'Enter a password.',
		password_taken: 'That password is already in use. Every password has to be different, because the password is what tells people apart.',
		label_empty: 'Give the conversation a name.',
		label_too_long: 'Keep the name under 100 characters.',
		no_conversation: 'That conversation no longer exists.',
		no_message: 'That message no longer exists.',
		bad_days: 'Enter a whole number of days, 1 or more, or leave it empty.',
		mismatch: 'The two password entries do not match. Type them again.',
		forbidden: 'Only the admin can do that.',
		network: 'Could not reach the server. Check your connection and try again.',
		setup: 'This page is not connected to its server yet.'
	};

	function setStatus(node, code) {
		node.textContent = code ? (ERRORS[code] || 'Something went wrong. Try again.') : '';
		node.classList.toggle('is-error', Boolean(code));
	}

	function setNote(node, text) {
		node.textContent = text;
		node.classList.remove('is-error');
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
		return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	function setSync(ok) {
		if (ok) {
			el['sync'].textContent = 'Up to date at ' + new Date().toLocaleTimeString(undefined, { timeStyle: 'short' });
			el['sync'].classList.remove('is-error');
		} else {
			el['sync'].textContent = 'Not connected. Retrying.';
			el['sync'].classList.add('is-error');
		}
	}

	function currentConversation() {
		for (var i = 0; i < conversations.length; i += 1) {
			if (conversations[i].id === current) {
				return conversations[i];
			}
		}
		return null;
	}

	// ----- Layout -------------------------------------------------------------

	function layout() {
		var admin = role === 'admin';
		var open = admin && current !== null;
		el['portal'].classList.toggle('is-admin', admin);
		el['portal'].classList.toggle('show-list', admin && current === null);
		el['sidebar'].hidden = !admin;
		el['back'].hidden = !open;
		el['toggle-archived'].hidden = !open;
		el['conv-settings'].hidden = !open;
		el['archived-banner'].hidden = !(open && viewArchived);
		el['compose'].hidden = (admin && !open) || viewArchived;
		el['toggle-archived'].classList.toggle('is-on', viewArchived);

		var conv = currentConversation();
		el['pane-title'].textContent = open && conv ? conv.label : '';
		if (open && conv) {
			el['toggle-archived'].textContent = 'Archived (' + conv.archived_count + ')';
		}
	}

	// ----- Conversation list (admin) ------------------------------------------

	function renderConversations() {
		var list = el['conv-list'];
		list.textContent = '';
		if (!conversations.length) {
			var none = document.createElement('li');
			none.className = 'conv-empty';
			none.textContent = 'No conversations yet. Use New to add one.';
			list.appendChild(none);
			return;
		}
		conversations.forEach(function (conv) {
			var item = document.createElement('li');
			var button = document.createElement('button');
			button.type = 'button';
			button.className = conv.id === current ? 'conv-item is-selected' : 'conv-item';
			button.setAttribute('data-id', String(conv.id));
			var name = document.createElement('span');
			name.className = 'conv-name';
			name.textContent = conv.label;
			var meta = document.createElement('span');
			meta.className = 'conv-meta';
			meta.textContent = conv.last_at
				? (conv.last_from_them ? 'They wrote, ' : 'You wrote, ') + formatTime(conv.last_at)
				: 'No messages';
			button.appendChild(name);
			button.appendChild(meta);
			button.addEventListener('click', function () { openConversation(conv.id); });
			item.appendChild(button);
			list.appendChild(item);
		});
	}

	function loadConversations() {
		return rpc('m_convs', { p_token: token }).then(function (result) {
			if (!token) {
				return false;
			}
			if (result.ok) {
				conversations = result.conversations || [];
				if (current !== null && !currentConversation()) {
					current = null;
					viewArchived = false;
					lastSignature = '';
				}
				renderConversations();
				layout();
				return true;
			}
			if (result.error === 'expired') {
				lock('expired');
			}
			return false;
		});
	}

	function openConversation(id) {
		current = id;
		viewArchived = false;
		pendingDelete = null;
		lastSignature = '';
		el['thread'].textContent = '';
		setStatus(el['compose-status'], '');
		renderConversations();
		layout();
		loadThread().then(function () {
			el['thread'].scrollTop = el['thread'].scrollHeight;
		});
	}

	// ----- Thread --------------------------------------------------------------

	function messageActions(message) {
		var actions = document.createElement('div');
		actions.className = 'message-actions';

		function add(label, action, danger) {
			var button = document.createElement('button');
			button.type = 'button';
			button.className = danger ? 'link-button is-danger' : 'link-button';
			button.textContent = label;
			button.addEventListener('click', function () { act(message.id, action); });
			actions.appendChild(button);
		}

		if (!viewArchived) {
			add(message.hidden ? 'Unhide' : 'Hide', message.hidden ? 'unhide' : 'hide');
			add('Archive', 'archive');
		} else {
			add('Restore', 'unarchive');
		}
		if (pendingDelete === message.id) {
			add('Click again to delete for good', 'delete', true);
		} else {
			add('Delete', 'confirm-delete', true);
		}
		return actions;
	}

	function emptyNote() {
		if (role === 'admin' && current === null) {
			return conversations.length ? 'Pick a conversation.' : 'No conversations yet. Use New to add one.';
		}
		if (viewArchived) {
			return 'Nothing archived in this conversation.';
		}
		return 'Nothing here yet. Anything either of you writes will show up in this space.';
	}

	function renderThread(messages) {
		var signature = JSON.stringify([current, viewArchived, pendingDelete, messages.map(function (m) {
			return [m.id, m.hidden];
		})]);
		if (signature === lastSignature) {
			return;
		}
		lastSignature = signature;

		var thread = el['thread'];
		var nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
		var keepScroll = thread.scrollTop;
		thread.textContent = '';

		if (!messages.length) {
			var empty = document.createElement('p');
			empty.className = 'empty';
			empty.textContent = emptyNote();
			thread.appendChild(empty);
			return;
		}

		messages.forEach(function (message) {
			var item = document.createElement('article');
			item.className = 'message' + (message.mine ? ' is-mine' : '') + (message.hidden ? ' is-hidden' : '');
			var body = document.createElement('p');
			body.className = 'message-body';
			body.textContent = message.body;
			var meta = document.createElement('p');
			meta.className = 'message-meta';
			meta.textContent = (message.mine ? 'You' : 'Them') + ', ' + formatTime(message.at) +
				(message.hidden ? '. Hidden from them' : '');
			item.appendChild(body);
			item.appendChild(meta);
			if (role === 'admin') {
				item.appendChild(messageActions(message));
			}
			thread.appendChild(item);
		});

		thread.scrollTop = nearBottom ? thread.scrollHeight : keepScroll;
	}

	function loadThread() {
		if (!token) {
			return Promise.resolve();
		}
		if (role === 'admin' && current === null) {
			renderThread([]);
			setSync(true);
			return Promise.resolve();
		}
		var args = role === 'admin'
			? { p_token: token, p_conversation: current, p_archived: viewArchived }
			: { p_token: token };
		return rpc('m_list', args).then(function (result) {
			if (!token) {
				return;
			}
			if (result.ok) {
				var conv = currentConversation();
				if (conv && typeof result.archived_count === 'number') {
					conv.archived_count = result.archived_count;
					layout();
				}
				renderThread(result.messages || []);
				setSync(true);
			} else if (result.error === 'expired') {
				lock('expired');
			} else if (result.error === 'no_conversation') {
				current = null;
				viewArchived = false;
				loadConversations().then(function () { renderThread([]); });
			} else {
				setSync(false);
			}
		});
	}

	function refresh() {
		if (!token) {
			return Promise.resolve();
		}
		if (role === 'admin') {
			return loadConversations().then(function (ok) {
				if (ok) {
					return loadThread();
				}
				if (token) {
					setSync(false);
				}
			});
		}
		return loadThread();
	}

	function act(id, action) {
		if (action === 'confirm-delete') {
			pendingDelete = id;
			clearTimeout(pendingTimer);
			pendingTimer = setTimeout(function () {
				pendingDelete = null;
				lastSignature = '';
				loadThread();
			}, CONFIRM_MS);
			lastSignature = '';
			loadThread();
			return;
		}
		pendingDelete = null;
		clearTimeout(pendingTimer);
		rpc('m_msg', { p_token: token, p_id: id, p_action: action }).then(function (result) {
			if (!result.ok && result.error === 'expired') {
				lock('expired');
				return;
			}
			if (!result.ok) {
				setStatus(el['compose-status'], result.error || 'network');
			}
			lastSignature = '';
			refresh();
		});
	}

	// ----- Session -------------------------------------------------------------

	function resetIdle() {
		clearTimeout(idleTimer);
		if (token) {
			idleTimer = setTimeout(function () { lock('expired'); }, IDLE_MS);
		}
	}

	function unlock(result) {
		token = result.token;
		role = result.role === 'admin' ? 'admin' : 'guest';
		conversations = [];
		current = null;
		viewArchived = false;
		lastSignature = '';
		el['thread'].textContent = '';
		el['conv-list'].textContent = '';
		el['lock'].hidden = true;
		el['portal'].hidden = false;
		el['sync'].textContent = 'Loading';
		document.title = 'Notes';
		layout();
		refresh().then(function () {
			el['thread'].scrollTop = el['thread'].scrollHeight;
		});
		pollTimer = setInterval(function () {
			if (!document.hidden) {
				refresh();
			}
		}, POLL_MS);
		resetIdle();
		if (role === 'guest') {
			el['compose-body'].focus();
		}
	}

	function lock(reason) {
		var old = token;
		token = null;
		role = null;
		conversations = [];
		current = null;
		viewArchived = false;
		pendingDelete = null;
		clearInterval(pollTimer);
		clearTimeout(idleTimer);
		clearTimeout(pendingTimer);
		if (old) {
			rpc('m_close', { p_token: old });
		}
		['conv-dialog', 'admin-key-dialog'].forEach(function (id) {
			if (el[id].open) {
				el[id].close();
			}
		});
		el['conv-form'].reset();
		el['admin-key-form'].reset();
		el['compose'].reset();
		el['thread'].textContent = '';
		el['conv-list'].textContent = '';
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
		setNote(el['lock-status'], 'Checking');
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

	// ----- Compose -------------------------------------------------------------

	el['compose'].addEventListener('submit', function (event) {
		event.preventDefault();
		var body = el['compose-body'].value;
		if (!body.trim()) {
			setStatus(el['compose-status'], 'empty');
			return;
		}
		var args = { p_token: token, p_body: body };
		if (role === 'admin') {
			args.p_conversation = current;
		}
		el['compose-send'].disabled = true;
		setNote(el['compose-status'], 'Sending');
		rpc('m_post', args).then(function (result) {
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

	// ----- Header and list controls -------------------------------------------

	el['lock-now'].addEventListener('click', function () { lock(''); });
	el['lock-now-side'].addEventListener('click', function () { lock(''); });

	el['back'].addEventListener('click', function () {
		current = null;
		viewArchived = false;
		pendingDelete = null;
		lastSignature = '';
		renderConversations();
		layout();
		renderThread([]);
	});

	el['toggle-archived'].addEventListener('click', function () {
		viewArchived = !viewArchived;
		pendingDelete = null;
		lastSignature = '';
		layout();
		loadThread();
	});

	el['leave-archived'].addEventListener('click', function () {
		viewArchived = false;
		pendingDelete = null;
		lastSignature = '';
		layout();
		loadThread().then(function () {
			el['thread'].scrollTop = el['thread'].scrollHeight;
		});
	});

	// ----- Conversation dialog (admin) ----------------------------------------

	var deleteArmed = false;
	var deleteTimer = null;

	function disarmDelete() {
		deleteArmed = false;
		clearTimeout(deleteTimer);
		el['conv-delete'].textContent = 'Delete conversation';
	}

	function openConvDialog(id) {
		editing = id;
		el['conv-form'].reset();
		disarmDelete();
		setStatus(el['conv-status'], '');
		var conv = id === null ? null : currentConversation();
		el['conv-dialog-title'].textContent = conv ? 'Conversation settings' : 'New conversation';
		el['conv-label'].value = conv ? conv.label : '';
		el['conv-hint'].hidden = !conv;
		el['conv-delete'].hidden = !conv;
		el['conv-hold-row'].hidden = !conv;
		el['conv-hold'].checked = Boolean(conv && conv.legal_hold);
		el['conv-save'].textContent = conv ? 'Save changes' : 'Create';
		el['conv-dialog'].showModal();
		el['conv-label'].focus();
	}

	el['new-conv'].addEventListener('click', function () { openConvDialog(null); });
	el['conv-settings'].addEventListener('click', function () { openConvDialog(current); });

	el['conv-cancel'].addEventListener('click', function () {
		disarmDelete();
		el['conv-form'].reset();
		el['conv-dialog'].close();
	});

	el['conv-form'].addEventListener('submit', function (event) {
		event.preventDefault();
		var label = el['conv-label'].value.trim();
		var password = el['conv-password'].value;
		if (password !== el['conv-password-again'].value) {
			setStatus(el['conv-status'], 'mismatch');
			return;
		}
		if (editing === null && !label) {
			setStatus(el['conv-status'], 'label_empty');
			return;
		}
		if (editing === null && !password) {
			setStatus(el['conv-status'], 'empty_key');
			return;
		}
		el['conv-save'].disabled = true;
		setNote(el['conv-status'], 'Saving');
		rpc('m_conv_save', {
			p_token: token,
			p_id: editing,
			p_label: label || null,
			p_password: password || null
		}).then(function (result) {
			el['conv-save'].disabled = false;
			if (result.ok) {
				var created = editing === null;
				el['conv-dialog'].close();
				el['conv-form'].reset();
				loadConversations().then(function () {
					if (created) {
						openConversation(result.id);
					} else {
						layout();
					}
				});
			} else if (result.error === 'expired') {
				lock('expired');
			} else {
				setStatus(el['conv-status'], result.error || 'network');
			}
		});
	});

	// The hold applies at once; it does not wait for Save changes.
	el['conv-hold'].addEventListener('change', function () {
		var box = el['conv-hold'];
		var want = box.checked;
		box.disabled = true;
		rpc('m_conv_hold', { p_token: token, p_id: editing, p_hold: want }).then(function (result) {
			box.disabled = false;
			if (result.ok) {
				setNote(el['conv-status'], want ? 'Legal hold is on.' : 'Legal hold is off.');
				loadConversations();
			} else {
				box.checked = !want;
				if (result.error === 'expired') {
					lock('expired');
				} else {
					setStatus(el['conv-status'], result.error || 'network');
				}
			}
		});
	});

	el['conv-delete'].addEventListener('click', function () {
		if (!deleteArmed) {
			deleteArmed = true;
			el['conv-delete'].textContent = 'Click again: deletes every message and the password';
			deleteTimer = setTimeout(disarmDelete, CONFIRM_MS);
			return;
		}
		disarmDelete();
		var id = editing;
		rpc('m_conv_delete', { p_token: token, p_id: id }).then(function (result) {
			if (result.ok) {
				el['conv-dialog'].close();
				current = null;
				viewArchived = false;
				lastSignature = '';
				loadConversations().then(function () { renderThread([]); });
			} else if (result.error === 'expired') {
				lock('expired');
			} else {
				setStatus(el['conv-status'], result.error || 'network');
			}
		});
	});

	// ----- Admin password dialog ----------------------------------------------

	el['open-admin-key'].addEventListener('click', function () {
		el['admin-key-form'].reset();
		setStatus(el['admin-key-status'], '');
		setStatus(el['retention-status'], '');
		el['retention-days'].value = '';
		el['retention-days'].disabled = true;
		el['retention-save'].disabled = true;
		el['admin-key-dialog'].showModal();
		rpc('m_settings', { p_token: token }).then(function (result) {
			if (result.ok) {
				el['retention-days'].value = result.retention_days === null ? '' : String(result.retention_days);
				el['retention-days'].disabled = false;
				el['retention-save'].disabled = false;
			} else if (result.error === 'expired') {
				el['admin-key-dialog'].close();
				lock('expired');
			} else {
				setStatus(el['retention-status'], result.error || 'network');
			}
		});
	});

	el['retention-save'].addEventListener('click', function () {
		var raw = el['retention-days'].value.trim();
		var days = null;
		if (raw !== '') {
			if (!/^[0-9]+$/.test(raw) || Number(raw) < 1) {
				setStatus(el['retention-status'], 'bad_days');
				return;
			}
			days = Number(raw);
		}
		el['retention-save'].disabled = true;
		setNote(el['retention-status'], 'Saving');
		rpc('m_settings', { p_token: token, p_retention_days: days, p_save: true }).then(function (result) {
			el['retention-save'].disabled = false;
			if (result.ok) {
				setNote(el['retention-status'], result.retention_days === null
					? 'Nothing will be deleted.'
					: 'Saved. Older messages and logs are deleted daily after ' + result.retention_days + ' days.');
			} else if (result.error === 'expired') {
				lock('expired');
			} else {
				setStatus(el['retention-status'], result.error || 'network');
			}
		});
	});

	el['admin-key-cancel'].addEventListener('click', function () {
		el['admin-key-form'].reset();
		el['admin-key-dialog'].close();
	});

	el['admin-key-form'].addEventListener('submit', function (event) {
		event.preventDefault();
		var next = el['admin-key-new'].value;
		if (next !== el['admin-key-again'].value) {
			setStatus(el['admin-key-status'], 'mismatch');
			return;
		}
		el['admin-key-save'].disabled = true;
		setNote(el['admin-key-status'], 'Saving');
		rpc('m_admin_key', { p_token: token, p_new: next }).then(function (result) {
			el['admin-key-save'].disabled = false;
			if (result.ok) {
				el['admin-key-form'].reset();
				setNote(el['admin-key-status'], 'Your password is changed. Use the new one next time.');
			} else if (result.error === 'expired') {
				lock('expired');
			} else {
				setStatus(el['admin-key-status'], result.error || 'network');
			}
		});
	});

	// ----- Idle and visibility ------------------------------------------------

	['pointerdown', 'keydown', 'scroll'].forEach(function (name) {
		window.addEventListener(name, resetIdle, { passive: true, capture: true });
	});

	document.addEventListener('visibilitychange', function () {
		if (!document.hidden && token) {
			refresh();
		}
	});
}());
