// SRS: CUST-FR-127 (orders paid with several tenders show what each paid and where each refund goes)
// SRS: CUST-FR-080 CUST-FR-104 CUST-FR-107 CUST-FR-109 (refunds show where the money goes, by original payment method, and how much; each package's invoice and credit notes with the items they cover; optional business GSTIN)
// SRS: CUST-FR-121 CUST-FR-137 CUST-FR-152 CUST-FR-075 CUST-FR-086 CUST-FR-089 CUST-FR-090 CUST-FR-093 CUST-FR-094 CUST-FR-095 CUST-FR-096 CUST-FR-099 CUST-FR-101 CUST-FR-102 CUST-FR-110 CUST-FR-114 CUST-FR-116 CUST-FR-117 CUST-FR-122 CUST-FR-123 CUST-FR-125 CUST-FR-139
// (partial returns reflected in the money summary; links from emails require sign-in and handle missing orders; phone number masked; pending payment shows hold time; owner-only order page reachable by refresh without new order; snapshots; item-level status;
//  refunded/cancelled amounts separate; split shipment timelines with stale-update notice and delivery date; item cancellation with refund tracking;
//  return timeline and rejection reason with help path; each refund listed and summed; failed refund next steps; contextual help link)
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { sbServer } from '@/lib/sb-server';
import { inr } from '@/lib/config';
import { StatusChip } from '@/components/Status';
import { Crumbs } from '@/components/Crumbs';
import { CancelItem, PayNow } from '@/components/OrderActions';
import { ReturnItem, CancelReturn, Reorder } from '@/components/ReturnActions';
import { ReviewForm } from '@/components/Reviews';
import { GstDetails } from '@/components/GstDetails';
import { OrderAnalytics } from '@/components/Analytics';
import { StoreCreditButton } from '@/components/StoreCreditButton';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Order details', robots: { index: false } };

// Where a refund goes, by how the order was paid (original-tender rule, CUST-FR-080)
const REFUND_TO: Record<string, string> = { upi: 'the UPI account you paid from', card: 'the card you paid with', netbanking: 'the bank account you paid from',
  wallet: 'the wallet you paid with', emi: 'the card you paid with (EMI is cancelled pro rata by your bank)', cod: 'your bank account (we’ll ask for the details)' };
