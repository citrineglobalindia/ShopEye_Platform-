-- SHOPEYE 0039 — Super Admin portal, phase 4: category tree editor (any depth: add, rename, move, reorder,
-- show/hide, GST/HSN/return defaults, image), brands, and stock view + adjustments with reasons.
set search_path = public, app, extensions;

insert into public.permissions(code, portal, description, sensitive) values
  ('catalog.category.manage', 'super_admin', 'Create, rename, move and hide categories', false),
  ('catalog.brand.manage',    'super_admin', 'Create, rename and block brands', false),
  ('inventory.adjust',        'super_admin', 'View and adjust stock with a reason', true)
on conflict (code) do nothing;
insert into public.role_permissions(role_code, permission_code) values
  ('super_admin','catalog.category.manage'), ('super_admin','catalog.brand.manage'), ('super_admin','inventory.adjust'),
  ('catalog_moderator','catalog.category.manage'), ('catalog_moderator','catalog.brand.manage'), ('stock_manager','inventory.adjust')
on conflict do nothing;

create or replace function public.admin_category_tree() returns table(id uuid, parent_id uuid, name text, slug text, level int, sort_order int, active boolean,
  default_gst_rate numeric, default_hsn text, return_window_days int, image_url text, products bigint)
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not (app.has_permission('catalog.category.manage') or app.has_permission('catalog.product.moderate')) then raise exception 'FORBIDDEN: missing permission catalog.category.manage' using errcode = '42501'; end if;
  return query select c.id, c.parent_id, c.name::text, c.slug::text, c.level, c.sort_order, c.active, c.default_gst_rate::numeric, c.default_hsn::text, c.return_window_days, c.image_url,
    (select count(*) from products p where p.category_id = c.id and p.status = 'active')
    from categories c order by c.level, c.sort_order, c.name;
end $$;

-- create (p_id null) or update a category; moving is allowed anywhere except under itself or its own sub-categories
create or replace function public.admin_save_category(p_id uuid, p_parent uuid, p_name text, p_gst numeric, p_return_days int, p_hsn text, p_image_url text, p_active boolean)
returns uuid language plpgsql security definer set search_path = public, app, extensions as $$
declare v_id uuid; v_slug text; n int := 1; old categories;
begin
  perform app.require_permission('catalog.category.manage');
  if p_name is null or char_length(btrim(p_name)) < 2 then raise exception 'NAME_REQUIRED: give the category a name' using errcode = 'P0001'; end if;
  if p_gst is not null and p_gst not in (0, 0.25, 3, 5, 12, 18, 28) then raise exception 'BAD_GST: choose 0, 0.25, 3, 5, 12, 18 or 28' using errcode = 'P0001'; end if;
  if p_return_days is not null and (p_return_days < 0 or p_return_days > 60) then raise exception 'BAD_RETURN_WINDOW: 0–60 days' using errcode = 'P0001'; end if;
  if p_image_url is not null and btrim(p_image_url) <> '' and p_image_url !~ '^https://' then raise exception 'BAD_IMAGE: use an https:// image address' using errcode = 'P0001'; end if;
  if p_id is not null and p_parent is not null and p_parent in (with recursive t as (select id from categories where id = p_id union all select c.id from categories c join t on c.parent_id = t.id) select id from t) then
    raise exception 'BAD_MOVE: a category can''t go inside itself or its own sub-categories' using errcode = 'P0001'; end if;
  if p_id is null then
    v_slug := app.slugify(p_name);
    while exists (select 1 from categories where slug = v_slug) loop n := n + 1; v_slug := app.slugify(p_name) || '-' || n; end loop;
    insert into categories(name, slug, parent_id, level, default_gst_rate, default_hsn, return_window_days, image_url, active, sort_order)
    values (btrim(p_name), v_slug, p_parent, coalesce((select level + 1 from categories where id = p_parent), 1), coalesce(p_gst, 5), nullif(btrim(coalesce(p_hsn, '')), ''),
            coalesce(p_return_days, 7), nullif(btrim(coalesce(p_image_url, '')), ''), coalesce(p_active, true),
            coalesce((select max(sort_order) + 1 from categories where parent_id is not distinct from p_parent), 0))
    returning id into v_id;
  else
    select * into old from categories where id = p_id for update;
    if old.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    update categories set name = btrim(p_name), parent_id = p_parent, default_gst_rate = coalesce(p_gst, default_gst_rate), default_hsn = nullif(btrim(coalesce(p_hsn, '')), ''),
      return_window_days = coalesce(p_return_days, return_window_days), image_url = nullif(btrim(coalesce(p_image_url, '')), ''), active = coalesce(p_active, active),
      sort_order = case when parent_id is distinct from p_parent then coalesce((select max(sort_order) + 1 from categories where parent_id is not distinct from p_parent), 0) else sort_order end
     where id = p_id;
    -- keep levels right for the whole moved branch
    with recursive t as (select id, coalesce((select level from categories where id = p_parent), 0) + 1 as lvl from categories where id = p_id
                         union all select c.id, t.lvl + 1 from categories c join t on c.parent_id = t.id)
    update categories c set level = t.lvl from t where c.id = t.id and c.level <> t.lvl;
    v_id := p_id;
  end if;
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, before_value, after_value)
  values (auth.uid(), 'super_admin', case when p_id is null then 'category.create' else 'category.update' end, 'categories', v_id::text,
          case when p_id is null then null else jsonb_build_object('name', old.name, 'parent', old.parent_id, 'active', old.active) end,
          jsonb_build_object('name', btrim(p_name), 'parent', p_parent, 'active', coalesce(p_active, true)));
  return v_id;
