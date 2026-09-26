-- SHOPEYE 0019 — Transactional email outbox (Brevo). Events enqueue branded emails;
-- migration 0020 (Supabase-only) sends them via Brevo's API. Traces: CUST-FR-014 CUST-FR-088
-- CUST-FR-091 CUST-FR-103 CUST-FR-114 CUST-FR-126 CUST-FR-142, CUST-FR-134 (essential messages always sent)
set search_path = public, extensions;

create table app.notification_outbox (
  id          bigint generated always as identity primary key,
  kind        text not null,
  customer_id uuid,
  to_email    text not null,
  to_name     text,
  subject     text not null,
  html        text not null,
  dedupe_key  text not null unique,              -- one email per event, even if the event is replayed
  status      text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts    int not null default 0,
  request_id  bigint,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index notification_outbox_queue_idx on app.notification_outbox(status, created_at);
revoke all on app.notification_outbox from anon, authenticated;

insert into app.settings(key, value, effective_from) values
  ('notify.sender_email', '"orders@shopeye.in"', '2000-01-01'),
  ('notify.sender_name',  '"ShopEye"', '2000-01-01'),
  ('notify.site_url',     '"https://www.shopeye.in"', '2000-01-01');

create or replace function app.esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(t,''), '&','&amp;'), '<','&lt;'), '>','&gt;'), '"','&quot;'), '''','&#39;')
$$;

-- Branded shell. Never contains card numbers, CVV, UPI PIN or OTPs (CUST-FR-088).
create or replace function app.email_shell(p_title text, p_body text, p_cta_label text default null, p_cta_url text default null)
returns text language sql stable as $$
  select '<!doctype html><html><body style="margin:0;background:#F5F6FA;font-family:Arial,Helvetica,sans-serif;color:#021A53">'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6FA;padding:24px 0"><tr><td align="center">'
      || '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #DADDE8;border-radius:12px">'
      || '<tr><td style="padding:20px 28px;border-bottom:1px solid #DADDE8;font:700 22px Arial,Helvetica,sans-serif">Shop<span style="color:#02969F">Eye</span></td></tr>'
      || '<tr><td style="padding:24px 28px"><h1 style="margin:0 0 12px;font:700 20px Arial,Helvetica,sans-serif">' || app.esc(p_title) || '</h1>'
      || p_body
      || case when p_cta_url is not null then '<p style="margin:24px 0 0"><a href="' || app.esc(p_cta_url) || '" style="background:#00D07B;color:#021A53;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:6px;display:inline-block">' || app.esc(p_cta_label) || '</a></p>' else '' end
      || '</td></tr><tr><td style="padding:16px 28px;border-top:1px solid #DADDE8;font-size:12px;color:#5E6682">'
      || 'You’re receiving this because it’s about your ShopEye account or order. ShopEye will never ask for your card number, CVV, UPI PIN or OTP.'
      || '</td></tr></table></td></tr></table></body></html>'
$$;

create or replace function app.enqueue_email(p_kind text, p_customer uuid, p_dedupe text, p_subject text, p_title text, p_body text,
                                             p_cta_label text default null, p_cta_path text default null)
returns void language plpgsql security definer set search_path = public, app, extensions as $$
declare v_email text; v_name text; v_site text := (app.setting('notify.site_url'))#>>'{}';
begin
  select email, full_name into v_email, v_name from profiles where id = p_customer;
  if v_email is null then return; end if;                       -- phone-only accounts: SMS channel later
  insert into app.notification_outbox(kind, customer_id, to_email, to_name, subject, html, dedupe_key)
  values (p_kind, p_customer, v_email, v_name, p_subject,
          app.email_shell(p_title, '<p style="margin:0 0 12px">Hi ' || app.esc(split_part(coalesce(v_name,'there'),' ',1)) || ',</p>' || p_body,
                          p_cta_label, case when p_cta_path is not null then v_site || p_cta_path end),
          p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

create or replace function app.order_items_html(p_order uuid, p_sub uuid default null) returns text language sql stable
set search_path = public, app, extensions as $$
  select coalesce('<table role="presentation" width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">'
      || string_agg('<tr><td style="border-bottom:1px solid #EEF0F5">' || app.esc(oi.product_snapshot->>'title')
             || coalesce(' <span style="color:#5E6682">(' || app.esc((select string_agg(value, ' / ') from jsonb_each_text(oi.product_snapshot->'attributes'))) || ')</span>', '')
             || ' × ' || oi.qty || '</td><td align="right" style="border-bottom:1px solid #EEF0F5;white-space:nowrap">₹' || to_char(oi.line_total, 'FM99,99,99,990.00') || '</td></tr>', '' order by oi.id)
      || '</table>', '')
    from order_items oi where oi.order_id = p_order and (p_sub is null or oi.sub_order_id = p_sub)
$$;

-- Order confirmed (online capture or COD) — CUST-FR-091
create or replace function app.notify_order() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare n int;
begin
  -- runs at commit (deferred), so a COD order's items exist by the time the email is built
  select * into new from orders where id = new.id;
  if new.status = 'confirmed' and new.customer_id is not null then
    select count(*) into n from sub_orders where order_id = new.id;
    perform app.enqueue_email('order_confirmed', new.customer_id, 'order_confirmed:' || new.id,
      'Order ' || new.order_number || ' confirmed', 'Thanks, your order is confirmed',
      '<p>We’ve received order <strong>' || new.order_number || '</strong>'
        || case when n > 1 then ' and it will arrive in <strong>' || n || ' separate packages</strong>, one from each seller.' else '.' end || '</p>'
        || app.order_items_html(new.id)
        || '<p style="margin:12px 0 0"><strong>Total ' || case when new.payment_method = 'cod' then 'to pay on delivery' else 'paid' end || ': ₹' || to_char(new.grand_total, 'FM99,99,99,990.00') || '</strong></p>'
        || '<p style="color:#5E6682;font-size:13px">Delivering to ' || app.esc(new.ship_address->>'recipient') || ', ' || app.esc(new.ship_address->>'city') || ' ' || app.esc(new.ship_address->>'pincode') || '.</p>',
      'View your order', '/account/orders/' || new.id);
  end if;
  return new;
exception when others then
  raise warning 'ShopEye email not queued (%): %', tg_name, sqlerrm;   -- never block the business action
  return new;
end $$;
create constraint trigger orders_notify after insert or update of status on public.orders deferrable initially deferred for each row execute function app.notify_order();

-- Shipped / delivered per package — CUST-FR-103
create or replace function app.notify_sub_order() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare o orders; s shipments;
begin
  if new.status is not distinct from old.status or new.status not in ('shipped','delivered') then return new; end if;
  select * into o from orders where id = new.order_id;
  select * into s from shipments where sub_order_id = new.id order by created_at desc limit 1;
  if new.status = 'shipped' then
    perform app.enqueue_email('shipped', o.customer_id, 'shipped:' || new.id, 'Your package from order ' || o.order_number || ' has shipped', 'Your package is on its way',
      '<p>Package <strong>' || new.sub_order_number || '</strong> from order ' || o.order_number || ' has been handed to <strong>' || app.esc(s.carrier) || '</strong>.</p>'
      || '<p>Tracking number: <strong>' || app.esc(s.awb) || '</strong></p>' || app.order_items_html(o.id, new.id),
      'Track your order', '/account/orders/' || o.id);
  else
    perform app.enqueue_email('delivered', o.customer_id, 'delivered:' || new.id, 'Delivered: package from order ' || o.order_number, 'Your package was delivered',
      '<p>Package <strong>' || new.sub_order_number || '</strong> was delivered on ' || to_char(coalesce(new.delivered_at, now()) at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.</p>'
      || app.order_items_html(o.id, new.id)
      || case when new.return_window_ends_at is not null then '<p style="color:#5E6682;font-size:13px">Returns are open until ' || to_char(new.return_window_ends_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.</p>' else '' end,
      'View your order', '/account/orders/' || o.id);
  end if;
  return new;
exception when others then
  raise warning 'ShopEye email not queued (%): %', tg_name, sqlerrm;   -- never block the business action
  return new;
end $$;
create trigger sub_orders_notify after update of status on public.sub_orders for each row execute function app.notify_sub_order();

-- Cancellation confirmation with refund tracking — CUST-FR-114
create or replace function app.notify_cancellation() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare it order_items; o orders; r refunds;
begin
  select * into new from cancellations where id = new.id;        -- deferred: refund_id is set later in the same transaction
  select * into it from order_items where id = new.order_item_id; select * into o from orders where id = it.order_id;
  select * into r from refunds where id = new.refund_id;
  perform app.enqueue_email('cancelled', o.customer_id, 'cancelled:' || new.id, 'Cancelled: ' || (it.product_snapshot->>'title'), 'Your cancellation is confirmed',
    '<p>We’ve cancelled <strong>' || new.qty || ' × ' || app.esc(it.product_snapshot->>'title') || '</strong> from order ' || o.order_number || '.</p>'
    || case when r.id is not null then '<p>A refund of <strong>₹' || to_char(coalesce(r.approved_amount, r.requested_amount), 'FM99,99,99,990.00') || '</strong> (reference ' || r.refund_number || ') has been started to your original payment method.</p>' else '' end,
    'View your order', '/account/orders/' || o.id);
  return new;
exception when others then
  raise warning 'ShopEye email not queued (%): %', tg_name, sqlerrm;   -- never block the business action
  return new;
end $$;
create constraint trigger cancellations_notify after insert on public.cancellations deferrable initially deferred for each row execute function app.notify_cancellation();

-- Refund completed / failed — CUST-FR-126
create or replace function app.notify_refund() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare o orders; amt text;
begin
  if new.processor_status is not distinct from old.processor_status or new.processor_status not in ('success','failed') then return new; end if;
  select * into o from orders where id = new.order_id; amt := '₹' || to_char(coalesce(new.approved_amount, new.requested_amount), 'FM99,99,99,990.00');
  if new.processor_status = 'success' then
    perform app.enqueue_email('refund_done', o.customer_id, 'refund_done:' || new.id, 'Refund of ' || amt || ' sent', 'Your refund has been sent',
      '<p>We’ve sent <strong>' || amt || '</strong> (reference ' || new.refund_number || ') for order ' || o.order_number || ' to your original payment method.</p><p>Banks usually show it within 5–7 working days.</p>',
      'View your order', '/account/orders/' || o.id);
  else
    perform app.enqueue_email('refund_failed', o.customer_id, 'refund_failed:' || new.id || ':' || coalesce(new.failure_code, ''), 'We’re retrying your refund', 'Your refund needs another try',
      '<p>Your bank didn’t accept refund ' || new.refund_number || ' of ' || amt || ' for order ' || o.order_number || '. We’re retrying automatically; you don’t need to do anything.</p><p>If it hasn’t arrived in 3 working days, reply through the Help centre and we’ll sort it out.</p>',
      'Get help', '/support/new?order=' || o.id || '&category=refund');
  end if;
  return new;
exception when others then
  raise warning 'ShopEye email not queued (%): %', tg_name, sqlerrm;   -- never block the business action
  return new;
end $$;
create trigger refunds_notify after update of processor_status on public.refunds for each row execute function app.notify_refund();

-- Return status updates (requested, approved, rejected, refund done)
create or replace function app.notify_return() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare it order_items; o orders; msg text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  msg := case new.status when 'requested' then 'We’ve received your return request. We’ll confirm pickup details shortly.'
                         when 'approved' then 'Your return is approved. We’ll arrange pickup from your delivery address.'
                         when 'rejected' then 'We couldn’t accept this return: ' || app.esc(coalesce(new.rejection_reason, 'it didn’t meet the return conditions')) || '. You can ask us to review this from your order page.'
                         when 'refund_completed' then 'Your return is complete and the refund has been sent.' end;
  if msg is null then return new; end if;
  select * into it from order_items where id = new.order_item_id; select * into o from orders where id = it.order_id;
  perform app.enqueue_email('return_' || new.status, o.customer_id, 'return:' || new.id || ':' || new.status, 'Return ' || new.return_number || ': ' || replace(new.status::text, '_', ' '),
    'Update on your return', '<p><strong>' || app.esc(it.product_snapshot->>'title') || '</strong> (return ' || new.return_number || ')</p><p>' || msg || '</p>',
    'View your order', '/account/orders/' || o.id);
  return new;
exception when others then
  raise warning 'ShopEye email not queued (%): %', tg_name, sqlerrm;   -- never block the business action
  return new;
end $$;
create trigger returns_notify after insert or update of status on public.returns for each row execute function app.notify_return();

-- Help request received — CUST-FR-142
create or replace function app.notify_ticket() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
begin
  perform app.enqueue_email('ticket', new.customer_id, 'ticket:' || new.id, 'We’ve got your request (' || new.ticket_number || ')', 'We’ve received your request',
    '<p>Your reference number is <strong>' || new.ticket_number || '</strong>. We reply within one working day.</p><p style="color:#5E6682">“' || app.esc(new.subject) || '”</p>',
    'See your requests', '/account/tickets');
  return new;
exception when others then
  raise warning 'ShopEye email not queued (%): %', tg_name, sqlerrm;   -- never block the business action
  return new;
end $$;
create trigger support_tickets_notify after insert on public.support_tickets for each row execute function app.notify_ticket();

-- Welcome, only once the email is verified — CUST-FR-014
create or replace function app.notify_welcome() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    perform app.enqueue_email('welcome', new.id, 'welcome:' || new.id, 'Welcome to ShopEye', 'Welcome to ShopEye',
      '<p>Your account is ready. Every product on ShopEye comes from an independent Indian seller and is reviewed before it goes live.</p>',
      'Start shopping', '/');
  end if;
  return new;
exception when others then
  raise warning 'ShopEye email not queued (%): %', tg_name, sqlerrm;   -- never block the business action
  return new;
end $$;
drop trigger if exists on_auth_user_verified on auth.users;
create trigger on_auth_user_verified after insert or update of email_confirmed_at on auth.users for each row execute function app.notify_welcome();
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.is_vendor_member(uuid), app.has_permission(text, uuid, uuid), app.actor_id() to anon, authenticated;
