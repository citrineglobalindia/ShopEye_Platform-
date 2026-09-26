import { notFound, redirect } from 'next/navigation';
import { sbServer } from '@/lib/sb-server';
import { inr } from '@/lib/config';
import { StatusChip } from '@/components/Status';
import { CancelItem, PayNow } from '@/components/OrderActions';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Order details', robots: { index: false } };

export default async function OrderDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params; const sp = await searchParams;
  const db = await sbServer(); const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/login?next=/account/orders/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: o } = await db.from('orders').select('*').eq('id', id).maybeSingle();     // RLS: owner only
  if (!o) notFound();
  const [{ data: subs }, { data: items }, { data: ships }, { data: refunds }] = await Promise.all([
    db.from('sub_orders').select('id,sub_order_number,status,total,shipping_total,delivered_at,return_window_ends_at').eq('order_id', id),
    db.from('order_items').select('id,sub_order_id,product_snapshot,qty,unit_price,discount,line_total,cancelled_qty,return_requested_qty').eq('order_id', id),
    db.from('shipments').select('sub_order_id,carrier,awb,status,shipped_at,delivered_at'),
    db.from('refunds').select('refund_number,requested_amount,processor_status,approval_status,created_at').eq('order_id', id),
  ]);
  const a = o.ship_address || {};
  const canPay = o.payment_method !== 'cod' && ['initiated', 'pending', 'failed'].includes(o.payment_status) && o.status === 'pending_payment';
  return (
    <div className="wrap section stack">
      {sp.placed && <div className="msg ok" role="status">Order placed. We’ve sent the details to {user.email}.</div>}
      {sp.pay === 'pending' && <div className="msg info">We’re confirming your payment with the bank. This page updates once it’s confirmed. Don’t pay again.</div>}
      {sp.pay === 'dismissed' && <div className="msg info">Payment wasn’t completed. Your items are held for 15 minutes. Use Pay now to finish.</div>}
      {sp.payerr && <div className="msg err">{sp.payerr}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' }}>
        <h1 style={{ margin: 0 }}>Order {o.order_number}</h1>
        <span><StatusChip s={o.status} /> <StatusChip s={o.payment_status} /></span>
      </div>
      {canPay && <PayNow orderId={o.id} email={user.email} contact={a.mobile} name={a.recipient} />}
      <div className="split">
        <div className="stack">
          {(subs ?? []).map((s: any, i: number) => {
            const sh = (ships ?? []).find((x: any) => x.sub_order_id === s.id);
            const cancellable = ['pending_payment', 'confirmed', 'packed', 'ready_to_ship'].includes(s.status);
            return (
              <section key={s.id} className="panel stack">
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <h2 style={{ margin: 0 }}>Package {i + 1} of {subs.length}</h2><StatusChip s={s.status} /></div>
                {sh && <p className="small" style={{ margin: 0 }}>Shipped with {sh.carrier}, tracking number <strong>{sh.awb}</strong>{sh.delivered_at ? `, delivered ${new Date(sh.delivered_at).toLocaleDateString('en-IN')}` : ''}.</p>}
                {s.return_window_ends_at && <p className="small muted" style={{ margin: 0 }}>Returns open until {new Date(s.return_window_ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.</p>}
                {(items ?? []).filter((it: any) => it.sub_order_id === s.id).map((it: any) => {
                  const remaining = it.qty - it.cancelled_qty - it.return_requested_qty;
                  return (
                    <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                      <div><strong>{it.product_snapshot?.title}</strong>
                        <div className="small muted">{Object.values(it.product_snapshot?.attributes || {}).join(' / ')} · Qty {it.qty}{it.cancelled_qty ? ` (${it.cancelled_qty} cancelled)` : ''}</div></div>
                      <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                        <strong>{inr(it.line_total)}</strong>
                        {cancellable && remaining > 0 && <CancelItem itemId={it.id} max={remaining} />}
                      </div>
                    </div>);
                })}
              </section>);
          })}
          {!!refunds?.length && <section className="panel"><h2>Refunds</h2>{refunds.map((r: any) => (
            <p key={r.refund_number} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{r.refund_number}</span><span>{inr(r.requested_amount)} <StatusChip s={r.processor_status === 'not_sent' ? (r.approval_status === 'pending' ? 'pending' : 'initiated') : r.processor_status} /></span></p>))}</section>}
        </div>
        <aside className="stack">
          <div className="panel sum">
            <h2 style={{ margin: 0 }}>Price details</h2>
            <div><span>Items</span><span>{inr(o.subtotal)}</span></div>
            {Number(o.discount_total) > 0 && <div><span>Discount{o.coupon_code ? ` (${o.coupon_code})` : ''}</span><span>−{inr(o.discount_total)}</span></div>}
            <div><span>Shipping</span><span>{Number(o.shipping_total) ? inr(o.shipping_total) : 'Free'}</span></div>
            <div className="tot"><span>Total</span><span>{inr(o.grand_total)}</span></div>
            <p className="small muted" style={{ margin: 0 }}>{o.payment_method === 'cod' ? 'Cash on delivery' : 'Paid online via Razorpay'}</p>
          </div>
          <div className="panel small"><h3>Delivering to</h3><p style={{ margin: 0 }}>{a.recipient}<br />{a.line1}, {a.line2}<br />{a.city} {a.pincode}<br />{a.mobile}</p></div>
        </aside>
      </div>
    </div>
  );
}
