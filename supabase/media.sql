-- Tripp encrypted attachments.
--
-- Files are encrypted in the browser, so Storage holds only ciphertext. The
-- bucket is private and has no policies on storage.objects, so only the
-- service role (the `media` Edge Function) can reach it. The browser asks the
-- function for a place to upload (media_reserve), uploads, then names the
-- uploaded paths in m_post, which checks them and records the attachments.
-- The media_* functions below are internal: revoked from everyone and called
-- only by the Edge Function.
--
-- Safe to run more than once.

-- 25 MiB of file plus 16 bytes of tag per 1 MiB chunk, rounded up to 26215424.
insert into storage.buckets (id, name, public, file_size_limit)
values ('tripp-media', 'tripp-media', false, 26215424)
on conflict (id) do nothing;

create table if not exists tripp.attachments (
	id bigint generated always as identity primary key,
	message_id bigint not null references tripp.messages (id) on delete cascade,
	conversation_id bigint not null,
	path text not null unique,
	kind text not null check (kind in ('file', 'audio', 'video')),
	mime text not null check (char_length(mime) <= 255),
	bytes bigint not null check (bytes between 1 and 26214400),
	name_enc text not null check (char_length(name_enc) <= 2048),
	nonce text not null,
	chunk_size int not null,
	duration_ms int null,
	created_at timestamptz not null default now()
);
create index if not exists attachments_message on tripp.attachments (message_id);

-- Upload reservations: a path handed out by media_reserve and not yet attached.
create table if not exists tripp.uploads (
	path text primary key,
	conversation_id bigint not null,
	kind text,
	bytes bigint,
	created_at timestamptz not null default now()
);

-- Paths whose Storage objects should be deleted. Filled whenever an attachment
-- row goes, however it goes (message delete, conversation delete cascade).
create table if not exists tripp.storage_trash (
	path text primary key,
	queued_at timestamptz not null default now()
);

alter table tripp.attachments enable row level security;
alter table tripp.uploads enable row level security;
alter table tripp.storage_trash enable row level security;

create or replace function tripp.attachment_trash() returns trigger
language plpgsql set search_path = ''
as $$
begin
	insert into tripp.storage_trash (path) values (old.path) on conflict do nothing;
	return old;
end;
$$;

drop trigger if exists attachments_trash on tripp.attachments;
create trigger attachments_trash
	after delete on tripp.attachments
	for each row execute function tripp.attachment_trash();

-- Size of the ciphertext for p_plain bytes of file: AES-GCM adds a 16 byte tag
-- to each 1 MiB chunk, and an empty-looking file still has one chunk.
create or replace function tripp.cipher_size(p_plain bigint) returns bigint
language sql immutable set search_path = ''
as $$
	select p_plain + 16 * greatest(1, ceil(p_plain / 1048576.0))::bigint;
$$;

-- Internal: hand out an upload path. A guest reserves in their own
-- conversation; the admin names one. Old reservations are cleared here.
create or replace function tripp.media_reserve(p_token text, p_conversation bigint, p_kind text, p_bytes bigint)
returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_scope bigint := tripp.session_scope(p_token);
	v_target bigint;
	v_path text;
begin
	if v_scope is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	-- An expired reservation may still have an object that was uploaded but never posted; queue it.
	with d as (delete from tripp.uploads where created_at < now() - interval '1 day' returning path)
	insert into tripp.storage_trash (path) select path from d on conflict do nothing;
	if p_kind is null or p_kind not in ('file', 'audio', 'video') then
		return json_build_object('ok', false, 'error', 'bad_kind');
	end if;
	if p_bytes is null or p_bytes not between 1 and 26214400 then
		return json_build_object('ok', false, 'error', 'too_large');
	end if;
	v_target := case when v_scope > 0 then v_scope else p_conversation end;
	if not exists (select 1 from tripp.conversations c where c.id = v_target) then
		return json_build_object('ok', false, 'error', 'no_conversation');
	end if;
	if not exists (select 1 from tripp_keys.conversations k where k.conversation_id = v_target) then
		return json_build_object('ok', false, 'error', 'no_keys');
	end if;
	v_path := 'conversation/' || v_target || '/' || gen_random_uuid();
	insert into tripp.uploads (path, conversation_id, kind, bytes)
	values (v_path, v_target, p_kind, p_bytes);
	return json_build_object('ok', true, 'path', v_path);
end;
$$;

-- Internal: the Storage path of an attachment the caller may read. The other
-- person sees only their own conversation, without hidden or archived messages.
create or replace function tripp.media_readable(p_token text, p_attachment bigint)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
	v_scope bigint := tripp.session_scope(p_token);
	v_path text;
begin
	if v_scope is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	select a.path into v_path
	  from tripp.attachments a
	  join tripp.messages m on m.id = a.message_id
	 where a.id = p_attachment
	   and (v_scope = 0
	        or (a.conversation_id = v_scope and m.conversation_id = v_scope
	            and not m.hidden and not m.archived));
	if v_path is null then
		return json_build_object('ok', false, 'error', 'no_attachment');
	end if;
	return json_build_object('ok', true, 'path', v_path);
end;
$$;

-- Internal: up to p_limit queued paths, oldest first. They stay queued until
-- media_trash_done says the object is gone.
create or replace function tripp.media_trash_take(p_limit int) returns setof text
language sql stable security definer set search_path = ''
as $$
	select t.path from tripp.storage_trash t
	 order by t.queued_at, t.path
	 limit greatest(coalesce(p_limit, 0), 0);
$$;

create or replace function tripp.media_trash_done(p_paths text[]) returns void
language sql volatile security definer set search_path = ''
as $$
	delete from tripp.storage_trash where path = any (coalesce(p_paths, '{}'::text[]));
$$;

revoke all on function tripp.attachment_trash() from public, anon, authenticated;
revoke all on function tripp.cipher_size(bigint) from public, anon, authenticated;
revoke all on function tripp.media_reserve(text, bigint, text, bigint) from public, anon, authenticated;
revoke all on function tripp.media_readable(text, bigint) from public, anon, authenticated;
revoke all on function tripp.media_trash_take(int) from public, anon, authenticated;
revoke all on function tripp.media_trash_done(text[]) from public, anon, authenticated;

notify pgrst, 'reload schema';
