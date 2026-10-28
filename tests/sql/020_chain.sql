-- Hash-chained audit tables: events.
do $$
declare
	a bigint; b bigint; ra tripp.events; rb tripp.events; v text; r json;
begin
	a := tripp.log_event('login', 0, null, null, '{"k":1}');
	b := tripp.log_event('message', 0, null, 5, '{}');
	select * into ra from tripp.events where id = a;
	select * into rb from tripp.events where id = b;
	assert ra.prev_hash = repeat('0', 64), 'first event uses genesis hash';
	assert rb.prev_hash = ra.row_hash, 'second event chains to first';
	assert (tripp.verify_chain('events') ->> 'ok') = 'true', 'events chain verifies';
	assert (tripp.verify_chain('events') ->> 'rows')::int = 2, 'events row count';

	begin
		update tripp.events set detail = '{"x":2}' where id = a;
	exception when others then v := sqlerrm;
	end;
	assert v like '%append-only%', 'update on events raises append-only, got: ' || coalesce(v, 'nothing');
	v := null;
	begin
		delete from tripp.events where id = a;
	exception when others then v := sqlerrm;
	end;
	assert v like '%append-only%', 'delete on events raises append-only';
	v := null;
	begin
		perform tripp.log_event('bogus', 0, null, null, '{}');
	exception when others then v := sqlerrm;
	end;
	assert v is not null, 'unknown event type rejected';

	alter table tripp.events disable trigger user;
	update tripp.events set detail = '{"x":1}' where id = a;
	alter table tripp.events enable trigger user;
	r := tripp.verify_chain('events');
	assert (r ->> 'ok') = 'false', 'tampered events chain fails';
	assert (r ->> 'first_bad_id')::bigint = a, 'first_bad_id is the tampered event';
end $$;

-- visits.
do $$
declare
	a bigint; b bigint; ra tripp.visits; rb tripp.visits; v text; r json;
begin
	a := tripp.log_visit('ok', 0, '1.2.3.4', 'UA', 'Windows', 'Chrome',
		'{"isp":"I","country":"CA","lat":43.65,"lon":-79.38,"source":"x"}');
	b := tripp.log_visit('denied', null, '5.6.7.8', 'UA', 'Mac', 'Safari', '{}');
	select * into ra from tripp.visits where id = a;
	select * into rb from tripp.visits where id = b;
	assert ra.prev_hash = repeat('0', 64), 'first visit uses genesis hash';
	assert rb.prev_hash = ra.row_hash, 'second visit chains to first';
	assert rb.city = 'unknown' and rb.lat is null, 'missing geo keys default';
	assert ra.lat = 43.65, 'lat stored';
	assert (tripp.verify_chain('visits') ->> 'ok') = 'true', 'visits chain verifies';

	begin
		update tripp.visits set ip = 'x' where id = a;
	exception when others then v := sqlerrm;
	end;
	assert v like '%append-only%', 'update on visits raises append-only';
	v := null;
	begin
		delete from tripp.visits where id = a;
	exception when others then v := sqlerrm;
	end;
	assert v like '%append-only%', 'delete on visits raises append-only';

	alter table tripp.visits disable trigger user;
	update tripp.visits set ip = '9.9.9.9' where id = a;
	alter table tripp.visits enable trigger user;
	r := tripp.verify_chain('visits');
	assert (r ->> 'ok') = 'false', 'tampered visits chain fails';
	assert (r ->> 'first_bad_id')::bigint = a, 'first_bad_id is the tampered visit';
end $$;

-- Purge escape hatch.
do $$
begin
	perform tripp.log_event('login', 0, null, null, '{}');
	perform set_config('tripp.purge', 'on', true);
	delete from tripp.events;
	perform set_config('tripp.purge', 'off', true);
	assert (select count(*) from tripp.events) = 0, 'purge setting allows delete';
end $$;

-- concurrent_chain: appends are serialized by an advisory lock.
do $$
begin
	assert pg_get_functiondef('tripp.log_event'::regproc) like '%pg_advisory_xact_lock%', 'log_event takes advisory lock';
	assert pg_get_functiondef('tripp.log_visit'::regproc) like '%pg_advisory_xact_lock%', 'log_visit takes advisory lock';
	assert not has_function_privilege('anon', 'tripp.log_event(text,bigint,bigint,bigint,jsonb)', 'execute'), 'anon cannot log_event';
end $$;
