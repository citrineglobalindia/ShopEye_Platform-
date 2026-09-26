-- Shopeye foundation UAT suite. Each assertion prints PASS or aborts with FAIL.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create table test.state (k text primary key, v text);
create or replace function test.put(k text, v text) returns void language sql as $$ insert into test.state values (k, v) on conflict (k) do update set v = excluded.v $$;
create or replace function test.get(k text) returns text language sql as $$ select v from test.state where k = $1 $$;
grant usage on schema test to anon, authenticated;
grant execute on all functions in schema test to anon, authenticated;
grant select on test.state to anon, authenticated;

\echo '== 1. Status models & direct-write guards'
do $$ begin
  perform test.throws($q$ update public.vendors set status = 'draft' where id = test.id('vendor1') $q$, 'INVALID_TRANSITION', 'Vendor active→draft rejected by server (VS-FR-887)');
  insert into public.products(id, vendor_id, category_id, title, slug) values
    ('00000000-0000-0000-0000-000000000303', test.id('vendor1'), test.id('cat'), 'Draft Dupatta', 'draft-dupatta');
  perform test.throws($q$ update public.products set status = 'active' where id = '00000000-0000-0000-0000-000000000303' $q$, 'INVALID_TRANSITION', 'Draft product cannot self-activate without review');
  update public.products set status = 'pending_review' where id = '00000000-0000-0000-0000-000000000303';
  update public.products set status = 'rejected', rejection_reason = 'blurry images' where id = '00000000-0000-0000-0000-000000000303';
  perform test.throws($q$ update public.products set status = 'active' where id = '00000000-0000-0000-0000-000000000303' $q$, 'INVALID_TRANSITION', 'Rejected product must be resubmitted, not activated (VS-FR-888)');
  perform test.throws($q$ update public.stock_balances set on_hand = 999 $q$, 'DIRECT_STOCK_WRITE_FORBIDDEN', 'Direct stock balance edit blocked; ledger-only');
  perform test.throws($q$ insert into public.product_variants(product_id, vendor_id, sku, mrp, selling_price) values (test.id('p1'), test.id('vendor1'), 'BAD', 100, 150) $q$, 'check constraint', 'Selling price above MRP rejected');
  perform test.throws($q$ insert into public.product_variants(product_id, vendor_id, sku, mrp, selling_price) values (test.id('p1'), test.id('vendor2'), 'XV', 100, 90) $q$, 'VARIANT_VENDOR_MISMATCH', 'Variant cannot be attached to another vendor''s product');
end $$;

\echo '== 2. Checkout: server pricing, coupon allocation, idempotency (UAT-007/010/012)'
do $$ declare r jsonb; r2 jsonb; v_cart uuid; o public.orders; n int;
begin
  perform test.act_as(test.id('cust_a'));
  v_cart := test.cart(test.id('cust_a'), '[{"v":"kurta_m","q":2},{"v":"saree","q":1}]');
  r := public.place_order(v_cart, test.id('addr_a'), 'upi', 'idem-order-1', 'FESTIVE10');
  perform test.put('order1', r->>'order_id');
  select * into o from public.orders where id = (r->>'order_id')::uuid;
  perform test.ok(o.subtotal = 8497.00, 'Subtotal recomputed server-side = 8497.00');
  perform test.ok(o.discount_total = 849.70, 'FESTIVE10: 10% of eligible = 849.70');
  perform test.ok(o.shipping_total = 0, 'Free shipping per vendor package above threshold');
  perform test.ok(o.grand_total = 7647.30, 'Grand total 7647.30 reconciles (subtotal - discount + shipping)');
  perform test.ok((select count(*) from public.sub_orders where order_id = o.id) = 2, 'One master order split into 2 vendor sub-orders');
  perform test.ok((select sum(discount) from public.order_items where order_id = o.id) = o.discount_total, 'Coupon allocation across lines sums exactly to order discount');
  perform test.ok((select bool_and(discount = platform_funded_discount + vendor_funded_discount) from public.order_items where order_id = o.id), 'Discount funding split platform/vendor sums to line discount (AF-FR-0474)');
  perform test.ok((select commission_amount from public.order_items where order_id = o.id and variant_id = test.id('saree')) = 584.91, 'Commission 10% frozen on line (584.91)');
  perform test.ok((select reserved from public.stock_balances where variant_id = test.id('kurta_m')) = 2, 'Stock reserved at checkout (2 units)');

  r2 := public.place_order(v_cart, test.id('addr_a'), 'upi', 'idem-order-1', 'FESTIVE10');
  select count(*) into n from public.orders where customer_id = test.id('cust_a');
  perform test.ok((r2->>'replay')::boolean and r2->>'order_id' = r->>'order_id' and n = 1, 'Double-click Place Order returns same order, no duplicate (UAT-012)');
  perform test.ok((select reserved from public.stock_balances where variant_id = test.id('kurta_m')) = 2, 'Replay did not reserve stock twice');

  perform test.throws($q$ select public.place_order(test.cart(test.id('cust_a'), '[{"v":"kurta_m","q":2}]'), test.id('addr_a'), 'upi', 'idem-coupon-again', 'FESTIVE10') $q$,
                      'COUPON_USAGE_LIMIT', 'Coupon per-customer usage limit enforced');
  perform test.throws($q$ select public.place_order(test.cart(test.id('cust_a'), '[{"v":"kurta_m","q":50}]'), test.id('addr_a'), 'upi', 'idem-qty', null) $q$,
                      'QTY_LIMIT_EXCEEDED', 'Quantity above per-order limit blocked (CUST-FR-043)');
  perform test.throws($q$ select public.place_order(test.cart(test.id('cust_a'), '[{"v":"kurta_m","q":1}]'), test.id('addr_b'), 'upi', 'idem-addr', null) $q$,
                      'ADDRESS_NOT_FOUND', 'Cannot check out to another customer''s address');
