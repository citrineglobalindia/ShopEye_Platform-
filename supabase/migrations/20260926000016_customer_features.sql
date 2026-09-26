-- SHOPEYE 0016 — Customer website: wishlist, communication preferences, support
-- tickets, return cancellation. Traces: CUST §10 §21 §24 §25, CUST-FR-177
set search_path = public, extensions;

-- Wishlist (CUST §10): per product, owner-only
create table public.wishlist_items (
  customer_id uuid not null references public.profiles(id),
  product_id  uuid not null references public.products(id),
  added_at    timestamptz not null default now(),
  primary key (customer_id, product_id)
);
alter table public.wishlist_items enable row level security;
grant select, insert, delete on public.wishlist_items to authenticated;
create policy wishlist_own on public.wishlist_items for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());

-- Communication preferences (CUST-FR-134/135/136): marketing is opt-in and separate;
-- order, payment, refund and security messages are always sent and are not stored as choices
create table public.customer_preferences (
  customer_id     uuid primary key references public.profiles(id),
  marketing_email boolean not null default false,
  marketing_sms   boolean not null default false,
  marketing_whatsapp boolean not null default false,
  updated_at      timestamptz not null default now()
);
alter table public.customer_preferences enable row level security;
grant select, insert, update on public.customer_preferences to authenticated;
create policy prefs_own on public.customer_preferences for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create trigger customer_preferences_touch before update on public.customer_preferences for each row execute function app.touch_updated_at();
create trigger customer_preferences_audit after insert or update on public.customer_preferences for each row execute function app.audit_row();

-- Support tickets (CUST §25)
create table public.support_tickets (
  id            uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default app.next_number('ticket'),
  customer_id   uuid not null references public.profiles(id),
  category      text not null check (category in ('order','payment','return','refund','account','other')),
  order_id      uuid references public.orders(id),
  subject       text not null check (char_length(btrim(subject)) between 5 and 150),
  message       text not null check (char_length(btrim(message)) between 10 and 2000),
  status        text not null default 'open' check (status in ('open','in_progress','awaiting_customer','resolved','closed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index support_tickets_customer_idx on public.support_tickets(customer_id, created_at desc);
alter table public.support_tickets enable row level security;
grant select on public.support_tickets to authenticated;
create policy tickets_own_read on public.support_tickets for select using (customer_id = auth.uid() or app.has_permission('ticket.handle'));
create trigger support_tickets_touch before update on public.support_tickets for each row execute function app.touch_updated_at();
create trigger support_tickets_audit after insert or update on public.support_tickets for each row execute function app.audit_row();

create or replace function public.create_support_ticket(p_category text, p_subject text, p_message text, p_order uuid default null)
returns jsonb language plpgsql security definer set search_path = public, app, extensions as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_no text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_order is not null and not exists (select 1 from orders where id = p_order and customer_id = v_uid) then
    raise exception 'FORBIDDEN' using errcode = '42501';            -- CUST-FR-172: can't attach someone else's order
  end if;
  if (select count(*) from support_tickets where customer_id = v_uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'RATE_LIMITED: too many tickets, try again later' using errcode = 'P0001';   -- CUST-FR-177 spam control
  end if;
  insert into support_tickets(customer_id, category, subject, message, order_id)
  values (v_uid, p_category, btrim(p_subject), btrim(p_message), p_order) returning id, ticket_number into v_id, v_no;
  return jsonb_build_object('id', v_id, 'ticket_number', v_no);
end $$;

-- Cancel a return while policy allows (CUST-FR-120)
create or replace function public.cancel_return(p_return uuid)
returns text language plpgsql security definer set search_path = public, app, extensions as $$
declare r returns; o_customer uuid;
begin
  select * into r from returns where id = p_return for update;
  select o.customer_id into o_customer from order_items oi join orders o on o.id = oi.order_id where oi.id = r.order_item_id;
  if r.id is null or o_customer is distinct from auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if r.status not in ('requested','under_review','approved','pickup_scheduled') then
    raise exception 'RETURN_NOT_CANCELLABLE: return is %', r.status using errcode = 'P0001';
  end if;
  update returns set status = 'cancelled' where id = r.id;
  update order_items set return_requested_qty = return_requested_qty - r.qty where id = r.order_item_id;
  return 'cancelled';
end $$;

revoke execute on function public.create_support_ticket(text, text, text, uuid), public.cancel_return(uuid) from public, anon;
grant execute on function public.create_support_ticket(text, text, text, uuid), public.cancel_return(uuid) to authenticated;
