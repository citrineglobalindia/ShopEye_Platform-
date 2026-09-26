-- =====================================================================
set search_path = public, extensions;
-- SHOPEYE 0002 — Identity, portals, RBAC with data scope
-- Traces: CUST-FR-007..024, SA-FR-007..037 & §31, AF-FR-0570..0589,
--         VS-FR §6/§40, SM-FR §31, OPS-FR §34 (roles & segregation of duties)
-- Authentication (password, OTP, MFA/TOTP, sessions) is delegated to
-- Supabase Auth; this layer holds profile, status and authorisation.
-- =====================================================================
create type public.portal as enum
  ('customer','vendor','super_admin','accounts','stock','qc','vendor_manager','help_desk');

create type public.account_status as enum ('unverified','active','locked','suspended','closed');

create table public.profiles (
  id                uuid primary key references auth.users(id) on delete restrict,
  full_name         text not null check (char_length(btrim(full_name)) between 2 and 100),
  email             citext,
  mobile            text check (mobile is null or mobile ~ '^\+[1-9][0-9]{7,14}$'),
  status            public.account_status not null default 'active',
  preferred_language text not null default 'en',
  marketing_consent boolean not null default false,
  terms_version     text,
  privacy_version   text,
  consent_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (email is not null or mobile is not null)            -- CUST §4.2: at least one identifier
);
create unique index profiles_email_uq  on public.profiles(email)  where email  is not null and status <> 'closed';
create unique index profiles_mobile_uq on public.profiles(mobile) where mobile is not null and status <> 'closed';
create trigger profiles_touch before update on public.profiles for each row execute function app.touch_updated_at();

create table public.roles (
  code        text primary key,
  portal      public.portal not null,
  name        text not null,
  is_system   boolean not null default true
);

create table public.permissions (
  code        text primary key,
  portal      public.portal not null,
  description text not null,
  sensitive   boolean not null default false   -- requires step-up auth (AF-FR-0016, AF-FR-0690)
);

