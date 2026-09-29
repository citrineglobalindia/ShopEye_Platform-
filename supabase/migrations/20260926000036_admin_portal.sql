-- SHOPEYE 0036 — Super Admin portal foundation: dashboard KPIs, customer management, admin users & roles,
-- audit log viewer, and the caller's own access (drives the admin sidebar).
-- Traces: SA-FR-0040.. (dashboard), SA-FR customer management, SA-FR admin users/roles, SA-FR audit logs
set search_path = public, app, extensions;

insert into public.permissions(code, portal, description, sensitive) values
  ('customer.view',   'super_admin', 'View customer accounts and their order history', true),
  ('customer.manage', 'super_admin', 'Lock, suspend or reactivate customer accounts', true),
  ('dashboard.view',  'super_admin', 'View the admin dashboard', false)
on conflict (code) do nothing;
insert into public.role_permissions(role_code, permission_code)
select 'super_admin', code from public.permissions where code in ('customer.view','customer.manage','dashboard.view','admin.users.manage','audit.view')
on conflict do nothing;
insert into public.role_permissions(role_code, permission_code) values
  ('help_desk_lead','customer.view'), ('help_desk_agent','customer.view'), ('help_desk_lead','dashboard.view'),
  ('catalog_moderator','dashboard.view'), ('vendor_manager','dashboard.view'), ('accounts_head','dashboard.view'), ('auditor','audit.view'), ('auditor','dashboard.view')
on conflict do nothing;

-- What the signed-in admin can do (roles + permissions); the portal shows only what this allows
create or replace function public.admin_my_access() returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(distinct ur.role_code) from user_roles ur where ur.user_id = auth.uid() and ur.active and ur.revoked_at is null and ur.role_code not in ('customer','vendor_owner','vendor_staff')), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(distinct rp.permission_code) from user_roles ur join role_permissions rp on rp.role_code = ur.role_code
                             where ur.user_id = auth.uid() and ur.active and ur.revoked_at is null and ur.role_code not in ('customer','vendor_owner','vendor_staff')), '[]'::jsonb))
$$;
revoke execute on function public.admin_my_access() from public, anon; grant execute on function public.admin_my_access() to authenticated;

