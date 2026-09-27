-- SHOPEYE 0022 — Product questions & answers, account security activity, published shipping rules.
-- Traces: CUST-FR-132 (Q&A without contact details, with reporting), CUST-FR-140 (urgent only for supported escalations), CUST-FR-178 (security events with
-- timestamps and customer-safe notices), CUST-FR-063 (cart free-shipping progress uses the live rule)
set search_path = public, extensions;

-- ---------- Contact-detail guard shared by customer-written public text ----------
create or replace function app.has_contact_details(p text) returns boolean language sql immutable as $$
  select p ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'                                 -- email address
      or regexp_replace(coalesce(p, ''), '[\s().-]', '', 'g') ~ '(\+?91)?[6-9][0-9]{9}' -- Indian mobile, however it is spaced
      or p ~* '(wa\.me|whatsapp\s*(me|at|on)|call\s+me|t\.me/)'
$$;
create or replace function app.mask_email(p text) returns text language sql immutable as $$
  select case when p like '%@%' then left(split_part(p, '@', 1), 2) || '•••@' || split_part(p, '@', 2) end
$$;
create or replace function app.first_name_label(p_uid uuid) returns text language sql stable security definer set search_path = public, app, extensions as $$
  select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'ShopEye customer')
      || coalesce(' ' || nullif(left(split_part(btrim(full_name), ' ', 2), 1), '') || '.', '') from profiles where id = p_uid
$$;

