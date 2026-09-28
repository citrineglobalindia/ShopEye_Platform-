-- SHOPEYE 0034 — stock level per product for "Limited stock!" on product cards (only the count of units
-- available to sell; no warehouse detail). Traces: CUST-FR-039
create or replace function public.product_stock_levels(p_ids uuid[])
returns table(product_id uuid, available int) language sql stable security definer set search_path = public, app, extensions as $$
  select p.id, coalesce(sum(greatest(b.available, 0)), 0)::int
    from products p
    left join product_variants v on v.product_id = p.id and v.active
    left join stock_balances b on b.variant_id = v.id
   where p.id = any(p_ids) and p.status = 'active'
   group by p.id
$$;
revoke execute on function public.product_stock_levels(uuid[]) from public;
grant execute on function public.product_stock_levels(uuid[]) to anon, authenticated;
