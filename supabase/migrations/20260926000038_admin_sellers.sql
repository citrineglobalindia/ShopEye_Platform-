-- SHOPEYE 0038 — Super Admin portal, phase 3: sellers (profile, KYC review, bank approval, status), commission
-- plans, settlement holds and settlement batches (prepare → submit → approve → record payouts with UTR).
set search_path = public, app, finance, extensions;

insert into public.permissions(code, portal, description, sensitive) values
  ('vendor.view',       'super_admin', 'View seller accounts, KYC and balances', true),
  ('vendor.manage',     'super_admin', 'Suspend or reactivate sellers, approve bank accounts', true),
  ('commission.manage', 'super_admin', 'Create and end commission rules', true)
on conflict (code) do nothing;
insert into public.role_permissions(role_code, permission_code) values
  ('super_admin','vendor.view'), ('super_admin','vendor.manage'), ('super_admin','commission.manage'),
  ('super_admin','payout.prepare'), ('super_admin','payout.approve'), ('super_admin','payout.execute'),
  ('vendor_manager','vendor.view'), ('vendor_manager','vendor.manage'), ('accounts_head','vendor.view'), ('accounts_head','commission.manage'),
  ('accounts_manager','vendor.view'), ('accountant','vendor.view')
on conflict do nothing;

create or replace function public.admin_vendor_list(p_status text default null, p_q text default null)
returns table(id uuid, vendor_code text, display_name text, legal_name text, status text, gstin text, contact_email text, is_demo boolean,
              products bigint, gmv numeric, balance numeric, kyc_pending bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public, app, finance, extensions as $$
begin
  perform app.require_permission('vendor.view');
  return query select v.id, v.vendor_code, v.display_name, v.legal_name, v.status::text, v.gstin, v.contact_email::text, v.is_demo,
    (select count(*) from products p where p.vendor_id = v.id and p.status = 'active'),
    (select coalesce(sum(s.total), 0) from sub_orders s where s.vendor_id = v.id and s.status in ('delivered','completed','shipped','confirmed','packed','ready_to_ship'))::numeric,
    coalesce((select b.balance from finance.vendor_balances b where b.vendor_id = v.id), 0)::numeric,
    (select count(*) from vendor_kyc_documents k where k.vendor_id = v.id and k.status::text in ('uploaded','pending','under_review')),
    v.created_at
    from vendors v
   where (p_status is null or v.status::text = p_status)
     and (p_q is null or btrim(p_q) = '' or v.display_name ilike '%' || btrim(p_q) || '%' or v.legal_name ilike '%' || btrim(p_q) || '%' or v.vendor_code ilike '%' || btrim(p_q) || '%' or coalesce(v.gstin, '') ilike '%' || btrim(p_q) || '%')
   order by v.created_at desc limit 300;
end $$;

create or replace function public.admin_vendor_detail(p_vendor uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, finance, extensions as $$
begin
  perform app.require_permission('vendor.view');
  if not exists (select 1 from vendors where id = p_vendor) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'vendor', (select to_jsonb(x) from (select id, vendor_code, legal_name, display_name, slug, business_type, gstin, pan_last4, contact_email, contact_mobile, registered_address,
               status, settlement_cycle, commission_group, rating, approved_at, status_reason, created_at, is_demo from vendors where id = p_vendor) x),
    'team', (select coalesce(jsonb_agg(jsonb_build_object('email', pr.email, 'name', pr.full_name, 'role', ur.role_code)), '[]'::jsonb)
               from user_roles ur join profiles pr on pr.id = ur.user_id where ur.vendor_id = p_vendor and ur.active and ur.revoked_at is null),
    'kyc', (select coalesce(jsonb_agg(x order by x.uploaded_at desc), '[]'::jsonb) from (select id, doc_type, status, expires_on, review_note, reviewed_at, uploaded_at from vendor_kyc_documents where vendor_id = p_vendor) x),
    'banks', (select coalesce(jsonb_agg(x order by x.version desc), '[]'::jsonb) from (select id, version, account_holder, ifsc, account_last4, penny_drop_status, status, effective_from, created_at from vendor_bank_accounts where vendor_id = p_vendor) x),
    'stats', jsonb_build_object(
       'products_live', (select count(*) from products where vendor_id = p_vendor and status = 'active'),
       'products_review', (select count(*) from products where vendor_id = p_vendor and status = 'pending_review'),
       'orders', (select count(*) from sub_orders where vendor_id = p_vendor and status <> 'pending_payment'),
       'gmv', (select coalesce(sum(total), 0) from sub_orders where vendor_id = p_vendor and status in ('delivered','completed','shipped','confirmed','packed','ready_to_ship')),
       'balance', coalesce((select balance from finance.vendor_balances where vendor_id = p_vendor), 0),
       'held', (select coalesce(sum(amount), 0) from finance.settlement_holds where vendor_id = p_vendor and status = 'active')),
    'commission', (select coalesce(jsonb_agg(x order by x.effective_from desc), '[]'::jsonb) from (select r.id, c.name as category, r.commission_type, r.commission_value, r.effective_from, r.effective_to, r.active
                    from finance.commission_rules r left join categories c on c.id = r.category_id where r.vendor_id = p_vendor) x),
    'holds', (select coalesce(jsonb_agg(x order by x.placed_at desc), '[]'::jsonb) from (select id, amount, reason_code, reason, status, placed_at, released_at from finance.settlement_holds where vendor_id = p_vendor) x),
    'payouts', (select coalesce(jsonb_agg(x order by x.paid_at desc nulls first), '[]'::jsonb) from (select l.id, b.batch_number, l.net_payable, l.payout_status, l.utr, l.paid_at from finance.settlement_lines l join finance.settlement_batches b on b.id = l.batch_id where l.vendor_id = p_vendor order by b.created_at desc limit 20) x),
    'history', (select coalesce(jsonb_agg(x order by x.occurred_at desc), '[]'::jsonb) from (select a.occurred_at, a.action, a.after_value->>'status' as status, a.reason, pr.email::text as by_email
                  from app.audit_log a left join profiles pr on pr.id = a.actor_id where a.entity_type in ('vendors','vendor_kyc_documents','vendor_bank_accounts') and (a.entity_id = p_vendor::text
                  or a.entity_id in (select id::text from vendor_kyc_documents where vendor_id = p_vendor) or a.entity_id in (select id::text from vendor_bank_accounts where vendor_id = p_vendor)) order by a.occurred_at desc limit 30) x));
end $$;

create or replace function public.admin_set_vendor_status(p_vendor uuid, p_status text, p_reason text) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
declare old text;
begin
  perform app.require_permission('vendor.manage');
  if p_status not in ('active','suspended','closed') then raise exception 'BAD_STATUS: choose active, suspended or closed' using errcode = 'P0001'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED: give a reason of at least 5 characters' using errcode = 'P0001'; end if;
  select status::text into old from vendors where id = p_vendor for update;
  if old is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  update vendors set status = p_status::vendor_status, status_reason = btrim(p_reason) where id = p_vendor;
  -- a suspended or closed seller's products leave the storefront (they come back when reactivated)
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, before_value, after_value, reason)
  values (auth.uid(), 'super_admin', 'vendor.status', 'vendors', p_vendor::text, jsonb_build_object('status', old), jsonb_build_object('status', p_status), btrim(p_reason));
  return p_status;
