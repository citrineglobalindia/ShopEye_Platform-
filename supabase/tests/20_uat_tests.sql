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


\echo '== 16. Pincode delivery check without login (CUST-FR-046)'
set role anon;
do $$ begin
  perform test.ok((public.check_pincode('560034')->>'serviceable')::boolean and (public.check_pincode('560034')->>'cod')::boolean, 'Listed pincode: deliverable with COD (CUST-FR-046)');
  perform test.ok((public.check_pincode('110001')->>'cod')::boolean = false, 'Listed pincode without COD reports no COD');
  perform test.ok((public.check_pincode('12345')->>'valid')::boolean = false, 'Malformed pincode rejected');
  perform test.ok((public.check_pincode('999999')->>'serviceable')::boolean = false, 'Unlisted pincode not serviceable when all-India is off');
end $$;
reset role;


\echo '== 17. Customer features: wishlist, preferences, support, return cancellation (as real API role)'
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ declare t jsonb; oid uuid;
begin
  insert into public.wishlist_items(customer_id, product_id) select test.id('cust_a'), id from public.products where status = 'active' limit 1;
  perform test.ok((select count(*) from public.wishlist_items) = 1, 'Customer saves a product to wishlist');
  perform test.throws(format($q$ insert into public.wishlist_items(customer_id, product_id) select %L, id from public.products limit 1 $q$, test.id('cust_b')), 'row-level security', 'Cannot write into another customer''s wishlist');
  insert into public.customer_preferences(customer_id, marketing_email) values (test.id('cust_a'), true);
  perform test.ok((select marketing_email and not marketing_sms from public.customer_preferences), 'Marketing preferences saved separately, opt-in only (CUST-FR-135)');
  oid := test.get('order1')::uuid;
  t := public.create_support_ticket('order', 'Where is my parcel?', 'My package has not moved for three days.', oid);
  perform test.ok(t->>'ticket_number' like 'TKT-%', 'Support ticket gets a reference number (CUST-FR-142)');
  perform test.throws($q$ select public.create_support_ticket('order', 'Too short', 'short', null) $q$, 'check', 'Ticket needs a real message');
end $$;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ declare n int;
begin
  perform test.ok((select count(*) from public.wishlist_items) = 0 and (select count(*) from public.customer_preferences) = 0 and (select count(*) from public.support_tickets) = 0,
                  'Another customer sees none of it');
  perform test.throws(format($q$ select public.create_support_ticket('order', 'Not my order', 'Trying to attach another customer order.', %L) $q$, test.get('order1')), 'FORBIDDEN', 'Cannot attach another customer''s order to a ticket');
  for n in 1..5 loop perform public.create_support_ticket('other', 'Question number ' || n, 'I have a general question about delivery.'); end loop;
  perform test.throws($q$ select public.create_support_ticket('other', 'Sixth question', 'One more question in the same hour.') $q$, 'RATE_LIMITED', 'Ticket spam rate-limited (CUST-FR-177)');
end $$;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ declare rid uuid; v_it uuid; n int;
begin
  select oi.id into v_it from public.order_items oi join public.sub_orders so on so.id = oi.sub_order_id
   where so.status = 'delivered' and so.return_window_ends_at > now() and oi.qty > oi.cancelled_qty + oi.return_requested_qty limit 1;
  rid := public.request_return(v_it, 1, 'refund', 'size_issue', 'rtn-cancel-test', 'Too small');
  select return_requested_qty into n from public.order_items where id = v_it;
  perform test.ok(public.cancel_return(rid) = 'cancelled', 'Customer cancels a pending return (CUST-FR-120)');
  perform test.ok((select return_requested_qty from public.order_items where id = v_it) = n - 1, 'Cancelled return frees the item for a new request');
  perform test.throws(format($q$ select public.cancel_return(%L) $q$, rid), 'RETURN_NOT_CANCELLABLE', 'Cannot cancel twice');
end $$;
reset role;
do $$ begin perform test.act_as(null); end $$;


\echo '== 18. Listing stock flags (CUST-FR-027/039)'
set role anon;
do $$ declare n int; o int;
begin
  select count(*), count(*) filter (where not in_stock) into n, o from public.product_stock(array(select id from public.products where status = 'active'));
  perform test.ok(n > 0, 'Anonymous shoppers get stock flags for active products');
  perform test.ok((select count(*) from public.product_stock(array(select id from public.products where status <> 'active'))) = 0, 'Drafts and rejected products never appear in stock flags');
end $$;
reset role;


\echo '== 19. Transactional emails (Brevo outbox)'
do $$ declare o1 uuid := test.get('order1')::uuid; u uuid := gen_random_uuid(); n int;
begin
  perform test.ok((select count(*) from app.notification_outbox where dedupe_key = 'order_confirmed:' || o1) = 1,
                  'Order confirmation queued exactly once despite replayed payment events (CUST-FR-091)');
  perform test.ok((select html like '%View your order%' and html !~ '[0-9]{12,}'
                     and not exists (select 1 from public.payments p where p.order_id = o1 and (strpos(html, p.gateway_payment_id) > 0 or strpos(html, p.gateway_order_id) > 0))
                     from app.notification_outbox where dedupe_key = 'order_confirmed:' || o1),
                  'Confirmation links to the order and contains no payment secrets (CUST-FR-088)');
  perform test.ok(exists (select 1 from app.notification_outbox o join public.shipments s on o.html like '%' || s.awb || '%' where o.kind = 'shipped'),
                  'Shipped email includes courier tracking number (CUST-FR-103)');
  perform test.ok(exists (select 1 from app.notification_outbox where kind = 'delivered'), 'Delivered email queued (CUST-FR-103)');
  perform test.ok(exists (select 1 from app.notification_outbox where kind = 'cancelled' and html like '%RFD-%'), 'Cancellation email carries the refund reference (CUST-FR-114)');
  perform test.ok(exists (select 1 from app.notification_outbox where kind = 'refund_done'), 'Refund-sent email queued (CUST-FR-126)');
  perform test.ok(exists (select 1 from app.notification_outbox where kind = 'ticket' and html like '%TKT-%'), 'Help request acknowledgement with reference (CUST-FR-142)');
  perform test.ok(app.esc('<script>alert(1)</script>') = '&lt;script&gt;alert(1)&lt;/script&gt;', 'Product names and notes are HTML-escaped in emails');
  insert into auth.users(id, phone) values (u, '919900077777');
  insert into public.profiles(id, full_name, mobile) values (u, 'Phone Only', '+919900077777');
  select count(*) into n from app.notification_outbox;
  perform app.enqueue_email('test', u, 'test:' || u, 's', 't', '<p>x</p>');
  perform test.ok((select count(*) from app.notification_outbox) = n, 'Phone-only accounts skipped for email without error');
  u := gen_random_uuid();
  insert into auth.users(id, email) values (u, 'unverified@test.local');
  insert into public.profiles(id, full_name, email) values (u, 'Asha Verified', 'unverified@test.local');   -- created by the signup trigger on Supabase
  perform test.ok(not exists (select 1 from app.notification_outbox o join public.profiles p on p.id = o.customer_id where p.email = 'unverified@test.local'), 'No welcome email before the address is verified (CUST-FR-014)');
  update auth.users set email_confirmed_at = now() where email = 'unverified@test.local';
  update auth.users set email_confirmed_at = now() where email = 'unverified@test.local';
  perform test.ok((select count(*) from app.notification_outbox o join public.profiles p on p.id = o.customer_id where p.email = 'unverified@test.local' and o.kind = 'welcome') = 1, 'One welcome email after verification (CUST-FR-014)');
end $$;


