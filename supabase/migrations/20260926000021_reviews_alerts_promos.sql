-- SHOPEYE 0021 — Ratings & reviews, back-in-stock / price-drop alerts, dated promo banners.
-- Traces: CUST-FR-026 CUST-FR-049 CUST-FR-052 CUST-FR-053 CUST-FR-128 CUST-FR-129 CUST-FR-130 CUST-FR-131 CUST-FR-133
set search_path = public, extensions;

insert into public.permissions(code, portal, description, sensitive)
values ('review.moderate', 'super_admin', 'Approve, reject or hide customer reviews', false) on conflict (code) do nothing;
insert into public.role_permissions(role_code, permission_code) values ('super_admin', 'review.moderate'), ('catalog_moderator', 'review.moderate') on conflict do nothing;

-- ---------- Reviews ----------
create table public.product_reviews (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products(id),
  customer_id    uuid not null references public.profiles(id),
  order_item_id  uuid not null references public.order_items(id),     -- the delivered purchase that makes it verified (CUST-FR-128)
  rating         smallint not null check (rating between 1 and 5),
  title          text check (char_length(btrim(title)) <= 100),
  body           text check (char_length(btrim(body)) <= 2000),
  status         text not null default 'pending' check (status in ('pending','published','rejected','removed')),
  moderation_note text,
  helpful_count  int not null default 0,
  report_count   int not null default 0,
  author_name    text not null,                                        -- first name + initial only; no contact details
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (customer_id, product_id)
);
create index product_reviews_product_idx on public.product_reviews(product_id, status, created_at desc);
alter table public.product_reviews enable row level security;
grant select on public.product_reviews to anon, authenticated;
create policy reviews_read on public.product_reviews for select
  using (status = 'published' or customer_id = auth.uid() or app.has_permission('review.moderate'));
create trigger product_reviews_touch before update on public.product_reviews for each row execute function app.touch_updated_at();
create trigger product_reviews_audit after insert or update on public.product_reviews for each row execute function app.audit_row();

create table public.review_votes (
  review_id   uuid not null references public.product_reviews(id) on delete cascade,
  customer_id uuid not null references public.profiles(id),
  kind        text not null check (kind in ('helpful','report')),
  reason      text check (char_length(reason) <= 200),
  created_at  timestamptz not null default now(),
  primary key (review_id, customer_id, kind)
);
alter table public.review_votes enable row level security;
revoke all on public.review_votes from anon, authenticated;

-- Aggregates on the product, recomputed from published reviews only (CUST-FR-133)
alter table public.products add column if not exists rating_avg numeric(3,2), add column if not exists rating_count int not null default 0;
create or replace function app.refresh_product_rating(p uuid) returns void language sql security definer set search_path = public, app, extensions as $$
  update products set rating_avg = s.avg, rating_count = s.n
    from (select round(avg(rating)::numeric, 2) avg, count(*)::int n from product_reviews where product_id = p and status = 'published') s
   where id = p
$$;
create or replace function app.review_changed() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
begin
  perform app.refresh_product_rating(coalesce(new.product_id, old.product_id));
  return null;
end $$;
create trigger product_reviews_rating after insert or update of status, rating or delete on public.product_reviews for each row execute function app.review_changed();

-- Write or edit a review: only for a delivered item the customer bought (CUST-FR-128/129)
create or replace function public.submit_review(p_product uuid, p_rating int, p_title text default null, p_body text default null)
returns jsonb language plpgsql security definer set search_path = public, app, extensions as $$
declare v_uid uuid := auth.uid(); v_item uuid; v_name text; r product_reviews;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select oi.id into v_item from order_items oi join orders o on o.id = oi.order_id join sub_orders so on so.id = oi.sub_order_id
   join product_variants v on v.id = oi.variant_id
   where o.customer_id = v_uid and v.product_id = p_product and so.status in ('delivered','completed') and oi.qty > oi.cancelled_qty
   order by so.delivered_at desc nulls last limit 1;
  if v_item is null then raise exception 'REVIEW_NOT_ELIGIBLE: only delivered purchases can be reviewed' using errcode = 'P0001'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'RATING_REQUIRED' using errcode = 'P0001'; end if;
  select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'ShopEye customer')
      || coalesce(' ' || nullif(left(split_part(btrim(full_name), ' ', 2), 1), '') || '.', '') into v_name from profiles where id = v_uid;
  insert into product_reviews(product_id, customer_id, order_item_id, rating, title, body, author_name)
  values (p_product, v_uid, v_item, p_rating, nullif(btrim(p_title), ''), nullif(btrim(p_body), ''), v_name)
  on conflict (customer_id, product_id) do update
    set rating = excluded.rating, title = excluded.title, body = excluded.body, status = 'pending', moderation_note = null   -- edits go back to moderation
  returning * into r;
  return jsonb_build_object('id', r.id, 'status', r.status);
