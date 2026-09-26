'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { friendly } from '@/lib/errors';
import { payForOrder } from '@/lib/pay';

const REASONS = [['ordered_by_mistake', 'Ordered by mistake'], ['better_price', 'Found a better price'], ['delivery_too_late', 'Delivery is too late'], ['changed_mind', 'Changed my mind'], ['other', 'Other']];
export function CancelItem({ itemId, max }: { itemId: string; max: number }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [qty, setQty] = useState(max);
  const [reason, setReason] = useState(REASONS[0][0]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  if (!open) return <button className="btn danger sm" onClick={() => setOpen(true)}>Cancel item</button>;
  async function go() {
    setBusy(true); setErr('');
    const { data, error } = await sb().rpc('cancel_order_item', { p_item: itemId, p_qty: qty, p_reason: reason, p_idem_key: `cxl:${itemId}:${qty}:${Date.now()}` });
    setBusy(false);
    if (error) { setErr(friendly(error)); return; }
    alert(data?.refund_id ? `Cancelled. A refund of ₹${data.refund_amount} has been started to your original payment method.` : 'Cancelled.');
    router.refresh();
  }
  return (
    <div className="panel stack" style={{ padding: 12, minWidth: 240 }}>
      {max > 1 && <label>Quantity to cancel<select value={qty} onChange={(e) => setQty(Number(e.target.value))}>{Array.from({ length: max }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</select></label>}
      <label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {err && <div className="msg err">{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}><button className="btn danger sm" disabled={busy} onClick={go}>Confirm cancellation</button><button className="btn ghost sm" onClick={() => setOpen(false)}>Keep item</button></div>
    </div>);
}
export function PayNow(p: { orderId: string; email?: string; contact?: string; name?: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  return (<div className="panel stack">
    <p style={{ margin: 0 }}>This order is waiting for payment.</p>
    {err && <div className="msg err">{err}</div>}
    <button className="btn" style={{ justifySelf: 'start' }} disabled={busy} onClick={async () => {
      setBusy(true); setErr('');
      try { const r = await payForOrder(p.orderId, { email: p.email, contact: p.contact, name: p.name }); router.replace(`/account/orders/${p.orderId}?${r === 'paid' ? 'placed=1' : 'pay=' + r}`); router.refresh(); }
      catch (e: any) { setErr(e.message); } finally { setBusy(false); }
    }}>Pay now</button></div>);
}
