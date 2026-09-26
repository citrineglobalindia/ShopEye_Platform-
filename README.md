# Shopeye — multi-vendor marketplace

Next.js 15 storefront + seller hub + admin console on Supabase (Postgres, Auth, RLS).
Database design, SRS traceability and test evidence: see `docs/`.

| Path | What it is |
|---|---|
| `app/`, `components/`, `lib/` | Web app (storefront `/`, seller hub `/seller`, admin `/admin`) |
| `supabase/migrations/` | 13 migrations, already applied to project `byaaaesufrneivzcsxtv` |
| `supabase/tests/` | 121-assertion UAT suite + concurrency race test (`scripts/test_local.sh`) |
| `docs/traceability-matrix.csv` | All 4,392 SRS requirement IDs with phase and status |

## Deploy (Vercel)
Import this repository in Vercel (framework: Next.js, root: `/`). Every push to `main` redeploys.

Environment variables (Project → Settings → Environment Variables):

| Name | Needed for | Where to get it |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Online payments | Supabase → Project Settings → API keys (secret) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Online payments | Razorpay Dashboard → API Keys (test keys work) |
| `RAZORPAY_WEBHOOK_SECRET` | Payment confirmation | Razorpay → Webhooks → add `https://<your-domain>/api/payments/webhook`, events `payment.captured`, `payment.failed` |

Browsing, sign-in, seller onboarding, listing, moderation and cash-on-delivery orders work without any of these.

## Supabase settings
- Authentication → URL Configuration: Site URL = your Vercel URL; add `https://<your-domain>/auth/callback` to Redirect URLs.
- Authentication → SMTP: connect Resend (or similar) so login emails reach real customers.

## Local
```bash
npm install && npm run dev            # http://localhost:3000, uses the live Supabase project
./scripts/test_local.sh               # database test suite (needs local PostgreSQL 16)
```
