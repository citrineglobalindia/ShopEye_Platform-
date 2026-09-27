-- SHOPEYE 0023 — Customer GST tax invoices and credit notes (marketplace: each seller invoices the buyer).
-- Traces: CUST-FR-097 CUST-FR-104 CUST-FR-105 CUST-FR-106 CUST-FR-107 CUST-FR-108 CUST-FR-109
-- Rules used (flag to Finance for sign-off):
--   * one tax invoice per seller package, issued when the package ships; the seller must have a GSTIN
--   * place of supply = delivery state; same state as the seller's GSTIN -> CGST+SGST, otherwise IGST
--   * prices include GST; taxable = line / (1 + rate), rounded to paise per line (same as checkout); tax is the rest
--   * shipping follows the package's principal supply: taxed at the highest item rate in the package
--   * returns (refund completed) and RTO get a credit note against the original invoice; invoices are never edited
--   * per-seller, per-financial-year serial numbers, at most 16 characters
set search_path = public, extensions;

insert into public.permissions(code, portal, description, sensitive)
values ('invoice.view', 'accounts', 'View customer tax invoices and credit notes', false) on conflict (code) do nothing;
insert into public.role_permissions(role_code, permission_code)
select r, 'invoice.view' from unnest(array['super_admin','accounts_head','accounts_manager','accountant']) r
where exists (select 1 from public.roles where code = r) on conflict do nothing;

insert into app.settings(key, value, effective_from) values ('documents.retention_years', '8', '2000-01-01') on conflict do nothing;

create table app.gst_states (alpha text primary key, code text not null unique, name text not null);
insert into app.gst_states values
 ('JK','01','Jammu & Kashmir'),('HP','02','Himachal Pradesh'),('PB','03','Punjab'),('CH','04','Chandigarh'),('UT','05','Uttarakhand'),
 ('HR','06','Haryana'),('DL','07','Delhi'),('RJ','08','Rajasthan'),('UP','09','Uttar Pradesh'),('BR','10','Bihar'),('SK','11','Sikkim'),
 ('AR','12','Arunachal Pradesh'),('NL','13','Nagaland'),('MN','14','Manipur'),('MZ','15','Mizoram'),('TR','16','Tripura'),('ML','17','Meghalaya'),
 ('AS','18','Assam'),('WB','19','West Bengal'),('JH','20','Jharkhand'),('OR','21','Odisha'),('CT','22','Chhattisgarh'),('MP','23','Madhya Pradesh'),
 ('GJ','24','Gujarat'),('DN','26','Dadra & Nagar Haveli and Daman & Diu'),('MH','27','Maharashtra'),('KA','29','Karnataka'),('GA','30','Goa'),
 ('LD','31','Lakshadweep'),('KL','32','Kerala'),('TN','33','Tamil Nadu'),('PY','34','Puducherry'),('AN','35','Andaman & Nicobar'),
 ('TG','36','Telangana'),('AP','37','Andhra Pradesh'),('LA','38','Ladakh');

-- GSTIN: format, known state code and the official mod-36 check character (CUST-FR-109)
create or replace function app.gstin_valid(p text) returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare cs text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; s int := 0; v int; i int;
begin
  if p is null or p !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then return false; end if;
  if left(p, 2) not in ('01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24',
                        '26','27','29','30','31','32','33','34','35','36','37','38','97') then return false; end if;
  for i in 1..14 loop
    v := (strpos(cs, substr(p, i, 1)) - 1) * (case when i % 2 = 0 then 2 else 1 end);
    s := s + v / 36 + v % 36;
  end loop;
  return substr(cs, ((36 - s % 36) % 36) + 1, 1) = substr(p, 15, 1);
end $$;

