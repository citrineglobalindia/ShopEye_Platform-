'use client';
// SRS: SA order management — search/filter orders, full order view (packages, items, payments, refunds, returns,
// invoices, timeline), cancel items with a note, move packages through fulfilment with courier + tracking number
import { useEffect, useState } from 'react';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { StatusChip } from '@/components/Status';

const ST = ['', 'pending_payment', 'placed', 'confirmed', 'processing', 'partially_shipped', 'shipped', 'partially_delivered', 'delivered', 'partially_cancelled', 'cancelled', 'completed', 'payment_failed'];
export function OrdersAdmin({ canManage }: { canManage: boolean }) {
  const [f, setF] = useState({ q: '', status: '', payment: '', from: '', to: '' }); const [rows, setRows] = useState<any[]>([]); const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null); const [err, setErr] = useState('');
  const load = (pg = page) => sb().rpc('admin_list_orders', { p_q: f.q || null, p_status: f.status || null, p_payment: f.payment || null, p_from: f.from || null, p_to: f.to || null, p_limit: 50, p_offset: pg * 50 })
    .then(({ data, error }: any) => { if (error) setErr(friendly(error)); else { setErr(''); setRows(data ?? []); } });
  useEffect(() => { const id = new URLSearchParams(location.search).get('order'); if (id) setOpen(id); load(0); }, []);
  const total = rows[0]?.total ?? 0;
  if (open) return <Order id={open} canManage={canManage} back={() => { setOpen(null); history.replaceState(null, '', '/admin?tab=orders'); load(); }} />;
  return (<div className="stack">
    <form className="panel filters-row" onSubmit={(e) => { e.preventDefault(); setPage(0); load(0); }}>
      <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Order no., customer, email or Razorpay id" aria-label="Search orders" />
      <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Order status">{ST.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'Any status'}</option>)}</select>
      <select value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value })} aria-label="Payment status"><option value="">Any payment</option>{['initiated', 'pending', 'paid', 'failed', 'partially_refunded', 'refunded', 'cod_pending'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
      <label className="small">From<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
      <label className="small">To<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      <button className="btn sm">Search</button>
    </form>
    {err && <div className="msg err" role="alert">{err}</div>}
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Orders"><table>
      <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Packages</th><th>Total</th><th>Payment</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.order_number}</strong></td><td className="small">{new Date(r.placed_at).toLocaleString('en-IN')}</td>
        <td className="small">{r.customer ?? '—'}<div className="muted">{r.email}</div></td><td>{r.packages}</td><td>{inr(r.grand_total)}</td>
        <td><StatusChip s={r.payment_status} /><div className="small muted">{r.payment_method}</div></td><td><StatusChip s={r.status} /></td>
        <td><button className="linklike" onClick={() => { setOpen(r.id); history.replaceState(null, '', `/admin?tab=orders&order=${r.id}`); }}>Open</button></td></tr>)}
        {!rows.length && <tr><td colSpan={8} className="muted">No orders match.</td></tr>}</tbody></table></div>
    <div className="addr"><span className="small muted">{total} orders</span><span className="cta-row">
      <button className="btn ghost sm" disabled={page === 0} onClick={() => { setPage(page - 1); load(page - 1); }}>Previous</button>
      <button className="btn ghost sm" disabled={(page + 1) * 50 >= total} onClick={() => { setPage(page + 1); load(page + 1); }}>Next</button></span></div>
  </div>);
}

