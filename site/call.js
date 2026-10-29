// Tripp calls. Two-party audio and video over RTCPeerConnection, signalled with
// Realtime broadcast `call` messages on the conversation channel `conv:<id>`.
// Every payload is {t, call, from} plus the fields of its type:
//   ring {kind} · accept · taken {by} · offer {to, sdp} · answer {to, sdp}
//   ice {to, candidate} · end {reason} · decline
// Media is never recorded. Only call metadata reaches the server (m_call).
// The pure helpers at the top load in Node for tests; everything that touches
// WebRTC, media or audio runs only when a call is placed or answered.
(function () {
	'use strict';

	var root = typeof window !== 'undefined' ? window : globalThis;

	var RING_MS = 45000;             // no accept within this -> the caller ends with `missed`
	var CONNECT_MS = 45000;          // accepted but never connected -> `failed`
	var DISCONNECT_MS = 10000;       // ICE `disconnected` longer than this -> `failed`
	var STATS_MS = 1000;             // how long hanging up waits for getStats
	var LOG_REASONS = { hangup: 1, declined: 1, missed: 1, failed: 1, lock: 1 };
	var RELAYS = { host: 1, srflx: 1, prflx: 1, relay: 1 };

	function noop() {}

	// ----- Pure helpers ----------------------------------------------------------

	// Both sides rang at once: the lexicographically smaller call id wins.
	function glareWinner(myCallId, theirCallId) {
		return String(myCallId) < String(theirCallId) ? 'mine' : 'theirs';
	}

	function statsList(report) {
		var out = [];
		if (!report) {
			return out;
		}
		var add = function (s) {
			if (Array.isArray(s) && s.length === 2 && s[1] && typeof s[1] === 'object') {
				s = s[1];
			}
			if (s && typeof s === 'object') {
				out.push(s);
			}
		};
		if (typeof report.forEach === 'function') {
			report.forEach(function (v) { add(v); });
		} else if (typeof report[Symbol.iterator] === 'function') {
			for (var it = report[Symbol.iterator](), n = it.next(); !n.done; n = it.next()) {
				add(n.value);
			}
		}
		return out;
	}

	// Which kind of route the call took, from an RTCStatsReport (or any iterable of stats).
	function relayFromStats(report) {
		var list = statsList(report);
		var byId = {};
		list.forEach(function (s) { byId[s.id] = s; });
		var pair = null;
		list.some(function (s) {
			if (s.type === 'transport' && s.selectedCandidatePairId && byId[s.selectedCandidatePairId]) {
				pair = byId[s.selectedCandidatePairId];
				return true;
			}
			return false;
		});
		if (!pair) {
			list.some(function (s) {
				if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
					pair = s;
					return true;
				}
				return false;
			});
		}
		var local = pair && byId[pair.localCandidateId];
		if (local && local.type === 'local-candidate' && RELAYS[local.candidateType]) {
			return local.candidateType;
		}
		return 'unknown';
	}

	// A message is ours when it is not addressed to another peer and comes from the other side.
	function shouldHandle(msg, me, senderRole) {
		if (!msg || typeof msg !== 'object' || !me) {
			return false;
		}
		if (msg.from === me.peerId) {
			return false;
		}
		if (msg.to !== undefined && msg.to !== null && msg.to !== me.peerId) {
			return false;
		}
		var other = me.role === 'admin' ? 'guest' : me.role === 'guest' ? 'admin' : null;
		return Boolean(other) && senderRole === other;
	}

	// The one place the RTCPeerConnection configuration is built.
	function iceConfig() {
		var cfg = root.APP_CONFIG || {};
		return { iceServers: Array.isArray(cfg.iceServers) ? cfg.iceServers : [] };
	}

	// ----- Ring tone: Web Audio, 440 Hz, 1 s on and 2 s off ----------------------

	var tone = null;

	function toneStart() {
		if (tone) {
			return;
		}
		var AC = root.AudioContext || root.webkitAudioContext;
		if (!AC) {
			return;
		}
		try {
			var ctx = new AC();
			var osc = ctx.createOscillator();
			var gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.value = 440;
			gain.gain.value = 0;
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start();
			var beep = function () {
				var at = ctx.currentTime;
				gain.gain.setValueAtTime(0.15, at);
				gain.gain.setValueAtTime(0, at + 1);
			};
			tone = { ctx: ctx, osc: osc, timer: setInterval(beep, 3000) };
			if (ctx.state === 'suspended' && ctx.resume) {
				ctx.resume().catch(noop);
			}
			beep();
		} catch (e) {
			toneStop();
		}
	}

	function toneStop() {
		var t = tone;
		tone = null;
		if (!t) {
			return;
		}
		clearInterval(t.timer);
		try { t.osc.stop(); } catch (e) {}
		try { t.ctx.close().catch(noop); } catch (e) {}
	}

	// ----- CallSession -----------------------------------------------------------

	// opts: {channel, conversationId, kind, role, onState}
	// plus, from the page: peerId, log(action, callId, detail) -> Promise,
	// peers() -> peer ids on the other side, getMedia(constraints) -> Promise<MediaStream>,
	// onStreams(local, remote).
	function CallSession(opts) {
		opts = opts || {};
		this.channel = opts.channel;
		this.conversationId = opts.conversationId;
		this.kind = opts.kind === 'video' ? 'video' : 'audio';
		this.role = opts.role;
		this.onState = opts.onState || noop;
		this.onStreams = opts.onStreams || noop;
		this.peerId = opts.peerId || (root.TrippLive && root.TrippLive.peerId);
		this.log = opts.log || function () { return Promise.resolve(); };
		this.peers = opts.peers || function () { return []; };
		this.getMedia = opts.getMedia || function (c) { return root.navigator.mediaDevices.getUserMedia(c); };
		this.callId = null;
		this.isCaller = false;
		this.accepted = false;
		this.acceptSent = false;
		this.peer = null;
		this.state = 'idle';
		this.pc = null;
		this.localStream = null;
		this.remoteStream = null;
		this.pendingIce = [];
		this.targets = {};
		this.logged = false;
		this.logChain = Promise.resolve();
		this.relay = 'unknown';
		this.ended = false;
		this.done = null;
		this.timer = null;
		this.discTimer = null;
	}

	CallSession.prototype.send = function (t, extra) {
		var payload = { t: t, call: this.callId, from: this.peerId };
		Object.keys(extra || {}).forEach(function (k) { payload[k] = extra[k]; });
		try {
			var sent = this.channel.send({ type: 'broadcast', event: 'call', payload: payload });
			if (sent && sent.catch) {
				sent.catch(noop);
			}
		} catch (e) {}
	};

	CallSession.prototype.setState = function (state, info) {
		this.state = state;
		if (state === 'calling' || state === 'ringing') {
			toneStart();
		} else {
			toneStop();
		}
		try { this.onState(state, info || {}); } catch (e) {}
	};

	CallSession.prototype.record = function (action, detail) {
		var self = this;
		if (action !== 'end') {
			self.logged = true;
		}
		var id = self.callId;
		self.logChain = self.logChain.then(function () {
			return self.log(action, id, detail || {});
		}).catch(noop);
		return self.logChain;
	};

	CallSession.prototype.arm = function (ms, fn) {
		var self = this;
		clearTimeout(self.timer);
		self.timer = setTimeout(function () { if (!self.ended) { fn(); } }, ms);
	};

	CallSession.prototype.openMedia = function () {
		var self = this;
		var constraints = { audio: true };
		if (self.kind === 'video') {
			constraints.video = { width: { ideal: 1280 }, height: { ideal: 720 } };
		}
		return Promise.resolve().then(function () { return self.getMedia(constraints); }).then(function (stream) {
			if (self.ended) {
				stream.getTracks().forEach(function (t) { t.stop(); });
				return false;
			}
			self.localStream = stream;
			try { self.onStreams(self.localStream, self.remoteStream); } catch (e) {}
			return true;
		});
	};

	CallSession.prototype.createPc = function () {
		var self = this;
		var pc = new root.RTCPeerConnection(iceConfig());
		self.pc = pc;
		pc.onicecandidate = function (e) {
			if (e.candidate && !self.ended) {
				self.send('ice', { to: self.peer, candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
			}
		};
		pc.ontrack = function (e) {
			if (self.ended) {
				return;
			}
			if (!self.remoteStream) {
				self.remoteStream = e.streams && e.streams[0] ? e.streams[0] : new root.MediaStream();
			}
			if (self.remoteStream.getTracks().indexOf(e.track) < 0) {
				self.remoteStream.addTrack(e.track);
			}
			try { self.onStreams(self.localStream, self.remoteStream); } catch (err) {}
		};
		pc.oniceconnectionstatechange = function () {
			if (self.ended) {
				return;
			}
			var s = pc.iceConnectionState;
			if (s === 'connected' || s === 'completed') {
				clearTimeout(self.discTimer);
				self.discTimer = null;
				if (self.state !== 'connected') {
					clearTimeout(self.timer);
					self.setState('connected');
					pc.getStats().then(function (r) { self.relay = relayFromStats(r); }).catch(noop);
				}
			} else if (s === 'failed') {
				self.hangUp('failed');
			} else if (s === 'disconnected') {
				if (!self.discTimer) {
					self.discTimer = setTimeout(function () { self.hangUp('failed'); }, DISCONNECT_MS);
				}
			}
		};
		if (self.localStream) {
			self.localStream.getTracks().forEach(function (t) { pc.addTrack(t, self.localStream); });
		}
		return pc;
	};

	// createPc, but a failure to build the connection ends the call as `failed`.
	CallSession.prototype.safePc = function () {
		try {
			return this.createPc();
		} catch (e) {
			this.hangUp('failed');
			return null;
		}
	};

	CallSession.prototype.flushIce = function () {
		var self = this;
		var list = self.pendingIce;
		self.pendingIce = [];
		list.forEach(function (c) { self.pc.addIceCandidate(c).catch(noop); });
	};

	CallSession.prototype.addIce = function (candidate) {
		if (this.pc && this.pc.remoteDescription) {
			this.pc.addIceCandidate(candidate).catch(noop);
		} else {
			this.pendingIce.push(candidate);
		}
	};

	// Caller: get media, ring every endpoint on the other side, log `start`.
	CallSession.prototype.placeCall = function () {
		var self = this;
		self.isCaller = true;
		self.callId = root.crypto.randomUUID();
		self.setState('calling');
		return self.openMedia().then(function (ok) {
			if (!ok || self.ended) {
				return;
			}
			(self.peers() || []).forEach(function (p) { self.targets[p] = true; });
			self.send('ring', { kind: self.kind });
			self.record('start', { kind: self.kind });
			self.arm(RING_MS, function () { self.hangUp('missed'); });
		}, function () {
			self.finish('media', { broadcast: false, quiet: false });
		});
	};

	// Callee: answer a ring. The caller picks the first accept and announces it with `taken`.
	CallSession.prototype.acceptIncoming = function (ringMsg) {
		var self = this;
		if (self.state !== 'ringing' || (ringMsg && ringMsg.call !== self.callId)) {
			return Promise.resolve();
		}
		self.accepted = true;
		self.setState('connecting');
		self.arm(CONNECT_MS, function () { self.hangUp('failed'); });
		return self.openMedia().then(function (ok) {
			if (!ok || self.ended) {
				return;
			}
			self.send('accept');
			self.acceptSent = true;
		}, function () {
			self.send('decline');
			self.finish('media', { broadcast: false, quiet: false });
		});
	};

	CallSession.prototype.decline = function (ringMsg) {
		if (this.ended || (ringMsg && ringMsg.call !== this.callId)) {
			return;
		}
		this.send('decline');
		this.finish('declined', { broadcast: false, quiet: true });
	};

	CallSession.prototype.handle = function (msg) {
		var self = this;
		if (!msg || self.ended) {
			return;
		}
		if (self.callId && msg.call !== self.callId) {
			return;
		}
		switch (msg.t) {
		case 'ring':
			if (self.state !== 'idle' || typeof msg.call !== 'string') {
				return;
			}
			self.callId = msg.call;
			self.peer = msg.from;
			self.kind = msg.kind === 'video' ? 'video' : 'audio';
			self.setState('ringing');
			// The caller gives up after RING_MS; stop quietly if its `end` never arrives.
			self.arm(RING_MS + 5000, function () { self.finish('missed', { broadcast: false, quiet: true }); });
			return;
		case 'accept':
			if (!self.isCaller || self.peer || self.state !== 'calling') {
				return;
			}
			self.peer = msg.from;
			self.send('taken', { by: self.peer });
			self.setState('connecting');
			self.arm(CONNECT_MS, function () { self.hangUp('failed'); });
			var pc = self.safePc();
			if (!pc) {
				return;
			}
			pc.createOffer().then(function (offer) {
				return pc.setLocalDescription(offer);
			}).then(function () {
				if (!self.ended) {
					self.send('offer', { to: self.peer, sdp: pc.localDescription.sdp });
				}
			}).catch(function () { self.hangUp('failed'); });
			return;
		case 'taken':
			if (!self.isCaller && msg.from === self.peer && msg.by !== self.peerId) {
				self.finish('taken', { broadcast: false, quiet: true });
			}
			return;
		case 'offer':
			if (self.isCaller || !self.accepted || self.pc || msg.from !== self.peer || typeof msg.sdp !== 'string') {
				return;
			}
			var answerPc = self.safePc();
			if (!answerPc) {
				return;
			}
			answerPc.setRemoteDescription({ type: 'offer', sdp: msg.sdp }).then(function () {
				self.flushIce();
				return answerPc.createAnswer();
			}).then(function (answer) {
				return answerPc.setLocalDescription(answer);
			}).then(function () {
				if (self.ended) {
					return;
				}
				self.send('answer', { to: self.peer, sdp: answerPc.localDescription.sdp });
				self.record('answer', {});
			}).catch(function () { self.hangUp('failed'); });
			return;
		case 'answer':
			if (!self.isCaller || !self.pc || msg.from !== self.peer || typeof msg.sdp !== 'string') {
				return;
			}
			self.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).then(function () {
				self.flushIce();
			}).catch(function () { self.hangUp('failed'); });
			return;
		case 'ice':
			if (msg.from === self.peer && msg.candidate) {
				self.addIce(msg.candidate);
			}
			return;
		case 'end':
			if (msg.from !== self.peer) {
				return;
			}
			var reason = msg.reason === 'failed' || msg.reason === 'declined' || msg.reason === 'missed'
				? msg.reason : 'hangup';
			self.finish(reason, { broadcast: false, quiet: false });
			return;
		case 'decline':
			if (!self.isCaller || self.state !== 'calling') {
				return;
			}
			delete self.targets[msg.from];
			if (!Object.keys(self.targets).length) {
				self.hangUp('declined');
			}
			return;
		default:
			return;
		}
	};

	CallSession.prototype.toggleMute = function () {
		var tracks = this.localStream ? this.localStream.getAudioTracks() : [];
		var muted = tracks.length ? tracks[0].enabled : false;
		tracks.forEach(function (t) { t.enabled = !muted; });
		return muted;
	};

	CallSession.prototype.toggleCamera = function () {
		var tracks = this.localStream ? this.localStream.getVideoTracks() : [];
		var off = tracks.length ? tracks[0].enabled : false;
		tracks.forEach(function (t) { t.enabled = !off; });
		return off;
	};

	// Ends the call: broadcast `end`, stop every track, close the connection,
	// and log `end` once if this session logged `start` or `answer`.
	CallSession.prototype.hangUp = function (reason) {
		return this.finish(reason || 'hangup', { broadcast: true, quiet: false });
	};

	// Glare loser: drop our own call and broadcast `end` for it, so endpoints on the
	// winner's side still ringing for it stop (the winner's own call has another id
	// and ignores it). It logged `start`, so it logs `end` with reason `hangup` and
	// relay `unknown`.
	CallSession.prototype.abandon = function () {
		return this.finish('hangup', { broadcast: true, quiet: true, relay: 'unknown' });
	};

	CallSession.prototype.finish = function (reason, o) {
		var self = this;
		if (self.ended) {
			return self.done || Promise.resolve();
		}
		self.ended = true;
		clearTimeout(self.timer);
		clearTimeout(self.discTimer);
		if (o.broadcast && self.callId) {
			if (self.isCaller || self.acceptSent) {
				self.send('end', { reason: reason });
			} else if (self.state === 'ringing' || self.accepted) {
				// A callee whose accept never went out tells the caller it is not answering.
				self.send('decline');
			}
		}
		if (self.localStream) {
			self.localStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
		}
		var pc = self.pc;
		var relay;
		if (o.relay) {
			relay = Promise.resolve(o.relay);
		} else if (pc && self.state === 'connected') {
			relay = Promise.race([
				pc.getStats().then(relayFromStats).catch(function () { return self.relay; }),
				new Promise(function (resolve) { setTimeout(function () { resolve(self.relay); }, STATS_MS); })
			]).then(function (r) { return r === 'unknown' ? self.relay : r; });
		} else {
			relay = Promise.resolve(self.relay);
		}
		self.done = relay.then(function (r) {
			try { if (pc) { pc.close(); } } catch (e) {}
			if (self.logged) {
				return self.record('end', { reason: LOG_REASONS[reason] ? reason : 'hangup', relay: r });
			}
		}).catch(noop).then(noop);
		self.setState('ended', { reason: reason, quiet: Boolean(o.quiet) });
		return self.done;
	};

	root.TrippCall = {
		glareWinner: glareWinner,
		relayFromStats: relayFromStats,
		shouldHandle: shouldHandle,
		iceConfig: iceConfig,
		CallSession: CallSession,
		RING_MS: RING_MS
	};
})();
