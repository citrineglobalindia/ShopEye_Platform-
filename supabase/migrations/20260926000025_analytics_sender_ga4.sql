-- SHOPEYE 0025 — Send queued GA4 purchase events via the Measurement Protocol (Supabase-only: pg_net, Vault, pg_cron).
-- Needs two Vault secrets added by the owner: 'ga_measurement_id' (G-XXXXXXX) and 'ga_api_secret'. Until then events stay queued.
-- Traces: CUST-FR-186
create or replace function app.send_analytics_batch() returns jsonb
language plpgsql security definer set search_path = public, app, extensions, net as $$
declare mid text; sec text; r record; v_req bigint; n int := 0;
begin
  select decrypted_secret into mid from vault.decrypted_secrets where name = 'ga_measurement_id' limit 1;
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'ga_api_secret' limit 1;
  if coalesce(mid, '') = '' or coalesce(sec, '') = '' then return jsonb_build_object('status', 'waiting_for_ga_secrets'); end if;
  update app.analytics_outbox o set status = case when resp.status_code between 200 and 299 then 'sent' when o.attempts >= 5 then 'failed' else 'queued' end,
         sent_at = case when resp.status_code between 200 and 299 then now() end,
         last_error = case when resp.status_code between 200 and 299 then null else left(coalesce(resp.status_code::text, resp.error_msg, 'no response'), 200) end
    from net._http_response resp where o.status = 'sending' and resp.id = o.request_id;
  update app.analytics_outbox set status = 'failed', last_error = 'expired before sending' where status = 'queued' and created_at < now() - interval '3 days';
  for r in select * from app.analytics_outbox where status = 'queued' order by id limit 50 for update skip locked loop
    v_req := net.http_post(url := 'https://www.google-analytics.com/mp/collect?measurement_id=' || mid || '&api_secret=' || sec,
                           body := r.payload, headers := '{"content-type":"application/json"}'::jsonb, timeout_milliseconds := 10000);
    update app.analytics_outbox set status = 'sending', attempts = attempts + 1, request_id = v_req where id = r.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('status', 'ok', 'sent', n);
end $$;
revoke execute on function app.send_analytics_batch() from public, anon, authenticated;
select cron.schedule('shopeye-send-analytics', '* * * * *', $$select app.send_analytics_batch()$$);
