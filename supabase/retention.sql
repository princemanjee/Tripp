-- Tripp retention window and per-conversation legal hold.
--
-- tripp.settings holds one row: retention_days. When it is null nothing is ever
-- deleted. When it is a number, tripp.retention_purge (run daily by pg_cron)
-- deletes messages older than that many days, except in conversations on legal
-- hold, and trims the oldest stretch of the audit chains. It stops each audit
-- chain at the first row that is inside the window or belongs to a held
-- conversation, so a chain only ever loses a prefix. The last deleted row's hash
-- is recorded as an anchor in a retention_purge event, and
-- tripp.verify_chain accepts that anchor as the start of the surviving chain.
-- Safe to run more than once.

create table if not exists tripp.settings (
	id int primary key default 1 check (id = 1),
	retention_days int check (retention_days >= 1)
);
insert into tripp.settings (id, retention_days) values (1, null) on conflict (id) do nothing;
alter table tripp.settings enable row level security;

alter table tripp.conversations add column if not exists legal_hold boolean not null default false;

-- API, admin only: read the retention setting, or save it when p_save is true.
-- A null p_retention_days with p_save true turns retention off.
create or replace function public.m_settings(
	p_token text, p_retention_days int default null, p_save boolean default false
) returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_scope bigint := tripp.session_scope(p_token);
	v_days int;
begin
	if v_scope is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	if v_scope <> 0 then
		return json_build_object('ok', false, 'error', 'forbidden');
	end if;
	if coalesce(p_save, false) then
		if p_retention_days is not null and p_retention_days < 1 then
			return json_build_object('ok', false, 'error', 'bad_days');
		end if;
		update tripp.settings set retention_days = p_retention_days where id = 1;
		perform tripp.log_event('admin_retention_set', v_scope, tripp.token_visit(p_token), null,
			jsonb_build_object('days', p_retention_days));
	end if;
	select s.retention_days into v_days from tripp.settings s where s.id = 1;
	return json_build_object('ok', true, 'retention_days', v_days);
end;
$$;

-- API, admin only: put a conversation on legal hold or release it.
create or replace function public.m_conv_hold(p_token text, p_id bigint, p_hold boolean)
returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_scope bigint := tripp.session_scope(p_token);
begin
	if v_scope is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	if v_scope <> 0 then
		return json_build_object('ok', false, 'error', 'forbidden');
	end if;
	if p_hold is null then
		return json_build_object('ok', false, 'error', 'bad_hold');
	end if;
	update tripp.conversations set legal_hold = p_hold where id = p_id;
	if not found then
		return json_build_object('ok', false, 'error', 'no_conversation');
	end if;
	perform tripp.log_event('admin_legal_hold', v_scope, tripp.token_visit(p_token), p_id,
		jsonb_build_object('hold', p_hold, 'conversation', p_id));
	return json_build_object('ok', true);
end;
$$;

-- Internal: the daily purge. Returns {"ok":true,"skipped":true} when retention
-- is off. The held conversation ids are read once, at the start, so a hold
-- switched during the purge cannot split it. An event is held if its scope is
-- a held id or its detail names a held conversation (admin events have scope
-- 0). Visits are purged before events so that both anchor events are appended
-- after the events purge. Deleted messages are recorded in a retention_purge
-- event with table "messages" (no anchor, so is_anchor never matches it).
create or replace function tripp.retention_purge() returns json
language plpgsql volatile set search_path = ''
as $$
declare
	v_days int;
	v_window timestamptz;
	v_held bigint[];
	v_messages bigint;
	v_cut bigint;
	v_visit_rows bigint := 0;
	v_visit_anchor text;
	v_event_rows bigint := 0;
	v_event_anchor text;
begin
	select s.retention_days into v_days from tripp.settings s where s.id = 1;
	if v_days is null then
		return json_build_object('ok', true, 'skipped', true);
	end if;
	v_window := now() - make_interval(days => v_days);
	select coalesce(array_agg(c.id), '{}'::bigint[]) into v_held
	  from tripp.conversations c where c.legal_hold;

	with d as (
		delete from tripp.messages m
		 where m.created_at < v_window
		   and m.conversation_id <> all (v_held)
		returning 1
	)
	select count(*) into v_messages from d;

	perform pg_advisory_xact_lock(hashtext('tripp.visits'));
	perform pg_advisory_xact_lock(hashtext('tripp.events'));
	perform set_config('tripp.purge', 'on', true);

	select min(v.id) into v_cut from tripp.visits v
	 where v.at >= v_window
	    or v.scope = any (v_held);
	select v.row_hash into v_visit_anchor from tripp.visits v
	 where v_cut is null or v.id < v_cut order by v.id desc limit 1;
	with d as (
		delete from tripp.visits v where v_cut is null or v.id < v_cut returning 1
	)
	select count(*) into v_visit_rows from d;

	select min(e.id) into v_cut from tripp.events e
	 where e.at >= v_window
	    or e.scope = any (v_held)
	    or (case when e.detail ->> 'conversation' ~ '^[0-9]{1,18}$'
	             then (e.detail ->> 'conversation')::bigint end) = any (v_held);
	select e.row_hash into v_event_anchor from tripp.events e
	 where v_cut is null or e.id < v_cut order by e.id desc limit 1;
	with d as (
		delete from tripp.events e where v_cut is null or e.id < v_cut returning 1
	)
	select count(*) into v_event_rows from d;

	perform set_config('tripp.purge', 'off', true);

	if v_visit_rows > 0 then
		perform tripp.log_event('retention_purge', null, null, null,
			jsonb_build_object('table', 'visits', 'rows', v_visit_rows, 'anchor', v_visit_anchor));
	end if;
	if v_event_rows > 0 then
		perform tripp.log_event('retention_purge', null, null, null,
			jsonb_build_object('table', 'events', 'rows', v_event_rows, 'anchor', v_event_anchor));
	end if;
	if v_messages > 0 then
		perform tripp.log_event('retention_purge', null, null, null,
			jsonb_build_object('table', 'messages', 'rows', v_messages, 'before', v_window::text));
	end if;
	return json_build_object('ok', true, 'messages', v_messages,
		'visits', v_visit_rows, 'events', v_event_rows);
end;
$$;

revoke all on function tripp.retention_purge() from public, anon, authenticated;
revoke all on function public.m_settings(text, int, boolean) from public;
revoke all on function public.m_conv_hold(text, bigint, boolean) from public;
grant execute on function public.m_settings(text, int, boolean) to anon, authenticated;
grant execute on function public.m_conv_hold(text, bigint, boolean) to anon, authenticated;

-- Daily at 08:30 UTC.
create extension if not exists pg_cron;
do $$
begin
	perform cron.schedule('tripp-retention', '30 8 * * *', 'select tripp.retention_purge()')
	 where not exists (select 1 from cron.job where jobname = 'tripp-retention');
end;
$$;

notify pgrst, 'reload schema';
