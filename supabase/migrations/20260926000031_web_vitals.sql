-- SHOPEYE 0031 — Real-visitor page speed (Core Web Vitals), first-party and anonymous.
-- Each page load reports LCP, INP, CLS, FCP and TTFB with the page type and device class only: no user id,
-- no IP address, no cookies, so it needs no consent. Admin sees the 75th percentile against Google's thresholds.
-- Traces: CUST-FR-153
set search_path = public, extensions;

create table public.web_vitals (
  id          bigint generated always as identity primary key,
  metric      text not null check (metric in ('LCP','INP','CLS','FCP','TTFB')),
  value       double precision not null check (value >= 0 and value < 120000),
  page        text not null check (page in ('home','department','category','product','search','cart','checkout','account','store','other')),
  device      text not null check (device in ('mobile','desktop')),
  conn        text check (conn is null or conn in ('slow-2g','2g','3g','4g')),
  created_at  timestamptz not null default now()
);
create index web_vitals_recent_idx on public.web_vitals(created_at desc);
alter table public.web_vitals enable row level security;
revoke all on public.web_vitals from anon, authenticated;

insert into public.permissions(code, portal, description, sensitive) values ('analytics.view', 'super_admin', 'View site speed and usage reports', false) on conflict (code) do nothing;
insert into public.role_permissions(role_code, permission_code) values ('super_admin', 'analytics.view') on conflict do nothing;

-- Browsers send up to 8 measurements per page view; anything malformed is dropped rather than failing the page
create or replace function public.record_vitals(p_rows jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 8 then return 0; end if;
  insert into web_vitals(metric, value, page, device, conn)
  select r->>'metric', (r->>'value')::double precision, r->>'page', r->>'device', nullif(r->>'conn', '')
    from jsonb_array_elements(p_rows) r
   where r->>'metric' in ('LCP','INP','CLS','FCP','TTFB')
     and (r->>'value') ~ '^[0-9]+(\.[0-9]+)?$' and (r->>'value')::double precision < 120000
     and r->>'page' in ('home','department','category','product','search','cart','checkout','account','store','other')
     and r->>'device' in ('mobile','desktop')
     and coalesce(r->>'conn', '') in ('', 'slow-2g','2g','3g','4g');
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.record_vitals(jsonb) from public;
grant execute on function public.record_vitals(jsonb) to anon, authenticated;

-- p75 per metric, overall and per page type, with Google's "good" thresholds
create or replace function public.admin_vitals(p_days int default 28) returns jsonb
language plpgsql stable security definer set search_path = public, app, extensions as $$
declare since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 28), 1), 90));
begin
  perform app.require_permission('analytics.view');
  return jsonb_build_object(
    'since', since,
    'thresholds', jsonb_build_object('LCP', jsonb_build_array(2500, 4000), 'INP', jsonb_build_array(200, 500), 'CLS', jsonb_build_array(0.1, 0.25), 'FCP', jsonb_build_array(1800, 3000), 'TTFB', jsonb_build_array(800, 1800)),
    'rows', (select coalesce(jsonb_agg(x order by x->>'page', x->>'device', x->>'metric'), '[]'::jsonb) from (
      select jsonb_build_object('page', coalesce(page, 'all'), 'device', coalesce(device, 'all'), 'metric', metric,
                                'p75', round((percentile_cont(0.75) within group (order by value))::numeric, 3), 'samples', count(*)) as x
        from web_vitals where created_at >= since
       group by grouping sets ((metric), (metric, device), (metric, page), (metric, page, device))) q));
end $$;
revoke execute on function public.admin_vitals(int) from public, anon;
grant execute on function public.admin_vitals(int) to authenticated;

create or replace function app.prune_web_vitals() returns int language sql security definer set search_path = public as $$
  with d as (delete from web_vitals where created_at < now() - interval '90 days' returning 1) select count(*)::int from d
$$;
revoke execute on function app.prune_web_vitals() from public, anon, authenticated;
