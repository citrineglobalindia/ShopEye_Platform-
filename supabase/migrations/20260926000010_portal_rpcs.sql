-- =====================================================================
-- SHOPEYE 0010 — Portal RPCs (seller onboarding, catalogue, moderation,
-- fulfilment, admin read models). Every function re-checks permissions,
-- so the browser can call them with the user's own session: no service
-- key is needed for these flows.
-- Traces: VS-FR §3 §7 §9 §12, SA-FR §6 §8 §11 §13, CUST §9
-- =====================================================================
set search_path = public, extensions;

create or replace function app.slugify(p text) returns text language sql immutable as $$
  select trim(both '-' from lower(regexp_replace(coalesce(p,''), '[^a-zA-Z0-9]+', '-', 'g')))
$$;

-- ---------------------------------------------------------------------
-- Seller onboarding (VS-FR §3): creates vendor (submitted), owner role,
-- and a pickup warehouse. Idempotent per user.
-- ---------------------------------------------------------------------
create or replace function public.apply_as_vendor(
  p_legal_name text, p_display_name text, p_mobile text, p_gstin text, p_pickup_pincode text, p_address jsonb)
returns uuid language plpgsql security definer set search_path = public, app, extensions as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_email text; v_code text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select id into v_id from vendors where created_by = v_uid limit 1;
  if v_id is not null then return v_id; end if;
  select email into v_email from profiles where id = v_uid;
  if v_email is null then raise exception 'EMAIL_REQUIRED: add an email to your profile first'; end if;
  if p_pickup_pincode !~ '^[1-9][0-9]{5}$' then raise exception 'INVALID_PINCODE'; end if;

  insert into vendors(legal_name, display_name, slug, gstin, contact_email, contact_mobile, registered_address, created_by)
  values (btrim(p_legal_name), btrim(p_display_name),
          app.slugify(p_display_name) || '-' || substr(md5(v_uid::text), 1, 4),
          nullif(upper(btrim(p_gstin)), ''), v_email, nullif(btrim(p_mobile), ''), coalesce(p_address, '{}'::jsonb), v_uid)
  returning id, vendor_code into v_id, v_code;
  update vendors set status = 'submitted' where id = v_id;
  insert into user_roles(user_id, role_code, vendor_id, granted_by) values (v_uid, 'vendor_owner', v_id, v_uid);
  insert into warehouses(code, name, owner_type, vendor_id, pincode, address)
  values ('WH-' || v_code, btrim(p_display_name) || ' pickup', 'vendor', v_id, p_pickup_pincode, coalesce(p_address, '{}'::jsonb));
  return v_id;
end $$;

-- Current user's vendor (full row for the owner; column grants hide it elsewhere)
create or replace function public.my_vendor() returns jsonb
language sql stable security definer set search_path = public, app, extensions as $$
  select to_jsonb(v) - 'pan_last4' from vendors v
   where exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.vendor_id = v.id and ur.active)
   limit 1
$$;

-- Current user's roles (drives navigation)
create or replace function public.my_roles() returns text[]
language sql stable security definer set search_path = public, app, extensions as $$
  select coalesce(array_agg(distinct role_code), '{}') from user_roles where user_id = auth.uid() and active
$$;

