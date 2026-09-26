-- SHOPEYE 0015 — Public delivery check for product pages (CUST-FR-046: no login needed)
set search_path = public, extensions;
create or replace function public.check_pincode(p_pincode text)
returns jsonb language plpgsql stable security definer set search_path = public, app, extensions as $$
declare r serviceable_pincodes; v_all boolean; v_cod boolean;
begin
  if p_pincode !~ '^[1-9][0-9]{5}$' then return jsonb_build_object('valid', false); end if;
  select * into r from serviceable_pincodes where pincode = p_pincode and active;
  if r.pincode is not null then
    return jsonb_build_object('valid', true, 'serviceable', r.prepaid, 'cod', r.cod, 'eta_min', r.eta_days_min, 'eta_max', r.eta_days_max, 'city', r.city);
  end if;
  v_all := coalesce((app.setting('serviceability.all_india'))::text::boolean, false);
  v_cod := coalesce((app.setting('serviceability.all_india_cod'))::text::boolean, false);
  return jsonb_build_object('valid', true, 'serviceable', v_all, 'cod', v_all and v_cod, 'eta_min', 3, 'eta_max', 7, 'city', null);
end $$;
revoke execute on function public.check_pincode(text) from public;
grant execute on function public.check_pincode(text) to anon, authenticated;