end $$;

\echo '== 3. Payment webhooks: capture, duplicates, mismatch (UAT-25, AF-FR-0079/0083)'
do $$ declare v_order uuid := test.get('order1')::uuid; v_res text; r jsonb; v_j uuid; dr numeric; cr numeric; vbal numeric;
begin
  perform app.attach_gateway_order(v_order, 'order_RZP_001');
  v_res := app.process_payment_event('evt_001', 'payment.captured', 'order_RZP_001', 'pay_001', 7647.30, '{"card_number":"4111"}', true);
  perform test.ok(v_res = 'processed', 'Captured webhook processed');
  perform test.ok((select status::text from public.orders where id = v_order) = 'confirmed', 'Order confirmed only by server-verified capture (CUST-FR-082)');
  perform test.ok((select payload ? 'card_number' from public.payment_events where provider_event_id = 'evt_001') = false, 'Sensitive fields stripped from stored webhook payload');
  v_res := app.process_payment_event('evt_001', 'payment.captured', 'order_RZP_001', 'pay_001', 7647.30, '{}', true);
  perform test.ok(v_res = 'duplicate', 'Replayed webhook event ignored (UAT-25)');
  v_res := app.process_payment_event('evt_002', 'payment.captured', 'order_RZP_001', 'pay_001', 7647.30, '{}', true);
  perform test.ok(v_res = 'already_captured', 'Second capture event for same payment does not double-post');
  perform test.ok((select count(*) from finance.journal_entries where source_key = 'order-confirm:' || v_order) = 1, 'Exactly one accounting posting for the order');

  select id into v_j from finance.journal_entries where source_key = 'order-confirm:' || v_order;
  select sum(debit), sum(credit) into dr, cr from finance.journal_lines where journal_id = v_j;
  perform test.ok(dr = cr and dr > 0, format('Order journal balanced (Dr %s = Cr %s)', dr, cr));
  select sum(credit - debit) into vbal from finance.vendor_ledger where vendor_id = test.id('vendor1');
  perform test.ok(vbal = 1685.91, format('Vendor 1 net earning 1685.91 = 1898.10 sale - 212.19 commission+GST (got %s)', vbal));

  perform test.act_as(test.id('cust_b'));
  r := public.place_order(test.cart(test.id('cust_b'), '[{"v":"saree","q":1}]'), test.id('addr_b'), 'card', 'idem-order-2', null);
  perform test.put('order2', r->>'order_id');
  perform app.attach_gateway_order((r->>'order_id')::uuid, 'order_RZP_002');
  v_res := app.process_payment_event('evt_003', 'payment.captured', 'order_RZP_002', 'pay_002', 100.00, '{}', true);
  perform test.ok(v_res = 'exception' and (select flagged_reason is not null from public.payments where gateway_order_id = 'order_RZP_002'), 'Amount mismatch flagged, order not confirmed');
  perform test.ok((select status::text from public.orders where id = (r->>'order_id')::uuid) = 'pending_payment', 'Mismatched payment leaves order pending');
  v_res := app.process_payment_event('evt_004', 'payment.captured', 'order_RZP_002', 'pay_002', 6499.00, '{}', false);
  perform test.ok(v_res = 'ignored', 'Webhook with failed signature ignored');
  perform test.throws($q$ update public.payments set amount = 1 where gateway_order_id = 'order_RZP_001' $q$, 'IMMUTABLE_PAYMENT_FIELD', 'Captured payment amount immutable (AF-FR-0077)');
