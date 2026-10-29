-- Tripp live connection: binds Supabase anonymous auth users to Tripp sessions,
-- authorizes Realtime private channels, and pushes admin alerts.
--
-- A browser signs in anonymously (role authenticated, is_anonymous true), then
-- calls m_live_bind with its Tripp session token. The binding lets the policies
-- on realtime.messages decide which private channels that user may use:
-- 'admin' for the admin only, 'conv:<id>' for the matching guest (the admin may
-- use any existing conversation). The policies call SECURITY DEFINER helpers in
-- schema tripp_live, because authenticated has no usage on schema tripp. That
-- schema is not exposed through PostgREST.
--
-- tripp.log_event calls tripp.live_alert for the events the admin wants to hear
-- about. The alert carries only the event id, type, conversation and time.
-- Safe to run more than once.

create table if not exists tripp.live_bindings (
	uid uuid primary key,
	token_hash text not null references tripp.sessions (token_hash) on delete cascade,
	created_at timestamptz not null default now()
);
alter table tripp.live_bindings enable row level security;
revoke all on tripp.live_bindings from public, anon, authenticated;

alter table tripp.settings add column if not exists audit_seen bigint;

create schema if not exists tripp_live;
revoke all on schema tripp_live from public;
grant usage on schema tripp_live to authenticated;

-- The scope of the session bound to the caller: 0 for the admin, the
-- conversation id for a guest, null if unbound or the session is stale. Same
-- freshness rule as tripp.session_scope, but it never touches last_seen.
create or replace function tripp_live.live_scope() returns bigint
language sql stable security definer set search_path = ''
as $$
	select coalesce(s.conversation_id, 0)
	  from tripp.live_bindings b
	  join tripp.sessions s on s.token_hash = b.token_hash
	 where b.uid = auth.uid()
	   and s.last_seen > now() - interval '30 minutes'
	   and s.created_at > now() - interval '12 hours';
$$;

-- May the caller use this channel topic? Only 'admin' and 'conv:<digits>'.
create or replace function tripp_live.live_topic_ok(p_topic text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
	v_scope bigint := tripp_live.live_scope();
begin
	if v_scope is null or p_topic is null then
		return false;
	end if;
	if v_scope = 0 then
		if p_topic = 'admin' then
			return true;
		end if;
		if p_topic ~ '^conv:[1-9][0-9]{0,17}$' then
			return exists (select 1 from tripp.conversations c
			                where c.id = substr(p_topic, 6)::bigint);
		end if;
		return false;
	end if;
	return p_topic = 'conv:' || v_scope;
end;
$$;

revoke all on function tripp_live.live_scope() from public, anon;
revoke all on function tripp_live.live_topic_ok(text) from public, anon;
grant execute on function tripp_live.live_scope() to authenticated;
grant execute on function tripp_live.live_topic_ok(text) to authenticated;

-- Channel authorization. The write policy never lets anyone send to 'admin';
-- only the database does that, through tripp.live_alert.
drop policy if exists tripp_live_read on realtime.messages;
create policy tripp_live_read on realtime.messages
	for select to authenticated
	using (tripp_live.live_topic_ok(realtime.topic()));

drop policy if exists tripp_live_write on realtime.messages;
create policy tripp_live_write on realtime.messages
	for insert to authenticated
	with check (realtime.topic() <> 'admin' and tripp_live.live_topic_ok(realtime.topic()));

-- API: bind the caller (an anonymous auth user) to a Tripp session.
create or replace function public.m_live_bind(p_token text) returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_uid uuid := auth.uid();
	v_scope bigint;
begin
	if v_uid is null then
		return json_build_object('ok', false, 'error', 'no_user');
	end if;
	v_scope := tripp.session_scope(p_token);
	if v_scope is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	insert into tripp.live_bindings (uid, token_hash)
	values (v_uid, tripp.token_hash(p_token))
	on conflict (uid) do update set token_hash = excluded.token_hash, created_at = now();
	return json_build_object('ok', true, 'scope', v_scope);
end;
$$;

revoke all on function public.m_live_bind(text) from public, anon;
grant execute on function public.m_live_bind(text) to authenticated;

-- Internal: tell the admin channel that something happened. Never lets a failed
-- broadcast break the action that caused it.
create or replace function tripp.live_alert(p_id bigint, p_type text, p_scope bigint, p_at timestamptz)
returns void
language plpgsql volatile set search_path = ''
as $$
begin
	begin
		perform realtime.send(
			jsonb_build_object('id', p_id, 'type', p_type, 'conversation', p_scope, 'at', p_at),
			'event', 'admin', true);
	exception when others then
		null;
	end;
end;
$$;
revoke all on function tripp.live_alert(bigint, text, bigint, timestamptz) from public, anon, authenticated;

-- API, admin only: remember the newest audit event the admin has seen.
create or replace function public.m_audit_seen(p_token text, p_id bigint) returns json
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
	if p_id is null then
		return json_build_object('ok', false, 'error', 'bad_id');
	end if;
	update tripp.settings set audit_seen = greatest(coalesce(audit_seen, 0), p_id) where id = 1;
	return json_build_object('ok', true, 'seen', (select s.audit_seen from tripp.settings s where s.id = 1));
end;
$$;
revoke all on function public.m_audit_seen(text, bigint) from public;
grant execute on function public.m_audit_seen(text, bigint) to anon, authenticated;

-- Internal: delete anonymous auth users older than 13 hours (a session lives at
-- most 12) and bindings whose session is gone.
create or replace function tripp.live_cleanup() returns void
language plpgsql volatile set search_path = ''
as $$
begin
	delete from auth.users u
	 where u.is_anonymous and u.created_at < now() - interval '13 hours';
	delete from tripp.live_bindings b
	 where not exists (select 1 from tripp.sessions s where s.token_hash = b.token_hash);
end;
$$;
revoke all on function tripp.live_cleanup() from public, anon, authenticated;

-- Daily at 08:45 UTC, after the retention purge.
create extension if not exists pg_cron;
do $$
begin
	perform cron.unschedule('tripp-live-cleanup')
	 where exists (select 1 from cron.job where jobname = 'tripp-live-cleanup');
	perform cron.schedule('tripp-live-cleanup', '45 8 * * *', 'select tripp.live_cleanup()');
end;
$$;

notify pgrst, 'reload schema';
