-- open_session: sign-in, lockout, and the audit rows each outcome writes.
do $$
declare
	g text := 't-guest-' || md5(random()::text);
	conv bigint;
	r json;
	ev0 bigint; vis0 bigint;
	v_ip text := '198.51.100.7';
	l_ip text := '198.51.100.8';
	v tripp.visits;
	types text[];
	n int;
begin
	insert into tripp.admin_key (id, hash) values (1, extensions.crypt('t-admin', extensions.gen_salt('bf', 4)))
	on conflict (id) do update set hash = excluded.hash;
	insert into tripp.conversations (label, hash)
	values ('t-conv', extensions.crypt(g, extensions.gen_salt('bf', 4))) returning id into conv;
	delete from tripp.attempts where attempts.ip in (v_ip, l_ip);

	assert to_regprocedure('public.m_open(text)') is null, 'm_open is gone';

	-- Admin success.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	select coalesce(max(id), 0) into vis0 from tripp.visits;
	r := tripp.open_session('t-admin', v_ip, 'UA', 'Windows', 'Edge', '{}');
	assert (r ->> 'ok') = 'true' and (r ->> 'role') = 'admin', 'admin ok: ' || r::text;
	assert (r ->> 'token') is not null, 'token returned';
	select * into v from tripp.visits where id > vis0 order by id desc limit 1;
	assert v.outcome = 'ok' and v.scope = 0 and v.isp = 'unknown' and v.ip = v_ip, 'admin visit row';
	assert (select count(*) from tripp.visits where id > vis0) = 1, 'one visit';
	select array_agg(type order by id) into types from tripp.events where id > ev0;
	assert types = array['login'], 'login only, got ' || coalesce(types::text, 'none');
	assert (select s.visit_id from tripp.sessions s where s.token_hash = tripp.token_hash(r ->> 'token')) = v.id,
		'session stores visit_id';
	assert tripp.token_visit(r ->> 'token') = v.id, 'token_visit returns visit';
	assert tripp.token_visit('nope') is null, 'token_visit unknown is null';

	-- Guest success carries watermark.
	r := tripp.open_session(g, v_ip, 'UA', 'Mac', 'Safari', '{"isp":"X"}');
	assert (r ->> 'role') = 'guest', 'guest ok';
	assert (r -> 'watermark' ->> 'conversation')::bigint = conv, 'watermark conversation';
	assert (r -> 'watermark' ->> 'ip') = v_ip, 'watermark ip';
	select * into v from tripp.visits order by id desc limit 1;
	assert v.outcome = 'ok' and v.scope = conv and v.isp = 'X', 'guest visit row';

	-- Denied.
	select coalesce(max(id), 0) into ev0 from tripp.events;
	select coalesce(max(id), 0) into vis0 from tripp.visits;
	r := tripp.open_session('wrong', v_ip, 'UA', 'Windows', 'Edge', '{}');
	assert (r ->> 'error') = 'denied', 'denied';
	select * into v from tripp.visits where id > vis0 order by id desc limit 1;
	assert v.outcome = 'denied' and v.scope is null, 'denied visit';
	assert (select count(*) from tripp.events where id > ev0 and type = 'login_failed'
	         and detail ->> 'reason' = 'denied' and visit_id = v.id) = 1, 'login_failed denied event';

	-- Lockout: 8 wrong tries, then the 9th is locked.
	for n in 1..8 loop
		r := tripp.open_session('wrong', l_ip, 'UA', 'Windows', 'Edge', '{}');
		assert (r ->> 'error') = 'denied', 'try ' || n || ' denied';
	end loop;
	select coalesce(max(id), 0) into ev0 from tripp.events;
	r := tripp.open_session('wrong', l_ip, 'UA', 'Windows', 'Edge', '{}');
	assert (r ->> 'error') = 'locked', 'ninth is locked';
	select * into v from tripp.visits order by id desc limit 1;
	assert v.outcome = 'locked' and v.scope is null and v.ip = l_ip, 'locked visit';
	assert (select count(*) from tripp.events where id > ev0 and type = 'login_failed'
	         and detail ->> 'reason' = 'locked') = 1, 'login_failed locked event';
	-- Even the right password is locked out.
	r := tripp.open_session('t-admin', l_ip, 'UA', 'Windows', 'Edge', '{}');
	assert (r ->> 'error') = 'locked', 'right password still locked';

	-- The old 7-argument form (with a notice version) is gone.
	assert to_regprocedure('tripp.open_session(text, text, text, text, text, jsonb, integer)') is null, 'old signature dropped';

	-- Null ip is normalised to unknown and does not raise.
	delete from tripp.attempts where attempts.ip = 'unknown';
	r := tripp.open_session('wrong', null, 'UA', 'Windows', 'Edge', '{}');
	assert (r ->> 'error') = 'denied', 'null ip denied';
	assert (select ip from tripp.visits order by id desc limit 1) = 'unknown', 'visit ip unknown';
	assert (select count(*) from tripp.attempts where attempts.ip = 'unknown') = 1, 'attempt under unknown';
end $$;
