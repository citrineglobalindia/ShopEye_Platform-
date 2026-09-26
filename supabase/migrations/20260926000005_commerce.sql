-- =====================================================================
set search_path = public, extensions;
-- SHOPEYE 0005 — Commerce: cart → checkout → order → payment → fulfilment
--                → cancellation / return → refund
-- Traces: CUST-FR-056..127, CUST §16 order model (master order + vendor
--         sub-orders + shipments), VS-FR §11..§16, SA-FR §13..§17,
--         AF-FR-0062..0084, AF-FR-0152..0182
-- =====================================================================

-- ---------------------------------------------------------------------
-- Addresses & serviceability (CUST §12)
-- ---------------------------------------------------------------------
create table public.customer_addresses (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.profiles(id),
  recipient     text not null check (char_length(btrim(recipient)) between 2 and 100),
  mobile        text not null check (mobile ~ '^\+[1-9][0-9]{7,14}$'),
  alt_mobile    text check (alt_mobile is null or alt_mobile ~ '^\+[1-9][0-9]{7,14}$'),
  line1         text not null check (char_length(btrim(line1)) between 2 and 200),
  line2         text not null check (char_length(btrim(line2)) between 2 and 200),
  landmark      text,
  city          text not null,
  state_code    text not null check (state_code ~ '^[A-Z]{2}$'),
  pincode       text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  country       text not null default 'IN',
  address_type  text not null check (address_type in ('home','work','other')),
  instructions  text check (char_length(instructions) <= 250),
  is_default    boolean not null default false,
  archived_at   timestamptz,                 -- soft delete; past orders keep snapshots (CUST-FR-065/067)
  created_at    timestamptz not null default now()
);
create unique index address_one_default on public.customer_addresses(customer_id) where is_default and archived_at is null;

create table public.serviceable_pincodes (
  pincode      text primary key check (pincode ~ '^[1-9][0-9]{5}$'),
  city         text,
  state_code   text,
  prepaid      boolean not null default true,
  cod          boolean not null default false,
  eta_days_min int not null default 2,
  eta_days_max int not null default 6,
  active       boolean not null default true
);

-- ---------------------------------------------------------------------
-- Cart (CUST §11) — guest or customer, server-authoritative totals
-- ---------------------------------------------------------------------
create table public.carts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid references public.profiles(id),
  guest_token  text unique,
  status       text not null default 'active' check (status in ('active','merged','converted','abandoned')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (customer_id is not null or guest_token is not null)
);
create unique index carts_one_active_per_customer on public.carts(customer_id) where status = 'active' and customer_id is not null;

create table public.cart_items (
  id              uuid primary key default gen_random_uuid(),
  cart_id         uuid not null references public.carts(id) on delete cascade,
  variant_id      uuid not null references public.product_variants(id),
  qty             int not null check (qty between 1 and 999),
  saved_for_later boolean not null default false,       -- excluded from totals (CUST-FR-055)
  price_at_add    app.money not null,                   -- used only to show "price changed" (CUST §30)
  added_at        timestamptz not null default now(),
  unique (cart_id, variant_id, saved_for_later)
);

-- Guest → customer cart merge on login (CUST-FR-058): deterministic max(qty) rule
create or replace function public.merge_guest_cart(p_guest_token text)
returns uuid language plpgsql security definer set search_path = public, app, extensions as $$
declare v_customer uuid := auth.uid(); v_guest uuid; v_cart uuid;
begin
  if v_customer is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select id into v_guest from carts where guest_token = p_guest_token and status = 'active' for update;
  select id into v_cart from carts where customer_id = v_customer and status = 'active' for update;
  if v_cart is null then
    insert into carts(customer_id) values (v_customer) returning id into v_cart;
  end if;
  if v_guest is not null then
    insert into cart_items(cart_id, variant_id, qty, saved_for_later, price_at_add)
    select v_cart, variant_id, qty, saved_for_later, price_at_add from cart_items where cart_id = v_guest
    on conflict (cart_id, variant_id, saved_for_later) do update set qty = greatest(cart_items.qty, excluded.qty);
    update carts set status = 'merged', updated_at = now() where id = v_guest;
  end if;
  return v_cart;
end $$;

