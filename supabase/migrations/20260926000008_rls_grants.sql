-- =====================================================================
set search_path = public, extensions;
-- SHOPEYE 0008 — Row-level security & API grants
-- Traces: CUST-FR-089, 108, 172, 173 (no access by ID manipulation);
--         AF-FR-0583/0588 (least privilege at API level); VS-FR §38
-- Model: browser clients (anon/authenticated) reach only public tables
-- through RLS. app.* and finance.* are never exposed; staff portals call
-- security-definer RPCs or server routes using the service role, which
-- re-check permissions with app.require_permission().
-- =====================================================================
revoke all on schema app, finance from public, anon, authenticated;
revoke all on all tables in schema app, finance from anon, authenticated;
grant usage on schema app to anon, authenticated;                   -- RLS helper functions only

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Catalogue: public read of live data only
grant select on public.categories, public.brands, public.attributes, public.category_attributes,
                public.products, public.product_variants, public.product_media, public.serviceable_pincodes to anon, authenticated;
grant select on public.catalog_variants to anon, authenticated;
grant select (id, display_name, slug, rating, status) on public.vendors to anon, authenticated;

create policy categories_read on public.categories for select using (active);
create policy brands_read on public.brands for select using (status = 'active');
create policy attributes_read on public.attributes for select using (true);
create policy cat_attr_read on public.category_attributes for select using (true);
create policy pincodes_read on public.serviceable_pincodes for select using (active);
create policy vendors_public_read on public.vendors for select using (status = 'active' or app.is_vendor_member(id));
create policy products_public_read on public.products for select
  using (status = 'active' or app.is_vendor_member(vendor_id));
create policy variants_public_read on public.product_variants for select
  using (exists (select 1 from public.products p where p.id = product_id and (p.status = 'active' or app.is_vendor_member(p.vendor_id))));
create policy media_public_read on public.product_media for select
  using (exists (select 1 from public.products p where p.id = product_id and (p.status = 'active' or app.is_vendor_member(p.vendor_id))));

-- Vendor catalogue writes: own vendor only, and never self-activate
grant insert, update on public.products, public.product_variants, public.product_media to authenticated;
create policy products_vendor_insert on public.products for insert
  with check (app.is_vendor_member(vendor_id) and app.has_permission('catalog.product.manage', vendor_id)
              and status in ('draft','pending_review'));
create policy products_vendor_update on public.products for update
  using (app.is_vendor_member(vendor_id) and app.has_permission('catalog.product.manage', vendor_id))
  with check (app.is_vendor_member(vendor_id) and status in ('draft','pending_review','inactive','archived'));
create policy variants_vendor_write on public.product_variants for all
  using (app.is_vendor_member(vendor_id) and app.has_permission('catalog.product.manage', vendor_id))
  with check (app.is_vendor_member(vendor_id) and app.has_permission('catalog.product.manage', vendor_id));
create policy media_vendor_write on public.product_media for all
  using (exists (select 1 from public.products p where p.id = product_id and app.is_vendor_member(p.vendor_id)))
  with check (exists (select 1 from public.products p where p.id = product_id and app.is_vendor_member(p.vendor_id)));

-- Customer-owned data
grant select, update on public.profiles to authenticated;
create policy profiles_self on public.profiles for select using (id = auth.uid());
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and status = 'active');

grant select, insert, update on public.customer_addresses to authenticated;
create policy addresses_own on public.customer_addresses for all
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());

grant select, insert, update on public.carts to authenticated;
grant select, insert, update, delete on public.cart_items to authenticated;
create policy carts_own on public.carts for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy cart_items_own on public.cart_items for all
  using (exists (select 1 from public.carts c where c.id = cart_id and c.customer_id = auth.uid()))
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.customer_id = auth.uid() and c.status = 'active'));

-- Orders: customers read their own; vendors read their sub-orders; writes via RPC only
grant select on public.orders, public.sub_orders, public.order_items, public.payments, public.shipments,
                public.shipment_events, public.refunds, public.returns, public.cancellations to authenticated;
create policy orders_customer_read on public.orders for select using (customer_id = auth.uid());
create policy sub_orders_read on public.sub_orders for select
  using (app.is_vendor_member(vendor_id)
         or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
create policy order_items_read on public.order_items for select
  using (exists (select 1 from public.sub_orders so where so.id = sub_order_id and app.is_vendor_member(so.vendor_id))
         or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
create policy payments_customer_read on public.payments for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
create policy shipments_read on public.shipments for select
  using (exists (select 1 from public.sub_orders so join public.orders o on o.id = so.order_id
                  where so.id = sub_order_id and (o.customer_id = auth.uid() or app.is_vendor_member(so.vendor_id))));
create policy shipment_events_read on public.shipment_events for select
  using (exists (select 1 from public.shipments s where s.id = shipment_id));      -- inherits shipments RLS
create policy refunds_read on public.refunds for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
create policy returns_read on public.returns for select
  using (exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
                  join public.sub_orders so on so.id = oi.sub_order_id
                  where oi.id = order_item_id and (o.customer_id = auth.uid() or app.is_vendor_member(so.vendor_id))));
create policy cancellations_read on public.cancellations for select
  using (exists (select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
                  where oi.id = order_item_id and o.customer_id = auth.uid()));

-- Vendor staff read of their inventory; writes only through posting functions
grant select on public.warehouses, public.stock_balances, public.stock_ledger to authenticated;
create policy warehouses_vendor_read on public.warehouses for select using (vendor_id is not null and app.is_vendor_member(vendor_id));
create policy stock_vendor_read on public.stock_balances for select
  using (exists (select 1 from public.product_variants v where v.id = variant_id and app.is_vendor_member(v.vendor_id)));
create policy stock_ledger_vendor_read on public.stock_ledger for select
  using (exists (select 1 from public.product_variants v where v.id = variant_id and app.is_vendor_member(v.vendor_id)));

-- Customer-callable RPCs
revoke execute on all functions in schema public, app, finance from public, anon, authenticated;
grant execute on function public.place_order(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.cancel_order_item(uuid, int, text, text, text) to authenticated;
grant execute on function public.request_return(uuid, int, text, text, text, text, text[], jsonb) to authenticated;
grant execute on function public.merge_guest_cart(text) to authenticated;
-- helpers referenced inside RLS policies must stay executable
grant execute on function app.is_vendor_member(uuid), app.has_permission(text, uuid, uuid), app.actor_id() to anon, authenticated;