create table public.role_permissions (
  role_code        text references public.roles(code) on delete cascade,
  permission_code  text references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

-- A user may hold several roles; each assignment can be scoped (AF-FR-0572/0573, SM warehouse scope)
create table public.user_roles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id),
  role_code     text not null references public.roles(code),
  vendor_id     uuid,         -- set for vendor_owner / vendor_staff and scoped vendor managers
  warehouse_id  uuid,         -- set for scoped stock staff
  active        boolean not null default true,
  granted_by    uuid,
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
create unique index user_roles_uq on public.user_roles
  (user_id, role_code, coalesce(vendor_id,'00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(warehouse_id,'00000000-0000-0000-0000-000000000000'::uuid)) where active;
create trigger user_roles_audit after insert or update or delete on public.user_roles
  for each row execute function app.audit_row();                          -- AF-FR-0589

create or replace function app.has_role(p_user uuid, p_role text) returns boolean
language sql stable security definer set search_path = public, app, extensions as $$
  select exists (select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
                  where ur.user_id = p_user and ur.role_code = p_role and ur.active and p.status = 'active')
$$;

create or replace function app.has_permission(p_perm text, p_vendor uuid default null, p_user uuid default null)
returns boolean language sql stable security definer set search_path = public, app, extensions as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id and p.status = 'active'
    join public.role_permissions rp on rp.role_code = ur.role_code
    where ur.user_id = coalesce(p_user, app.actor_id()) and ur.active and rp.permission_code = p_perm
      and (p_vendor is null or ur.vendor_id is null or ur.vendor_id = p_vendor))
$$;

create or replace function app.require_permission(p_perm text, p_vendor uuid default null)
returns void language plpgsql stable as $$
begin
  if not app.has_permission(p_perm, p_vendor) then
    raise exception 'FORBIDDEN: missing permission %', p_perm using errcode = '42501';
  end if;
end $$;

-- Vendor membership used by RLS
create or replace function app.is_vendor_member(p_vendor uuid) returns boolean
language sql stable security definer set search_path = public, app, extensions as $$
  select exists (select 1 from public.user_roles
                  where user_id = auth.uid() and active and vendor_id = p_vendor
                    and role_code in ('vendor_owner','vendor_staff'))
$$;

-- ---------------------------------------------------------------------
-- Seed: roles named across the six SRS documents
-- ---------------------------------------------------------------------
insert into public.roles(code, portal, name) values
  ('customer',            'customer',       'Customer'),
  ('vendor_owner',        'vendor',         'Vendor Owner'),
  ('vendor_staff',        'vendor',         'Vendor Staff'),
  ('super_admin',         'super_admin',    'Super Admin'),
  ('catalog_moderator',   'super_admin',    'Catalogue Moderator'),
  ('accounts_head',       'accounts',       'Accounts / Finance Head'),
  ('accounts_manager',    'accounts',       'Accounts Manager'),
  ('accountant',          'accounts',       'Accountant'),
  ('reconciliation_staff','accounts',       'Reconciliation Staff'),
  ('refund_staff',        'accounts',       'Refund Staff'),
  ('auditor',             'accounts',       'Auditor (read-only)'),
  ('stock_manager',       'stock',          'Stock Manager'),
  ('warehouse_staff',     'stock',          'Warehouse Staff'),
  ('qc_executive',        'qc',             'QC Executive'),
  ('qc_lead',             'qc',             'QC Lead'),
  ('vendor_manager',      'vendor_manager', 'Vendor Manager'),
  ('help_desk_agent',     'help_desk',      'Help Desk Agent'),
  ('help_desk_lead',      'help_desk',      'Help Desk Lead');

insert into public.permissions(code, portal, description, sensitive) values
  ('catalog.product.manage',     'vendor',        'Create/edit own products and variants', false),
  ('catalog.product.moderate',   'super_admin',   'Approve/reject product listings', false),
  ('vendor.approve',             'super_admin',   'Approve/suspend vendors', true),
  ('vendor.kyc.review',          'super_admin',   'Review vendor KYC documents', true),
  ('order.view.own_vendor',      'vendor',        'View vendor sub-orders', false),
  ('order.fulfil',               'vendor',        'Pack/ship vendor sub-orders', false),
  ('order.view.all',             'super_admin',   'View all orders', false),
  ('stock.view',                 'stock',         'View stock balances and ledger', false),
  ('stock.move',                 'stock',         'Post GRN/putaway/pick/transfer movements', false),
  ('stock.adjust.prepare',       'stock',         'Prepare stock adjustments', false),
  ('stock.adjust.approve',       'stock',         'Approve stock adjustments', true),
  ('refund.prepare',             'accounts',      'Prepare refunds', false),
  ('refund.approve',             'accounts',      'Approve refunds', true),
  ('payout.prepare',             'accounts',      'Prepare settlement batches', false),
  ('payout.approve',             'accounts',      'Approve settlement batches', true),
  ('payout.execute',             'accounts',      'Execute payouts', true),
  ('journal.prepare',            'accounts',      'Prepare manual journals', false),
  ('journal.approve',            'accounts',      'Approve manual journals', true),
  ('period.close',               'accounts',      'Close/reopen accounting periods', true),
  ('finance.view',               'accounts',      'View finance data', false),
  ('finance.export.sensitive',   'accounts',      'Export sensitive finance data', true),
  ('bank.view_sensitive',        'accounts',      'View unmasked bank details', true),
  ('qc.inspect',                 'qc',            'Perform QC inspections', false),
  ('qc.override',                'qc',            'Override QC outcome', true),
  ('ticket.handle',              'help_desk',     'Handle support tickets', false),
  ('ticket.escalate',            'help_desk',     'Escalate / reassign tickets', false),
  ('vendor.portfolio.manage',    'vendor_manager','Manage assigned vendor portfolio', false),
  ('admin.users.manage',         'super_admin',   'Manage admin users and roles', true),
  ('audit.view',                 'super_admin',   'View audit logs', true);

insert into public.role_permissions(role_code, permission_code)
select 'super_admin', code from public.permissions where portal = 'super_admin'
union all select 'catalog_moderator', 'catalog.product.moderate'
union all select 'vendor_owner', p from unnest(array['catalog.product.manage','order.view.own_vendor','order.fulfil']) p
union all select 'vendor_staff', p from unnest(array['order.view.own_vendor','order.fulfil']) p
union all select 'accounts_head', code from public.permissions where portal = 'accounts'
union all select 'accounts_manager', p from unnest(array['finance.view','refund.prepare','refund.approve','payout.prepare','payout.approve','journal.prepare','journal.approve']) p
union all select 'accountant', p from unnest(array['finance.view','refund.prepare','payout.prepare','journal.prepare']) p
union all select 'reconciliation_staff', 'finance.view'            -- no payout execution (AF-FR-0585)
union all select 'refund_staff', p from unnest(array['finance.view','refund.prepare']) p   -- prepare, not approve (AF-FR-0586)
union all select 'auditor', p from unnest(array['finance.view','audit.view']) p            -- read-only (AF-FR-0584)
union all select 'stock_manager', code from public.permissions where portal = 'stock'
union all select 'warehouse_staff', p from unnest(array['stock.view','stock.move','stock.adjust.prepare']) p
union all select 'qc_executive', 'qc.inspect'
union all select 'qc_lead', p from unnest(array['qc.inspect','qc.override']) p
union all select 'vendor_manager', 'vendor.portfolio.manage'
union all select 'help_desk_agent', 'ticket.handle'
union all select 'help_desk_lead', p from unnest(array['ticket.handle','ticket.escalate']) p;