end $$;

\echo '== 4. Cancellation & refunds (UAT-015/018, UAT-06/07/23)'
do $$ declare v_order uuid := test.get('order1')::uuid; v_item uuid; r jsonb; r2 jsonb; v_ref uuid; v_big uuid; v_head uuid; dr numeric; cr numeric;
begin
  perform test.act_as(test.id('cust_a'));
  select id into v_item from public.order_items where order_id = v_order and variant_id = test.id('kurta_m');
  perform test.put('item_kurta', v_item::text);
  r := public.cancel_order_item(v_item, 1, 'ordered_by_mistake', 'idem-cxl-1');
  perform test.ok((r->>'refund_amount')::numeric = 899.10, 'Partial cancel refunds pro-rata of discounted line: 899.10 (CUST-FR-111)');
  r2 := public.cancel_order_item(v_item, 1, 'ordered_by_mistake', 'idem-cxl-1');
  perform test.ok((r2->>'replay')::boolean and (select count(*) from public.refunds where order_id = v_order) = 1, 'Repeated cancel request is idempotent — one refund (CUST-FR-113)');
  perform test.ok((select reserved from public.stock_balances where variant_id = test.id('kurta_m')) = 1, 'Cancelled unit released from reservation');
  perform test.ok((select status::text from public.orders where id = v_order) = 'partially_cancelled', 'Order shows Partially Cancelled');
  v_ref := (r->>'refund_id')::uuid;
  perform test.ok((select approval_status from public.refunds where id = v_ref) = 'not_required', 'Refund under threshold needs no checker');

  perform test.act_as(test.id('cust_b'));
  perform test.throws(format($q$ select public.cancel_order_item(%L, 1, 'x', 'idem-cxl-steal') $q$, v_item), 'FORBIDDEN', 'Customer B cannot cancel Customer A''s item (UAT-021)');

  perform test.act_as(test.id('head'));
  perform finance.record_refund_result(v_ref, 'failed', null, 'BANK_TIMEOUT');
  perform test.ok((select processor_status::text from public.refunds where id = v_ref) = 'failed', 'Failed refund stays visible for retry (UAT-07)');
  perform finance.record_refund_result(v_ref, 'success', 'rfnd_001');
  perform finance.record_refund_result(v_ref, 'success', 'rfnd_001');
  perform test.ok((select count(*) from finance.journal_entries where source_key = 'refund:' || v_ref) = 1, 'Refund retry then duplicate success callback posts once');
  select sum(debit), sum(credit) into dr, cr from finance.journal_lines l join finance.journal_entries j on j.id = l.journal_id where j.source_key = 'refund:' || v_ref;
  perform test.ok(dr = cr, format('Refund journal balanced (Dr %s = Cr %s)', dr, cr));
  perform test.ok((select payment_status::text from public.orders where id = v_order) = 'partially_refunded', 'Payment shows Partially Refunded');

  -- maker-checker on large refund
  perform test.act_as(test.id('maker'));
  v_big := app.request_refund(v_order, 1500.00, 'adjustment', 'support', 'TKT-1', 'goodwill', 'idem-rf-big');
  perform test.ok((select approval_status from public.refunds where id = v_big) = 'pending', 'Refund ≥ 1000 routed to checker (AF-FR-0170)');
  perform test.throws(format($q$ select finance.decide_refund(%L, 'approve') $q$, v_big), 'FORBIDDEN', 'Accountant (preparer) lacks refund approval right (AF-FR-0586)');
  perform test.throws(format($q$ select finance.record_refund_result(%L, 'success', 'x') $q$, v_big), 'REFUND_NOT_APPROVED', 'Unapproved refund cannot be executed');

  perform test.act_as(test.id('head'));
  v_head := app.request_refund(v_order, 1200.00, 'adjustment', 'support', 'TKT-2', 'goodwill', 'idem-rf-head');
  perform test.throws(format($q$ select finance.decide_refund(%L, 'approve') $q$, v_head), 'SELF_APPROVAL_FORBIDDEN', 'Maker cannot approve own refund even with approve right (UAT-23)');

  perform test.act_as(test.id('checker'));
  perform test.ok(finance.decide_refund(v_big, 'approve') = 'approved', 'Independent checker approves');
  perform test.throws(format($q$ select app.request_refund(%L, 99999, 'adjustment', 'support', 'T', 'x', 'idem-rf-huge') $q$, v_order), 'REFUND_EXCEEDS_BALANCE', 'Refund above refundable balance blocked (CUST-FR-124)');
