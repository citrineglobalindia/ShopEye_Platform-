-- =====================================================================
set search_path = public, extensions;
-- SHOPEYE 0004 — Inventory: warehouses, bins, buckets, ledger, reservations
-- Traces: SM-FR §5 §10 §11 (0143..0158 buckets) §12 (0159..0180 ledger)
--         §18 (reservations) §35 (concurrency), VS-FR §9, CUST-FR-043/061
-- Rule: balances change ONLY through app.post_stock_movement(), which
-- locks the balance row and writes the append-only ledger in one tx.
-- =====================================================================
create table public.warehouses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  owner_type  text not null check (owner_type in ('platform','vendor')),
  vendor_id   uuid references public.vendors(id),
  pincode     text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  address     jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  check ((owner_type = 'vendor') = (vendor_id is not null))
);
alter table public.user_roles add constraint user_roles_wh_fk foreign key (warehouse_id) references public.warehouses(id);

create table public.bins (
  id            uuid primary key default gen_random_uuid(),
  warehouse_id  uuid not null references public.warehouses(id),
  zone          text not null,
  aisle         text,
  rack          text,
  bin_code      text not null,
  bin_type      text not null default 'storage' check (bin_type in ('storage','receiving','staging','packing','quarantine','damaged','returns')),
  capacity_units int check (capacity_units > 0),
  active        boolean not null default true,
  unique (warehouse_id, bin_code)
);

-- One row per variant per warehouse. Buckets are mutually exclusive
-- portions of physical on-hand stock; available is derived.
create table public.stock_balances (
  variant_id       uuid not null references public.product_variants(id),
  warehouse_id     uuid not null references public.warehouses(id),
  on_hand          int not null default 0 check (on_hand >= 0),
  reserved         int not null default 0 check (reserved >= 0),
  hold             int not null default 0 check (hold >= 0),
  damaged          int not null default 0 check (damaged >= 0),
  quarantine       int not null default 0 check (quarantine >= 0),
  expired          int not null default 0 check (expired >= 0),
  pending_putaway  int not null default 0 check (pending_putaway >= 0),
  in_transit       int not null default 0 check (in_transit >= 0),   -- not part of on_hand
  safety_stock     int not null default 0 check (safety_stock >= 0),
  available        int generated always as
                     (on_hand - reserved - hold - damaged - quarantine - expired - pending_putaway) stored,
  version          bigint not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (variant_id, warehouse_id),
  constraint stock_no_oversell check (on_hand - reserved - hold - damaged - quarantine - expired - pending_putaway >= 0)
);

create type public.stock_txn_type as enum (
  'opening_balance','grn_receipt','putaway','adjustment','reservation','reservation_release',
  'pick','dispatch','transfer_out','transfer_in','return_receipt','rto_receipt',
  'to_damaged','to_quarantine','quarantine_release','to_expired','hold','hold_release','cycle_count');

create table public.stock_ledger (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  txn_type        public.stock_txn_type not null,
  reference_type  text not null,
  reference_id    text not null,
  variant_id      uuid not null,
  warehouse_id    uuid not null,
  bin_id          uuid references public.bins(id),
  batch_no        text,
  serial_no       text,
  bucket          text not null,
  qty_delta       int not null check (qty_delta <> 0),
  bucket_after    int not null,
  on_hand_after   int not null,
  actor_id        uuid,
  is_system       boolean not null default false,              -- SM-FR-0180
  reason          text,
  idempotency_key text not null
);
create index stock_ledger_variant_idx on public.stock_ledger(variant_id, warehouse_id, occurred_at desc);
create index stock_ledger_ref_idx on public.stock_ledger(reference_type, reference_id);
create index stock_ledger_idem_idx on public.stock_ledger(idempotency_key);
create trigger stock_ledger_immutable before update or delete on public.stock_ledger
  for each row execute function app.forbid_mutation();                                  -- SM-FR-0173

-- Direct writes to balances are blocked; only the posting function may change them
create or replace function app.guard_stock_balance() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.stock_posting', true), '') <> 'on' then
    raise exception 'DIRECT_STOCK_WRITE_FORBIDDEN: use app.post_stock_movement()' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger stock_balances_guard before insert or update or delete on public.stock_balances
  for each row execute function app.guard_stock_balance();

-- Post a stock movement.
-- p_deltas: {"on_hand": 5, "pending_putaway": 5} etc. Returns false if the
-- idempotency key was already posted (safe replay, SM §35 / AF-FR-0692).
create or replace function app.post_stock_movement(
  p_variant uuid, p_warehouse uuid, p_txn public.stock_txn_type, p_deltas jsonb,
  p_ref_type text, p_ref_id text, p_idem_key text,
  p_reason text default null, p_bin uuid default null, p_batch text default null,
  p_serial text default null, p_system boolean default false)
