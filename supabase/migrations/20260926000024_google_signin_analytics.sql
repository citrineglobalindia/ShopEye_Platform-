-- SHOPEYE 0024 — Google sign-in consent and sign-in-method alerts; consented, server-side GA4 purchase events.
-- Traces: CUST-FR-015 CUST-FR-022 (Google sign-up records terms/privacy acceptance; adding a sign-in method is recorded and emailed)
--         CUST-FR-186 CUST-FR-188 (purchase sent once from the server on payment; only a consented GA client id, never user identity)
set search_path = public, extensions;

-- ---------- Terms/privacy acceptance for sign-ups that didn't go through our email form (CUST-FR-015) ----------
insert into app.settings(key, value, effective_from) values ('legal.terms_version', '"2026-09"', '2000-01-01'), ('legal.privacy_version', '"2026-09"', '2000-01-01')
on conflict do nothing;
create or replace function public.record_consent() returns jsonb
language plpgsql security definer set search_path = public, app, extensions as $$
declare t text := (app.setting('legal.terms_version'))#>>'{}'; p text := (app.setting('legal.privacy_version'))#>>'{}';
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  update profiles set terms_version = t, privacy_version = p, consent_at = now()
   where id = auth.uid() and (terms_version is distinct from t or privacy_version is distinct from p);
  return jsonb_build_object('terms_version', t, 'privacy_version', p);
end $$;
create or replace function public.needs_consent() returns boolean
language sql stable security definer set search_path = public, app, extensions as $$
  select coalesce((select terms_version is distinct from (app.setting('legal.terms_version'))#>>'{}' from profiles where id = auth.uid()), false)
$$;

-- ---------- New sign-in method on an existing account (CUST-FR-022) ----------
alter table public.security_events drop constraint if exists security_events_kind_check;
alter table public.security_events add constraint security_events_kind_check check (kind in
  ('signed_in','email_changed','email_change_requested','signed_out_other_devices','reverified','data_exported','sign_in_method_added'));
create or replace function app.on_identity_added() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare v_label text := case new.provider when 'google' then 'Google' when 'apple' then 'Apple' else initcap(new.provider) end;
begin
  if new.provider = 'email' or not exists (select 1 from profiles where id = new.user_id) then return new; end if;
  -- a brand-new account signing up with Google is not a "change"; only an extra method on an existing account is
  if not exists (select 1 from auth.identities i where i.user_id = new.user_id and i.id <> new.id) then return new; end if;
  insert into security_events(customer_id, kind, detail) values (new.user_id, 'sign_in_method_added', jsonb_build_object('method', v_label));
  perform app.enqueue_email('security_notice', new.user_id, 'identity_added:' || new.id, 'A new sign-in method was added to your ShopEye account',
    'New sign-in method added', '<p>You can now sign in to ShopEye with <strong>' || app.esc(v_label) || '</strong>, as well as your email code. This happened at '
    || to_char(now() at time zone 'Asia/Kolkata', 'HH12:MI AM, DD Mon YYYY') || ' IST.</p>'
    || '<p style="color:#5E6682;font-size:13px">If this wasn''t you, sign in, sign out other devices from My account and contact us from Help. This is a security message and can''t be switched off.</p>');
  return new;
exception when others then
  raise warning 'ShopEye sign-in method alert not recorded: %', sqlerrm; return new;   -- never block sign-in
end $$;
drop trigger if exists on_auth_identity_added on auth.identities;
create trigger on_auth_identity_added after insert on auth.identities for each row execute function app.on_identity_added();

-- ---------- GA4 purchase from the server, only for shoppers who accepted analytics (CUST-FR-186/188) ----------
alter table public.orders add column if not exists analytics_client_id text check (analytics_client_id is null or analytics_client_id ~ '^[0-9]{5,12}\.[0-9]{9,11}$');
create table app.analytics_outbox (
  id          bigint generated always as identity primary key,
  order_id    uuid not null unique references public.orders(id),   -- one purchase event per order, however often payment callbacks repeat
  payload     jsonb not null,
  status      text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts    int not null default 0,
  request_id  bigint,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
revoke all on app.analytics_outbox from anon, authenticated;

create or replace function app.enqueue_purchase(p_order uuid) returns void language plpgsql security definer set search_path = public, app, extensions as $$
declare o orders;
begin
  select * into o from orders where id = p_order;
  if o.analytics_client_id is null or o.payment_status <> 'paid' then return; end if;
  insert into app.analytics_outbox(order_id, payload) values (o.id, jsonb_build_object(
    'client_id', o.analytics_client_id,
    'non_personalized_ads', true,
    'events', jsonb_build_array(jsonb_build_object('name', 'purchase', 'params', jsonb_build_object(
      'transaction_id', o.order_number, 'currency', 'INR', 'value', o.grand_total, 'shipping', o.shipping_total,
      'coupon', o.coupon_code, 'engagement_time_msec', 1,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('item_id', oi.product_snapshot->>'sku', 'item_name', left(oi.product_snapshot->>'title', 100),
                                                             'price', oi.unit_price, 'quantity', oi.qty, 'discount', oi.discount) order by oi.id), '[]'::jsonb)
                  from order_items oi where oi.order_id = o.id))))))
  on conflict (order_id) do nothing;
end $$;
create or replace function app.on_order_paid_analytics() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then perform app.enqueue_purchase(new.id); end if;
  return new;
exception when others then
  raise warning 'ShopEye analytics event not queued: %', sqlerrm; return new;   -- analytics never blocks an order
end $$;
create trigger orders_paid_analytics after update of payment_status on public.orders for each row execute function app.on_order_paid_analytics();

-- The browser hands over its GA client id once, right after checkout, only if the shopper accepted analytics
create or replace function public.set_order_analytics(p_order uuid, p_client_id text) returns boolean
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_client_id !~ '^[0-9]{5,12}\.[0-9]{9,11}$' then raise exception 'INVALID_CLIENT_ID' using errcode = 'P0001'; end if;
  update orders set analytics_client_id = p_client_id where id = p_order and customer_id = auth.uid() and analytics_client_id is null;
  if not found then return false; end if;
  perform app.enqueue_purchase(p_order);        -- payment may already have been confirmed
  return true;
end $$;

revoke execute on function public.record_consent(), public.needs_consent(), public.set_order_analytics(uuid, text) from public, anon;
grant execute on function public.record_consent(), public.needs_consent(), public.set_order_analytics(uuid, text) to authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.is_vendor_member(uuid), app.has_permission(text, uuid, uuid), app.actor_id() to anon, authenticated;
