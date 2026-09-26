-- =====================================================================
set search_path = public, extensions;
-- SHOPEYE 0003 — Vendors, KYC, bank accounts, taxonomy & catalogue
-- Traces: VS-FR §3 §5 §7 §8 §20 §29, SA-FR §6..§11, OPS-FR §5 §12,
--         AF-FR-0461/0462 (bank maker-checker + versions), VS-FR-886..889
-- =====================================================================
create type public.vendor_status as enum
  ('draft','submitted','under_review','info_requested','approved','active','suspended','rejected','closed');

create table public.vendors (
  id                uuid primary key default gen_random_uuid(),
  vendor_code       text not null unique default app.next_number('vendor'),
  legal_name        text not null check (char_length(legal_name) between 2 and 200),
  display_name      text not null check (char_length(display_name) between 2 and 120),
  slug              citext not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  business_type     text not null default 'proprietorship',
  gstin             text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan_last4         text,                       -- full PAN held in encrypted vault only (AF-FR-0679)
  contact_email     citext not null,
  contact_mobile    text,
  registered_address jsonb not null default '{}'::jsonb,
  status            public.vendor_status not null default 'draft',
  settlement_cycle  text not null default 'weekly' check (settlement_cycle in ('daily','weekly','fortnightly','monthly')),
  commission_group  text,
  vendor_manager_id uuid references public.profiles(id),
  rating            numeric(3,2),
  approved_by       uuid,
  approved_at       timestamptz,
  status_reason     text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger vendors_touch  before update on public.vendors for each row execute function app.touch_updated_at();
create trigger vendors_status before update on public.vendors for each row execute function app.enforce_transition('vendor');
create trigger vendors_audit  after insert or update on public.vendors for each row execute function app.audit_row();

alter table public.user_roles add constraint user_roles_vendor_fk foreign key (vendor_id) references public.vendors(id);

insert into app.status_transitions(entity, from_status, to_status) values
  ('vendor','draft','submitted'), ('vendor','submitted','under_review'),
  ('vendor','under_review','info_requested'), ('vendor','info_requested','submitted'),
  ('vendor','under_review','approved'), ('vendor','under_review','rejected'),
  ('vendor','approved','active'), ('vendor','active','suspended'), ('vendor','suspended','active'),
  ('vendor','active','closed'), ('vendor','suspended','closed'), ('vendor','rejected','submitted');

create type public.kyc_status as enum ('pending','verified','rejected','expired');

create table public.vendor_kyc_documents (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors(id),
  doc_type      text not null check (doc_type in ('gst_certificate','pan','cancelled_cheque','address_proof','trade_license','fssai','brand_authorisation','other')),
  storage_path  text not null,                  -- private bucket path, never a public URL (CUST-FR-141)
  file_sha256   text not null,
  status        public.kyc_status not null default 'pending',
  expires_on    date,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text,
  uploaded_by   uuid,
  uploaded_at   timestamptz not null default now()
);
create trigger kyc_audit after insert or update on public.vendor_kyc_documents for each row execute function app.audit_row();

-- Bank details are versioned; a new version needs checker approval before it pays out
create type public.bank_account_status as enum ('pending_approval','active','superseded','rejected');
create table public.vendor_bank_accounts (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid not null references public.vendors(id),
  version          int not null,
  account_holder   text not null,
  ifsc             text not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  account_last4    text not null check (account_last4 ~ '^[0-9]{4}$'),
  vault_ref        text not null,               -- token/encrypted reference; full number never stored here
  penny_drop_status text not null default 'pending' check (penny_drop_status in ('pending','verified','failed')),
  status           public.bank_account_status not null default 'pending_approval',
  approval_request_id uuid references app.approval_requests(id),
  effective_from   timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  unique (vendor_id, version)
);
create unique index vendor_bank_one_active on public.vendor_bank_accounts(vendor_id) where status = 'active';
create trigger vendor_bank_audit after insert or update on public.vendor_bank_accounts for each row execute function app.audit_row();

-- ---------------------------------------------------------------------
-- Taxonomy
-- ---------------------------------------------------------------------
create table public.categories (
  id                 uuid primary key default gen_random_uuid(),
  parent_id          uuid references public.categories(id),
  name               text not null,
  slug               citext not null unique,
  level              int not null default 1 check (level between 1 and 6),
  default_hsn        text,
  default_gst_rate   numeric(5,2) check (default_gst_rate in (0,0.25,3,5,12,18,28)),
  return_window_days int check (return_window_days between 0 and 90),
  sort_order         int not null default 0,
  active             boolean not null default true
);

create table public.brands (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  slug      citext not null unique,
  status    text not null default 'active' check (status in ('pending','active','blocked')),
  requires_authorisation boolean not null default false
);

create table public.attributes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  data_type       text not null check (data_type in ('text','number','enum','boolean','color')),
  allowed_values  text[],
  is_variant_axis boolean not null default false,
  filterable      boolean not null default true
);