-- Dashboard: live counts and money, today / last 7 days, plus the queues that need someone
create or replace function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, app, extensions as $$
declare d timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  perform app.require_permission('dashboard.view');
  return jsonb_build_object(
    'orders_today',   (select count(*) from orders where placed_at >= d and payment_status = 'paid'),
    'gmv_today',      (select coalesce(sum(grand_total), 0) from orders where placed_at >= d and payment_status = 'paid'),
    'orders_7d',      (select count(*) from orders where placed_at >= now() - interval '7 days' and payment_status = 'paid'),
    'gmv_7d',         (select coalesce(sum(grand_total), 0) from orders where placed_at >= now() - interval '7 days' and payment_status = 'paid'),
    'aov_30d',        (select coalesce(round(avg(grand_total), 2), 0) from orders where placed_at >= now() - interval '30 days' and payment_status = 'paid'),
    'payment_failures_24h', (select count(*) from payments where status in ('failed') and created_at >= now() - interval '24 hours'),
    'awaiting_payment', (select count(*) from orders where status = 'pending_payment' and placed_at >= now() - interval '24 hours'),
    'to_ship',        (select count(*) from sub_orders where status in ('confirmed','packed','ready_to_ship')),
    'customers_total',(select count(*) from profiles),
    'customers_7d',   (select count(*) from profiles where created_at >= now() - interval '7 days'),
    'vendors_active', (select count(*) from vendors where status = 'active' and not is_demo),
    'vendor_applications', (select count(*) from vendors where status = 'submitted'),
    'listings_to_review',  (select count(*) from products where status = 'pending_review'),
    'products_live',  (select count(*) from products where status = 'active' and not is_demo),
    'preview_products', (select count(*) from products where status = 'active' and is_demo),
    'tickets_open',   (select count(*) from support_tickets where status not in ('resolved','closed')),
    'tickets_urgent', (select count(*) from support_tickets where status not in ('resolved','closed') and priority = 'urgent'),
    'refunds_pending',(select count(*) from refunds where approval_status = 'pending' or (approval_status in ('approved','not_required') and processor_status in ('not_sent','processing','failed'))),
    'reviews_pending',(select count(*) from product_reviews where status = 'pending'),
    'low_stock',      (select count(*) from (select p.id from products p join product_variants v on v.product_id = p.id and v.active left join stock_balances b on b.variant_id = v.id
                                               where p.status = 'active' and not p.is_demo group by p.id having coalesce(sum(b.available), 0) between 1 and 5) x),
    'out_of_stock',   (select count(*) from (select p.id from products p join product_variants v on v.product_id = p.id and v.active left join stock_balances b on b.variant_id = v.id
                                               where p.status = 'active' and not p.is_demo group by p.id having coalesce(sum(b.available), 0) <= 0) x),
    'sales_14d', (select coalesce(jsonb_agg(jsonb_build_object('day', dd::date, 'orders', coalesce(o.n, 0), 'gmv', coalesce(o.v, 0)) order by dd), '[]'::jsonb)
                    from generate_series((now() at time zone 'Asia/Kolkata')::date - 13, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') dd
                    left join (select (placed_at at time zone 'Asia/Kolkata')::date as d0, count(*) n, sum(grand_total) v from orders where payment_status = 'paid' and placed_at >= now() - interval '15 days' group by 1) o on o.d0 = dd::date),
    'recent_orders', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select o.id, o.order_number, o.status, o.payment_status, o.grand_total, o.placed_at, p.full_name
                        from orders o left join profiles p on p.id = o.customer_id order by o.placed_at desc limit 8) x),
    'generated_at', now());
end $$;
revoke execute on function public.admin_dashboard() from public, anon; grant execute on function public.admin_dashboard() to authenticated;

-- Customers: search and page through accounts with their order totals
create or replace function public.admin_list_customers(p_q text default null, p_status text default null, p_limit int default 50, p_offset int default 0)
returns table(id uuid, full_name text, email text, mobile text, status text, created_at timestamptz, orders bigint, spend numeric, last_order_at timestamptz, is_staff boolean, total bigint)
language plpgsql stable security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('customer.view');
  return query
  with base as (
    select pr.id, pr.full_name, pr.email::text, pr.mobile, pr.status::text, pr.created_at
      from profiles pr
     where (p_status is null or pr.status::text = p_status)
       and (p_q is null or btrim(p_q) = '' or pr.full_name ilike '%' || btrim(p_q) || '%' or pr.email::text ilike '%' || btrim(p_q) || '%'
            or coalesce(pr.mobile, '') like '%' || regexp_replace(btrim(p_q), '\D', '', 'g') || '%' and length(regexp_replace(btrim(p_q), '\D', '', 'g')) >= 4))
  select b.id, b.full_name, b.email, b.mobile, b.status, b.created_at,
         (select count(*) from orders o where o.customer_id = b.id and o.payment_status = 'paid'),
         (select coalesce(sum(o.grand_total), 0) from orders o where o.customer_id = b.id and o.payment_status = 'paid'),
         (select max(o.placed_at) from orders o where o.customer_id = b.id),
         exists (select 1 from user_roles ur where ur.user_id = b.id and ur.active and ur.revoked_at is null and ur.role_code not in ('customer','vendor_owner','vendor_staff')),
         count(*) over ()
    from base b order by b.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke execute on function public.admin_list_customers(text, text, int, int) from public, anon; grant execute on function public.admin_list_customers(text, text, int, int) to authenticated;

