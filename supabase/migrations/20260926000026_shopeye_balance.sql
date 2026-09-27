-- SHOPEYE 0026 — ShopEye balance: store credit, gift cards and loyalty points; paying with it at checkout;
-- refunds split by tender with a fixed order; everything posted to the ledger.
-- Traces: CUST-FR-076 CUST-FR-077 CUST-FR-078 CUST-FR-079 CUST-FR-080 CUST-FR-127
-- Rules (settings, change without code):
--   * store credit (refunds the customer chose to take as balance) expires after wallet.store_credit_expiry_days
--   * gift cards are closed-loop ShopEye cards issued by admin; redeeming moves the full value into the balance, which
--     is then used partly or wholly across orders until the card's expiry
--   * loyalty: loyalty.points_per_100 points per ₹100 of delivered goods, worth loyalty.rupees_per_point each, usable once the
--     return window closes, capped at loyalty.max_redeem_pct of an order, expiring after loyalty.expiry_days
--   * paying: gift card balance first, then store credit, then points; the rest by Razorpay
--   * refunds: card/UPI part first (up to what it paid), then ShopEye balance, which goes back to gift card, store credit
--     and points in that order
set search_path = public, extensions;

insert into app.settings(key, value, effective_from) values
  ('wallet.store_credit_expiry_days', '365', '2000-01-01'), ('loyalty.points_per_100', '1', '2000-01-01'),
  ('loyalty.rupees_per_point', '1', '2000-01-01'), ('loyalty.max_redeem_pct', '10', '2000-01-01'), ('loyalty.expiry_days', '365', '2000-01-01'),
  ('gift_card.max_amount', '10000', '2000-01-01')
on conflict do nothing;
insert into finance.gl_accounts values ('2600','Customer balances (store credit, gift cards, points)','liability'),
  ('4300','Expired customer balances','income'), ('5400','Loyalty points expense','expense') on conflict do nothing;
insert into public.permissions(code, portal, description, sensitive) values ('gift_card.manage', 'super_admin', 'Issue and void gift cards', true) on conflict (code) do nothing;
insert into public.role_permissions(role_code, permission_code) values ('super_admin', 'gift_card.manage') on conflict do nothing;

alter table public.refunds add column if not exists destination text not null default 'original' check (destination in ('original','store_credit'));

-- ---------- Balance lots (each credit, with its own expiry) and an append-only ledger ----------
create table public.wallet_lots (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.profiles(id),
  fund         text not null check (fund in ('store_credit','gift_card','loyalty')),
  original     app.money not null check (original > 0),
  remaining    app.money not null check (remaining >= 0),
  available_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  source       text not null,
  source_key   text not null unique,
  created_at   timestamptz not null default now(),
  check (remaining <= original), check (expires_at > available_at)
);
create index wallet_lots_customer_idx on public.wallet_lots(customer_id, fund, expires_at);
create table public.wallet_ledger (
  id          bigint generated always as identity primary key,
  customer_id uuid not null references public.profiles(id),
  fund        text not null,
  amount      app.money not null check (amount > 0),   -- always positive; direction says which way
  direction   text not null check (direction in ('credit','debit')),
  kind        text not null check (kind in ('refund_credit','gift_card_redeem','loyalty_earn','loyalty_reverse','order_payment','order_release','refund_restore','expiry','adjustment')),
  order_id    uuid references public.orders(id),
  lot_id      uuid references public.wallet_lots(id),
  note        text,
  created_at  timestamptz not null default now()
);
create index wallet_ledger_customer_idx on public.wallet_ledger(customer_id, created_at desc);
create index wallet_ledger_order_idx on public.wallet_ledger(order_id);
alter table public.wallet_lots enable row level security;
alter table public.wallet_ledger enable row level security;
revoke all on public.wallet_lots, public.wallet_ledger from anon, authenticated;
grant select on public.wallet_lots, public.wallet_ledger to authenticated;
create policy wallet_lots_own on public.wallet_lots for select using (customer_id = auth.uid());
create policy wallet_ledger_own on public.wallet_ledger for select using (customer_id = auth.uid());

create or replace function app.wallet_credit(p_customer uuid, p_fund text, p_amount numeric, p_expires timestamptz, p_available timestamptz,
                                             p_kind text, p_source text, p_key text, p_order uuid default null) returns uuid
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_id uuid;
begin
  if p_amount <= 0 then return null; end if;
  insert into wallet_lots(customer_id, fund, original, remaining, available_at, expires_at, source, source_key)
  values (p_customer, p_fund, p_amount, p_amount, p_available, p_expires, p_source, p_key)
  on conflict (source_key) do nothing returning id into v_id;
  if v_id is null then return (select id from wallet_lots where source_key = p_key); end if;     -- replay
  insert into wallet_ledger(customer_id, fund, amount, direction, kind, order_id, lot_id, note) values (p_customer, p_fund, p_amount, 'credit', p_kind, p_order, v_id, p_source);
  return v_id;
end $$;

