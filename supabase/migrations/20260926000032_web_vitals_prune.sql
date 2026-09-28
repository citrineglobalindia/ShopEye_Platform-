-- SHOPEYE 0032 — keep 90 days of page-speed measurements (Supabase-only: pg_cron). Traces: CUST-FR-153
select cron.schedule('shopeye-prune-web-vitals', '40 3 * * *', $$select app.prune_web_vitals()$$);