end $$;

create or replace function public.admin_review_kyc(p_doc uuid, p_approve boolean, p_note text) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
declare d vendor_kyc_documents;
begin
  perform app.require_permission('vendor.kyc.review');
  if not p_approve and (p_note is null or char_length(btrim(p_note)) < 5) then raise exception 'REASON_REQUIRED: tell the seller what to fix (5+ characters)' using errcode = 'P0001'; end if;
  select * into d from vendor_kyc_documents where id = p_doc for update;
  if d.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  update vendor_kyc_documents set status = (case when p_approve then 'verified' else 'rejected' end)::kyc_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '') where id = d.id;
  return case when p_approve then 'verified' else 'rejected' end;
end $$;

create or replace function public.admin_decide_bank(p_account uuid, p_approve boolean, p_note text) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
declare a vendor_bank_accounts;
begin
  perform app.require_permission('vendor.manage');
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'REASON_REQUIRED: add a note of at least 5 characters' using errcode = 'P0001'; end if;
  select * into a from vendor_bank_accounts where id = p_account for update;
  if a.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if a.created_by = auth.uid() then raise exception 'MAKER_CHECKER: someone else must approve a bank account you added' using errcode = 'P0001'; end if;
  update vendor_bank_accounts set status = (case when p_approve then 'active' else 'rejected' end)::bank_account_status, effective_from = case when p_approve then now() else effective_from end where id = a.id;
  if p_approve then update vendor_bank_accounts set status = 'superseded'::bank_account_status where vendor_id = a.vendor_id and id <> a.id and status = 'active'::bank_account_status; end if;
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, after_value, reason)
  values (auth.uid(), 'super_admin', case when p_approve then 'bank.approve' else 'bank.reject' end, 'vendor_bank_accounts', a.id::text, jsonb_build_object('last4', a.account_last4, 'ifsc', a.ifsc), btrim(p_note));
  return case when p_approve then 'active' else 'rejected' end;
