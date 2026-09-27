-- SHOPEYE 0028 — Preview (demo) products: shown in the storefront so it looks complete before sellers join,
-- but they can never be added to a cart or ordered. Photo credits for stock photos.
set search_path = public, extensions;

alter table public.products add column if not exists is_demo boolean not null default false;
alter table public.product_media add column if not exists credit text check (credit is null or char_length(credit) <= 200),
                                 add column if not exists credit_url text check (credit_url is null or credit_url ~ '^https://');

create or replace view public.catalog_variants with (security_invoker = true) as
select v.id as variant_id, v.sku, v.attributes, v.mrp, v.selling_price, v.max_qty_per_order,
       p.id as product_id, p.title, p.slug, p.category_id, p.brand_id, p.gst_rate,
       p.vendor_id, ve.display_name as vendor_name,
       round(100 * (v.mrp - v.selling_price) / v.mrp)::int as discount_pct,
       p.is_demo
from public.product_variants v
join public.products p on p.id = v.product_id and p.status = 'active'
join public.vendors ve on ve.id = p.vendor_id and ve.status = 'active'
where v.active;

-- Enforced in the database, not just hidden in the UI: a preview product can't reach a cart or an order
create or replace function app.block_demo_items() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if exists (select 1 from product_variants v join products p on p.id = v.product_id where v.id = new.variant_id and p.is_demo) then
    raise exception 'DEMO_PRODUCT: this item is a preview and can''t be bought yet' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists cart_items_no_demo on public.cart_items;
create trigger cart_items_no_demo before insert or update of variant_id on public.cart_items for each row execute function app.block_demo_items();
drop trigger if exists order_items_no_demo on public.order_items;
create trigger order_items_no_demo before insert on public.order_items for each row execute function app.block_demo_items();
revoke execute on function app.block_demo_items() from public, anon, authenticated;
