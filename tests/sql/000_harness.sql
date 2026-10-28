do $$ begin assert (select count(*) from tripp.admin_key) = 1, 'admin key row'; end $$;