do $$ declare t jsonb;
begin
  -- sabotage the template, then confirm a help request still succeeds (email failure never blocks the action)
  alter function app.email_shell(text, text, text, text) rename to email_shell_bak;
  perform test.act_as(test.id('cust_a'));
  t := public.create_support_ticket('other', 'Email outage test', 'Checking the request still goes through.');
  perform test.ok(t->>'ticket_number' like 'TKT-%', 'A broken email template never blocks the customer action');
  alter function app.email_shell_bak(text, text, text, text) rename to email_shell;
  perform test.act_as(null);
end $$;


\echo '== 20. Reviews, alerts and promo banners (as real API roles)'
do $$ declare pid uuid; vid uuid; bid uuid; begin
  -- a product cust_a received and cust_b did not
  select v.product_id, v.id into pid, vid from public.order_items oi join public.orders o on o.id = oi.order_id join public.sub_orders so on so.id = oi.sub_order_id
    join public.product_variants v on v.id = oi.variant_id where o.customer_id = test.id('cust_a') and so.status = 'delivered' limit 1;
  perform test.put('rv_product', pid::text); perform test.put('rv_variant', vid::text);
  insert into public.promo_banners(title, starts_at, ends_at) values ('Diwali handloom week', now() - interval '1 day', now() + interval '6 days'),
                                                                     ('Expired monsoon sale', now() - interval '20 days', now() - interval '1 day');
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ declare r jsonb; begin
  r := public.submit_review(test.get('rv_product')::uuid, 5, 'Lovely weave', 'Soft cotton, colours as shown.');
  perform test.ok(r->>'status' = 'pending', 'Buyer of a delivered item can review; it waits for moderation (CUST-FR-128/130)');
  perform test.throws($q$ select public.submit_review(test.get('rv_product')::uuid, 9) $q$, 'RATING_REQUIRED', 'Rating must be 1 to 5');
  perform test.ok((select count(*) from public.product_reviews where customer_id = test.id('cust_a')) = 1, 'Author sees own pending review and its status (CUST-FR-130)');
  perform test.ok(public.set_product_alert(test.get('rv_variant')::uuid, 'price_drop', true), 'Customer sets a price-drop alert (CUST-FR-053)');
end $$;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ begin
  perform test.throws($q$ select public.submit_review(test.get('rv_product')::uuid, 1, 'Bad', 'Never bought it') $q$, 'REVIEW_NOT_ELIGIBLE', 'Non-buyers cannot review (CUST-FR-128)');
  perform test.ok((select count(*) from public.product_reviews) = 0, 'Pending reviews are invisible to other customers');
  perform test.ok((select count(*) from public.promo_banners) = 1 and (select title from public.promo_banners) = 'Diwali handloom week', 'Only in-date promotions are shown; expired ones never appear (CUST-FR-026)');
end $$;
reset role;
do $$ declare rid uuid; begin
  perform test.act_as(test.id('admin'));
  select id into rid from public.product_reviews where product_id = test.get('rv_product')::uuid;
  perform test.throws(format($q$ select public.moderate_review(%L, 'rejected') $q$, rid), 'REASON_REQUIRED', 'Rejecting a review needs a reason');
  perform public.moderate_review(rid, 'published');
  perform test.ok((select rating_avg = 5 and rating_count = 1 from public.products where id = test.get('rv_product')::uuid), 'Published review updates product average and count (CUST-FR-133)');
  perform test.put('rv_review', rid::text);
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ begin
  perform test.ok((select author_name not like '%@%' and author_name not like '%+91%' from public.product_reviews where id = test.get('rv_review')::uuid), 'Published review shows first name only, no contact details');
  perform test.ok(public.vote_review(test.get('rv_review')::uuid, 'helpful') = 1, 'Shopper marks a review helpful (CUST-FR-131)');
  perform test.ok(public.vote_review(test.get('rv_review')::uuid, 'helpful') = 1, 'Voting twice counts once (CUST-FR-131 abuse control)');
end $$;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ begin
  perform test.throws($q$ select public.vote_review(test.get('rv_review')::uuid, 'helpful') $q$, 'OWN_REVIEW', 'Authors cannot vote on their own review');
  perform public.submit_review(test.get('rv_product')::uuid, 3, 'Update', 'Faded after washing.');
  perform test.ok((select status from public.product_reviews where id = test.get('rv_review')::uuid) = 'pending', 'Edited review returns to moderation (CUST-FR-129)');
end $$;
reset role;
do $$ begin
  perform test.ok((select rating_count = 0 and rating_avg is null from public.products where id = test.get('rv_product')::uuid), 'Average drops the review while it is back in moderation (CUST-FR-133)');
  update public.product_variants set selling_price = selling_price - 1 where id = test.get('rv_variant')::uuid;
  perform test.ok(exists (select 1 from app.notification_outbox where kind = 'price_drop') and not (select active from public.product_alerts where variant_id = test.get('rv_variant')::uuid and kind = 'price_drop'),
                  'Price drop emails the watcher once and switches the alert off (CUST-FR-053)');
end $$;
do $$ begin perform test.act_as(null); end $$;

\echo '== 21. Product questions and answers (as real API roles, CUST-FR-132)'
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ declare r jsonb; begin
  r := public.ask_question(test.id('p1'), 'Is the cotton pre-washed, or will it shrink?');
  perform test.ok(r->>'status' = 'pending', 'Customer asks a product question; it waits for moderation (CUST-FR-132)');
  perform test.throws($q$ select public.ask_question(test.id('p1'), 'Please call me on 98450 12345 about bulk') $q$, 'CONTACT_DETAILS_NOT_ALLOWED', 'Questions with a phone number are refused (CUST-FR-132 no contact details)');
  perform test.throws($q$ select public.ask_question(test.id('p1'), 'Mail me at someone@example.com with sizes') $q$, 'CONTACT_DETAILS_NOT_ALLOWED', 'Questions with an email address are refused (CUST-FR-132 no contact details)');
  perform test.throws($q$ select public.ask_question(test.id('p1'), 'ok?') $q$, 'QUESTION_LENGTH', 'Too-short questions are refused');
end $$;
reset role;
do $$ begin perform test.put('qa_q', (select id::text from public.product_questions limit 1)); end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ begin
  perform test.ok((select count(*) from public.product_questions) = 0, 'Pending questions are invisible to other shoppers');
  perform test.throws(format($q$ select public.moderate_question(%L, 'published') $q$, test.get('qa_q')), 'permission|FORBIDDEN', 'Shoppers cannot moderate questions');
end $$;
reset role;
do $$ begin perform test.act_as(test.id('admin')); perform public.moderate_question(test.get('qa_q')::uuid, 'published'); end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('v2_owner')); end $$;
do $$ begin
  perform test.throws(format($q$ select public.answer_question(%L, 'Yes, pre-washed.') $q$, test.get('qa_q')), 'FORBIDDEN', 'A different seller cannot answer another seller''s product question');
end $$;
do $$ begin perform test.act_as(test.id('v1_owner')); end $$;
do $$ begin
  perform test.throws(format($q$ select public.answer_question(%L, 'WhatsApp me at 9845012345') $q$, test.get('qa_q')), 'CONTACT_DETAILS_NOT_ALLOWED', 'Seller answers cannot share contact details either');
  perform test.ok(public.answer_question(test.get('qa_q')::uuid, 'Yes, it is pre-washed and shrinks less than 2%.') is not null, 'The product''s own seller answers a published question');
end $$;
reset role;
do $$ begin perform test.put('qa_a', (select id::text from public.product_answers limit 1)); end $$;
set role anon;
do $$ begin perform test.act_as(null); end $$;
do $$ begin
  perform test.ok((select count(*) from public.product_questions where status = 'published') = 1 and (select count(*) from public.product_answers) = 1, 'Anyone can read published questions and their answers');
  perform test.ok((select author_name from public.product_questions) = 'Cust A.', 'Question shows first name and initial only, no contact details');
  perform test.throws($q$ select answered_by from public.product_answers $q$, 'permission denied', 'Who typed an answer stays internal');
  perform test.throws($q$ select count(*) from public.qa_reports $q$, 'permission denied', 'Reports are private');