-- Spend from one fund, earliest expiry first; only lots that are available and not expired
create or replace function app.wallet_debit(p_customer uuid, p_fund text, p_amount numeric, p_kind text, p_order uuid) returns numeric
language plpgsql security definer set search_path = public, app, extensions as $$
declare l record; v_left numeric := p_amount; v_take numeric;
begin
  if p_amount <= 0 then return 0; end if;
  for l in select * from wallet_lots where customer_id = p_customer and fund = p_fund and remaining > 0 and available_at <= now() and expires_at > now()
            order by expires_at, created_at for update loop
    exit when v_left <= 0;
    v_take := least(l.remaining, v_left);
    update wallet_lots set remaining = remaining - v_take where id = l.id;
    insert into wallet_ledger(customer_id, fund, amount, direction, kind, order_id, lot_id) values (p_customer, p_fund, v_take, 'debit', p_kind, p_order, l.id);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0.004 then raise exception 'INSUFFICIENT_BALANCE: % short by %', p_fund, v_left using errcode = 'P0001'; end if;
  return p_amount;
end $$;

create or replace function app.wallet_available(p_customer uuid, p_fund text) returns numeric language sql stable security definer set search_path = public, app, extensions as $$
  select coalesce(sum(remaining), 0) from wallet_lots where customer_id = p_customer and fund = p_fund and available_at <= now() and expires_at > now()
$$;
create or replace function app.loyalty_cap(p_total numeric) returns numeric language sql stable set search_path = public, app, extensions as $$
  select floor(p_total * (app.setting('loyalty.max_redeem_pct'))::text::numeric / 100)
$$;

-- What the customer has, what expires when, and the rules that apply (CUST-FR-078/079)
create or replace function public.my_wallet() returns jsonb
language sql stable security definer set search_path = public, app, extensions as $$
  select jsonb_build_object(
    'store_credit', app.wallet_available(auth.uid(), 'store_credit'),
    'gift_card', app.wallet_available(auth.uid(), 'gift_card'),
    'loyalty_value', app.wallet_available(auth.uid(), 'loyalty'),
    'loyalty_points', floor(app.wallet_available(auth.uid(), 'loyalty') / (app.setting('loyalty.rupees_per_point'))::text::numeric),
    'loyalty_pending_points', (select coalesce(floor(sum(remaining) / (app.setting('loyalty.rupees_per_point'))::text::numeric), 0)
                                 from wallet_lots where customer_id = auth.uid() and fund = 'loyalty' and available_at > now() and expires_at > now()),
    'next_expiries', (select coalesce(jsonb_agg(jsonb_build_object('fund', fund, 'amount', remaining, 'expires_at', expires_at) order by expires_at), '[]'::jsonb)
                        from (select fund, remaining, expires_at from wallet_lots where customer_id = auth.uid() and remaining > 0 and expires_at > now() and available_at <= now()
                              order by expires_at limit 5) x),
    'rules', jsonb_build_object('points_per_100', (app.setting('loyalty.points_per_100'))::text::numeric, 'rupees_per_point', (app.setting('loyalty.rupees_per_point'))::text::numeric,
                                'max_redeem_pct', (app.setting('loyalty.max_redeem_pct'))::text::numeric, 'loyalty_expiry_days', (app.setting('loyalty.expiry_days'))::text::int,
                                'store_credit_expiry_days', (app.setting('wallet.store_credit_expiry_days'))::text::int))
  where auth.uid() is not null
$$;

