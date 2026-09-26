-- =====================================================================
set search_path = public, extensions;
-- SHOPEYE 0006 — Finance: GL, journals, vendor/customer ledgers,
--                commission rules, settlements & payouts
-- Traces: AF-FR-0203..0303, AF-FR-0409..0427, AF-FR-0683..0722
-- Principles: append-only, idempotent by source key, balanced, period-
-- protected, maker-checker on payouts and manual journals.
-- =====================================================================
create table finance.gl_accounts (
  code  text primary key,
  name  text not null,
  type  text not null check (type in ('asset','liability','equity','income','expense'))
);
insert into finance.gl_accounts values
  ('1100','Gateway Receivable','asset'), ('1200','Bank - Operating','asset'), ('1300','COD Receivable','asset'),
  ('2100','Vendor Payable','liability'), ('2300','GST Output on Services','liability'), ('2400','TCS Payable','liability'),
  ('2500','TDS Payable','liability'),
  ('4100','Commission Income','income'), ('4200','Shipping Income','income'),
  ('5100','Gateway Fees','expense'), ('5200','Platform-funded Discounts','expense'), ('5300','Customer Goodwill / Adjustments','expense');

create type finance.journal_status as enum ('draft','pending_approval','posted','reversed','rejected');

create table finance.journal_entries (
  id              uuid primary key default gen_random_uuid(),
  journal_number  text not null unique default app.next_number('journal'),
  entry_date      date not null default current_date,
  journal_type    text not null default 'auto' check (journal_type in ('auto','manual_correction','accrual','reclass','write_off','reversal')),
  source_type     text not null,
  source_id       text not null,
  source_key      text not null unique,                    -- AF-FR-0684 idempotency / no duplicate posting
  description     text not null,
  status          finance.journal_status not null default 'draft',
  reversal_of     uuid references finance.journal_entries(id),
  approval_request_id uuid references app.approval_requests(id),
  prepared_by     uuid,
  posted_at       timestamptz,
  created_at      timestamptz not null default now()
);

create table finance.journal_lines (
  id            bigint generated always as identity primary key,
  journal_id    uuid not null references finance.journal_entries(id),
  account_code  text not null references finance.gl_accounts(code),
  party_type    text check (party_type in ('vendor','customer','carrier','gateway')),
  party_id      uuid,
  debit         app.money not null default 0 check (debit >= 0),
  credit        app.money not null default 0 check (credit >= 0),
  memo          text,
  check ((debit > 0) <> (credit > 0))                      -- exactly one side per line (AF-FR-0416/0417)
);
create index journal_lines_journal_idx on finance.journal_lines(journal_id);
create index journal_lines_party_idx on finance.journal_lines(party_type, party_id);

-- Lines of a posted/reversed journal are frozen
create or replace function finance.guard_journal_lines() returns trigger language plpgsql as $$
declare v_status finance.journal_status;
begin
  select status into v_status from finance.journal_entries where id = coalesce(new.journal_id, old.journal_id);
  if v_status in ('posted','reversed') then
    raise exception 'IMMUTABLE_RECORD: journal is %; post a reversing journal', v_status using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger journal_lines_guard before insert or update or delete on finance.journal_lines
  for each row execute function finance.guard_journal_lines();

-- Posting rules: balanced, non-empty, open period; posted entries only move to reversed
create or replace function finance.guard_journal_entry() returns trigger language plpgsql as $$
declare v_dr numeric; v_cr numeric; v_n int;
begin
  if tg_op = 'DELETE' then
    if old.status in ('posted','reversed') then raise exception 'IMMUTABLE_RECORD: posted journal cannot be deleted'; end if;
    return old;
  end if;
  if old.status in ('posted','reversed') then
    if not (old.status = 'posted' and new.status = 'reversed'
            and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status')) then
      raise exception 'IMMUTABLE_RECORD: posted journal cannot be edited' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.status = 'posted' then
    select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) into v_dr, v_cr, v_n
      from finance.journal_lines where journal_id = new.id;
    if v_n < 2 or v_dr <> v_cr or v_dr = 0 then
      raise exception 'UNBALANCED_JOURNAL: debit % credit % lines %', v_dr, v_cr, v_n using errcode = 'P0001';
    end if;
    perform finance.assert_period_open(new.entry_date);
    new.posted_at := now();
  end if;
  return new;
