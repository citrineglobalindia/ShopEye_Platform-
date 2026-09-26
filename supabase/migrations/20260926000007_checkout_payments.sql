-- =====================================================================
set search_path = public, extensions;
-- SHOPEYE 0007 — Checkout, payment webhooks, shipment events
-- Traces: CUST-FR-059..061, 069..075, 082..093, 099..103; AF-FR-0079,
--         0083, 0253, 0474, 0667; VS-FR-891..893
-- =====================================================================

-- Server-authoritative order placement.
-- Recomputes every price, discount, shipping and tax from the database;
-- nothing monetary is accepted from the browser (CUST-FR-060, API rules).
create or replace function public.place_order(
  p_cart uuid, p_address uuid, p_payment_method text, p_idempotency_key text, p_coupon text default null)
returns jsonb language plpgsql security definer set search_path = public, app, finance, extensions as $$
declare
  v_customer uuid := auth.uid();
  v_order public.orders; v_addr public.customer_addresses; v_pin public.serviceable_pincodes;
  v_cp public.coupons; v_subtotal numeric := 0; v_disc numeric := 0; v_ship numeric := 0;
  v_order_id uuid; v_so uuid; v_item uuid; l record; v record; v_rule finance.commission_rules;
  v_alloc numeric; v_left numeric; v_n int; v_i int := 0; v_eligible numeric;
  v_flat numeric := (app.setting('shipping.flat_fee_per_vendor'))::text::numeric;
  v_free numeric := (app.setting('shipping.free_threshold_per_vendor'))::text::numeric;
  v_minutes int := (app.setting('checkout.reservation_minutes'))::text::int;
  v_rsv uuid; v_line_total numeric; v_taxable numeric; v_comm numeric;
