-- Tripp audit and keep-alive functions.
--
-- m_ping is called every few days by the keep-alive container so the free
-- Supabase project is never idle for a week and paused. It reads and writes
-- nothing and needs no password.
--
-- SECURITY DEFINER like every other public function here, so the security
-- advisor will flag it.
--
-- tripp.visits and tripp.events are the audit log. Each is append-only and
-- hash-chained: every row stores the hash of the row before it, and its own
-- hash covers that previous hash plus all of its own columns. Editing or
-- deleting any row, or removing one from the middle, breaks every hash after
-- it, and tripp.verify_chain finds the first bad row. A trigger refuses
-- UPDATE, DELETE and TRUNCATE unless the session sets tripp.purge to 'on'
-- (used only by the retention purge). log_visit and log_event are internal:
-- they are called from inside the SECURITY DEFINER m_* functions and are not
-- granted to the browser roles. Safe to run more than once.

-- sha256 of the previous hash, a bar, and the row's canonical json.
create or replace function tripp.chain_hash(p_prev text, p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
	select encode(sha256(convert_to(p_prev || '|' || p_payload::text, 'UTF8')), 'hex');
$$;

create table if not exists tripp.visits (
	id bigint generated always as identity primary key,
	at timestamptz not null,
	outcome text not null check (outcome in ('ok', 'denied', 'locked')),
	scope bigint,
	ip text,
	isp text,
	org text,
	country text,
	region text,
	city text,
	lat numeric,
	lon numeric,
	geo_source text,
	os text,
	browser text,
	user_agent text,
	prev_hash text not null,
	row_hash text not null unique
);

-- `scope` is 0 for the admin, the conversation id for a guest, null for the
-- system. `type` allows exactly the event types in the spec.
create table if not exists tripp.events (
	id bigint generated always as identity primary key,
	at timestamptz not null,
	scope bigint,
	visit_id bigint,
	type text not null check (type in (
		'login', 'login_failed', 'message', 'upload',
		'call_start', 'call_answer', 'call_end',
		'admin_hide', 'admin_archive', 'admin_delete',
		'admin_conv_save', 'admin_conv_delete', 'admin_key_change',
		'logout', 'consent_ack', 'admin_unhide', 'admin_unarchive',
		'admin_legal_hold', 'admin_retention_set', 'key_setup',
		'retention_purge'
	)),
	ref_id bigint,
	detail jsonb not null default '{}',
	prev_hash text not null,
	row_hash text not null unique
);

alter table tripp.visits enable row level security;
alter table tripp.events enable row level security;

-- The canonical json of a visit: every column except id and the two hashes.
-- Both the insert path and the verifier call this, so they cannot disagree.
create or replace function tripp.visit_payload(v tripp.visits)
returns jsonb
language sql
immutable
set search_path = ''
as $$
	select jsonb_build_object(
		'at', (extract(epoch from v.at) * 1000000)::bigint,
		'outcome', v.outcome,
		'scope', v.scope,
		'ip', v.ip,
		'isp', v.isp,
		'org', v.org,
		'country', v.country,
		'region', v.region,
		'city', v.city,
		'lat', v.lat,
		'lon', v.lon,
		'geo_source', v.geo_source,
		'os', v.os,
		'browser', v.browser,
		'user_agent', v.user_agent
	);
$$;

-- The canonical json of an event, built the same way.
create or replace function tripp.event_payload(e tripp.events)
returns jsonb
language sql
immutable
set search_path = ''
as $$
	select jsonb_build_object(
		'at', (extract(epoch from e.at) * 1000000)::bigint,
		'scope', e.scope,
		'visit_id', e.visit_id,
		'type', e.type,
		'ref_id', e.ref_id,
		'detail', e.detail
	);
$$;

-- Refuses to change or remove audit rows, unless the retention purge has set
-- tripp.purge to 'on' for this transaction.
create or replace function tripp.audit_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if coalesce(current_setting('tripp.purge', true), '') = 'on' then
		if tg_op = 'DELETE' then
			return old;
		end if;
		return new;
	end if;
	raise exception 'tripp.% is append-only', tg_table_name;
end;
$$;

drop trigger if exists visits_append_only on tripp.visits;
create trigger visits_append_only
	before update or delete on tripp.visits
	for each row execute function tripp.audit_append_only();
drop trigger if exists visits_no_truncate on tripp.visits;
create trigger visits_no_truncate
	before truncate on tripp.visits
	for each statement execute function tripp.audit_append_only();

drop trigger if exists events_append_only on tripp.events;
create trigger events_append_only
	before update or delete on tripp.events
	for each row execute function tripp.audit_append_only();
drop trigger if exists events_no_truncate on tripp.events;
create trigger events_no_truncate
	before truncate on tripp.events
	for each statement execute function tripp.audit_append_only();

-- Appends one visit to the chain and returns its id. The advisory lock makes
-- concurrent appends take turns, so each row sees the true previous hash.
-- Missing geo keys are stored as 'unknown' (null for lat and lon).
create or replace function tripp.log_visit(
	p_outcome text, p_scope bigint, p_ip text, p_ua text,
	p_os text, p_browser text, p_geo jsonb
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
	v tripp.visits;
	g jsonb := coalesce(p_geo, '{}'::jsonb);
	prev text;
begin
	perform pg_advisory_xact_lock(hashtext('tripp.visits'));
	select row_hash into prev from tripp.visits order by id desc limit 1;
	prev := coalesce(prev, repeat('0', 64));

	v.at := clock_timestamp();
	v.outcome := p_outcome;
	v.scope := p_scope;
	v.ip := p_ip;
	v.isp := coalesce(g ->> 'isp', 'unknown');
	v.org := coalesce(g ->> 'org', 'unknown');
	v.country := coalesce(g ->> 'country', 'unknown');
	v.region := coalesce(g ->> 'region', 'unknown');
	v.city := coalesce(g ->> 'city', 'unknown');
	v.lat := case when jsonb_typeof(g -> 'lat') = 'number' then (g ->> 'lat')::numeric end;
	v.lon := case when jsonb_typeof(g -> 'lon') = 'number' then (g ->> 'lon')::numeric end;
	v.geo_source := coalesce(g ->> 'source', 'unknown');
	v.os := p_os;
	v.browser := p_browser;
	v.user_agent := p_ua;
	v.prev_hash := prev;
	v.row_hash := tripp.chain_hash(prev, tripp.visit_payload(v));

	insert into tripp.visits (at, outcome, scope, ip, isp, org, country, region, city,
		lat, lon, geo_source, os, browser, user_agent, prev_hash, row_hash)
	values (v.at, v.outcome, v.scope, v.ip, v.isp, v.org, v.country, v.region, v.city,
		v.lat, v.lon, v.geo_source, v.os, v.browser, v.user_agent, v.prev_hash, v.row_hash)
	returning id into v.id;
	return v.id;
end;
$$;

-- Appends one event to the chain and returns its id. Same locking as log_visit.
create or replace function tripp.log_event(
	p_type text, p_scope bigint, p_visit bigint, p_ref bigint, p_detail jsonb
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
	e tripp.events;
	prev text;
begin
	perform pg_advisory_xact_lock(hashtext('tripp.events'));
	select row_hash into prev from tripp.events order by id desc limit 1;
	prev := coalesce(prev, repeat('0', 64));

	e.at := clock_timestamp();
	e.scope := p_scope;
	e.visit_id := p_visit;
	e.type := p_type;
	e.ref_id := p_ref;
	e.detail := coalesce(p_detail, '{}'::jsonb);
	e.prev_hash := prev;
	e.row_hash := tripp.chain_hash(prev, tripp.event_payload(e));

	insert into tripp.events (at, scope, visit_id, type, ref_id, detail, prev_hash, row_hash)
	values (e.at, e.scope, e.visit_id, e.type, e.ref_id, e.detail, e.prev_hash, e.row_hash)
	returning id into e.id;
	return e.id;
end;
$$;

-- Walks a chain from the first row and recomputes every hash. Returns
-- {"ok", "rows", "first_bad_id"}; the first row must start from the genesis
-- hash of 64 zeros. p_table is 'visits' or 'events'; anything else returns
-- {"ok": false, "error": "unknown_table"}.
create or replace function tripp.verify_chain(p_table text)
returns json
language plpgsql
set search_path = ''
as $$
declare
	prev text := repeat('0', 64);
	n bigint := 0;
	bad bigint;
	rv tripp.visits;
	re tripp.events;
begin
	if p_table = 'visits' then
		for rv in select * from tripp.visits order by id loop
			n := n + 1;
			if rv.prev_hash <> prev
				or rv.row_hash <> tripp.chain_hash(rv.prev_hash, tripp.visit_payload(rv)) then
				bad := rv.id;
				exit;
			end if;
			prev := rv.row_hash;
		end loop;
	elsif p_table = 'events' then
		for re in select * from tripp.events order by id loop
			n := n + 1;
			if re.prev_hash <> prev
				or re.row_hash <> tripp.chain_hash(re.prev_hash, tripp.event_payload(re)) then
				bad := re.id;
				exit;
			end if;
			prev := re.row_hash;
		end loop;
	else
		return json_build_object('ok', false, 'error', 'unknown_table');
	end if;
	return json_build_object('ok', bad is null, 'rows', n, 'first_bad_id', bad);
end;
$$;

revoke all on function tripp.chain_hash(text, jsonb) from public, anon, authenticated;
revoke all on function tripp.visit_payload(tripp.visits) from public, anon, authenticated;
revoke all on function tripp.event_payload(tripp.events) from public, anon, authenticated;
revoke all on function tripp.audit_append_only() from public, anon, authenticated;
revoke all on function tripp.log_visit(text, bigint, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function tripp.log_event(text, bigint, bigint, bigint, jsonb) from public, anon, authenticated;
revoke all on function tripp.verify_chain(text) from public, anon, authenticated;

-- Keep-alive.
create or replace function public.m_ping()
returns json
language sql
stable
security definer
set search_path = ''
as $$
	select json_build_object('ok', true);
$$;

revoke all on function public.m_ping() from public;
grant execute on function public.m_ping() to anon, authenticated;

notify pgrst, 'reload schema';
