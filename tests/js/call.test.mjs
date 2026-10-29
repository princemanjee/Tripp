import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(fs.readFileSync('site/call.js', 'utf8'));
const T = globalThis.TrippCall;

test('glareWinner: the lexicographically smaller call id wins', () => {
	assert.equal(T.glareWinner('a', 'b'), 'mine');
	assert.equal(T.glareWinner('b', 'a'), 'theirs');
});

test('relayFromStats follows the selected pair to its local candidate', () => {
	const report = [
		{ id: 'T1', type: 'transport', selectedCandidatePairId: 'P2' },
		{ id: 'P1', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L1' },
		{ id: 'P2', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L2' },
		{ id: 'L1', type: 'local-candidate', candidateType: 'host' },
		{ id: 'L2', type: 'local-candidate', candidateType: 'relay' }
	];
	assert.equal(T.relayFromStats(report), 'relay');
});

test('relayFromStats falls back to the nominated succeeded pair', () => {
	const report = new Map([
		['P0', { id: 'P0', type: 'candidate-pair', nominated: false, state: 'succeeded', localCandidateId: 'L0' }],
		['P1', { id: 'P1', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L1' }],
		['L0', { id: 'L0', type: 'local-candidate', candidateType: 'host' }],
		['L1', { id: 'L1', type: 'local-candidate', candidateType: 'srflx' }]
	]);
	assert.equal(T.relayFromStats(report), 'srflx');
});

test('relayFromStats with nothing gives unknown', () => {
	assert.equal(T.relayFromStats([]), 'unknown');
	assert.equal(T.relayFromStats(null), 'unknown');
});

test('shouldHandle filters by to and by role', () => {
	const me = { peerId: 'me', role: 'admin' };
	assert.equal(T.shouldHandle({ t: 'offer', call: 'c', from: 'g', to: 'other' }, me, 'guest'), false);
	assert.equal(T.shouldHandle({ t: 'ring', call: 'c', from: 'a2', kind: 'audio' }, me, 'admin'), false);
	assert.equal(T.shouldHandle({ t: 'ring', call: 'c', from: 'g', kind: 'audio' }, me, 'guest'), true);
	assert.equal(T.shouldHandle({ t: 'answer', call: 'c', from: 'g', to: 'me' }, me, 'guest'), true);
	assert.equal(T.shouldHandle({ t: 'ring', call: 'c', from: 'g' }, me, undefined), false);
});

test('iceConfig takes the servers from config', () => {
	const prev = globalThis.APP_CONFIG;
	globalThis.APP_CONFIG = { iceServers: [{ urls: ['stun:example.org:3478'] }] };
	try {
		assert.deepEqual(T.iceConfig(), { iceServers: [{ urls: ['stun:example.org:3478'] }] });
	} finally {
		globalThis.APP_CONFIG = prev;
	}
});

function fakeSession(sent, logs) {
	const channel = { send: (m) => { sent.push(m.payload); return Promise.resolve(); } };
	return new T.CallSession({
		channel,
		conversationId: 1,
		kind: 'audio',
		role: 'admin',
		peerId: 'me',
		log: (action, callId, detail) => { logs.push({ action, callId, detail }); return Promise.resolve(); }
	});
}

test('glare loser broadcasts end for its losing call and logs end with relay unknown', async () => {
	const sent = [];
	const logs = [];
	const s = fakeSession(sent, logs);
	s.isCaller = true;
	s.callId = 'X';
	s.state = 'calling';
	s.logged = true;
	await s.abandon();
	assert.equal(s.ended, true);
	assert.deepEqual(sent, [{ t: 'end', call: 'X', from: 'me', reason: 'hangup' }]);
	assert.deepEqual(logs, [{ action: 'end', callId: 'X', detail: { reason: 'hangup', relay: 'unknown' } }]);
});

test('an active call ignores an end for a different call id', () => {
	const s = fakeSession([], []);
	s.isCaller = true;
	s.callId = 'Y';
	s.state = 'calling';
	s.peer = 'g';
	s.handle({ t: 'end', call: 'X', from: 'g', reason: 'hangup' });
	assert.equal(s.ended, false);
	assert.equal(s.state, 'calling');
	s.handle({ t: 'end', call: 'Y', from: 'g', reason: 'hangup' });
	assert.equal(s.ended, true);
});
