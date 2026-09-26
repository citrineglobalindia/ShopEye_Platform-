-- Test harness + deterministic seed. Local only.
create schema if not exists test;

create or replace function test.act_as(p uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false) $$;

create or replace function test.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'FAIL  %', p_name; end if;
  raise notice 'PASS  %', p_name;
end $$;

create or replace function test.throws(p_sql text, p_pattern text, p_name text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ~ p_pattern then raise notice 'PASS  % (rejected: %)', p_name, left(sqlerrm, 90); return; end if;
    raise exception 'FAIL  % : unexpected error %', p_name, sqlerrm;
  end;
  raise exception 'FAIL  % : expected error matching %', p_name, p_pattern;
end $$;

-- Fixed ids
create or replace function test.id(p text) returns uuid language sql immutable as $$
  select (case p
    when 'cust_a'   then '00000000-0000-0000-0000-0000000000c1' when 'cust_b'   then '00000000-0000-0000-0000-0000000000c2'
    when 'v1_owner' then '00000000-0000-0000-0000-0000000000a1' when 'v2_owner' then '00000000-0000-0000-0000-0000000000a2'
    when 'maker'    then '00000000-0000-0000-0000-0000000000f1' when 'checker'  then '00000000-0000-0000-0000-0000000000f2'
    when 'head'     then '00000000-0000-0000-0000-0000000000f3' when 'admin'    then '00000000-0000-0000-0000-0000000000e1'
    when 'vendor1'  then '00000000-0000-0000-0000-000000000101' when 'vendor2'  then '00000000-0000-0000-0000-000000000102'
    when 'cat'      then '00000000-0000-0000-0000-000000000201'
    when 'p1'       then '00000000-0000-0000-0000-000000000301' when 'p2'       then '00000000-0000-0000-0000-000000000302'
    when 'kurta_m'  then '00000000-0000-0000-0000-000000000401' when 'kurta_l'  then '00000000-0000-0000-0000-000000000402'
    when 'saree'    then '00000000-0000-0000-0000-000000000403'
    when 'wh1'      then '00000000-0000-0000-0000-000000000501' when 'wh2'      then '00000000-0000-0000-0000-000000000502'
    when 'addr_a'   then '00000000-0000-0000-0000-000000000601' when 'addr_b'   then '00000000-0000-0000-0000-000000000602'
  end)::uuid $$;

-- People
insert into auth.users(id, email) select test.id(x), x || '@test.local'
  from unnest(array['cust_a','cust_b','v1_owner','v2_owner','maker','checker','head','admin']) x;
insert into public.profiles(id, full_name, email) select test.id(x), initcap(replace(x,'_',' ')), x || '@test.local'
  from unnest(array['cust_a','cust_b','v1_owner','v2_owner','maker','checker','head','admin']) x;

-- Accounting periods: last month closed, this month open
insert into finance.accounting_periods(starts_on, ends_on, status) values
  (date_trunc('month', current_date - interval '1 month')::date, (date_trunc('month', current_date) - interval '1 day')::date, 'closed'),
  (date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'open');

-- Vendors walk the real onboarding state machine
insert into public.vendors(id, legal_name, display_name, slug, contact_email, gstin) values
  (test.id('vendor1'), 'Citrine Weaves Pvt Ltd', 'Citrine Weaves', 'citrine-weaves', 'v1@test.local', '29ABCDE1234F1Z5'),
  (test.id('vendor2'), 'Mysore Silk House', 'Mysore Silk House', 'mysore-silk', 'v2@test.local', null);
update public.vendors set status = 'submitted';
update public.vendors set status = 'under_review';
update public.vendors set status = 'approved';
update public.vendors set status = 'active';

insert into public.user_roles(user_id, role_code, vendor_id) values
  (test.id('cust_a'), 'customer', null), (test.id('cust_b'), 'customer', null),
  (test.id('v1_owner'), 'vendor_owner', test.id('vendor1')), (test.id('v2_owner'), 'vendor_owner', test.id('vendor2')),
  (test.id('maker'), 'accountant', null), (test.id('checker'), 'accounts_manager', null),
  (test.id('head'), 'accounts_head', null), (test.id('admin'), 'super_admin', null);

-- Catalogue (products go through moderation)
insert into public.categories(id, name, slug, default_gst_rate, return_window_days) values (test.id('cat'), 'Ethnic Wear', 'ethnic-wear', 5, 7);
insert into public.products(id, vendor_id, category_id, title, slug, gst_rate, hsn_code) values
  (test.id('p1'), test.id('vendor1'), test.id('cat'), 'Handloom Cotton Kurta', 'handloom-cotton-kurta', 5, '6211'),
  (test.id('p2'), test.id('vendor2'), test.id('cat'), 'Mysore Silk Saree',     'mysore-silk-saree',     5, '5007');
update public.products set status = 'pending_review';
update public.products set status = 'active', published_at = now();

insert into public.product_variants(id, product_id, vendor_id, sku, attributes, mrp, selling_price) values
  (test.id('kurta_m'), test.id('p1'), test.id('vendor1'), 'KRT-M', '{"size":"M"}', 1499.00, 999.00),
  (test.id('kurta_l'), test.id('p1'), test.id('vendor1'), 'KRT-L', '{"size":"L"}', 1499.00, 999.00),
  (test.id('saree'),   test.id('p2'), test.id('vendor2'), 'SAR-01', '{"color":"maroon"}', 8999.00, 6499.00);

-- Warehouses + inbound stock via GRN then putaway (posting function only)
insert into public.warehouses(id, code, name, owner_type, vendor_id, pincode) values
  (test.id('wh1'), 'WH-BLR-V1', 'Citrine Weaves Bengaluru', 'vendor', test.id('vendor1'), '560001'),
  (test.id('wh2'), 'WH-MYS-V2', 'Mysore Silk Mysuru', 'vendor', test.id('vendor2'), '570001');
select app.post_stock_movement(test.id('kurta_m'), test.id('wh1'), 'grn_receipt', '{"on_hand":10,"pending_putaway":10}', 'grn', 'GRN-T1', 'grn:t1:m');
select app.post_stock_movement(test.id('kurta_m'), test.id('wh1'), 'putaway', '{"pending_putaway":-10}', 'putaway', 'PA-T1', 'pa:t1:m');
select app.post_stock_movement(test.id('kurta_l'), test.id('wh1'), 'opening_balance', '{"on_hand":1}', 'opening', 'OB', 'ob:l');
select app.post_stock_movement(test.id('saree'),   test.id('wh2'), 'opening_balance', '{"on_hand":5}', 'opening', 'OB', 'ob:saree');

insert into public.serviceable_pincodes(pincode, city, state_code, prepaid, cod) values
  ('560034','Bengaluru','KA', true, true), ('110001','New Delhi','DL', true, false);

insert into public.customer_addresses(id, customer_id, recipient, mobile, line1, line2, city, state_code, pincode, address_type, is_default) values
  (test.id('addr_a'), test.id('cust_a'), 'Asha Rao', '+919900000001', '12, 4th Cross', 'Koramangala 5th Block', 'Bengaluru', 'KA', '560034', 'home', true),
  (test.id('addr_b'), test.id('cust_b'), 'Bala K',   '+919900000002', '7 Janpath', 'Connaught Place', 'New Delhi', 'DL', '110001', 'home', true);

-- Commercial rules
insert into finance.commission_rules(category_id, effective_from, commission_type, commission_value) values
  (test.id('cat'), current_date - 30, 'percent', 10);
insert into public.coupons(code, discount_type, discount_value, max_discount, min_subtotal, vendor_funded_pct, starts_at, ends_at) values
  ('FESTIVE10', 'percent', 10, 1000, 1000, 50, now() - interval '1 day', now() + interval '30 days');

insert into app.approval_rules(action_type, amount_from, amount_to, checker_role) values
  ('refund', 1000, null, 'accounts_manager'),
  ('payout', 0, null, 'accounts_manager');

-- helper: fill a customer's cart
create or replace function test.cart(p_customer uuid, p_items jsonb) returns uuid language plpgsql as $$
declare v_cart uuid; i jsonb;
begin
  update public.carts set status = 'abandoned' where customer_id = p_customer and status = 'active';
  insert into public.carts(customer_id) values (p_customer) returning id into v_cart;
  for i in select * from jsonb_array_elements(p_items) loop
    insert into public.cart_items(cart_id, variant_id, qty, price_at_add)
    values (v_cart, test.id(i->>'v'), (i->>'q')::int, 0);
  end loop;
  return v_cart;
end $$;
