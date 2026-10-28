-- Tripp audit and keep-alive functions.
--
-- m_ping is called every few days by the keep-alive container so the free
-- Supabase project is never idle for a week and paused. It reads and writes
-- nothing and needs no password.
--
-- SECURITY DEFINER like every other public function here, so the security
-- advisor will flag it. Safe to run more than once.

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
