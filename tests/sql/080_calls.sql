-- Call metadata on the audit record.
do $$
declare
	g text := 't-guest-' || md5(random()::text);
	g2 text := 't-guest2-' || md5(random()::text);
	conv bigint; conv2 bigint;
	adm text; gst text;
	r json;
	c1 uuid := gen_random_uuid();
	c2 uuid := gen_random_uuid();
	c3 uuid := gen_random_uuid();
	e tripp.events;
	n0 bigint; n1 bigint;
	m realtime.messages;
begin
	insert into tripp.conversations (label, hash)
	values ('t-conv', extensions.crypt(g, extensions.gen_salt('bf', 4))) returning id into conv;
	insert into tripp.conversations (label, hash)
	values ('t-conv2', extensions.crypt(g2, extensions.gen_salt('bf', 4))) returning id into conv2;
	delete from tripp.attempts where ip = '198.51.100.9';
	adm := 't-admin-token-' || md5(random()::text);
	insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash(adm), null);
	gst := tripp.open_session(g, '198.51.100.9', 'UA', 'Mac', 'Safari', '{}') ->> 'token';

	-- Guest start, with an alert.
	select count(*) into n0 from realtime.messages;
	r := public.m_call(gst, null, c1, 'start', '{"kind":"video"}');
	assert (r ->> 'ok') = 'true', 'guest start ok';
	select * into e from tripp.events where id = (r ->> 'event')::bigint;
	assert e.type = 'call_start' and e.scope = conv and e.ref_id is null, 'guest start event';
	assert e.detail ->> 'call' = c1::text and e.detail ->> 'kind' = 'video'
		and (e.detail ->> 'conversation')::bigint = conv, 'guest start detail';
	select count(*) into n1 from realtime.messages;
	assert n1 = n0 + 1, 'one alert for guest call_start';
	select * into m from realtime.messages order by inserted_at desc, id desc limit 1;
	assert m.topic = 'admin' and m.payload ->> 'type' = 'call_start', 'alert is call_start';

	-- Own conversation id is fine; another is forbidden.
	r := public.m_call(gst, conv, c1, 'answer', '{}');
	assert (r ->> 'ok') = 'true', 'guest may name own conversation';
	r := public.m_call(gst, conv2, c1, 'start', '{"kind":"audio"}');
	assert (r ->> 'error') = 'forbidden', 'guest other conversation forbidden';

	-- Admin.
	r := public.m_call(adm, null, c2, 'start', '{"kind":"audio"}');
	assert (r ->> 'error') = 'bad_conversation', 'admin needs a conversation';
	r := public.m_call(adm, -5, c2, 'start', '{"kind":"audio"}');
	assert (r ->> 'error') = 'bad_conversation', 'admin unknown conversation';
	r := public.m_call(adm, conv, c2, 'start', '{"kind":"audio"}');
	assert (r ->> 'ok') = 'true', 'admin start ok';
	select * into e from tripp.events where id = (r ->> 'event')::bigint;
	assert e.scope = 0 and (e.detail ->> 'conversation')::bigint = conv, 'admin scope 0 with conversation';

	-- Answer then end.
	r := public.m_call(adm, conv, c2, 'answer');
	assert (r ->> 'ok') = 'true', 'answer ok';
	select * into e from tripp.events where id = (r ->> 'event')::bigint;
	assert e.type = 'call_answer', 'answer event type';
	r := public.m_call(adm, conv, c2, 'end', '{"reason":"hangup","relay":"host"}');
	assert (r ->> 'ok') = 'true', 'end ok';
	select * into e from tripp.events where id = (r ->> 'event')::bigint;
	assert e.type = 'call_end' and e.detail ->> 'reason' = 'hangup' and e.detail ->> 'relay' = 'host', 'end detail';
	assert (e.detail ->> 'duration_s')::bigint >= 0, 'duration_s >= 0';
	-- Both parties may end; both rows stay.
	r := public.m_call(gst, null, c1, 'end', '{"reason":"hangup","relay":"relay"}');
	assert (r ->> 'ok') = 'true', 'guest end ok';
	assert (select count(*) from tripp.events where type = 'call_end' and detail ->> 'call' = c1::text) = 1, 'one end for c1';
	r := public.m_call(adm, conv, c1, 'end', '{"reason":"hangup","relay":"relay"}');
	assert (select count(*) from tripp.events where type = 'call_end' and detail ->> 'call' = c1::text) = 2, 'both ends kept';

	-- End without an answer.
	r := public.m_call(gst, null, c3, 'end', '{"reason":"missed","relay":"unknown"}');
	select * into e from tripp.events where id = (r ->> 'event')::bigint;
	assert e.detail -> 'duration_s' is null or jsonb_typeof(e.detail -> 'duration_s') = 'null', 'no answer gives null duration';
	assert not (e.detail ? 'duration_s') or e.detail -> 'duration_s' = 'null'::jsonb, 'duration_s null';

	-- Bad input.
	r := public.m_call(gst, null, c3, 'end', '{"reason":"nope","relay":"host"}');
	assert (r ->> 'error') = 'bad_input', 'bad reason';
	r := public.m_call(gst, null, c3, 'end', '{"reason":"hangup","relay":"nope"}');
	assert (r ->> 'error') = 'bad_input', 'bad relay';
	r := public.m_call(gst, null, c3, 'end', '{}');
	assert (r ->> 'error') = 'bad_input', 'end without detail';
	r := public.m_call(gst, null, c3, 'start', '{"kind":"text"}');
	assert (r ->> 'error') = 'bad_input', 'bad kind';
	r := public.m_call(gst, null, c3, 'start', '{}');
	assert (r ->> 'error') = 'bad_input', 'missing kind';
	r := public.m_call(gst, null, c3, 'ring', '{}');
	assert (r ->> 'error') = 'bad_input', 'unknown action';
	r := public.m_call(gst, null, c3, null, '{}');
	assert (r ->> 'error') = 'bad_input', 'null action';
	r := public.m_call(gst, null, null, 'answer', '{}');
	assert (r ->> 'error') = 'bad_input', 'null call';

	-- Expired.
	r := public.m_call('nope', null, c3, 'answer', '{}');
	assert (r ->> 'error') = 'expired', 'expired token';

	-- Grants.
	assert has_function_privilege('anon', 'public.m_call(text,bigint,uuid,text,jsonb)', 'execute'), 'anon can call';
	assert has_function_privilege('authenticated', 'public.m_call(text,bigint,uuid,text,jsonb)', 'execute'), 'authenticated can call';

	delete from tripp.sessions where token_hash in (tripp.token_hash(adm));
end $$;
