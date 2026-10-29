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
	// Resolves to the live scope (0 for admin, else a conversation id), or null when live is unavailable.
	var liveReady = null;
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
	// Set at sign-in for guests; the watermark is designed later.
	var watermark = null;
	var pickingFile = false;
	var pickTimer = null;
	var PICK_MAX_MS = 60 * 1000;
	var AUDIT_LIMIT = 100;
	var auditKind = 'events';
	var auditOldest = null;
	var auditSeq = 0;
	// File keys live in memory only, and lock() drops every one of them.
	var MAX_FILE = 26214400;
	var MAX_FILES = 10;
	var ownerKey = null;             // admin: the owner's private key, once unlocked
	var ownerInfo = null;            // admin: the owner row from m_keys (public key, wrapped private key, KDF), null before setup
	var convKeys = {};               // admin: conversation id -> DEK
	var guestDek = null;             // guest: this conversation's DEK
	var keysChecked = false;         // the key state for this session has been loaded
	var keySetup = false;            // key dialog: setting up (true) or unlocking (false)
	var pendingFiles = [];           // files chosen for the next message
	var C = window.TrippCrypto;

	var el = {};
	['lock', 'lock-form', 'lock-password', 'lock-submit', 'portal', 'sidebar',
		'new-conv', 'conv-list', 'open-admin-key', 'lock-now-side', 'pane', 'back', 'pane-title',
		'sync', 'toggle-archived', 'conv-settings', 'lock-now', 'archived-banner', 'leave-archived',
		'thread', 'compose', 'compose-body', 'compose-send', 'compose-status', 'conv-dialog',
		'conv-form', 'conv-dialog-title', 'conv-label', 'conv-password', 'conv-password-again',
		'conv-hint', 'conv-status', 'conv-delete', 'conv-cancel', 'conv-save', 'admin-key-dialog',
		'admin-key-form', 'admin-key-new', 'admin-key-again', 'admin-key-status', 'admin-key-cancel',
		'admin-key-save', 'conv-hold-row', 'conv-hold', 'retention-days', 'retention-status',
		'retention-save', 'open-audit', 'audit-dialog', 'audit-tab-events', 'audit-tab-visits',
		'audit-verified', 'audit-head', 'audit-body', 'audit-status', 'audit-more', 'audit-close',
		'attach', 'attach-input', 'attach-list', 'files-key', 'key-backup', 'key-dialog', 'key-form',
		'key-dialog-title', 'key-pass', 'key-setup', 'key-pass-again', 'key-status', 'key-cancel',
		'key-save'].forEach(function (id) {
		el[id] = document.getElementById(id);
	});

	var ERRORS = {
		empty: 'Write something before sending.',
		too_long: 'That message is too long. The limit is 10,000 characters.',
		empty_key: 'Enter a password.',
		password_taken: 'That password is already in use. Every password has to be different, because the password is what tells people apart.',
		label_empty: 'Give the conversation a name.',
		label_too_long: 'Keep the name under 100 characters.',
		no_conversation: 'That conversation no longer exists.',
		no_message: 'That message no longer exists.',
		no_attachment: 'That file is no longer available.',
		bad_days: 'Enter a whole number of days, 1 or more, or leave it empty.',
		mismatch: 'The two password entries do not match. Type them again.',
		forbidden: 'Only the admin can do that.',
		bad_passphrase: 'That passphrase did not unlock your files.',
		needs_unlock: 'Unlock your files first, so their key can be moved to the new password.',
		too_large: 'Files can be up to 25 MB.',
		too_many: 'Up to 10 files per message.',
		empty_file: 'That file is empty.',
		empty_passphrase: 'Enter a passphrase.',
		passphrase_mismatch: 'The two passphrase entries do not match. Type them again.',
		exists: 'Files are already set up. Unlock them instead.',
		bad_kind: 'Something went wrong. Try again.',
		bad_request: 'Something went wrong. Try again.',
		server: 'Something went wrong. Try again.',
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

	// Calls one Edge Function. Same result shape as rpc.
	function fn(name, body) {
		if (!config.functions || !config.key) {
			return Promise.resolve({ ok: false, error: 'setup' });
		}
		var headers = { 'Content-Type': 'application/json', 'apikey': config.key };
		if (config.key.indexOf('sb_') !== 0) {
			headers['Authorization'] = 'Bearer ' + config.key;
		}
		return fetch(config.functions + '/' + name, {
			method: 'POST',
			headers: headers,
			body: JSON.stringify(body),
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
		updateFiles();
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
				lock();
			}
			return false;
		});
	}

	function openConversation(id) {
		current = id;
		viewArchived = false;
		pendingDelete = null;
		lastSignature = '';
		pendingFiles = [];
		renderPending();
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
		var dek = currentDek();
		var signature = JSON.stringify([current, viewArchived, pendingDelete, Boolean(dek), messages.map(function (m) {
			return [m.id, m.hidden, (m.attachments || []).map(function (a) { return a.id; })];
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
			if (message.body) {
				var body = document.createElement('p');
				body.className = 'message-body';
				body.textContent = message.body;
				item.appendChild(body);
			}
			if (message.attachments && message.attachments.length) {
				var files = document.createElement('div');
				files.className = 'attachments';
				message.attachments.forEach(function (att) {
					files.appendChild(attachmentButton(att, dek));
				});
				item.appendChild(files);
			}
			var meta = document.createElement('p');
			meta.className = 'message-meta';
			meta.textContent = (message.mine ? 'You' : 'Them') + ', ' + formatTime(message.at) +
				(message.hidden ? '. Hidden from them' : '');
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
			// The admin needs the conversation's key before its files can be named.
			if (!result.ok || role !== 'admin') {
				return result;
			}
			return loadConvKey(current).then(function () { return result; });
		}).then(function (result) {
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
				updateFiles();
				setSync(true);
			} else if (result.error === 'expired') {
				lock();
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
				lock();
				return;
			}
			if (!result.ok) {
				setStatus(el['compose-status'], result.error || 'network');
			} else if (action === 'delete') {
				sweep();
			}
			lastSignature = '';
			refresh();
		});
	}

	// ----- Session -------------------------------------------------------------

	function resetIdle() {
		clearTimeout(idleTimer);
		if (token) {
			idleTimer = setTimeout(function () { lock(); }, IDLE_MS);
		}
	}

	function unlock(result) {
		token = result.token;
		role = result.role === 'admin' ? 'admin' : 'guest';
		watermark = result.watermark || null;
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
		liveReady = window.TrippLive.start(token).then(function (r) { return r.scope; }).catch(function () { return null; });
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
			document.body.classList.add('is-guest');
			el['compose-body'].focus();
		} else {
			loadOwnerInfo();
		}
	}

	function lock() {
		var old = token;
		token = null;
		role = null;
		ownerKey = null;
		ownerInfo = null;
		convKeys = {};
		guestDek = null;
		keysChecked = false;
		pendingFiles = [];
		// Hide first so a failure in the cleanup below can never leave the portal showing.
		el['portal'].hidden = true;
		el['lock'].hidden = false;
		try {
			liveReady = null;
			window.TrippLive.stop();
			watermark = null;
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
			['conv-dialog', 'admin-key-dialog', 'audit-dialog', 'key-dialog'].forEach(function (id) {
				if (el[id].open) {
					el[id].close();
				}
			});
			auditSeq += 1;
			auditOldest = null;
			el['audit-body'].textContent = '';
			el['audit-head'].textContent = '';
			el['audit-verified'].textContent = '';
			el['audit-verified'].classList.remove('is-error');
			el['audit-status'].textContent = '';
			el['audit-status'].classList.remove('is-error');
			el['audit-more'].hidden = true;
			el['conv-form'].reset();
			el['admin-key-form'].reset();
			el['key-form'].reset();
			el['compose'].reset();
			el['attach-input'].value = '';
			renderPending();
			el['thread'].textContent = '';
			el['conv-list'].textContent = '';
			lastSignature = '';
			document.title = 'Sign in';
			el['lock-password'].value = '';
			el['lock-password'].focus();
		} finally {
			clearPicking();
			document.body.classList.remove('is-blanked', 'is-guest');
		}
	}

	el['lock-form'].addEventListener('submit', function (event) {
		event.preventDefault();
		// A guest's password is kept only through sign-in, to open the conversation's file key.
		var password = el['lock-password'].value;
		el['lock-submit'].disabled = true;
		fn('open', { password: password }).then(function (result) {
			el['lock-submit'].disabled = false;
			el['lock-password'].value = '';
			if (result.ok && result.token) {
				unlock(result);
				if (role === 'guest') {
					openGuestKey(password, false);
				}
			} else {
				el['lock-password'].focus();
			}
			password = null;
		});
	});

	// ----- Compose -------------------------------------------------------------

	// True while a send is in flight, so Ctrl+Enter cannot send the same draft twice.
	var sending = false;

	el['compose'].addEventListener('submit', function (event) {
		event.preventDefault();
		if (sending) {
			return;
		}
		var body = el['compose-body'].value;
		var files = pendingFiles.slice();
		if (!body.trim() && !files.length) {
			setStatus(el['compose-status'], 'empty');
			return;
		}
		var t = token;
		var conversation = role === 'admin' ? current : null;
		var dek = currentDek();
		if (files.length && !dek) {
			updateFiles();
			return;
		}
		sending = true;
		el['compose-send'].disabled = true;
		el['attach'].disabled = true;
		setNote(el['compose-status'], 'Sending');
		uploadAll(files, dek, conversation, t).then(function (attachments) {
			var args = { p_token: t, p_body: body };
			if (role === 'admin') {
				args.p_conversation = conversation;
			}
			if (attachments.length) {
				args.p_attachments = attachments;
			}
			setNote(el['compose-status'], 'Sending');
			return rpc('m_post', args);
		}).catch(function (err) {
			return err && err.error ? err : { ok: false, error: 'server' };
		}).then(function (result) {
			sending = false;
			el['compose-send'].disabled = false;
			el['attach'].disabled = false;
			if (token !== t) {
				return;
			}
			if (result.ok) {
				el['compose-body'].value = '';
				pendingFiles = [];
				renderPending();
				setStatus(el['compose-status'], '');
				updateFiles();
				refresh().then(function () {
					el['thread'].scrollTop = el['thread'].scrollHeight;
				});
			} else if (result.error === 'expired') {
				// The draft is dropped with the session.
				lock();
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

	el['lock-now'].addEventListener('click', function () { lock(); });
	el['lock-now-side'].addEventListener('click', function () { lock(); });

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
		var t = token;
		var id = editing;
		guestWrap(id, password).then(function (keys) {
			var args = { p_token: t, p_id: id, p_label: label || null, p_password: password || null };
			if (keys) {
				args.p_wrapped_guest = keys.wrapped;
				args.p_guest_salt = keys.salt;
				args.p_guest_iv = keys.iv;
				args.p_guest_iterations = keys.iterations;
				if (keys.owner) {
					args.p_wrapped_owner = keys.owner;
				}
			}
			return rpc('m_conv_save', args).then(function (result) {
				if (result.ok && keys && id === null && token === t && ownerKey) {
					convKeys[result.id] = keys.dek;
				}
				return result;
			});
		}).catch(function () {
			return { ok: false, error: 'server' };
		}).then(function (result) {
			el['conv-save'].disabled = false;
			if (token !== t) {
				return;
			}
			if (result.ok) {
				var created = id === null;
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
				lock();
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
					lock();
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
				delete convKeys[id];
				sweep();
				el['conv-dialog'].close();
				current = null;
				viewArchived = false;
				lastSignature = '';
				loadConversations().then(function () { renderThread([]); });
			} else if (result.error === 'expired') {
				lock();
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
				lock();
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
				setNote(el['retention-status'], 'Saved');
			} else if (result.error === 'expired') {
				lock();
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
				lock();
			} else {
				setStatus(el['admin-key-status'], result.error || 'network');
			}
		});
	});

	// ----- Encrypted files ------------------------------------------------------

	function currentDek() {
		if (role === 'guest') {
			return guestDek;
		}
		if (role === 'admin' && current !== null) {
			return convKeys[current] || null;
		}
		return null;
	}

	function formatBytes(n) {
		if (n < 1024) {
			return n + ' bytes';
		}
		if (n < 1048576) {
			return Math.round(n / 1024) + ' KB';
		}
		return (n / 1048576).toFixed(1) + ' MB';
	}

	// Shows Attach only when there is a key to encrypt with.
	function updateFiles() {
		var admin = role === 'admin';
		el['files-key'].hidden = !admin || !keysChecked || Boolean(ownerKey);
		el['files-key'].textContent = ownerInfo ? 'Unlock files' : 'Set up files';
		el['key-backup'].hidden = !admin || !ownerInfo;
		var dek = currentDek();
		el['attach'].hidden = !dek;
		if (!dek && pendingFiles.length) {
			pendingFiles = [];
			renderPending();
		}
	}

	function sweep() {
		fn('media', { action: 'sweep' });
	}

	function saveBlob(blob, name) {
		var url = URL.createObjectURL(blob);
		var link = document.createElement('a');
		link.href = url;
		link.download = name;
		link.hidden = true;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
	}

	// Admin: whether files are set up, and the wrapped owner key if they are.
	function loadOwnerInfo() {
		var t = token;
		return rpc('m_keys', { p_token: t, p_conversation: null }).then(function (result) {
			if (token !== t) {
				return;
			}
			if (result.ok) {
				ownerInfo = result.owner || null;
				keysChecked = true;
				updateFiles();
			} else if (result.error === 'expired') {
				lock();
			}
		});
	}

	// Admin: the conversation's DEK, opened with the owner's private key.
	function loadConvKey(id) {
		if (role !== 'admin' || !ownerKey || id === null || convKeys[id]) {
			return Promise.resolve();
		}
		var t = token;
		var key = ownerKey;
		return rpc('m_keys', { p_token: t, p_conversation: id }).then(function (result) {
			if (token !== t || ownerKey !== key) {
				return;
			}
			if (!result.ok) {
				if (result.error === 'expired') {
					lock();
				}
				return;
			}
			if (!result.conv || !result.conv.wrapped_owner) {
				return;
			}
			return C.unwrapForOwner(result.conv.wrapped_owner, key).then(function (dek) {
				if (token === t && ownerKey === key) {
					convKeys[id] = dek;
				}
			});
		}).catch(function () {});
	}

	// Guest: open this conversation's DEK with the sign-in password. On the
	// first sign-in after files were set up there is none yet, so make it and
	// store it wrapped for the guest and for the owner.
	function openGuestKey(password, retried) {
		var t = token;
		return rpc('m_keys', { p_token: t, p_conversation: null }).then(function (result) {
			if (token !== t || !result.ok) {
				return null;
			}
			var conv = result.conv;
			if (conv && conv.wrapped_guest) {
				return C.deriveGuestKey(password, conv.guest_salt, conv.guest_iterations).then(function (key) {
					return C.unwrapForGuest(conv.wrapped_guest, conv.guest_iv, key);
				});
			}
			if (conv || !result.public_jwk) {
				return null;
			}
			var salt = C.randomB64(16);
			var dek = null;
			var wrapped = null;
			return C.newConversationKey().then(function (made) {
				dek = made;
				return C.deriveGuestKey(password, salt, C.ITERATIONS);
			}).then(function (key) {
				return C.wrapForGuest(dek, key);
			}).then(function (w) {
				wrapped = w;
				return C.wrapForOwner(dek, result.public_jwk);
			}).then(function (owner) {
				if (token !== t) {
					return null;
				}
				return rpc('m_key_conv', {
					p_token: t,
					p_conversation: null,
					p_wrapped_owner: owner,
					p_wrapped_guest: wrapped.wrapped,
					p_guest_salt: salt,
					p_guest_iv: wrapped.iv,
					p_guest_iterations: C.ITERATIONS
				}).then(function (saved) {
					if (saved.ok) {
						return dek;
					}
					// Another sign-in made the key first: open that one instead.
					if (saved.error === 'exists' && !retried) {
						return openGuestKey(password, true).then(function () { return null; });
					}
					return null;
				});
			});
		}).then(function (dek) {
			if (token === t && dek) {
				guestDek = dek;
				lastSignature = '';
				loadThread();
			}
		}).catch(function () {}).then(function () {
			if (token === t) {
				keysChecked = true;
				updateFiles();
			}
		});
	}

	// Admin: when files are unlocked, a new password also gets the
	// conversation's key wrapped under it (and a new conversation gets a key).
	function guestWrap(id, password) {
		if (!password || !ownerKey || !ownerInfo) {
			return Promise.resolve(null);
		}
		var pub = ownerInfo.public_jwk;
		var start = id === null
			? C.newConversationKey()
			: loadConvKey(id).then(function () { return convKeys[id] || null; });
		return start.then(function (dek) {
			if (!dek) {
				return null;
			}
			var salt = C.randomB64(16);
			var keys = { dek: dek, salt: salt, iterations: C.ITERATIONS, wrapped: null, iv: null, owner: null };
			return C.deriveGuestKey(password, salt, C.ITERATIONS).then(function (key) {
				return C.wrapForGuest(dek, key);
			}).then(function (w) {
				keys.wrapped = w.wrapped;
				keys.iv = w.iv;
				if (id !== null) {
					return keys;
				}
				return C.wrapForOwner(dek, pub).then(function (owner) {
					keys.owner = owner;
					return keys;
				});
			});
		});
	}

	// A button per attachment. The name is shown only once it has been decrypted.
	function attachmentButton(att, dek) {
		var button = document.createElement('button');
		button.type = 'button';
		button.className = 'attachment';
		var size = formatBytes(att.bytes);
		if (!dek) {
			button.textContent = 'Locked file (' + size + ')';
			button.disabled = true;
			return button;
		}
		button.textContent = size;
		C.decryptText(dek, att.name_enc).then(function (name) {
			button.textContent = name + ' (' + size + ')';
		}, function () {
			button.textContent = 'Unreadable file (' + size + ')';
		});
		button.addEventListener('click', function () { downloadAttachment(att, dek, button); });
		return button;
	}

	function downloadAttachment(att, dek, button) {
		var t = token;
		button.disabled = true;
		fn('media', { action: 'download_url', token: t, attachment: att.id }).then(function (result) {
			if (!result.ok) {
				throw result;
			}
			return fetch(result.signed_url, { cache: 'no-store', referrerPolicy: 'no-referrer' });
		}).then(function (response) {
			if (!response.ok) {
				throw { ok: false, error: 'network' };
			}
			return response.arrayBuffer();
		}).then(function (buffer) {
			return Promise.all([
				C.decryptFile(dek, buffer, att.nonce, att.chunk_size),
				C.decryptText(dek, att.name_enc)
			]);
		}).then(function (parts) {
			if (token !== t) {
				return;
			}
			saveBlob(new Blob([parts[0]], { type: att.mime || 'application/octet-stream' }), parts[1]);
		}).catch(function (err) {
			if (token !== t) {
				return;
			}
			if (err && err.error === 'expired') {
				lock();
				return;
			}
			setStatus(el['compose-status'], (err && err.error) || 'server');
		}).then(function () {
			button.disabled = false;
		});
	}

	function renderPending() {
		var list = el['attach-list'];
		list.textContent = '';
		list.hidden = !pendingFiles.length;
		pendingFiles.forEach(function (file, index) {
			var item = document.createElement('li');
			var name = document.createElement('span');
			name.className = 'attach-name';
			name.textContent = file.name + ' (' + formatBytes(file.size) + ')';
			var remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'link-button';
			remove.textContent = 'Remove';
			remove.addEventListener('click', function () {
				pendingFiles.splice(index, 1);
				renderPending();
			});
			item.appendChild(name);
			item.appendChild(remove);
			list.appendChild(item);
		});
	}

	// Encrypts, then uploads, one file. Resolves to its m_post attachment object.
	function uploadOne(file, dek, conversation, t) {
		var sealed = null;
		var path = null;
		return C.encryptFile(dek, file).then(function (s) {
			sealed = s;
			return fn('media', { action: 'upload_url', token: t, conversation: conversation, kind: 'file', bytes: file.size });
		}).then(function (result) {
			if (!result.ok) {
				throw result;
			}
			path = result.path;
			return fetch(result.signed_url, {
				method: 'PUT',
				headers: { 'content-type': 'application/octet-stream' },
				body: sealed.ciphertext,
				cache: 'no-store',
				referrerPolicy: 'no-referrer'
			});
		}).then(function (response) {
			if (!response.ok) {
				throw { ok: false, error: 'network' };
			}
			return C.encryptText(dek, file.name);
		}).then(function (nameEnc) {
			return {
				path: path,
				kind: 'file',
				mime: file.type && file.type.length <= 255 ? file.type : 'application/octet-stream',
				bytes: file.size,
				name_enc: nameEnc,
				nonce: sealed.nonce,
				chunk_size: C.CHUNK
			};
		});
	}

	// One file at a time, so a 25 MB file is never held twice over with others.
	function uploadAll(files, dek, conversation, t) {
		var out = [];
		var chain = Promise.resolve();
		files.forEach(function (file, index) {
			chain = chain.then(function () {
				if (token !== t) {
					throw { ok: false, error: 'server' };
				}
				setNote(el['compose-status'], 'Uploading ' + (index + 1) + ' of ' + files.length);
				return uploadOne(file, dek, conversation, t).then(function (att) { out.push(att); });
			});
		});
		return chain.then(function () { return out; });
	}

	el['attach'].addEventListener('click', function () { pickFile(el['attach-input']); });

	el['attach-input'].addEventListener('change', function () {
		var input = el['attach-input'];
		var files = Array.prototype.slice.call(input.files || []);
		input.value = '';
		var problem = '';
		files.forEach(function (file) {
			if (file.size > MAX_FILE) {
				problem = 'too_large';
			} else if (file.size === 0) {
				problem = problem || 'empty_file';
			} else if (pendingFiles.length >= MAX_FILES) {
				problem = problem || 'too_many';
			} else {
				pendingFiles.push(file);
			}
		});
		setStatus(el['compose-status'], problem);
		renderPending();
		if (!problem) {
			updateFiles();
		}
	});

	function openKeyDialog() {
		keySetup = !ownerInfo;
		el['key-form'].reset();
		setStatus(el['key-status'], '');
		el['key-dialog-title'].textContent = keySetup ? 'Set up files' : 'Unlock files';
		el['key-setup'].hidden = !keySetup;
		el['key-save'].textContent = keySetup ? 'Set up files' : 'Unlock';
		if (!el['key-dialog'].open) {
			el['key-dialog'].showModal();
		}
		el['key-pass'].focus();
	}

	function setupFiles(passphrase, t) {
		var salt = C.randomB64(16);
		var kek = null;
		var keys = null;
		return C.deriveKek(passphrase, null, salt, C.ITERATIONS).then(function (k) {
			kek = k;
			return C.createOwnerKeys(kek);
		}).then(function (made) {
			keys = made;
			return rpc('m_key_setup', {
				p_token: t,
				p_public_jwk: keys.publicJwk,
				p_wrapped_private: keys.wrappedPrivate,
				p_private_iv: keys.privateIv,
				p_kdf_salt: salt,
				p_iterations: C.ITERATIONS
			});
		}).then(function (result) {
			if (!result.ok) {
				return result.error || 'network';
			}
			return C.openOwnerKey(kek, keys.wrappedPrivate, keys.privateIv).then(function (key) {
				if (token === t) {
					ownerKey = key;
					ownerInfo = {
						public_jwk: keys.publicJwk,
						wrapped_private: keys.wrappedPrivate,
						private_iv: keys.privateIv,
						kdf_salt: salt,
						kdf_iterations: C.ITERATIONS
					};
					convKeys = {};
				}
				return null;
			});
		}).catch(function () {
			return 'server';
		});
	}

	function unlockFiles(passphrase, t) {
		var info = ownerInfo;
		if (!info) {
			return Promise.resolve('server');
		}
		return C.deriveKek(passphrase, null, info.kdf_salt, info.kdf_iterations).then(function (kek) {
			return C.openOwnerKey(kek, info.wrapped_private, info.private_iv);
		}).then(function (key) {
			if (token === t) {
				ownerKey = key;
				convKeys = {};
			}
			return null;
		}, function (err) {
			return err && err.message === 'bad_passphrase' ? 'bad_passphrase' : 'server';
		});
	}

	el['files-key'].addEventListener('click', openKeyDialog);

	el['key-cancel'].addEventListener('click', function () {
		el['key-form'].reset();
		el['key-dialog'].close();
	});

	el['key-form'].addEventListener('submit', function (event) {
		event.preventDefault();
		var passphrase = el['key-pass'].value;
		if (!passphrase) {
			setStatus(el['key-status'], 'empty_passphrase');
			return;
		}
		if (keySetup && passphrase !== el['key-pass-again'].value) {
			setStatus(el['key-status'], 'passphrase_mismatch');
			return;
		}
		var t = token;
		el['key-form'].reset();
		el['key-save'].disabled = true;
		setNote(el['key-status'], keySetup ? 'Setting up' : 'Unlocking');
		var work = keySetup ? setupFiles(passphrase, t) : unlockFiles(passphrase, t);
		passphrase = null;
		work.then(function (code) {
			el['key-save'].disabled = false;
			if (token !== t) {
				return;
			}
			if (code === 'expired') {
				lock();
				return;
			}
			if (code === 'exists') {
				loadOwnerInfo().then(function () {
					openKeyDialog();
					setStatus(el['key-status'], 'exists');
				});
				return;
			}
			if (code) {
				setStatus(el['key-status'], code);
				return;
			}
			setStatus(el['key-status'], '');
			el['key-dialog'].close();
			lastSignature = '';
			updateFiles();
			loadThread();
		});
	});

	el['key-backup'].addEventListener('click', function () {
		var t = token;
		rpc('m_keys_backup', { p_token: t }).then(function (result) {
			if (token !== t) {
				return;
			}
			if (!result.ok) {
				if (result.error === 'expired') {
					lock();
				}
				return;
			}
			var now = new Date();
			var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' +
				String(now.getDate()).padStart(2, '0');
			saveBlob(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
				'tripp-key-backup-' + day + '.json');
		});
	});

	// ----- Audit log (admin, read only) ---------------------------------------

	var AUDIT_COLUMNS = {
		events: ['Time', 'Who', 'Type', 'Detail'],
		visits: ['Time', 'Outcome', 'Who', 'IP', 'ISP', 'Location', 'OS', 'Browser']
	};
	var DASH = '—';

	function auditWho(scope) {
		if (scope === null || scope === undefined) {
			return DASH;
		}
		if (scope === 0) {
			return 'Admin';
		}
		for (var i = 0; i < conversations.length; i += 1) {
			if (conversations[i].id === scope) {
				return 'Conversation ' + conversations[i].label;
			}
		}
		return 'Conversation #' + scope;
	}

	function auditText(value) {
		return value === null || value === undefined || value === '' ? DASH : String(value);
	}

	function auditDetail(detail) {
		if (detail === null || detail === undefined) {
			return DASH;
		}
		if (typeof detail !== 'object') {
			return String(detail);
		}
		var keys = Object.keys(detail);
		if (!keys.length) {
			return DASH;
		}
		return keys.map(function (key) {
			var value = detail[key];
			return key + ': ' + (value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value));
		}).join(', ');
	}

	function auditCells(kind, row) {
		if (kind === 'events') {
			return [formatTime(row.at), auditWho(row.scope), auditText(row.type), auditDetail(row.detail)];
		}
		var place = [row.city, row.region, row.country].filter(function (part) {
			return part;
		}).join(', ');
		return [formatTime(row.at), auditText(row.outcome), auditWho(row.scope), auditText(row.ip),
			auditText(row.isp), auditText(place), auditText(row.os), auditText(row.browser)];
	}

	function auditAppend(kind, rows) {
		rows.forEach(function (row) {
			var tr = document.createElement('tr');
			auditCells(kind, row).forEach(function (text, index) {
				var td = document.createElement('td');
				td.textContent = text;
				if (kind === 'events' && index === 3) {
					td.className = 'audit-detail';
				}
				tr.appendChild(td);
			});
			el['audit-body'].appendChild(tr);
			if (auditOldest === null || row.id < auditOldest) {
				auditOldest = row.id;
			}
		});
	}

	function auditSetBadge(verified) {
		var node = el['audit-verified'];
		node.classList.remove('is-error');
		if (verified.ok) {
			node.textContent = 'Record intact: ' + verified.rows + ' rows verified';
		} else if (verified.first_bad_id !== null && verified.first_bad_id !== undefined) {
			node.textContent = 'Record altered at entry #' + verified.first_bad_id;
			node.classList.add('is-error');
		} else {
			node.textContent = 'Record check failed';
			node.classList.add('is-error');
		}
	}

	// Loads the first page of a table, or the next older page.
	function auditLoad(kind, older) {
		var seq = auditSeq + 1;
		auditSeq = seq;
		el['audit-more'].disabled = true;
		setNote(el['audit-status'], 'Loading');
		if (!older) {
			auditKind = kind;
			auditOldest = null;
			el['audit-body'].textContent = '';
			el['audit-head'].textContent = '';
			el['audit-verified'].textContent = '';
			el['audit-more'].hidden = true;
			var hr = document.createElement('tr');
			AUDIT_COLUMNS[kind].forEach(function (name) {
				var th = document.createElement('th');
				th.scope = 'col';
				th.textContent = name;
				hr.appendChild(th);
			});
			el['audit-head'].appendChild(hr);
			el['audit-tab-events'].setAttribute('aria-selected', String(kind === 'events'));
			el['audit-tab-visits'].setAttribute('aria-selected', String(kind === 'visits'));
		}
		return rpc('m_audit', {
			p_token: token,
			p_kind: kind,
			p_before: older ? auditOldest : null,
			p_limit: AUDIT_LIMIT
		}).then(function (result) {
			if (seq !== auditSeq || !token) {
				return;
			}
			if (!result.ok) {
				if (result.error === 'expired') {
					lock();
					return;
				}
				setStatus(el['audit-status'], result.error || 'network');
				el['audit-more'].disabled = false;
				el['audit-more'].hidden = !older;
				return;
			}
			setNote(el['audit-status'], '');
			var rows = Array.isArray(result.rows) ? result.rows : [];
			if (!older) {
				auditSetBadge(result.verified || { ok: false });
				if (!rows.length) {
					setNote(el['audit-status'], 'No entries.');
				}
			}
			auditAppend(kind, rows);
			el['audit-more'].disabled = false;
			el['audit-more'].hidden = rows.length < AUDIT_LIMIT;
		});
	}

	el['open-audit'].addEventListener('click', function () {
		el['audit-dialog'].showModal();
		auditLoad('events', false);
	});

	el['audit-tab-events'].addEventListener('click', function () { auditLoad('events', false); });
	el['audit-tab-visits'].addEventListener('click', function () { auditLoad('visits', false); });
	el['audit-more'].addEventListener('click', function () { auditLoad(auditKind, true); });
	el['audit-close'].addEventListener('click', function () { el['audit-dialog'].close(); });

	// ----- Idle and visibility ------------------------------------------------

	['pointerdown', 'keydown', 'scroll'].forEach(function (name) {
		window.addEventListener(name, resetIdle, { passive: true, capture: true });
	});

	document.addEventListener('visibilitychange', function () {
		if (!document.hidden && token) {
			refresh();
		}
	});

	// ----- Guest anti-leak -----------------------------------------------------

	function isGuest() {
		return Boolean(token) && role === 'guest';
	}

	// Blanks the portal at once, then locks the session.
	function awayLock() {
		document.body.classList.add('is-blanked');
		lock();
	}

	window.addEventListener('blur', function () {
		if (isGuest() && !pickingFile) {
			awayLock();
		}
	});

	// While a file picker is open a hidden page is blanked but not locked
	// (phones hide the page for the native picker).
	document.addEventListener('visibilitychange', function () {
		if (!isGuest() || !document.hidden) {
			return;
		}
		if (pickingFile) {
			document.body.classList.add('is-blanked');
		} else {
			awayLock();
		}
	});

	window.addEventListener('focus', function () { clearPicking(); });

	// Clears the picker flag, its timer, and any blanking it caused.
	function clearPicking() {
		pickingFile = false;
		clearTimeout(pickTimer);
		pickTimer = null;
		document.body.classList.remove('is-blanked');
	}

	// Opens a file picker without the focus change counting as leaving.
	function pickFile(input) {
		pickingFile = true;
		clearTimeout(pickTimer);
		// Fallback so the flag can never stay stuck.
		pickTimer = setTimeout(function () {
			var hidden = document.hidden;
			clearPicking();
			if (hidden && isGuest()) {
				awayLock();
			}
		}, PICK_MAX_MS);
		var done = function () {
			input.removeEventListener('change', done);
			input.removeEventListener('cancel', done);
			clearPicking();
		};
		input.addEventListener('change', done);
		input.addEventListener('cancel', done);
		input.click();
	}

	function outsideCompose(event) {
		return event.target !== el['compose-body'];
	}

	['contextmenu', 'copy', 'cut'].forEach(function (name) {
		document.addEventListener(name, function (event) {
			if (isGuest() && outsideCompose(event)) {
				event.preventDefault();
			}
		});
	});
}());