create or replace function public.admin_customer_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('customer.view');
  if not exists (select 1 from profiles where id = p_id) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(x) from (select id, full_name, email, mobile, status, created_at, marketing_consent, terms_version, consent_at from profiles where id = p_id) x),
    'roles', (select coalesce(jsonb_agg(role_code), '[]'::jsonb) from user_roles where user_id = p_id and active and revoked_at is null),
    'orders', (select coalesce(jsonb_agg(x order by x.placed_at desc), '[]'::jsonb) from (select id, order_number, status, payment_status, grand_total, placed_at from orders where customer_id = p_id order by placed_at desc limit 20) x),
    'addresses', (select count(*) from customer_addresses where customer_id = p_id and archived_at is null),
    'tickets', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (select id, ticket_number, subject, status, priority, created_at from support_tickets where customer_id = p_id order by created_at desc limit 10) x),
    'balance', (select coalesce(sum(remaining), 0) from wallet_lots where customer_id = p_id and remaining > 0 and (expires_at is null or expires_at > now())),
    'history', (select coalesce(jsonb_agg(x order by x.occurred_at desc), '[]'::jsonb) from (select a.occurred_at, a.action, a.reason, a.after_value->>'status' as status, pa.email::text as by_email
                  from app.audit_log a left join profiles pa on pa.id = a.actor_id where a.entity_type = 'profiles' and a.entity_id = p_id::text order by a.occurred_at desc limit 20) x));
end $$;
revoke execute on function public.admin_customer_detail(uuid) from public, anon; grant execute on function public.admin_customer_detail(uuid) to authenticated;

-- Lock / suspend / reactivate a customer, always with a reason, never on staff accounts or yourself
create or replace function public.admin_set_customer_status(p_id uuid, p_status text, p_reason text) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
declare old text;
begin
  perform app.require_permission('customer.manage');
  if p_status not in ('active','locked','suspended') then raise exception 'BAD_STATUS: choose active, locked or suspended' using errcode = 'P0001'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED: give a reason of at least 5 characters' using errcode = 'P0001'; end if;
  if p_id = auth.uid() then raise exception 'NOT_ALLOWED: you can''t change your own account status' using errcode = 'P0001'; end if;
  if exists (select 1 from user_roles where user_id = p_id and active and revoked_at is null and role_code not in ('customer','vendor_owner','vendor_staff')) then
    raise exception 'NOT_ALLOWED: this is a staff account; remove its admin roles first' using errcode = 'P0001'; end if;
  select status::text into old from profiles where id = p_id for update;
  if old is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform set_config('app.audit_reason', btrim(p_reason), true);
  update profiles set status = p_status::account_status where id = p_id;
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, before_value, after_value, reason)
  values (auth.uid(), 'super_admin', 'customer.status', 'profiles', p_id::text, jsonb_build_object('status', old), jsonb_build_object('status', p_status), btrim(p_reason));
  return p_status;
end $$;
revoke execute on function public.admin_set_customer_status(uuid, text, text) from public, anon; grant execute on function public.admin_set_customer_status(uuid, text, text) to authenticated;

-- Admin users & roles (staff only; seller roles are managed with their shop)
create or replace function public.admin_list_staff() returns table(user_id uuid, full_name text, email text, status text, roles text[], last_granted timestamptz)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_permission('admin.users.manage');
  return query select pr.id, pr.full_name, pr.email::text, pr.status::text, array_agg(ur.role_code order by ur.role_code), max(ur.granted_at)
    from user_roles ur join profiles pr on pr.id = ur.user_id
   where ur.active and ur.revoked_at is null and ur.role_code not in ('customer','vendor_owner','vendor_staff')
   group by pr.id order by pr.full_name;
end $$;
revoke execute on function public.admin_list_staff() from public, anon; grant execute on function public.admin_list_staff() to authenticated;