end $$;

\echo '== 5. Ledger immutability, balanced journals, closed periods (UAT-17/22/28/30)'
do $$ declare v_j uuid; v_rev uuid;
begin
  perform test.throws($q$ update public.stock_ledger set qty_delta = 100 $q$, 'IMMUTABLE_RECORD', 'Stock ledger is append-only (SM-FR-0173)');
  perform test.throws($q$ delete from finance.vendor_ledger $q$, 'IMMUTABLE_RECORD', 'Vendor ledger is append-only (AF-FR-0234)');
  perform test.throws($q$ delete from app.audit_log $q$, 'IMMUTABLE_RECORD', 'Audit log cannot be deleted (AF-FR-0603)');
  perform test.throws($q$ update finance.journal_lines set debit = debit + 1 where id = (select min(id) from finance.journal_lines) $q$, 'IMMUTABLE_RECORD', 'Posted journal lines frozen');
  perform test.throws($q$ select finance.post_journal('manual', 'M1', 'man:1', 'unbalanced', '[{"account":"1200","debit":100},{"account":"5300","credit":90}]') $q$, 'UNBALANCED_JOURNAL', 'Unbalanced journal cannot post (UAT-17)');
  perform test.throws(format($q$ select finance.post_journal('manual', 'M2', 'man:2', 'backdated', '[{"account":"1200","debit":100},{"account":"5300","credit":100}]', %L::date) $q$, current_date - 40),
                      'PERIOD_CLOSED', 'Posting into closed period denied (UAT-22)');
  v_j := finance.post_journal('manual', 'M3', 'man:3', 'bank charge accrual', '[{"account":"5100","debit":250},{"account":"1200","credit":250}]', current_date, 'accrual');
  v_rev := finance.reverse_journal(v_j, 'entered in wrong account');
  perform test.ok((select status::text from finance.journal_entries where id = v_j) = 'reversed'
              and (select reversal_of from finance.journal_entries where id = v_rev) = v_j, 'Reversal creates linked counter-entry, original preserved (UAT-30)');
  perform test.ok(exists (select 1 from app.audit_log where entity_type = 'public.vendors' and before_value->>'status' = 'approved' and after_value->>'status' = 'active'),
                  'Audit log captures before/after for vendor activation (UAT-28)');
end $$;

\echo '== 6. Fulfilment, delivery, returns (UAT-013/016, VS-FR-892)'
do $$ declare v_order uuid := test.get('order1')::uuid; so1 uuid; so2 uuid; s1 uuid; s2 uuid; v_item uuid := test.get('item_kurta')::uuid; v_ret uuid;
begin
  select id into so1 from public.sub_orders where order_id = v_order and vendor_id = test.id('vendor1');
  select id into so2 from public.sub_orders where order_id = v_order and vendor_id = test.id('vendor2');
  perform test.throws(format($q$ update public.sub_orders set status = 'shipped' where id = %L $q$, so1), 'INVALID_TRANSITION', 'Cannot ship before pack/ready-to-ship (VS-FR-891)');
  update public.sub_orders set status = 'packed' where id in (so1, so2);
  update public.sub_orders set status = 'ready_to_ship' where id in (so1, so2);
  insert into public.shipments(sub_order_id, carrier, awb) values (so1, 'Delhivery', 'AWB1001') returning id into s1;
  insert into public.shipments(sub_order_id, carrier, awb) values (so2, 'BlueDart', 'AWB2001') returning id into s2;
  perform app.record_shipment_event(s1, 'e1', 'PICKED', 'shipped', now() - interval '3 days');
  perform app.record_shipment_event(s2, 'e1', 'PICKED', 'shipped', now() - interval '10 days');
  perform test.ok((select on_hand from public.stock_balances where variant_id = test.id('kurta_m')) = 9
              and (select reserved from public.stock_balances where variant_id = test.id('kurta_m')) = 0, 'Dispatch consumes on-hand 10→9 and releases reservation');
  perform test.act_as(test.id('cust_a'));
  perform test.throws(format($q$ select public.cancel_order_item(%L, 1, 'late', 'idem-cxl-late') $q$, v_item), 'NOT_CANCELLABLE', 'No simple cancellation after carrier handover (VS-FR-892)');
  perform app.record_shipment_event(s1, 'e2', 'DLVD', 'delivered', now() - interval '1 day');
  perform test.ok(app.record_shipment_event(s1, 'e2', 'DLVD', 'delivered', now() - interval '1 day') = 'duplicate', 'Duplicate carrier event ignored');
  perform test.ok((select return_window_ends_at::date from public.sub_orders where id = so1) = (now() - interval '1 day' + interval '7 days')::date, 'Delivery opens 7-day category return window');
  perform test.ok((select status::text from public.orders where id = v_order) = 'partially_delivered', 'Split shipment: order Partially Delivered (UAT-013)');
  perform test.throws(format($q$ select public.request_return(%L, 2, 'refund', 'size_fit', 'idem-ret-2') $q$, v_item), 'RETURN_QTY_EXCEEDS', 'Return qty > delivered-not-cancelled blocked (CUST-FR-115)');
  perform test.throws(format($q$ select public.request_return(%L, 1, 'refund', 'damaged', 'idem-ret-ev') $q$, v_item), 'EVIDENCE_REQUIRED', 'Damage claim requires photo evidence');
  v_ret := public.request_return(v_item, 1, 'refund', 'size_fit', 'idem-ret-1');
  perform test.ok(v_ret = public.request_return(v_item, 1, 'refund', 'size_fit', 'idem-ret-1'), 'Return request idempotent');
  perform test.act_as(test.id('cust_b'));
  perform test.throws(format($q$ select public.request_return(%L, 1, 'refund', 'size_fit', 'idem-ret-b') $q$, v_item), 'FORBIDDEN', 'Another customer cannot raise the return');
  perform test.ok(app.record_shipment_event(s2, 'e0', 'DLVD', 'delivered', now() - interval '11 days') = 'stale', 'Out-of-order carrier event (older than last) ignored');
  perform app.record_shipment_event(s2, 'e2', 'DLVD', 'delivered', now() - interval '8 days');
  update public.sub_orders set return_window_ends_at = now() - interval '1 hour' where id = so2;   -- simulate window elapsed
  perform test.put('so1', so1::text); perform test.put('so2', so2::text);
