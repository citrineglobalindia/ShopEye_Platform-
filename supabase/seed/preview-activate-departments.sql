-- Activate departments and move the first 8 categories under them (run with the new storefront UI)
update public.categories c set parent_id = d.id, level = 2 from public.categories d where d.slug = 'fashion' and c.slug = 'sarees';
update public.categories c set parent_id = d.id, level = 2, name = 'Kurtis & Suits' from public.categories d where d.slug = 'fashion' and c.slug = 'kurtas-kurtis';
update public.categories c set parent_id = d.id, level = 2 from public.categories d where d.slug = 'fashion' and c.slug = 'dupattas-stoles';
update public.categories c set parent_id = d.id, level = 2 from public.categories d where d.slug = 'fashion' and c.slug = 'menswear';
update public.categories c set parent_id = d.id, level = 2 from public.categories d where d.slug = 'fashion' and c.slug = 'jewellery';
update public.categories c set parent_id = d.id, level = 2 from public.categories d where d.slug = 'home-living' and c.slug = 'home-decor';
update public.categories c set parent_id = d.id, level = 2 from public.categories d where d.slug = 'home-living' and c.slug = 'handicrafts';
update public.categories c set parent_id = d.id, level = 2, name = 'Wellness & Ayurveda' from public.categories d where d.slug = 'beauty-personal-care' and c.slug = 'beauty-wellness';
update public.categories set active = true where level = 1 and slug in ('fashion', 'electronics', 'home-living', 'beauty-personal-care', 'appliances', 'grocery', 'sports-outdoors', 'toys-kids', 'automotive', 'books-stationery');
-- the first 48 preview products get house brands too
update public.products p set brand_id = b.id from public.categories c, public.brands b
 where p.category_id = c.id and p.is_demo and p.brand_id is null and b.slug = case c.slug
   when 'sarees' then 'nayra-loom' when 'kurtas-kurtis' then 'rangvi' when 'dupattas-stoles' then 'nayra-loom' when 'menswear' then 'tantuka'
   when 'home-decor' then 'aangan-home' when 'handicrafts' then 'mittikala' when 'jewellery' then 'rangvi' when 'beauty-wellness' then 'suvasa' end;
