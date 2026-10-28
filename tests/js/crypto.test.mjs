import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(fs.readFileSync('site/crypto.js', 'utf8'));
const C = globalThis.TrippCrypto;
const ITERATIONS = 1000;

function randomBytes(n) {
	const out = new Uint8Array(n);
	for (let i = 0; i < n; i += 65536) {
		crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
	}
	return out;
}

async function rawOf(key) {
	return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

test('constants', () => {
	assert.equal(C.ITERATIONS, 600000);
	assert.equal(C.CHUNK, 1048576);
});

test('owner keys: right passphrase opens, wrong one is bad_passphrase', async () => {
	const salt = C.randomB64(16);
	const kek = await C.deriveKek('correct horse', null, salt, ITERATIONS);
	const owner = await C.createOwnerKeys(kek);
	assert.equal(typeof owner.wrappedPrivate, 'string');
	assert.equal(typeof owner.privateIv, 'string');
	assert.equal(owner.publicJwk.kty, 'RSA');
	assert.equal(owner.publicJwk.d, undefined, 'public jwk has no private part');

	const priv = await C.openOwnerKey(kek, owner.wrappedPrivate, owner.privateIv);
	assert.equal(priv.type, 'private');
	assert.equal(priv.extractable, false);

	const wrong = await C.deriveKek('wrong horse', null, salt, ITERATIONS);
	await assert.rejects(C.openOwnerKey(wrong, owner.wrappedPrivate, owner.privateIv),
		(e) => e instanceof Error && e.message === 'bad_passphrase');
});

test('keyfile is part of the KEK', async () => {
	const salt = C.randomB64(16);
	const keyfile = randomBytes(64);
	const kek = await C.deriveKek('pass', keyfile, salt, ITERATIONS);
	assert.equal(kek.extractable, false);
	assert.deepEqual([...kek.usages].sort(), ['unwrapKey', 'wrapKey']);
	const owner = await C.createOwnerKeys(kek);
	await C.openOwnerKey(await C.deriveKek('pass', keyfile, salt, ITERATIONS), owner.wrappedPrivate, owner.privateIv);
	await assert.rejects(C.openOwnerKey(await C.deriveKek('pass', null, salt, ITERATIONS), owner.wrappedPrivate, owner.privateIv),
		{ message: 'bad_passphrase' });
});

test('DEK round-trips through owner and guest wrapping', async () => {
	const kek = await C.deriveKek('p', null, C.randomB64(16), ITERATIONS);
	const owner = await C.createOwnerKeys(kek);
	const priv = await C.openOwnerKey(kek, owner.wrappedPrivate, owner.privateIv);
	const dek = await C.newConversationKey();
	assert.equal(dek.extractable, true);
	const want = await rawOf(dek);

	const wrappedOwner = await C.wrapForOwner(dek, owner.publicJwk);
	assert.equal(typeof wrappedOwner, 'string');
	const back = await C.unwrapForOwner(wrappedOwner, priv);
	assert.equal(back.extractable, true);
	assert.deepEqual(await rawOf(back), want);

	const salt = C.randomB64(16);
	const gk = await C.deriveGuestKey('conversation password', salt, ITERATIONS);
	assert.equal(gk.extractable, false);
	const g = await C.wrapForGuest(dek, gk);
	const gdek = await C.unwrapForGuest(g.wrapped, g.iv, await C.deriveGuestKey('conversation password', salt, ITERATIONS));
	assert.equal(gdek.extractable, false);
	// Prove it is the same key: what one encrypts, the other decrypts.
	assert.equal(await C.decryptText(gdek, await C.encryptText(dek, 'same key')), 'same key');
	await assert.rejects(C.unwrapForGuest(g.wrapped, g.iv, await C.deriveGuestKey('other', salt, ITERATIONS)));
});

test('2.5 MiB file round-trips and size matches cipherSize', async () => {
	const dek = await C.newConversationKey();
	const plain = randomBytes(2.5 * 1048576);
	const out = await C.encryptFile(dek, new Blob([plain]));
	assert.equal(out.chunkSize, C.CHUNK);
	assert.equal(out.ciphertext.size, C.cipherSize(plain.length, C.CHUNK));
	const buf = await out.ciphertext.arrayBuffer();
	const back = await C.decryptFile(dek, buf, out.nonce, out.chunkSize);
	assert.ok(back instanceof Uint8Array);
	assert.equal(back.length, plain.length);
	assert.ok(Buffer.compare(back, plain) === 0, 'identical bytes');

	// Truncation: drop the last chunk.
	const truncated = buf.slice(0, 2 * (C.CHUNK + 16));
	await assert.rejects(C.decryptFile(dek, truncated, out.nonce, out.chunkSize));

	// Tampering: flip one byte.
	const tampered = new Uint8Array(buf.slice(0));
	tampered[1234567] ^= 0x01;
	await assert.rejects(C.decryptFile(dek, tampered.buffer, out.nonce, out.chunkSize));

	// Reordering the first two chunks.
	const a = new Uint8Array(buf, 0, C.CHUNK + 16);
	const b = new Uint8Array(buf, C.CHUNK + 16, C.CHUNK + 16);
	const swapped = new Uint8Array(buf.byteLength);
	swapped.set(b, 0); swapped.set(a, C.CHUNK + 16);
	swapped.set(new Uint8Array(buf, 2 * (C.CHUNK + 16)), 2 * (C.CHUNK + 16));
	await assert.rejects(C.decryptFile(dek, swapped.buffer, out.nonce, out.chunkSize));

	// Wrong nonce.
	await assert.rejects(C.decryptFile(dek, buf, C.randomB64(8), out.chunkSize));
});

test('exact multiple of CHUNK: dropping the last full chunk is caught', async () => {
	const dek = await C.newConversationKey();
	const plain = randomBytes(2 * 1048576);
	const out = await C.encryptFile(dek, new Blob([plain]));
	assert.equal(out.ciphertext.size, C.cipherSize(plain.length, C.CHUNK));
	const buf = await out.ciphertext.arrayBuffer();
	assert.equal(Buffer.compare(await C.decryptFile(dek, buf, out.nonce, out.chunkSize), plain), 0);
	await assert.rejects(C.decryptFile(dek, buf.slice(0, C.CHUNK + 16), out.nonce, out.chunkSize));
});

test('0-byte file round-trips', async () => {
	const dek = await C.newConversationKey();
	const out = await C.encryptFile(dek, new Blob([]));
	assert.equal(out.ciphertext.size, 16);
	assert.equal(out.ciphertext.size, C.cipherSize(0, C.CHUNK));
	const back = await C.decryptFile(dek, await out.ciphertext.arrayBuffer(), out.nonce, out.chunkSize);
	assert.equal(back.length, 0);
	await assert.rejects(C.decryptFile(dek, new ArrayBuffer(0), out.nonce, out.chunkSize));
});

test('each file gets a fresh nonce', async () => {
	const dek = await C.newConversationKey();
	const a = await C.encryptFile(dek, new Blob(['x']));
	const b = await C.encryptFile(dek, new Blob(['x']));
	assert.notEqual(a.nonce, b.nonce);
	assert.equal(atob(a.nonce).length, 8);
});

test('encryptText/decryptText round-trip a unicode filename', async () => {
	const dek = await C.newConversationKey();
	const name = 'Rapport d’été — 文件 📎.pdf';
	const ct = await C.encryptText(dek, name);
	assert.equal(typeof ct, 'string');
	assert.notEqual(ct, await C.encryptText(dek, name), 'fresh iv each time');
	assert.equal(await C.decryptText(dek, ct), name);
	const bytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
	bytes[bytes.length - 1] ^= 1;
	await assert.rejects(C.decryptText(dek, btoa(String.fromCharCode(...bytes))));
});

test('cipherSize', () => {
	assert.equal(C.cipherSize(1048576, C.CHUNK), 1048592);
	assert.equal(C.cipherSize(0, C.CHUNK), 16);
	assert.equal(C.cipherSize(1048577, C.CHUNK), 1048577 + 32);
	assert.equal(C.cipherSize(2.5 * 1048576, C.CHUNK), 2.5 * 1048576 + 48);
});

test('randomB64', () => {
	assert.equal(atob(C.randomB64(16)).length, 16);
	assert.notEqual(C.randomB64(16), C.randomB64(16));
});
