-- Tripp key store.
--
-- Files are encrypted in the browser, so the server holds only ciphertext.
-- Each conversation has one key (the DEK), stored here twice:
--   wrapped_owner: the DEK under the owner's RSA-OAEP public key. The owner's
--     private key is kept in tripp_keys.owner, wrapped (AES-GCM) under a key
--     derived from the owner's passphrase, so only the owner's browser can open it.
--   wrapped_guest: the DEK under an AES-GCM key derived from the conversation
--     password (salt, iv and iterations alongside it).
-- Nothing here is plaintext key material apart from the public key.
--
-- The private schema `tripp_keys` is not exposed to the Data API. The browser
-- reaches it only through the m_* functions below, which are SECURITY DEFINER
-- and check the session token themselves, like the ones in schema.sql. The
-- security advisor will flag them.
--
-- Safe to run more than once.

create schema if not exists tripp_keys;
revoke all on schema tripp_keys from public, anon, authenticated;

create table if not exists tripp_keys.owner (
	id int primary key default 1 check (id = 1),
	public_jwk jsonb not null,
	wrapped_private text not null,
	private_iv text not null,
	kdf text not null default 'pbkdf2-sha256',
	kdf_salt text not null,
	kdf_iterations int not null,
	keyfile boolean not null default false,
	created_at timestamptz default now()
);

create table if not exists tripp_keys.conversations (
	conversation_id bigint primary key references tripp.conversations (id) on delete cascade,
	wrapped_owner text not null,
	wrapped_guest text null,
	guest_salt text null,
	guest_iv text null,
	guest_iterations int null,
	changed_at timestamptz default now()
);

-- Defence in depth: no policies, so nothing but the table owner reads these.
alter table tripp_keys.owner enable row level security;
alter table tripp_keys.conversations enable row level security;
revoke all on all tables in schema tripp_keys from public, anon, authenticated;

-- API: the key material the caller needs.
-- A guest gets the public key (to wrap a new conversation key for the owner)
-- and its own conversation's guest wrap; p_conversation is ignored.
-- The admin gets the wrapped private key with its KDF parameters, and the
-- owner wrap for the conversation it names.
create or replace function public.m_keys(p_token text, p_conversation bigint default null)
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
		return json_build_object('ok', true,
			'public_jwk', (select o.public_jwk from tripp_keys.owner o where o.id = 1),
			'conv', (select json_build_object(
					'wrapped_guest', k.wrapped_guest,
					'guest_salt', k.guest_salt,
					'guest_iv', k.guest_iv,
					'guest_iterations', k.guest_iterations)
				  from tripp_keys.conversations k
				 where k.conversation_id = v_scope));
	end if;

	return json_build_object('ok', true,
		'owner', (select json_build_object(
				'public_jwk', o.public_jwk,
				'wrapped_private', o.wrapped_private,
				'private_iv', o.private_iv,
				'kdf', o.kdf,
				'kdf_salt', o.kdf_salt,
				'kdf_iterations', o.kdf_iterations)
			  from tripp_keys.owner o where o.id = 1),
		'conv', (select json_build_object('wrapped_owner', k.wrapped_owner)
			  from tripp_keys.conversations k
			 where k.conversation_id = p_conversation));
end;
$$;

-- API, admin only: store the owner keypair, once. A second call returns
-- `exists` and changes nothing.
create or replace function public.m_key_setup(
	p_token text, p_public_jwk jsonb, p_wrapped_private text, p_private_iv text,
	p_kdf_salt text, p_iterations int
)
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
	if p_public_jwk is null or coalesce(p_wrapped_private, '') = '' or coalesce(p_private_iv, '') = ''
	   or coalesce(p_kdf_salt, '') = '' or coalesce(p_iterations, 0) <= 0 then
		return json_build_object('ok', false, 'error', 'bad_input');
	end if;
	insert into tripp_keys.owner (id, public_jwk, wrapped_private, private_iv, kdf_salt, kdf_iterations)
	values (1, p_public_jwk, p_wrapped_private, p_private_iv, p_kdf_salt, p_iterations)
	on conflict (id) do nothing;
	if not found then
		return json_build_object('ok', false, 'error', 'exists');
	end if;
	perform tripp.log_event('key_setup', 0, tripp.token_visit(p_token), null, null);
	return json_build_object('ok', true);