end $$;

create or replace function public.delete_my_review(p_review uuid) returns void language plpgsql security definer set search_path = public, app, extensions as $$
begin
  delete from product_reviews where id = p_review and customer_id = auth.uid();
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
end $$;

-- Helpful votes and reports: one each per person, not on your own review, rate-limited (CUST-FR-131)
create or replace function public.vote_review(p_review uuid, p_kind text, p_reason text default null) returns int
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_uid uuid := auth.uid(); r product_reviews;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select * into r from product_reviews where id = p_review and status = 'published';
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if r.customer_id = v_uid then raise exception 'OWN_REVIEW: you can''t vote on your own review' using errcode = 'P0001'; end if;
  if (select count(*) from review_votes where customer_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'RATE_LIMITED: too many votes, try again later' using errcode = 'P0001';
  end if;
  insert into review_votes(review_id, customer_id, kind, reason) values (p_review, v_uid, p_kind, left(p_reason, 200)) on conflict do nothing;
  if found then
    if p_kind = 'helpful' then update product_reviews set helpful_count = helpful_count + 1 where id = p_review;
    else update product_reviews set report_count = report_count + 1,
           status = case when report_count + 1 >= 3 then 'pending' else status end   -- 3 reports hide it until a moderator looks
         where id = p_review; end if;
  end if;
  return (select case when p_kind = 'helpful' then helpful_count else report_count end from product_reviews where id = p_review);
end $$;

create or replace function public.moderate_review(p_review uuid, p_decision text, p_note text default null) returns text
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  perform app.require_permission('review.moderate');
  if p_decision not in ('published','rejected','removed') then raise exception 'UNKNOWN_DECISION'; end if;
  if p_decision <> 'published' and coalesce(btrim(p_note), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  update product_reviews set status = p_decision, moderation_note = nullif(btrim(p_note), '') where id = p_review;
  if not found then raise exception 'NOT_FOUND'; end if;
  return p_decision;
end $$;

-- ---------- Back-in-stock and price-drop alerts (CUST-FR-052/053) ----------
create table public.product_alerts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.profiles(id),
  variant_id   uuid not null references public.product_variants(id),
  kind         text not null check (kind in ('back_in_stock','price_drop')),
  channel      text not null default 'email' check (channel in ('email')),
  price_at_signup app.money,
  active       boolean not null default true,
  fired_at     timestamptz,
  created_at   timestamptz not null default now(),
  unique (customer_id, variant_id, kind)
);
alter table public.product_alerts enable row level security;
grant select, delete on public.product_alerts to authenticated;
grant update (active) on public.product_alerts to authenticated;
create policy alerts_own on public.product_alerts for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());

create or replace function public.set_product_alert(p_variant uuid, p_kind text, p_on boolean) returns boolean
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_uid uuid := auth.uid(); v_price numeric;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select pv.selling_price into v_price from product_variants pv join products p on p.id = pv.product_id where pv.id = p_variant and pv.active and p.status = 'active';
  if v_price is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_on then
    insert into product_alerts(customer_id, variant_id, kind, price_at_signup) values (v_uid, p_variant, p_kind, v_price)
    on conflict (customer_id, variant_id, kind) do update set active = true, fired_at = null, price_at_signup = excluded.price_at_signup;
  else
    update product_alerts set active = false where customer_id = v_uid and variant_id = p_variant and kind = p_kind;
  end if;
  return p_on;
end $$;