end $$;

create or replace function public.admin_move_category(p_id uuid, p_direction text) returns boolean
language plpgsql security definer set search_path = public, app as $$
declare c categories; o categories;
begin
  perform app.require_permission('catalog.category.manage');
  select * into c from categories where id = p_id for update;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- renumber siblings first so every one has a distinct position
  with s as (select id, row_number() over (order by sort_order, name) - 1 as rn from categories where parent_id is not distinct from c.parent_id)
  update categories x set sort_order = s.rn from s where x.id = s.id and x.sort_order <> s.rn;
  select * into c from categories where id = p_id;
  select * into o from categories where parent_id is not distinct from c.parent_id and id <> c.id
    and ((p_direction = 'up' and sort_order < c.sort_order) or (p_direction = 'down' and sort_order > c.sort_order))
   order by case when p_direction = 'up' then -sort_order else sort_order end limit 1;
  if o.id is null then return false; end if;
  update categories set sort_order = o.sort_order where id = c.id;
  update categories set sort_order = c.sort_order where id = o.id;
  return true;
end $$;

-- Brands
create or replace function public.admin_list_brands() returns table(id uuid, name text, slug text, status text, requires_authorisation boolean, is_demo boolean, products bigint)
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not (app.has_permission('catalog.brand.manage') or app.has_permission('catalog.product.moderate')) then raise exception 'FORBIDDEN: missing permission catalog.brand.manage' using errcode = '42501'; end if;
  return query select b.id, b.name, b.slug::text, b.status, b.requires_authorisation, b.is_demo, (select count(*) from products p where p.brand_id = b.id and p.status = 'active') from brands b order by b.name;