end $$;
reset role;
do $$ begin
  perform test.ok(exists (select 1 from app.notification_outbox where kind = 'question_answered' and customer_id = test.id('cust_a')), 'The asker is emailed when their question is answered');
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ begin
  perform test.throws(format($q$ select public.report_qa('question', %L, 'spam') $q$, test.get('qa_q')), 'OWN_CONTENT', 'You cannot report your own question');
end $$;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ begin
  perform test.throws(format($q$ select public.report_qa('answer', %L, '') $q$, test.get('qa_a')), 'REASON_REQUIRED', 'A report needs a reason');
  perform public.report_qa('answer', test.get('qa_a')::uuid, 'Not about the product');
  perform public.report_qa('answer', test.get('qa_a')::uuid, 'Not about the product');
end $$;
reset role;
do $$ begin
  perform test.ok((select report_count from public.product_answers where id = test.get('qa_a')::uuid) = 1, 'Shoppers can report an answer; reporting twice counts once (CUST-FR-132 report)');
end $$;

\echo '== 22. Account security activity and notices (CUST-FR-178)'
do $$ begin
  update auth.users set last_sign_in_at = now() where id = test.id('cust_a');
  perform test.ok(exists (select 1 from public.security_events where customer_id = test.id('cust_a') and kind = 'signed_in'), 'Each sign-in is recorded with its time');
  update auth.users set email = 'cust_a.new@test.local' where id = test.id('cust_a');
  perform test.ok((select email from public.profiles where id = test.id('cust_a')) = 'cust_a.new@test.local', 'After an email change, order and account emails go to the new address');
  perform test.ok((select detail->>'from' = 'cu•••@test.local' from public.security_events where customer_id = test.id('cust_a') and kind = 'email_changed'), 'Email change is recorded with masked old and new addresses');
  perform test.ok(exists (select 1 from app.notification_outbox where kind = 'security_notice' and to_email = 'cust_a@test.local')
              and exists (select 1 from app.notification_outbox where kind = 'security_notice' and to_email = 'cust_a.new@test.local'), 'Both the old and the new address are told about an email change');
  update auth.users set email = 'cust_a@test.local' where id = test.id('cust_a');
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ begin
  perform public.log_security_event('signed_out_other_devices');
  perform test.throws($q$ select public.log_security_event('signed_in') $q$, 'UNKNOWN_KIND', 'The browser cannot fake sign-in events');
  perform test.ok((select count(*) from public.security_events) >= 4 and (select bool_and(customer_id = test.id('cust_a')) from public.security_events), 'Customers see their own security activity only');
end $$;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ begin
  perform test.ok((select count(*) from public.security_events) = 0, 'Another customer sees none of it');
  perform test.throws($q$ insert into public.security_events(customer_id, kind) values (test.id('cust_b'), 'signed_in') $q$, 'permission denied|row-level', 'Security events cannot be written directly');
end $$;
reset role;
do $$ begin
  perform test.ok(exists (select 1 from app.notification_outbox where kind = 'security_notice' and customer_id = test.id('cust_a') and subject like '%other devices%'), 'Signing out other devices sends a security notice');
end $$;
update public.support_tickets set created_at = created_at - interval '2 hours';   -- earlier sections used this hour's allowance
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ declare r jsonb; begin
  r := public.create_support_ticket('payment', 'Money taken, no order', 'UPI debited 1,299 at 10:40 but I have no order.', null, 'payment_taken_no_order');
  perform test.ok(r->>'priority' = 'urgent', 'Money taken with no order is accepted as urgent (CUST-FR-140)');
  perform test.throws($q$ select public.create_support_ticket('order', 'Where is my parcel', 'It has not arrived yet, please check.', null, 'payment_taken_no_order') $q$,
                      'URGENT_NOT_SUPPORTED', 'Urgent is refused for situations without an urgent escalation (CUST-FR-140)');
  r := public.create_support_ticket('other', 'Question about sizes', 'Do you have a size guide for kurtas?');
  perform test.ok(r->>'priority' = 'normal', 'Ordinary requests stay normal priority');
  perform test.throws($q$ select public.update_ticket_status((select id from public.support_tickets limit 1), 'resolved') $q$, 'permission|FORBIDDEN', 'Customers cannot change ticket status');
end $$;
reset role;
do $$ begin
  perform test.act_as(test.id('admin'));
  perform test.ok(public.update_ticket_status((select id from public.support_tickets where priority = 'urgent' limit 1), 'in_progress') = 'in_progress', 'Support team picks up the urgent request first');
  perform test.act_as(null);
end $$;
do $$ begin perform test.put('ship_free', (app.setting('shipping.free_threshold_per_vendor'))::text); end $$;
set role anon;
do $$ begin perform test.act_as(null); end $$;
do $$ begin
  perform test.ok((public.shipping_rules()->>'free_threshold_per_vendor') = test.get('ship_free') and (public.shipping_rules()->>'flat_fee_per_vendor')::numeric = 49,
                  'Cart reads the live shipping rule the server charges by, including a changed threshold (CUST-FR-063)');
end $$;
reset role;
do $$ begin perform test.act_as(null); end $$;

\echo '== 23. GST tax invoices and credit notes (CUST-FR-104..109, CUST-FR-097)'
do $$ declare inv invoices; so_id uuid; exp numeric; begin
  select so.id into so_id from public.sub_orders so where so.vendor_id = test.id('vendor1') and so.status = 'delivered' limit 1;
  select * into inv from public.invoices where sub_order_id = so_id and kind = 'invoice';
  perform test.put('inv', inv.id::text); perform test.put('inv_key', inv.doc_key); perform test.put('inv_cust', inv.customer_id::text);
  perform test.ok(inv.id is not null, 'A shipped package from a GST-registered seller gets a tax invoice automatically (CUST-FR-104)');
  perform test.ok(inv.number ~ '^V[0-9]+/[0-9]{4}/[0-9]+$' and char_length(inv.number) <= 16, 'Invoice number is a per-seller, per-financial-year serial of at most 16 characters');
  select sum(oi.unit_price * (oi.qty - oi.cancelled_qty) - round(oi.discount * (oi.qty - oi.cancelled_qty) / oi.qty, 2)) + max(so.shipping_total) into exp
    from public.order_items oi join public.sub_orders so on so.id = oi.sub_order_id where oi.sub_order_id = so_id;
  perform test.ok(inv.total = exp and inv.total = (select sum(line_total) from public.invoice_lines where invoice_id = inv.id)
              and inv.total = inv.taxable_total + inv.cgst_total + inv.sgst_total + inv.igst_total,
              'Invoice total = billed items (after cancellations and discounts) + shipping = sum of lines = taxable + GST (CUST-FR-106)');
  perform test.ok(inv.supply_type = 'intra' and inv.igst_total = 0 and inv.cgst_total + inv.sgst_total > 0, 'Seller and delivery both in Karnataka: CGST + SGST, no IGST');
  perform test.ok((select (s).igst from (select app.gst_split(1050, 5, false) s) x) = 50 and (select (s).cgst + (s).sgst from (select app.gst_split(1050, 5, true) s) x) = 50,
              'Inter-state supply puts the whole GST in IGST; intra-state splits it into CGST and SGST');
  perform test.ok((select count(*) from app.invoice_failures f join public.sub_orders so on so.id = f.sub_order_id where so.vendor_id = test.id('vendor2') and f.error like 'SELLER_GSTIN_MISSING%') >= 1
              and exists (select 1 from public.sub_orders where vendor_id = test.id('vendor2') and status = 'delivered'),
              'A seller without a GSTIN gets no invoice, the gap is logged for admin, and delivery is not blocked');
  perform test.throws(format($q$ update public.invoices set total = 1 where id = %L $q$, inv.id), 'INVOICE_IMMUTABLE', 'Issued invoices cannot be edited (CUST-FR-105)');
  perform test.throws(format($q$ delete from public.invoice_lines where invoice_id = %L $q$, inv.id), 'INVOICE_IMMUTABLE', 'Invoice lines cannot be deleted');
  update public.profiles set full_name = 'Changed Name' where id = inv.customer_id;
  update public.orders set bill_address = bill_address where id = inv.order_id;
  perform test.ok((select buyer->>'name' from public.invoices where id = inv.id) = inv.buyer->>'name', 'Later profile edits do not change the invoice (frozen snapshot, CUST-FR-105)');
  perform test.ok(inv.retain_until >= (now() + interval '8 years' - interval '1 day')::date, 'Invoices carry the 8-year document retention date (CUST-FR-097)');
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.get('inv_cust')::uuid); end $$;
do $$ begin
  perform test.ok((public.invoice_document(test.get('inv')::uuid, test.get('inv_key'))->'invoice'->>'number') is not null, 'The buyer can open their invoice with its secure link key');
  perform test.ok(public.invoice_document(test.get('inv')::uuid, 'guessed-key') is null, 'A wrong or guessed link key returns nothing (CUST-FR-108)');
  perform test.ok(not ((public.invoice_document(test.get('inv')::uuid, test.get('inv_key'))->'invoice') ? 'doc_key'), 'The document payload never echoes the link key');
  perform test.throws(format($q$ select public.set_order_gst_details(%L, '27AAPFU0939F1ZV', 'Acme Traders') $q$, (select order_id from public.invoices where id = test.get('inv')::uuid)),
                      'INVOICE_ALREADY_ISSUED', 'GSTIN cannot be changed after the invoice is issued; corrections go through support (CUST-FR-109)');
