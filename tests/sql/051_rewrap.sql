-- m_conv_save key rewrap guard: re-passwording a keyed conversation needs the
-- guest copy rewrapped in the same call.
do $$
declare
	p1 text := 't-' || md5(random()::text);
	p2 text := 't-' || md5(random()::text);
	p3 text := 't-' || md5(random()::text);
	p4 text := 't-' || md5(random()::text);
	p5 text := 't-' || md5(random()::text);
	tok text := 't-tok-' || md5(random()::text);
	conv bigint; conv2 bigint; conv3 bigint;
	r json;
	ev0 bigint;
	h0 text;
	k tripp_keys.conversations;
	e tripp.events;
begin
	insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash(tok), null);
	delete from tripp_keys.owner;

	-- Create with key params but no owner row: no_keys, nothing created.
	r := public.m_conv_save(tok, null, 't-nokeys', p5, 'wg', 'gs', 'gi', 1000, 'wo');
	assert (r ->> 'error') = 'no_keys', 'create without owner row gives no_keys';
	assert not exists (select 1 from tripp.conversations where label = 't-nokeys'), 'no_keys creates nothing';

	insert into tripp_keys.owner (id, public_jwk, wrapped_private, private_iv, kdf_salt, kdf_iterations)
	values (1, '{}'::jsonb, 'wp', 'piv', 'ks', 1000);

	-- Partial key params on create: bad_keys, nothing created.
	r := public.m_conv_save(tok, null, 't-bad1', p5, 'wg', 'gs', 'gi', 1000, null);
	assert (r ->> 'error') = 'bad_keys', 'missing wrapped_owner gives bad_keys';
	r := public.m_conv_save(tok, null, 't-bad2', p5, 'wg', null, 'gi', 1000, 'wo');
	assert (r ->> 'error') = 'bad_keys', 'missing salt gives bad_keys';
	r := public.m_conv_save(tok, null, 't-bad3', p5, null, null, null, null, 'wo');
	assert (r ->> 'error') = 'bad_keys', 'owner copy alone gives bad_keys';
	assert not exists (select 1 from tripp.conversations where label like 't-bad_'), 'bad_keys creates nothing';

	-- Create with no key params: conversation, no key row (as before).
	r := public.m_conv_save(tok, null, 't-plain', p1);
	assert (r ->> 'ok') = 'true', 'plain create ok';
	conv2 := (r ->> 'id')::bigint;
	assert not exists (select 1 from tripp_keys.conversations where conversation_id = conv2), 'plain create has no key row';

	-- Create with all key params and an owner row: key row inserted too.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_conv_save(tok, null, 't-keyed', p2, 'wg1', 'gs1', 'gi1', 1000, 'wo1');
	assert (r ->> 'ok') = 'true', 'keyed create ok';
	conv := (r ->> 'id')::bigint;
	select * into k from tripp_keys.conversations where conversation_id = conv;
	assert k.wrapped_owner = 'wo1' and k.wrapped_guest = 'wg1' and k.guest_salt = 'gs1'
		and k.guest_iv = 'gi1' and k.guest_iterations = 1000, 'keyed create inserts the key row';
	select * into e from tripp.events where id > ev0;
	assert (select count(*) from tripp.events where id > ev0) = 1 and e.type = 'admin_conv_save'
		and e.ref_id = conv and (e.detail ->> 'created') = 'true', 'keyed create still logs admin_conv_save';

	-- Password change on a keyed conversation without a guest copy: needs_unlock, nothing changes, no event.
	select hash into h0 from tripp.conversations where id = conv;
	insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash(tok || 'g'), conv);
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_conv_save(tok, conv, 'x-new-label', p3);
	assert (r ->> 'error') = 'needs_unlock' and (r ->> 'ok') = 'false', 'password change without guest copy needs_unlock';
	r := public.m_conv_save(tok, conv, null, p3, '', 's', 'i', 1);
	assert (r ->> 'error') = 'needs_unlock', 'empty wrapped_guest needs_unlock';
	assert (select hash from tripp.conversations where id = conv) = h0, 'needs_unlock leaves the password';
	assert (select label from tripp.conversations where id = conv) = 't-keyed', 'needs_unlock leaves the label';
	assert exists (select 1 from tripp.sessions where conversation_id = conv), 'needs_unlock keeps guest sessions';
	assert (select wrapped_guest from tripp_keys.conversations where conversation_id = conv) = 'wg1', 'needs_unlock leaves the key row';
	assert (select count(*) from tripp.events where id > ev0) = 0, 'needs_unlock logs no event';

	-- Existing errors keep priority over needs_unlock.
	r := public.m_conv_save(tok, conv, null, p1);
	assert (r ->> 'error') = 'password_taken', 'password_taken beats needs_unlock';
	r := public.m_conv_save(tok, conv, repeat('x', 101), p3);
	assert (r ->> 'error') = 'label_too_long', 'label_too_long beats needs_unlock';

	-- Password change with the guest copy: both update together.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_conv_save(tok, conv, null, p3, 'wg2', 'gs2', 'gi2', 2000);
	assert (r ->> 'ok') = 'true', 'rewrap ok';
	assert (select hash from tripp.conversations where id = conv) <> h0, 'password changed';
	assert (select hash from tripp.conversations where id = conv) = extensions.crypt(p3, (select hash from tripp.conversations where id = conv)), 'new password verifies';
	select * into k from tripp_keys.conversations where conversation_id = conv;
	assert k.wrapped_guest = 'wg2' and k.guest_salt = 'gs2' and k.guest_iv = 'gi2' and k.guest_iterations = 2000,
		'guest fields rewrapped';
	assert k.wrapped_owner = 'wo1', 'owner copy untouched';
	assert not exists (select 1 from tripp.sessions where conversation_id = conv), 'guest sessions ended';
	select * into e from tripp.events where id > ev0;
	assert (select count(*) from tripp.events where id > ev0) = 1 and e.type = 'admin_conv_save'
		and e.ref_id = conv and (e.detail ->> 'password_changed') = 'true' and (e.detail ->> 'created') = 'false',
		'rewrap logs admin_conv_save';

	-- Partial guest params on a password change: bad_keys.
	r := public.m_conv_save(tok, conv, null, p4, 'wg3', null, 'gi3', 1000);
	assert (r ->> 'error') = 'bad_keys', 'partial guest params on update give bad_keys';

	-- Label-only change on a keyed conversation never needs unlock.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_conv_save(tok, conv, 't-keyed-renamed', null);
	assert (r ->> 'ok') = 'true', 'label-only change ok';
	r := public.m_conv_save(tok, conv, 't-keyed-renamed2', '');
	assert (r ->> 'ok') = 'true', 'label-only change with empty password ok';
	assert (select label from tripp.conversations where id = conv) = 't-keyed-renamed2', 'label changed';
	assert (select wrapped_guest from tripp_keys.conversations where conversation_id = conv) = 'wg2', 'label change leaves key row';
	assert (select count(*) from tripp.events where id > ev0) = 2, 'label changes log events';

	-- Password change on a conversation with no key row needs no unlock.
	r := public.m_conv_save(tok, conv2, null, p4);
	assert (r ->> 'ok') = 'true', 'password change without a key row ok';
	assert not exists (select 1 from tripp_keys.conversations where conversation_id = conv2), 'still no key row';
end $$;
