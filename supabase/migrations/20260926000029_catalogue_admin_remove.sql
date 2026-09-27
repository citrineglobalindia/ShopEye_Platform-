-- SHOPEYE 0029 — Marketplace catalogue structure and safe removal from admin.
-- * departments (top-level categories) with sub-categories; brands and sellers can be marked preview
-- * admin "Remove" never hard-deletes: stock movements, orders and invoices keep pointing at the product, so it is
--   archived (hidden everywhere, history intact) and dropped from every cart; "Remove all preview products" does the same in bulk
set search_path = public, extensions;

alter table public.brands add column if not exists is_demo boolean not null default false;
alter table public.vendors add column if not exists is_demo boolean not null default false;
alter table public.categories add column if not exists image_url text check (image_url is null or image_url ~ '^https://');

create or replace function app.archive_product(p_id uuid) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
declare s product_status;
begin
  select status into s from products where id = p_id for update;
  if s is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if s = 'archived' then return 'archived'; end if;
  -- walk the allowed status path so the transition rules and audit trail still apply
  if s = 'active' then update products set status = 'inactive' where id = p_id; end if;
  if s = 'pending_review' then update products set status = 'rejected' where id = p_id; end if;
  update products set status = 'archived' where id = p_id;
  delete from cart_items where variant_id in (select id from product_variants where product_id = p_id);
  update product_alerts set active = false where variant_id in (select id from product_variants where product_id = p_id) and active;
  return 'archived';
end $$;

create or replace function public.admin_remove_product(p_product uuid) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('catalog.product.moderate');
  return app.archive_product(p_product);
end $$;

create or replace function public.admin_remove_preview_catalogue() returns jsonb
language plpgsql security definer set search_path = public, app, extensions as $$
declare r record; n int := 0;
begin
  perform app.require_permission('catalog.product.moderate');
  for r in select id from products where is_demo and status <> 'archived' loop
    perform app.archive_product(r.id); n := n + 1;
  end loop;
  update brands set status = 'blocked' where is_demo and not exists (select 1 from products p where p.brand_id = brands.id and p.status <> 'archived');
  update promo_banners set active = false where title = 'A first look at ShopEye';
  return jsonb_build_object('archived_products', n);
end $$;

revoke execute on function app.archive_product(uuid) from public, anon, authenticated;
revoke execute on function public.admin_remove_product(uuid), public.admin_remove_preview_catalogue() from public, anon;
grant execute on function public.admin_remove_product(uuid), public.admin_remove_preview_catalogue() to authenticated;