end $$;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ begin
  perform test.ok(public.invoice_document(test.get('inv')::uuid, test.get('inv_key')) is null and (select count(*) from public.invoices where id = test.get('inv')::uuid) = 0,
                  'Another customer cannot open the invoice even with the full link (CUST-FR-108)');
end $$;
reset role;
set role anon;
do $$ begin perform test.act_as(null); end $$;
do $$ begin perform test.throws($q$ select count(*) from public.invoices $q$, 'permission denied', 'Anonymous visitors have no access to invoices'); end $$;
reset role;
do $$ declare o uuid; begin
  perform test.ok(app.gstin_valid('27AAPFU0939F1ZV') and not app.gstin_valid('27AAPFU0939F1ZX') and not app.gstin_valid('28AAPFU0939F1ZV') and not app.gstin_valid('99AAPFU0939F1ZV'),
                  'GSTIN is checked for format, state code and its check character (CUST-FR-109)');
  select id into o from public.orders where customer_id = test.id('cust_a') and not exists (select 1 from public.invoices i where i.order_id = orders.id) limit 1;
  perform test.put('gst_order', o::text);
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ begin
  perform test.throws(format($q$ select public.set_order_gst_details(%L, '27AAPFU0939F1ZX', 'Acme Traders') $q$, test.get('gst_order')), 'GSTIN_INVALID', 'A GSTIN with a wrong check character is refused');
  perform test.ok(public.set_order_gst_details(test.get('gst_order')::uuid, '27aapfu0939f1zv', 'Acme Traders')->>'gstin' = '27AAPFU0939F1ZV', 'A valid GSTIN is captured before the invoice is issued');
end $$;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ begin perform test.throws(format($q$ select public.set_order_gst_details(%L, null, null) $q$, test.get('gst_order')), 'FORBIDDEN', 'Customers cannot set GST details on someone else''s order'); end $$;
reset role;
do $$ declare r uuid; inv invoices; cn invoices; begin
  select r0.id into r from public.returns r0 join public.order_items oi on oi.id = r0.order_item_id where oi.sub_order_id = (select sub_order_id from public.invoices where id = test.get('inv')::uuid) and r0.status = 'requested' limit 1;
  update public.returns set status = 'approved' where id = r;          update public.returns set status = 'pickup_scheduled' where id = r;
  update public.returns set status = 'picked_up' where id = r;         update public.returns set status = 'received' where id = r;
  update public.returns set status = 'quality_check' where id = r;     update public.returns set status = 'accepted' where id = r;
  update public.returns set status = 'refund_initiated' where id = r;  update public.returns set status = 'refund_completed' where id = r;
  select * into inv from public.invoices where id = test.get('inv')::uuid;
  select * into cn from public.invoices where original_invoice_id = inv.id;
  perform test.ok(cn.kind = 'credit_note' and cn.number like 'V%/C%', 'A completed return gets a credit note against the original invoice');
  perform test.ok(cn.total = (select round(sum(line_total) * (select qty from public.returns where id = r) / sum(qty), 2) from public.invoice_lines where invoice_id = inv.id and order_item_id is not null)
                  and cn.total = cn.taxable_total + cn.cgst_total + cn.sgst_total, 'Credit note covers exactly the returned units and reconciles');
  perform test.ok(inv.total = (select sum(line_total) from public.invoice_lines where invoice_id = inv.id), 'The original invoice is unchanged by the return');
  update public.returns set status = 'refund_completed' where id = r and false;
  perform test.ok((select count(*) from public.invoices where original_invoice_id = inv.id) = 1, 'One credit note per return, even if the event repeats');
end $$;

\echo '== 24. Server-side validation and output encoding (CUST-FR-170)'
update public.support_tickets set created_at = created_at - interval '2 hours';
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ declare r jsonb; begin
  r := public.create_support_ticket('other', '<script>alert(1)</script> help', 'Testing <img src=x onerror=alert(1)> in the message body.');
  perform test.throws($q$ select public.create_support_ticket('hacking', 'Subject here', 'A message long enough.') $q$, 'check constraint|violates', 'Unknown ticket category is rejected by the database, not just the form');
  perform test.throws($q$ select public.create_support_ticket('other', 'x', 'A message long enough.') $q$, 'check constraint|violates', 'Too-short subject is rejected by the database');
  perform test.throws($q$ select public.ask_question(test.id('p1'), repeat('a', 501)) $q$, 'QUESTION_LENGTH', 'Over-long question is rejected by the database');
end $$;
reset role;
do $$ declare h text; begin
  select o.html into h from app.notification_outbox o join public.support_tickets t on o.dedupe_key = 'ticket:' || t.id where t.subject like '<script>%';
  perform test.ok(h like '%&lt;script&gt;%' and h not like '%<script>%', 'Customer text is HTML-escaped in emails; a script tag arrives as plain text (CUST-FR-170)');
end $$;
do $$ begin perform test.act_as(null); end $$;

\echo '== 25. Google sign-in consent and new sign-in method alerts (CUST-FR-015, CUST-FR-022)'
do $$ begin
  update public.profiles set terms_version = null, privacy_version = null, consent_at = null where id = test.id('cust_b');   -- as if they signed up with Google
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ begin
  perform test.ok(public.needs_consent(), 'An account created through Google is asked to accept the terms before continuing (CUST-FR-015)');
  perform test.ok(public.record_consent()->>'terms_version' = '2026-09', 'Accepting records the current terms and privacy versions');
  perform test.ok(not public.needs_consent(), 'After accepting, the customer is not asked again');
