-- Tripp database, version 2.
--
-- Access model: there are no Supabase Auth users. The browser holds only the
-- project's publishable key and can call the ten m_* functions at the bottom of
-- this file, nothing else. Every table lives in the private schema `tripp`,
-- which the Data API does not expose. Each function checks a password or a
-- session token itself before it touches a row.
--
-- People: one admin, plus any number of conversations. Each conversation has
-- its own password, and a password alone decides who is signing in, so no two
-- passwords may be the same. A conversation's password opens that conversation
-- and nothing else. The admin password opens the list of all conversations.
--
-- The public functions are SECURITY DEFINER on purpose: they are the whole
-- API, and the password or token check in each body stands where an auth.uid()
-- check would normally be. The security advisor will flag them.
--
-- Safe to run more than once. A version 1 database (tripp.keys with an owner
-- and a guest) is migrated in place: the owner password becomes the admin
-- password, the guest password and every existing message become
-- "Conversation 1". Open sessions are ended by the migration.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists tripp;
revoke all on schema tripp from public, anon, authenticated;

create table if not exists tripp.admin_key (
	id int primary key default 1 check (id = 1),
	hash text not null,
	changed_at timestamptz not null default now()
);

-- `label` is seen only by the admin. The other person never sees it.
create table if not exists tripp.conversations (
	id bigint generated always as identity primary key,
	label text not null check (char_length(label) between 1 and 100),
	hash text not null,
	created_at timestamptz not null default now(),
	changed_at timestamptz not null default now()
);

create table if not exists tripp.messages (
	id bigint generated always as identity primary key,
	author text not null check (author in ('owner', 'guest')),
	body text not null check (char_length(body) between 1 and 10000),
	created_at timestamptz not null default now()
);
-- An attachment may carry a message with no text, so the body may be empty.
-- The old check has a generated name; drop it, whatever it is, and add a named one.
do $$
declare
	v_name text;
begin
	for v_name in
		select c.conname from pg_constraint c
		 where c.conrelid = 'tripp.messages'::regclass and c.contype = 'c'
		   and c.conname <> 'messages_body_length'
		   and pg_get_constraintdef(c.oid) like '%char_length(body)%'
	loop
		execute format('alter table tripp.messages drop constraint %I', v_name);
	end loop;
	if not exists (select 1 from pg_constraint c
	                where c.conrelid = 'tripp.messages'::regclass and c.conname = 'messages_body_length') then
		alter table tripp.messages add constraint messages_body_length
			check (char_length(body) between 0 and 10000);
	end if;
end $$;
-- author 'owner' is the admin; 'guest' is the conversation's other person.
-- hidden: the other person cannot see it; the admin still can.
-- archived: out of the conversation for both; the admin sees it under Archived.
alter table tripp.messages add column if not exists conversation_id bigint references tripp.conversations (id) on delete cascade;
alter table tripp.messages add column if not exists hidden boolean not null default false;
alter table tripp.messages add column if not exists archived boolean not null default false;

-- Failed unlock attempts, kept only to throttle guessing.
create table if not exists tripp.attempts (
	id bigint generated always as identity primary key,
	ip text not null,
	at timestamptz not null default now()
);
create index if not exists attempts_ip_at on tripp.attempts (ip, at);

-- Version 1 to version 2.
do $$
declare
	v_conversation bigint;
begin
	if exists (select 1 from information_schema.columns
	            where table_schema = 'tripp' and table_name = 'sessions' and column_name = 'role') then
		drop table tripp.sessions;
	end if;
	if to_regclass('tripp.keys') is not null then
		insert into tripp.admin_key (id, hash)
		select 1, hash from tripp.keys where role = 'owner'
		on conflict (id) do nothing;
		if exists (select 1 from tripp.keys where role = 'guest')
		   and not exists (select 1 from tripp.conversations) then
			insert into tripp.conversations (label, hash)
			select 'Conversation 1', hash from tripp.keys where role = 'guest'
			returning id into v_conversation;
			update tripp.messages set conversation_id = v_conversation where conversation_id is null;
		end if;
		drop table tripp.keys;
	end if;
end;
$$;