end $$;

\echo '== 7. Settlements, holds, maker-checker payouts (UAT-09/10/11)'
do $$ declare v_batch uuid; v_line uuid; v_hold uuid; v_st text; n int; v_batch2 uuid;
begin
  perform test.act_as(test.id('maker'));
  insert into finance.settlement_holds(vendor_id, amount, reason_code, reason, placed_by)
  values (test.id('vendor2'), 500, 'compliance', 'GST certificate renewal pending', test.id('maker')) returning id into v_hold;
  v_batch := finance.generate_settlement_batch('weekly');
  perform test.ok((select count(*) from finance.settlement_lines where batch_id = v_batch) = 1, 'Only vendor 2 eligible; vendor 1 excluded (open return / window)');
  select id into v_line from finance.settlement_lines where batch_id = v_batch;
  perform test.ok((select eligible_amount from finance.settlement_lines where id = v_line) = 5483.86, 'Eligible = 6174.05 sale - 690.19 commission+GST = 5483.86');
  perform test.ok((select net_payable from finance.settlement_lines where id = v_line) = 4983.86, 'Active hold of 500 withheld from payout (UAT-11)');
  perform finance.submit_settlement_batch(v_batch);
  perform test.throws(format($q$ select finance.decide_settlement_batch(%L, 'approve') $q$, v_batch), 'FORBIDDEN', 'Preparer without approve right cannot approve batch');
  perform test.throws(format($q$ select finance.record_payout_result(%L, 'paid', 'UTR1') $q$, v_line), 'FORBIDDEN', 'Payout execution needs execute permission');

  perform test.act_as(test.id('checker'));
  perform test.ok(finance.decide_settlement_batch(v_batch, 'approve')::text = 'approved', 'Checker approves settlement batch');

  perform test.act_as(test.id('head'));
  perform finance.record_payout_result(v_line, 'failed', null, 'IFSC mismatch');
  perform test.ok((select status::text from finance.settlement_batches where id = v_batch) = 'processing', 'Failed line keeps batch open for retry (UAT-10)');
  perform test.throws(format($q$ select finance.record_payout_result(%L, 'paid') $q$, v_line), 'UTR_REQUIRED', 'Paid status needs bank UTR');
  perform finance.record_payout_result(v_line, 'paid', 'UTR20260926001');
  v_st := finance.record_payout_result(v_line, 'paid', 'UTR20260926001');
  select count(*) into n from finance.vendor_ledger where entry_type = 'settlement' and settlement_line_id = v_line;
  perform test.ok(v_st = 'paid' and n = 1, 'Duplicate payout callback does not pay twice (AF-FR-0292)');
  perform test.ok((select status::text from finance.settlement_batches where id = v_batch) = 'completed', 'Batch completed');

  perform test.act_as(test.id('maker'));
  v_batch2 := finance.generate_settlement_batch('weekly');
  perform test.ok((select count(*) from finance.settlement_lines where batch_id = v_batch2) = 0, 'Already-settled sub-order never enters another batch');