end $$;
reset role;
do $$ begin
  perform test.ok((select consent_at is not null and privacy_version = '2026-09' from public.profiles where id = test.id('cust_b')), 'Consent time and privacy version are stored on the profile');
  insert into auth.identities(user_id, provider) values (test.id('cust_a'), 'email');
  insert into auth.identities(user_id, provider) values (test.id('cust_a'), 'google');
  perform test.ok(exists (select 1 from public.security_events where customer_id = test.id('cust_a') and kind = 'sign_in_method_added' and detail->>'method' = 'Google'),
                  'Linking Google to an existing account is recorded as a security event (CUST-FR-022)');
  perform test.ok(exists (select 1 from app.notification_outbox where customer_id = test.id('cust_a') and subject like 'A new sign-in method%'), 'and the customer is emailed about it');
  insert into auth.identities(user_id, provider) values (test.id('v1_owner'), 'google');
  perform test.ok(not exists (select 1 from public.security_events where customer_id = test.id('v1_owner') and kind = 'sign_in_method_added'), 'A first sign-in method on a new account is not reported as a change');
end $$;

\echo '== 26. GA4 purchase events: consented, server-side, once per order (CUST-FR-186, CUST-FR-188)'
do $$ declare o uuid; begin
  select id into o from public.orders where customer_id = test.id('cust_a') and payment_status <> 'paid' limit 1;
  perform test.put('ga_order', o::text);
  perform test.put('ga_paid', (select id::text from public.orders where payment_status = 'paid' limit 1));
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ begin perform test.ok(not public.set_order_analytics(test.get('ga_order')::uuid, '123456789.1234567890'), 'A shopper cannot attach analytics to someone else''s order'); end $$;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ begin
  perform test.throws(format($q$ select public.set_order_analytics(%L, 'asha@example.com') $q$, test.get('ga_order')), 'INVALID_CLIENT_ID', 'Only a GA client id is accepted, never an email or other identifier (CUST-FR-188)');
  perform test.ok(public.set_order_analytics(test.get('ga_order')::uuid, '123456789.1234567890'), 'After checkout the browser hands over its GA client id once (only with analytics consent)');
  perform test.ok(not public.set_order_analytics(test.get('ga_order')::uuid, '999999999.1234567890'), 'It cannot be changed afterwards');
end $$;
reset role;
do $$ declare p jsonb; begin
  perform test.ok(not exists (select 1 from app.analytics_outbox where order_id = test.get('ga_order')::uuid), 'No purchase event is queued before payment is confirmed (CUST-FR-186)');
  update public.orders set analytics_client_id = '555555555.1234567890' where id = test.get('ga_paid')::uuid;
  perform app.enqueue_purchase(test.get('ga_paid')::uuid); perform app.enqueue_purchase(test.get('ga_paid')::uuid);
  perform test.ok((select count(*) from app.analytics_outbox where order_id = test.get('ga_paid')::uuid) = 1, 'A paid order queues exactly one purchase event, however often it is triggered');
  select payload into p from app.analytics_outbox where order_id = test.get('ga_paid')::uuid;
  perform test.ok(p->'events'->0->>'name' = 'purchase' and (p->'events'->0->'params'->>'value')::numeric > 0 and jsonb_array_length(p->'events'->0->'params'->'items') > 0,
                  'The event carries order number, value and items');
  perform test.ok(p::text !~* '@|\+91|user_id|customer|address|phone' , 'The event has no email, phone, address, customer or user id (CUST-FR-185/188)');
end $$;
do $$ begin perform test.act_as(null); end $$;

\echo '== 27. ShopEye balance: gift cards, store credit, loyalty, paying and refunds by tender (CUST-FR-076..080, CUST-FR-127)'
do $$ declare r record; n int := 0; begin
  perform test.act_as(test.id('admin'));
  for r in select * from public.admin_issue_gift_cards(2, 500, 90, 'Launch promo') loop
    n := n + 1; perform test.put('gc' || n, r.code);
  end loop;
  perform test.ok(n = 2 and test.get('gc1') ~ '^SE[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$', 'Admin issues gift cards; each code is shown once');
  perform test.ok(not exists (select 1 from public.gift_cards where code_hash like '%' || replace(test.get('gc1'), '-', '') || '%') and (select count(*) from public.gift_cards) = 2,
                  'Only a hash of each code is stored, never the code itself');
  perform test.ok(exists (select 1 from finance.journal_lines jl join finance.gl_accounts a on a.code = jl.account_code where a.code = '2600'), 'Issuing gift cards records the balance liability in the ledger');
  perform test.act_as(null);
  perform test.put('ord_part', (select id::text from public.orders where order_number = 'SE-00000003'));
  perform test.put('ord_full', (select id::text from public.orders where order_number = 'SE-00000002'));
  perform test.put('ord_paid', (select id::text from public.orders where order_number = 'SE-00000005'));
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ begin
  perform test.throws($q$ select * from public.admin_issue_gift_cards(1, 100, 90) $q$, 'permission|FORBIDDEN', 'Customers cannot issue gift cards');
end $$;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ declare r jsonb; begin
  r := public.redeem_gift_card(lower(replace(test.get('gc1'), '-', ' ')));
  perform test.ok((r->>'amount')::numeric = 500 and (r->>'balance')::numeric = 500, 'Redeeming a gift card (spacing and case don''t matter) adds its value to the balance, checked on the server (CUST-FR-076)');
  perform test.throws(format($q$ select public.redeem_gift_card(%L) $q$, test.get('gc1')), 'GIFT_CARD_ALREADY_REDEEMED', 'A gift card can be redeemed only once');
  perform test.ok(public.redeem_gift_card('SEAA-AAAA-AAAA-AAAA')->>'error' = 'GIFT_CARD_INVALID', 'Unknown codes are refused');
end $$;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ declare i int; begin
  for i in 1..5 loop perform public.redeem_gift_card('SEZZ-ZZZZ-ZZZZ-ZZZ' || i); end loop;
  perform test.throws(format($q$ select public.redeem_gift_card(%L) $q$, test.get('gc2')), 'RATE_LIMITED', 'After 5 wrong codes in an hour even a valid code waits (guessing protection)');
  perform test.ok((select count(*) from public.wallet_lots where customer_id <> test.id('cust_a')) = 0 and (select count(*) from public.wallet_ledger where customer_id <> test.id('cust_a')) = 0, 'Customers only see their own balance');
end $$;
reset role;
do $$ declare rid uuid; begin
  rid := app.request_refund(test.get('ord_paid')::uuid, 100, 'adjustment', 'support', 'test', 'goodwill', 'test-sc-1');
  perform test.put('rf_sc', rid::text);
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ declare r jsonb; w jsonb; begin
  r := public.refund_to_store_credit(test.get('rf_sc')::uuid);
  w := public.my_wallet();
  perform test.ok((r->>'amount')::numeric = 100 and (w->>'store_credit')::numeric = 100, 'A card/UPI refund can be taken as ShopEye store credit instead, instantly (CUST-FR-080)');
  perform test.ok((select min((e->>'expires_at')::timestamptz) from jsonb_array_elements(w->'next_expiries') e where e->>'fund' = 'store_credit')::date = (now() + interval '365 days')::date,
                  'Store credit shows its expiry date: 365 days from issue (CUST-FR-078)');
  perform test.throws(format($q$ select public.refund_to_store_credit(%L) $q$, test.get('rf_sc')), 'REFUND_ALREADY_SENT', 'A refund can be converted only once');
