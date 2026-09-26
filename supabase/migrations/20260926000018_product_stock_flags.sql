-- SHOPEYE 0018 — In-stock flags for listing cards without exposing warehouse data (CUST-FR-027/032/039)
set search_path = public, extensions;
create or replace function public.product_stock(p_ids uuid[])
returns table(product_id uuid, in_stock boolean) language sql stable security definer set search_path = public, app, extensions as $$
  select p.id, coalesce(bool_or(b.available > 0), false)
    from products p
    left join product_variants v on v.product_id = p.id and v.active
    left join stock_balances b on b.variant_id = v.id
   where p.id = any(p_ids) and p.status = 'active'
   group by p.id
$$;
revoke execute on function public.product_stock(uuid[]) from public;
grant execute on function public.product_stock(uuid[]) to anon, authenticated;
