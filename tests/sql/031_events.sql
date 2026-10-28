-- Every m_* action writes exactly one audit event.
do $$
declare
	g text := 't-guest-' || md5(random()::text);
	g2 text := 't-guest2-' || md5(random()::text);
	conv bigint; conv2 bigint;
	adm text; gst text;
	r json;
	ev0 bigint;
	mid bigint; mid2 bigint;
	e tripp.events;
	vid bigint;
	a text; t text;
	pairs text[][] := array[
		['hide', 'admin_hide'], ['unhide', 'admin_unhide'],
		['archive', 'admin_archive'], ['unarchive', 'admin_unarchive']];
begin
	insert into tripp.admin_key (id, hash) values (1, extensions.crypt('t-admin', extensions.gen_salt('bf', 4)))
	on conflict (id) do update set hash = excluded.hash;
	insert into tripp.conversations (label, hash)
	values ('t-conv', extensions.crypt(g, extensions.gen_salt('bf', 4))) returning id into conv;
	delete from tripp.attempts where ip = '198.51.100.9';
	adm := tripp.open_session('t-admin', '198.51.100.9', 'UA', 'Windows', 'Edge', '{}') ->> 'token';
	gst := tripp.open_session(g, '198.51.100.9', 'UA', 'Mac', 'Safari', '{}') ->> 'token';
	vid := tripp.token_visit(adm);

	-- m_post: guest and admin.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_post(gst, '  hello  ');
	assert (r ->> 'ok') = 'true', 'guest post ok';
	select * into e from tripp.events where id > ev0;
	assert (select count(*) from tripp.events where id > ev0) = 1, 'one event for guest post';
	assert e.type = 'message' and e.scope = conv and e.detail ->> 'author' = 'guest'
		and (e.detail ->> 'length')::int = 5, 'guest message event';
	mid := e.ref_id;
	assert exists (select 1 from tripp.messages where id = mid and conversation_id = conv), 'ref_id is message id';
	assert e.visit_id = tripp.token_visit(gst), 'event has visit id';

	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_post(adm, 'owner says', conv);
	select * into e from tripp.events where id > ev0;
	assert e.type = 'message' and e.scope = 0 and e.detail ->> 'author' = 'owner' and e.visit_id = vid, 'admin message event';
	mid2 := e.ref_id;

	-- Failed post logs nothing.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_post(adm, '   ', conv);
	assert (r ->> 'error') = 'empty', 'empty post';
	r := public.m_post('bad-token', 'x');
	assert (r ->> 'error') = 'expired', 'expired post';
	assert (select count(*) from tripp.events where id > ev0) = 0, 'failed posts log nothing';

	-- m_msg actions.
	for i in 1..4 loop
		a := pairs[i][1]; t := pairs[i][2];
		select coalesce(max(id), 0) into ev0 from tripp.events;
		r := public.m_msg(adm, mid, a);
		assert (r ->> 'ok') = 'true', a || ' ok';
		select * into e from tripp.events where id > ev0;
		assert (select count(*) from tripp.events where id > ev0) = 1, a || ' one event';
		assert e.type = t and e.ref_id = mid and e.scope = 0 and e.visit_id = vid, a || ' event fields';
	end loop;
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_msg(adm, mid, 'frobnicate');
	assert (r ->> 'error') = 'bad_action', 'bad_action';
	r := public.m_msg(adm, -1, 'hide');
	assert (r ->> 'error') = 'no_message', 'no_message';
	r := public.m_msg(gst, mid, 'hide');
	assert (r ->> 'error') = 'forbidden', 'guest forbidden';
	assert (select count(*) from tripp.events where id > ev0) = 0, 'failed m_msg logs nothing';
	r := public.m_msg(adm, mid2, 'delete');
	assert (r ->> 'ok') = 'true', 'delete ok';
	select * into e from tripp.events where id > ev0;
	assert (select count(*) from tripp.events where id > ev0) = 1, 'delete one event';
	assert e.type = 'admin_delete' and e.ref_id = mid2, 'admin_delete event';

	-- m_conv_save: create then change.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_conv_save(adm, null, 'second', g2);
	assert (r ->> 'ok') = 'true', 'create ok';
	conv2 := (r ->> 'id')::bigint;
	select * into e from tripp.events where id > ev0;
	assert (select count(*) from tripp.events where id > ev0) = 1, 'create one event';
	assert e.type = 'admin_conv_save' and e.ref_id = conv2 and e.scope = 0
		and (e.detail ->> 'created') = 'true' and (e.detail ->> 'label_changed') = 'true'
		and (e.detail ->> 'password_changed') = 'true', 'create event detail';

	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_conv_save(adm, conv2, 'renamed', null);
	select * into e from tripp.events where id > ev0;
	assert (select count(*) from tripp.events where id > ev0) = 1, 'change one event';
	assert e.type = 'admin_conv_save' and e.ref_id = conv2 and (e.detail ->> 'created') = 'false'
		and (e.detail ->> 'label_changed') = 'true' and (e.detail ->> 'password_changed') = 'false',
		'change event detail';
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_conv_save(adm, conv2, '', g);
	assert (r ->> 'error') = 'password_taken', 'password_taken';
	r := public.m_conv_save(adm, -1, 'x', null);
	assert (r ->> 'error') = 'no_conversation', 'conv_save no_conversation';
	assert (select count(*) from tripp.events where id > ev0) = 0, 'failed conv_save logs nothing';

	-- m_conv_delete: counts messages first.
	r := public.m_post(adm, 'one', conv2);
	r := public.m_post(adm, 'two', conv2);
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_conv_delete(adm, conv2);
	assert (r ->> 'ok') = 'true', 'conv delete ok';
	select * into e from tripp.events where id > ev0;
	assert (select count(*) from tripp.events where id > ev0) = 1, 'conv delete one event';
	assert e.type = 'admin_conv_delete' and e.ref_id = conv2 and (e.detail ->> 'messages')::int = 2,
		'conv delete detail';
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_conv_delete(adm, conv2);
	assert (r ->> 'error') = 'no_conversation', 'second delete';
	assert (select count(*) from tripp.events where id > ev0) = 0, 'failed conv delete logs nothing';

	-- m_admin_key.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_admin_key(adm, 't-admin-new-' || md5(random()::text));
	assert (r ->> 'ok') = 'true', 'admin key ok';
	select * into e from tripp.events where id > ev0;
	assert (select count(*) from tripp.events where id > ev0) = 1, 'admin key one event';
	assert e.type = 'admin_key_change' and e.ref_id is null and e.scope = 0, 'admin key event';
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_admin_key(adm, '');
	assert (r ->> 'error') = 'empty_key', 'empty key';
	assert (select count(*) from tripp.events where id > ev0) = 0, 'failed admin key logs nothing';

	-- m_close.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := public.m_close('unknown-token');
	assert (r ->> 'ok') = 'true', 'close unknown ok';
	assert (select count(*) from tripp.events where id > ev0) = 0, 'close unknown adds nothing';
	vid := tripp.token_visit(gst);
	r := public.m_close(gst);
	select * into e from tripp.events where id > ev0;
	assert (select count(*) from tripp.events where id > ev0) = 1, 'close one event';
	assert e.type = 'logout' and e.scope = conv and e.visit_id = vid and e.ref_id is null, 'logout event';

	-- m_audit.
	gst := tripp.open_session(g, '198.51.100.9', 'UA', 'Mac', 'Safari', '{}') ->> 'token';
	r := public.m_audit(gst, 'events');
	assert (r ->> 'error') = 'forbidden', 'guest audit forbidden';
	r := public.m_audit('bad', 'events');
	assert (r ->> 'error') = 'expired', 'audit expired';
	r := public.m_audit(adm, 'nope');
	assert (r ->> 'ok') = 'false', 'bad kind';
	r := public.m_audit(adm, 'events', null, 5);
	assert (r ->> 'ok') = 'true' and json_array_length(r -> 'rows') = 5, 'five events';
	assert (r -> 'verified' ->> 'ok') = 'true', 'verified present and ok';
	assert (r -> 'rows' -> 0 ->> 'type') is not null, 'event row has type';
	assert (r -> 'rows' -> 0 ->> 'id')::bigint = (select max(id) from tripp.events), 'newest first';
	r := public.m_audit(adm, 'events', (select max(id) from tripp.events), 1000);
	assert json_array_length(r -> 'rows') <= 200, 'capped at 200';
	assert (r -> 'verified') is null, 'no verified when paging';
	r := public.m_audit(adm, 'visits', null, 3);
	assert json_array_length(r -> 'rows') = 3 and (r -> 'rows' -> 0 ->> 'outcome') is not null, 'visits rows';
	assert (r -> 'rows' -> 0 -> 'row_hash') is null and (r -> 'rows' -> 0 -> 'prev_hash') is null, 'no hashes';

	assert (tripp.verify_chain('events') ->> 'ok') = 'true', 'events chain ok';
	assert (tripp.verify_chain('visits') ->> 'ok') = 'true', 'visits chain ok';
end $$;