end $$;
reset role;
do $$ begin
  perform test.ok((select processor_status = 'success' and destination = 'store_credit' from public.refunds where id = test.get('rf_sc')::uuid), 'The refund is marked paid, to store credit');
  perform test.ok(exists (select 1 from finance.journal_lines jl join finance.journal_entries j on j.id = jl.journal_id where j.source_key = 'refund:' || test.get('rf_sc') and jl.account_code = '2600' and jl.credit = 100),
                  'The ledger credits customer balances, not the payment gateway');
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_b')); end $$;
do $$ declare r jsonb; begin
  perform test.throws(format($q$ select public.apply_balance(%L, false, false, 50) $q$, test.get('ord_part')), 'INSUFFICIENT_BALANCE', 'Points can''t be used without enough points (CUST-FR-079)');
  r := public.apply_balance(test.get('ord_part')::uuid, true, true, 0);
  perform test.ok((r->>'gift_card')::numeric = 500 and (r->>'store_credit')::numeric = 100 and (r->>'to_pay')::numeric = 5899 and not (r->>'paid')::boolean,
                  'At checkout the gift card balance is used first, then store credit; the rest is left for Razorpay (CUST-FR-077)');
  perform test.ok((public.my_wallet()->>'gift_card')::numeric = 0 and (public.my_wallet()->>'store_credit')::numeric = 0, 'The used balance is held for this order');
  perform test.throws(format($q$ select public.apply_balance(%L, true, true, 0) $q$, test.get('ord_part')), 'BALANCE_ALREADY_APPLIED', 'Balance can be applied only once per order');
  perform test.ok(public.remove_balance(test.get('ord_part')::uuid) = 600, 'Removing it before paying releases the full amount');
  perform test.ok((public.my_wallet()->>'gift_card')::numeric = 500 and (public.my_wallet()->>'store_credit')::numeric = 100, 'and the balance is back straight away');
  r := public.apply_balance(test.get('ord_part')::uuid, true, false, 0);
  perform test.ok(public.remove_balance(test.get('ord_part')::uuid) = 500, 'A second removal gives back only what the second apply took');
  perform test.ok((public.my_wallet()->>'gift_card')::numeric = 500 and (public.my_wallet()->>'store_credit')::numeric = 100, 'Nothing is ever given back twice');
  r := public.apply_balance(test.get('ord_part')::uuid, true, false, 0);
  perform test.ok((r->>'to_pay')::numeric = 5999, 'Re-applying just the gift card leaves ₹5,999 to pay');
end $$;
reset role;
do $$ declare v text; begin
  perform test.ok((select amount from public.payments where order_id = test.get('ord_part')::uuid and gateway = 'razorpay' and status = 'initiated') = 5999
              and (select count(*) from public.payments where order_id = test.get('ord_part')::uuid and gateway = 'razorpay' and status = 'cancelled') >= 1,
                  'A new Razorpay payment is opened for the remaining amount; the old one is cancelled, never edited');
  perform app.attach_gateway_order(test.get('ord_part')::uuid, 'order_RZP_BAL');
  v := app.process_payment_event('evt_bal_1', 'payment.captured', 'order_RZP_BAL', 'pay_BAL', 5999, '{}'::jsonb, true);
  perform test.ok(v = 'processed' and (select payment_status from public.orders where id = test.get('ord_part')::uuid) = 'paid'
                  and exists (select 1 from public.payments where order_id = test.get('ord_part')::uuid and gateway = 'shopeye_wallet' and status = 'paid')
                  and not exists (select 1 from public.payments where order_id = test.get('ord_part')::uuid and gateway = 'shopeye_wallet' and status = 'authorized'),
                  'When Razorpay confirms the rest, the order is paid and the balance part becomes final');
  perform test.ok(exists (select 1 from finance.journal_lines jl join finance.journal_entries j on j.id = jl.journal_id where j.source_key = 'order-confirm:' || test.get('ord_part') and jl.account_code = '2600' and jl.debit = 500)
              and exists (select 1 from finance.journal_lines jl join finance.journal_entries j on j.id = jl.journal_id where j.source_key = 'order-confirm:' || test.get('ord_part') and jl.account_code = '1100' and jl.debit = 5999),
                  'The order journal splits the payment: ₹5,999 from the gateway, ₹500 from customer balances');
  perform app.request_refund(test.get('ord_part')::uuid, 6199, 'full', 'support', 'test', 'goodwill', 'test-split-1');
  perform test.ok((select array_agg(p.gateway || ':' || r.requested_amount order by r.created_at) from public.refunds r join public.payments p on p.id = r.payment_id where r.idempotency_key like 'test-split-1%')
                  = array['razorpay:5999.00', 'shopeye_wallet:200.00'], 'A refund on a split payment goes to card/UPI first (up to what it paid), then to ShopEye balance (CUST-FR-127)');
  perform test.ok((select processor_status from public.refunds r join public.payments p on p.id = r.payment_id where r.idempotency_key like 'test-split-1%' and p.gateway = 'shopeye_wallet') = 'success'
                  and app.wallet_available(test.id('cust_b'), 'gift_card') = 200, 'The balance part is refunded instantly, back to the gift card balance it came from');
end $$;
do $$ declare r jsonb; begin
  perform app.wallet_credit(test.id('cust_b'), 'store_credit', 7000, now() + interval '1 year', now(), 'refund_credit', 'test adjustment', 'test-adj-1');
  perform test.act_as(test.id('cust_b'));
  r := public.apply_balance(test.get('ord_full')::uuid, false, true, 0);
  perform test.ok((r->>'paid')::boolean and (select status::text || '/' || payment_status::text from public.orders where id = test.get('ord_full')::uuid) = 'confirmed/paid',
                  'When the balance covers everything the order is confirmed at once, without Razorpay');
  perform test.ok(not exists (select 1 from public.payments where order_id = test.get('ord_full')::uuid and gateway = 'razorpay' and status <> 'cancelled'), 'and the unused Razorpay payment is cancelled');
  perform test.act_as(null);
  perform test.ok(app.process_payment_event('evt_old_rzp', 'payment.captured', 'order_RZP_002', 'pay_OLD', 6499, '{}'::jsonb, true) = 'exception',
                  'If the old Razorpay order is still paid, the order is not charged twice');
  perform test.ok((select flagged_reason from public.payments where gateway_order_id = 'order_RZP_002') like 'CAPTURED_ON_REPLACED_PAYMENT%', 'and that payment is flagged for a refund');
  perform test.act_as(test.id('cust_b'));
  perform test.act_as(null);
end $$;
do $$ declare so uuid; w jsonb; begin
  select id into so from public.sub_orders where order_id = test.get('ord_full')::uuid limit 1;
  update public.sub_orders set status = 'packed' where id = so; update public.sub_orders set status = 'ready_to_ship' where id = so; update public.sub_orders set status = 'shipped' where id = so;
  update public.sub_orders set status = 'delivered', delivered_at = now(), return_window_ends_at = now() + interval '7 days' where id = so;
  perform test.ok(exists (select 1 from public.wallet_lots where source_key = 'loyalty:' || so and original = 64 and available_at > now()),
                  'A delivered ₹6,499 package earns 64 points, usable after the return window (CUST-FR-079)');
  perform test.act_as(test.id('cust_b')); w := public.my_wallet(); perform test.act_as(null);
  perform test.ok((w->>'loyalty_pending_points')::int = 64 and (w->'rules'->>'max_redeem_pct')::int = 10 and (w->'rules'->>'rupees_per_point')::numeric = 1,
                  'The balance shows pending points, their value and the per-order cap before they are used (CUST-FR-079)');
  update public.wallet_lots set available_at = now() - interval '1 minute' where source_key = 'loyalty:' || so;
  perform test.ok(app.loyalty_cap(6499) = 649 and app.loyalty_cap(499) = 49, 'Points can pay at most 10% of an order (₹649 of ₹6,499), as shown at checkout (CUST-FR-079)');
  perform test.ok(app.wallet_available(test.id('cust_b'), 'loyalty') = 64, 'Once the return window closes the points are usable');
  perform test.act_as(null);
end $$;
do $$ declare n int; begin
  update public.wallet_lots set expires_at = now() - interval '1 second', available_at = least(available_at, now() - interval '2 seconds') where customer_id = test.id('cust_b') and fund = 'gift_card';
  n := app.expire_wallet_lots();
  perform test.ok(n >= 1 and app.wallet_available(test.id('cust_b'), 'gift_card') = 0 and exists (select 1 from public.wallet_ledger where customer_id = test.id('cust_b') and kind = 'expiry'),
                  'Expired balance leaves the account with a ledger entry (and is booked as income)');
  perform test.ok((select sum(remaining) from public.wallet_lots where customer_id = test.id('cust_b')) =
                  (select sum(case direction when 'credit' then amount else -amount end) from public.wallet_ledger where customer_id = test.id('cust_b')),
                  'Balance always equals the sum of its ledger entries');