alter table tripp.messages alter column conversation_id set not null;
create index if not exists messages_conversation on tripp.messages (conversation_id, id);

-- conversation_id null means an admin session.
create table if not exists tripp.sessions (
	token_hash text primary key,
	conversation_id bigint references tripp.conversations (id) on delete cascade,
	created_at timestamptz not null default now(),
	last_seen timestamptz not null default now()
);
alter table tripp.sessions add column if not exists visit_id bigint;

-- Defence in depth: no policies, so nothing but the table owner reads these.
alter table tripp.admin_key enable row level security;
alter table tripp.conversations enable row level security;
alter table tripp.messages enable row level security;
alter table tripp.sessions enable row level security;
alter table tripp.attempts enable row level security;

-- Version 1 functions whose signatures changed.
drop function if exists public.m_list(text);
drop function if exists public.m_post(text, text);
drop function if exists public.m_post(text, text, bigint);
drop function if exists public.m_setkey(text, text, text);
drop function if exists tripp.session_role(text);
drop function if exists public.m_open(text);
drop function if exists public.m_conv_save(text, bigint, text, text);

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

create or replace function tripp.token_hash(p_token text) returns text
language sql immutable set search_path = ''
as $$
	select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- Internal: resolve a session token. Returns 0 for the admin, the conversation
-- id for anyone else, or null if the token is unknown, idle for more than 30
-- minutes, or older than 12 hours. Touches last_seen.
create or replace function tripp.session_scope(p_token text) returns bigint
language plpgsql volatile set search_path = ''
as $$
declare
	v_found boolean;
	v_conversation bigint;
begin
	if p_token is null or p_token = '' then
		return null;
	end if;
	update tripp.sessions
	   set last_seen = now()
	 where token_hash = tripp.token_hash(p_token)
	   and last_seen > now() - interval '30 minutes'
	   and created_at > now() - interval '12 hours'
	returning true, conversation_id into v_found, v_conversation;
	if not coalesce(v_found, false) then
		return null;
	end if;
	return coalesce(v_conversation, 0);
end;
$$;

-- Internal: is this password already somebody's? Skips the admin key when
-- p_skip_admin is true and the conversation p_skip_conversation, so a password
-- can be set to its own current value.
create or replace function tripp.password_taken(p_password text, p_skip_admin boolean, p_skip_conversation bigint)
returns boolean
language sql stable set search_path = ''
as $$
	select (not p_skip_admin and exists (
				select 1 from tripp.admin_key a where a.hash = extensions.crypt(p_password, a.hash)))
		or exists (
				select 1 from tripp.conversations c
				 where c.id is distinct from p_skip_conversation
				   and c.hash = extensions.crypt(p_password, c.hash));
$$;

revoke all on function tripp.client_ip() from public, anon, authenticated;
revoke all on function tripp.token_hash(text) from public, anon, authenticated;
revoke all on function tripp.session_scope(text) from public, anon, authenticated;
revoke all on function tripp.password_taken(text, boolean, bigint) from public, anon, authenticated;

