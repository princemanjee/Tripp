// Tripp browser crypto. Files are encrypted here, so the server only ever
// holds ciphertext. No build step, no dependencies: WebCrypto only.
//
// Keys:
//   KEK   AES-GCM-256 from PBKDF2-SHA-256(SHA-256(keyfile) || passphrase).
//         Non-extractable; wraps the owner's private key.
//   owner RSA-OAEP-3072/SHA-256 keypair. The private key leaves the browser
//         only as pkcs8 wrapped under the KEK.
//   DEK   AES-GCM-256, one per conversation. Wrapped once for the owner (RSA-OAEP)
//         and once for the guest (AES-GCM under a key from the conversation password).
//
// Files are cut into CHUNK-byte pieces, each sealed with AES-GCM. The IV is an
// 8-byte random per-file nonce followed by the chunk index as uint32 big-endian,
// so no IV repeats within a file and a fresh nonce separates files. The AAD
// binds each chunk to its index and to whether it is the last one, so chunks
// cannot be reordered, and dropping the tail is caught because the new final
// chunk was not sealed as last.
//
// Every binary value crosses the API as a base64 string.
(function () {
	'use strict';

	var root = typeof window !== 'undefined' ? window : globalThis;
	var subtle = root.crypto.subtle;

	var ITERATIONS = 600000;
	var CHUNK = 1048576;
	var TAG = 16;
	var NONCE = 8;
	var IV = 12;
	var RSA = { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
	var RSA_IMPORT = { name: 'RSA-OAEP', hash: 'SHA-256' };

	function toBytes(x) {
		if (x instanceof Uint8Array) return x;
		if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
		return new Uint8Array(x);
	}

	function b64(bytes) {
		bytes = toBytes(bytes);
		var s = '';
		for (var i = 0; i < bytes.length; i += 0x8000) {
			s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		}
		return btoa(s);
	}

	function unb64(str) {
		var s = atob(str);
		var out = new Uint8Array(s.length);
		for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
		return out;
	}

	function random(n) {
		var out = new Uint8Array(n);
		for (var i = 0; i < n; i += 65536) {
			root.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
		}
		return out;
	}

	function randomB64(n) {
		return b64(random(n));
	}

	function utf8(s) {
		return new TextEncoder().encode(s);
	}

	function concat(a, b) {
		var out = new Uint8Array(a.length + b.length);
		out.set(a, 0);
		out.set(b, a.length);
		return out;
	}

	async function pbkdf2Aes(secretBytes, saltB64, iterations) {
		var base = await subtle.importKey('raw', secretBytes, 'PBKDF2', false, ['deriveKey']);
		return subtle.deriveKey(
			{ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iterations },
			base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
	}

	async function deriveKek(passphrase, keyfileBytes, saltB64, iterations) {
		var secret = utf8(passphrase);
		if (keyfileBytes != null) {
			var digest = new Uint8Array(await subtle.digest('SHA-256', toBytes(keyfileBytes)));
			secret = concat(digest, secret);
		}
		return pbkdf2Aes(secret, saltB64, iterations);
	}

	async function createOwnerKeys(kek) {
		var pair = await subtle.generateKey(RSA, true, ['wrapKey', 'unwrapKey']);
		var iv = random(IV);
		var wrapped = await subtle.wrapKey('pkcs8', pair.privateKey, kek, { name: 'AES-GCM', iv: iv });
		var publicJwk = await subtle.exportKey('jwk', pair.publicKey);
		return { publicJwk: publicJwk, wrappedPrivate: b64(wrapped), privateIv: b64(iv) };
	}

	async function openOwnerKey(kek, wrappedPrivate, privateIv) {
		try {
			return await subtle.unwrapKey('pkcs8', unb64(wrappedPrivate), kek,
				{ name: 'AES-GCM', iv: unb64(privateIv) }, RSA_IMPORT, false, ['unwrapKey']);
		} catch (e) {
			throw new Error('bad_passphrase');
		}
	}

	function newConversationKey() {
		return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
	}

	async function wrapForOwner(dek, publicJwk) {
		// Import only the public parameters, so a jwk whose key_ops say
		// 'encrypt' (or carry nothing) still imports for wrapKey.
		var jwk = { kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e, alg: 'RSA-OAEP-256', ext: true };
		var pub = await subtle.importKey('jwk', jwk, RSA_IMPORT, false, ['wrapKey']);
		return b64(await subtle.wrapKey('raw', dek, pub, { name: 'RSA-OAEP' }));
	}

	// Extractable, so the admin can re-wrap it for the guest after a password change.
	function unwrapForOwner(wrappedB64, privateKey) {
		return subtle.unwrapKey('raw', unb64(wrappedB64), privateKey, { name: 'RSA-OAEP' },
			{ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
	}

	function deriveGuestKey(password, saltB64, iterations) {
		return pbkdf2Aes(utf8(password), saltB64, iterations);
	}

	async function wrapForGuest(dek, guestKey) {
		var iv = random(IV);
		var wrapped = await subtle.wrapKey('raw', dek, guestKey, { name: 'AES-GCM', iv: iv });
		return { wrapped: b64(wrapped), iv: b64(iv) };
	}

	function unwrapForGuest(wrapped, iv, guestKey) {
		return subtle.unwrapKey('raw', unb64(wrapped), guestKey, { name: 'AES-GCM', iv: unb64(iv) },
			{ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
	}

	function chunkIv(nonce, index) {
		var iv = new Uint8Array(IV);
		iv.set(nonce, 0);
		new DataView(iv.buffer).setUint32(NONCE, index, false);
		return iv;
	}

	function chunkAad(index, isLast) {
		return utf8(index + '|' + (isLast ? 1 : 0));
	}

	function chunkCount(plainSize, chunkSize) {
		return Math.max(1, Math.ceil(plainSize / chunkSize));
	}

	function cipherSize(plain, chunkSize) {
		return plain + TAG * chunkCount(plain, chunkSize);
	}

	async function encryptFile(dek, blob) {
		var nonce = random(NONCE);
		var count = chunkCount(blob.size, CHUNK);
		if (count > 0xffffffff) throw new Error('too_large');
		var parts = [];
		for (var i = 0; i < count; i++) {
			var start = i * CHUNK;
			var plain = await blob.slice(start, Math.min(start + CHUNK, blob.size)).arrayBuffer();
			parts.push(await subtle.encrypt(
				{ name: 'AES-GCM', iv: chunkIv(nonce, i), additionalData: chunkAad(i, i === count - 1) },
				dek, plain));
		}
		return { ciphertext: new Blob(parts), nonce: b64(nonce), chunkSize: CHUNK };
	}

	async function decryptFile(dek, arrayBuffer, nonceB64, chunkSize) {
		var nonce = unb64(nonceB64);
		if (nonce.length !== NONCE) throw new Error('bad_nonce');
		if (!(chunkSize > 0) || chunkSize % 1 !== 0) throw new Error('bad_chunk_size');
		var data = toBytes(arrayBuffer);
		var sealed = chunkSize + TAG;
		var count = Math.max(1, Math.ceil(data.length / sealed));
		var out = new Uint8Array(Math.max(0, data.length - TAG * count));
		var at = 0;
		for (var i = 0; i < count; i++) {
			var start = i * sealed;
			var piece = data.subarray(start, Math.min(start + sealed, data.length));
			// A short final piece fails here; a missing final piece fails because
			// the chunk now in last place was not sealed with isLast = 1.
			var plain = new Uint8Array(await subtle.decrypt(
				{ name: 'AES-GCM', iv: chunkIv(nonce, i), additionalData: chunkAad(i, i === count - 1) },
				dek, piece));
			out.set(plain, at);
			at += plain.length;
		}
		return out;
	}

	async function encryptText(dek, text) {
		var iv = random(IV);
		var ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv }, dek, utf8(text)));
		return b64(concat(iv, ct));
	}

	async function decryptText(dek, str) {
		var bytes = unb64(str);
		if (bytes.length < IV + TAG) throw new Error('bad_ciphertext');
		var plain = await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, IV) }, dek, bytes.subarray(IV));
		return new TextDecoder('utf-8', { fatal: true }).decode(plain);
	}

	root.TrippCrypto = {
		ITERATIONS: ITERATIONS,
		CHUNK: CHUNK,
		deriveKek: deriveKek,
		createOwnerKeys: createOwnerKeys,
		openOwnerKey: openOwnerKey,
		newConversationKey: newConversationKey,
		wrapForOwner: wrapForOwner,
		unwrapForOwner: unwrapForOwner,
		deriveGuestKey: deriveGuestKey,
		wrapForGuest: wrapForGuest,
		unwrapForGuest: unwrapForGuest,
		encryptFile: encryptFile,
		decryptFile: decryptFile,
		encryptText: encryptText,
		decryptText: decryptText,
		cipherSize: cipherSize,
		randomB64: randomB64
	};
})();
