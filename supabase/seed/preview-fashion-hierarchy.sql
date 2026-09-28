-- Deeper Fashion tree (Home → Fashion → Women → Western Wear → Dresses → product). Products stay in their
-- categories; only the tree above them changes. Any depth is supported by the site.
insert into public.categories(name, slug, parent_id, level, default_gst_rate, return_window_days, sort_order, active)
select v.name, v.slug, (select id from public.categories where slug = v.parent), v.level, 5, 7, v.so, true
  from (values ('Women','women','fashion',2,1), ('Men','men','fashion',2,2), ('Accessories','accessories','fashion',2,3)) v(name, slug, parent, level, so)
on conflict (slug) do nothing;
insert into public.categories(name, slug, parent_id, level, default_gst_rate, return_window_days, sort_order, active)
select v.name, v.slug, (select id from public.categories where slug = v.parent), v.level, 5, 7, v.so, true
  from (values ('Indian Wear','indian-wear','women',3,1), ('Western Wear','western-wear','women',3,2)) v(name, slug, parent, level, so)
on conflict (slug) do nothing;
update public.categories c set parent_id = p.id, level = x.level, sort_order = x.so, name = coalesce(x.newname, c.name)
  from (values ('sarees','indian-wear',4,1,null), ('kurtas-kurtis','indian-wear',4,2,null), ('dupattas-stoles','indian-wear',4,3,null),
               ('dresses','western-wear',4,1,null), ('tops','western-wear',4,2,null), ('jeans','western-wear',4,3,null),
               ('footwear','women',3,3,null), ('jewellery','women',3,4,null), ('bags','women',3,5,null),
               ('menswear','men',3,1,'Ethnic Wear'), ('watches','accessories',3,1,null)) x(slug, parent, level, so, newname)
  join public.categories p on p.slug = x.parent
 where c.slug = x.slug;