end $$;

\echo '== 8. Commission snapshot & rule governance (UAT-12)'
do $$ declare r jsonb;
begin
  insert into finance.commission_rules(vendor_id, effective_from, commission_type, commission_value)
  values (test.id('vendor2'), current_date, 'percent', 20);
  perform test.act_as(test.id('cust_b'));
  r := public.place_order(test.cart(test.id('cust_b'), '[{"v":"saree","q":1}]'), test.id('addr_b'), 'upi', 'idem-order-3', null);
  perform test.ok((select commission_amount from public.order_items where order_id = (r->>'order_id')::uuid) = 1299.80, 'New vendor rule (20%) applies to new order: 1299.80');
  perform test.ok((select commission_amount from public.order_items where order_id = test.get('order1')::uuid and variant_id = test.id('saree')) = 584.91, 'Old order keeps its frozen 10% commission');
  perform test.throws($q$ insert into finance.commission_rules(category_id, effective_from, commission_type, commission_value) values (test.id('cat'), current_date, 'percent', 12) $q$,
                      'conflicting key value violates exclusion constraint', 'Overlapping rule with same scope/priority rejected');
end $$;

\echo '== 9. COD rules (CUST-FR-112)'
do $$ declare r jsonb; v_item uuid; c jsonb;
begin
  -- effective-dated config change: new threshold applies from now, history untouched (AF-FR-0650)
  insert into app.settings(key, value, effective_from) values ('shipping.free_threshold_per_vendor', '1500', now() - interval '1 second');
  perform test.act_as(test.id('cust_a'));
  r := public.place_order(test.cart(test.id('cust_a'), '[{"v":"kurta_m","q":1}]'), test.id('addr_a'), 'cod', 'idem-cod-1', null);
  perform test.ok((r->>'status') = 'confirmed' and (select payment_status::text from public.orders where id = (r->>'order_id')::uuid) = 'cod_pending', 'COD order confirmed with COD-pending payment');
  perform test.ok((select shipping_total from public.orders where id = (r->>'order_id')::uuid) = 49, 'New ₹1500 threshold applies: ₹49 shipping on ₹999 order');
  select id into v_item from public.order_items where order_id = (r->>'order_id')::uuid;
  c := public.cancel_order_item(v_item, 1, 'changed_mind', 'idem-cod-cxl');
  perform test.ok(c->>'refund_id' is null, 'COD cancellation creates no monetary refund');
  perform test.act_as(test.id('cust_b'));
  perform test.throws($q$ select public.place_order(test.cart(test.id('cust_b'), '[{"v":"saree","q":1}]'), test.id('addr_b'), 'cod', 'idem-cod-2', null) $q$, 'COD_NOT_AVAILABLE', 'COD blocked for non-COD pincode');
end $$;


\echo '== 13. Late payment after stock hold expired'
do $$ declare r jsonb; v_res text; v_before int;
begin
  perform test.act_as(test.id('cust_b'));
  r := public.place_order(test.cart(test.id('cust_b'), '[{"v":"kurta_m","q":1}]'), test.id('addr_b'), 'upi', 'idem-late-1', null);
  perform app.attach_gateway_order((r->>'order_id')::uuid, 'order_RZP_LATE');
  update public.stock_reservations set expires_at = now() - interval '1 minute'
   where order_item_id in (select id from public.order_items where order_id = (r->>'order_id')::uuid);
  select reserved into v_before from public.stock_balances where variant_id = test.id('kurta_m');
  perform app.expire_reservations();
  perform test.ok((select reserved from public.stock_balances where variant_id = test.id('kurta_m')) = v_before - 1, 'Expired checkout hold released by scheduled job');
  v_res := app.process_payment_event('evt_late', 'payment.captured', 'order_RZP_LATE', 'pay_late', (r->>'grand_total')::numeric, '{}', true);
  perform test.ok(v_res = 'processed' and (select reserved from public.stock_balances where variant_id = test.id('kurta_m')) = v_before,
                  'Late capture re-reserves stock for the paid order');
  perform test.ok((select flagged_reason is null from public.payments where gateway_order_id = 'order_RZP_LATE'), 'No refund flag when stock still available');
end $$;