end $$;
create trigger journal_entries_guard before update or delete on finance.journal_entries
  for each row execute function finance.guard_journal_entry();
create trigger journal_entries_audit after insert or update on finance.journal_entries
  for each row execute function app.audit_row();

-- Post a system journal in one call; replay with same source_key is a no-op
create or replace function finance.post_journal(
  p_source_type text, p_source_id text, p_source_key text, p_description text, p_lines jsonb,
  p_date date default current_date, p_type text default 'auto', p_reversal_of uuid default null)
returns uuid language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare v_id uuid; l jsonb;
begin
  select id into v_id from finance.journal_entries where source_key = p_source_key;
  if v_id is not null then return v_id; end if;
  insert into finance.journal_entries(entry_date, journal_type, source_type, source_id, source_key, description, prepared_by, reversal_of)
  values (p_date, p_type, p_source_type, p_source_id, p_source_key, p_description, app.actor_id(), p_reversal_of)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'debit')::numeric,0) = 0 and coalesce((l->>'credit')::numeric,0) = 0 then continue; end if;
    insert into finance.journal_lines(journal_id, account_code, party_type, party_id, debit, credit, memo)
    values (v_id, l->>'account', l->>'party_type', (l->>'party_id')::uuid,
            coalesce((l->>'debit')::numeric,0), coalesce((l->>'credit')::numeric,0), l->>'memo');
  end loop;
  update finance.journal_entries set status = 'posted' where id = v_id;
  return v_id;
end $$;