alter table public.orders add column if not exists buyer_gstin text check (buyer_gstin is null or buyer_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
                          add column if not exists buyer_legal_name text check (buyer_legal_name is null or char_length(btrim(buyer_legal_name)) between 2 and 200);

create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('invoice','credit_note')),
  number          text not null check (char_length(number) <= 16),
  order_id        uuid not null references public.orders(id),
  sub_order_id    uuid not null references public.sub_orders(id),
  vendor_id       uuid not null references public.vendors(id),
  customer_id     uuid references public.profiles(id),
  original_invoice_id uuid references public.invoices(id),
  source          text not null,                        -- 'shipment', 'return:<id>', 'rto'
  issued_at       timestamptz not null default now(),
  financial_year  text not null,
  supplier        jsonb not null,                       -- frozen: legal name, GSTIN, address, state (CUST-FR-105)
  buyer           jsonb not null,                       -- frozen: name, GSTIN, billing and delivery address
  place_of_supply text not null,
  supply_type     text not null check (supply_type in ('intra','inter')),
  taxable_total   app.money not null,
  cgst_total      app.money not null default 0,
  sgst_total      app.money not null default 0,
  igst_total      app.money not null default 0,
  total           app.money not null,
  doc_key         text not null default encode(extensions.gen_random_bytes(24), 'hex'),   -- unguessable link part (CUST-FR-108)
  retain_until    date not null,
  unique (vendor_id, kind, number),
  unique (source, sub_order_id),
  check (total = taxable_total + cgst_total + sgst_total + igst_total),                      -- CUST-FR-106
  check ((kind = 'credit_note') = (original_invoice_id is not null))
);
create index invoices_order_idx on public.invoices(order_id);
create table public.invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices(id),
  line_no       int not null,
  order_item_id uuid references public.order_items(id),
  description   text not null,
  hsn           text,
  qty           int not null check (qty > 0),
  unit_price    app.money not null,                     -- GST-inclusive selling price
  discount      app.money not null default 0,
  taxable_value app.money not null,
  gst_rate      numeric(5,2) not null,
  cgst          app.money not null default 0,
  sgst          app.money not null default 0,
  igst          app.money not null default 0,
  line_total    app.money not null,
  unique (invoice_id, line_no),
  check (line_total = unit_price * qty - discount),
  check (line_total = taxable_value + cgst + sgst + igst)
);
create table app.invoice_series (vendor_id uuid, kind text, financial_year text, last_no int not null default 0, primary key (vendor_id, kind, financial_year));

-- Issued documents are never edited or deleted; corrections are credit notes (CUST-FR-105/109)
create or replace function app.invoice_immutable() returns trigger language plpgsql as $$
begin raise exception 'INVOICE_IMMUTABLE: issued tax documents cannot be changed; issue a credit note instead' using errcode = 'P0001'; end $$;
create or replace function app.invoice_totals_once() returns trigger language plpgsql as $$
begin   -- the issuing function writes totals once, inside its own transaction, right after the lines
  if tg_op = 'UPDATE' and current_setting('app.invoice_writing', true) = old.id::text and old.total = 0 then return new; end if;
  raise exception 'INVOICE_IMMUTABLE: issued tax documents cannot be changed; issue a credit note instead' using errcode = 'P0001';
end $$;
create trigger invoices_immutable before update or delete on public.invoices for each row execute function app.invoice_totals_once();
create trigger invoice_lines_immutable before update or delete on public.invoice_lines for each row execute function app.invoice_immutable();

alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
revoke all on public.invoices, public.invoice_lines from anon, authenticated;
grant select on public.invoices, public.invoice_lines to authenticated;
create policy invoices_read on public.invoices for select
  using (customer_id = auth.uid() or app.is_vendor_member(vendor_id) or app.has_permission('invoice.view'));
create policy invoice_lines_read on public.invoice_lines for select
  using (exists (select 1 from invoices i where i.id = invoice_id));      -- inherits the invoice's visibility

create or replace function app.financial_year(t timestamptz) returns text language sql immutable set search_path = pg_catalog as $$
  select case when extract(month from t at time zone 'Asia/Kolkata') >= 4
              then to_char(t at time zone 'Asia/Kolkata', 'YY') || lpad(((to_char(t at time zone 'Asia/Kolkata', 'YY'))::int + 1)::text, 2, '0')
              else lpad(((to_char(t at time zone 'Asia/Kolkata', 'YY'))::int - 1)::text, 2, '0') || to_char(t at time zone 'Asia/Kolkata', 'YY') end
$$;

create or replace function app.next_invoice_number(p_vendor uuid, p_kind text, p_fy text) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
declare n int; v_code text;
begin
  insert into app.invoice_series(vendor_id, kind, financial_year, last_no) values (p_vendor, p_kind, p_fy, 1)
  on conflict (vendor_id, kind, financial_year) do update set last_no = app.invoice_series.last_no + 1 returning last_no into n;
  select coalesce(nullif(ltrim(regexp_replace(vendor_code, '\D', '', 'g'), '0'), ''), '0') into v_code from vendors where id = p_vendor;
  return 'V' || v_code || '/' || p_fy || '/' || case p_kind when 'credit_note' then 'C' else '' end || n;