-- ---------------------------------------------------------------------
-- Coupons (CUST §14)
-- ---------------------------------------------------------------------
create table public.coupons (
  id                    uuid primary key default gen_random_uuid(),
  code                  citext not null unique,
  discount_type         text not null check (discount_type in ('percent','flat')),
  discount_value        app.money not null check (discount_value > 0),
  max_discount          app.money,
  min_subtotal          app.money not null default 0,
  vendor_id             uuid references public.vendors(id),      -- null = platform-wide
  vendor_funded_pct     numeric(5,2) not null default 0 check (vendor_funded_pct between 0 and 100),
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  usage_limit_total     int,
  usage_limit_per_customer int not null default 1,
  active                boolean not null default true,
  check (ends_at > starts_at),
  check (discount_type <> 'percent' or discount_value <= 100)
);

create table public.coupon_redemptions (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references public.coupons(id),
  customer_id uuid,
  order_id    uuid not null,
  amount      app.money not null,
  status      text not null default 'applied' check (status in ('applied','reversed')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Orders: one Master Order, one Sub-order per vendor, line items
-- ---------------------------------------------------------------------
create type public.order_status as enum
  ('pending_payment','placed','confirmed','processing','partially_shipped','shipped',
   'partially_delivered','delivered','partially_cancelled','cancelled','completed','payment_failed');
create type public.payment_state as enum
  ('initiated','pending','authorized','paid','failed','cancelled','partially_refunded','refunded','cod_pending');
create type public.sub_order_status as enum
  ('pending_payment','confirmed','packed','ready_to_ship','shipped','delivered','completed',
   'cancelled','rto_initiated','rto_delivered');

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text not null unique default app.next_number('order'),
  customer_id     uuid references public.profiles(id),
  guest_contact   jsonb,
  cart_id         uuid references public.carts(id),
  idempotency_key text not null unique,                             -- CUST-FR-069
  status          public.order_status not null default 'pending_payment',
  payment_status  public.payment_state not null default 'initiated',
  payment_method  text not null check (payment_method in ('upi','card','netbanking','wallet','cod','emi')),
  currency        char(3) not null default 'INR',
  subtotal        app.money not null check (subtotal >= 0),
  discount_total  app.money not null default 0 check (discount_total >= 0),
  shipping_total  app.money not null default 0 check (shipping_total >= 0),
  tax_total       app.money not null default 0 check (tax_total >= 0),    -- GST included in prices
  grand_total     app.money not null check (grand_total >= 0),              -- CUST-FR-081
  coupon_code     citext,
  ship_address    jsonb not null,                                   -- immutable snapshot (CUST-FR-093)
  bill_address    jsonb not null,
  placed_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (customer_id is not null or guest_contact is not null),
  constraint order_total_reconciles check (grand_total = subtotal - discount_total + shipping_total)
);
create index orders_customer_idx on public.orders(customer_id, placed_at desc);
create trigger orders_touch before update on public.orders for each row execute function app.touch_updated_at();
create trigger orders_audit after update on public.orders for each row execute function app.audit_row();

create table public.sub_orders (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id),
  vendor_id        uuid not null references public.vendors(id),
  sub_order_number text not null unique default app.next_number('sub_order'),
  status           public.sub_order_status not null default 'pending_payment',
  subtotal         app.money not null,
  discount_total   app.money not null default 0,
  shipping_total   app.money not null default 0,
  total            app.money not null,
  delivered_at     timestamptz,
  return_window_ends_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (order_id, vendor_id),
  check (total = subtotal - discount_total + shipping_total)
);
create index sub_orders_vendor_idx on public.sub_orders(vendor_id, status, created_at desc);
create trigger sub_orders_touch  before update on public.sub_orders for each row execute function app.touch_updated_at();
create trigger sub_orders_status before update on public.sub_orders for each row execute function app.enforce_transition('sub_order');
create trigger sub_orders_audit  after update on public.sub_orders for each row execute function app.audit_row();

insert into app.status_transitions(entity, from_status, to_status) values
  ('sub_order','pending_payment','confirmed'), ('sub_order','pending_payment','cancelled'),
  ('sub_order','confirmed','packed'),          ('sub_order','confirmed','cancelled'),
  ('sub_order','packed','ready_to_ship'),      ('sub_order','packed','cancelled'),
  ('sub_order','ready_to_ship','shipped'),     ('sub_order','ready_to_ship','cancelled'),
  -- after carrier handover cancellation is not allowed; RTO path only (VS-FR-892)
  ('sub_order','shipped','delivered'),         ('sub_order','shipped','rto_initiated'),
  ('sub_order','rto_initiated','rto_delivered'),('sub_order','delivered','completed');