-- Reversal creates a linked mirror journal (AF-FR-0425, AF-FR-0697)
create or replace function finance.reverse_journal(p_journal uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare j finance.journal_entries; v_id uuid;
begin
  select * into j from finance.journal_entries where id = p_journal for update;
  if j.status <> 'posted' then raise exception 'ONLY_POSTED_CAN_BE_REVERSED'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  v_id := finance.post_journal('journal_reversal', j.id::text, 'rev:' || j.id, 'Reversal of ' || j.journal_number || ': ' || p_reason,
            (select jsonb_agg(jsonb_build_object('account', account_code, 'party_type', party_type, 'party_id', party_id,
                                                 'debit', credit, 'credit', debit, 'memo', memo))
               from finance.journal_lines where journal_id = j.id),
            current_date, 'reversal', j.id);
  update finance.journal_entries set status = 'reversed' where id = j.id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Vendor & customer sub-ledgers (append-only, AF §11 §12)
-- ---------------------------------------------------------------------
create table finance.vendor_ledger (
  id            bigint generated always as identity primary key,
  vendor_id     uuid not null references public.vendors(id),
  posted_at     timestamptz not null default now(),
  entry_type    text not null check (entry_type in ('sale','commission','commission_tax','shipping','refund','commission_reversal',
                                                     'return_fee','adjustment','settlement','hold','release','tds','tcs')),
  sub_order_id  uuid references public.sub_orders(id),
  settlement_line_id uuid,
  gross         app.money not null default 0,
  debit         app.money not null default 0 check (debit >= 0),
  credit        app.money not null default 0 check (credit >= 0),
  description   text not null,
  journal_id    uuid references finance.journal_entries(id),
  source_key    text not null unique,
  check ((debit > 0) <> (credit > 0))
);
create index vendor_ledger_vendor_idx on finance.vendor_ledger(vendor_id, posted_at);
create index vendor_ledger_suborder_idx on finance.vendor_ledger(sub_order_id);
create trigger vendor_ledger_immutable before update or delete on finance.vendor_ledger
  for each row execute function app.forbid_mutation();

create table finance.customer_ledger (
  id           bigint generated always as identity primary key,
  customer_id  uuid,
  order_id     uuid references public.orders(id),
  posted_at    timestamptz not null default now(),
  entry_type   text not null check (entry_type in ('payment','refund','credit','debit','adjustment')),
  source_type  text not null,
  source_id    text not null,
  debit        app.money not null default 0 check (debit >= 0),
  credit       app.money not null default 0 check (credit >= 0),
  description  text not null,
  source_key   text not null unique,
  check ((debit > 0) <> (credit > 0))
);
create trigger customer_ledger_immutable before update or delete on finance.customer_ledger
  for each row execute function app.forbid_mutation();

create view finance.vendor_balances as
select vendor_id, sum(credit) - sum(debit) as balance from finance.vendor_ledger group by vendor_id;

-- ---------------------------------------------------------------------
-- Commission rules — effective-dated, non-overlapping, snapshotted
-- (AF-FR-0240..0258)
-- ---------------------------------------------------------------------
create table finance.commission_rules (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid references public.vendors(id),
  category_id     uuid references public.categories(id),
  effective_from  date not null,
  effective_to    date,
  commission_type text not null check (commission_type in ('percent','flat_per_unit')),
  commission_value numeric(12,4) not null check (commission_value >= 0),
  base            text not null default 'line_total' check (base in ('line_total','taxable_value','mrp')),
  tax_rate        numeric(5,2) not null default 18,
  priority        int not null default 0,
  active          boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  exclude using gist (
    coalesce(vendor_id,   '00000000-0000-0000-0000-000000000000'::uuid) with =,
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    priority with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  ) where (active)
);
create trigger commission_rules_audit after insert or update on finance.commission_rules
  for each row execute function app.audit_row();

-- Most specific rule wins: vendor+category > vendor > category > default
create or replace function finance.resolve_commission(p_vendor uuid, p_category uuid, p_on date default current_date)
returns finance.commission_rules language sql stable as $$
  select * from finance.commission_rules
   where active and p_on between effective_from and coalesce(effective_to, 'infinity'::date)
     and (vendor_id is null or vendor_id = p_vendor)
     and (category_id is null or category_id = p_category)
   order by (vendor_id is not null) desc, (category_id is not null) desc, priority desc
   limit 1
$$;

-- ---------------------------------------------------------------------
-- Accounting events
-- ---------------------------------------------------------------------
-- Capture/confirmation of an order: receivable, vendor earnings, commission
create or replace function finance.post_order_confirmation(p_order uuid)
returns uuid language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare o public.orders; v_lines jsonb := '[]'::jsonb; s record; v_j uuid; v_recv text;
begin
  select * into o from public.orders where id = p_order;
  v_recv := case when o.payment_method = 'cod' then '1300' else '1100' end;

  v_lines := v_lines || jsonb_build_object('account', v_recv, 'debit', o.grand_total, 'party_type', 'customer', 'party_id', o.customer_id, 'memo', 'Order ' || o.order_number);
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

-- Successful refund: reverse the vendor share pro-rata and pay back the customer
create or replace function finance.post_refund_success(p_refund uuid)
returns uuid language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare r public.refunds; o public.orders; it public.order_items; so public.sub_orders;
        v_amt numeric; v_p numeric; v_pd numeric; v_comm numeric; v_ctax numeric; v_lines jsonb; v_j uuid;
begin
  select * into r from public.refunds where id = p_refund;
  if r.processor_status <> 'success' then raise exception 'REFUND_NOT_SUCCESSFUL'; end if;
  select * into o from public.orders where id = r.order_id;
  v_amt := coalesce(r.approved_amount, r.requested_amount);

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
      jsonb_build_object('account', case when o.payment_method='cod' then '1200' else '1100' end, 'credit', v_amt, 'memo','Refund paid ' || r.refund_number),
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
                               jsonb_build_object('account','1100','credit', v_amt)));
  end if;

  insert into finance.customer_ledger(customer_id, order_id, entry_type, source_type, source_id, debit, description, source_key)
  values (o.customer_id, o.id, 'refund', 'refund', r.id::text, v_amt, 'Refund ' || r.refund_number, 'cl-refund:' || r.id)
  on conflict (source_key) do nothing;
  return v_j;