begin
  if v_customer is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  -- idempotent replay: same key returns the same order (double-click / refresh / retry)
  perform pg_advisory_xact_lock(hashtext('order:' || p_idempotency_key));
  select * into v_order from orders where idempotency_key = p_idempotency_key;
  if v_order.id is not null then
    if v_order.customer_id <> v_customer then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                              'grand_total', v_order.grand_total, 'replay', true);
  end if;

  perform 1 from carts where id = p_cart and customer_id = v_customer and status = 'active' for update;
  if not found then raise exception 'CART_NOT_FOUND'; end if;

  select * into v_addr from customer_addresses where id = p_address and customer_id = v_customer and archived_at is null;
  if v_addr.id is null then raise exception 'ADDRESS_NOT_FOUND'; end if;
  select * into v_pin from serviceable_pincodes where pincode = v_addr.pincode and active;
  if v_pin.pincode is null and coalesce((app.setting('serviceability.all_india'))::text::boolean, false) then
    v_pin := row(v_addr.pincode, v_addr.city, v_addr.state_code, true,
                 coalesce((app.setting('serviceability.all_india_cod'))::text::boolean, false), 3, 7, true)::serviceable_pincodes;
  end if;
  if v_pin.pincode is null then raise exception 'NOT_SERVICEABLE: %', v_addr.pincode using errcode = 'P0001'; end if;
  if p_payment_method = 'cod' and not v_pin.cod then raise exception 'COD_NOT_AVAILABLE: %', v_addr.pincode; end if;

  -- Validate every line against live catalogue state (CUST-FR-061)
  drop table if exists _lines;
  create temp table _lines on commit drop as
  select ci.variant_id, ci.qty, cv.sku, cv.mrp, cv.selling_price, cv.max_qty_per_order, cv.title,
         cv.attributes, cv.product_id, cv.category_id, cv.vendor_id, cv.gst_rate, p.hsn_code,
         coalesce(p.is_returnable, true) as is_returnable,
         coalesce(p.return_window_days, c.return_window_days, (app.setting('returns.default_window_days'))::text::int) as return_days,
         0::numeric as disc, 0::numeric as pdisc
    from cart_items ci
    left join catalog_variants cv on cv.variant_id = ci.variant_id
    left join products p on p.id = cv.product_id
    left join categories c on c.id = cv.category_id
   where ci.cart_id = p_cart and not ci.saved_for_later;

  select count(*) into v_n from _lines;
  if v_n = 0 then raise exception 'CART_EMPTY'; end if;
  for l in select * from _lines where sku is null loop
    raise exception 'ITEM_UNAVAILABLE: %', l.variant_id using errcode = 'P0001';
  end loop;
  for l in select * from _lines where qty > max_qty_per_order loop
    raise exception 'QTY_LIMIT_EXCEEDED: % max %', l.sku, l.max_qty_per_order using errcode = 'P0001';
  end loop;

  select coalesce(sum(selling_price * qty),0) into v_subtotal from _lines;

  -- Coupon: validate, then allocate across eligible lines pro-rata, last line absorbs rounding
  if p_coupon is not null and btrim(p_coupon) <> '' then
    select * into v_cp from coupons where code = btrim(p_coupon) and active and now() between starts_at and ends_at;
    if v_cp.id is null then raise exception 'COUPON_INVALID: expired or unknown' using errcode = 'P0001'; end if;
    select coalesce(sum(selling_price * qty),0) into v_eligible from _lines where v_cp.vendor_id is null or vendor_id = v_cp.vendor_id;
    if v_eligible < v_cp.min_subtotal then raise exception 'COUPON_MIN_NOT_MET: minimum %', v_cp.min_subtotal using errcode = 'P0001'; end if;
    if (select count(*) from coupon_redemptions where coupon_id = v_cp.id and customer_id = v_customer and status = 'applied') >= v_cp.usage_limit_per_customer then
      raise exception 'COUPON_USAGE_LIMIT' using errcode = 'P0001';
    end if;
    if v_cp.usage_limit_total is not null and
       (select count(*) from coupon_redemptions where coupon_id = v_cp.id and status = 'applied') >= v_cp.usage_limit_total then
      raise exception 'COUPON_EXHAUSTED' using errcode = 'P0001';
    end if;
    v_disc := case when v_cp.discount_type = 'percent' then round(v_eligible * v_cp.discount_value / 100, 2) else v_cp.discount_value end;
    if v_cp.max_discount is not null then v_disc := least(v_disc, v_cp.max_discount); end if;
    v_disc := least(v_disc, v_eligible);                                                   -- never negative (CUST-FR-081)

    v_left := v_disc;
    select count(*) into v_n from _lines where v_cp.vendor_id is null or vendor_id = v_cp.vendor_id;
    for l in select variant_id, selling_price * qty as gross from _lines
              where v_cp.vendor_id is null or vendor_id = v_cp.vendor_id order by variant_id loop
      v_i := v_i + 1;
      v_alloc := case when v_i = v_n then v_left else round(v_disc * l.gross / v_eligible, 2) end;
      v_left := v_left - v_alloc;
      update _lines set disc = v_alloc,
                        pdisc = v_alloc - round(v_alloc * v_cp.vendor_funded_pct / 100, 2)
       where variant_id = l.variant_id;
    end loop;
  end if;

  -- Shipping per vendor package (CUST §11.3)
  select coalesce(sum(case when vs >= v_free then 0 else v_flat end),0) into v_ship
    from (select vendor_id, sum(selling_price * qty - disc) vs from _lines group by vendor_id) x;

  insert into orders(customer_id, cart_id, idempotency_key, status, payment_status, payment_method, subtotal,
                     discount_total, shipping_total, grand_total, coupon_code, ship_address, bill_address)
  values (v_customer, p_cart, p_idempotency_key,
          (case when p_payment_method = 'cod' then 'confirmed' else 'pending_payment' end)::public.order_status,
          (case when p_payment_method = 'cod' then 'cod_pending' else 'initiated' end)::public.payment_state,
          p_payment_method, v_subtotal, v_disc, v_ship, v_subtotal - v_disc + v_ship,
          nullif(btrim(p_coupon),''), to_jsonb(v_addr) - 'id' - 'customer_id' - 'is_default' - 'archived_at' - 'created_at',
          to_jsonb(v_addr) - 'id' - 'customer_id' - 'is_default' - 'archived_at' - 'created_at')
  returning id into v_order_id;

  for v in select vendor_id, sum(selling_price * qty) st, sum(disc) d from _lines group by vendor_id loop
    insert into sub_orders(order_id, vendor_id, status, subtotal, discount_total, shipping_total, total)
    values (v_order_id, v.vendor_id, (case when p_payment_method = 'cod' then 'confirmed' else 'pending_payment' end)::public.sub_order_status,
            v.st, v.d, case when v.st - v.d >= v_free then 0 else v_flat end,
            v.st - v.d + case when v.st - v.d >= v_free then 0 else v_flat end)
    returning id into v_so;

    for l in select * from _lines where vendor_id = v.vendor_id loop
      v_line_total := l.selling_price * l.qty - l.disc;
      v_taxable := round(v_line_total / (1 + l.gst_rate / 100), 2);          -- GST-inclusive pricing
      v_rule := finance.resolve_commission(l.vendor_id, l.category_id, current_date);
      v_comm := case when v_rule.id is null then 0
                     when v_rule.commission_type = 'percent' then
                        round((case v_rule.base when 'taxable_value' then v_taxable when 'mrp' then l.mrp * l.qty else v_line_total end)
                              * v_rule.commission_value / 100, 2)
                     else round(v_rule.commission_value * l.qty, 2) end;
      insert into order_items(order_id, sub_order_id, variant_id, product_snapshot, qty, mrp, unit_price, discount,
                              platform_funded_discount, vendor_funded_discount, line_total, gst_rate, taxable_value, tax_amount,
                              commission_rule_id, commission_amount, commission_tax)
      values (v_order_id, v_so, l.variant_id,
              jsonb_build_object('product_id', l.product_id, 'title', l.title, 'sku', l.sku, 'attributes', l.attributes,
                                 'hsn', l.hsn_code, 'is_returnable', l.is_returnable, 'return_days', l.return_days,
                                 'commission_rule', to_jsonb(v_rule)),                                     -- AF-FR-0253 snapshot
              l.qty, l.mrp, l.selling_price, l.disc, l.pdisc, l.disc - l.pdisc, v_line_total, l.gst_rate,
              v_taxable, v_line_total - v_taxable, v_rule.id, v_comm, round(v_comm * coalesce(v_rule.tax_rate,0) / 100, 2))
      returning id into v_item;
      v_rsv := app.reserve_stock(l.variant_id, l.qty, 'order:' || v_order_id, v_minutes);
      update stock_reservations set order_item_id = v_item where id = v_rsv;
    end loop;
  end loop;

  if v_cp.id is not null then
    insert into coupon_redemptions(coupon_id, customer_id, order_id, amount) values (v_cp.id, v_customer, v_order_id, v_disc);
  end if;
  update carts set status = 'converted', updated_at = now() where id = p_cart;

  if p_payment_method = 'cod' then
    update stock_reservations set status = 'consumed', closed_at = now()
     where order_item_id in (select id from order_items where order_id = v_order_id) and status = 'active';
    perform finance.post_order_confirmation(v_order_id);
  else
    insert into payments(order_id, method, amount) values (v_order_id, p_payment_method, v_subtotal - v_disc + v_ship);
  end if;

  select * into v_order from orders where id = v_order_id;
  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                            'grand_total', v_order.grand_total, 'status', v_order.status, 'replay', false);