end $$;
create or replace function public.admin_save_brand(p_id uuid, p_name text, p_status text, p_requires_authorisation boolean) returns uuid
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_id uuid; v_slug text; n int := 1;
begin
  perform app.require_permission('catalog.brand.manage');
  if p_name is null or char_length(btrim(p_name)) < 2 then raise exception 'NAME_REQUIRED: give the brand a name' using errcode = 'P0001'; end if;
  if p_status not in ('pending','active','blocked') then raise exception 'BAD_STATUS' using errcode = 'P0001'; end if;
  if p_id is null then
    if exists (select 1 from brands where lower(name) = lower(btrim(p_name))) then raise exception 'DUPLICATE: that brand already exists' using errcode = 'P0001'; end if;
    v_slug := app.slugify(p_name); while exists (select 1 from brands where slug = v_slug) loop n := n + 1; v_slug := app.slugify(p_name) || '-' || n; end loop;
    insert into brands(name, slug, status, requires_authorisation) values (btrim(p_name), v_slug, p_status, coalesce(p_requires_authorisation, false)) returning id into v_id;
  else
    update brands set name = btrim(p_name), status = p_status, requires_authorisation = coalesce(p_requires_authorisation, requires_authorisation) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, after_value)
  values (auth.uid(), 'super_admin', case when p_id is null then 'brand.create' else 'brand.update' end, 'brands', v_id::text, jsonb_build_object('name', btrim(p_name), 'status', p_status));
  return v_id;
end $$;

-- Stock
create or replace function public.admin_stock(p_q text default null, p_filter text default 'all', p_limit int default 200)
returns table(variant_id uuid, sku text, attributes jsonb, product_id uuid, title text, vendor text, is_demo boolean, on_hand int, reserved int, available int, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_permission('inventory.adjust');
  return query select v.id, v.sku::text, v.attributes, p.id, p.title, ve.display_name, p.is_demo,
      coalesce(sum(b.on_hand), 0)::int, coalesce(sum(b.reserved), 0)::int, coalesce(sum(b.available), 0)::int, max(b.updated_at)
    from product_variants v join products p on p.id = v.product_id join vendors ve on ve.id = p.vendor_id left join stock_balances b on b.variant_id = v.id
   where v.active and p.status in ('active','inactive','pending_review')
     and (p_q is null or btrim(p_q) = '' or p.title ilike '%' || btrim(p_q) || '%' or v.sku::text ilike '%' || btrim(p_q) || '%' or ve.display_name ilike '%' || btrim(p_q) || '%')
   group by v.id, p.id, ve.display_name
  having p_filter = 'all' or (p_filter = 'low' and coalesce(sum(b.available), 0) between 1 and 5) or (p_filter = 'out' and coalesce(sum(b.available), 0) <= 0)
   order by coalesce(sum(b.available), 0), p.title limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;
create or replace function public.admin_adjust_stock(p_variant uuid, p_delta int, p_reason text) returns int
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_vendor uuid; v_wh uuid; v_key text := gen_random_uuid()::text;
begin
  perform app.require_permission('inventory.adjust');
  if p_delta is null or p_delta = 0 then raise exception 'BAD_QTY: enter a positive or negative number' using errcode = 'P0001'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED: say why (5+ characters, e.g. stock count correction)' using errcode = 'P0001'; end if;
  select vendor_id into v_vendor from product_variants where id = p_variant;
  if v_vendor is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select id into v_wh from warehouses where vendor_id = v_vendor and active order by code limit 1;
  if v_wh is null then raise exception 'NO_WAREHOUSE: this seller has no pickup location' using errcode = 'P0001'; end if;
  perform app.post_stock_movement(p_variant, v_wh, 'adjustment', jsonb_build_object('on_hand', p_delta), 'admin_adjustment', v_key, 'adm-adj:' || v_key, btrim(p_reason));
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, after_value, reason)
  values (auth.uid(), 'super_admin', 'stock.adjust', 'product_variants', p_variant::text, jsonb_build_object('delta', p_delta), btrim(p_reason));
  return (select coalesce(sum(available), 0)::int from stock_balances where variant_id = p_variant);
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_category_tree()','admin_save_category(uuid,uuid,text,numeric,int,text,text,boolean)','admin_move_category(uuid,text)','admin_list_brands()',
    'admin_save_brand(uuid,text,text,boolean)','admin_stock(text,text,int)','admin_adjust_stock(uuid,int,text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f); execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