end $$;

-- Processor callback for refunds — idempotent (AF-FR-0169/0181)
create or replace function finance.record_refund_result(p_refund uuid, p_status public.refund_processor_status,
                                                       p_gateway_refund_id text default null, p_failure text default null)
returns public.refund_processor_status language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare r public.refunds; v_paid numeric;
begin
  select * into r from public.refunds where id = p_refund for update;
  if r.processor_status = 'success' then return 'success'; end if;   -- replay after success is a no-op
  if r.approval_status not in ('not_required','approved') then
    raise exception 'REFUND_NOT_APPROVED: %', r.approval_status using errcode = 'P0001';
  end if;
  update public.refunds set processor_status = p_status,
         gateway_refund_id = coalesce(p_gateway_refund_id, gateway_refund_id),
         failure_code = p_failure,
         completed_at = case when p_status = 'success' then now() end
   where id = r.id;
  if p_status = 'success' then
    perform finance.post_refund_success(r.id);
    select coalesce(sum(coalesce(approved_amount, requested_amount)),0) into v_paid
      from public.refunds where payment_id = r.payment_id and processor_status = 'success';
    update public.payments set status = (case when v_paid >= amount then 'refunded' else 'partially_refunded' end)::public.payment_state
     where id = r.payment_id;
    update public.orders set payment_status = (select status from public.payments where id = r.payment_id) where id = r.order_id;
  end if;
  return p_status;
end $$;

-- Checker decision on a refund (AF-FR-0170/0171)
create or replace function finance.decide_refund(p_refund uuid, p_decision text, p_comment text default null)
returns text language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare r public.refunds; v_state app.approval_status;
begin
  perform app.require_permission('refund.approve');
  select * into r from public.refunds where id = p_refund for update;
  if r.approval_status <> 'pending' then raise exception 'REFUND_NOT_PENDING'; end if;
  v_state := app.decide_approval(r.approval_request_id, p_decision, p_comment, md5(r.id::text || r.requested_amount::text));
  update public.refunds set
    approval_status = case v_state when 'approved' then 'approved' when 'rejected' then 'rejected' else approval_status end,
    approved_amount = case when v_state = 'approved' then requested_amount else approved_amount end,
    approved_at     = case when v_state = 'approved' then now() else approved_at end
  where id = r.id;
  return v_state::text;
end $$;

-- ---------------------------------------------------------------------
-- Settlement holds, batches, lines (AF §14 §15 §16)
-- ---------------------------------------------------------------------
create table finance.settlement_holds (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references public.vendors(id),
  amount       app.money,                  -- null = hold everything
  reason_code  text not null,
  reason       text not null check (length(btrim(reason)) >= 5),
  status       text not null default 'active' check (status in ('active','released')),
  placed_by    uuid not null,
  placed_at    timestamptz not null default now(),
  released_by  uuid,
  released_at  timestamptz
);
create trigger settlement_holds_audit after insert or update on finance.settlement_holds
  for each row execute function app.audit_row();

create type finance.batch_status as enum ('draft','pending_approval','approved','rejected','processing','partial','completed','failed');

create table finance.settlement_batches (
  id               uuid primary key default gen_random_uuid(),
  batch_number     text not null unique default app.next_number('settlement'),
  cycle            text not null,
  cutoff_at        timestamptz not null,
  settlement_date  date not null default current_date,
  status           finance.batch_status not null default 'draft',
  vendor_count     int not null default 0,
  gross_eligible   app.money not null default 0,
  total_holds      app.money not null default 0,
  net_payable      app.money not null default 0,
  approval_request_id uuid references app.approval_requests(id),
  prepared_by      uuid,
  created_at       timestamptz not null default now()
);
create trigger settlement_batches_audit after insert or update on finance.settlement_batches
  for each row execute function app.audit_row();