end $$;

-- Attach the gateway (Razorpay) order id once created by the API layer
create or replace function app.attach_gateway_order(p_order uuid, p_gateway_order_id text)
returns uuid language plpgsql security definer set search_path = public, app, extensions as $$
declare v_id uuid;
begin
  update payments set gateway_order_id = p_gateway_order_id, status = 'pending'
   where order_id = p_order and status = 'initiated' and gateway_order_id is null
  returning id into v_id;
  if v_id is null then raise exception 'NO_PAYMENT_TO_ATTACH'; end if;
  return v_id;
end $$;

-- Payment webhook processing. Signature is verified in the edge function
-- before calling; this function guarantees exactly-once financial effect.
create or replace function app.process_payment_event(
  p_event_id text, p_event_type text, p_gateway_order_id text, p_gateway_payment_id text,
  p_amount app.money, p_payload jsonb, p_signature_ok boolean)
returns text language plpgsql security definer set search_path = public, app, finance, extensions as $$
declare v_evt bigint; v_pay public.payments; v_result text; v_it record; v_short boolean := false; v_rsv uuid;
begin
  insert into payment_events(provider_event_id, event_type, gateway_order_id, gateway_payment_id, amount, payload, signature_verified)
  values (p_event_id, p_event_type, p_gateway_order_id, p_gateway_payment_id, p_amount, app.mask_json(p_payload), p_signature_ok)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_evt;
  if v_evt is null then return 'duplicate'; end if;                               -- UAT-25

  if not p_signature_ok then
    update payment_events set processing_status = 'ignored', note = 'signature failed' where id = v_evt;
    return 'ignored';
  end if;

  select * into v_pay from payments where gateway_order_id = p_gateway_order_id for update;
  if v_pay.id is null then
    update payment_events set processing_status = 'exception', note = 'unknown gateway order' where id = v_evt;
    return 'exception';
  end if;

  if p_event_type = 'payment.captured' then
    if v_pay.status in ('paid','partially_refunded','refunded') then
      v_result := 'already_captured';                                              -- AF-FR-0079
    elsif p_amount <> v_pay.amount then
      update payments set flagged_reason = format('amount mismatch: expected %s got %s', v_pay.amount, p_amount) where id = v_pay.id;
      v_result := 'exception';                                                     -- AF-FR-0083
    else
      -- late payment after hold expiry: re-reserve; if sold out meanwhile, flag for refund review
      for v_it in select oi.id, oi.variant_id, oi.qty - oi.cancelled_qty as q from order_items oi
                   where oi.order_id = v_pay.order_id and oi.qty > oi.cancelled_qty
                     and not exists (select 1 from stock_reservations sr where sr.order_item_id = oi.id and sr.status in ('active','consumed')) loop
        begin
          v_rsv := app.reserve_stock(v_it.variant_id, v_it.q, 'late-capture:' || v_pay.order_id, 60);
          update stock_reservations set order_item_id = v_it.id where id = v_rsv;
        exception when others then
          v_short := true;
        end;
      end loop;
      update payments set status = 'paid', gateway_payment_id = p_gateway_payment_id, captured_at = now(),
                          flagged_reason = case when v_short then 'STOCK_UNAVAILABLE_AFTER_LATE_PAYMENT: refund review' end
       where id = v_pay.id;
      update orders set payment_status = 'paid', status = 'confirmed' where id = v_pay.order_id;
      update sub_orders set status = 'confirmed' where order_id = v_pay.order_id and status = 'pending_payment';
      update stock_reservations set status = 'consumed', closed_at = now()
       where order_item_id in (select id from order_items where order_id = v_pay.order_id) and status = 'active';
      perform finance.post_order_confirmation(v_pay.order_id);
      v_result := 'processed';
    end if;
  elsif p_event_type = 'payment.failed' then
    if v_pay.status in ('paid','partially_refunded','refunded') then
      v_result := 'ignored';                                                       -- late failure after success
    else
      update payments set status = 'failed', failure_code = p_payload->>'error_code',
                          failure_message = left(p_payload->>'error_description', 200) where id = v_pay.id;
      update orders set payment_status = 'failed' where id = v_pay.order_id;
      v_result := 'processed';                          -- reservation stays until expiry so retry can reuse it
    end if;
  else
    v_result := 'ignored';
  end if;

  update payment_events set processing_status = case v_result when 'already_captured' then 'duplicate' else v_result end
   where id = v_evt;
  return v_result;