create table public.order_items (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references public.orders(id),
  sub_order_id            uuid not null references public.sub_orders(id),
  variant_id              uuid not null references public.product_variants(id),
  product_snapshot        jsonb not null,                            -- title, sku, attributes, image, hsn
  qty                     int not null check (qty > 0),
  mrp                     app.money not null,
  unit_price              app.money not null check (unit_price >= 0),
  discount                app.money not null default 0 check (discount >= 0),
  platform_funded_discount app.money not null default 0 check (platform_funded_discount >= 0),
  vendor_funded_discount  app.money not null default 0 check (vendor_funded_discount >= 0),
  line_total              app.money not null check (line_total >= 0),
  gst_rate                numeric(5,2) not null,
  taxable_value           app.money not null,
  tax_amount              app.money not null,
  commission_rule_id      uuid,
  commission_amount       app.money not null default 0,              -- frozen at order time (AF-FR-0253)
  commission_tax          app.money not null default 0,
  cancelled_qty           int not null default 0 check (cancelled_qty >= 0),
  return_requested_qty    int not null default 0 check (return_requested_qty >= 0),
  refunded_amount         app.money not null default 0 check (refunded_amount >= 0),
  constraint line_math check (line_total = unit_price * qty - discount),
  constraint discount_funding check (discount = platform_funded_discount + vendor_funded_discount),  -- AF-FR-0474
  constraint tax_math check (taxable_value + tax_amount = line_total),
  constraint qty_bounds check (cancelled_qty + return_requested_qty <= qty)                          -- CUST-FR-115
);
create index order_items_order_idx on public.order_items(order_id);
alter table public.stock_reservations
  add constraint reservations_item_fk foreign key (order_item_id) references public.order_items(id);

-- ---------------------------------------------------------------------
-- Payments & webhook events (CUST §15, AF §5, AF §36)
-- ---------------------------------------------------------------------
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id),
  method              text not null,
  gateway             text not null default 'razorpay',
  gateway_order_id    text unique,
  gateway_payment_id  text unique,                               -- AF-FR-0079 no duplicate capture
  amount              app.money not null check (amount >= 0),
  currency            char(3) not null default 'INR',
  status              public.payment_state not null default 'initiated',
  failure_code        text,
  failure_message     text,
  captured_at         timestamptz,
  flagged_reason      text,                                      -- AF-FR-0083 mismatch flag
  created_at          timestamptz not null default now()
);
create index payments_order_idx on public.payments(order_id);

-- Original financial fields are immutable once created (AF-FR-0077)
create or replace function app.guard_payment_immutable() returns trigger language plpgsql as $$
begin
  if new.amount <> old.amount or new.order_id <> old.order_id or new.currency <> old.currency
     or new.method <> old.method
     or (old.gateway_payment_id is not null and new.gateway_payment_id is distinct from old.gateway_payment_id)
     or (old.gateway_order_id  is not null and new.gateway_order_id  is distinct from old.gateway_order_id) then
    raise exception 'IMMUTABLE_PAYMENT_FIELD' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger payments_immutable before update on public.payments for each row execute function app.guard_payment_immutable();
create trigger payments_audit after update on public.payments for each row execute function app.audit_row();

create table public.payment_events (
  id                 bigint generated always as identity primary key,
  provider           text not null default 'razorpay',
  provider_event_id  text not null,
  event_type         text not null,
  gateway_order_id   text,
  gateway_payment_id text,
  amount             app.money,
  payload            jsonb,                                  -- sanitized (AF-FR-0082)
  signature_verified boolean not null,
  processing_status  text not null default 'received'
                     check (processing_status in ('received','processed','ignored','duplicate','exception','failed')),
  note               text,
  received_at        timestamptz not null default now(),
  unique (provider, provider_event_id)                        -- AF-FR-0667 idempotent webhooks
);

-- ---------------------------------------------------------------------
-- Shipments (CUST §18, VS §13)
-- ---------------------------------------------------------------------
create type public.shipment_status as enum
  ('preparing','packed','shipped','in_transit','out_for_delivery','delivery_attempted','delivered','rto','returned');