\echo '== 14. Seller onboarding → listing → moderation → sale → fulfilment (portal RPCs)'
do $$ declare u uuid := '00000000-0000-0000-0000-0000000000d1'; v uuid; pid uuid; vid uuid; r jsonb; so uuid; st text; n int;
begin
  insert into auth.users(id, email) values (u, 'newseller@test.local');
  insert into public.profiles(id, full_name, email) values (u, 'New Seller', 'newseller@test.local');
  perform test.act_as(u);
  v := public.apply_as_vendor('Kolar Handlooms LLP', 'Kolar Handlooms', '+919811112222', '', '563101', '{"line1":"Main Rd"}');
  perform test.ok(v = public.apply_as_vendor('x', 'y', null, null, '563101', null), 'Seller application is idempotent per user');
  perform test.ok((public.my_vendor()->>'status') = 'submitted', 'New seller lands in Submitted state');
  pid := public.vendor_create_product(v, test.id('cat'), 'Kolar Silk Dupatta', 'Pure silk', 5, '5007',
          array['https://images.example.com/d1.jpg','http://insecure.example.com/x.jpg'],
          '[{"sku":"KOL-DUP-1","attributes":{"color":"Teal"},"mrp":2499,"price":1899,"stock":4}]');
  select id into vid from public.product_variants where product_id = pid;
  perform test.ok((select status::text from public.products where id = pid) = 'pending_review', 'New listing goes to moderation, not live');
  perform test.ok((select count(*) from public.product_media where product_id = pid) = 1, 'Only https image URLs accepted');
  perform test.ok((select on_hand from public.stock_balances where variant_id = vid) = 4, 'Opening stock posted through ledger');
  perform test.throws(format($q$ select public.admin_moderate_product(%L, 'approve') $q$, pid), 'FORBIDDEN', 'Seller cannot approve own listing');
  perform test.throws(format($q$ select public.vendor_create_product(%L, test.id('cat'), 'Spoof', '', 5, '', null, '[{"sku":"SP-1","mrp":10,"price":9}]') $q$, test.id('vendor1')),
                      'FORBIDDEN', 'Seller cannot list under another vendor');

  perform test.act_as(test.id('admin'));
  perform test.throws(format($q$ select public.admin_moderate_product(%L, 'reject', 'bad') $q$, pid), 'REASON_REQUIRED', 'Rejection needs a meaningful reason');
  perform test.ok(public.admin_moderate_product(pid, 'approve') = 'active', 'Moderator approves listing');
  perform test.ok(not exists (select 1 from public.catalog_variants where variant_id = vid), 'Listing stays hidden until the seller is approved');
  perform test.ok(public.admin_decide_vendor(v, 'approve', 'KYC verified') = 'active', 'Admin approves seller: submitted → under review → approved → active');
  perform test.ok(exists (select 1 from public.catalog_variants where variant_id = vid), 'Listing now visible in the catalogue');
  perform test.ok((select available from public.variant_availability(pid)) = 4, 'Shopper sees availability without warehouse details');

  perform test.act_as(test.id('cust_a'));
  update public.carts set status = 'abandoned' where customer_id = test.id('cust_a') and status = 'active';
  insert into public.carts(customer_id) values (test.id('cust_a')) returning id into so;
  insert into public.cart_items(cart_id, variant_id, qty, price_at_add) values (so, vid, 1, 1899);
  r := public.place_order(so, test.id('addr_a'), 'cod', 'idem-kolar-1', null);
  select id into so from public.sub_orders where order_id = (r->>'order_id')::uuid;

  perform test.act_as(test.id('v2_owner'));
  perform test.throws(format($q$ select public.vendor_update_sub_order(%L, 'pack') $q$, so), 'FORBIDDEN', 'Another seller cannot touch this order');
  perform test.act_as(u);
  perform test.throws(format($q$ select public.vendor_update_sub_order(%L, 'ship', 'Delhivery', 'AWB9') $q$, so), 'INVALID_TRANSITION', 'Cannot ship before packing');
  perform public.vendor_update_sub_order(so, 'pack');
  perform public.vendor_update_sub_order(so, 'ready');
  perform test.throws(format($q$ select public.vendor_update_sub_order(%L, 'ship') $q$, so), 'CARRIER_AND_AWB_REQUIRED', 'Shipping needs carrier and AWB');
  st := public.vendor_update_sub_order(so, 'ship', 'Delhivery', 'AWB-KOL-1');
  perform test.ok(st = 'shipped' and (select on_hand from public.stock_balances where variant_id = vid) = 3, 'Seller ships: stock leaves warehouse (4→3)');
  perform test.act_as(test.id('admin'));
  perform test.ok(public.admin_mark_delivered(so) = 'delivered', 'Delivery recorded; return window opens');
  perform test.ok(jsonb_array_length(public.admin_list_vendors('active')) >= 3, 'Admin vendor list returns full records');
  perform test.act_as(test.id('cust_b'));
  perform test.throws($q$ select public.admin_list_vendors() $q$, 'FORBIDDEN', 'Customers cannot list vendor records');