end $$;

-- Commission plans: effective-dated rules; a seller rule beats a category rule beats the marketplace default
create or replace function public.admin_list_commission_rules() returns table(id uuid, vendor text, vendor_id uuid, category text, category_id uuid, commission_type text,
  commission_value numeric, base text, tax_rate numeric, effective_from date, effective_to date, active boolean)
language plpgsql stable security definer set search_path = public, app, finance as $$
begin
  if not (app.has_permission('commission.manage') or app.has_permission('vendor.view')) then raise exception 'FORBIDDEN: missing permission commission.manage' using errcode = '42501'; end if;
  return query select r.id, v.display_name, r.vendor_id, c.name, r.category_id, r.commission_type::text, r.commission_value::numeric, r.base::text, r.tax_rate::numeric, r.effective_from::date, r.effective_to::date, r.active
    from finance.commission_rules r left join vendors v on v.id = r.vendor_id left join categories c on c.id = r.category_id
   order by r.active desc, v.display_name nulls first, c.name nulls first, r.effective_from desc;
end $$;

create or replace function public.admin_save_commission_rule(p_vendor uuid, p_category uuid, p_type text, p_value numeric, p_from date, p_note text) returns uuid
language plpgsql security definer set search_path = public, app, finance, extensions as $$
declare v_id uuid; v_from date := coalesce(p_from, current_date);
begin
  perform app.require_permission('commission.manage');
  if p_type not in ('percent','flat_per_unit') then raise exception 'BAD_TYPE: percent or flat_per_unit' using errcode = 'P0001'; end if;
  if p_value is null or p_value < 0 or (p_type = 'percent' and p_value > 60) then raise exception 'BAD_VALUE: percent must be 0–60' using errcode = 'P0001'; end if;
  if v_from < current_date then raise exception 'NO_BACKDATING: rules can start today or later' using errcode = 'P0001'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'REASON_REQUIRED: add a note of at least 5 characters' using errcode = 'P0001'; end if;
  -- the rule it replaces ends the day before
  update finance.commission_rules set effective_to = v_from - 1
   where active and vendor_id is not distinct from p_vendor and category_id is not distinct from p_category and (effective_to is null or effective_to >= v_from) and effective_from < v_from;
  update finance.commission_rules set active = false
   where active and vendor_id is not distinct from p_vendor and category_id is not distinct from p_category and effective_from >= v_from;
  insert into finance.commission_rules(vendor_id, category_id, effective_from, commission_type, commission_value, base, tax_rate, priority, active, created_by)
  values (p_vendor, p_category, v_from, p_type, p_value, 'line_total', 18, case when p_vendor is not null then 10 when p_category is not null then 5 else 1 end, true, auth.uid())
  returning id into v_id;
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, after_value, reason)
  values (auth.uid(), 'super_admin', 'commission.rule', 'commission_rules', v_id::text, jsonb_build_object('vendor', p_vendor, 'category', p_category, 'type', p_type, 'value', p_value, 'from', v_from), btrim(p_note));
  return v_id;
end $$;

create or replace function public.admin_end_commission_rule(p_rule uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public, app, finance, extensions as $$
begin
  perform app.require_permission('commission.manage');
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'REASON_REQUIRED: add a note of at least 5 characters' using errcode = 'P0001'; end if;
  update finance.commission_rules set effective_to = greatest(effective_from, current_date), active = effective_from <= current_date where id = p_rule and active;
  if not found then return false; end if;
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, reason) values (auth.uid(), 'super_admin', 'commission.rule.end', 'commission_rules', p_rule::text, btrim(p_note));
  return true;
end $$;