create table finance.settlement_lines (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references finance.settlement_batches(id),
  vendor_id       uuid not null references public.vendors(id),
  eligible_amount app.money not null,
  held_amount     app.money not null default 0,
  net_payable     app.money not null check (net_payable >= 0),
  payout_status   text not null default 'not_started'
                  check (payout_status in ('not_started','processing','paid','failed','on_hold')),
  bank_account_id uuid references public.vendor_bank_accounts(id),
  utr             text,
  failure_reason  text,
  payout_idempotency_key text not null unique,            -- AF-FR-0292
  paid_at         timestamptz,
  unique (batch_id, vendor_id)
);

-- Each sub-order is settled at most once
create table finance.settlement_line_sub_orders (
  settlement_line_id uuid not null references finance.settlement_lines(id),
  sub_order_id       uuid not null unique references public.sub_orders(id),
  amount             app.money not null
);

-- Build a batch from eligible earnings (delivered + return window closed)
create or replace function finance.generate_settlement_batch(p_cycle text, p_cutoff timestamptz default now())
returns uuid language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare v_batch uuid; v record; v_line uuid; v_hold numeric; v_net numeric;
begin
  perform app.require_permission('payout.prepare');
  insert into finance.settlement_batches(cycle, cutoff_at, prepared_by) values (p_cycle, p_cutoff, app.actor_id())
  returning id into v_batch;

  for v in
    select so.vendor_id, array_agg(so.id) as sub_orders,
           sum((select coalesce(sum(credit - debit),0) from finance.vendor_ledger vl where vl.sub_order_id = so.id)) as eligible
      from public.sub_orders so
      join public.vendors ve on ve.id = so.vendor_id and ve.status in ('active','suspended')
     where so.status in ('delivered','completed')
       and so.return_window_ends_at <= p_cutoff
       and not exists (select 1 from finance.settlement_line_sub_orders x where x.sub_order_id = so.id)
       and not exists (select 1 from public.order_items oi join public.returns rt on rt.order_item_id = oi.id
                        where oi.sub_order_id = so.id and rt.status not in ('closed','rejected','cancelled'))
     group by so.vendor_id
  loop
    if v.eligible <= 0 then continue; end if;          -- negative balances carry forward
    select case when bool_or(amount is null) then v.eligible else least(v.eligible, coalesce(sum(amount),0)) end
      into v_hold from finance.settlement_holds where vendor_id = v.vendor_id and status = 'active';
    v_hold := coalesce(v_hold, 0);
    v_net := v.eligible - v_hold;
    insert into finance.settlement_lines(batch_id, vendor_id, eligible_amount, held_amount, net_payable, payout_status,
                                         bank_account_id, payout_idempotency_key)
    values (v_batch, v.vendor_id, v.eligible, v_hold, v_net,
            case when v_net = 0 then 'on_hold' else 'not_started' end,
            (select id from public.vendor_bank_accounts where vendor_id = v.vendor_id and status = 'active'),
            'payout:' || v_batch || ':' || v.vendor_id)
    returning id into v_line;
    insert into finance.settlement_line_sub_orders(settlement_line_id, sub_order_id, amount)
    select v_line, so_id, (select coalesce(sum(credit - debit),0) from finance.vendor_ledger where sub_order_id = so_id)
      from unnest(v.sub_orders) so_id;
  end loop;

  update finance.settlement_batches b set
    vendor_count   = (select count(*) from finance.settlement_lines where batch_id = b.id),
    gross_eligible = (select coalesce(sum(eligible_amount),0) from finance.settlement_lines where batch_id = b.id),
    total_holds    = (select coalesce(sum(held_amount),0) from finance.settlement_lines where batch_id = b.id),
    net_payable    = (select coalesce(sum(net_payable),0) from finance.settlement_lines where batch_id = b.id)
  where id = v_batch;
  return v_batch;