end $$;


\echo '== 15. QA sign-off on SRS requirements (/status)'
do $$ begin
  perform test.act_as(test.id('cust_a'));
  perform test.throws($q$ select public.mark_requirement('CUST-FR-001', 'passed') $q$, 'FORBIDDEN', 'Customers cannot mark requirements tested');
  perform test.act_as(test.id('admin'));
  perform test.ok(public.mark_requirement('CUST-FR-001', 'passed', 'Header verified on desktop and mobile') = 'passed', 'Admin marks a requirement tested');
  perform test.throws($q$ select public.mark_requirement('CUST-FR-001', 'failed') $q$, 'NOTE_REQUIRED', 'Marking failed needs a note');
  perform test.throws($q$ select public.mark_requirement('BAD-1', 'passed') $q$, 'INVALID_REQUIREMENT_ID', 'Unknown requirement ID rejected');
  perform public.mark_requirement('CUST-FR-001', 'failed', 'Cart count badge missing');
  perform test.ok((select result from public.requirement_signoffs where req_id = 'CUST-FR-001') = 'failed', 'Latest sign-off replaces the current result');
  perform test.ok((select count(*) from public.requirement_signoff_history('CUST-FR-001')) = 2, 'Every sign-off kept in history');
  perform test.throws($q$ delete from public.requirement_signoff_log $q$, 'IMMUTABLE_RECORD', 'Sign-off history cannot be deleted');
  perform test.act_as(test.id('cust_b'));
  perform test.ok((select note is null and tested_by_name is null from public.requirement_signoff_list() where req_id = 'CUST-FR-001'), 'Public sees result but not note or tester');
  perform test.ok((select count(*) from public.requirement_signoff_history('CUST-FR-001')) = 0, 'Public cannot read sign-off history');
end $$;

\echo '== 10. Row-level security as real API roles (UAT-021, AF-FR-0583)'
set role anon;
do $$ begin perform test.act_as(null); end $$;
do $$ begin
  perform test.ok((select count(*) from public.products) > 0 and (select count(*) from public.products where status <> 'active') = 0, 'Anonymous shopper sees only active products (drafts and rejected hidden)');
  perform test.throws($q$ select count(*) from public.orders $q$, 'permission denied', 'Anonymous has no access to orders at all');
end $$;
reset role;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ begin
  perform test.ok((select count(*) from public.orders where id = test.get('order1')::uuid) = 0, 'Customer B cannot read Customer A''s order by ID');
  perform test.ok((select count(*) from public.customer_addresses) = 1, 'Customer sees only own address book');
  perform test.throws($q$ select * from finance.vendor_ledger $q$, 'permission denied', 'Customer has no access to finance schema');
  perform test.throws($q$ select finance.generate_settlement_batch('weekly') $q$, 'permission denied', 'Customer cannot call finance functions');
  perform test.throws($q$ update public.orders set grand_total = 1 $q$, 'permission denied', 'Customer cannot edit order totals');
end $$;
do $$ begin perform test.act_as(test.id('v2_owner')); end $$;
do $$ begin
  perform test.ok((select count(*) from public.sub_orders) = (select count(*) from public.sub_orders where vendor_id = test.id('vendor2')), 'Vendor 2 sees only its own sub-orders');
  perform test.ok((select count(*) from public.sub_orders where vendor_id = test.id('vendor1')) = 0, 'Vendor 2 cannot see Vendor 1 sub-orders');
  perform test.throws($q$ insert into public.products(vendor_id, category_id, title, slug) values (test.id('vendor1'), test.id('cat'), 'Spoof', 'spoof') $q$, 'row-level security', 'Vendor cannot create products for another vendor');
  perform test.throws($q$ insert into public.products(vendor_id, category_id, title, slug, status) values (test.id('vendor2'), test.id('cat'), 'Self Live', 'self-live', 'active') $q$, 'row-level security', 'Vendor cannot publish without moderation');
end $$;
reset role;

\echo '== 11. Books balance'
do $$ declare dr numeric; cr numeric; begin
  select sum(debit), sum(credit) into dr, cr from finance.journal_lines l join finance.journal_entries j on j.id = l.journal_id where j.status in ('posted','reversed');
  perform test.ok(dr = cr, format('Trial balance: total debits %s = total credits %s', dr, cr));
end $$;
\echo 'ALL TESTS PASSED'