const STEPS = [['confirmed', 'Confirmed'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered']] as const;
const RANK: Record<string, number> = { pending_payment: -1, confirmed: 0, packed: 1, ready_to_ship: 1, shipped: 2, delivered: 3, completed: 3 };
const RSTEPS = [['requested', 'Requested'], ['approved', 'Approved'], ['picked_up', 'Picked up'], ['quality_check', 'Checked'], ['refund_completed', 'Refunded']] as const;
const RRANK: Record<string, number> = { requested: 0, under_review: 0, approved: 1, pickup_scheduled: 1, picked_up: 2, in_transit: 2, received: 3, quality_check: 3, accepted: 3, refund_initiated: 3, refund_completed: 4, exchange_processing: 4, closed: 4 };
const d = (x?: string | null, t = false) => x ? new Date(x).toLocaleString('en-IN', t ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export default async function OrderDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params; const sp = await searchParams;
  const db = await sbServer(); const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/login?next=/account/orders/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: o } = await db.from('orders').select('*').eq('id', id).maybeSingle();     // RLS: owner only
  if (!o) notFound();
  const [{ data: subs }, { data: items }, { data: ships }, { data: refunds }, { data: rets }] = await Promise.all([
    db.from('sub_orders').select('id,sub_order_number,status,total,shipping_total,delivered_at,return_window_ends_at').eq('order_id', id).order('created_at'),
    db.from('order_items').select('id,sub_order_id,variant_id,product_snapshot,qty,unit_price,discount,line_total,cancelled_qty,return_requested_qty,refunded_amount').eq('order_id', id),
    db.from('shipments').select('id,sub_order_id,carrier,awb,status,shipped_at,delivered_at,last_event_at'),
    db.from('refunds').select('id,refund_number,requested_amount,approved_amount,processor_status,approval_status,created_at,completed_at,source_type,destination,payments(gateway,method)').eq('order_id', id).order('created_at'),
    db.from('returns').select('id,return_number,order_item_id,qty,status,reason,rejection_reason,created_at').order('created_at', { ascending: false }),
  ]);
  const { data: pays } = await db.from('payments').select('gateway,method,amount,status').eq('order_id', id).in('status', ['paid', 'partially_refunded', 'refunded']);
  const { data: scDays } = await db.rpc('my_wallet');
  const { data: docs } = await db.from('invoices').select('id,kind,number,sub_order_id,issued_at,total,doc_key,original_invoice_id,invoice_lines(description,qty,order_item_id)').eq('order_id', id).order('issued_at');
  const vids = [...new Set((items ?? []).map((it: any) => it.variant_id))];
  const { data: vp } = vids.length ? await db.from('product_variants').select('id,product_id').in('id', vids) : { data: [] };
  const productOf = new Map((vp ?? []).map((x: any) => [x.id, x.product_id]));
  const shipIds = (ships ?? []).map((s: any) => s.id);
  const { data: events } = shipIds.length ? await db.from('shipment_events').select('shipment_id,mapped_status,location,occurred_at').in('shipment_id', shipIds).order('occurred_at', { ascending: false }) : { data: [] };
  const a = o.ship_address || {};
  const canPay = o.payment_method !== 'cod' && ['initiated', 'pending', 'failed'].includes(o.payment_status) && o.status === 'pending_payment';
  const holdUntil = new Date(new Date(o.placed_at).getTime() + 15 * 60e3);
  const refundedTotal = (refunds ?? []).filter((r: any) => r.processor_status === 'success').reduce((s: number, r: any) => s + Number(r.approved_amount ?? r.requested_amount), 0);
  const refundPending = (refunds ?? []).filter((r: any) => !['success', 'reversed'].includes(r.processor_status) && r.approval_status !== 'rejected').reduce((s: number, r: any) => s + Number(r.approved_amount ?? r.requested_amount), 0);
  const cancelledValue = (items ?? []).reduce((s: number, it: any) => s + (it.cancelled_qty ? Number(it.line_total) * it.cancelled_qty / it.qty : 0), 0);
  const retFor = (itemId: string) => (rets ?? []).filter((r: any) => r.order_item_id === itemId);
  return (
    <div className="wrap section stack">
      <Crumbs items={[['Home', '/'], ['My orders', '/account/orders'], [o.order_number]]} />
      {sp.placed && <OrderAnalytics orderId={o.id} />}
      {sp.placed && (
        <section className="panel placed" role="status" aria-labelledby="placed-h">
          <span className="placed-tick" aria-hidden="true">✓</span>
          <h2 id="placed-h" style={{ margin: 0 }}>Thank you! Your order is placed.</h2>
          <p className="muted" style={{ margin: 0 }}>Order ID <strong>{o.order_number}</strong> · confirmation sent to {user.email}</p>
          <p className="small" style={{ margin: 0 }}>Expected delivery: <strong>{(() => { const d = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); return `${d(3)} – ${d(6)}`; })()}</strong> · each seller’s package is tracked separately</p>
          <div className="cta-row" style={{ justifyContent: 'center' }}><a className="btn" href="#packages">Track your order</a><Link className="btn ghost" href="/">Continue shopping</Link></div>
        </section>)}
      {sp.pay === 'pending' && <div className="msg info">We’re confirming your payment with the bank. This page updates once it’s confirmed. Don’t pay again.</div>}
      {sp.pay === 'dismissed' && <div className="msg info">Payment wasn’t completed. Use Pay now below to finish.</div>}
      {sp.payerr && <div className="msg err">{sp.payerr}</div>}
      <div className="order-head">
        <div><h1 style={{ margin: 0 }}>Order {o.order_number}</h1><span className="small muted">Placed {d(o.placed_at, true)}</span></div>
        <span><StatusChip s={o.status} /> <StatusChip s={o.payment_status} /></span>
      </div>
      {canPay && (<>
        <div className="msg info">{Date.now() < holdUntil.getTime() ? <>Your items are held for you until <strong>{holdUntil.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</strong>. Complete payment before then to keep them.</> : <>Your items are no longer held. You can still pay; if something sold out meanwhile, it’s refunded automatically.</>}</div>
        <PayNow orderId={o.id} email={user.email} contact={a.mobile} name={a.recipient} /></>)}
      <div className="split">
        <div className="stack">
          {(subs ?? []).map((s: any, i: number) => {
            const sh = (ships ?? []).find((x: any) => x.sub_order_id === s.id);
            const ev = sh ? (events ?? []).filter((e: any) => e.shipment_id === sh.id) : [];
            const rank = RANK[s.status] ?? 0; const cancelled = s.status === 'cancelled';
            const stale = sh && s.status === 'shipped' && sh.last_event_at && Date.now() - new Date(sh.last_event_at).getTime() > 72 * 3600e3;
            const cancellable = ['pending_payment', 'confirmed', 'packed', 'ready_to_ship'].includes(s.status);
            const canReturn = ['delivered', 'completed'].includes(s.status) && s.return_window_ends_at && new Date(s.return_window_ends_at) > new Date();
            return (
              <section key={s.id} id={i === 0 ? 'packages' : undefined} className="panel stack" style={{ scrollMarginTop: 140 }}>
                <div className="pkg-head"><h2 style={{ margin: 0 }}>Package {i + 1} of {subs!.length}</h2><StatusChip s={s.status} /></div>
                {!cancelled && s.status !== 'pending_payment' && (
                  <ol className="steps" aria-label="Delivery progress">
                    {STEPS.map(([k, l], n) => <li key={k} className={n <= rank ? 'done' : ''} aria-current={n === rank ? 'step' : undefined}><span>{l}</span></li>)}
                  </ol>)}
                {sh && <p className="small" style={{ margin: 0 }}>{sh.carrier}, tracking number <strong>{sh.awb}</strong>{s.delivered_at ? `. Delivered ${d(s.delivered_at, true)}.` : ''}</p>}
                {stale && <div className="msg info small">The courier hasn’t updated this package since {d(sh.last_event_at, true)}. Tracking may be delayed; <Link href={`/support/new?order=${o.id}&category=order`}>ask us to check</Link>.</div>}
                {ev.length > 0 && <details className="small"><summary>Tracking history ({ev.length})</summary><ul className="evlist">{ev.map((e: any, k: number) => <li key={k}><StatusChip s={e.mapped_status} /> {d(e.occurred_at, true)}{e.location ? `, ${e.location}` : ''}</li>)}</ul></details>}
                {s.return_window_ends_at && <p className="small muted" style={{ margin: 0 }}>{canReturn ? `Returns open until ${d(s.return_window_ends_at)}.` : `Return window closed on ${d(s.return_window_ends_at)}.`}</p>}
                {(items ?? []).filter((it: any) => it.sub_order_id === s.id).map((it: any) => {
                  const remaining = it.qty - it.cancelled_qty - it.return_requested_qty;
                  return (
                    <div key={it.id} className="oi">
                      <div className="oi-top">
                        <div><strong>{it.product_snapshot?.title}</strong>
                          <div className="small muted">{Object.values(it.product_snapshot?.attributes || {}).join(' / ')}{Object.values(it.product_snapshot?.attributes || {}).length ? ' · ' : ''}Qty {it.qty}{it.cancelled_qty ? `, ${it.cancelled_qty} cancelled` : ''}{it.return_requested_qty ? `, ${it.return_requested_qty} in return` : ''}</div></div>
                        <strong>{inr(it.line_total)}</strong>
                      </div>
                      <div className="oi-actions">
                        {cancellable && remaining > 0 && <CancelItem itemId={it.id} max={remaining} />}
                        {canReturn && remaining > 0 && it.product_snapshot?.is_returnable !== false && <ReturnItem itemId={it.id} max={remaining} />}
                        {['delivered', 'completed'].includes(s.status) && productOf.get(it.variant_id) && it.qty > it.cancelled_qty && <ReviewForm productId={productOf.get(it.variant_id)} title={it.product_snapshot?.title} />}
                      </div>
                      {retFor(it.id).map((r: any) => (
                        <div key={r.id} className="ret">
                          <div className="pkg-head"><span className="small"><strong>Return {r.return_number}</strong> · {r.qty} item{r.qty > 1 ? 's' : ''}</span><StatusChip s={r.status} /></div>
                          {!['rejected', 'cancelled'].includes(r.status) && <ol className="steps small-steps">{RSTEPS.map(([k, l], n) => <li key={k} className={n <= (RRANK[r.status] ?? 0) ? 'done' : ''}><span>{l}</span></li>)}</ol>}
                          {r.status === 'rejected' && <p className="small" style={{ margin: 0 }}>Not accepted: {r.rejection_reason || 'the item didn’t meet the return conditions'}. <Link href={`/support/new?order=${o.id}&category=return`}>Ask us to review this</Link>.</p>}
                          {['requested', 'under_review', 'approved', 'pickup_scheduled'].includes(r.status) && <CancelReturn returnId={r.id} />}
                        </div>))}
                    </div>);
                })}
              </section>);
          })}
          <section className="panel stack" aria-labelledby="docs-h">
            <h2 id="docs-h" style={{ margin: 0 }}>Invoices</h2>
            {(subs ?? []).map((s: any, i: number) => {
              const inv = (docs ?? []).filter((x: any) => x.sub_order_id === s.id);
              return (
                <div key={s.id} className="stack" style={{ gap: 4 }}>
                  <strong className="small">Package {i + 1} of {subs!.length}</strong>
                  {!inv.length ? <span className="small muted">{['cancelled', 'pending_payment'].includes(s.status) ? 'No invoice: nothing was shipped.' : 'The seller’s tax invoice appears here once this package ships.'}</span>
                    : inv.map((x: any) => (
                      <div key={x.id} className="pkg-head">
                        <span className="small"><strong>{x.kind === 'credit_note' ? 'Credit note' : 'Tax invoice'} {x.number}</strong> · {inr(x.total)} · {d(x.issued_at)}
                          <span className="muted" style={{ display: 'block' }}>Covers: {(x.invoice_lines ?? []).map((l: any) => `${l.description} × ${l.qty}`).join('; ')}</span></span>
                        <a className="btn ghost sm" href={`/api/invoices/${x.id}?k=${x.doc_key}`} target="_blank" rel="noopener">Download PDF</a>
                      </div>))}
                </div>);
            })}
            <GstDetails orderId={o.id} gstin={o.buyer_gstin} name={o.buyer_legal_name} locked={!!docs?.length || ['cancelled'].includes(o.status)} />
          </section>
          {!!refunds?.length && (
            <section className="panel stack"><h2 style={{ margin: 0 }}>Refunds</h2>
              {refunds.map((r: any) => (
                <div key={r.refund_number} className="pkg-head">
                  <span><strong>{r.refund_number}</strong> <span className="small muted">for {r.source_type}, {d(r.created_at)} · to {r.payments?.gateway === 'shopeye_wallet' ? 'your ShopEye balance' : r.destination === 'store_credit' ? 'ShopEye store credit' : REFUND_TO[o.payment_method] ?? 'your original payment method'}</span>
                    {r.payments?.gateway === 'razorpay' && r.destination === 'original' && r.processor_status === 'not_sent' && ['not_required', 'approved'].includes(r.approval_status) &&
                      <span className="small" style={{ display: 'block' }}><StoreCreditButton refundId={r.id} days={scDays?.rules?.store_credit_expiry_days ?? 365} /></span>}</span>
                  <span>{inr(r.approved_amount ?? r.requested_amount)} <StatusChip s={r.processor_status === 'not_sent' ? (r.approval_status === 'pending' ? 'pending' : 'initiated') : r.processor_status} /></span>
                </div>))}
              {refunds.some((r: any) => r.processor_status === 'failed') && <div className="msg err small">A refund couldn’t be sent to your bank. We retry automatically; if it hasn’t arrived in 3 working days, <Link href={`/support/new?order=${o.id}&category=refund`}>contact us</Link> and we’ll sort it out.</div>}
              <p className="small" style={{ margin: 0 }}>{(pays ?? []).some((p: any) => p.gateway === 'shopeye_wallet') ? <>Refunds go to <strong>{REFUND_TO[o.payment_method] ?? 'your original payment method'}</strong> first, up to what it paid, then back to your <Link href="/account/balance">ShopEye balance</Link> (gift card, store credit, then points).</> : <>Refunds go to <strong>{REFUND_TO[o.payment_method] ?? 'your original payment method'}</strong>.</>} {refundPending > 0 && <>Expected: <strong>{inr(refundPending)}</strong>. </>}Banks usually take 5–7 working days after we send them.</p>
            </section>)}
        </div>
        <aside className="stack">
          <div className="panel sum">
            <h2 style={{ margin: 0 }}>Price details</h2>
            <div><span>Items</span><span>{inr(o.subtotal)}</span></div>
            {Number(o.discount_total) > 0 && <div><span>Discount{o.coupon_code ? ` (${o.coupon_code})` : ''}</span><span>−{inr(o.discount_total)}</span></div>}
            <div><span>Shipping</span><span>{Number(o.shipping_total) ? inr(o.shipping_total) : 'Free'}</span></div>
            <div className="tot"><span>Total charged</span><span>{inr(o.grand_total)}</span></div>
            {cancelledValue > 0 && <div className="small"><span>Cancelled items</span><span>{inr(cancelledValue)}</span></div>}
            {(pays ?? []).some((p: any) => p.gateway === 'shopeye_wallet') && (pays ?? []).map((p: any, k: number) => <div key={k} className="small"><span>Paid with {p.gateway === 'shopeye_wallet' ? 'ShopEye balance' : (REFUND_TO[p.method] ? p.method.toUpperCase() : 'Razorpay')}</span><span>{inr(p.amount)}</span></div>)}
            {refundedTotal > 0 && <div className="small ok-t"><span>Refunded</span><span>−{inr(refundedTotal)}</span></div>}
            {refundPending > 0 && <div className="small"><span>Refund in progress</span><span>{inr(refundPending)}</span></div>}
            {(refundedTotal > 0 || refundPending > 0) && <div className="small"><strong>Net paid after refunds</strong><strong>{inr(Number(o.grand_total) - refundedTotal)}</strong></div>}
            <p className="small muted" style={{ margin: 0 }}>{o.payment_method === 'cod' ? 'Cash on delivery' : 'Paid online via Razorpay'}</p>
          </div>
          <div className="panel small"><h3>Delivering to</h3><p style={{ margin: 0 }}>{a.recipient}<br />{a.line1}, {a.line2}<br />{a.city} {a.pincode}<br />{a.mobile ? `+91 ••••• ${String(a.mobile).slice(-4)}` : ''}</p></div>
          <div className="panel stack small">
            <Reorder lines={(items ?? []).map((it: any) => ({ variant_id: it.variant_id, qty: it.qty, title: it.product_snapshot?.title }))} />
            <Link className="btn ghost sm" href={`/support/new?order=${o.id}&category=order`}>Get help with this order</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
