-- SHOPEYE 0011 — Stop Supabase's default auto-grant of new public functions to anon/authenticated.
-- Every RPC must be granted explicitly.
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
revoke execute on function public.apply_as_vendor(text, text, text, text, text, jsonb),
                           public.my_vendor(), public.my_roles(),
                           public.admin_list_vendors(text), public.admin_decide_vendor(uuid, text, text),
                           public.admin_create_category(text, uuid, numeric, int),
                           public.vendor_create_product(uuid, uuid, text, text, numeric, text, text[], jsonb),
                           public.vendor_adjust_stock(uuid, int, text, text),
                           public.admin_moderate_product(uuid, text, text),
                           public.vendor_update_sub_order(uuid, text, text, text),
                           public.admin_mark_delivered(uuid),
                           public.place_order(uuid, uuid, text, text, text),
                           public.cancel_order_item(uuid, int, text, text, text),
                           public.request_return(uuid, int, text, text, text, text, text[], jsonb),
                           public.merge_guest_cart(text) from anon, public;
