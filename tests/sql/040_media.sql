-- Attachments: reservations, m_post checks, m_list output, the Storage trash
-- queue, and the internal media_* functions.
do $$
declare
	adm text := 't-adm-' || md5(random()::text);
	gA text := 't-ga-' || md5(random()::text);
	gB text := 't-gb-' || md5(random()::text);
	convA bigint; convB bigint; convC bigint;
	r json;
	pth text; pth2 text; pthB text;
	att jsonb;
	mid bigint; aid bigint;
	ev0 bigint;
	n int;
	lst json;
begin
	delete from tripp_keys.conversations;
	delete from tripp_keys.owner;
	insert into tripp_keys.owner (id, public_jwk, wrapped_private, private_iv, kdf_salt, kdf_iterations)
	values (1, '{"kty":"RSA"}', 'wp', 'iv', 'salt', 1000);

	insert into tripp.conversations (label, hash)
	values ('t-med-a-' || md5(random()::text), 't-med-ha-' || md5(random()::text)) returning id into convA;
	insert into tripp.conversations (label, hash)
	values ('t-med-b-' || md5(random()::text), 't-med-hb-' || md5(random()::text)) returning id into convB;
	insert into tripp.conversations (label, hash)
	values ('t-med-c-' || md5(random()::text), 't-med-hc-' || md5(random()::text)) returning id into convC;
	insert into tripp_keys.conversations (conversation_id, wrapped_owner) values (convA, 'wo'), (convB, 'wo');
	insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash(adm), null);
	insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash(gA), convA);
	insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash(gB), convB);

	-- cipher_size.
	assert tripp.cipher_size(1048576) = 1048592, 'cipher_size one full chunk';
	assert tripp.cipher_size(1048577) = 1048609, 'cipher_size just over a chunk';
	assert tripp.cipher_size(1) = 17, 'cipher_size one byte';

	-- Bucket is private with the size limit; the migration adds no policies.
	assert exists (select 1 from storage.buckets where id = 'tripp-media' and not public and file_size_limit = 26215424), 'bucket';

	-- media_reserve.
	r := tripp.media_reserve('bad', convA, 'file', 1000);
	assert (r ->> 'error') = 'expired', 'reserve expired';
	r := tripp.media_reserve(gA, null, 'exe', 1000);
	assert (r ->> 'error') = 'bad_kind', 'reserve bad_kind';
	r := tripp.media_reserve(gA, null, 'file', 26214401);
	assert (r ->> 'error') = 'too_large', 'reserve too_large';
	r := tripp.media_reserve(gA, null, 'file', 0);
	assert (r ->> 'error') = 'too_large', 'reserve zero bytes';
	r := tripp.media_reserve(adm, -1, 'file', 1000);
	assert (r ->> 'error') = 'no_conversation', 'reserve no_conversation';
	r := tripp.media_reserve(adm, convC, 'file', 1000);
	assert (r ->> 'error') = 'no_keys', 'reserve no_keys';
	r := tripp.media_reserve(gA, convB, 'file', 1000);
	assert (r ->> 'ok') = 'true' and (r ->> 'path') like ('conversation/' || convA || '/%'), 'guest reserves in own conversation';
	pth := r ->> 'path';
	r := tripp.media_reserve(adm, convB, 'audio', 1000);
	assert (r ->> 'ok') = 'true' and (r ->> 'path') like ('conversation/' || convB || '/%'), 'admin reserves in named conversation';
	pthB := r ->> 'path';
	assert exists (select 1 from tripp.uploads where path = pth and conversation_id = convA), 'reservation row';

	-- Old reservations are cleared.
	insert into tripp.uploads (path, conversation_id, kind, bytes, created_at)
	values ('conversation/' || convA || '/stale', convA, 'file', 1, now() - interval '2 days');
	r := tripp.media_reserve(gA, null, 'file', 1000);
	assert not exists (select 1 from tripp.uploads where path = 'conversation/' || convA || '/stale'), 'stale reservation removed';
	pth2 := r ->> 'path';

	att := jsonb_build_array(jsonb_build_object('path', pth, 'kind', 'file', 'mime', 'text/plain',
		'bytes', 1000, 'name_enc', 'ne', 'nonce', 'nn', 'chunk_size', 1048576));

	-- missing_upload: reserved, nothing uploaded.
	r := public.m_post(gA, '', null, att);
	assert (r ->> 'error') = 'missing_upload', 'missing_upload';

	-- size_mismatch.
	insert into storage.objects (bucket_id, name, metadata)
	values ('tripp-media', pth, jsonb_build_object('size', 999));
	r := public.m_post(gA, '', null, att);
	assert (r ->> 'error') = 'size_mismatch', 'size_mismatch';
	update storage.objects set metadata = jsonb_build_object('size', tripp.cipher_size(1000))
	 where bucket_id = 'tripp-media' and name = pth;

	-- foreign_path: reservation for A posted from B; and an unknown path.
	r := public.m_post(gB, 'x', null, att);
	assert (r ->> 'error') = 'foreign_path', 'foreign_path';
	r := public.m_post(gB, 'x', null, jsonb_build_array(att -> 0 || '{"path":"conversation/0/nope"}'));
	assert (r ->> 'error') = 'foreign_path', 'unknown path';
	assert not exists (select 1 from tripp.messages where conversation_id = convB), 'failed posts write nothing';

	-- bad_attachment: shapes, limits.
	r := public.m_post(gA, 'x', null, '{"a":1}'::jsonb);
	assert (r ->> 'error') = 'bad_attachment', 'not an array';
	r := public.m_post(gA, 'x', null, jsonb_build_array(att -> 0 || '{"kind":"zip"}'));
	assert (r ->> 'error') = 'bad_attachment', 'bad kind';
	r := public.m_post(gA, 'x', null, jsonb_build_array(att -> 0 || '{"bytes":26214401}'));
	assert (r ->> 'error') = 'bad_attachment', 'too many bytes';
	r := public.m_post(gA, 'x', null, jsonb_build_array((att -> 0) - 'nonce'));
	assert (r ->> 'error') = 'bad_attachment', 'missing field';
	r := public.m_post(gA, 'x', null, (select jsonb_agg(att -> 0) from generate_series(1, 11)));
	assert (r ->> 'error') = 'bad_attachment', 'eleven attachments';
	r := public.m_post(gA, 'x', null, jsonb_build_array(att -> 0, att -> 0));
	assert (r ->> 'error') = 'bad_attachment', 'same path twice';

	-- empty: no body, no attachments.
	r := public.m_post(gA, '', null, '[]'::jsonb);
	assert (r ->> 'error') = 'empty', 'empty';
	r := public.m_post(gA, '   ', null);
	assert (r ->> 'error') = 'empty', 'empty default arg';

	-- Happy path, with a hidden-message check afterwards.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_post(gA, '', null, jsonb_build_array(att -> 0 || '{"duration_ms":1500}'));
	assert (r ->> 'ok') = 'true', 'attachment-only post ok';
	select id into mid from tripp.messages where conversation_id = convA;
	select id into aid from tripp.attachments where message_id = mid;
	assert aid is not null, 'attachment stored';
	assert not exists (select 1 from tripp.uploads where path = pth), 'reservation deleted';
	assert (select count(*) from tripp.events where id > ev0 and type = 'message'
	         and ref_id = mid and (detail ->> 'attachments')::int = 1 and detail ->> 'author' = 'guest') = 1, 'message event';
	assert (select count(*) from tripp.events where id > ev0 and type = 'upload' and ref_id = aid
	         and detail ->> 'kind' = 'file' and detail ->> 'mime' = 'text/plain'
	         and (detail ->> 'bytes')::bigint = 1000) = 1, 'upload event';

	-- Already attached: the path is spent.
	r := public.m_post(gA, 'again', null, att);
	assert (r ->> 'error') in ('bad_attachment', 'foreign_path'), 'cannot attach twice';

	-- m_list shows the attachment under its message, for both sides.
	lst := public.m_list(gA);
	assert json_array_length(lst -> 'messages') = 1, 'guest list one message';
	assert (lst -> 'messages' -> 0 -> 'attachments' -> 0 ->> 'id')::bigint = aid
	   and (lst -> 'messages' -> 0 -> 'attachments' -> 0 ->> 'bytes') = '1000'
	   and (lst -> 'messages' -> 0 -> 'attachments' -> 0 ->> 'name_enc') = 'ne'
	   and (lst -> 'messages' -> 0 -> 'attachments' -> 0 ->> 'duration_ms') = '1500'
	   and (lst -> 'messages' -> 0 -> 'attachments' -> 0 ->> 'chunk_size') = '1048576', 'guest sees attachment';
	assert (lst -> 'messages' -> 0 -> 'attachments' -> 0 ->> 'path') is null, 'path not exposed';
	lst := public.m_list(adm, convA);
	assert json_array_length(lst -> 'messages' -> 0 -> 'attachments') = 1, 'admin sees attachment';

	-- Posting with text and no attachment still lists an empty array.
	r := public.m_post(gA, 'plain', null);
	assert (r ->> 'ok') = 'true', 'plain post';
	lst := public.m_list(gA);
	assert json_array_length(lst -> 'messages' -> 1 -> 'attachments') = 0, 'empty attachments array';

	-- media_readable.
	r := tripp.media_readable('bad', aid);
	assert (r ->> 'error') = 'expired', 'readable expired';
	r := tripp.media_readable(gA, aid);
	assert (r ->> 'ok') = 'true' and (r ->> 'path') = pth, 'guest reads own';
	r := tripp.media_readable(gB, aid);
	assert (r ->> 'error') = 'no_attachment', 'other conversation denied';
	r := tripp.media_readable(adm, aid);
	assert (r ->> 'ok') = 'true', 'admin reads';
	r := tripp.media_readable(adm, -1);
	assert (r ->> 'error') = 'no_attachment', 'missing attachment';

	-- Hidden: the guest's list omits the attachment and cannot read it.
	r := public.m_msg(adm, mid, 'hide');
	assert (r ->> 'ok') = 'true', 'hide ok';
	lst := public.m_list(gA);
	assert json_array_length(lst -> 'messages') = 1 and not (lst::text like '%name_enc%'), 'guest list omits hidden attachments';
	r := tripp.media_readable(gA, aid);
	assert (r ->> 'error') = 'no_attachment', 'hidden: guest denied';
	r := tripp.media_readable(adm, aid);
	assert (r ->> 'ok') = 'true', 'hidden: admin reads';
	lst := public.m_list(adm, convA);
	assert json_array_length(lst -> 'messages' -> 0 -> 'attachments') = 1, 'admin list keeps hidden attachments';
	r := public.m_msg(adm, mid, 'unhide');
	r := public.m_msg(adm, mid, 'archive');
	r := tripp.media_readable(gA, aid);
	assert (r ->> 'error') = 'no_attachment', 'archived: guest denied';
	r := public.m_msg(adm, mid, 'unarchive');

	-- Trash queue: deleting the message queues its path.
	assert not exists (select 1 from tripp.storage_trash where path = pth), 'not queued before delete';
	r := public.m_msg(adm, mid, 'delete');
	assert exists (select 1 from tripp.storage_trash where path = pth), 'message delete queues path';
	assert not exists (select 1 from tripp.attachments where id = aid), 'attachment cascaded';

	-- Cascade from conversation delete (conversation B gets one attachment).
	insert into storage.objects (bucket_id, name, metadata)
	values ('tripp-media', pthB, jsonb_build_object('size', tripp.cipher_size(500)));
	r := public.m_post(adm, 'b', convB, jsonb_build_array(jsonb_build_object('path', pthB, 'kind', 'audio',
		'mime', 'audio/webm', 'bytes', 500, 'name_enc', 'ne', 'nonce', 'nn', 'chunk_size', 1048576)));
	assert (r ->> 'ok') = 'true', 'admin post with attachment';
	delete from tripp.conversations where id = convB;
	assert exists (select 1 from tripp.storage_trash where path = pthB), 'conversation delete queues path';

	-- media_trash_take / media_trash_done.
	select count(*) into n from tripp.media_trash_take(100) t where t in (pth, pthB);
	assert n = 2, 'trash_take returns queued paths';
	assert (select count(*) from tripp.media_trash_take(1)) = 1, 'trash_take honours limit';
	assert (select count(*) from tripp.media_trash_take(1)) = 1 and exists (select 1 from tripp.storage_trash where path = pth), 'take does not remove';
	perform tripp.media_trash_done(array[pth, pthB]);
	assert not exists (select 1 from tripp.storage_trash where path in (pth, pthB)), 'trash_done removes';
	perform tripp.media_trash_done(null);

	-- Lock-down: the internal functions are not callable by the API roles.
	assert not has_function_privilege('anon', 'tripp.media_reserve(text,bigint,text,bigint)', 'execute'), 'anon reserve';
	assert not has_function_privilege('authenticated', 'tripp.media_readable(text,bigint)', 'execute'), 'authenticated readable';
	assert not has_function_privilege('anon', 'tripp.media_trash_take(int)', 'execute'), 'anon trash_take';
	assert not has_function_privilege('anon', 'tripp.media_trash_done(text[])', 'execute'), 'anon trash_done';
	assert not has_function_privilege('anon', 'tripp.cipher_size(bigint)', 'execute'), 'anon cipher_size';
	assert has_function_privilege('anon', 'public.m_post(text,text,bigint,jsonb)', 'execute'), 'anon m_post';
	assert not exists (select 1 from pg_policies where schemaname in ('tripp') and tablename in ('attachments', 'uploads', 'storage_trash')), 'no policies';
	assert (select bool_and(relrowsecurity) from pg_class where oid in
	        ('tripp.attachments'::regclass, 'tripp.uploads'::regclass, 'tripp.storage_trash'::regclass)), 'RLS on';
end $$;