function Order({ id, back, canManage }: { id: string; back: () => void; canManage: boolean }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState('');
  const load = () => sb().rpc('admin_order_detail', { p_order: id }).then(({ data, error }: any) => { if (error) setErr(friendly(error)); else setD(data); });
  useEffect(() => { load(); }, [id]);
  async function act(key: string, fn: () => PromiseLike<any>, ok: string) {
    setBusy(key); setErr(''); setMsg(''); const { error } = await fn(); setBusy('');
    if (error) setErr(friendly(error)); else { setMsg(ok); load(); }
  }
  function fulfil(p: any, action: string) {
    let carrier: string | null = null, awb: string | null = null;
    if (action === 'ship') { carrier = prompt('Courier name (e.g. Delhivery, Blue Dart):'); if (!carrier) return; awb = prompt('Tracking (AWB) number:'); if (!awb) return; }
    if (action === 'deliver' && !confirm('Record this package as delivered? The return window starts now.')) return;
    act(p.id + action, () => sb().rpc('admin_fulfil', { p_sub_order: p.id, p_action: action, p_carrier: carrier, p_awb: awb }), `Package ${p.sub_order_number} updated.`);
  }
  function cancel(it: any) {
    const left = it.qty - it.cancelled; const q = Number(prompt(`Cancel how many of “${it.title}”? (1–${left})`, String(left))); if (!q || q < 1 || q > left) return;
    const note = prompt('Note for the record (why support is cancelling):'); if (!note) return;
    act('c' + it.id, () => sb().rpc('admin_cancel_item', { p_item: it.id, p_qty: q, p_reason: 'admin_cancelled', p_comments: note }), 'Item cancelled; stock released and refund started if it was paid.');
  }
  if (!d) return <div className="stack"><button className="linklike" onClick={back}>‹ All orders</button>{err ? <div className="msg err">{err}</div> : <p className="muted">Loading…</p>}</div>;
  const o = d.order; const a = o.ship_address ?? {};
  const NEXT: Record<string, [string, string][]> = { confirmed: [['pack', 'Mark packed']], packed: [['ready', 'Ready to ship']], ready_to_ship: [['ship', 'Ship…']], shipped: [['deliver', 'Mark delivered']] };
  return (<div className="stack">
    <button className="linklike" style={{ justifySelf: 'start' }} onClick={back}>‹ All orders</button>
    <div className="panel stack">
      <div className="addr"><div><h2 style={{ margin: 0 }}>{o.order_number}</h2><div className="small muted">{new Date(o.placed_at).toLocaleString('en-IN')} · {o.payment_method}{o.coupon_code ? ` · coupon ${o.coupon_code}` : ''}</div></div>
        <span className="cta-row"><StatusChip s={o.payment_status} /><StatusChip s={o.status} /></span></div>
      <div className="row2"><div className="small"><strong>Customer</strong><br />{o.customer} · {o.email}{o.mobile ? ` · ${o.mobile}` : ''}</div>
        <div className="small"><strong>Ship to</strong><br />{a.recipient}, {a.line1}, {a.line2}, {a.city} – {a.pincode}{a.latitude ? ' · 📍 map pin' : ''}</div></div>
      <div className="kpi"><span className="small muted">Order total</span><strong>{inr(o.grand_total)}</strong></div>
    </div>
    {err && <div className="msg err" role="alert">{err}</div>}{msg && <div className="msg ok" role="status">{msg}</div>}
    {d.packages.map((p: any) => (
      <section key={p.id} className="panel stack">
        <div className="addr"><strong>Package {p.sub_order_number} · {p.seller}</strong><span className="cta-row"><StatusChip s={p.status} />
          {canManage && (NEXT[p.status] ?? []).map(([k, l]) => <button key={k} className="btn sm" disabled={!!busy} onClick={() => fulfil(p, k)}>{busy === p.id + k ? '…' : l}</button>)}</span></div>
        {p.shipment && <p className="small" style={{ margin: 0 }}>Courier {p.shipment.carrier} · tracking {p.shipment.awb} · {p.shipment.status}{p.shipment.delivered_at ? ` · delivered ${new Date(p.shipment.delivered_at).toLocaleDateString('en-IN')}` : ''}</p>}
        <div className="tablewrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Cancelled</th><th>Returned</th><th>Price</th><th>Line</th><th /></tr></thead>
          <tbody>{p.items.map((it: any) => <tr key={it.id}><td>{it.title}<div className="small muted">{Object.values(it.attrs ?? {}).join(' / ')}</div></td><td>{it.qty}</td><td>{it.cancelled}</td><td>{it.returned}</td>
            <td>{inr(it.unit_price)}</td><td>{inr(it.line_total)}</td>
            <td>{canManage && it.qty - it.cancelled > 0 && ['confirmed', 'packed', 'ready_to_ship', 'pending_payment'].includes(p.status) && <button className="linklike danger-t" disabled={!!busy} onClick={() => cancel(it)}>Cancel…</button>}</td></tr>)}</tbody></table></div>
      </section>))}
    <section className="panel stack"><h3 style={{ margin: 0 }}>Payments</h3>
      {d.payments.map((p: any) => <div key={p.id} className="addr small"><span>{p.gateway} · {p.method ?? '—'} · {inr(p.amount)}{p.gateway_payment_id ? ` · ${p.gateway_payment_id}` : ''}{p.failure_message ? ` · ${p.failure_message}` : ''}</span><StatusChip s={p.status} /></div>)}</section>
    <section className="panel stack"><h3 style={{ margin: 0 }}>Refunds</h3>
      {d.refunds.length ? d.refunds.map((r: any) => <div key={r.id} className="addr small"><span>{r.refund_number} · {inr(r.approved_amount ?? r.requested_amount)} · {r.source_type} · {r.reason_code}{r.destination === 'store_credit' ? ' · to store credit' : ''}</span>
        <span className="cta-row"><StatusChip s={r.approval_status} /><StatusChip s={r.processor_status} /></span></div>) : <p className="muted small" style={{ margin: 0 }}>None.</p>}</section>
    <section className="panel stack"><h3 style={{ margin: 0 }}>Returns</h3>
      {d.returns.length ? d.returns.map((r: any) => <div key={r.id} className="addr small"><span>{r.return_number} · {r.title} × {r.qty} · {r.resolution} · {r.reason}</span><StatusChip s={r.status} /></div>) : <p className="muted small" style={{ margin: 0 }}>None.</p>}</section>
    <section className="panel stack"><h3 style={{ margin: 0 }}>Invoices and credit notes</h3>
      {d.invoices.length ? d.invoices.map((v: any) => <div key={v.id} className="addr small"><span>{v.doc_type} {v.doc_number} · {new Date(v.issued_at).toLocaleDateString('en-IN')} · {inr(v.total)}</span><a href={`/api/invoices/${v.id}`} target="_blank">PDF</a></div>)
        : <p className="muted small" style={{ margin: 0 }}>None issued (the seller needs a GSTIN).</p>}</section>
    <section className="panel stack"><h3 style={{ margin: 0 }}>Timeline</h3>
      {d.timeline.length ? d.timeline.map((t: any, k: number) => <div key={k} className="small"><strong>{new Date(t.occurred_at).toLocaleString('en-IN')}</strong> · {t.entity_type.replace(/_/g, ' ')} {t.from_status ? `${t.from_status} → ` : ''}{t.to_status ?? t.action}{t.by_email ? ` · ${t.by_email}` : ''}{t.reason ? ` · “${t.reason}”` : ''}</div>)
        : <p className="muted small" style={{ margin: 0 }}>No changes recorded.</p>}</section>
  </div>);
}
