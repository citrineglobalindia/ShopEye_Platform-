-- SHOPEYE 0037 — Super Admin portal, phase 2: order management, fulfilment, cancellations, returns,
-- refunds (approval + sending to Razorpay) and payment transactions.
set search_path = public, app, extensions;

insert into public.permissions(code, portal, description, sensitive) values
  ('order.manage',   'super_admin', 'Cancel items and move packages through fulfilment', true),
  ('return.manage',  'super_admin', 'Approve, reject and process returns', true),
  ('refund.approve', 'super_admin', 'Approve refunds and send them to the payment gateway', true),
  ('payment.view',   'super_admin', 'View payment transactions', true)
on conflict (code) do nothing;
insert into public.role_permissions(role_code, permission_code) values
  ('super_admin','order.manage'), ('super_admin','return.manage'), ('super_admin','refund.approve'), ('super_admin','payment.view'),
  ('refund_staff','payment.view'), ('refund_staff','order.view.all'), ('accounts_head','refund.approve'), ('accounts_head','payment.view'), ('accounts_head','order.view.all'),
  ('help_desk_lead','order.view.all'), ('help_desk_lead','return.manage'), ('qc_lead','return.manage'), ('qc_lead','order.view.all'), ('warehouse_staff','order.manage')
on conflict do nothing;

-- Orders list with search and filters
create or replace function public.admin_list_orders(p_q text default null, p_status text default null, p_payment text default null,
  p_from date default null, p_to date default null, p_limit int default 50, p_offset int default 0)
returns table(id uuid, order_number text, placed_at timestamptz, customer text, email text, status text, payment_status text, payment_method text,
              grand_total numeric, packages bigint, total bigint)
language plpgsql stable security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('order.view.all');
  return query
  select o.id, o.order_number, o.placed_at, pr.full_name, pr.email::text, o.status::text, o.payment_status::text, o.payment_method, o.grand_total::numeric,
         (select count(*) from sub_orders s where s.order_id = o.id), count(*) over ()
    from orders o left join profiles pr on pr.id = o.customer_id
   where (p_status is null or o.status::text = p_status) and (p_payment is null or o.payment_status::text = p_payment)
     and (p_from is null or o.placed_at >= p_from) and (p_to is null or o.placed_at < p_to + 1)
     and (p_q is null or btrim(p_q) = '' or o.order_number ilike '%' || btrim(p_q) || '%' or pr.full_name ilike '%' || btrim(p_q) || '%' or pr.email::text ilike '%' || btrim(p_q) || '%'
          or exists (select 1 from payments py where py.order_id = o.id and (py.gateway_payment_id = btrim(p_q) or py.gateway_order_id = btrim(p_q))))
   order by o.placed_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Everything about one order, for the admin order page
create or replace function public.admin_order_detail(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('order.view.all');
  if not exists (select 1 from orders where id = p_order) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'order', (select to_jsonb(x) from (select o.id, o.order_number, o.status, o.payment_status, o.payment_method, o.grand_total, o.placed_at, o.ship_address, o.coupon_code,
               pr.full_name as customer, pr.email::text as email, pr.mobile, o.customer_id from orders o left join profiles pr on pr.id = o.customer_id where o.id = p_order) x),
    'packages', (select coalesce(jsonb_agg(x order by x.sub_order_number), '[]'::jsonb) from (
       select s.id, s.sub_order_number, s.status, s.total, v.display_name as seller,
              (select to_jsonb(sh) from (select carrier, awb, status, shipped_at, delivered_at from shipments where sub_order_id = s.id order by created_at desc limit 1) sh) as shipment,
              (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.product_snapshot->>'title', 'attrs', i.product_snapshot->'attributes', 'qty', i.qty,
                        'cancelled', i.cancelled_qty, 'returned', i.return_requested_qty, 'unit_price', i.unit_price, 'line_total', i.line_total, 'refunded', i.refunded_amount) order by i.id), '[]'::jsonb)
                 from order_items i where i.sub_order_id = s.id) as items
         from sub_orders s join vendors v on v.id = s.vendor_id where s.order_id = p_order) x),
    'payments', (select coalesce(jsonb_agg(x order by x.created_at), '[]'::jsonb) from (select id, gateway, method, amount, status, gateway_order_id, gateway_payment_id, failure_code, failure_message, captured_at, created_at
                   from payments where order_id = p_order) x),
    'refunds', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (select id, refund_number, requested_amount, approved_amount, reason_code, reason_details, source_type,
                   approval_status, processor_status, gateway_refund_id, destination, created_at, completed_at from refunds where order_id = p_order) x),
    'returns', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (select r.id, r.return_number, r.qty, r.resolution, r.reason, r.reason_details, r.status, r.rejection_reason, r.created_at,
                   i.product_snapshot->>'title' as title from returns r join order_items i on i.id = r.order_item_id where i.order_id = p_order) x),
    'invoices', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select id, number as doc_number, kind as doc_type, issued_at, total from invoices where order_id = p_order order by issued_at) x),
    'timeline', (select coalesce(jsonb_agg(x order by x.occurred_at), '[]'::jsonb) from (
       select a.occurred_at, a.entity_type, a.action, a.before_value->>'status' as from_status, a.after_value->>'status' as to_status, a.reason, pr.email::text as by_email
         from app.audit_log a left join profiles pr on pr.id = a.actor_id
        where (a.entity_type = 'orders' and a.entity_id = p_order::text)
           or (a.entity_type = 'sub_orders' and a.entity_id in (select id::text from sub_orders where order_id = p_order))
           or (a.entity_type = 'payments' and a.entity_id in (select id::text from payments where order_id = p_order))
        order by a.occurred_at limit 100) x));
