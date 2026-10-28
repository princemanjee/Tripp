do $$ begin
	assert (public.m_ping() ->> 'ok')::boolean, 'm_ping returns ok true';
	assert has_function_privilege('anon', 'public.m_ping()', 'execute'), 'anon can execute m_ping';
end $$;