returns boolean language plpgsql security definer set search_path = public, app, extensions as $$
declare b public.stock_balances; k text; d int;
begin
  -- serialise concurrent postings for the same key (xact lock), then check replay
  perform pg_advisory_xact_lock(hashtext('stock:' || p_idem_key));
  if exists (select 1 from public.stock_ledger where idempotency_key = p_idem_key) then
    return false;
  end if;

  perform set_config('app.stock_posting', 'on', true);
  insert into public.stock_balances(variant_id, warehouse_id) values (p_variant, p_warehouse)
    on conflict do nothing;
  select * into b from public.stock_balances
   where variant_id = p_variant and warehouse_id = p_warehouse for update;

  for k, d in select key, value::int from jsonb_each_text(p_deltas) loop
    if k not in ('on_hand','reserved','hold','damaged','quarantine','expired','pending_putaway','in_transit') then
      raise exception 'UNKNOWN_BUCKET: %', k;
    end if;
    if d = 0 then continue; end if;
    execute format('update public.stock_balances set %I = %I + $1, version = version + 1, updated_at = now()
                     where variant_id = $2 and warehouse_id = $3', k, k)
      using d, p_variant, p_warehouse;
  end loop;

  -- constraint violations (e.g. stock_no_oversell) have already raised here
  select * into b from public.stock_balances where variant_id = p_variant and warehouse_id = p_warehouse;

  insert into public.stock_ledger(txn_type, reference_type, reference_id, variant_id, warehouse_id, bin_id,
                                  batch_no, serial_no, bucket, qty_delta, bucket_after, on_hand_after,
                                  actor_id, is_system, reason, idempotency_key)
  select p_txn, p_ref_type, p_ref_id, p_variant, p_warehouse, p_bin, p_batch, p_serial,
         e.key, e.value::int, (to_jsonb(b)->>e.key)::int, b.on_hand,
         app.actor_id(), p_system, p_reason, p_idem_key
    from jsonb_each_text(p_deltas) e where e.value::int <> 0;

  perform set_config('app.stock_posting', 'off', true);
  return true;
end $$;

-- ---------------------------------------------------------------------
-- Reservations: checkout holds stock; payment consumes; expiry releases
-- ---------------------------------------------------------------------
create type public.reservation_status as enum ('active','consumed','released','expired');

create table public.stock_reservations (
  id             uuid primary key default gen_random_uuid(),
  order_item_id  uuid,                        -- FK added in 0005
  variant_id     uuid not null references public.product_variants(id),
  warehouse_id   uuid not null references public.warehouses(id),
  qty            int not null check (qty > 0),
  status         public.reservation_status not null default 'active',
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  closed_at      timestamptz
);
create index reservations_active_idx on public.stock_reservations(expires_at) where status = 'active';

-- Reserve from the warehouse with the most available stock for the variant.
-- Row locks + the no-oversell check make concurrent checkouts safe.
create or replace function app.reserve_stock(p_variant uuid, p_qty int, p_ref text, p_minutes int default 15)
returns uuid language plpgsql security definer set search_path = public, app, extensions as $$
declare v_wh uuid; v_id uuid;
begin
  select warehouse_id into v_wh from public.stock_balances
   where variant_id = p_variant and available >= p_qty
   order by available desc limit 1
   for update skip locked;
  if v_wh is null then
    -- re-check without skip locked to distinguish contention from true shortage
    select warehouse_id into v_wh from public.stock_balances
     where variant_id = p_variant and available >= p_qty
     order by available desc limit 1 for update;
  end if;
  if v_wh is null then
    raise exception 'INSUFFICIENT_STOCK: variant % qty %', p_variant, p_qty using errcode = 'P0001';
  end if;
  insert into public.stock_reservations(variant_id, warehouse_id, qty, expires_at)
  values (p_variant, v_wh, p_qty, now() + make_interval(mins => p_minutes)) returning id into v_id;
  perform app.post_stock_movement(p_variant, v_wh, 'reservation', jsonb_build_object('reserved', p_qty),
                                  'reservation', v_id::text, 'rsv:' || v_id, p_ref, null, null, null, true);
  return v_id;
end $$;

create or replace function app.release_reservation(p_reservation uuid, p_status public.reservation_status default 'released')
returns void language plpgsql security definer set search_path = public, app, extensions as $$
declare r public.stock_reservations;
begin
  select * into r from public.stock_reservations where id = p_reservation for update;
  if r.status <> 'active' then return; end if;
  update public.stock_reservations set status = p_status, closed_at = now() where id = r.id;
  perform app.post_stock_movement(r.variant_id, r.warehouse_id, 'reservation_release',
          jsonb_build_object('reserved', -r.qty), 'reservation', r.id::text, 'rsv-rel:' || r.id,
          p_status::text, null, null, null, true);
end $$;

-- Scheduled job (pg_cron in Supabase): release expired checkout holds
create or replace function app.expire_reservations() returns int
language plpgsql security definer set search_path = public, app, extensions as $$
declare r record; n int := 0;
begin
  for r in select id from public.stock_reservations where status = 'active' and expires_at < now()
           for update skip locked loop
    perform app.release_reservation(r.id, 'expired'); n := n + 1;
  end loop;
  return n;
end $$;
