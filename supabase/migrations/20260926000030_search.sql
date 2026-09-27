-- SHOPEYE 0030 — Better search: matches title, description, brand, category and seller; tolerates typos and
-- partial words; ranks the closest matches first. Used by the search page and the header suggestions.
-- Traces: CUST-FR-030 CUST-FR-033
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions;

create index if not exists products_title_trgm on public.products using gin (lower(title) extensions.gin_trgm_ops);

create or replace function public.search_products(p_q text, p_limit int default 200)
returns table (product_id uuid, score real)
language sql stable security definer set search_path = public, extensions as $$
  with q as (select lower(btrim(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g'))) as s),
  toks as (select t from q, regexp_split_to_table((select s from q), ' ') t where length(t) >= 2),
  base as (
    select p.id, lower(p.title) as title,
           lower(concat_ws(' ', p.title, p.description, b.name, c.name, pc.name, v.display_name, p.specifications::text)) as doc
      from products p
      join vendors v on v.id = p.vendor_id and v.status = 'active'
      left join brands b on b.id = p.brand_id
      left join categories c on c.id = p.category_id
      left join categories pc on pc.id = c.parent_id
     where p.status = 'active')
  select id, (
      3 * word_similarity((select s from q), title)
    + similarity((select s from q), title)
    + (select count(*) from toks where doc like '%' || t || '%')::real / greatest((select count(*) from toks), 1)
    + case when title like (select s from q) || '%' then 1 else 0 end)::real as score
    from base
   where length((select s from q)) >= 2
     and ( -- every word appears somewhere, or the title is a close (typo-tolerant) match
          not exists (select 1 from toks where doc not like '%' || t || '%')
       or word_similarity((select s from q), title) >= 0.4
       or exists (select 1 from toks where length(t) >= 4 and exists (
            select 1 from regexp_split_to_table(doc, '[^a-z0-9]+') w where length(w) >= 3 and similarity(w, t) >= 0.33)))
   order by score desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;
revoke execute on function public.search_products(text, int) from public;
grant execute on function public.search_products(text, int) to anon, authenticated;