-- ---------------------------------------------------------------------
-- Admin: vendors & categories (SA-FR §6 §8)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_vendors(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('vendor.approve');
  return coalesce((select jsonb_agg(to_jsonb(v) - 'pan_last4' order by v.created_at desc)
                     from vendors v where p_status is null or v.status::text = p_status), '[]'::jsonb);
end $$;

create or replace function public.admin_decide_vendor(p_vendor uuid, p_decision text, p_reason text default null)
returns text language plpgsql security definer set search_path = public, app, extensions as $$
declare v vendors;
begin
  perform app.require_permission('vendor.approve');
  perform set_config('app.reason', coalesce(p_reason, p_decision), true);
  select * into v from vendors where id = p_vendor for update;
  if v.id is null then raise exception 'VENDOR_NOT_FOUND'; end if;
  if p_decision = 'approve' then
    if v.status = 'submitted' then update vendors set status = 'under_review' where id = v.id; end if;
    update vendors set status = 'approved' where id = v.id;
    update vendors set status = 'active', approved_by = app.actor_id(), approved_at = now(), status_reason = p_reason where id = v.id;
  elsif p_decision = 'reject' then
    if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
    if v.status = 'submitted' then update vendors set status = 'under_review' where id = v.id; end if;
    update vendors set status = 'rejected', status_reason = p_reason where id = v.id;
  elsif p_decision = 'suspend' then
    if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
    update vendors set status = 'suspended', status_reason = p_reason where id = v.id;
  elsif p_decision = 'reactivate' then
    update vendors set status = 'active', status_reason = p_reason where id = v.id;
  else raise exception 'UNKNOWN_DECISION';
  end if;
  return (select status::text from vendors where id = v.id);
end $$;

create or replace function public.admin_create_category(
  p_name text, p_parent uuid default null, p_gst_rate numeric default 5, p_return_days int default 7)
returns uuid language plpgsql security definer set search_path = public, app, extensions as $$
declare v_id uuid;
begin
  perform app.require_permission('catalog.product.moderate');
  insert into categories(name, slug, parent_id, level, default_gst_rate, return_window_days)
  values (btrim(p_name), app.slugify(p_name), p_parent,
          coalesce((select level + 1 from categories where id = p_parent), 1), p_gst_rate, p_return_days)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Seller catalogue (VS-FR §7 §8 §9)
-- p_variants: [{"sku":"KRT-M","attributes":{"size":"M"},"mrp":1499,"price":999,"stock":10}]
-- ---------------------------------------------------------------------
create or replace function public.vendor_create_product(
  p_vendor uuid, p_category uuid, p_title text, p_description text, p_gst_rate numeric,
  p_hsn text, p_image_urls text[], p_variants jsonb)
returns uuid language plpgsql security definer set search_path = public, app, extensions as $$
declare v_pid uuid; v_vid uuid; v jsonb; v_wh uuid; i int := 0; u text;
begin
  if not app.is_vendor_member(p_vendor) or not app.has_permission('catalog.product.manage', p_vendor) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if (select status from vendors where id = p_vendor) in ('rejected','suspended','closed') then
    raise exception 'VENDOR_NOT_ALLOWED_TO_LIST';
  end if;
  if jsonb_array_length(coalesce(p_variants, '[]'::jsonb)) = 0 then raise exception 'AT_LEAST_ONE_VARIANT'; end if;
  select id into v_wh from warehouses where vendor_id = p_vendor and active order by code limit 1;
  if v_wh is null then raise exception 'NO_PICKUP_WAREHOUSE'; end if;

  insert into products(vendor_id, category_id, title, slug, description, gst_rate, hsn_code, status, created_by)
  values (p_vendor, p_category, btrim(p_title),
          app.slugify(p_title) || '-' || substr(md5(gen_random_uuid()::text), 1, 5),
          p_description, p_gst_rate, nullif(btrim(p_hsn), ''), 'pending_review', auth.uid())
  returning id into v_pid;

  foreach u in array coalesce(p_image_urls, '{}') loop
    if u ~ '^https://' then
      insert into product_media(product_id, url, alt_text, sort_order) values (v_pid, u, btrim(p_title), i); i := i + 1;
    end if;
  end loop;

  for v in select * from jsonb_array_elements(p_variants) loop
    insert into product_variants(product_id, vendor_id, sku, attributes, mrp, selling_price)
    values (v_pid, p_vendor, btrim(v->>'sku'), coalesce(v->'attributes', '{}'::jsonb),
            (v->>'mrp')::numeric, (v->>'price')::numeric)
    returning id into v_vid;
    if coalesce((v->>'stock')::int, 0) > 0 then
      perform app.post_stock_movement(v_vid, v_wh, 'opening_balance',
              jsonb_build_object('on_hand', (v->>'stock')::int), 'product_create', v_pid::text,
              'open:' || v_vid, 'Opening stock at listing');
    end if;
  end loop;
  return v_pid;
end $$;

create or replace function public.vendor_adjust_stock(p_variant uuid, p_delta int, p_reason text, p_request_id text)
returns int language plpgsql security definer set search_path = public, app, extensions as $$
declare v_vendor uuid; v_wh uuid;
begin
  select vendor_id into v_vendor from product_variants where id = p_variant;
  if not app.is_vendor_member(v_vendor) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select id into v_wh from warehouses where vendor_id = v_vendor and active order by code limit 1;
  perform app.post_stock_movement(p_variant, v_wh, 'adjustment', jsonb_build_object('on_hand', p_delta),
          'vendor_adjustment', p_request_id, 'adj:' || p_request_id, p_reason);
  return (select available from stock_balances where variant_id = p_variant and warehouse_id = v_wh);
end $$;

-- Moderation (SA-FR §11)
create or replace function public.admin_moderate_product(p_product uuid, p_decision text, p_reason text default null)
returns text language plpgsql security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('catalog.product.moderate');
  if p_decision = 'approve' then
    update products set status = 'active', published_at = coalesce(published_at, now()),
                        moderated_by = app.actor_id(), moderated_at = now(), rejection_reason = null
     where id = p_product;
  elsif p_decision = 'reject' then
    if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
    update products set status = 'rejected', rejection_reason = p_reason,
                        moderated_by = app.actor_id(), moderated_at = now()
     where id = p_product;
  else raise exception 'UNKNOWN_DECISION';
  end if;
  return (select status::text from products where id = p_product);
end $$;

-- ---------------------------------------------------------------------
-- Fulfilment (VS-FR §12 §13). Manual AWB until courier integration (P2).
-- ---------------------------------------------------------------------
create or replace function public.vendor_update_sub_order(
  p_sub_order uuid, p_action text, p_carrier text default null, p_awb text default null)
returns text language plpgsql security definer set search_path = public, app, extensions as $$
declare so sub_orders; v_ship uuid;
begin
  select * into so from sub_orders where id = p_sub_order for update;
  if so.id is null or not app.is_vendor_member(so.vendor_id) or not app.has_permission('order.fulfil', so.vendor_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_action = 'pack' then
    update sub_orders set status = 'packed' where id = so.id;
  elsif p_action = 'ready' then
    update sub_orders set status = 'ready_to_ship' where id = so.id;
  elsif p_action = 'ship' then
    if coalesce(btrim(p_awb), '') = '' or coalesce(btrim(p_carrier), '') = '' then raise exception 'CARRIER_AND_AWB_REQUIRED'; end if;
    if so.status <> 'ready_to_ship' then raise exception 'INVALID_TRANSITION: sub_order must be ready to ship'; end if;
    insert into shipments(sub_order_id, carrier, awb, shipped_at) values (so.id, btrim(p_carrier), btrim(p_awb), now())
    returning id into v_ship;
    perform app.record_shipment_event(v_ship, 'manual-ship', 'HANDED_OVER', 'shipped', now());
  else raise exception 'UNKNOWN_ACTION';
  end if;
  return (select status::text from sub_orders where id = so.id);
end $$;

create or replace function public.admin_mark_delivered(p_sub_order uuid)
returns text language plpgsql security definer set search_path = public, app, extensions as $$
declare v_ship uuid;
begin
  perform app.require_permission('order.view.all');
  select id into v_ship from shipments where sub_order_id = p_sub_order order by created_at desc limit 1;
  if v_ship is null then raise exception 'NO_SHIPMENT'; end if;
  perform app.record_shipment_event(v_ship, 'manual-delivered', 'DELIVERED', 'delivered', now());
  return (select status::text from sub_orders where id = p_sub_order);
end $$;

-- ---------------------------------------------------------------------
-- Public read helpers
-- ---------------------------------------------------------------------
-- Stock visibility for shoppers without exposing warehouse data (CUST-FR-043/047)
create or replace function public.variant_availability(p_product uuid)
returns table(variant_id uuid, available int) language sql stable security definer set search_path = public, app, extensions as $$
  select v.id, least(coalesce(sum(b.available), 0), v.max_qty_per_order)::int
    from product_variants v
    join products p on p.id = v.product_id and p.status = 'active'
    left join stock_balances b on b.variant_id = v.id
   where v.product_id = p_product and v.active
   group by v.id, v.max_qty_per_order
$$;

-- Moderators and admins read everything they manage
create policy products_moderator_read on public.products for select using (app.has_permission('catalog.product.moderate'));
create policy variants_moderator_read on public.product_variants for select using (app.has_permission('catalog.product.moderate'));
create policy media_moderator_read on public.product_media for select using (app.has_permission('catalog.product.moderate'));
create policy orders_admin_read on public.orders for select using (app.has_permission('order.view.all'));
create policy sub_orders_admin_read on public.sub_orders for select using (app.has_permission('order.view.all'));
create policy order_items_admin_read on public.order_items for select using (app.has_permission('order.view.all'));
create policy shipments_admin_read on public.shipments for select using (app.has_permission('order.view.all'));
create policy categories_admin_read on public.categories for select using (app.has_permission('catalog.product.moderate'));

revoke execute on function app.slugify(text) from public, anon, authenticated;
grant execute on function public.apply_as_vendor(text, text, text, text, text, jsonb),
                          public.my_vendor(), public.my_roles(),
                          public.admin_list_vendors(text), public.admin_decide_vendor(uuid, text, text),
                          public.admin_create_category(text, uuid, numeric, int),
                          public.vendor_create_product(uuid, uuid, text, text, numeric, text, text[], jsonb),
                          public.vendor_adjust_stock(uuid, int, text, text),
                          public.admin_moderate_product(uuid, text, text),
                          public.vendor_update_sub_order(uuid, text, text, text),
                          public.admin_mark_delivered(uuid) to authenticated;
grant execute on function public.variant_availability(uuid) to anon, authenticated;
grant execute on function public.place_order(uuid, uuid, text, text, text),
                          public.cancel_order_item(uuid, int, text, text, text),
                          public.request_return(uuid, int, text, text, text, text, text[], jsonb) to authenticated;
grant execute on all functions in schema public to service_role;
