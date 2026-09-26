-- SHOPEYE 0020 — Send the email outbox through Brevo (Supabase-only: pg_net, Vault, pg_cron).
-- The Brevo API key lives in Supabase Vault under the name 'brevo_api_key' (added by the owner, never in code).
-- Until that secret exists the sender does nothing and emails stay queued.
create extension if not exists pg_net with schema extensions;

create or replace function app.send_email_batch() returns jsonb
language plpgsql security definer set search_path = public, app, extensions, net as $$
declare k text; r record; v_req bigint; n_sent int := 0; n_settled int := 0;
  v_from text := (app.setting('notify.sender_email'))#>>'{}'; v_name text := (app.setting('notify.sender_name'))#>>'{}';
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'brevo_api_key' limit 1;
  if k is null or k = '' then return jsonb_build_object('status', 'waiting_for_api_key'); end if;

  -- 1. settle earlier requests from their HTTP responses
  with s as (
    update app.notification_outbox o set
      status = case when resp.status_code between 200 and 299 then 'sent' when o.attempts >= 5 then 'failed' else 'queued' end,
      sent_at = case when resp.status_code between 200 and 299 then now() end,
      last_error = case when resp.status_code between 200 and 299 then null else left(coalesce(resp.status_code::text || ' ' || resp.content, resp.error_msg, 'no response'), 300) end
    from net._http_response resp
    where o.status = 'sending' and resp.id = o.request_id
    returning 1) select count(*) into n_settled from s;
  update app.notification_outbox set status = case when attempts >= 5 then 'failed' else 'queued' end, last_error = 'no response from Brevo'
   where status = 'sending' and created_at < now() - interval '15 minutes' and request_id not in (select id from net._http_response);

  -- 2. never send stale mail (e.g. queued long before the key was added)
  update app.notification_outbox set status = 'failed', last_error = 'expired before sending' where status = 'queued' and created_at < now() - interval '2 days';

  -- 3. send the next batch
  for r in select * from app.notification_outbox where status = 'queued' order by id limit 40 for update skip locked loop
    v_req := net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      body := jsonb_build_object(
        'sender', jsonb_build_object('name', v_name, 'email', v_from),
        'to', jsonb_build_array(jsonb_build_object('email', r.to_email, 'name', coalesce(nullif(r.to_name, ''), r.to_email))),
        'subject', r.subject, 'htmlContent', r.html, 'tags', jsonb_build_array(r.kind),
        'headers', jsonb_build_object('X-Shopeye-Id', r.dedupe_key)),
      headers := jsonb_build_object('api-key', k, 'content-type', 'application/json', 'accept', 'application/json'),
      timeout_milliseconds := 15000);
    update app.notification_outbox set status = 'sending', attempts = attempts + 1, request_id = v_req where id = r.id;
    n_sent := n_sent + 1;
  end loop;
  return jsonb_build_object('status', 'ok', 'sent', n_sent, 'settled', n_settled);
end $$;
revoke execute on function app.send_email_batch() from public, anon, authenticated;

-- Admin-visible health check (counts only, no addresses)
create or replace function public.email_queue_health() returns jsonb
language sql stable security definer set search_path = public, app, extensions as $$
  select case when app.has_permission('audit.view') then
    jsonb_build_object('by_status', (select jsonb_object_agg(status, c) from (select status, count(*) c from app.notification_outbox group by status) x),
                       'key_configured', exists (select 1 from vault.secrets where name = 'brevo_api_key'),
                       'last_error', (select last_error from app.notification_outbox where last_error is not null order by id desc limit 1))
  end
$$;
revoke execute on function public.email_queue_health() from public, anon;
grant execute on function public.email_queue_health() to authenticated;

select cron.schedule('shopeye-send-email', '* * * * *', $$select app.send_email_batch()$$);