create table public.category_attributes (
  category_id  uuid references public.categories(id) on delete cascade,
  attribute_id uuid references public.attributes(id) on delete cascade,
  required     boolean not null default false,
  primary key (category_id, attribute_id)
);

-- ---------------------------------------------------------------------
-- Products & variants (SKU)
-- ---------------------------------------------------------------------
create type public.product_status as enum ('draft','pending_review','active','rejected','inactive','archived');

create table public.products (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid not null references public.vendors(id),
  category_id      uuid not null references public.categories(id),
  brand_id         uuid references public.brands(id),
  title            text not null check (char_length(title) between 3 and 250),
  slug             citext not null,
  description      text,
  specifications   jsonb not null default '{}'::jsonb,
  hsn_code         text,
  gst_rate         numeric(5,2) not null default 18 check (gst_rate in (0,0.25,3,5,12,18,28)),
  return_window_days int check (return_window_days between 0 and 90),
  is_returnable    boolean not null default true,
  status           public.product_status not null default 'draft',
  rejection_reason text,
  moderated_by     uuid,
  moderated_at     timestamptz,
  published_at     timestamptz,
  search_tsv       tsvector generated always as
                     (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))) stored,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (vendor_id, slug)
);
create index products_search_idx on public.products using gin(search_tsv);
create index products_listing_idx on public.products(category_id, status);
create trigger products_touch  before update on public.products for each row execute function app.touch_updated_at();
create trigger products_status before update on public.products for each row execute function app.enforce_transition('product');
create trigger products_audit  after insert or update on public.products for each row execute function app.audit_row();

insert into app.status_transitions(entity, from_status, to_status) values
  ('product','draft','pending_review'), ('product','pending_review','active'),
  ('product','pending_review','rejected'), ('product','rejected','pending_review'),   -- VS-FR-888
  ('product','active','inactive'), ('product','inactive','active'), ('product','active','pending_review'),
  ('product','inactive','archived'), ('product','draft','archived'), ('product','rejected','archived'),
  ('product','archived','draft');                                                     -- restore (VS-FR-889)

create table public.product_variants (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products(id),
  vendor_id      uuid not null references public.vendors(id),
  sku            text not null check (sku ~ '^[A-Za-z0-9._-]{2,64}$'),
  barcode        text,
  attributes     jsonb not null default '{}'::jsonb,   -- {"size":"M","color":"Maroon"}
  mrp            app.money not null check (mrp > 0),
  selling_price  app.money not null check (selling_price > 0),
  weight_grams   int check (weight_grams > 0),
  max_qty_per_order int not null default 10 check (max_qty_per_order between 1 and 999),
  track_batch    boolean not null default false,
  track_serial   boolean not null default false,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (vendor_id, sku),
  check (selling_price <= mrp)
);
create trigger variants_touch before update on public.product_variants for each row execute function app.touch_updated_at();
create trigger variants_audit after update on public.product_variants for each row execute function app.audit_row();

-- vendor_id on variant must match product's vendor
create or replace function app.variant_vendor_matches() returns trigger language plpgsql as $$
begin
  if new.vendor_id <> (select vendor_id from public.products where id = new.product_id) then
    raise exception 'VARIANT_VENDOR_MISMATCH';
  end if;
  return new;
end $$;
create trigger variants_vendor_check before insert or update on public.product_variants
  for each row execute function app.variant_vendor_matches();

create table public.product_media (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  variant_id  uuid references public.product_variants(id) on delete cascade,
  url         text not null,
  alt_text    text not null default '',
  media_type  text not null default 'image' check (media_type in ('image','video')),
  sort_order  int not null default 0
);

-- Public read model: only active products from active vendors
create view public.catalog_variants with (security_invoker = true) as
select v.id as variant_id, v.sku, v.attributes, v.mrp, v.selling_price, v.max_qty_per_order,
       p.id as product_id, p.title, p.slug, p.category_id, p.brand_id, p.gst_rate,
       p.vendor_id, ve.display_name as vendor_name,
       round(100 * (v.mrp - v.selling_price) / v.mrp)::int as discount_pct
from public.product_variants v
join public.products p on p.id = v.product_id and p.status = 'active'
join public.vendors ve on ve.id = p.vendor_id and ve.status = 'active'
where v.active;
