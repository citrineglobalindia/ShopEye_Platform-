# Shopeye — Multi-Vendor Marketplace

Phase 0 deliverable: the shared transactional core that all eight portals sit on, built directly from the six Shopeye SRS documents (4,392 traceable requirements) and validated against PostgreSQL 16 with 98 passing assertions plus a concurrency race test.

## Scope of the SRS set

| SRS document | Prefix | Requirements | Portal |
|---|---|---|---|
| Customer Website v1.0 | CUST-FR | 188 | Storefront |
| Vendor & Vendor Staff v1.0 | VS-FR | 1,080 | Vendor portal |
| Super Admin v3.0 | SA-FR | 794 | Admin console |
| Accounts & Finance v1.0 | AF-FR | 722 | Finance console |
| Stock Manager v1.0 | SM-FR | 641 | Warehouse console |
| QC, Vendor Manager & Help Desk v1.0 | OPS-FR | 967 | Ops console |
| **Total** | | **4,392** | |

`docs/traceability-matrix.csv` lists every ID with its portal, SRS section, an extract of the requirement text, the delivery phase it belongs to, and its current status. Regenerate it with `python3 scripts/build_traceability.py <folder-of-pdftotext-output>`.

## Architecture

```
Browser (storefront, SEO)        Browser (internal portals)
  Next.js on Vercel                 Next.js "console" on Vercel, role-gated modules:
  apps/storefront                   vendor · super_admin · accounts · stock · qc · vendor_manager · help_desk
        │  anon/authenticated JWT          │  staff JWT (MFA enforced)
        ▼                                   ▼
  Supabase: Auth (OTP, TOTP MFA) · PostgREST with RLS · Storage (private buckets) · Edge Functions
        │
        ▼
  PostgreSQL — this repository
   public.*   catalogue, carts, orders, inventory (RLS-protected, customer & vendor readable)
   finance.*  GL, ledgers, commission, settlements (never exposed to browsers)
   app.*      audit, approvals, idempotency, number series, settings (internal)
        ▲
  Razorpay (payments + Route/payouts) · courier aggregator · SMS/WhatsApp/email  → via Edge Function webhooks
```

The storefront is Next.js rather than a Vite SPA because CUST-FR-179..184 require server-rendered, indexable product and category pages. All staff portals share one console app so authentication, MFA, audit context and the permission model are implemented once.

Money-moving and stock-moving logic lives in the database as transactional functions, so the same rule holds whether it's triggered from a portal, a webhook, or a background job (AF-FR-0699).

## What Phase 0 delivers

| Migration | Contents |
|---|---|
| `…01_foundation` | Append-only audit log with before/after and masking; idempotency registry; gapless document number series; server-enforced status transitions; accounting periods with close protection; maker-checker approval engine with segregation of duties; effective-dated settings |
| `…02_identity_rbac` | Profiles on Supabase Auth; 18 roles and 29 permissions from the SRS set; vendor- and warehouse-scoped role assignments |
| `…03_vendors_catalog` | Vendor onboarding state machine, KYC documents, versioned bank accounts (masked, vault reference), categories, brands, attributes, products with moderation workflow, SKUs |
| `…04_inventory` | Warehouses and bins; stock buckets (on-hand, reserved, hold, damaged, quarantine, expired, pending putaway, in-transit); immutable stock ledger; locked posting function; checkout reservations with expiry |
| `…05_commerce` | Addresses, serviceability, guest-mergeable carts, coupons, master order → vendor sub-orders → line items with snapshots, payments, webhook events, shipments, refunds, cancellations, returns |
| `…06_finance` | Chart of accounts, balanced double-entry journals with reversal, vendor and customer ledgers, effective-dated commission rules, order/refund postings, settlement batches, holds, payout execution |
| `…07_checkout_payments` | Server-priced idempotent `place_order`, payment webhook processing, carrier event processing |
| `…08_rls_grants` | Row-level security and grants for anon, customer and vendor roles; finance schema closed to browsers |

## Validation evidence

`docs/test-evidence.log` is the output of `scripts/test_local.sh` on a fresh database. Highlights:

- **Checkout:** totals recomputed server-side; coupon allocation sums exactly; double-click Place Order returns the same order (UAT-012).
- **Payments:** replayed and duplicate capture webhooks post once (UAT-25); amount mismatch is flagged; bad signatures are ignored.
- **Refunds:** pro-rata partial cancellation refund; refunds cannot exceed the refundable balance; a maker cannot approve their own refund (UAT-23); failed refunds retry safely (UAT-07).
- **Books:** every journal balances; posted records are immutable; closed periods reject postings (UAT-22); reversals preserve originals (UAT-30); the trial balance ties out.
- **Settlements:** only delivered sub-orders past their return window are paid; holds are withheld; maker-checker is enforced; one failed line retries alone and duplicate payout callbacks don't pay twice (UAT-09/10/11).
- **Security:** customers can't read or act on other customers' orders by ID (UAT-021); vendors can't see each other's sub-orders or self-publish products.
- **Concurrency:** 10 simultaneous checkouts for the last unit produce exactly 1 order and 9 clean rejections, with no negative stock. Stable across repeated runs.

## Run it

```bash
# local (needs PostgreSQL 16 and a superuser role)
URL=postgresql://user:pass@localhost ./scripts/test_local.sh

# Supabase: apply migrations only (skip supabase/tests/00_supabase_shim.sql — Supabase already provides auth)
supabase link --project-ref <ref>
supabase db push
```

After pushing, enable `pg_cron` and schedule `select app.expire_reservations();` every minute, and create one accounting period row for the current month.

## Delivery plan

| Phase | Scope | Requirements |
|---|---|---|
| P0 Foundation | Data core, controls, auth/RBAC, audit (this delivery) | 804 |
| P1 Marketplace MVP | Storefront P0 journeys, vendor onboarding/catalogue/orders, admin moderation, Razorpay live | 918 |
| P2 Fulfilment & Ops | Courier integration, returns/QC, Stock Manager, Help Desk | 1,574 |
| P3 Finance | Reconciliation, invoices/credit notes, GST/TDS/TCS, payouts via Razorpay Route, period close | 717 |
| P4 Growth & Control | Vendor Manager, reviews, promotions, reports, bulk import/export, integrations | 379 |

Phase assignment in the matrix is automated from section titles; expect to move some items when we plan each sprint.

## Assumptions made (confirm or correct)

1. Prices are GST-inclusive; tax is back-calculated per line.
2. Shipping charged to customers is platform revenue (platform-managed logistics); vendors don't receive it.
3. Commission is calculated on the discounted line total by default; rules can switch to taxable value or MRP.
4. COD revenue is recognised at order confirmation; AF §8 COD remittance reconciliation will adjust it in P3.
5. Vendors ship from their own warehouses; the Stock Manager SRS suggests platform warehouses too, and the schema supports both.
