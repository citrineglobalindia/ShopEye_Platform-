-- SHOPEYE 0027 — Scheduler for ShopEye balance (Supabase-only: pg_cron).
-- Traces: CUST-FR-078 (expired balance leaves the account on time)
select cron.schedule('shopeye-release-stale-balances', '*/10 * * * *', $$select app.release_stale_balances()$$);
select cron.schedule('shopeye-expire-balances', '17 * * * *', $$select app.expire_wallet_lots()$$);
