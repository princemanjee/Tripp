-- Live bindings, channel authorization and admin alerts.
do $$
declare
	g text := 't-guest-' || md5(random()::text);
	g2 text := 't-guest2-' || md5(random()::text);
	conv bigint; conv2 bigint;
	adm text; gst text;
	u1 uuid := gen_random_uuid();
	u2 uuid := gen_random_uuid();
	r json;
	n0 bigint; n1 bigint;
	ls1 timestamptz; ls2 timestamptz;
	m realtime.messages;
	maxid bigint;
	id1 bigint;
begin
	insert into tripp.admin_key (id, hash) values (1, extensions.crypt('t-admin', extensions.gen_salt('bf', 4)))
	on conflict (id) do update set hash = excluded.hash;
	insert into tripp.conversations (label, hash)
	values ('t-conv', extensions.crypt(g, extensions.gen_salt('bf', 4))) returning id into conv;
	insert into tripp.conversations (label, hash)
	values ('t-conv2', extensions.crypt(g2, extensions.gen_salt('bf', 4))) returning id into conv2;
	delete from tripp.attempts where ip = '198.51.100.9';
	adm := tripp.open_session('t-admin', '198.51.100.9', 'UA', 'Windows', 'Edge', '{}') ->> 'token';
	gst := tripp.open_session(g, '198.51.100.9', 'UA', 'Mac', 'Safari', '{}') ->> 'token';

	-- No user.
	perform set_config('request.jwt.claims', '{}', true);
	r := public.m_live_bind(gst);
	assert (r ->> 'error') = 'no_user', 'no sub gives no_user';

	-- Bad token.
	perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
	r := public.m_live_bind('nope');
	assert (r ->> 'error') = 'expired', 'bad token gives expired';
	assert not exists (select 1 from tripp.live_bindings where uid = u1), 'no binding for bad token';

	-- Before binding: denied.
	set local role authenticated;
	assert not tripp_live.live_topic_ok('conv:' || conv), 'denied before binding';
	reset role;

	-- Guest binds.
	r := public.m_live_bind(gst);
	assert (r ->> 'ok') = 'true' and (r ->> 'scope')::bigint = conv, 'guest binds to its conversation';
	set local role authenticated;
	assert tripp_live.live_scope() = conv, 'live_scope is the conversation';
	assert tripp_live.live_topic_ok('conv:' || conv), 'own conversation allowed';
	assert not tripp_live.live_topic_ok('conv:' || conv2), 'other conversation denied';
	assert not tripp_live.live_topic_ok('admin'), 'admin topic denied to guest';
	assert not tripp_live.live_topic_ok('conv:abc'), 'conv:abc denied';
	assert not tripp_live.live_topic_ok('conv:'), 'conv: denied';
	assert not tripp_live.live_topic_ok('conv:1:2'), 'conv:1:2 denied';
	assert not tripp_live.live_topic_ok(null), 'null topic denied';
	reset role;

	-- Rebinding the same uid upserts.
	r := public.m_live_bind(gst);
	assert (select count(*) from tripp.live_bindings where uid = u1) = 1, 'upsert on uid';

	-- Admin binds.
	perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
	r := public.m_live_bind(adm);
	assert (r ->> 'ok') = 'true' and (r ->> 'scope')::bigint = 0, 'admin binds to scope 0';
	select max(id) into maxid from tripp.conversations;
	set local role authenticated;
	assert tripp_live.live_topic_ok('admin'), 'admin topic allowed';
	assert tripp_live.live_topic_ok('conv:' || conv), 'admin sees existing conversation';
	assert not tripp_live.live_topic_ok('conv:' || (maxid + 1000)), 'admin denied unknown conversation';
	reset role;

	-- Stale session; live_scope does not touch last_seen.
	perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
	update tripp.sessions set last_seen = now() - interval '10 minutes' where token_hash = tripp.token_hash(gst);
	select last_seen into ls1 from tripp.sessions where token_hash = tripp.token_hash(gst);
	set local role authenticated;
	assert tripp_live.live_scope() = conv, 'fresh enough';
	reset role;
	select last_seen into ls2 from tripp.sessions where token_hash = tripp.token_hash(gst);
	assert ls1 = ls2, 'live_scope leaves last_seen alone';
	update tripp.sessions set last_seen = now() - interval '31 minutes' where token_hash = tripp.token_hash(gst);
	set local role authenticated;
	assert tripp_live.live_scope() is null, 'stale session gives null scope';
	assert not tripp_live.live_topic_ok('conv:' || conv), 'stale session denied';
	reset role;

	-- Deleting the session removes the binding.
	delete from tripp.sessions where token_hash = tripp.token_hash(gst);
	assert not exists (select 1 from tripp.live_bindings where uid = u1), 'binding cascades';

	-- Alerts.
	select count(*) into n0 from realtime.messages;
	id1 := tripp.log_event('message', conv, null, null, '{}'::jsonb);
	select count(*) into n1 from realtime.messages;
	assert n1 = n0 + 1, 'one alert for a guest message';
	select * into m from realtime.messages order by inserted_at desc, id desc limit 1;
	assert m.topic = 'admin' and m.event = 'event' and m.private, 'alert goes to the private admin topic';
	assert m.payload ->> 'type' = 'message' and (m.payload ->> 'conversation')::bigint = conv, 'alert payload';
	assert (m.payload ->> 'id')::bigint = id1, 'alert carries the event id';

	select count(*) into n0 from realtime.messages;
	perform tripp.log_event('message', 0, null, null, '{}'::jsonb);
	select count(*) into n1 from realtime.messages;
	assert n1 = n0, 'no alert for admin scope';
	perform tripp.log_event('logout', conv, null, null, '{}'::jsonb);
	select count(*) into n1 from realtime.messages;
	assert n1 = n0, 'no alert for other types';

	-- Audit seen marker.
	gst := tripp.open_session(g, '198.51.100.9', 'UA', 'Mac', 'Safari', '{}') ->> 'token';
	r := public.m_audit_seen(gst, 5);
	assert (r ->> 'error') = 'forbidden', 'guest cannot mark seen';
	r := public.m_audit_seen('nope', 5);
	assert (r ->> 'error') = 'expired', 'bad token expired';
	update tripp.settings set audit_seen = null where id = 1;
	r := public.m_audit_seen(adm, 5);
	assert (r ->> 'ok') = 'true', 'admin marks seen';
	r := public.m_audit_seen(adm, 3);
	assert (select audit_seen from tripp.settings where id = 1) = 5, 'audit_seen only moves forward';
	r := public.m_audit(adm, 'events', null, 1);
	assert (r ->> 'seen')::bigint = 5, 'm_audit returns seen on first page';
	r := public.m_audit(adm, 'events', 999999999, 1);
	assert (r -> 'seen') is null, 'm_audit omits seen on later pages';

	-- Grants and RLS.
	assert has_function_privilege('authenticated', 'public.m_live_bind(text)', 'execute'), 'authenticated can bind';
	assert not has_function_privilege('anon', 'public.m_live_bind(text)', 'execute'), 'anon cannot bind';
	assert not has_function_privilege('authenticated', 'tripp.live_alert(bigint,text,bigint,timestamptz)', 'execute'), 'alert is internal';
	assert not has_function_privilege('authenticated', 'tripp.live_cleanup()', 'execute'), 'cleanup is internal';
	assert has_function_privilege('authenticated', 'tripp_live.live_scope()', 'execute'), 'authenticated has live_scope';
	assert not has_function_privilege('anon', 'tripp_live.live_topic_ok(text)', 'execute'), 'anon has no live_topic_ok';
	assert (select relrowsecurity from pg_class where oid = 'tripp.live_bindings'::regclass), 'bindings has RLS';
	assert (select count(*) from cron.job where jobname = 'tripp-live-cleanup' and schedule = '45 8 * * *') = 1, 'cleanup scheduled';
	assert (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages'
		and policyname in ('tripp_live_read', 'tripp_live_write')) = 2, 'both policies exist';
end $$;

-- Cleanup deletes only old anonymous users.
do $$
declare
	ua uuid := gen_random_uuid();
	ub uuid := gen_random_uuid();
	uc uuid := gen_random_uuid();
begin
	insert into auth.users (id, aud, role, is_anonymous, created_at)
	values (ua, 'authenticated', 'authenticated', true, now() - interval '14 hours'),
	       (ub, 'authenticated', 'authenticated', true, now() - interval '1 hour'),
	       (uc, 'authenticated', 'authenticated', false, now() - interval '14 hours');
	perform tripp.live_cleanup();
	assert not exists (select 1 from auth.users where id = ua), 'old anonymous user deleted';
	assert exists (select 1 from auth.users where id = ub), 'recent anonymous user kept';
	assert exists (select 1 from auth.users where id = uc), 'non-anonymous user kept';
end $$;