create table public.shipments (
  id            uuid primary key default gen_random_uuid(),
  sub_order_id  uuid not null references public.sub_orders(id),
  carrier       text,
  awb           text unique,
  status        public.shipment_status not null default 'preparing',
  eta_from      date,
  eta_to        date,
  shipped_at    timestamptz,
  delivered_at  timestamptz,
  last_event_at timestamptz,
  created_at    timestamptz not null default now()
);

create table public.shipment_events (
  id              bigint generated always as identity primary key,
  shipment_id     uuid not null references public.shipments(id),
  carrier_event_id text not null,
  carrier_status  text not null,                   -- raw code, kept for traceability (VS-FR-893)
  mapped_status   public.shipment_status not null, -- normalised (CUST-FR-100)
  location        text,
  occurred_at     timestamptz not null,
  received_at     timestamptz not null default now(),
  unique (shipment_id, carrier_event_id)
);
create trigger shipment_events_immutable before update or delete on public.shipment_events
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------
-- Refunds (CUST §22, AF §9)
-- ---------------------------------------------------------------------
create type public.refund_processor_status as enum ('not_sent','processing','success','failed','reversed');

create table public.refunds (
  id                uuid primary key default gen_random_uuid(),
  refund_number     text not null unique default app.next_number('refund'),
  order_id          uuid not null references public.orders(id),
  payment_id        uuid not null references public.payments(id),
  refund_type       text not null check (refund_type in ('full','partial','item','shipping','adjustment')),
  source_type       text not null check (source_type in ('cancellation','return','support','finance')),
  source_id         text,
  requested_amount  app.money not null check (requested_amount > 0),
  approved_amount   app.money check (approved_amount > 0 and approved_amount <= requested_amount),
  reason_code       text not null,
  reason_details    text,
  approval_status   text not null default 'not_required' check (approval_status in ('not_required','pending','approved','rejected')),
  approval_request_id uuid references app.approval_requests(id),
  processor_status  public.refund_processor_status not null default 'not_sent',
  gateway_refund_id text unique,
  failure_code      text,
  initiated_by      uuid,
  idempotency_key   text not null unique,                        -- AF-FR-0169
  created_at        timestamptz not null default now(),
  approved_at       timestamptz,
  submitted_at      timestamptz,
  completed_at      timestamptz
);
create trigger refunds_audit after insert or update on public.refunds for each row execute function app.audit_row();

-- Refundable balance considers successful and in-flight refunds (AF-FR-0168, CUST-FR-124)
create or replace function app.refundable_balance(p_payment uuid) returns app.money
language sql stable as $$
  select (p.amount - coalesce((select sum(coalesce(r.approved_amount, r.requested_amount)) from public.refunds r
                                where r.payment_id = p.id
                                  and r.approval_status <> 'rejected'
                                  and r.processor_status not in ('failed','reversed')), 0))::app.money
  from public.payments p where p.id = p_payment and p.status in ('paid','partially_refunded')
$$;

create or replace function app.request_refund(
  p_order uuid, p_amount app.money, p_type text, p_source_type text, p_source_id text,
  p_reason text, p_idem_key text, p_details text default null)
returns uuid language plpgsql security definer set search_path = public, app, extensions as $$
declare v_pay public.payments; v_id uuid; v_bal app.money; v_rule_exists boolean;
begin
  select id into v_id from refunds where idempotency_key = p_idem_key;
  if v_id is not null then return v_id; end if;                         -- replay-safe

  select * into v_pay from payments where order_id = p_order and status in ('paid','partially_refunded')
   order by captured_at limit 1 for update;                             -- serialises refunds per payment
  if v_pay.id is null then raise exception 'NO_REFUNDABLE_PAYMENT'; end if;

  v_bal := app.refundable_balance(v_pay.id);
  if p_amount > v_bal then
    raise exception 'REFUND_EXCEEDS_BALANCE: requested % refundable %', p_amount, v_bal using errcode = 'P0001';
  end if;

  select exists (select 1 from approval_rules where action_type = 'refund' and active
                  and p_amount >= amount_from and (amount_to is null or p_amount <= amount_to)
                  and checker_role is not null and checker_role <> 'none') into v_rule_exists;

  insert into refunds(order_id, payment_id, refund_type, source_type, source_id, requested_amount,
                      reason_code, reason_details, approval_status, initiated_by, idempotency_key)
  values (p_order, v_pay.id, p_type, p_source_type, p_source_id, p_amount, p_reason, p_details,
          case when v_rule_exists then 'pending' else 'not_required' end, app.actor_id(), p_idem_key)
  returning id into v_id;

  if v_rule_exists then
    update refunds set approval_request_id =
      app.submit_for_approval('refund', 'refund', v_id::text, p_amount, md5(v_id::text || p_amount::text))
    where id = v_id;
  else
    update refunds set approved_amount = p_amount, approved_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Cancellations (CUST §20) & Returns (CUST §21)
