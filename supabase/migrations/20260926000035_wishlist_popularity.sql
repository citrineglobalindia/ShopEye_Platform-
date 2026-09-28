-- SHOPEYE 0035 — "Popular: recently wishlisted N times" on product pages: a count only (who saved it is never
-- exposed), last 30 days, shown from 3 saves up. Traces: CUST-FR-041
create or replace function public.product_wishlist_count(p_product uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from wishlist_items w join products p on p.id = w.product_id
   where w.product_id = p_product and p.status = 'active' and w.added_at > now() - interval '30 days'
$$;
revoke execute on function public.product_wishlist_count(uuid) from public;
grant execute on function public.product_wishlist_count(uuid) to anon, authenticated;