-- API: read a conversation, oldest first. `mine` is relative to the caller.
-- The other person gets their own conversation, without hidden or archived
-- messages. The admin names the conversation and picks the active or the
-- archived messages, and also gets each message's hidden flag.
create or replace function public.m_list(p_token text, p_conversation bigint default null, p_archived boolean default false)
returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_scope bigint := tripp.session_scope(p_token);
begin
	if v_scope is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;

	if v_scope > 0 then
		return json_build_object('ok', true, 'role', 'guest', 'messages', (
			select coalesce(json_agg(json_build_object(
				'id', m.id,
				'mine', m.author = 'guest',
				'body', m.body,
				'at', m.created_at,
				'attachments', (select coalesce(json_agg(json_build_object(
					'id', a.id, 'kind', a.kind, 'mime', a.mime, 'bytes', a.bytes,
					'name_enc', a.name_enc, 'nonce', a.nonce, 'chunk_size', a.chunk_size,
					'duration_ms', a.duration_ms) order by a.id), '[]'::json)
				                  from tripp.attachments a where a.message_id = m.id)) order by m.id), '[]'::json)
			  from tripp.messages m
			 where m.conversation_id = v_scope
			   and not m.hidden
			   and not m.archived));
	end if;

	if not exists (select 1 from tripp.conversations c where c.id = p_conversation) then
		return json_build_object('ok', false, 'error', 'no_conversation');
	end if;
	return json_build_object('ok', true, 'role', 'admin',
		'label', (select c.label from tripp.conversations c where c.id = p_conversation),
		'archived_count', (select count(*) from tripp.messages m
		                    where m.conversation_id = p_conversation and m.archived),
		'messages', (
			select coalesce(json_agg(json_build_object(
				'id', m.id,
				'mine', m.author = 'owner',
				'body', m.body,
				'at', m.created_at,
				'hidden', m.hidden,
				'archived', m.archived,
				'attachments', (select coalesce(json_agg(json_build_object(
					'id', a.id, 'kind', a.kind, 'mime', a.mime, 'bytes', a.bytes,
					'name_enc', a.name_enc, 'nonce', a.nonce, 'chunk_size', a.chunk_size,
					'duration_ms', a.duration_ms) order by a.id), '[]'::json)
				                  from tripp.attachments a where a.message_id = m.id)) order by m.id), '[]'::json)
			  from tripp.messages m
			 where m.conversation_id = p_conversation
			   and m.archived = coalesce(p_archived, false)));
end;
$$;

-- API: leave a message, with up to 10 encrypted attachments. The admin names
-- the conversation; anyone else posts to their own. Each attachment must be a
-- reservation made for this conversation (tripp.uploads), not yet attached,
-- whose uploaded object is exactly the size the ciphertext should be. The
-- body may be empty only if an attachment is present.
create or replace function public.m_post(p_token text, p_body text, p_conversation bigint default null, p_attachments jsonb default '[]')
returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_scope bigint := tripp.session_scope(p_token);
	v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
	v_target bigint;
	v_msg bigint;
	v_atts jsonb := coalesce(p_attachments, '[]'::jsonb);
	v_n int;
	v_att jsonb;
	v_path text;
	v_bytes bigint;
	v_up bigint;
	v_size bigint;
	v_id bigint;
	v_visit bigint := tripp.token_visit(p_token);