-- Settlement holds (block part of a seller's payout, e.g. during a dispute)
create or replace function public.admin_place_hold(p_vendor uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public, app, finance, extensions as $$
declare v_id uuid;
begin
  perform app.require_permission('payout.prepare');
  if p_amount is null or p_amount <= 0 then raise exception 'BAD_AMOUNT' using errcode = 'P0001'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED: add a reason of at least 5 characters' using errcode = 'P0001'; end if;
  insert into finance.settlement_holds(vendor_id, amount, reason_code, reason, status, placed_by) values (p_vendor, p_amount, 'manual', btrim(p_reason), 'active', auth.uid()) returning id into v_id;
  return v_id;
end $$;
create or replace function public.admin_release_hold(p_hold uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, app, finance, extensions as $$
begin
  perform app.require_permission('payout.approve');
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED: add a reason of at least 5 characters' using errcode = 'P0001'; end if;
  update finance.settlement_holds set status = 'released', released_by = auth.uid(), released_at = now() where id = p_hold and status = 'active';
  if not found then return false; end if;
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, reason) values (auth.uid(), 'super_admin', 'hold.release', 'settlement_holds', p_hold::text, btrim(p_reason));
  return true;
end $$;

-- Settlement batches
create or replace function public.admin_list_settlements() returns jsonb
language plpgsql stable security definer set search_path = public, app, finance, extensions as $$
begin
  if not (app.has_permission('payout.prepare') or app.has_permission('payout.approve') or app.has_permission('payout.execute')) then raise exception 'FORBIDDEN: missing permission payout.prepare' using errcode = '42501'; end if;
  return jsonb_build_object(
    'balances', (select coalesce(jsonb_agg(x order by x.balance desc), '[]'::jsonb) from (select v.id, v.display_name, v.settlement_cycle, b.balance,
                   (select coalesce(sum(amount), 0) from finance.settlement_holds h where h.vendor_id = v.id and h.status = 'active') held,
                   (select account_last4 from vendor_bank_accounts a where a.vendor_id = v.id and a.status::text = 'active' order by version desc limit 1) bank_last4
                   from vendors v join finance.vendor_balances b on b.vendor_id = v.id where b.balance <> 0) x),
    'batches', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (select b.id, b.batch_number, b.cycle, b.cutoff_at, b.settlement_date, b.status, b.vendor_count, b.gross_eligible, b.total_holds, b.net_payable, b.created_at,
                   pr.email::text as prepared_by,
                   (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'vendor', v.display_name, 'eligible', l.eligible_amount, 'held', l.held_amount, 'net', l.net_payable, 'status', l.payout_status, 'utr', l.utr, 'failure', l.failure_reason, 'paid_at', l.paid_at) order by v.display_name), '[]'::jsonb)
                      from finance.settlement_lines l join vendors v on v.id = l.vendor_id where l.batch_id = b.id) as lines
                   from finance.settlement_batches b left join profiles pr on pr.id = b.prepared_by order by b.created_at desc limit 20) x));
end $$;
create or replace function public.admin_settlement_action(p_action text, p_batch uuid default null, p_cycle text default 'weekly', p_comment text default null) returns text
language plpgsql security definer set search_path = public, app, finance, extensions as $$
begin
  if p_action = 'generate' then return finance.generate_settlement_batch(coalesce(p_cycle, 'weekly'), now())::text;
  elsif p_action = 'submit' then return finance.submit_settlement_batch(p_batch)::text;
  elsif p_action in ('approve','reject','return') then
    if p_comment is null or char_length(btrim(p_comment)) < 5 then raise exception 'REASON_REQUIRED: add a note of at least 5 characters' using errcode = 'P0001'; end if;
    return finance.decide_settlement_batch(p_batch, case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'returned' end, btrim(p_comment))::text;
  else raise exception 'UNKNOWN_ACTION' using errcode = 'P0001'; end if;
end $$;
create or replace function public.admin_record_payout(p_line uuid, p_paid boolean, p_utr text, p_failure text default null) returns text
language plpgsql security definer set search_path = public, app, finance, extensions as $$
begin
  return finance.record_payout_result(p_line, case when p_paid then 'paid' else 'failed' end, nullif(btrim(coalesce(p_utr, '')), ''), nullif(btrim(coalesce(p_failure, '')), ''));
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_vendor_list(text,text)','admin_vendor_detail(uuid)','admin_set_vendor_status(uuid,text,text)','admin_review_kyc(uuid,boolean,text)','admin_decide_bank(uuid,boolean,text)',
    'admin_list_commission_rules()','admin_save_commission_rule(uuid,uuid,text,numeric,date,text)','admin_end_commission_rule(uuid,text)','admin_place_hold(uuid,numeric,text)','admin_release_hold(uuid,text)',
    'admin_list_settlements()','admin_settlement_action(text,uuid,text,text)','admin_record_payout(uuid,boolean,text,text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f); execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
