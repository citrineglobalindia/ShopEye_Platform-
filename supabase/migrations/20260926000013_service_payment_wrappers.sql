-- SHOPEYE 0013 — service_role-only wrappers so server routes (Razorpay create/verify/webhook)
-- can reach app.* payment functions through PostgREST. Browsers cannot call these.
create or replace function public.svc_attach_gateway_order(p_order uuid, p_gateway_order_id text)
returns uuid language sql security definer set search_path = public, app, finance, extensions as $$
  select app.attach_gateway_order(p_order, p_gateway_order_id)
$$;
create or replace function public.svc_process_payment_event(
  p_event_id text, p_event_type text, p_gateway_order_id text, p_gateway_payment_id text,
  p_amount numeric, p_payload jsonb, p_signature_ok boolean)
returns text language sql security definer set search_path = public, app, finance, extensions as $$
  select app.process_payment_event(p_event_id, p_event_type, p_gateway_order_id, p_gateway_payment_id,
                                   p_amount::app.money, p_payload, p_signature_ok)
$$;
revoke all on function public.svc_attach_gateway_order(uuid, text) from public, anon, authenticated;
revoke all on function public.svc_process_payment_event(text, text, text, text, numeric, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.svc_attach_gateway_order(uuid, text) to service_role;
grant execute on function public.svc_process_payment_event(text, text, text, text, numeric, jsonb, boolean) to service_role;