end $$;

create or replace function app.snapshot_title(p jsonb) returns text language sql immutable set search_path = pg_catalog as $$
  select left(coalesce(p->>'title', 'Item') || coalesce(' (' || (select string_agg(value, ' / ') from jsonb_each_text(coalesce(p->'attributes', '{}'::jsonb))) || ')', ''), 200)
$$;
-- Split tax for a GST-inclusive amount
create or replace function app.gst_split(p_amount numeric, p_rate numeric, p_intra boolean, out taxable numeric, out cgst numeric, out sgst numeric, out igst numeric)
language plpgsql immutable set search_path = pg_catalog as $$
declare tax numeric;
begin
  taxable := round(p_amount / (1 + p_rate / 100), 2);     -- same formula as checkout, so invoice and order agree to the paisa
  tax := p_amount - taxable;
  if p_intra then cgst := round(tax / 2, 2); sgst := tax - cgst; igst := 0; else cgst := 0; sgst := 0; igst := tax; end if;
end $$;

-- Tax invoice for one seller package (CUST-FR-104..107). Idempotent: a package gets one invoice.
create or replace function app.issue_invoice(p_sub_order uuid) returns uuid
language plpgsql security definer set search_path = public, app, extensions as $$
declare so sub_orders; o orders; v vendors; v_id uuid; v_fy text; v_pos text; v_sup_state text; v_intra boolean; it record; n int := 0;
        s record; v_bill numeric; v_disc numeric; v_line numeric; v_maxrate numeric := 0; v_name text; v_years int;
begin
  select id into v_id from invoices where sub_order_id = p_sub_order and source = 'shipment';
  if v_id is not null then return v_id; end if;
  select * into so from sub_orders where id = p_sub_order;
  select * into o from orders where id = so.order_id;
  select * into v from vendors where id = so.vendor_id;
  if v.gstin is null then raise exception 'SELLER_GSTIN_MISSING: seller % has no GSTIN; invoice cannot be issued', v.vendor_code using errcode = 'P0001'; end if;
  v_fy := app.financial_year(now());
  v_pos := o.ship_address->>'state_code';
  select alpha into v_sup_state from app.gst_states where code = left(v.gstin, 2);
  v_intra := v_sup_state = v_pos;
  select full_name into v_name from profiles where id = o.customer_id;
  v_years := coalesce((app.setting('documents.retention_years'))::text::int, 8);
  insert into invoices(kind, number, order_id, sub_order_id, vendor_id, customer_id, source, financial_year, supplier, buyer, place_of_supply, supply_type,
                       taxable_total, total, retain_until)
  values ('invoice', app.next_invoice_number(v.id, 'invoice', v_fy), o.id, so.id, v.id, o.customer_id, 'shipment', v_fy,
          jsonb_build_object('legal_name', v.legal_name, 'trade_name', v.display_name, 'gstin', v.gstin, 'state', v_sup_state, 'address', v.registered_address),
          jsonb_build_object('name', coalesce(o.buyer_legal_name, o.bill_address->>'recipient', v_name), 'gstin', o.buyer_gstin,
                             'bill_to', o.bill_address, 'ship_to', o.ship_address),
          v_pos, case when v_intra then 'intra' else 'inter' end, 0, 0, (now() + make_interval(years => v_years))::date)
  returning id into v_id;
  for it in select oi.* from order_items oi where oi.sub_order_id = so.id and oi.qty > oi.cancelled_qty order by oi.id loop
    v_bill := it.qty - it.cancelled_qty;
    v_disc := round(it.discount * v_bill / it.qty, 2);
    v_line := it.unit_price * v_bill - v_disc;
    s := app.gst_split(v_line, it.gst_rate, v_intra);
    n := n + 1; v_maxrate := greatest(v_maxrate, it.gst_rate);
    insert into invoice_lines(invoice_id, line_no, order_item_id, description, hsn, qty, unit_price, discount, taxable_value, gst_rate, cgst, sgst, igst, line_total)
    values (v_id, n, it.id, app.snapshot_title(it.product_snapshot),
            it.product_snapshot->>'hsn', v_bill, it.unit_price, v_disc, s.taxable, it.gst_rate, s.cgst, s.sgst, s.igst, v_line);
  end loop;
  if n = 0 then raise exception 'NOTHING_TO_INVOICE' using errcode = 'P0001'; end if;
  if so.shipping_total > 0 then
    s := app.gst_split(so.shipping_total, v_maxrate, v_intra); n := n + 1;
    insert into invoice_lines(invoice_id, line_no, description, hsn, qty, unit_price, discount, taxable_value, gst_rate, cgst, sgst, igst, line_total)
    values (v_id, n, 'Shipping and handling', '996812', 1, so.shipping_total, 0, s.taxable, v_maxrate, s.cgst, s.sgst, s.igst, so.shipping_total);
  end if;
  -- totals are written once, straight from the lines (the row is immutable afterwards)
  perform set_config('app.invoice_writing', v_id::text, true);
  update invoices i set taxable_total = t.tv, cgst_total = t.c, sgst_total = t.s, igst_total = t.g, total = t.tot
    from (select sum(taxable_value) tv, sum(cgst) c, sum(sgst) s, sum(igst) g, sum(line_total) tot from invoice_lines where invoice_id = v_id) t where i.id = v_id;
  perform set_config('app.invoice_writing', '', true);
  return v_id;