-- ---------- Product questions & answers (CUST-FR-132) ----------
create table public.product_questions (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products(id),
  customer_id     uuid not null references public.profiles(id),
  body            text not null check (char_length(btrim(body)) between 10 and 500),
  status          text not null default 'pending' check (status in ('pending','published','rejected','removed')),
  moderation_note text,
  author_name     text not null,                         -- first name + initial; never contact details
  report_count    int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index product_questions_product_idx on public.product_questions(product_id, status, created_at desc);
alter table public.product_questions enable row level security;
grant select on public.product_questions to anon, authenticated;
create policy questions_read on public.product_questions for select
  using (status = 'published' or customer_id = auth.uid() or app.has_permission('review.moderate'));
create trigger product_questions_touch before update on public.product_questions for each row execute function app.touch_updated_at();
create trigger product_questions_audit after insert or update on public.product_questions for each row execute function app.audit_row();

create table public.product_answers (
  id            uuid primary key default gen_random_uuid(),
  question_id   uuid not null references public.product_questions(id) on delete cascade,
  answered_by   uuid not null references public.profiles(id),
  answerer_kind text not null check (answerer_kind in ('seller','shopeye')),
  body          text not null check (char_length(btrim(body)) between 2 and 1000),
  status        text not null default 'published' check (status in ('published','removed')),
  report_count  int not null default 0,
  created_at    timestamptz not null default now()
);
create index product_answers_q_idx on public.product_answers(question_id, created_at);
alter table public.product_answers enable row level security;
revoke all on public.product_answers from anon, authenticated;
grant select (id, question_id, answerer_kind, body, status, report_count, created_at) on public.product_answers to anon, authenticated;   -- who typed it stays internal
create policy answers_read on public.product_answers for select using (
  (status = 'published' and exists (select 1 from product_questions q where q.id = question_id and q.status = 'published'))
  or app.has_permission('review.moderate'));
create trigger product_answers_audit after insert or update on public.product_answers for each row execute function app.audit_row();

create table public.qa_reports (
  target_kind text not null check (target_kind in ('question','answer')),
  target_id   uuid not null,
  customer_id uuid not null references public.profiles(id),
  reason      text check (char_length(reason) <= 200),
  created_at  timestamptz not null default now(),
  primary key (target_id, customer_id)
);
alter table public.qa_reports enable row level security;
revoke all on public.qa_reports from anon, authenticated;

create or replace function public.ask_question(p_product uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_uid uuid := auth.uid(); v_body text := btrim(coalesce(p_body, '')); r product_questions;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from products where id = p_product and status = 'active') then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if char_length(v_body) not between 10 and 500 then raise exception 'QUESTION_LENGTH: ask in 10 to 500 characters' using errcode = 'P0001'; end if;
  if app.has_contact_details(v_body) then raise exception 'CONTACT_DETAILS_NOT_ALLOWED: remove phone numbers, emails and chat links' using errcode = 'P0001'; end if;
  if (select count(*) from product_questions where customer_id = v_uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED: too many questions, try again later' using errcode = 'P0001';
  end if;
  insert into product_questions(product_id, customer_id, body, author_name) values (p_product, v_uid, v_body, app.first_name_label(v_uid)) returning * into r;
  return jsonb_build_object('id', r.id, 'status', r.status);
end $$;

create or replace function public.delete_my_question(p_question uuid) returns void language plpgsql security definer set search_path = public, app, extensions as $$
begin
  update product_questions set status = 'removed', moderation_note = 'Deleted by the customer' where id = p_question and customer_id = auth.uid() and status <> 'removed';
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
end $$;

-- ShopEye team (review.moderate) or the product's own seller can answer a published question
create or replace function public.answer_question(p_question uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_uid uuid := auth.uid(); q product_questions; v_vendor uuid; v_kind text; v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into q from product_questions where id = p_question;
  if q.id is null or q.status <> 'published' then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select vendor_id into v_vendor from products where id = q.product_id;
  v_kind := case when app.has_permission('review.moderate') then 'shopeye' when app.is_vendor_member(v_vendor) then 'seller' end;
  if v_kind is null then raise exception 'FORBIDDEN: only the seller or ShopEye can answer' using errcode = '42501'; end if;
  if char_length(v_body) < 2 then raise exception 'ANSWER_REQUIRED' using errcode = 'P0001'; end if;
  if app.has_contact_details(v_body) then raise exception 'CONTACT_DETAILS_NOT_ALLOWED: answers can''t share phone numbers, emails or chat links' using errcode = 'P0001'; end if;
  insert into product_answers(question_id, answered_by, answerer_kind, body) values (p_question, v_uid, v_kind, v_body) returning id into v_id;
  begin
    perform app.enqueue_email('question_answered', q.customer_id, 'question_answered:' || v_id, 'Your question was answered', 'Your question has an answer',
      '<p>You asked: <em>' || app.esc(left(q.body, 200)) || '</em></p><p>' || case v_kind when 'seller' then 'The seller' else 'The ShopEye team' end
      || ' answered: ' || app.esc(left(v_body, 500)) || '</p>', 'View product', '/p/' || q.product_id);
  exception when others then raise warning 'ShopEye answer email not queued: %', sqlerrm;
  end;
  return v_id;
end $$;

-- One report per person per item; three reports hide it until a moderator looks
create or replace function public.report_qa(p_kind text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_uid uuid := auth.uid(); v_owner uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if (select count(*) from qa_reports where customer_id = v_uid and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'RATE_LIMITED: too many reports, try again later' using errcode = 'P0001';
  end if;
  if p_kind = 'question' then select customer_id into v_owner from product_questions where id = p_id and status = 'published';
  elsif p_kind = 'answer' then select a.answered_by into v_owner from product_answers a where a.id = p_id and a.status = 'published';
  else raise exception 'UNKNOWN_KIND'; end if;
  if v_owner is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_owner = v_uid then raise exception 'OWN_CONTENT: you can''t report your own post' using errcode = 'P0001'; end if;
  insert into qa_reports(target_kind, target_id, customer_id, reason) values (p_kind, p_id, v_uid, left(btrim(p_reason), 200)) on conflict do nothing;
  if not found then return; end if;
  if p_kind = 'question' then
    update product_questions set report_count = report_count + 1, status = case when report_count + 1 >= 3 then 'pending' else status end where id = p_id;
  else
    update product_answers set report_count = report_count + 1, status = case when report_count + 1 >= 3 then 'removed' else status end where id = p_id;
  end if;
end $$;

create or replace function public.moderate_question(p_question uuid, p_decision text, p_note text default null) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('review.moderate');
  if p_decision not in ('published','rejected','removed') then raise exception 'UNKNOWN_DECISION'; end if;
  if p_decision <> 'published' and coalesce(btrim(p_note), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  update product_questions set status = p_decision, moderation_note = nullif(btrim(p_note), ''), report_count = case when p_decision = 'published' then 0 else report_count end
   where id = p_question;
  if not found then raise exception 'NOT_FOUND'; end if;
  return p_decision;
end $$;

create or replace function public.moderate_answer(p_answer uuid, p_decision text) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('review.moderate');
  if p_decision not in ('published','removed') then raise exception 'UNKNOWN_DECISION'; end if;
  update product_answers set status = p_decision, report_count = case when p_decision = 'published' then 0 else report_count end where id = p_answer;
  if not found then raise exception 'NOT_FOUND'; end if;
  return p_decision;
end $$;

-- ---------- Account security activity (CUST-FR-178) ----------
create table public.security_events (
  id          bigint generated always as identity primary key,
  customer_id uuid not null references public.profiles(id),
  kind        text not null check (kind in ('signed_in','email_changed','email_change_requested','signed_out_other_devices','reverified','data_exported')),
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index security_events_customer_idx on public.security_events(customer_id, created_at desc);
alter table public.security_events enable row level security;
grant select on public.security_events to authenticated;
create policy security_events_own on public.security_events for select using (customer_id = auth.uid());

-- Events the browser may record about its own account (sign-in and email changes are recorded by the database itself)
create or replace function public.log_security_event(p_kind text) returns void
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_kind not in ('email_change_requested','signed_out_other_devices','reverified','data_exported') then raise exception 'UNKNOWN_KIND' using errcode = 'P0001'; end if;
  if (select count(*) from security_events where customer_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into security_events(customer_id, kind) values (v_uid, p_kind);
  if p_kind = 'signed_out_other_devices' then
    begin
      perform app.enqueue_email('security_notice', v_uid, 'security:' || v_uid || ':others:' || to_char(now(), 'YYYYMMDDHH24MI'),
        'You signed out of your other devices', 'Signed out of other devices',
        '<p>At ' || to_char(now() at time zone 'Asia/Kolkata', 'HH12:MI AM, DD Mon YYYY') || ' IST you signed out of ShopEye on all your other devices and browsers.</p>'
        || '<p style="color:#5E6682;font-size:13px">If this wasn''t you, sign in and contact us from Help. This is a security message and can''t be switched off.</p>');
    exception when others then raise warning 'ShopEye security email not queued: %', sqlerrm;
    end;
  end if;
end $$;

create or replace function app.on_auth_user_security() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare v_name text;
begin
  if not exists (select 1 from profiles where id = new.id) then return new; end if;
  if new.email is distinct from old.email and new.email is not null then
    update profiles set email = new.email where id = new.id;                    -- order and account emails follow the new address
    insert into security_events(customer_id, kind, detail) values (new.id, 'email_changed', jsonb_build_object('from', app.mask_email(old.email), 'to', app.mask_email(new.email)));
    select full_name into v_name from profiles where id = new.id;
    if old.email is not null then                                               -- tell the old address too, in case it wasn't them
      insert into app.notification_outbox(kind, customer_id, to_email, to_name, subject, html, dedupe_key)
      values ('security_notice', new.id, old.email, v_name, 'Your ShopEye email address was changed',
        app.email_shell('Your sign-in email changed', '<p>The email for your ShopEye account was changed from <strong>' || app.esc(app.mask_email(old.email))
          || '</strong> to <strong>' || app.esc(app.mask_email(new.email)) || '</strong>. Future sign-in codes and order emails go to the new address.</p>'
          || '<p style="color:#5E6682;font-size:13px">If you didn''t make this change, reply to this email or contact us from Help straight away.</p>', null, null),
        'email_changed_old:' || new.id || ':' || md5(old.email || new.email))
      on conflict (dedupe_key) do nothing;
    end if;
    perform app.enqueue_email('security_notice', new.id, 'email_changed_new:' || new.id || ':' || md5(coalesce(old.email, '') || new.email),
      'Your ShopEye email address was changed', 'Email address updated',
      '<p>This is now the email for your ShopEye account. Sign-in codes and order updates will come here.</p>');
  end if;
  if new.last_sign_in_at is distinct from old.last_sign_in_at and new.last_sign_in_at is not null then
    insert into security_events(customer_id, kind) values (new.id, 'signed_in');
  end if;
  return new;
exception when others then
  raise warning 'ShopEye security event not recorded: %', sqlerrm; return new;   -- never block sign-in
end $$;
drop trigger if exists on_auth_user_security on auth.users;
create trigger on_auth_user_security after update of email, last_sign_in_at on auth.users for each row execute function app.on_auth_user_security();

-- ---------- The live shipping rule, so the cart's free-shipping bar is always accurate (CUST-FR-063) ----------
create or replace function public.shipping_rules() returns jsonb language sql stable security definer set search_path = public, app, extensions as $$
  select jsonb_build_object('flat_fee_per_vendor', (app.setting('shipping.flat_fee_per_vendor'))::text::numeric,
                            'free_threshold_per_vendor', (app.setting('shipping.free_threshold_per_vendor'))::text::numeric)
$$;

-- ---------- Urgent help requests only for escalations we actually support (CUST-FR-140) ----------
-- Two situations jump the queue: money taken with no order, and someone else using the account. Everything else is normal priority.
alter table public.support_tickets add column if not exists priority text not null default 'normal' check (priority in ('normal','urgent')),
                                   add column if not exists urgent_reason text check (urgent_reason in ('payment_taken_no_order','account_misuse'));
drop function if exists public.create_support_ticket(text, text, text, uuid);
create or replace function public.create_support_ticket(p_category text, p_subject text, p_message text, p_order uuid default null, p_urgent text default null)
returns jsonb language plpgsql security definer set search_path = public, app, extensions as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_no text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_order is not null and not exists (select 1 from orders where id = p_order and customer_id = v_uid) then
    raise exception 'FORBIDDEN' using errcode = '42501';            -- CUST-FR-172: can't attach someone else's order
  end if;
  if p_urgent is not null and not ((p_category = 'payment' and p_urgent = 'payment_taken_no_order') or (p_category = 'account' and p_urgent = 'account_misuse')) then
    raise exception 'URGENT_NOT_SUPPORTED' using errcode = 'P0001';
  end if;
  if (select count(*) from support_tickets where customer_id = v_uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED: too many tickets, try again later' using errcode = 'P0001';   -- CUST-FR-177 spam control
  end if;
  insert into support_tickets(customer_id, category, subject, message, order_id, priority, urgent_reason)
  values (v_uid, p_category, btrim(p_subject), btrim(p_message), p_order, case when p_urgent is null then 'normal' else 'urgent' end, p_urgent)
  returning id, ticket_number into v_id, v_no;
  return jsonb_build_object('id', v_id, 'ticket_number', v_no, 'priority', case when p_urgent is null then 'normal' else 'urgent' end);
end $$;

insert into public.role_permissions(role_code, permission_code) values ('super_admin', 'ticket.handle') on conflict do nothing;
create or replace function public.update_ticket_status(p_ticket uuid, p_status text) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('ticket.handle');
  update support_tickets set status = p_status where id = p_ticket;
  if not found then raise exception 'NOT_FOUND'; end if;
  return p_status;
end $$;
revoke execute on function public.create_support_ticket(text, text, text, uuid, text), public.update_ticket_status(uuid, text) from public, anon;
grant execute on function public.create_support_ticket(text, text, text, uuid, text), public.update_ticket_status(uuid, text) to authenticated;

revoke execute on function public.ask_question(uuid, text), public.delete_my_question(uuid), public.answer_question(uuid, text), public.report_qa(text, uuid, text),
  public.moderate_question(uuid, text, text), public.moderate_answer(uuid, text), public.log_security_event(text) from public, anon;
grant execute on function public.ask_question(uuid, text), public.delete_my_question(uuid), public.answer_question(uuid, text), public.report_qa(text, uuid, text),
  public.moderate_question(uuid, text, text), public.moderate_answer(uuid, text), public.log_security_event(text) to authenticated;
grant execute on function public.shipping_rules() to anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.is_vendor_member(uuid), app.has_permission(text, uuid, uuid), app.actor_id() to anon, authenticated;
-- Browsers never write these tables directly (default privileges would otherwise grant it); anon can't even see security events
revoke all on public.security_events from anon;
revoke insert, update, delete, truncate, references, trigger on public.security_events, public.product_questions from anon, authenticated;
alter function app.has_contact_details(text) set search_path = pg_catalog;   -- advisor: pinned search paths
alter function app.mask_email(text) set search_path = pg_catalog;