begin
	if v_scope is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	v_target := case when v_scope > 0 then v_scope else p_conversation end;
	if not exists (select 1 from tripp.conversations c where c.id = v_target) then
		return json_build_object('ok', false, 'error', 'no_conversation');
	end if;
	if jsonb_typeof(v_atts) is distinct from 'array' then
		return json_build_object('ok', false, 'error', 'bad_attachment');
	end if;
	v_n := jsonb_array_length(v_atts);
	if v_n > 10 then
		return json_build_object('ok', false, 'error', 'bad_attachment');
	end if;
	if char_length(v_body) = 0 and v_n = 0 then
		return json_build_object('ok', false, 'error', 'empty');
	end if;
	if char_length(v_body) > 10000 then
		return json_build_object('ok', false, 'error', 'too_long');
	end if;

	-- Check every attachment before anything is written.
	for v_att in select value from jsonb_array_elements(v_atts) loop
		if jsonb_typeof(v_att) is distinct from 'object'
		   or jsonb_typeof(v_att -> 'path') is distinct from 'string'
		   or jsonb_typeof(v_att -> 'kind') is distinct from 'string'
		   or jsonb_typeof(v_att -> 'mime') is distinct from 'string'
		   or jsonb_typeof(v_att -> 'bytes') is distinct from 'number'
		   or jsonb_typeof(v_att -> 'name_enc') is distinct from 'string'
		   or jsonb_typeof(v_att -> 'nonce') is distinct from 'string'
		   or jsonb_typeof(v_att -> 'chunk_size') is distinct from 'number'
		   or jsonb_typeof(v_att -> 'duration_ms') not in ('number', 'null') then
			return json_build_object('ok', false, 'error', 'bad_attachment');
		end if;
		if (v_att ->> 'kind') not in ('file', 'audio', 'video')
		   or char_length(v_att ->> 'mime') > 255
		   or char_length(v_att ->> 'name_enc') > 2048
		   or (v_att ->> 'bytes') !~ '^[0-9]{1,9}$'
		   or (v_att ->> 'chunk_size') !~ '^[0-9]{1,9}$'
		   or ((v_att ->> 'duration_ms') is not null and (v_att ->> 'duration_ms') !~ '^[0-9]{1,9}$') then
			return json_build_object('ok', false, 'error', 'bad_attachment');
		end if;
		v_path := v_att ->> 'path';
		v_bytes := (v_att ->> 'bytes')::bigint;
		if v_bytes not between 1 and 26214400
		   or (select count(*) from jsonb_array_elements(v_atts) x where x ->> 'path' = v_path) > 1
		   or exists (select 1 from tripp.attachments a where a.path = v_path) then
			return json_build_object('ok', false, 'error', 'bad_attachment');
		end if;
		select u.conversation_id into v_up from tripp.uploads u where u.path = v_path;
		if not found or v_up <> v_target then
			return json_build_object('ok', false, 'error', 'foreign_path');
		end if;
		select (o.metadata ->> 'size')::bigint into v_size
		  from storage.objects o where o.bucket_id = 'tripp-media' and o.name = v_path;
		if not found then
			return json_build_object('ok', false, 'error', 'missing_upload');
		end if;
		if v_size is distinct from tripp.cipher_size(v_bytes) then
			return json_build_object('ok', false, 'error', 'size_mismatch');
		end if;
	end loop;

	insert into tripp.messages (conversation_id, author, body)
	values (v_target, case when v_scope > 0 then 'guest' else 'owner' end, v_body)
	returning id into v_msg;
	perform tripp.log_event('message', v_scope, v_visit, v_msg,
		jsonb_build_object('author', case when v_scope > 0 then 'guest' else 'owner' end,
		                   'length', char_length(v_body),
		                   'attachments', v_n));

	for v_att in select value from jsonb_array_elements(v_atts) loop
		insert into tripp.attachments (message_id, conversation_id, path, kind, mime, bytes,
		                               name_enc, nonce, chunk_size, duration_ms)
		values (v_msg, v_target, v_att ->> 'path', v_att ->> 'kind', v_att ->> 'mime',
		        (v_att ->> 'bytes')::bigint, v_att ->> 'name_enc', v_att ->> 'nonce',
		        (v_att ->> 'chunk_size')::int, (v_att ->> 'duration_ms')::int)
		returning id into v_id;
		perform tripp.log_event('upload', v_scope, v_visit, v_id,
			jsonb_build_object('kind', v_att ->> 'kind', 'mime', v_att ->> 'mime',
			                   'bytes', (v_att ->> 'bytes')::bigint));
		delete from tripp.uploads where path = v_att ->> 'path';
	end loop;
	return json_build_object('ok', true);
end;
$$;

-- API: end the session.
create or replace function public.m_close(p_token text) returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_scope bigint := tripp.session_scope(p_token);
	v_visit bigint := tripp.token_visit(p_token);
begin
	delete from tripp.sessions where token_hash = tripp.token_hash(p_token);
	if found then
		perform tripp.log_event('logout', v_scope, v_visit, null, null);
	end if;
	return json_build_object('ok', true);
end;
$$;

-- API, admin only: every conversation, most recent activity first.
create or replace function public.m_convs(p_token text) returns json
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
	return json_build_object('ok', true, 'conversations', (
		select coalesce(json_agg(row_to_json(x) order by x.last_at desc nulls last, x.id desc), '[]'::json)
		  from (
			select c.id,
			       c.label,
			       c.created_at,
			       c.legal_hold,
			       (select max(m.created_at) from tripp.messages m
			         where m.conversation_id = c.id and not m.archived) as last_at,
			       (select m.author = 'guest' from tripp.messages m
			         where m.conversation_id = c.id and not m.archived
			         order by m.id desc limit 1) as last_from_them,
			       (select count(*) from tripp.messages m
			         where m.conversation_id = c.id and not m.archived) as active_count,
			       (select count(*) from tripp.messages m
			         where m.conversation_id = c.id and m.archived) as archived_count
			  from tripp.conversations c
		  ) x));
end;
$$;

