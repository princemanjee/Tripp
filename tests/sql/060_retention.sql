-- Retention window and legal hold.

-- Test helper: rebuild a chain in id order after rows were backdated.
create function pg_temp.rehash() returns void
language plpgsql
as $$
declare
	prev text;
	rv tripp.visits;
	re tripp.events;
begin
	perform set_config('tripp.purge', 'on', true);
	prev := repeat('0', 64);
	for rv in select * from tripp.visits order by id loop
		rv.prev_hash := prev;
		rv.row_hash := tripp.chain_hash(prev, tripp.visit_payload(rv));
		update tripp.visits set prev_hash = rv.prev_hash, row_hash = rv.row_hash where id = rv.id;
		prev := rv.row_hash;
	end loop;
	prev := repeat('0', 64);
	for re in select * from tripp.events order by id loop
		re.prev_hash := prev;
		re.row_hash := tripp.chain_hash(prev, tripp.event_payload(re));
		update tripp.events set prev_hash = re.prev_hash, row_hash = re.row_hash where id = re.id;
		prev := re.row_hash;
	end loop;
	perform set_config('tripp.purge', 'off', true);
end;
$$;

do $$
declare
	adm text := 't-adm-' || md5(random()::text);
	gA text := 't-ga-' || md5(random()::text);
	convA bigint; convH bigint;
	r json;
	e1 bigint; e1b bigint; e2 bigint; e2b bigint; e3 bigint; e4 bigint;
	n bigint;
	v1 bigint; v2 bigint; v3 bigint;
	anchor text;
	old_ts timestamptz := now() - interval '40 days';