create or replace function public.admin_list_roles() returns table(code text, name text, permissions text[])
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_permission('admin.users.manage');
  return query select r.code, r.name::text, coalesce(array_agg(rp.permission_code order by rp.permission_code) filter (where rp.permission_code is not null), '{}')
    from roles r left join role_permissions rp on rp.role_code = r.code
   where r.code not in ('customer','vendor_owner','vendor_staff') group by r.code, r.name order by r.code;
end $$;
revoke execute on function public.admin_list_roles() from public, anon; grant execute on function public.admin_list_roles() to authenticated;

create or replace function public.admin_grant_role(p_email text, p_role text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, app, extensions as $$
declare u uuid;
begin
  perform app.require_permission('admin.users.manage');
  if p_role in ('customer','vendor_owner','vendor_staff') or not exists (select 1 from roles where code = p_role) then raise exception 'BAD_ROLE: choose a staff role' using errcode = 'P0001'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED: give a reason of at least 5 characters' using errcode = 'P0001'; end if;
  select id into u from profiles where lower(email::text) = lower(btrim(p_email));
  if u is null then raise exception 'NOT_FOUND: no ShopEye account uses that email; ask them to sign up first' using errcode = 'P0002'; end if;
  if exists (select 1 from user_roles where user_id = u and role_code = p_role and active and revoked_at is null) then return u; end if;
  insert into user_roles(user_id, role_code, granted_by) values (u, p_role, auth.uid());
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, after_value, reason)
  values (auth.uid(), 'super_admin', 'role.grant', 'user_roles', u::text, jsonb_build_object('role', p_role, 'email', lower(btrim(p_email))), btrim(p_reason));
  return u;
end $$;
revoke execute on function public.admin_grant_role(text, text, text) from public, anon; grant execute on function public.admin_grant_role(text, text, text) to authenticated;

create or replace function public.admin_revoke_role(p_user uuid, p_role text, p_reason text) returns boolean
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('admin.users.manage');
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED: give a reason of at least 5 characters' using errcode = 'P0001'; end if;
  if p_user = auth.uid() and p_role = 'super_admin' then raise exception 'NOT_ALLOWED: you can''t remove your own super admin role' using errcode = 'P0001'; end if;
  if p_role = 'super_admin' and (select count(distinct user_id) from user_roles where role_code = 'super_admin' and active and revoked_at is null) <= 1 then
    raise exception 'NOT_ALLOWED: there must always be at least one super admin' using errcode = 'P0001'; end if;
  update user_roles set active = false, revoked_at = now() where user_id = p_user and role_code = p_role and active and revoked_at is null;
  if not found then return false; end if;
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, before_value, reason)
  values (auth.uid(), 'super_admin', 'role.revoke', 'user_roles', p_user::text, jsonb_build_object('role', p_role), btrim(p_reason));
  return true;
end $$;
revoke execute on function public.admin_revoke_role(uuid, text, text) from public, anon; grant execute on function public.admin_revoke_role(uuid, text, text) to authenticated;

-- Audit log viewer (newest first, filterable, paged by id)
create or replace function public.admin_audit_log(p_entity text default null, p_action text default null, p_before bigint default null, p_limit int default 50)
returns table(id bigint, occurred_at timestamptz, actor_email text, actor_role text, portal text, action text, entity_type text, entity_id text, before_value jsonb, after_value jsonb, reason text)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_permission('audit.view');
  return query select a.id, a.occurred_at, pr.email::text, a.actor_role, a.portal, a.action, a.entity_type, a.entity_id, a.before_value, a.after_value, a.reason
    from app.audit_log a left join profiles pr on pr.id = a.actor_id
   where (p_entity is null or a.entity_type = p_entity) and (p_action is null or a.action ilike '%' || p_action || '%') and (p_before is null or a.id < p_before)
   order by a.id desc limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;
revoke execute on function public.admin_audit_log(text, text, bigint, int) from public, anon; grant execute on function public.admin_audit_log(text, text, bigint, int) to authenticated;