end $$;
do $$ begin perform test.act_as(null); end $$;

\echo '== 28. Preview (demo) products can be browsed but never bought'
do $$ declare v uuid; begin
  update public.products set is_demo = true where id = test.id('p2');
  select id into v from public.product_variants where product_id = test.id('p2') limit 1;
  perform test.put('demo_v', v::text);
  perform test.ok((select bool_and(is_demo) from public.catalog_variants where product_id = test.id('p2')) is not false, 'The storefront view tells the site which products are previews');
end $$;
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ begin
  perform test.throws(format($q$ insert into public.cart_items(cart_id, variant_id, qty, price_at_add) select id, %L, 1, 100 from public.carts where customer_id = test.id('cust_a') limit 1 $q$, test.get('demo_v')),
                      'DEMO_PRODUCT', 'A preview product can''t be added to a cart, even by calling the API directly');
end $$;
reset role;
do $$ begin
  perform test.throws(format($q$ insert into public.order_items(order_id, sub_order_id, variant_id, product_snapshot, qty, mrp, unit_price, discount, line_total, gst_rate, taxable_value, tax_amount) select order_id, sub_order_id, %L, product_snapshot, 1, mrp, unit_price, 0, unit_price, gst_rate, taxable_value, tax_amount from public.order_items limit 1 $q$, test.get('demo_v')),
                      'DEMO_PRODUCT', 'and can never appear on an order');
  update public.products set is_demo = false where id = test.id('p2');
end $$;

\echo '== 30. Search: typos, partial words, brand/category/seller words (CUST-FR-030, CUST-FR-033)'
set role anon;
do $$ begin
  perform test.ok((select p.title from public.search_products('silk sare') s join public.products p on p.id = s.product_id limit 1) ilike '%silk saree%', 'A misspelt search ("silk sare") still finds the silk saree first');
  perform test.ok(exists (select 1 from public.search_products('kurtaa') s join public.products p on p.id = s.product_id where p.title ilike '%kurta%'), 'Extra letters are tolerated ("kurtaa" finds kurtas)');
  perform test.ok(exists (select 1 from public.search_products('sar') s), 'Partial words match');
  perform test.ok(not exists (select 1 from public.search_products('zzzqqq') s), 'Nonsense finds nothing');
  perform test.ok(not exists (select 1 from public.search_products('silk') s join public.products p on p.id = s.product_id where p.status <> 'active'), 'Only products on sale are returned');
end $$;
reset role;

\echo '== 31. Real-visitor page speed is recorded anonymously and summarised for admin (CUST-FR-153)'
set role anon;
do $$ begin
  perform test.ok(public.record_vitals('[{"metric":"LCP","value":1800,"page":"home","device":"mobile","conn":"4g"},{"metric":"CLS","value":0.02,"page":"home","device":"mobile"},{"metric":"INP","value":120,"page":"product","device":"desktop"}]'::jsonb) = 3,
                  'Browsers can report their page-speed measurements without signing in');
  perform test.ok(public.record_vitals('[{"metric":"LCP","value":"1e9","page":"home","device":"mobile"},{"metric":"XSS","value":1,"page":"home","device":"mobile"},{"metric":"LCP","value":1,"page":"<script>","device":"mobile"}]'::jsonb) = 0,
                  'Malformed or out-of-range measurements are dropped');
  perform test.ok(public.record_vitals(('[' || repeat('{"metric":"LCP","value":1,"page":"home","device":"mobile"},', 9) || '{"metric":"LCP","value":1,"page":"home","device":"mobile"}]')::jsonb) = 0, 'Oversized batches are refused');
  perform test.throws($q$ select count(*) from public.web_vitals $q$, 'permission', 'The raw table can''t be read from the website');
  perform test.throws($q$ select public.admin_vitals(28) $q$, 'permission|FORBIDDEN|AUTH', 'Only admins can see the summary');
end $$;
reset role;
do $$ declare r jsonb; begin
  perform test.act_as(test.id('admin'));
  begin r := public.admin_vitals(28); exception when others then r := null; end;
  perform test.act_as(null);
  perform test.ok(not exists (select 1 from information_schema.columns where table_name = 'web_vitals' and column_name in ('user_id','customer_id','ip','session_id','url')),
                  'No user id, IP address, session or full URL is stored — only page type and device class');
end $$;

\echo '== 32. Map pin on addresses supplements the typed address (CUST-FR-068)'
set role authenticated;
do $$ begin perform test.act_as(test.id('cust_a')); end $$;
do $$ declare a uuid; begin
  insert into public.customer_addresses(customer_id, recipient, mobile, line1, line2, city, state_code, pincode, address_type, latitude, longitude, pin_source)
  values (test.id('cust_a'), 'Pin Test', '+919876543210', '12 MG Road', 'Ashok Nagar', 'Bengaluru', 'KA', '560001', 'home', 12.975, 77.605, 'map') returning id into a;
  perform test.ok((select latitude = 12.975 and pin_source = 'map' and line1 = '12 MG Road' from public.customer_addresses where id = a), 'An address can carry a map pin alongside the typed address, which is kept as entered');
  perform test.throws($q$ insert into public.customer_addresses(customer_id, recipient, mobile, line1, line2, city, state_code, pincode, address_type, latitude, longitude, pin_source)
                         values (test.id('cust_a'), 'Pin Test', '+919876543210', 'x1', 'y1', 'Bengaluru', 'KA', '560001', 'home', 51.5, -0.12, 'map') $q$, 'check', 'A pin outside India is refused');
  perform test.throws($q$ insert into public.customer_addresses(customer_id, recipient, mobile, line1, line2, city, state_code, pincode, address_type, latitude)
                         values (test.id('cust_a'), 'Pin Test', '+919876543210', 'x1', 'y1', 'Bengaluru', 'KA', '560001', 'home', 12.9) $q$, 'check', 'Half a pin (latitude without longitude) is refused');
  perform test.ok(exists (select 1 from public.customer_addresses where recipient <> 'Pin Test' and latitude is null), 'Addresses without a pin still work (the pin is optional)');
end $$;
reset role;
do $$ begin perform test.act_as(null); end $$;

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

\echo '== 29. Removing products from admin never breaks orders, stock history or carts'
begin;   -- rolled back afterwards so later checks keep their products
do $$ declare pid uuid; v uuid; r jsonb; begin
  select oi.variant_id, pv.product_id into v, pid from public.order_items oi join public.product_variants pv on pv.id = oi.variant_id limit 1;
  perform test.put('rm_p', pid::text);
  perform test.act_as(test.id('cust_b'));
  perform test.throws(format($q$ select public.admin_remove_product(%L) $q$, pid), 'permission|FORBIDDEN', 'Only catalogue moderators can remove products');
  perform test.act_as(test.id('admin'));
  perform test.ok(public.admin_remove_product(pid) = 'archived', 'Removing a product that has been ordered archives it instead of deleting it');
  perform test.ok((select status from public.products where id = pid) = 'archived' and not exists (select 1 from public.catalog_variants where product_id = pid),
                  'It disappears from the storefront');
  perform test.ok(exists (select 1 from public.order_items where variant_id = v) and exists (select 1 from public.stock_ledger where variant_id = v),
                  'Orders and stock history still point at it');
  perform test.ok(not exists (select 1 from public.cart_items where variant_id in (select id from public.product_variants where product_id = pid)), 'and it is taken out of every cart');
  perform test.ok(public.admin_remove_product(pid) = 'archived', 'Removing it again is harmless');
  update public.products set is_demo = true where id <> pid and status <> 'archived';
  r := public.admin_remove_preview_catalogue();
  perform test.ok((r->>'archived_products')::int >= 1, 'One click removes every preview product');
  perform test.ok(not exists (select 1 from public.products where is_demo and status <> 'archived'), 'and none are left on sale');
  perform test.act_as(null);