begin
	insert into tripp.conversations (label, hash)
	values ('t-ret-a-' || md5(random()::text), 't-ret-ha-' || md5(random()::text)) returning id into convA;
	insert into tripp.conversations (label, hash)
	values ('t-ret-h-' || md5(random()::text), 't-ret-hh-' || md5(random()::text)) returning id into convH;
	insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash(adm), null);
	insert into tripp.sessions (token_hash, conversation_id) values (tripp.token_hash(gA), convA);

	-- m_settings: access.
	r := public.m_settings('bad', null, false);
	assert (r ->> 'error') = 'expired', 'm_settings expired';
	r := public.m_settings(gA, null, false);
	assert (r ->> 'error') = 'forbidden', 'guest m_settings forbidden';
	r := public.m_settings(gA, 30, true);
	assert (r ->> 'error') = 'forbidden', 'guest cannot save m_settings';
	r := public.m_settings(adm, null, false);
	assert (r ->> 'ok') = 'true' and (r ->> 'retention_days') is null, 'retention starts off';
	r := public.m_settings(adm, 0, true);
	assert (r ->> 'error') = 'bad_days', 'zero days refused';

	-- m_conv_hold.
	r := public.m_conv_hold(gA, convA, true);
	assert (r ->> 'error') = 'forbidden', 'guest m_conv_hold forbidden';
	r := public.m_conv_hold(adm, -1, true);
	assert (r ->> 'error') = 'no_conversation', 'hold on missing conversation';
	r := public.m_conv_hold(adm, convH, true);
	assert (r ->> 'ok') = 'true', 'hold set';
	assert (select legal_hold from tripp.conversations where id = convH), 'legal_hold stored';
	assert exists (select 1 from tripp.events where type = 'admin_legal_hold' and ref_id = convH
		and detail = jsonb_build_object('hold', true, 'conversation', convH)), 'hold toggle writes admin_legal_hold';
	assert exists (select 1 from json_array_elements(((public.m_convs(adm)) ->> 'conversations')::json) c
		where (c ->> 'id')::bigint = convH and (c ->> 'legal_hold') = 'true'), 'm_convs returns legal_hold';

	-- Messages: one old and one new in each conversation.
	insert into tripp.messages (author, body, conversation_id, created_at) values
		('guest', 'x', convA, old_ts), ('guest', 'x', convA, now()),
		('guest', 'x', convH, old_ts), ('guest', 'x', convH, now());

	-- Null retention: skipped, nothing deleted.
	r := tripp.retention_purge();
	assert (r ->> 'skipped') = 'true', 'null retention skips';
	assert (select count(*) from tripp.messages where conversation_id in (convA, convH)) = 4, 'skip deletes nothing';

	-- Save retention.
	r := public.m_settings(adm, 30, true);
	assert (r ->> 'ok') = 'true' and (r ->> 'retention_days')::int = 30, 'retention saved';
	assert (public.m_settings(adm, null, false) ->> 'retention_days')::int = 30, 'retention read back';
	assert exists (select 1 from tripp.events where type = 'admin_retention_set' and detail = '{"days": 30}'::jsonb),
		'save writes admin_retention_set';

	-- Audit fixtures. Start from empty chains.
	perform set_config('tripp.purge', 'on', true);
	delete from tripp.events;
	delete from tripp.visits;
	perform set_config('tripp.purge', 'off', true);

	e1 := tripp.log_event('login', convA, null, null, '{}');
	-- A non-numeric conversation value must not break the purge.
	e1b := tripp.log_event('admin_hide', 0, null, null, '{"conversation": "not-a-number"}');
	e2 := tripp.log_event('message', convA, null, null, '{}');
	-- An admin event (scope 0) about the held conversation: the hold must cover it.
	e2b := tripp.log_event('admin_hide', 0, null, null, jsonb_build_object('conversation', convH));
	e3 := tripp.log_event('message', convH, null, null, '{}');
	e4 := tripp.log_event('login', convA, null, null, '{}');
	v1 := tripp.log_visit('ok', convA, '1.1.1.1', 'UA', 'Win', 'Chrome', '{}');
	v2 := tripp.log_visit('denied', null, '2.2.2.2', 'UA', 'Win', 'Chrome', '{}');
	v3 := tripp.log_visit('ok', convA, '3.3.3.3', 'UA', 'Win', 'Chrome', '{}');
	perform set_config('tripp.purge', 'on', true);
	update tripp.events set at = old_ts where id in (e1, e1b, e2, e2b, e3);
	update tripp.visits set at = old_ts where id in (v1, v2);
	perform set_config('tripp.purge', 'off', true);
	perform pg_temp.rehash();
	assert (tripp.verify_chain('events') ->> 'ok') = 'true', 'fixture events chain valid';
	assert (tripp.verify_chain('visits') ->> 'ok') = 'true', 'fixture visits chain valid';
	select row_hash into anchor from tripp.events where id = e2;

	-- A hold switched on part-way through the purge must not split it: the held
	-- ids are read once, at the start. This trigger puts convA on hold as soon
	-- as the messages are deleted.
	create function pg_temp.hold_mid_purge() returns trigger
	language plpgsql as $f$
	begin
		update tripp.conversations set legal_hold = true where label like 't-ret-a-%' and not legal_hold;
		return null;
	end;
	$f$;
	create trigger t_hold_mid_purge after delete on tripp.messages
		for each statement execute function pg_temp.hold_mid_purge();

	r := tripp.retention_purge();
	assert (r ->> 'ok') = 'true' and (r ->> 'skipped') is null, 'purge ran';
	drop trigger t_hold_mid_purge on tripp.messages;
	assert (select legal_hold from tripp.conversations where id = convA), 'hold switched on mid-purge';
	n := (r ->> 'messages')::bigint;
	assert n >= 1, 'purge deleted messages';

	-- Message deletes are on the record, and cannot pass for an anchor.
	assert (select count(*) from tripp.events where type = 'retention_purge' and scope is null
		and detail ->> 'table' = 'messages' and (detail ->> 'rows')::bigint = n
		and (detail ->> 'before')::timestamptz = now() - interval '30 days'
		and not (detail ? 'anchor')) = 1, 'messages purge event recorded';
	assert not exists (select 1 from tripp.events e where e.type = 'retention_purge' and e.detail ->> 'table' = 'messages'
		and (tripp.is_anchor('events', e.row_hash) or tripp.is_anchor('visits', e.row_hash)
		     or tripp.is_anchor('events', e.prev_hash) or tripp.is_anchor('visits', e.prev_hash))),
		'messages purge event is not an anchor';

	-- Messages.
	assert not exists (select 1 from tripp.messages where conversation_id = convA and created_at < now() - interval '30 days'),
		'old message in unheld conversation purged';
	assert exists (select 1 from tripp.messages where conversation_id = convH and created_at < now() - interval '30 days'),
		'old message in held conversation kept';
	assert exists (select 1 from tripp.messages where conversation_id = convA and created_at > now() - interval '1 day'),
		'new message kept';

	-- Events: prefix up to the held-scope row.
	assert not exists (select 1 from tripp.events where id in (e1, e1b, e2)), 'old events before held row purged';
	assert exists (select 1 from tripp.events where id = e2b), 'admin event about held conversation kept';
	assert exists (select 1 from tripp.events where id = e3), 'held-scope event kept';
	assert exists (select 1 from tripp.events where id = e4), 'new event kept';
	-- Visits: v1, v2 purged, v3 kept.
	assert not exists (select 1 from tripp.visits where id in (v1, v2)), 'old visits purged';
	assert exists (select 1 from tripp.visits where id = v3), 'new visit kept';

	-- Anchors.
	assert exists (select 1 from tripp.events where type = 'retention_purge' and scope is null
		and detail ->> 'table' = 'events' and (detail ->> 'rows')::int = 3 and detail ->> 'anchor' = anchor),
		'events anchor matches last purged row hash';
	assert exists (select 1 from tripp.events where type = 'retention_purge'
		and detail ->> 'table' = 'visits' and (detail ->> 'rows')::int = 2), 'visits anchor recorded';
	assert (select prev_hash from tripp.visits order by id limit 1) = (
		select detail ->> 'anchor' from tripp.events where type = 'retention_purge' and detail ->> 'table' = 'visits'),
		'first remaining visit starts at the anchor';

	-- Chains still verify.
	r := tripp.verify_chain('events');
	assert (r ->> 'ok') = 'true', 'events chain verifies after purge: ' || r::text;
	r := tripp.verify_chain('visits');
	assert (r ->> 'ok') = 'true', 'visits chain verifies after purge: ' || r::text;

	-- A forged first row still fails.
	perform set_config('tripp.purge', 'on', true);
	update tripp.visits set prev_hash = repeat('f', 64) where id = v3;
	perform set_config('tripp.purge', 'off', true);
	assert (tripp.verify_chain('visits') ->> 'ok') = 'false', 'unknown prev_hash fails verification';

	-- The purge setting does not leak out of the call.
	assert coalesce(current_setting('tripp.purge', true), '') <> 'on', 'purge flag reset';

	-- A purge that deletes no messages writes no messages event.
	n := (select count(*) from tripp.events where type = 'retention_purge' and detail ->> 'table' = 'messages');
	r := tripp.retention_purge();
	assert (r ->> 'messages')::bigint = 0, 'second purge deletes no messages';
	assert (select count(*) from tripp.events where type = 'retention_purge' and detail ->> 'table' = 'messages') = n,
		'no messages event when nothing was deleted';

	-- Releasing the hold is logged.
	r := public.m_conv_hold(adm, convH, false);
	assert (r ->> 'ok') = 'true', 'hold released';
	assert exists (select 1 from tripp.events where type = 'admin_legal_hold'
		and detail = jsonb_build_object('hold', false, 'conversation', convH)),
		'release writes admin_legal_hold';
end $$;

-- Internal and guarded.
do $$
begin
	assert not has_function_privilege('anon', 'tripp.retention_purge()', 'execute'), 'anon cannot run retention_purge';
	assert not has_function_privilege('authenticated', 'tripp.retention_purge()', 'execute'), 'authenticated cannot run retention_purge';
	assert has_function_privilege('anon', 'public.m_settings(text,int,boolean)', 'execute'), 'anon can call m_settings';
	assert has_function_privilege('anon', 'public.m_conv_hold(text,bigint,boolean)', 'execute'), 'anon can call m_conv_hold';
	assert (select relrowsecurity from pg_class where oid = 'tripp.settings'::regclass), 'settings has RLS';
end $$;

-- pg_cron schedule.
do $$
begin
	if exists (select 1 from pg_extension where extname = 'pg_cron') then
		assert (select count(*) from cron.job where jobname = 'tripp-retention' and schedule = '30 8 * * *') = 1,
			'tripp-retention scheduled once';
	else
		raise notice 'pg_cron not installed in this database; schedule not checked';
	end if;
end $$;