end $$;

-- Cancel an item (or part) on the customer's behalf; the standard cancellation rules, stock release and refund apply
create or replace function public.admin_cancel_item(p_item uuid, p_qty int, p_reason text, p_comments text) returns jsonb
language plpgsql security definer set search_path = public, app, extensions as $$
declare r jsonb;
begin
  perform app.require_permission('order.manage');
  if p_comments is null or char_length(btrim(p_comments)) < 5 then raise exception 'REASON_REQUIRED: add a note of at least 5 characters' using errcode = 'P0001'; end if;
  r := public.cancel_order_item(p_item, p_qty, coalesce(nullif(btrim(p_reason), ''), 'admin_cancelled'), 'admin-cancel:' || p_item || ':' || gen_random_uuid(), 'By support: ' || btrim(p_comments));
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, after_value, reason)
  values (auth.uid(), 'super_admin', 'order.item.cancel', 'order_items', p_item::text, jsonb_build_object('qty', p_qty, 'reason', p_reason), btrim(p_comments));
  return r;
end $$;

-- Move a package through fulfilment when the seller can't (or before seller tools exist): pack, ready, ship, deliver
create or replace function public.admin_fulfil(p_sub_order uuid, p_action text, p_carrier text default null, p_awb text default null) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
declare so sub_orders; v_ship uuid;
begin
  perform app.require_permission('order.manage');
  select * into so from sub_orders where id = p_sub_order for update;
  if so.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_action = 'pack' then update sub_orders set status = 'packed' where id = so.id;
  elsif p_action = 'ready' then update sub_orders set status = 'ready_to_ship' where id = so.id;
  elsif p_action = 'ship' then
    if coalesce(btrim(p_awb), '') = '' or coalesce(btrim(p_carrier), '') = '' then raise exception 'CARRIER_AND_AWB_REQUIRED: enter the courier and tracking number' using errcode = 'P0001'; end if;
    if so.status <> 'ready_to_ship' then raise exception 'INVALID_TRANSITION: mark the package ready to ship first' using errcode = 'P0001'; end if;
    insert into shipments(sub_order_id, carrier, awb, shipped_at) values (so.id, btrim(p_carrier), btrim(p_awb), now()) returning id into v_ship;
    perform app.record_shipment_event(v_ship, 'admin-ship', 'HANDED_OVER', 'shipped', now());
  elsif p_action = 'deliver' then return public.admin_mark_delivered(so.id);
  else raise exception 'UNKNOWN_ACTION' using errcode = 'P0001';
  end if;
  return (select status::text from sub_orders where id = so.id);
end $$;

-- Returns queue and decisions
create or replace function public.admin_list_returns(p_status text default null, p_limit int default 100)
returns table(id uuid, return_number text, status text, qty int, resolution text, reason text, reason_details text, created_at timestamptz,
              title text, order_id uuid, order_number text, customer text, amount numeric)
language plpgsql stable security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('return.manage');
  return query select r.id, r.return_number, r.status::text, r.qty, r.resolution, r.reason, r.reason_details, r.created_at,
                      i.product_snapshot->>'title', o.id, o.order_number, pr.full_name, round(i.line_total / nullif(i.qty, 0) * r.qty, 2)::numeric
    from returns r join order_items i on i.id = r.order_item_id join orders o on o.id = i.order_id left join profiles pr on pr.id = o.customer_id
   where (p_status is null and r.status::text not in ('closed','cancelled','rejected','refund_completed')) or r.status::text = p_status
   order by r.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300);