-- API, admin only: create a conversation (p_id null) or change one. On a
-- change, a null or empty label or password leaves that field as it is. A new
-- password ends the other person's open sessions.
-- Key guard: changing the password of a conversation that has a key row needs
-- the guest copy rewrapped under the new password in the same call
-- (p_wrapped_guest and the three fields after it), else `needs_unlock`. A new
-- conversation may be created with its key row: pass all four guest fields and
-- p_wrapped_owner (`bad_keys` if only some, `no_keys` if there is no owner row).
create or replace function public.m_conv_save(
	p_token text, p_id bigint, p_label text, p_password text,
	p_wrapped_guest text default null, p_guest_salt text default null,
	p_guest_iv text default null, p_guest_iterations int default null,
	p_wrapped_owner text default null
)
returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_scope bigint := tripp.session_scope(p_token);
	v_label text := btrim(coalesce(p_label, ''));
	v_id bigint;
	v_guest_all boolean := coalesce(p_wrapped_guest, '') <> '' and coalesce(p_guest_salt, '') <> ''
		and coalesce(p_guest_iv, '') <> '' and coalesce(p_guest_iterations, 0) > 0;
	v_guest_any boolean := coalesce(p_wrapped_guest, '') <> '' or coalesce(p_guest_salt, '') <> ''
		or coalesce(p_guest_iv, '') <> '' or coalesce(p_guest_iterations, 0) > 0;
begin
	if v_scope is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	if v_scope <> 0 then
		return json_build_object('ok', false, 'error', 'forbidden');
	end if;
	if char_length(v_label) > 100 then
		return json_build_object('ok', false, 'error', 'label_too_long');
	end if;
	if p_password is not null and p_password <> ''
	   and tripp.password_taken(p_password, false, p_id) then
		return json_build_object('ok', false, 'error', 'password_taken');
	end if;

	if p_id is null then
		if v_label = '' then
			return json_build_object('ok', false, 'error', 'label_empty');
		end if;
		if p_password is null or p_password = '' then
			return json_build_object('ok', false, 'error', 'empty_key');
		end if;
		if v_guest_any or coalesce(p_wrapped_owner, '') <> '' then
			if not v_guest_all or coalesce(p_wrapped_owner, '') = '' then
				return json_build_object('ok', false, 'error', 'bad_keys');
			end if;
			if not exists (select 1 from tripp_keys.owner o where o.id = 1) then
				return json_build_object('ok', false, 'error', 'no_keys');
			end if;
		end if;
		insert into tripp.conversations (label, hash)
		values (v_label, extensions.crypt(p_password, extensions.gen_salt('bf', 10)))
		returning id into v_id;
		if v_guest_all then
			insert into tripp_keys.conversations
				(conversation_id, wrapped_owner, wrapped_guest, guest_salt, guest_iv, guest_iterations)
			values (v_id, p_wrapped_owner, p_wrapped_guest, p_guest_salt, p_guest_iv, p_guest_iterations);
		end if;
		perform tripp.log_event('admin_conv_save', v_scope, tripp.token_visit(p_token), v_id,
			jsonb_build_object('created', true, 'label_changed', true, 'password_changed', true));
		return json_build_object('ok', true, 'id', v_id);
	end if;

	if not exists (select 1 from tripp.conversations c where c.id = p_id) then
		return json_build_object('ok', false, 'error', 'no_conversation');
	end if;
	if p_password is not null and p_password <> '' then
		if coalesce(p_wrapped_guest, '') = ''
		   and exists (select 1 from tripp_keys.conversations k where k.conversation_id = p_id) then
			return json_build_object('ok', false, 'error', 'needs_unlock');
		end if;
		if v_guest_any and not v_guest_all then
			return json_build_object('ok', false, 'error', 'bad_keys');
		end if;
	end if;
	if v_label <> '' then
		update tripp.conversations set label = v_label, changed_at = now() where id = p_id;
	end if;
	if p_password is not null and p_password <> '' then
		update tripp.conversations
		   set hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), changed_at = now()
		 where id = p_id;
		delete from tripp.sessions where conversation_id = p_id;
		if v_guest_all then
			update tripp_keys.conversations
			   set wrapped_guest = p_wrapped_guest, guest_salt = p_guest_salt, guest_iv = p_guest_iv,
			       guest_iterations = p_guest_iterations, changed_at = now()
			 where conversation_id = p_id;
		end if;
	end if;
	perform tripp.log_event('admin_conv_save', v_scope, tripp.token_visit(p_token), p_id,
		jsonb_build_object('created', false, 'label_changed', v_label <> '',
		                   'password_changed', coalesce(p_password, '') <> ''));
	return json_build_object('ok', true, 'id', p_id);