end $$;

-- Carrier events: normalised status, delivery opens the return window
create or replace function app.record_shipment_event(
  p_shipment uuid, p_carrier_event_id text, p_carrier_status text, p_mapped public.shipment_status,
  p_occurred_at timestamptz, p_location text default null)
returns text language plpgsql security definer set search_path = public, app, extensions as $$
declare s public.shipments; so public.sub_orders; v_days int; r record;
begin
  insert into shipment_events(shipment_id, carrier_event_id, carrier_status, mapped_status, location, occurred_at)
  values (p_shipment, p_carrier_event_id, p_carrier_status, p_mapped, p_location, p_occurred_at)
  on conflict do nothing;
  if not found then return 'duplicate'; end if;

  select * into s from shipments where id = p_shipment for update;
  if s.last_event_at is not null and p_occurred_at < s.last_event_at then return 'stale'; end if;   -- out-of-order
  update shipments set status = p_mapped, last_event_at = p_occurred_at,
         delivered_at = case when p_mapped = 'delivered' then p_occurred_at else delivered_at end
   where id = s.id;

  select * into so from sub_orders where id = s.sub_order_id for update;
  if p_mapped = 'shipped' and so.status = 'ready_to_ship' then
    update sub_orders set status = 'shipped' where id = so.id;
    -- physical stock leaves: consume on_hand and reserved
    for r in select sr.* from stock_reservations sr join order_items oi on oi.id = sr.order_item_id
              where oi.sub_order_id = so.id and sr.status = 'consumed' loop
      perform app.post_stock_movement(r.variant_id, r.warehouse_id, 'dispatch',
              jsonb_build_object('on_hand', -r.qty, 'reserved', -r.qty), 'shipment', s.id::text,
              'dispatch:' || r.id, 'dispatched', null, null, null, true);
    end loop;
  elsif p_mapped = 'delivered' and so.status = 'shipped' then
    select coalesce(max((oi.product_snapshot->>'return_days')::int), 0) into v_days from order_items oi where oi.sub_order_id = so.id;
    update sub_orders set status = 'delivered', delivered_at = p_occurred_at,
           return_window_ends_at = p_occurred_at + make_interval(days => v_days) where id = so.id;
    if not exists (select 1 from sub_orders where order_id = so.order_id and status not in ('delivered','completed','cancelled')) then
      update orders set status = 'delivered' where id = so.order_id;
    else
      update orders set status = 'partially_delivered' where id = so.order_id;
    end if;
  end if;
  return 'processed';
end $$;