end $$;

create or replace function public.admin_decide_return(p_return uuid, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
declare r returns; i order_items; v_next text; v_amt numeric;
begin
  perform app.require_permission('return.manage');
  select * into r from returns where id = p_return for update;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into i from order_items where id = r.order_item_id;
  v_next := case p_action when 'review' then 'under_review' when 'approve' then 'approved' when 'reject' then 'rejected' when 'schedule_pickup' then 'pickup_scheduled'
                          when 'picked_up' then 'picked_up' when 'received' then 'received' when 'qc' then 'quality_check' when 'accept' then 'accepted' when 'close' then 'closed' else null end;
  if v_next is null then raise exception 'UNKNOWN_ACTION' using errcode = 'P0001'; end if;
  if p_action = 'reject' and (p_note is null or char_length(btrim(p_note)) < 5) then raise exception 'REASON_REQUIRED: tell the customer why (5+ characters)' using errcode = 'P0001'; end if;
  update returns set status = v_next::return_status, rejection_reason = case when p_action = 'reject' then btrim(p_note) else rejection_reason end, qc_result = case when p_action in ('accept','qc') and p_note is not null then btrim(p_note) else qc_result end where id = r.id;
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, before_value, after_value, reason)
  values (auth.uid(), 'super_admin', 'return.' || p_action, 'returns', r.id::text, jsonb_build_object('status', r.status), jsonb_build_object('status', v_next), nullif(btrim(coalesce(p_note, '')), ''));
  -- accepted refund-type returns start the refund for the returned units
  if p_action = 'accept' and r.resolution = 'refund' then
    v_amt := round(i.line_total / nullif(i.qty, 0) * r.qty, 2);
    perform app.request_refund(i.order_id, v_amt, 'item', 'return', r.id::text, 'return_accepted', 'return:' || r.id, r.reason);
    update returns set status = 'refund_initiated' where id = r.id;
    return 'refund_initiated';
  end if;
  return v_next;
end $$;

-- Refunds queue, approval, and hand-off to the payment gateway (the server calls Razorpay, then records the result)
create or replace function public.admin_list_refunds(p_view text default 'action', p_limit int default 100)
returns table(id uuid, refund_number text, order_id uuid, order_number text, customer text, requested_amount numeric, approved_amount numeric, gateway text,
              reason_code text, source_type text, approval_status text, processor_status text, gateway_refund_id text, created_at timestamptz, completed_at timestamptz)
language plpgsql stable security definer set search_path = public, app, extensions as $$
begin
  if not (app.has_permission('refund.approve') or app.has_permission('payment.view')) then raise exception 'FORBIDDEN: missing permission refund.approve' using errcode = '42501'; end if;
  return query select f.id, f.refund_number, o.id, o.order_number, pr.full_name, f.requested_amount::numeric, f.approved_amount::numeric, py.gateway, f.reason_code, f.source_type,
                      f.approval_status, f.processor_status::text, f.gateway_refund_id, f.created_at, f.completed_at
    from refunds f join orders o on o.id = f.order_id left join profiles pr on pr.id = o.customer_id left join payments py on py.id = f.payment_id
   where p_view = 'all' or (p_view = 'action' and (f.approval_status = 'pending' or (f.approval_status in ('approved','not_required') and f.processor_status in ('not_sent','failed'))))
      or (p_view = 'processing' and f.processor_status = 'processing') or (p_view = 'done' and f.processor_status = 'success')
   order by f.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300);
end $$;

create or replace function public.admin_decide_refund(p_refund uuid, p_approve boolean, p_note text) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
declare f refunds;
begin
  perform app.require_permission('refund.approve');
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'REASON_REQUIRED: add a note of at least 5 characters' using errcode = 'P0001'; end if;
  select * into f from refunds where id = p_refund for update;
  if f.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if f.approval_status <> 'pending' then raise exception 'NOT_PENDING: this refund is already %', f.approval_status using errcode = 'P0001'; end if;
  if f.initiated_by = auth.uid() then raise exception 'MAKER_CHECKER: someone else must approve a refund you started' using errcode = 'P0001'; end if;
  update refunds set approval_status = case when p_approve then 'approved' else 'rejected' end,
                     approved_amount = case when p_approve then requested_amount else approved_amount end, approved_at = case when p_approve then now() else approved_at end
   where id = f.id;
  update app.approval_requests set status = (case when p_approve then 'approved' else 'rejected' end)::approval_status, decided_at = now() where id = f.approval_request_id and status = 'pending';
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, after_value, reason)
  values (auth.uid(), 'super_admin', case when p_approve then 'refund.approve' else 'refund.reject' end, 'refunds', f.id::text, jsonb_build_object('amount', f.requested_amount), btrim(p_note));
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