end $$;

create or replace function finance.submit_settlement_batch(p_batch uuid) returns uuid
language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare b finance.settlement_batches; v_req uuid;
begin
  select * into b from finance.settlement_batches where id = p_batch for update;
  if b.status <> 'draft' then raise exception 'BATCH_NOT_DRAFT'; end if;
  v_req := app.submit_for_approval('payout', 'settlement_batch', b.id::text, b.net_payable,
                                   md5(b.id::text || b.net_payable::text || b.vendor_count::text));
  update finance.settlement_batches set status = 'pending_approval', approval_request_id = v_req where id = b.id;
  return v_req;
end $$;

create or replace function finance.decide_settlement_batch(p_batch uuid, p_decision text, p_comment text default null)
returns finance.batch_status language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare b finance.settlement_batches; v_state app.approval_status;
begin
  perform app.require_permission('payout.approve');
  select * into b from finance.settlement_batches where id = p_batch for update;
  v_state := app.decide_approval(b.approval_request_id, p_decision, p_comment,
                                 md5(b.id::text || b.net_payable::text || b.vendor_count::text));
  update finance.settlement_batches set status = case v_state
      when 'approved' then 'approved' when 'rejected' then 'rejected'
      when 'returned' then 'draft' when 'invalidated' then 'draft' else status end
   where id = b.id returning status into b.status;
  return b.status;
end $$;

-- Payout provider result per line — idempotent; only failed lines retry (AF-FR-0293)
create or replace function finance.record_payout_result(p_line uuid, p_status text, p_utr text default null, p_failure text default null)
returns text language plpgsql security definer set search_path = finance, app, public, extensions as $$
declare l finance.settlement_lines; b finance.settlement_batches; v_j uuid;
begin
  perform app.require_permission('payout.execute');
  select * into l from finance.settlement_lines where id = p_line for update;
  if l.payout_status = 'paid' then return 'paid'; end if;                      -- replay-safe: never pay twice
  select * into b from finance.settlement_batches where id = l.batch_id for update;
  if b.status not in ('approved','processing','partial') then raise exception 'BATCH_NOT_APPROVED: %', b.status; end if;
  if p_status = 'paid' then
    if p_utr is null then raise exception 'UTR_REQUIRED'; end if;
    update finance.settlement_lines set payout_status = 'paid', utr = p_utr, paid_at = now(), failure_reason = null where id = l.id;
    v_j := finance.post_journal('settlement', l.id::text, 'payout:' || l.id, 'Payout ' || b.batch_number || ' UTR ' || p_utr,
             jsonb_build_array(
               jsonb_build_object('account','2100','debit', l.net_payable, 'party_type','vendor','party_id', l.vendor_id),
               jsonb_build_object('account','1200','credit', l.net_payable)));
    insert into finance.vendor_ledger(vendor_id, entry_type, settlement_line_id, gross, debit, description, journal_id, source_key)
    values (l.vendor_id, 'settlement', l.id, l.net_payable, l.net_payable, 'Settlement ' || b.batch_number || ' UTR ' || p_utr, v_j, 'vl-payout:' || l.id);
  else
    update finance.settlement_lines set payout_status = p_status, failure_reason = p_failure where id = l.id;
  end if;
  update finance.settlement_batches set status = case
      when not exists (select 1 from finance.settlement_lines where batch_id = b.id and payout_status in ('not_started','processing','failed')) then 'completed'::finance.batch_status
      when exists (select 1 from finance.settlement_lines where batch_id = b.id and payout_status = 'paid') then 'partial'::finance.batch_status
      else 'processing'::finance.batch_status end
   where id = b.id;
  return p_status;
end $$;