-- ---------- Gift cards: closed-loop, issued by ShopEye; only a hash of the code is stored (CUST-FR-076/077) ----------
create table public.gift_cards (
  id          uuid primary key default gen_random_uuid(),
  code_hash   text not null unique,
  last4       text not null,
  amount      app.money not null check (amount > 0),
  expires_at  timestamptz not null,
  status      text not null default 'active' check (status in ('active','redeemed','void')),
  note        text,
  issued_by   uuid,
  redeemed_by uuid references public.profiles(id),
  redeemed_at timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.gift_cards enable row level security;
revoke all on public.gift_cards from anon, authenticated;
grant select (id, last4, amount, expires_at, status, note, redeemed_at, created_at) on public.gift_cards to authenticated;
create policy gift_cards_admin on public.gift_cards for select using (app.has_permission('gift_card.manage'));
create table app.gift_card_attempts (customer_id uuid not null, ok boolean not null, at timestamptz not null default now());
create index gift_card_attempts_idx on app.gift_card_attempts(customer_id, at);

create or replace function app.gift_code_hash(p text) returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest('shopeye-gift:' || upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
$$;

create or replace function public.admin_issue_gift_cards(p_count int, p_amount numeric, p_valid_days int, p_note text default null)
returns table (code text, last4 text, amount numeric, expires_at timestamptz)
language plpgsql security definer set search_path = public, app, finance, extensions as $$
declare v_code text; i int; cs text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; k int; v_exp timestamptz := now() + make_interval(days => p_valid_days); v_total numeric := 0;
begin
  perform app.require_permission('gift_card.manage');
  if p_count not between 1 and 500 then raise exception 'COUNT_OUT_OF_RANGE' using errcode = 'P0001'; end if;
  if p_amount <= 0 or p_amount > (app.setting('gift_card.max_amount'))::text::numeric then raise exception 'AMOUNT_OUT_OF_RANGE' using errcode = 'P0001'; end if;
  if p_valid_days not between 30 and 1095 then raise exception 'VALIDITY_OUT_OF_RANGE' using errcode = 'P0001'; end if;
  for i in 1..p_count loop
    b := extensions.gen_random_bytes(16); v_code := '';
    for k in 0..15 loop v_code := v_code || substr(cs, (get_byte(b, k) % 32) + 1, 1); end loop;
    v_code := 'SE' || substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4);
    insert into gift_cards(code_hash, last4, amount, expires_at, note, issued_by) values (app.gift_code_hash(v_code), right(v_code, 4), p_amount, v_exp, p_note, auth.uid());
    code := v_code; last4 := right(v_code, 4); amount := p_amount; expires_at := v_exp; v_total := v_total + p_amount;
    return next;
  end loop;
  -- promotional issue: the liability is recognised when issued
  perform finance.post_journal('gift_card', 'batch:' || gen_random_uuid(), 'gift-issue:' || gen_random_uuid(), 'Gift cards issued: ' || p_count || ' x ' || p_amount,
    jsonb_build_array(jsonb_build_object('account', '5300', 'debit', v_total, 'memo', coalesce(p_note, 'Gift cards issued')),
                      jsonb_build_object('account', '2600', 'credit', v_total, 'memo', 'Gift card balances')));
end $$;

create or replace function public.redeem_gift_card(p_code text) returns jsonb
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_uid uuid := auth.uid(); g gift_cards;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if (select count(*) from app.gift_card_attempts where customer_id = v_uid and not ok and at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED: too many wrong gift card codes, try again in an hour' using errcode = 'P0001';     -- guessing protection
  end if;
  select * into g from gift_cards where code_hash = app.gift_code_hash(p_code) for update;
  if g.id is null or g.status = 'void' then
    -- returned, not raised: an exception would roll back the attempt record and defeat the guessing limit
    insert into app.gift_card_attempts(customer_id, ok) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'GIFT_CARD_INVALID');
  end if;
  if g.status = 'redeemed' then raise exception 'GIFT_CARD_ALREADY_REDEEMED' using errcode = 'P0001'; end if;
  if g.expires_at <= now() then raise exception 'GIFT_CARD_EXPIRED' using errcode = 'P0001'; end if;
  update gift_cards set status = 'redeemed', redeemed_by = v_uid, redeemed_at = now() where id = g.id;
  insert into app.gift_card_attempts(customer_id, ok) values (v_uid, true);
  perform app.wallet_credit(v_uid, 'gift_card', g.amount, g.expires_at, now(), 'gift_card_redeem', 'Gift card ••' || g.last4, 'gift:' || g.id);
  return jsonb_build_object('ok', true, 'amount', g.amount, 'expires_at', g.expires_at, 'balance', app.wallet_available(v_uid, 'gift_card'));
end $$;

-- ---------- Loyalty points: earned on delivery, usable after the return window, reversed for returns (CUST-FR-079) ----------
create or replace function app.on_sub_order_loyalty() returns trigger language plpgsql security definer set search_path = public, app, finance, extensions as $$
declare o orders; v_goods numeric; v_pts numeric; v_val numeric; v_avail timestamptz; v_lot uuid;
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    select * into o from orders where id = new.order_id;
    if o.customer_id is null then return new; end if;
    select coalesce(sum(oi.unit_price * (oi.qty - oi.cancelled_qty) - round(oi.discount * (oi.qty - oi.cancelled_qty) / oi.qty, 2)), 0) into v_goods
      from order_items oi where oi.sub_order_id = new.id;
    v_pts := floor(v_goods / 100) * (app.setting('loyalty.points_per_100'))::text::numeric;
    v_val := v_pts * (app.setting('loyalty.rupees_per_point'))::text::numeric;
    if v_val <= 0 then return new; end if;
    v_avail := coalesce(new.return_window_ends_at, now() + interval '7 days');
    v_lot := app.wallet_credit(o.customer_id, 'loyalty', v_val, v_avail + make_interval(days => (app.setting('loyalty.expiry_days'))::text::int), v_avail,
                               'loyalty_earn', 'Points for ' || new.sub_order_number, 'loyalty:' || new.id, o.id);
    perform finance.post_journal('loyalty', new.id::text, 'loyalty-earn:' || new.id, 'Loyalty points ' || new.sub_order_number,
      jsonb_build_array(jsonb_build_object('account', '5400', 'debit', v_val), jsonb_build_object('account', '2600', 'credit', v_val, 'party_type', 'customer', 'party_id', o.customer_id)));
  end if;
  return new;
exception when others then
  raise warning 'ShopEye loyalty points not credited: %', sqlerrm; return new;   -- never blocks delivery
end $$;
create trigger sub_orders_loyalty after update of status on public.sub_orders for each row execute function app.on_sub_order_loyalty();

-- A completed return takes back the points it earned, if they haven't become usable yet
create or replace function app.on_return_loyalty() returns trigger language plpgsql security definer set search_path = public, app, finance, extensions as $$
declare l wallet_lots; it order_items; v_take numeric;
begin
  if new.status = 'refund_completed' and old.status is distinct from 'refund_completed' then
    select * into it from order_items where id = new.order_item_id;
    select * into l from wallet_lots where source_key = 'loyalty:' || it.sub_order_id for update;
    if l.id is null or l.available_at <= now() then return new; end if;
    v_take := least(l.remaining, floor(it.unit_price * new.qty / 100) * (app.setting('loyalty.points_per_100'))::text::numeric * (app.setting('loyalty.rupees_per_point'))::text::numeric);
    if v_take <= 0 then return new; end if;
    update wallet_lots set remaining = remaining - v_take where id = l.id;
    insert into wallet_ledger(customer_id, fund, amount, direction, kind, lot_id, note) values (l.customer_id, 'loyalty', v_take, 'debit', 'loyalty_reverse', l.id, 'Returned item');
    perform finance.post_journal('loyalty', new.id::text, 'loyalty-reverse:' || new.id, 'Loyalty points reversed (return)',
      jsonb_build_array(jsonb_build_object('account', '2600', 'debit', v_take, 'party_type', 'customer', 'party_id', l.customer_id), jsonb_build_object('account', '5400', 'credit', v_take)));
  end if;
  return new;
exception when others then
  raise warning 'ShopEye loyalty reversal failed: %', sqlerrm; return new;
end $$;
create trigger returns_loyalty after update of status on public.returns for each row execute function app.on_return_loyalty();

-- ---------- Paying with ShopEye balance (CUST-FR-076/079) ----------
create or replace function app.confirm_paid_order(p_order uuid) returns void language plpgsql security definer set search_path = public, app, finance, extensions as $$
begin
  update orders set payment_status = 'paid', status = 'confirmed' where id = p_order;
  update sub_orders set status = 'confirmed' where order_id = p_order and status = 'pending_payment';
  update stock_reservations set status = 'consumed', closed_at = now()
   where order_item_id in (select id from order_items where order_id = p_order) and status = 'active';
  perform finance.post_order_confirmation(p_order);
end $$;

create or replace function public.apply_balance(p_order uuid, p_gift_card boolean, p_store_credit boolean, p_points int default 0) returns jsonb
language plpgsql security definer set search_path = public, app, finance, extensions as $$
declare v_uid uuid := auth.uid(); o orders; gp payments; v_due numeric; v_g numeric := 0; v_s numeric := 0; v_p numeric := 0; v_rate numeric; v_total numeric;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into o from orders where id = p_order and customer_id = v_uid for update;
  if o.id is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if o.status <> 'pending_payment' or o.payment_status not in ('initiated','pending','failed') then raise exception 'ORDER_NOT_AWAITING_PAYMENT' using errcode = 'P0001'; end if;
  if exists (select 1 from payments where order_id = o.id and gateway = 'shopeye_wallet' and status in ('authorized','paid')) then raise exception 'BALANCE_ALREADY_APPLIED' using errcode = 'P0001'; end if;
  select * into gp from payments where order_id = o.id and gateway = 'razorpay' and status in ('initiated','pending','failed') order by created_at desc limit 1 for update;
  if gp.id is null then raise exception 'NO_PAYMENT_TO_REDUCE' using errcode = 'P0001'; end if;
  v_due := o.grand_total;
  v_rate := (app.setting('loyalty.rupees_per_point'))::text::numeric;
  if p_gift_card then v_g := least(v_due, app.wallet_available(v_uid, 'gift_card')); end if;
  if p_store_credit then v_s := least(v_due - v_g, app.wallet_available(v_uid, 'store_credit')); end if;
  if coalesce(p_points, 0) > 0 then
    if p_points * v_rate > app.wallet_available(v_uid, 'loyalty') then raise exception 'INSUFFICIENT_BALANCE: loyalty' using errcode = 'P0001'; end if;
    if p_points * v_rate > app.loyalty_cap(o.grand_total) then raise exception 'POINTS_OVER_CAP: at most % points on this order', floor(app.loyalty_cap(o.grand_total) / v_rate) using errcode = 'P0001'; end if;
    v_p := least(v_due - v_g - v_s, p_points * v_rate);
  end if;
  v_total := v_g + v_s + v_p;
  if v_total <= 0 then raise exception 'NOTHING_TO_APPLY' using errcode = 'P0001'; end if;
  perform app.wallet_debit(v_uid, 'gift_card', v_g, 'order_payment', o.id);
  perform app.wallet_debit(v_uid, 'store_credit', v_s, 'order_payment', o.id);
  perform app.wallet_debit(v_uid, 'loyalty', v_p, 'order_payment', o.id);
  insert into payments(order_id, method, gateway, amount, status) values (o.id, 'wallet', 'shopeye_wallet', v_total, 'authorized');
  -- payment amounts are never edited (AF-FR-0077): the old Razorpay payment is cancelled and a new one opened for the rest
  update payments set status = 'cancelled' where id = gp.id;
  if v_due - v_total > 0 then insert into payments(order_id, method, gateway, amount) values (o.id, gp.method, 'razorpay', v_due - v_total); end if;
  if v_due - v_total = 0 then
    update payments set status = 'paid', captured_at = now() where order_id = o.id and gateway = 'shopeye_wallet' and status = 'authorized';
    perform app.confirm_paid_order(o.id);
  end if;
  return jsonb_build_object('gift_card', v_g, 'store_credit', v_s, 'points_value', v_p, 'balance_used', v_total, 'to_pay', v_due - v_total, 'paid', v_due - v_total = 0);
end $$;

-- Undo before paying (or automatically for abandoned checkouts): the balance goes back to the same lots
create or replace function app.release_order_balance(p_order uuid, p_note text) returns numeric
language plpgsql security definer set search_path = public, app, extensions as $$
declare wp payments; d record; v_back numeric := 0;
begin
  select * into wp from payments where order_id = p_order and gateway = 'shopeye_wallet' and status = 'authorized' for update;
  if wp.id is null then return 0; end if;
  -- only what is still held: an earlier apply-and-remove on the same order has already been given back
  for d in select lot_id, customer_id, fund, sum(case when kind = 'order_payment' then amount else -amount end) as amount
             from wallet_ledger where order_id = p_order and kind in ('order_payment','order_release') group by lot_id, customer_id, fund
           having sum(case when kind = 'order_payment' then amount else -amount end) > 0 loop
    update wallet_lots set remaining = remaining + d.amount where id = d.lot_id;
    insert into wallet_ledger(customer_id, fund, amount, direction, kind, order_id, lot_id, note) values (d.customer_id, d.fund, d.amount, 'credit', 'order_release', p_order, d.lot_id, p_note);
    v_back := v_back + d.amount;
  end loop;
  update payments set status = 'cancelled' where id = wp.id;
  -- the Razorpay payment for the reduced amount is replaced by one for the full amount again
  update payments set status = 'cancelled' where order_id = p_order and gateway = 'razorpay' and status in ('initiated','pending','failed');
  insert into payments(order_id, method, gateway, amount) select p_order, o.payment_method, 'razorpay', o.grand_total from orders o where o.id = p_order;
  return v_back;
end $$;
create or replace function public.remove_balance(p_order uuid) returns numeric
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if not exists (select 1 from orders where id = p_order and customer_id = auth.uid() and status = 'pending_payment') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return app.release_order_balance(p_order, 'Removed before paying');
end $$;
-- Checkouts left unpaid for an hour give the balance back (called by the scheduler)
create or replace function app.release_stale_balances() returns int language plpgsql security definer set search_path = public, app, extensions as $$
declare r record; n int := 0;
begin
  for r in select p.order_id from payments p join orders o on o.id = p.order_id
            where p.gateway = 'shopeye_wallet' and p.status = 'authorized' and o.status = 'pending_payment' and p.created_at < now() - interval '60 minutes' loop
    perform app.release_order_balance(r.order_id, 'Checkout not completed'); n := n + 1;
  end loop;
  return n;
end $$;

-- When Razorpay confirms the rest, the balance part is final too
create or replace function app.on_order_paid_wallet() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
    update payments set status = 'paid', captured_at = now() where order_id = new.id and gateway = 'shopeye_wallet' and status = 'authorized';
  end if;
  return new;
end $$;
create trigger orders_paid_wallet before update of payment_status on public.orders for each row execute function app.on_order_paid_wallet();

-- Webhook processing, unchanged except that captures on a replaced (cancelled) payment are flagged
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
    if v_pay.status = 'cancelled' then
      -- an older Razorpay order replaced when ShopEye balance was applied or removed: never confirms the order, goes to Finance for refund
      update payments set flagged_reason = 'CAPTURED_ON_REPLACED_PAYMENT: refund review' where id = v_pay.id;
      v_result := 'exception';
    elsif v_pay.status in ('paid','partially_refunded','refunded') then
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

-- Only the Razorpay payment is ever sent to Razorpay
create or replace function app.attach_gateway_order(p_order uuid, p_gateway_order_id text)
returns uuid language plpgsql security definer set search_path = public, app, extensions as $$
declare v_id uuid;
begin
  update payments set gateway_order_id = p_gateway_order_id, status = 'pending'
   where order_id = p_order and gateway = 'razorpay' and status = 'initiated' and gateway_order_id is null and amount > 0
  returning id into v_id;
  if v_id is null then raise exception 'NO_PAYMENT_TO_ATTACH'; end if;
  return v_id;
end $$;

-- ---------- Refunds across tenders: card/UPI first, then ShopEye balance (CUST-FR-080/127) ----------
create or replace function app.request_refund(
  p_order uuid, p_amount app.money, p_type text, p_source_type text, p_source_id text,
  p_reason text, p_idem_key text, p_details text default null)
returns uuid language plpgsql security definer set search_path = public, app, extensions as $$
declare v_pay record; v_first uuid; v_id uuid; v_left numeric := p_amount; v_part numeric; v_rule_exists boolean; n int := 0; v_key text;
begin
  select id into v_first from refunds where idempotency_key = p_idem_key;
  if v_first is not null then return v_first; end if;                      -- replay-safe
  if p_amount > (select coalesce(sum(app.refundable_balance(id)), 0) from payments where order_id = p_order and status in ('paid','partially_refunded')) then
    raise exception 'REFUND_EXCEEDS_BALANCE: requested %', p_amount using errcode = 'P0001';
  end if;
  for v_pay in select * from payments where order_id = p_order and status in ('paid','partially_refunded')
                order by (gateway = 'shopeye_wallet'), captured_at for update loop
    exit when v_left <= 0;
    v_part := least(v_left, app.refundable_balance(v_pay.id));
    continue when v_part <= 0;
    n := n + 1; v_key := case when n = 1 then p_idem_key else p_idem_key || ':' || n end;
    select exists (select 1 from approval_rules where action_type = 'refund' and active
                    and v_part >= amount_from and (amount_to is null or v_part <= amount_to)
                    and checker_role is not null and checker_role <> 'none') into v_rule_exists;
    insert into refunds(order_id, payment_id, refund_type, source_type, source_id, requested_amount,
                        reason_code, reason_details, approval_status, initiated_by, idempotency_key)
    values (p_order, v_pay.id, p_type, p_source_type, p_source_id, v_part, p_reason, p_details,
            case when v_rule_exists then 'pending' else 'not_required' end, app.actor_id(), v_key)
    returning id into v_id;
    if v_rule_exists then
      update refunds set approval_request_id = app.submit_for_approval('refund', 'refund', v_id::text, v_part, md5(v_id::text || v_part::text)) where id = v_id;
    else
      update refunds set approved_amount = v_part, approved_at = now() where id = v_id;
    end if;
    v_first := coalesce(v_first, v_id); v_left := v_left - v_part;
  end loop;
  if v_first is null then raise exception 'NO_REFUNDABLE_PAYMENT'; end if;
  return v_first;
end $$;

-- Balance refunds are internal, so they complete at once and go back to the funds that paid: gift card, then store credit, then points
create or replace function app.process_balance_refund(p_refund uuid) returns void language plpgsql security definer set search_path = public, app, finance, extensions as $$
declare r refunds; o orders; v_left numeric; f text; v_used numeric; v_back numeric; v_part numeric; v_exp timestamptz; v_i int := 0;
begin
  select * into r from refunds where id = p_refund for update;
  if r.processor_status <> 'not_sent' or r.approval_status not in ('not_required','approved') then return; end if;
  select * into o from orders where id = r.order_id;
  perform finance.record_refund_result(r.id, 'success', 'balance:' || r.id);
  v_left := coalesce(r.approved_amount, r.requested_amount);
  foreach f in array array['gift_card','store_credit','loyalty'] loop
    exit when v_left <= 0;
    select coalesce(sum(case when kind = 'order_payment' then amount when kind in ('order_release','refund_restore') then -amount else 0 end), 0) into v_used
      from wallet_ledger where order_id = o.id and fund = f;
    v_part := least(v_left, v_used);
    continue when v_part <= 0;
    select greatest(max(l.expires_at), now() + interval '30 days') into v_exp from wallet_ledger d join wallet_lots l on l.id = d.lot_id
     where d.order_id = o.id and d.fund = f and d.kind = 'order_payment';
    v_i := v_i + 1;
    perform app.wallet_credit(o.customer_id, f, v_part, v_exp, now(), 'refund_restore', 'Refund ' || r.refund_number, 'restore:' || r.id || ':' || f, o.id);
    v_left := v_left - v_part;
  end loop;
end $$;
create or replace function app.on_refund_balance() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if (select gateway from payments where id = new.payment_id) = 'shopeye_wallet' and new.processor_status = 'not_sent'
     and new.approval_status in ('not_required','approved') and new.approved_amount is not null then
    perform app.process_balance_refund(new.id);
  end if;
  return new;
end $$;
create trigger refunds_balance after insert or update of approval_status, approved_amount on public.refunds for each row execute function app.on_refund_balance();

-- Customer takes a card/UPI refund as ShopEye store credit instead (instant, with the store-credit expiry) (CUST-FR-078/080)
create or replace function public.refund_to_store_credit(p_refund uuid) returns jsonb
language plpgsql security definer set search_path = public, app, finance, extensions as $$
declare r refunds; o orders; v_amt numeric; v_exp timestamptz;
begin
  select * into r from refunds where id = p_refund for update;
  select * into o from orders where id = r.order_id;
  if r.id is null or o.customer_id is distinct from auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if (select gateway from payments where id = r.payment_id) <> 'razorpay' then raise exception 'ALREADY_BALANCE' using errcode = 'P0001'; end if;
  if r.processor_status <> 'not_sent' or r.approval_status not in ('not_required','approved') then raise exception 'REFUND_ALREADY_SENT' using errcode = 'P0001'; end if;
  update refunds set destination = 'store_credit' where id = r.id;
  perform finance.record_refund_result(r.id, 'success', 'store-credit:' || r.id);
  v_amt := coalesce(r.approved_amount, r.requested_amount);
  v_exp := now() + make_interval(days => (app.setting('wallet.store_credit_expiry_days'))::text::int);
  perform app.wallet_credit(o.customer_id, 'store_credit', v_amt, v_exp, now(), 'refund_credit', 'Refund ' || r.refund_number, 'credit:' || r.id, o.id);
  return jsonb_build_object('amount', v_amt, 'expires_at', v_exp);
end $$;

-- ---------- Expiry (scheduler): unused balance past its date leaves the account and the ledger ----------
create or replace function app.expire_wallet_lots() returns int language plpgsql security definer set search_path = public, app, finance, extensions as $$
declare l record; n int := 0;
begin
  for l in select * from wallet_lots where remaining > 0 and expires_at <= now() for update skip locked loop
    update wallet_lots set remaining = 0 where id = l.id;
    insert into wallet_ledger(customer_id, fund, amount, direction, kind, lot_id, note) values (l.customer_id, l.fund, l.remaining, 'debit', 'expiry', l.id, 'Expired');
    perform finance.post_journal('wallet', l.id::text, 'wallet-expiry:' || l.id, 'Expired ' || l.fund,
      jsonb_build_array(jsonb_build_object('account', '2600', 'debit', l.remaining, 'party_type', 'customer', 'party_id', l.customer_id), jsonb_build_object('account', '4300', 'credit', l.remaining)));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function finance.post_order_confirmation(p_order uuid)
returns uuid language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare o public.orders; v_lines jsonb := '[]'::jsonb; s record; v_j uuid; v_recv text; v_bal numeric;
begin
  select * into o from public.orders where id = p_order;
  v_recv := case when o.payment_method = 'cod' then '1300' else '1100' end;

  -- the part paid from ShopEye balance reduces the customer-balance liability instead of the gateway receivable
  select coalesce(sum(amount), 0) into v_bal from public.payments where order_id = o.id and gateway = 'shopeye_wallet' and status in ('authorized','paid');
  if o.grand_total - v_bal > 0 then
    v_lines := v_lines || jsonb_build_object('account', v_recv, 'debit', o.grand_total - v_bal, 'party_type', 'customer', 'party_id', o.customer_id, 'memo', 'Order ' || o.order_number);
  end if;
  if v_bal > 0 then
    v_lines := v_lines || jsonb_build_object('account', '2600', 'debit', v_bal, 'party_type', 'customer', 'party_id', o.customer_id, 'memo', 'Paid from ShopEye balance ' || o.order_number);
  end if;
  v_lines := v_lines || jsonb_build_object('account', '4200', 'credit', o.shipping_total, 'memo', 'Shipping collected');

  for s in
    select so.id, so.vendor_id,
           sum(oi.line_total + oi.platform_funded_discount) as vendor_gross,
           sum(oi.platform_funded_discount) as platform_disc,
           sum(oi.commission_amount) as comm, sum(oi.commission_tax) as ctax
      from public.sub_orders so join public.order_items oi on oi.sub_order_id = so.id
     where so.order_id = o.id group by so.id, so.vendor_id
  loop
    v_lines := v_lines
      || jsonb_build_object('account','5200','debit', s.platform_disc, 'memo','Platform-funded discount')
      || jsonb_build_object('account','2100','credit', s.vendor_gross, 'party_type','vendor','party_id', s.vendor_id, 'memo','Vendor sale')
      || jsonb_build_object('account','2100','debit', s.comm + s.ctax, 'party_type','vendor','party_id', s.vendor_id, 'memo','Commission + GST')
      || jsonb_build_object('account','4100','credit', s.comm, 'memo','Commission')
      || jsonb_build_object('account','2300','credit', s.ctax, 'memo','GST on commission');
  end loop;

  v_j := finance.post_journal('order', o.id::text, 'order-confirm:' || o.id, 'Order confirmed ' || o.order_number, v_lines);

  for s in
    select so.id, so.vendor_id, sum(oi.line_total + oi.platform_funded_discount) as vendor_gross,
           sum(oi.commission_amount) as comm, sum(oi.commission_tax) as ctax
      from public.sub_orders so join public.order_items oi on oi.sub_order_id = so.id
     where so.order_id = o.id group by so.id, so.vendor_id
  loop
    insert into finance.vendor_ledger(vendor_id, entry_type, sub_order_id, gross, credit, description, journal_id, source_key)
    values (s.vendor_id, 'sale', s.id, s.vendor_gross, s.vendor_gross, 'Sale ' || o.order_number, v_j, 'vl-sale:' || s.id)
    on conflict (source_key) do nothing;
    if s.comm > 0 then
      insert into finance.vendor_ledger(vendor_id, entry_type, sub_order_id, gross, debit, description, journal_id, source_key)
      values (s.vendor_id, 'commission', s.id, s.vendor_gross, s.comm, 'Commission ' || o.order_number, v_j, 'vl-comm:' || s.id),
             (s.vendor_id, 'commission_tax', s.id, s.comm, s.ctax, 'GST on commission ' || o.order_number, v_j, 'vl-ctax:' || s.id)
      on conflict (source_key) do nothing;
    end if;
  end loop;

  if o.payment_method <> 'cod' then
    insert into finance.customer_ledger(customer_id, order_id, entry_type, source_type, source_id, credit, description, source_key)
    values (o.customer_id, o.id, 'payment', 'order', o.id::text, o.grand_total, 'Payment for ' || o.order_number, 'cl-pay:' || o.id)
    on conflict (source_key) do nothing;
  end if;
  return v_j;
end $$;

create or replace function finance.post_refund_success(p_refund uuid)
returns uuid language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare r public.refunds; o public.orders; it public.order_items; so public.sub_orders; v_cr text;
        v_amt numeric; v_p numeric; v_pd numeric; v_comm numeric; v_ctax numeric; v_lines jsonb; v_j uuid;
begin
  select * into r from public.refunds where id = p_refund;
  if r.processor_status <> 'success' then raise exception 'REFUND_NOT_SUCCESSFUL'; end if;
  select * into o from public.orders where id = r.order_id;
  v_amt := coalesce(r.approved_amount, r.requested_amount);
  -- where the money goes: back to ShopEye balance (paid from balance, or customer chose store credit), COD bank, or the gateway
  v_cr := case when r.destination = 'store_credit' or (select gateway from public.payments where id = r.payment_id) = 'shopeye_wallet' then '2600'
               when o.payment_method = 'cod' then '1200' else '1100' end;

  if r.source_type = 'cancellation' then
    select oi.* into it from public.order_items oi join public.cancellations c on c.order_item_id = oi.id where c.id = r.source_id::uuid;
  elsif r.source_type = 'return' then
    select oi.* into it from public.order_items oi join public.returns rt on rt.order_item_id = oi.id where rt.id = r.source_id::uuid;
  end if;

  if it.id is not null then
    select * into so from public.sub_orders where id = it.sub_order_id;
    v_p    := v_amt / it.line_total;
    v_pd   := round(it.platform_funded_discount * v_p, 2);
    v_comm := round(it.commission_amount * v_p, 2);
    v_ctax := round(it.commission_tax * v_p, 2);
    v_lines := jsonb_build_array(
      jsonb_build_object('account','2100','debit', v_amt + v_pd, 'party_type','vendor','party_id', so.vendor_id, 'memo','Refund recovered from vendor'),
      jsonb_build_object('account','5200','credit', v_pd, 'memo','Platform discount reversed'),
      jsonb_build_object('account', v_cr, 'credit', v_amt, 'memo','Refund paid ' || r.refund_number),
      jsonb_build_object('account','4100','debit', v_comm, 'memo','Commission reversed'),
      jsonb_build_object('account','2300','debit', v_ctax, 'memo','GST on commission reversed'),
      jsonb_build_object('account','2100','credit', v_comm + v_ctax, 'party_type','vendor','party_id', so.vendor_id, 'memo','Commission credited back'));
    v_j := finance.post_journal('refund', r.id::text, 'refund:' || r.id, 'Refund ' || r.refund_number, v_lines);

    insert into finance.vendor_ledger(vendor_id, entry_type, sub_order_id, gross, debit, description, journal_id, source_key)
    values (so.vendor_id, 'refund', so.id, v_amt, v_amt + v_pd, 'Refund ' || r.refund_number, v_j, 'vl-refund:' || r.id)
    on conflict (source_key) do nothing;
    if v_comm + v_ctax > 0 then
      insert into finance.vendor_ledger(vendor_id, entry_type, sub_order_id, gross, credit, description, journal_id, source_key)
      values (so.vendor_id, 'commission_reversal', so.id, v_amt, v_comm + v_ctax, 'Commission reversal ' || r.refund_number, v_j, 'vl-commrev:' || r.id)
      on conflict (source_key) do nothing;
    end if;
    update public.order_items set refunded_amount = refunded_amount + v_amt where id = it.id;
  else
    v_j := finance.post_journal('refund', r.id::text, 'refund:' || r.id, 'Goodwill refund ' || r.refund_number,
             jsonb_build_array(jsonb_build_object('account','5300','debit', v_amt),
                               jsonb_build_object('account',v_cr,'credit', v_amt)));
  end if;

  insert into finance.customer_ledger(customer_id, order_id, entry_type, source_type, source_id, debit, description, source_key)
  values (o.customer_id, o.id, 'refund', 'refund', r.id::text, v_amt, 'Refund ' || r.refund_number, 'cl-refund:' || r.id)
  on conflict (source_key) do nothing;
  return v_j;
end $$;

create or replace function public.loyalty_rules() returns jsonb language sql stable security definer set search_path = public, app, extensions as $$
  select jsonb_build_object('points_per_100', (app.setting('loyalty.points_per_100'))::text::numeric, 'rupees_per_point', (app.setting('loyalty.rupees_per_point'))::text::numeric,
                            'max_redeem_pct', (app.setting('loyalty.max_redeem_pct'))::text::numeric)
$$;
grant execute on function public.loyalty_rules() to anon, authenticated;

revoke execute on function public.my_wallet(), public.redeem_gift_card(text), public.admin_issue_gift_cards(int, numeric, int, text), public.apply_balance(uuid, boolean, boolean, int),
  public.remove_balance(uuid), public.refund_to_store_credit(uuid) from public, anon;
grant execute on function public.my_wallet(), public.redeem_gift_card(text), public.admin_issue_gift_cards(int, numeric, int, text), public.apply_balance(uuid, boolean, boolean, int),
  public.remove_balance(uuid), public.refund_to_store_credit(uuid) to authenticated;
revoke all on app.gift_card_attempts from anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.is_vendor_member(uuid), app.has_permission(text, uuid, uuid), app.actor_id() to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.wallet_lots, public.wallet_ledger, public.gift_cards from anon, authenticated;