create or replace function app.variant_title(p_variant uuid) returns text language sql stable set search_path = public, app, extensions as $$
  select p.title || coalesce(' (' || (select string_agg(value, ' / ') from jsonb_each_text(v.attributes)) || ')', '')
    from product_variants v join products p on p.id = v.product_id where v.id = p_variant
$$;

-- Fire back-in-stock when a variant goes from 0 to available
create or replace function app.alert_back_in_stock() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare total int; before int; a record; pid uuid;
begin
  select coalesce(sum(available), 0) into total from stock_balances where variant_id = new.variant_id;
  before := total - (new.available - coalesce(old.available, 0));
  if before <= 0 and total > 0 then
    select product_id into pid from product_variants where id = new.variant_id;
    for a in select * from product_alerts where variant_id = new.variant_id and kind = 'back_in_stock' and active loop
      perform app.enqueue_email('back_in_stock', a.customer_id, 'back_in_stock:' || a.id || ':' || to_char(now(), 'YYYYMMDDHH24'),
        'Back in stock: ' || app.variant_title(new.variant_id), 'It’s back in stock',
        '<p><strong>' || app.esc(app.variant_title(new.variant_id)) || '</strong> is available again. Stock can go quickly.</p>'
        || '<p style="color:#5E6682;font-size:13px">You asked us to tell you. This alert is now switched off; you can manage alerts in My account.</p>',
        'View product', '/p/' || pid);
      update product_alerts set active = false, fired_at = now() where id = a.id;
    end loop;
  end if;
  return new;
exception when others then
  raise warning 'ShopEye stock alert not queued: %', sqlerrm; return new;
end $$;
create trigger stock_balances_alert after insert or update of on_hand, reserved on public.stock_balances for each row execute function app.alert_back_in_stock();

-- Fire price-drop when the price falls below the price at sign-up; only for customers with an email channel
create or replace function app.alert_price_drop() returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare a record;
begin
  if new.selling_price >= old.selling_price then return new; end if;
  for a in select * from product_alerts where variant_id = new.id and kind = 'price_drop' and active and new.selling_price < price_at_signup loop
    perform app.enqueue_email('price_drop', a.customer_id, 'price_drop:' || a.id || ':' || new.selling_price,
      'Price drop: ' || app.variant_title(new.id), 'The price dropped',
      '<p><strong>' || app.esc(app.variant_title(new.id)) || '</strong> is now <strong>₹' || to_char(new.selling_price, 'FM99,99,99,990.00')
      || '</strong> (was ₹' || to_char(a.price_at_signup, 'FM99,99,99,990.00') || ' when you asked us to watch it).</p>'
      || '<p style="color:#5E6682;font-size:13px">This alert is now switched off. Manage alerts in My account.</p>',
      'View product', '/p/' || new.product_id);
    update product_alerts set active = false, fired_at = now() where id = a.id;
  end loop;
  return new;
exception when others then
  raise warning 'ShopEye price alert not queued: %', sqlerrm; return new;
end $$;
create trigger product_variants_price_alert after update of selling_price on public.product_variants for each row execute function app.alert_price_drop();

-- ---------- Promotional banners with validity (CUST-FR-026) ----------
create table public.promo_banners (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 3 and 80),
  subtitle   text check (char_length(subtitle) <= 160),
  link_path  text check (link_path ~ '^/[A-Za-z0-9/_?=&%.-]*$'),     -- internal links only
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  sort_order int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.promo_banners enable row level security;
grant select on public.promo_banners to anon, authenticated;
create policy promos_live on public.promo_banners for select using ((active and now() >= starts_at and now() < ends_at) or app.has_permission('catalog.product.moderate'));
create trigger promo_banners_audit after insert or update or delete on public.promo_banners for each row execute function app.audit_row();

revoke execute on function public.submit_review(uuid, int, text, text), public.delete_my_review(uuid), public.vote_review(uuid, text, text),
  public.moderate_review(uuid, text, text), public.set_product_alert(uuid, text, boolean) from public, anon;
grant execute on function public.submit_review(uuid, int, text, text), public.delete_my_review(uuid), public.vote_review(uuid, text, text),
  public.moderate_review(uuid, text, text), public.set_product_alert(uuid, text, boolean) to authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.is_vendor_member(uuid), app.has_permission(text, uuid, uuid), app.actor_id() to anon, authenticated;