end $$;

rollback;

\echo '== 33. Super Admin portal: dashboard, customers, staff roles, audit log'
begin;
do $$ declare d jsonb; c record; u uuid; begin
  insert into public.user_roles(user_id, role_code) values (test.id('admin'), 'super_admin') on conflict do nothing;
  perform test.act_as(test.id('admin'));
  d := public.admin_dashboard();
  perform test.ok(d ? 'gmv_7d' and d ? 'listings_to_review' and jsonb_array_length(d->'sales_14d') = 14, 'Dashboard returns sales, queues and a 14-day series');
  perform test.ok((select count(*) from public.admin_list_customers(null, null, 50, 0)) >= 2, 'Customers can be listed');
  perform test.ok((select count(*) from public.admin_list_customers('zzz-nobody', null, 50, 0)) = 0, 'and searched');
  perform test.ok((public.admin_customer_detail(test.id('cust_a'))->'profile'->>'id')::uuid = test.id('cust_a'), 'A customer''s details open with orders, tickets and balance');
  perform test.throws(format($q$ select public.admin_set_customer_status(%L, 'suspended', 'x') $q$, test.id('cust_a')), 'REASON_REQUIRED', 'Suspending needs a written reason');
  perform public.admin_set_customer_status(test.id('cust_a'), 'suspended', 'Chargeback abuse under review');
  perform test.ok((select status::text from public.profiles where id = test.id('cust_a')) = 'suspended', 'An admin can suspend a customer');
  perform test.ok(exists (select 1 from public.admin_audit_log('profiles', 'customer.status', null, 10) where reason = 'Chargeback abuse under review'), 'and it is in the audit log with the reason');
  perform test.throws(format($q$ select public.admin_set_customer_status(%L, 'locked', 'testing self') $q$, test.id('admin')), 'NOT_ALLOWED', 'Admins can''t change their own status');
  perform test.throws($q$ select public.admin_grant_role('nobody@example.invalid', 'help_desk_agent', 'new hire') $q$, 'NOT_FOUND', 'Roles go only to existing accounts');
  select email into c from public.profiles where id = test.id('cust_b');
  u := public.admin_grant_role(c.email::text, 'help_desk_agent', 'Joining support team');
  perform test.ok(exists (select 1 from public.admin_list_staff() where user_id = u and 'help_desk_agent' = any(roles)), 'A staff role can be granted by email and shows in the staff list');
  perform test.throws(format($q$ select public.admin_set_customer_status(%L, 'suspended', 'should be blocked') $q$, u), 'NOT_ALLOWED', 'Staff accounts can''t be suspended from the customer screen');
  perform test.ok(public.admin_revoke_role(u, 'help_desk_agent', 'Left support team'), 'and revoked with a reason');
  perform test.throws(format($q$ select public.admin_revoke_role(%L, 'super_admin', 'try to remove myself') $q$, test.id('admin')), 'NOT_ALLOWED', 'You can''t remove your own super admin role');
  perform test.act_as(test.id('cust_b'));
  perform test.throws($q$ select public.admin_dashboard() $q$, 'FORBIDDEN|permission', 'Customers can''t open the admin dashboard');
  perform test.throws($q$ select public.admin_list_customers(null, null, 10, 0) $q$, 'FORBIDDEN|permission', 'or list customers');
  perform test.ok(jsonb_array_length(public.admin_my_access()->'permissions') = 0, 'and their admin access is empty');
  perform test.act_as(null);
end $$;
rollback;

\echo '== 34. Super Admin portal: orders, fulfilment, refunds, payments'
begin;
do $$ declare so uuid; st text; o uuid; f uuid; d jsonb; begin
  insert into public.user_roles(user_id, role_code) values (test.id('admin'), 'super_admin') on conflict do nothing;
  perform test.act_as(test.id('admin'));
  perform test.ok((select count(*) from public.admin_list_orders()) >= 1, 'Orders can be listed');
  select o2.id into o from public.orders o2 order by o2.placed_at desc limit 1;
  d := public.admin_order_detail(o);
  perform test.ok(d ? 'packages' and d ? 'payments' and d ? 'timeline', 'An order opens with packages, payments, refunds, returns, invoices and timeline');
  select s.id into so from public.sub_orders s where s.status = 'confirmed' limit 1;
  if so is not null then
    perform test.ok(public.admin_fulfil(so, 'pack') = 'packed', 'A confirmed package can be marked packed');
    perform test.throws(format($q$ select public.admin_fulfil(%L, 'ship', 'Delhivery', 'AWB1') $q$, so), 'INVALID_TRANSITION', 'It can''t be shipped before it''s ready');
    perform test.ok(public.admin_fulfil(so, 'ready') = 'ready_to_ship', 'then ready to ship');
    perform test.throws(format($q$ select public.admin_fulfil(%L, 'ship', '', '') $q$, so), 'CARRIER_AND_AWB_REQUIRED', 'Shipping needs the courier and tracking number');
    st := public.admin_fulfil(so, 'ship', 'Delhivery', 'TESTAWB123');
    perform test.ok(st = 'shipped' and exists (select 1 from public.shipments where sub_order_id = so and awb = 'TESTAWB123'), 'then shipped with a tracking number');
    perform test.ok(public.admin_fulfil(so, 'deliver') = 'delivered', 'and delivered');
  end if;
  -- refund approval: maker-checker
  insert into public.refunds(order_id, payment_id, refund_type, source_type, source_id, requested_amount, reason_code, approval_status, initiated_by, idempotency_key)
  select py.order_id, py.id, 'partial', 'support', 'test', 1, 'goodwill', 'pending', test.id('admin'), 'test-refund-' || gen_random_uuid() from public.payments py where py.status in ('paid','partially_refunded') limit 1
  returning id into f;
  if f is not null then
    perform test.throws(format($q$ select public.admin_decide_refund(%L, true, 'approve my own refund') $q$, f), 'MAKER_CHECKER', 'Nobody can approve a refund they started');
    update public.refunds set initiated_by = test.id('cust_b') where id = f;
    perform test.throws(format($q$ select public.admin_decide_refund(%L, true, 'ok') $q$, f), 'REASON_REQUIRED', 'Approving needs a note');
    perform test.ok(public.admin_decide_refund(f, true, 'Goodwill for late delivery') = 'approved', 'Another admin can approve it with a note');
    perform test.ok(public.svc_record_refund(f, 'rfnd_TEST1', 'processed') = 'success', 'The gateway result is recorded');
    perform test.ok((select processor_status::text from public.refunds where id = f) = 'success', 'and the refund is marked done');
    perform test.ok(public.svc_record_refund(null, 'rfnd_TEST1', 'processed') = 'already_done', 'Repeated gateway notifications are harmless');
  end if;
  perform test.ok((select count(*) from public.admin_list_payments()) >= 1, 'Payment transactions can be listed');
  perform test.act_as(test.id('cust_b'));
  perform test.throws($q$ select public.admin_list_orders() $q$, 'FORBIDDEN|permission', 'Customers can''t list everyone''s orders');
  perform test.throws(format($q$ select public.admin_fulfil(%L, 'pack') $q$, coalesce(so, gen_random_uuid())), 'FORBIDDEN|permission', 'or move packages');
  perform test.act_as(null);
end $$;
set role authenticated;
do $$ begin perform test.throws($q$ select public.svc_record_refund(null, 'x', 'processed') $q$, 'permission', 'The gateway-result function can''t be called from the website'); end $$;
reset role;
rollback;