end;
$$;

-- API: store a conversation's wrapped keys. Needs the owner keypair first
-- (`no_keys`).
-- A guest passes null for p_conversation and always writes its own
-- conversation, and only when it has no key row yet (`exists` otherwise).
-- The admin may insert a row, or replace the guest fields of an existing one;
-- on a replace, wrapped_owner is kept.
create or replace function public.m_key_conv(
	p_token text, p_conversation bigint, p_wrapped_owner text, p_wrapped_guest text,
	p_guest_salt text, p_guest_iv text, p_guest_iterations int
)
returns json
language plpgsql volatile security definer set search_path = ''
as $$
declare
	v_scope bigint := tripp.session_scope(p_token);
	v_target bigint;
begin
	if v_scope is null then
		return json_build_object('ok', false, 'error', 'expired');
	end if;
	if not exists (select 1 from tripp_keys.owner o where o.id = 1) then
		return json_build_object('ok', false, 'error', 'no_keys');
	end if;
	v_target := case when v_scope > 0 then v_scope else p_conversation end;
	if not exists (select 1 from tripp.conversations c where c.id = v_target) then
		return json_build_object('ok', false, 'error', 'no_conversation');
	end if;

	if v_scope > 0 then
		if coalesce(p_wrapped_owner, '') = '' then
			return json_build_object('ok', false, 'error', 'bad_input');
		end if;
		insert into tripp_keys.conversations
			(conversation_id, wrapped_owner, wrapped_guest, guest_salt, guest_iv, guest_iterations)
		values (v_target, p_wrapped_owner, p_wrapped_guest, p_guest_salt, p_guest_iv, p_guest_iterations)
		on conflict (conversation_id) do nothing;
		if not found then
			return json_build_object('ok', false, 'error', 'exists');
		end if;
		return json_build_object('ok', true);
	end if;

	update tripp_keys.conversations
	   set wrapped_guest = p_wrapped_guest,
	       guest_salt = p_guest_salt,
	       guest_iv = p_guest_iv,
	       guest_iterations = p_guest_iterations,
	       changed_at = now()
	 where conversation_id = v_target;
	if found then
		return json_build_object('ok', true);
	end if;
	if coalesce(p_wrapped_owner, '') = '' then
		return json_build_object('ok', false, 'error', 'bad_input');
	end if;
	insert into tripp_keys.conversations
		(conversation_id, wrapped_owner, wrapped_guest, guest_salt, guest_iv, guest_iterations)
	values (v_target, p_wrapped_owner, p_wrapped_guest, p_guest_salt, p_guest_iv, p_guest_iterations);
	return json_build_object('ok', true);
end;
$$;

-- API, admin only: every key row, for an offline backup. All ciphertext apart
-- from the public key.
create or replace function public.m_keys_backup(p_token text) returns json
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
	return json_build_object('ok', true,
		'owner', (select row_to_json(o) from tripp_keys.owner o where o.id = 1),
		'conversations', (select coalesce(json_agg(row_to_json(k) order by k.conversation_id), '[]'::json)
		                    from tripp_keys.conversations k),
		'exported_at', now());
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function. Take that away and
-- grant only what the browser needs.
revoke all on function public.m_keys(text, bigint) from public;
revoke all on function public.m_key_setup(text, jsonb, text, text, text, int) from public;
revoke all on function public.m_key_conv(text, bigint, text, text, text, text, int) from public;
revoke all on function public.m_keys_backup(text) from public;

grant execute on function public.m_keys(text, bigint) to anon, authenticated;
grant execute on function public.m_key_setup(text, jsonb, text, text, text, int) to anon, authenticated;
grant execute on function public.m_key_conv(text, bigint, text, text, text, text, int) to anon, authenticated;
grant execute on function public.m_keys_backup(text) to anon, authenticated;

notify pgrst, 'reload schema';
