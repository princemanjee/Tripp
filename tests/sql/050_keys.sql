-- Key store: owner keypair setup, per-conversation wrapped keys, guest and
-- admin views, backup, and cascade on conversation delete.
do $$
declare
	adm text := 't-adm-' || md5(random()::text);
	gst text := 't-gst-' || md5(random()::text);
	gst2 text := 't-gst2-' || md5(random()::text);
	conv bigint; conv2 bigint;
	r json;
	ev0 bigint;
	jwk jsonb := '{"kty":"RSA","n":"AQAB-test","e":"AQAB"}';
begin
	-- Clean slate inside the rolled-back transaction.
	delete from tripp_keys.conversations;
	delete from tripp_keys.owner;

	insert into tripp.conversations (label, hash)
	values ('t-keys-' || md5(random()::text), 't-keys-hash-' || md5(random()::text)) returning id into conv;
	insert into tripp.conversations (label, hash)
	values ('t-keys2-' || md5(random()::text), 't-keys2-hash-' || md5(random()::text)) returning id into conv2;
	insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash(adm), null);
	insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash(gst), conv);
	insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash(gst2), conv2);

	-- Token checks.
	r := public.m_keys('bad-token');
	assert (r ->> 'error') = 'expired', 'm_keys expired';
	r := public.m_key_setup('bad-token', jwk, 'wp', 'iv', 'salt', 1000);
	assert (r ->> 'error') = 'expired', 'm_key_setup expired';
	r := public.m_key_setup(gst, jwk, 'wp', 'iv', 'salt', 1000);
	assert (r ->> 'error') = 'forbidden', 'm_key_setup guest forbidden';
	r := public.m_key_conv('bad-token', null, 'wo', 'wg', 's', 'i', 1000);
	assert (r ->> 'error') = 'expired', 'm_key_conv expired';
	r := public.m_keys_backup('bad-token');
	assert (r ->> 'error') = 'expired', 'backup expired';

	-- Before setup.
	r := public.m_keys(gst);
	assert (r ->> 'ok') = 'true' and (r -> 'public_jwk')::text = 'null' and (r -> 'conv')::text = 'null', 'guest m_keys before setup';
	r := public.m_keys(adm, conv);
	assert (r ->> 'ok') = 'true' and (r -> 'owner')::text = 'null' and (r -> 'conv')::text = 'null', 'admin m_keys before setup';
	r := public.m_key_conv(gst, null, 'wo', 'wg', 's', 'i', 1000);
	assert (r ->> 'error') = 'no_keys', 'guest key_conv before setup: no_keys';
	r := public.m_key_conv(adm, conv, 'wo', 'wg', 's', 'i', 1000);
	assert (r ->> 'error') = 'no_keys', 'admin key_conv before setup: no_keys';

	-- Setup, once.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_key_setup(adm, jwk, 'WRAPPED-PRIVATE', 'piv', 'ksalt', 600000);
	assert (r ->> 'ok') = 'true', 'setup ok';
	assert (select count(*) from tripp.events where id > ev0) = 1, 'setup logs one event';
	assert exists (select 1 from tripp.events where id > ev0 and type = 'key_setup' and scope = 0), 'key_setup event';
	assert (select kdf from tripp_keys.owner) = 'pbkdf2-sha256', 'kdf default';
	assert (select kdf_iterations from tripp_keys.owner) = 600000, 'iterations stored';
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_key_setup(adm, jwk, 'other', 'piv', 'ksalt', 600000);
	assert (r ->> 'error') = 'exists', 'second setup: exists';
	assert (select count(*) from tripp.events where id > ev0) = 0, 'failed setup logs nothing';
	assert (select wrapped_private from tripp_keys.owner) = 'WRAPPED-PRIVATE', 'owner row unchanged';

	-- Guest inserts its own conversation key once.
	r := public.m_key_conv(gst, null, 'WRAPPED-OWNER', 'wg1', 'gs1', 'gi1', 1000);
	assert (r ->> 'ok') = 'true', 'guest key_conv ok';
	assert (select wrapped_owner from tripp_keys.conversations where conversation_id = conv) = 'WRAPPED-OWNER', 'row stored for own conversation';
	r := public.m_key_conv(gst, null, 'evil', 'evil', 'evil', 'evil', 1);
	assert (r ->> 'error') = 'exists', 'guest second key_conv: exists';
	assert (select wrapped_guest from tripp_keys.conversations where conversation_id = conv) = 'wg1', 'guest cannot overwrite';
	-- A guest's p_conversation is ignored: it always targets its own.
	r := public.m_key_conv(gst, conv2, 'evil', 'evil', 'evil', 'evil', 1);
	assert (r ->> 'error') = 'exists', 'guest cannot aim at another conversation';
	assert not exists (select 1 from tripp_keys.conversations where conversation_id = conv2), 'no row for conv2';

	-- Guest view.
	r := public.m_keys(gst);
	assert (r ->> 'ok') = 'true', 'guest m_keys ok';
	assert (r -> 'public_jwk' ->> 'kty') = 'RSA', 'guest sees public key';
	assert (r -> 'conv' ->> 'wrapped_guest') = 'wg1' and (r -> 'conv' ->> 'guest_salt') = 'gs1'
		and (r -> 'conv' ->> 'guest_iv') = 'gi1' and (r -> 'conv' ->> 'guest_iterations')::int = 1000, 'guest conv fields';
	assert r::text not like '%wrapped_private%', 'guest m_keys has no wrapped_private key';
	assert r::text not like '%WRAPPED-PRIVATE%', 'guest m_keys has no private ciphertext';
	assert r::text not like '%wrapped_owner%', 'guest m_keys has no wrapped_owner key';
	assert r::text not like '%WRAPPED-OWNER%', 'guest m_keys has no owner ciphertext';
	r := public.m_keys(gst, conv2);
	assert (r -> 'conv' ->> 'wrapped_guest') = 'wg1', 'guest p_conversation ignored';

	-- Admin view.
	r := public.m_keys(adm, conv);
	assert (r -> 'owner' ->> 'wrapped_private') = 'WRAPPED-PRIVATE' and (r -> 'owner' ->> 'private_iv') = 'piv'
		and (r -> 'owner' ->> 'kdf') = 'pbkdf2-sha256' and (r -> 'owner' ->> 'kdf_salt') = 'ksalt'
		and (r -> 'owner' ->> 'kdf_iterations')::int = 600000 and (r -> 'owner' -> 'public_jwk' ->> 'kty') = 'RSA', 'admin owner fields';
	assert (r -> 'conv' ->> 'wrapped_owner') = 'WRAPPED-OWNER', 'admin conv wrapped_owner';
	assert r::text not like '%wg1%', 'admin conv has no guest wrap';
	r := public.m_keys(adm, conv2);
	assert (r -> 'conv')::text = 'null', 'admin: no conv row yet';

	-- Admin replaces the guest fields; wrapped_owner stays.
	r := public.m_key_conv(adm, conv, 'IGNORED', 'wg2', 'gs2', 'gi2', 2000);
	assert (r ->> 'ok') = 'true', 'admin replace ok';
	assert (select wrapped_guest || guest_salt || guest_iv || guest_iterations::text || wrapped_owner
	          from tripp_keys.conversations where conversation_id = conv) = 'wg2gs2gi22000WRAPPED-OWNER', 'guest fields replaced';
	-- Admin may insert for another conversation.
	r := public.m_key_conv(adm, conv2, 'WO2', null, null, null, null);
	assert (r ->> 'ok') = 'true', 'admin insert ok';
	assert (select wrapped_owner from tripp_keys.conversations where conversation_id = conv2) = 'WO2', 'admin inserted row';
	r := public.m_key_conv(adm, -1, 'x', null, null, null, null);
	assert (r ->> 'error') = 'no_conversation', 'admin unknown conversation';
	r := public.m_key_conv(adm, conv2, null, null, null, null, null);
	assert (r ->> 'ok') = 'true', 'admin null wrapped_owner on existing row keeps it';
	assert (select wrapped_owner from tripp_keys.conversations where conversation_id = conv2) = 'WO2', 'wrapped_owner kept';

	-- Backup.
	r := public.m_keys_backup(gst);
	assert (r ->> 'error') = 'forbidden', 'guest backup forbidden';
	r := public.m_keys_backup(adm);
	assert (r ->> 'ok') = 'true', 'backup ok';
	assert (r -> 'owner' ->> 'wrapped_private') = 'WRAPPED-PRIVATE', 'backup owner';
	assert json_array_length(r -> 'conversations') = 2, 'backup conversations';
	assert (r ->> 'exported_at') is not null, 'backup exported_at';

	-- Cascade.
	delete from tripp.conversations where id = conv;
	assert not exists (select 1 from tripp_keys.conversations where conversation_id = conv), 'key row removed with conversation';

	-- RLS on, no policies.
	assert (select relrowsecurity from pg_class where oid = 'tripp_keys.owner'::regclass), 'rls owner';
	assert (select relrowsecurity from pg_class where oid = 'tripp_keys.conversations'::regclass), 'rls conversations';
	assert not exists (select 1 from pg_policies where schemaname = 'tripp_keys'), 'no policies';
	assert not has_schema_privilege('anon', 'tripp_keys', 'usage'), 'anon has no schema usage';
	assert has_function_privilege('anon', 'public.m_keys(text, bigint)', 'execute'), 'anon may call m_keys';
end $$;