end;
$$;

-- API, admin only: delete a conversation, its messages, and its password.
create or replace function public.m_conv_delete(p_token text, p_id bigint) returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_scope bigint := tripp.session_scope(p_token);
	v_count bigint;
begin
	if v_scope is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	if v_scope <> 0 then
		return json_build_object('ok', false, 'error', 'forbidden');
	end if;
	select count(*) into v_count from tripp.messages where conversation_id = p_id;
	delete from tripp.conversations where id = p_id;
	if not found then
		return json_build_object('ok', false, 'error', 'no_conversation');
	end if;
	perform tripp.log_event('admin_conv_delete', v_scope, tripp.token_visit(p_token), p_id,
		jsonb_build_object('messages', v_count));
	return json_build_object('ok', true);
end;
$$;

-- API, admin only: hide, unhide, archive, unarchive, or delete one message.
create or replace function public.m_msg(p_token text, p_id bigint, p_action text) returns json
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
	if p_action = 'delete' then
		delete from tripp.messages where id = p_id;
	elsif p_action in ('hide', 'unhide') then
		update tripp.messages set hidden = (p_action = 'hide') where id = p_id;
	elsif p_action in ('archive', 'unarchive') then
		update tripp.messages set archived = (p_action = 'archive') where id = p_id;
	else
		return json_build_object('ok', false, 'error', 'bad_action');
	end if;
	if not found then
		return json_build_object('ok', false, 'error', 'no_message');
	end if;
	perform tripp.log_event('admin_' || p_action, v_scope, tripp.token_visit(p_token), p_id, null);
	return json_build_object('ok', true);
end;
$$;

-- API, admin only: change the admin password. Ends every other admin session.
create or replace function public.m_admin_key(p_token text, p_new text) returns json
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
	-- No length or composition rules: the admin's chosen password is accepted as given.
	if p_new is null or p_new = '' then
		return json_build_object('ok', false, 'error', 'empty_key');
	end if;
	if tripp.password_taken(p_new, true, null) then
		return json_build_object('ok', false, 'error', 'password_taken');
	end if;
	update tripp.admin_key
	   set hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), changed_at = now()
	 where id = 1;
	delete from tripp.sessions
	 where conversation_id is null
	   and token_hash <> tripp.token_hash(p_token);
	perform tripp.log_event('admin_key_change', v_scope, tripp.token_visit(p_token), null, null);
	return json_build_object('ok', true);
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function. Take that away and
-- grant only what the browser needs.
revoke all on function public.m_list(text, bigint, boolean) from public;
revoke all on function public.m_post(text, text, bigint, jsonb) from public;
revoke all on function public.m_close(text) from public;
revoke all on function public.m_convs(text) from public;
revoke all on function public.m_conv_save(text, bigint, text, text, text, text, text, int, text) from public;
revoke all on function public.m_conv_delete(text, bigint) from public;
revoke all on function public.m_msg(text, bigint, text) from public;
revoke all on function public.m_admin_key(text, text) from public;

grant execute on function public.m_list(text, bigint, boolean) to anon, authenticated;
grant execute on function public.m_post(text, text, bigint, jsonb) to anon, authenticated;
grant execute on function public.m_close(text) to anon, authenticated;
grant execute on function public.m_convs(text) to anon, authenticated;
grant execute on function public.m_conv_save(text, bigint, text, text, text, text, text, int, text) to anon, authenticated;
grant execute on function public.m_conv_delete(text, bigint) to anon, authenticated;
grant execute on function public.m_msg(text, bigint, text) to anon, authenticated;
grant execute on function public.m_admin_key(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
