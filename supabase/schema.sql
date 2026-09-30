-- Tripp version 1.0 database.
--
-- Access model: there are no Supabase Auth users. The browser holds only the
-- project's publishable key and can call the five functions at the bottom of
-- this file, nothing else. Every table lives in the private schema `tripp`,
-- which the Data API does not expose. Each function checks a password or a
-- session token itself before it touches a row.
--
-- The five public functions are SECURITY DEFINER on purpose: they are the
-- whole API, and the password or token check in each body stands where an
-- auth.uid() check would normally be. The security advisor will flag them.
--
-- Safe to run more than once. It never overwrites a password that is set.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists tripp;
revoke all on schema tripp from public, anon, authenticated;

-- One row per person. `role` is 'owner' or 'guest'. No names are stored.
create table if not exists tripp.keys (
	role text primary key check (role in ('owner', 'guest')),
	hash text not null,
	changed_at timestamptz not null default now()
);

create table if not exists tripp.sessions (
	token_hash text primary key,
	role text not null references tripp.keys (role),
	created_at timestamptz not null default now(),
	last_seen timestamptz not null default now()
);

create table if not exists tripp.messages (
	id bigint generated always as identity primary key,
	author text not null check (author in ('owner', 'guest')),
	body text not null check (char_length(body) between 1 and 10000),
	created_at timestamptz not null default now()
);

-- Failed unlock attempts, kept only to throttle guessing.
create table if not exists tripp.attempts (
	id bigint generated always as identity primary key,
	ip text not null,
	at timestamptz not null default now()
);
create index if not exists attempts_ip_at on tripp.attempts (ip, at);

-- Defence in depth: no policies, so nothing but the table owner reads these.
alter table tripp.keys enable row level security;
alter table tripp.sessions enable row level security;
alter table tripp.messages enable row level security;
alter table tripp.attempts enable row level security;

-- Internal: the caller's address as the API gateway reports it.
create or replace function tripp.client_ip() returns text
language sql stable set search_path = ''
as $$
	select coalesce(
		nullif(trim(split_part(
			coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> 'x-forwarded-for',
			',', 1)), ''),
		'unknown');
$$;

-- Internal: resolve a session token to its role, or null if it is unknown,
-- idle for more than 30 minutes, or older than 12 hours. Touches last_seen.
create or replace function tripp.session_role(p_token text) returns text
language plpgsql volatile set search_path = ''
as $$
declare
	v_role text;
begin
	if p_token is null or p_token = '' then
		return null;
	end if;
	update tripp.sessions
	   set last_seen = now()
	 where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
	   and last_seen > now() - interval '30 minutes'
	   and created_at > now() - interval '12 hours'
	returning role into v_role;
	return v_role;
end;
$$;

revoke all on function tripp.client_ip() from public, anon, authenticated;
revoke all on function tripp.session_role(text) from public, anon, authenticated;

-- API 1 of 5: exchange a password for a session token.
-- Eight wrong tries from one address inside 15 minutes locks that address out
-- until the oldest of them is 15 minutes old. A failure returns a result
-- rather than raising, so the attempt row is kept.
create or replace function public.m_open(p_password text) returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_ip text := tripp.client_ip();
	v_role text;
	v_token text;
begin
	delete from tripp.attempts where at < now() - interval '1 day';
	delete from tripp.sessions
	 where last_seen < now() - interval '30 minutes'
	    or created_at < now() - interval '12 hours';

	if (select count(*) from tripp.attempts
	     where ip = v_ip and at > now() - interval '15 minutes') >= 8 then
		return json_build_object('ok', false, 'error', 'locked');
	end if;

	if p_password is not null and p_password <> '' then
		select k.role into v_role
		  from tripp.keys k
		 where k.hash = extensions.crypt(p_password, k.hash)
		 limit 1;
	end if;

	if v_role is null then
		insert into tripp.attempts (ip) values (v_ip);
		return json_build_object('ok', false, 'error', 'denied');
	end if;

	v_token := encode(extensions.gen_random_bytes(32), 'hex');
	insert into tripp.sessions (token_hash, role)
	values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_role);
	delete from tripp.attempts where ip = v_ip;

	return json_build_object('ok', true, 'token', v_token, 'role', v_role);
end;
$$;

-- API 2 of 5: read the thread, oldest first. `mine` is relative to the caller.
create or replace function public.m_list(p_token text) returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_role text := tripp.session_role(p_token);
begin
	if v_role is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	return json_build_object('ok', true, 'role', v_role, 'messages', (
		select coalesce(json_agg(json_build_object(
			'id', m.id,
			'mine', m.author = v_role,
			'body', m.body,
			'at', m.created_at) order by m.id), '[]'::json)
		  from tripp.messages m));
end;
$$;

-- API 3 of 5: leave a message.
create or replace function public.m_post(p_token text, p_body text) returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_role text := tripp.session_role(p_token);
	v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
begin
	if v_role is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	if char_length(v_body) = 0 then
		return json_build_object('ok', false, 'error', 'empty');
	end if;
	if char_length(v_body) > 10000 then
		return json_build_object('ok', false, 'error', 'too_long');
	end if;
	insert into tripp.messages (author, body) values (v_role, v_body);
	return json_build_object('ok', true);
end;
$$;

-- API 4 of 5: end the session.
create or replace function public.m_close(p_token text) returns json
language plpgsql volatile security definer set search_path = ''
as $$
begin
	delete from tripp.sessions
	 where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
	return json_build_object('ok', true);
end;
$$;

-- API 5 of 5: set either password. Owner sessions only. The two passwords
-- must differ, because the password alone decides who is signing in.
-- Changing a password ends every other session for that role.
create or replace function public.m_setkey(p_token text, p_role text, p_new text) returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_role text := tripp.session_role(p_token);
begin
	if v_role is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	if v_role <> 'owner' then
		return json_build_object('ok', false, 'error', 'forbidden');
	end if;
	if p_role is null or p_role not in ('owner', 'guest') then
		return json_build_object('ok', false, 'error', 'bad_role');
	end if;
	if p_new is null or char_length(p_new) < 12 then
		return json_build_object('ok', false, 'error', 'too_short');
	end if;
	if char_length(p_new) > 200 then
		return json_build_object('ok', false, 'error', 'too_long');
	end if;
	if exists (select 1 from tripp.keys k
	            where k.role <> p_role and k.hash = extensions.crypt(p_new, k.hash)) then
		return json_build_object('ok', false, 'error', 'same_as_other');
	end if;

	update tripp.keys
	   set hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)),
	       changed_at = now()
	 where role = p_role;
	if not found then
		return json_build_object('ok', false, 'error', 'bad_role');
	end if;

	delete from tripp.sessions
	 where role = p_role
	   and token_hash <> encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

	return json_build_object('ok', true);
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function. Take that away and
-- grant only what the browser needs.
revoke all on function public.m_open(text) from public;
revoke all on function public.m_list(text) from public;
revoke all on function public.m_post(text, text) from public;
revoke all on function public.m_close(text) from public;
revoke all on function public.m_setkey(text, text, text) from public;

grant execute on function public.m_open(text) to anon, authenticated;
grant execute on function public.m_list(text) to anon, authenticated;
grant execute on function public.m_post(text, text) to anon, authenticated;
grant execute on function public.m_close(text) to anon, authenticated;
grant execute on function public.m_setkey(text, text, text) to anon, authenticated;
