-- SHOPEYE 0012 — Pin search_path on every app/finance/public function (Supabase advisor 0011).
do $$ declare f record; begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('app','finance','public') and p.prokind = 'f'
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public, app, finance, extensions', f.sig);
  end loop;
end $$;
