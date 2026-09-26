-- =====================================================================
-- SHOPEYE 0001 — Platform foundation
-- Cross-cutting controls shared by every portal.
-- Traces: AF-FR-0590..0607 (audit), AF-FR-0684/0692 (idempotency),
--         AF-FR-0638..0653 (number series), AF-FR-0512..0535 (periods),
--         AF-FR-0554..0569 (maker-checker), VS-FR-886..897 (status models),
--         AF-FR-0683 (fixed-precision money), AF-FR-0711 (no silent deletes)
-- =====================================================================
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions;

create schema if not exists app;      -- internal helpers, never exposed via API
create schema if not exists finance;  -- accounting; server-side access only

-- Money is fixed-precision decimal, never float (AF-FR-0683, CUST validation matrix "Money")
create domain app.money as numeric(18,2);

-- ---------------------------------------------------------------------
-- Request context helpers (actor, reason, correlation id)
-- ---------------------------------------------------------------------
create or replace function app.actor_id() returns uuid
language sql stable as $$
  select coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid)
$$;

create or replace function app.ctx(p_key text) returns text
language sql stable as $$ select nullif(current_setting('app.' || p_key, true), '') $$;

-- ---------------------------------------------------------------------
-- Audit log — append-only (AF-FR-0603..0605, SA/VS/OPS audit sections)
-- ---------------------------------------------------------------------
create table app.audit_log (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  actor_id        uuid,
  actor_role      text,
  portal          text,
  action          text not null,
  entity_type     text not null,
  entity_id       text not null,
  before_value    jsonb,
  after_value     jsonb,
  reason          text,
  ip_address      text,
  session_id      text,
  correlation_id  text
);
create index audit_log_entity_idx on app.audit_log (entity_type, entity_id, occurred_at desc);
create index audit_log_actor_idx  on app.audit_log (actor_id, occurred_at desc);

-- Blocks UPDATE/DELETE on immutable tables (audit, ledgers)
create or replace function app.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'IMMUTABLE_RECORD: % on %.% is not permitted; post a reversal/correction instead',
    tg_op, tg_table_schema, tg_table_name using errcode = 'P0001';
end $$;

create trigger audit_log_immutable before update or delete on app.audit_log
  for each row execute function app.forbid_mutation();