end $$;

-- Credit note against an issued invoice for returned units or an RTO (CUST-FR-105: corrections never edit the invoice)
create or replace function app.issue_credit_note(p_invoice uuid, p_source text, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public, app, extensions as $$
declare inv invoices; v_id uuid; v_fy text := app.financial_year(now()); l record; q int; n int := 0; s record; v_amt numeric; v_disc numeric;
begin
  select id into v_id from invoices where source = p_source and sub_order_id = (select sub_order_id from invoices where id = p_invoice);
  if v_id is not null then return v_id; end if;
  select * into inv from invoices where id = p_invoice and kind = 'invoice';
  if inv.id is null then return null; end if;
  insert into invoices(kind, number, order_id, sub_order_id, vendor_id, customer_id, original_invoice_id, source, financial_year, supplier, buyer,
                       place_of_supply, supply_type, taxable_total, total, retain_until)
  values ('credit_note', app.next_invoice_number(inv.vendor_id, 'credit_note', v_fy), inv.order_id, inv.sub_order_id, inv.vendor_id, inv.customer_id, inv.id,
          p_source, v_fy, inv.supplier, inv.buyer, inv.place_of_supply, inv.supply_type, 0, 0, greatest(inv.retain_until, (now() + interval '8 years')::date))
  returning id into v_id;
  for l in select * from invoice_lines where invoice_id = inv.id order by line_no loop
    -- p_items: {"<order_item_id>": qty} for returns; null means the whole invoice (RTO)
    q := case when p_items is null then l.qty else least(l.qty, coalesce((p_items->>coalesce(l.order_item_id::text, ''))::int, 0)) end;
    continue when q <= 0;
    v_disc := round(l.discount * q / l.qty, 2);
    v_amt := l.unit_price * q - v_disc;
    s := app.gst_split(v_amt, l.gst_rate, inv.supply_type = 'intra'); n := n + 1;
    insert into invoice_lines(invoice_id, line_no, order_item_id, description, hsn, qty, unit_price, discount, taxable_value, gst_rate, cgst, sgst, igst, line_total)
    values (v_id, n, l.order_item_id, l.description, l.hsn, q, l.unit_price, v_disc, s.taxable, l.gst_rate, s.cgst, s.sgst, s.igst, v_amt);
  end loop;
  if n = 0 then raise exception 'NOTHING_TO_CREDIT' using errcode = 'P0001'; end if;
  perform set_config('app.invoice_writing', v_id::text, true);
  update invoices i set taxable_total = t.tv, cgst_total = t.c, sgst_total = t.s, igst_total = t.g, total = t.tot
    from (select sum(taxable_value) tv, sum(cgst) c, sum(sgst) s, sum(igst) g, sum(line_total) tot from invoice_lines where invoice_id = v_id) t where i.id = v_id;
  perform set_config('app.invoice_writing', '', true);
  return v_id;
end $$;

-- Issue automatically: invoice when a package ships (or is marked delivered without a shipped step); credit note on RTO.
-- Never blocks fulfilment: a failure (e.g. seller without GSTIN) is logged and can be retried by admin_issue_invoice.
create table app.invoice_failures (sub_order_id uuid primary key, error text not null, at timestamptz not null default now());
create or replace function app.on_sub_order_invoice() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare inv uuid;
begin
  if new.status in ('shipped','delivered') and old.status is distinct from new.status then
    begin
      perform app.issue_invoice(new.id);
      delete from app.invoice_failures where sub_order_id = new.id;
    exception when others then
      insert into app.invoice_failures(sub_order_id, error) values (new.id, sqlerrm) on conflict (sub_order_id) do update set error = excluded.error, at = now();
    end;
  elsif new.status = 'rto_delivered' and old.status is distinct from new.status then
    select id into inv from invoices where sub_order_id = new.id and kind = 'invoice';
    if inv is not null then
      begin perform app.issue_credit_note(inv, 'rto', null);
      exception when others then raise warning 'ShopEye RTO credit note not issued: %', sqlerrm; end;
    end if;
  end if;
  return new;
end $$;
create trigger sub_orders_invoice after update of status on public.sub_orders for each row execute function app.on_sub_order_invoice();

create or replace function app.on_return_credit_note() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare inv uuid;
begin
  if new.status = 'refund_completed' and old.status is distinct from new.status then
    select i.id into inv from invoices i join order_items oi on oi.sub_order_id = i.sub_order_id where oi.id = new.order_item_id and i.kind = 'invoice';
    if inv is not null then
      begin perform app.issue_credit_note(inv, 'return:' || new.id, jsonb_build_object(new.order_item_id::text, new.qty));
      exception when others then raise warning 'ShopEye return credit note not issued: %', sqlerrm; end;
    end if;
  end if;
  return new;
end $$;
create trigger returns_credit_note after update of status on public.returns for each row execute function app.on_return_credit_note();

create or replace function public.admin_issue_invoice(p_sub_order uuid) returns uuid
language plpgsql security definer set search_path = public, app, extensions as $$
declare v uuid;
begin
  perform app.require_permission('invoice.view');
  v := app.issue_invoice(p_sub_order);
  delete from app.invoice_failures where sub_order_id = p_sub_order;
  return v;
end $$;

-- Buyer GSTIN for a business invoice: validated, and only until the first invoice for the order exists (CUST-FR-109)
create or replace function public.set_order_gst_details(p_order uuid, p_gstin text, p_legal_name text) returns jsonb
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_gstin text := nullif(upper(regexp_replace(coalesce(p_gstin, ''), '\s', '', 'g')), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from orders where id = p_order and customer_id = auth.uid()) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if exists (select 1 from invoices where order_id = p_order) then
    raise exception 'INVOICE_ALREADY_ISSUED: GST details can''t change after an invoice is issued; contact support for a corrected invoice' using errcode = 'P0001';
  end if;
  if v_gstin is not null and not app.gstin_valid(v_gstin) then raise exception 'GSTIN_INVALID' using errcode = 'P0001'; end if;
  if v_gstin is not null and char_length(btrim(coalesce(p_legal_name, ''))) < 2 then raise exception 'LEGAL_NAME_REQUIRED' using errcode = 'P0001'; end if;
  update orders set buyer_gstin = v_gstin, buyer_legal_name = case when v_gstin is null then null else btrim(p_legal_name) end where id = p_order;
  return jsonb_build_object('gstin', v_gstin);
end $$;

-- Invoice for the signed-in customer, looked up by id AND its unguessable key (used by the PDF route; CUST-FR-108)
create or replace function public.invoice_document(p_invoice uuid, p_key text) returns jsonb
language sql stable security definer set search_path = public, app, extensions as $$
  select jsonb_build_object('invoice', to_jsonb(i) - 'doc_key', 'lines', (select jsonb_agg(to_jsonb(l) order by l.line_no) from invoice_lines l where l.invoice_id = i.id),
                            'original_number', (select number from invoices o where o.id = i.original_invoice_id),
                            'order_number', (select order_number from orders where id = i.order_id),
                            'place_of_supply_label', (select g.name || ' (' || g.code || ')' from app.gst_states g where g.alpha = i.place_of_supply))
    from invoices i where i.id = p_invoice and i.doc_key = p_key
     and (i.customer_id = auth.uid() or app.is_vendor_member(i.vendor_id) or app.has_permission('invoice.view'))   -- same rule as the table's RLS
$$;

revoke execute on function public.set_order_gst_details(uuid, text, text), public.invoice_document(uuid, text), public.admin_issue_invoice(uuid) from public, anon;
grant execute on function public.set_order_gst_details(uuid, text, text), public.invoice_document(uuid, text), public.admin_issue_invoice(uuid) to authenticated;
revoke all on app.gst_states, app.invoice_series, app.invoice_failures from anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.is_vendor_member(uuid), app.has_permission(text, uuid, uuid), app.actor_id() to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.invoices, public.invoice_lines from anon, authenticated;