-- ---------------------------------------------------------------------
create table public.cancellations (
  id              uuid primary key default gen_random_uuid(),
  order_item_id   uuid not null references public.order_items(id),
  qty             int not null check (qty > 0),
  reason          text not null,
  comments        text check (char_length(comments) <= 500),
  requested_by    uuid,
  refund_id       uuid references public.refunds(id),
  idempotency_key text not null unique,                             -- CUST-FR-113
  status          text not null default 'completed' check (status in ('pending','completed','rejected')),
  created_at      timestamptz not null default now()
);

create type public.return_status as enum
  ('requested','under_review','approved','pickup_scheduled','picked_up','in_transit','received',
   'quality_check','accepted','rejected','refund_initiated','refund_completed','exchange_processing','closed','cancelled');

create table public.returns (
  id              uuid primary key default gen_random_uuid(),
  return_number   text not null unique default app.next_number('return'),
  order_item_id   uuid not null references public.order_items(id),
  qty             int not null check (qty > 0),
  resolution      text not null check (resolution in ('refund','replacement','exchange')),
  reason          text not null,
  reason_details  text,
  evidence_paths  text[] not null default '{}',
  pickup_address  jsonb,
  status          public.return_status not null default 'requested',
  qc_result       text check (qc_result in ('pass','fail','partial')),
  rejection_reason text,
  idempotency_key text not null unique,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger returns_touch  before update on public.returns for each row execute function app.touch_updated_at();
create trigger returns_status before update on public.returns for each row execute function app.enforce_transition('return');
create trigger returns_audit  after insert or update on public.returns for each row execute function app.audit_row();

insert into app.status_transitions(entity, from_status, to_status) values
  ('return','requested','under_review'), ('return','requested','approved'), ('return','requested','cancelled'),
  ('return','under_review','approved'), ('return','under_review','rejected'),
  ('return','approved','pickup_scheduled'), ('return','approved','cancelled'),
  ('return','pickup_scheduled','picked_up'), ('return','pickup_scheduled','cancelled'),
  ('return','picked_up','in_transit'), ('return','in_transit','received'), ('return','picked_up','received'),
  ('return','received','quality_check'), ('return','quality_check','accepted'), ('return','quality_check','rejected'),
  ('return','accepted','refund_initiated'), ('return','accepted','exchange_processing'),
  ('return','refund_initiated','refund_completed'), ('return','refund_completed','closed'),
  ('return','exchange_processing','closed'), ('return','rejected','closed');

-- Pre-dispatch item cancellation with pro-rata refund (CUST-FR-110..114)
create or replace function public.cancel_order_item(p_item uuid, p_qty int, p_reason text, p_idem_key text, p_comments text default null)
returns jsonb language plpgsql security definer set search_path = public, app, extensions as $$
declare it order_items; so sub_orders; o orders; v_cancel uuid; v_refund uuid; v_amount app.money; r record; v_left int;
begin
  select id, refund_id into v_cancel, v_refund from cancellations where idempotency_key = p_idem_key;
  if v_cancel is not null then
    return jsonb_build_object('cancellation_id', v_cancel, 'refund_id', v_refund, 'replay', true);
  end if;

  select * into it from order_items where id = p_item for update;
  select * into o  from orders where id = it.order_id;
  if o.customer_id is distinct from auth.uid() and not app.has_permission('order.view.all') then
    raise exception 'FORBIDDEN' using errcode = '42501';                 -- CUST-FR-172/173
  end if;
  select * into so from sub_orders where id = it.sub_order_id for update;
  if so.status not in ('pending_payment','confirmed','packed','ready_to_ship') then
    raise exception 'NOT_CANCELLABLE: sub-order is %', so.status using errcode = 'P0001';
  end if;
  if p_qty > it.qty - it.cancelled_qty - it.return_requested_qty then
    raise exception 'CANCEL_QTY_EXCEEDS_REMAINING';
  end if;

  -- pro-rata of the line total keeps promotion allocation deterministic (CUST-FR-111)
  v_amount := round(it.line_total * p_qty / it.qty, 2);
  update order_items set cancelled_qty = cancelled_qty + p_qty where id = it.id;

  -- release the reserved units
  v_left := p_qty;
  for r in select * from stock_reservations where order_item_id = it.id and status in ('active','consumed') loop
    exit when v_left = 0;
    perform app.post_stock_movement(r.variant_id, r.warehouse_id, 'reservation_release',
            jsonb_build_object('reserved', -least(v_left, r.qty)), 'cancellation', p_idem_key,
            'cxl:' || p_idem_key || ':' || r.id, p_reason, null, null, null, true);
    if v_left >= r.qty then
      update stock_reservations set status = 'released', closed_at = now() where id = r.id;
    else
      update stock_reservations set qty = qty - v_left where id = r.id;
    end if;
    v_left := v_left - least(v_left, r.qty);
  end loop;

  insert into cancellations(order_item_id, qty, reason, comments, requested_by, idempotency_key)
  values (it.id, p_qty, p_reason, p_comments, app.actor_id(), p_idem_key) returning id into v_cancel;

  -- money only moves if it was actually collected (CUST-FR-112)
  if o.payment_status in ('paid','partially_refunded') then
    v_refund := app.request_refund(o.id, v_amount, 'item', 'cancellation', v_cancel::text, p_reason, 'rf:' || p_idem_key);
    update cancellations set refund_id = v_refund where id = v_cancel;
  end if;

  if not exists (select 1 from order_items where sub_order_id = so.id and cancelled_qty < qty) then
    update sub_orders set status = 'cancelled' where id = so.id;
  end if;
  update orders set status = (case
      when not exists (select 1 from order_items where order_id = o.id and cancelled_qty < qty) then 'cancelled'
      else 'partially_cancelled' end)::public.order_status
   where id = o.id;

  return jsonb_build_object('cancellation_id', v_cancel, 'refund_id', v_refund, 'refund_amount',
                            case when v_refund is null then 0 else v_amount end, 'replay', false);
end $$;

-- Return request with window and quantity validation (CUST-FR-115..121)
create or replace function public.request_return(
  p_item uuid, p_qty int, p_resolution text, p_reason text, p_idem_key text,
  p_details text default null, p_evidence text[] default '{}', p_pickup jsonb default null)
returns uuid language plpgsql security definer set search_path = public, app, extensions as $$
declare it order_items; so sub_orders; o orders; v_id uuid;
begin
  select id into v_id from returns where idempotency_key = p_idem_key;
  if v_id is not null then return v_id; end if;

  select * into it from order_items where id = p_item for update;
  select * into o from orders where id = it.order_id;
  if o.customer_id is distinct from auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into so from sub_orders where id = it.sub_order_id;
  if so.status not in ('delivered','completed') then raise exception 'NOT_DELIVERED'; end if;
  if coalesce((it.product_snapshot->>'is_returnable')::boolean, true) = false then raise exception 'NOT_RETURNABLE'; end if;
  if so.return_window_ends_at is null or now() > so.return_window_ends_at then
    raise exception 'RETURN_WINDOW_CLOSED: ended %', so.return_window_ends_at using errcode = 'P0001';
  end if;
  if p_qty > it.qty - it.cancelled_qty - it.return_requested_qty then
    raise exception 'RETURN_QTY_EXCEEDS_DELIVERED' using errcode = 'P0001';
  end if;
  if p_reason in ('damaged','defective','wrong_item') and coalesce(array_length(p_evidence,1),0) = 0 then
    raise exception 'EVIDENCE_REQUIRED';
  end if;

  update order_items set return_requested_qty = return_requested_qty + p_qty where id = it.id;
  insert into returns(order_item_id, qty, resolution, reason, reason_details, evidence_paths, pickup_address, idempotency_key, created_by)
  values (it.id, p_qty, p_resolution, p_reason, p_details, p_evidence, coalesce(p_pickup, o.ship_address), p_idem_key, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