-- Keys whose values must never reach audit payloads (AF-FR-0605, AF-FR-0689)
create or replace function app.mask_json(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null then null else
    j - array['password','password_hash','otp','token','secret','api_key','account_number','card_number','cvv']
  end
$$;

-- Generic row-audit trigger. Reason/correlation come from session settings
-- set by the API layer: set_config('app.reason', ..., true)
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id text;
begin
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', '?');
  insert into app.audit_log(actor_id, actor_role, portal, action, entity_type, entity_id,
                            before_value, after_value, reason, ip_address, session_id, correlation_id)
  values (app.actor_id(), app.ctx('actor_role'), app.ctx('portal'),
          lower(tg_op), tg_table_schema || '.' || tg_table_name, v_id,
          case when tg_op <> 'INSERT' then app.mask_json(to_jsonb(old)) end,
          case when tg_op <> 'DELETE' then app.mask_json(to_jsonb(new)) end,
          app.ctx('reason'), app.ctx('ip'), app.ctx('session_id'), app.ctx('correlation_id'));
  return coalesce(new, old);
end $$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------
-- Idempotency registry (CUST-FR-069, AF-FR-0169/0292/0667/0684)
-- ---------------------------------------------------------------------
create table app.idempotency_keys (
  scope         text not null,
  key           text not null,
  request_hash  text,
  result        jsonb,
  created_at    timestamptz not null default now(),
  primary key (scope, key)
);

-- ---------------------------------------------------------------------
-- Document number series — gapless inside a transaction, never duplicate
-- (AF-FR-0339, AF-FR-0640..0643, AF-FR-0653)
-- ---------------------------------------------------------------------
create table app.number_series (
  code        text primary key,
  prefix      text not null,
  next_value  bigint not null default 1 check (next_value > 0),
  padding     int not null default 6 check (padding between 1 and 12),
  updated_at  timestamptz not null default now()
);

create or replace function app.next_number(p_code text) returns text
language plpgsql as $$
declare v_prefix text; v_val bigint; v_pad int;
begin
  update app.number_series
     set next_value = next_value + 1, updated_at = now()
   where code = p_code
  returning prefix, next_value - 1, padding into v_prefix, v_val, v_pad;
  if not found then raise exception 'NUMBER_SERIES_MISSING: %', p_code; end if;
  return v_prefix || lpad(v_val::text, v_pad, '0');
end $$;

insert into app.number_series(code, prefix, padding) values
  ('order',          'SE-',    8),
  ('sub_order',      'SEP-',   8),
  ('invoice',        'INV-',   8),
  ('credit_note',    'CN-',    8),
  ('return',         'RET-',   8),
  ('refund',         'RFD-',   8),
  ('settlement',     'STL-',   6),
  ('journal',        'JV-',    8),
  ('grn',            'GRN-',   8),
  ('ticket',         'TKT-',   8),
  ('qc_case',        'QC-',    8),
  ('vendor',         'VND-',   6);

-- ---------------------------------------------------------------------
-- Server-enforced status transitions (VS-FR-887, CUST status vocabulary)
-- A trigger rejects any status change not listed here.
-- ---------------------------------------------------------------------
create table app.status_transitions (
  entity      text not null,
  from_status text not null,
  to_status   text not null,
  primary key (entity, from_status, to_status)
);

create or replace function app.enforce_transition() returns trigger
language plpgsql as $$
declare v_entity text := tg_argv[0];
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not exists (select 1 from app.status_transitions
                    where entity = v_entity and from_status = old.status::text and to_status = new.status::text) then
      raise exception 'INVALID_TRANSITION: % cannot move from % to %', v_entity, old.status, new.status
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Accounting periods and close protection (AF-FR-0423, AF-FR-0512..0535)
-- ---------------------------------------------------------------------
create type finance.period_status as enum ('open','pre_close','soft_closed','closed','reopened');

create table finance.accounting_periods (
  id          uuid primary key default gen_random_uuid(),
  entity      text not null default 'SHOPEYE',
  starts_on   date not null,
  ends_on     date not null check (ends_on >= starts_on),
  status      finance.period_status not null default 'open',
  closed_by   uuid,
  closed_at   timestamptz,
  reopen_reason text,
  control_totals jsonb,
  exclude using gist (entity with =, daterange(starts_on, ends_on, '[]') with &&)
);

create or replace function finance.assert_period_open(p_date date, p_entity text default 'SHOPEYE')
returns void language plpgsql as $$
declare v_status finance.period_status;
begin
  select status into v_status from finance.accounting_periods
   where entity = p_entity and p_date between starts_on and ends_on;
  if v_status is null then
    raise exception 'PERIOD_NOT_DEFINED: no accounting period covers %', p_date;
  elsif v_status in ('soft_closed','closed') then
    raise exception 'PERIOD_CLOSED: % is in a % period', p_date, v_status using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Maker-checker approval framework (AF-FR-0554..0569, AF-FR-0171/0291)
-- ---------------------------------------------------------------------
create table app.approval_rules (
  id                    uuid primary key default gen_random_uuid(),
  action_type           text not null,      -- refund / payout / journal / hold / bank_change / write_off / stock_adjustment ...
  amount_from           app.money not null default 0,
  amount_to             app.money,           -- null = unbounded
  checker_role          text not null,
  second_approver_role  text,
  self_approval_allowed boolean not null default false,
  effective_from        date not null default current_date,
  active                boolean not null default true,
  check (amount_to is null or amount_to >= amount_from)
);

create type app.approval_status as enum ('pending','approved','rejected','returned','invalidated');

create table app.approval_requests (
  id              uuid primary key default gen_random_uuid(),
  action_type     text not null,
  entity_type     text not null,
  entity_id       text not null,
  amount          app.money,
  payload_hash    text not null,        -- material fields hash; change => invalidate (AF-FR-0569)
  rule_id         uuid references app.approval_rules(id),
  levels_required int not null default 1 check (levels_required between 1 and 3),
  status          app.approval_status not null default 'pending',
  prepared_by     uuid not null,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);
create unique index approval_one_open_per_entity
  on app.approval_requests(action_type, entity_type, entity_id) where status = 'pending';

create table app.approval_decisions (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references app.approval_requests(id),
  level       int not null,
  decided_by  uuid not null,
  decision    text not null check (decision in ('approve','reject','return')),
  comment     text,
  decided_at  timestamptz not null default now(),
  unique (request_id, level)
);
create trigger approval_decisions_immutable before update or delete on app.approval_decisions
  for each row execute function app.forbid_mutation();

-- Rule resolution at submission time (AF-FR-0565)
create or replace function app.submit_for_approval(
  p_action text, p_entity_type text, p_entity_id text, p_amount app.money, p_payload_hash text)
returns uuid language plpgsql as $$
declare v_rule app.approval_rules; v_id uuid;
begin
  select * into v_rule from app.approval_rules
   where action_type = p_action and active and effective_from <= current_date
     and coalesce(p_amount,0) >= amount_from
     and (amount_to is null or coalesce(p_amount,0) <= amount_to)
   order by amount_from desc limit 1;
  if v_rule.id is null then
    raise exception 'NO_APPROVAL_RULE: action % amount %', p_action, p_amount;
  end if;
  insert into app.approval_requests(action_type, entity_type, entity_id, amount, payload_hash,
                                    rule_id, levels_required, prepared_by)
  values (p_action, p_entity_type, p_entity_id, p_amount, p_payload_hash, v_rule.id,
          case when v_rule.second_approver_role is null then 1 else 2 end, app.actor_id())
  returning id into v_id;
  return v_id;
end $$;

-- Decision with segregation of duties and role check. Role check uses
-- app.has_role() defined in 0002; declared here late-bound via dynamic call.
create or replace function app.decide_approval(
  p_request_id uuid, p_decision text, p_comment text default null, p_current_payload_hash text default null)
returns app.approval_status language plpgsql as $$
declare r app.approval_requests; v_rule app.approval_rules; v_level int; v_role text; v_actor uuid := app.actor_id();
begin
  select * into r from app.approval_requests where id = p_request_id for update;
  if r.id is null then raise exception 'APPROVAL_NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'APPROVAL_NOT_PENDING: %', r.status; end if;
  select * into v_rule from app.approval_rules where id = r.rule_id;

  -- material change after submission invalidates approval (AF-FR-0569)
  if p_current_payload_hash is not null and p_current_payload_hash <> r.payload_hash then
    update app.approval_requests set status = 'invalidated', decided_at = now() where id = r.id;
    return 'invalidated';
  end if;

  if v_actor = r.prepared_by and not v_rule.self_approval_allowed then
    raise exception 'SELF_APPROVAL_FORBIDDEN: maker cannot approve own item' using errcode = 'P0001';
  end if;
  if exists (select 1 from app.approval_decisions where request_id = r.id and decided_by = v_actor) then
    raise exception 'DUPLICATE_APPROVER: same user cannot approve two levels';
  end if;

  select coalesce(max(level),0) + 1 into v_level from app.approval_decisions where request_id = r.id;
  v_role := case when v_level = 1 then v_rule.checker_role else v_rule.second_approver_role end;
  if not app.has_role(v_actor, v_role) then
    raise exception 'NOT_AUTHORISED_APPROVER: requires role %', v_role using errcode = '42501';
  end if;

  insert into app.approval_decisions(request_id, level, decided_by, decision, comment)
  values (r.id, v_level, v_actor, p_decision, p_comment);

  if p_decision = 'reject' then
    update app.approval_requests set status = 'rejected', decided_at = now() where id = r.id; return 'rejected';
  elsif p_decision = 'return' then
    update app.approval_requests set status = 'returned', decided_at = now() where id = r.id; return 'returned';
  elsif v_level >= r.levels_required then
    update app.approval_requests set status = 'approved', decided_at = now() where id = r.id; return 'approved';
  end if;
  return 'pending';
end $$;

-- ---------------------------------------------------------------------
-- Platform settings (versioned, effective-dated: AF-FR-0650, AF-FR-0712)
-- ---------------------------------------------------------------------
create table app.settings (
  key            text not null,
  value          jsonb not null,
  effective_from timestamptz not null default now(),
  changed_by     uuid,
  primary key (key, effective_from)
);
create or replace function app.setting(p_key text) returns jsonb
language sql stable as $$
  select value from app.settings where key = p_key and effective_from <= now()
  order by effective_from desc limit 1
$$;

insert into app.settings(key, value, effective_from) values
  ('shipping.flat_fee_per_vendor', '49', '2000-01-01'),
  ('shipping.free_threshold_per_vendor', '499', '2000-01-01'),
  ('checkout.reservation_minutes', '15', '2000-01-01'),
  ('returns.default_window_days', '7', '2000-01-01'),
  ('settlement.reserve_pct', '0', '2000-01-01'),
  ('currency.default', '"INR"', '2000-01-01');
