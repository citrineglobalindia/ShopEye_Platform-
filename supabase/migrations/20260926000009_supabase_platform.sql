-- =====================================================================
-- SHOPEYE 0009 — Supabase platform wiring
-- service_role access for server routes/edge functions, signup → profile,
-- scheduled reservation expiry, launch defaults.
-- =====================================================================
set search_path = public, extensions;

-- Server-side code (Next.js route handlers, edge functions) uses service_role.
-- It still calls the same guarded functions; it just can reach app/finance.
grant usage on schema app, finance to service_role;
grant all on all tables in schema app, finance to service_role;
grant all on all sequences in schema app, finance to service_role;
grant execute on all functions in schema app, finance, public to service_role;
grant all on all tables in schema public to service_role;

-- Every Supabase Auth signup becomes an active customer profile (CUST §4)
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_name text; v_mobile text;
begin
  v_name := coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
                     nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Shopeye Customer');
  if char_length(v_name) < 2 then v_name := 'Shopeye Customer'; end if;
  v_mobile := case when new.phone is not null and new.phone <> '' then '+' || ltrim(new.phone, '+') end;
  if new.email is null and v_mobile is null then return new; end if;   -- anonymous sessions get no profile
  insert into public.profiles(id, full_name, email, mobile, terms_version, privacy_version, consent_at, marketing_consent)
  values (new.id, left(v_name, 100), new.email, v_mobile,
          new.raw_user_meta_data->>'terms_version', new.raw_user_meta_data->>'privacy_version',
          case when new.raw_user_meta_data ? 'terms_version' then now() end,
          coalesce((new.raw_user_meta_data->>'marketing_consent')::boolean, false))
  on conflict (id) do nothing;
  insert into public.user_roles(user_id, role_code) values (new.id, 'customer') on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- Launch defaults: serve all valid Indian pincodes (prepaid) until a
-- courier serviceability list is loaded; COD off until COD partner is live.
insert into app.settings(key, value, effective_from) values
  ('serviceability.all_india', 'true', '2000-01-01'),
  ('serviceability.all_india_cod', 'false', '2000-01-01');

-- Current and next accounting periods open
insert into finance.accounting_periods(starts_on, ends_on, status)
select d::date, (d + interval '1 month - 1 day')::date, 'open'
  from generate_series(date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', interval '1 month') d
on conflict do nothing;

-- Release expired checkout holds every minute
create extension if not exists pg_cron;
select cron.schedule('shopeye-expire-reservations', '* * * * *', $$select app.expire_reservations()$$);