-- What the server needs to send an approved refund to Razorpay (only for callers allowed to approve refunds)
create or replace function public.admin_refund_for_gateway(p_refund uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, extensions as $$
declare r jsonb;
begin
  perform app.require_permission('refund.approve');
  select jsonb_build_object('id', f.id, 'refund_number', f.refund_number, 'amount', coalesce(f.approved_amount, f.requested_amount), 'payment_id', py.gateway_payment_id, 'gateway', py.gateway,
                            'order_number', o.order_number)
    into r from refunds f join payments py on py.id = f.payment_id join orders o on o.id = f.order_id
   where f.id = p_refund and f.approval_status in ('approved','not_required') and f.processor_status in ('not_sent','failed');
  if r is null then raise exception 'NOT_SENDABLE: only approved refunds that haven''t been sent can be sent' using errcode = 'P0001'; end if;
  if r->>'gateway' <> 'razorpay' or coalesce(r->>'payment_id', '') = '' then raise exception 'NOT_GATEWAY: this refund isn''t for a Razorpay payment' using errcode = 'P0001'; end if;
  return r;
end $$;

-- Server-only: record Razorpay's answer (called with the service key after the API call, and by the refund webhooks)
create or replace function public.svc_record_refund(p_refund uuid, p_gateway_refund_id text, p_status text, p_error text default null, p_actor uuid default null) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
declare f refunds; v_state refund_processor_status;
begin
  v_state := case when p_status in ('processed','success') then 'success' when p_status in ('failed') then 'failed' else 'processing' end;
  if p_refund is not null then select * into f from refunds where id = p_refund for update;
  else select * into f from refunds where gateway_refund_id = p_gateway_refund_id for update; end if;
  if f.id is null then return 'unknown_refund'; end if;
  if f.processor_status = 'success' then return 'already_done'; end if;
  update refunds set gateway_refund_id = coalesce(p_gateway_refund_id, gateway_refund_id), processor_status = v_state, failure_code = case when v_state = 'failed' then left(p_error, 200) else null end,
                     submitted_at = coalesce(submitted_at, now()), completed_at = case when v_state = 'success' then now() else completed_at end
   where id = f.id;
  insert into app.audit_log(actor_id, portal, action, entity_type, entity_id, after_value, reason)
  values (p_actor, 'super_admin', 'refund.gateway.' || v_state, 'refunds', f.id::text, jsonb_build_object('gateway_refund_id', p_gateway_refund_id, 'status', p_status), p_error);
  return v_state::text;
end $$;

-- Payment transactions
create or replace function public.admin_list_payments(p_status text default null, p_q text default null, p_limit int default 100)
returns table(id uuid, order_id uuid, order_number text, customer text, gateway text, method text, amount numeric, status text, gateway_order_id text, gateway_payment_id text,
              failure_code text, failure_message text, flagged_reason text, created_at timestamptz, captured_at timestamptz, refunded numeric)
language plpgsql stable security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('payment.view');
  return query select py.id, o.id, o.order_number, pr.full_name, py.gateway, py.method, py.amount::numeric, py.status::text, py.gateway_order_id, py.gateway_payment_id,
                      py.failure_code, py.failure_message, py.flagged_reason, py.created_at, py.captured_at,
                      (select coalesce(sum(coalesce(f.approved_amount, f.requested_amount)), 0) from refunds f where f.payment_id = py.id and f.processor_status = 'success')::numeric
    from payments py join orders o on o.id = py.order_id left join profiles pr on pr.id = o.customer_id
   where (p_status is null or py.status::text = p_status)
     and (p_q is null or btrim(p_q) = '' or o.order_number ilike '%' || btrim(p_q) || '%' or py.gateway_payment_id = btrim(p_q) or py.gateway_order_id = btrim(p_q))
   order by py.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300);
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_list_orders(text,text,text,date,date,int,int)','admin_order_detail(uuid)','admin_cancel_item(uuid,int,text,text)','admin_fulfil(uuid,text,text,text)',
    'admin_list_returns(text,int)','admin_decide_return(uuid,text,text)','admin_list_refunds(text,int)','admin_decide_refund(uuid,boolean,text)','admin_refund_for_gateway(uuid)','admin_list_payments(text,text,int)'] loop
    execute format('revoke execute on function public.%s from public, anon', f); execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke execute on function public.svc_record_refund(uuid, text, text, text, uuid) from public, anon, authenticated;
end $$;
