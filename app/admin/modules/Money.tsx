'use client';
// SRS: SA returns, refund administration and payment transactions
import { useEffect, useState } from 'react';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { StatusChip } from '@/components/Status';
const openOrder = (id: string) => { location.href = `/admin?tab=orders&order=${id}`; };

export function Returns() {
  const [status, setStatus] = useState(''); const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = () => sb().rpc('admin_list_returns', { p_status: status || null, p_limit: 200 }).then(({ data, error }: any) => { if (error) setErr(friendly(error)); else { setErr(''); setRows(data ?? []); } });
  useEffect(() => { load(); }, [status]);
  const NEXT: Record<string, [string, string][]> = { requested: [['approve', 'Approve'], ['review', 'Review'], ['reject', 'Reject…']], under_review: [['approve', 'Approve'], ['reject', 'Reject…']],
    approved: [['schedule_pickup', 'Pickup scheduled']], pickup_scheduled: [['picked_up', 'Picked up']], picked_up: [['received', 'Received']], in_transit: [['received', 'Received']],
    received: [['qc', 'Quality check'], ['accept', 'Accept'], ['reject', 'Reject…']], quality_check: [['accept', 'Accept'], ['reject', 'Reject…']], accepted: [['close', 'Close']], refund_completed: [['close', 'Close']] };
  async function act(r: any, a: string) {
    let note: string | null = null;
    if (a === 'reject') { note = prompt('Why is this return rejected? (the customer sees this)'); if (!note) return; }
    if (a === 'accept' && !confirm(r.resolution === 'refund' ? `Accept and refund ${inr(r.amount)}?` : 'Accept this return?')) return;
    const { data, error } = await sb().rpc('admin_decide_return', { p_return: r.id, p_action: a, p_note: note });
    if (error) setErr(friendly(error)); else { setMsg(`${r.return_number}: ${String(data).replace(/_/g, ' ')}.`); load(); }
  }
  return (<div className="stack">
    <div className="panel addr"><label className="small">Show<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Open returns</option>{['requested', 'under_review', 'approved', 'pickup_scheduled', 'picked_up', 'received', 'quality_check', 'accepted', 'refund_initiated', 'refund_completed', 'rejected', 'closed'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></label>
      <span className="small muted">Accepting a refund return starts the refund for the returned units.</span></div>
    {err && <div className="msg err" role="alert">{err}</div>}{msg && <div className="msg ok" role="status">{msg}</div>}
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Returns"><table>
      <thead><tr><th>Return</th><th>Item</th><th>Customer</th><th>Reason</th><th>Value</th><th>Status</th><th>Next step</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.return_number}</strong><div className="small"><button className="linklike" onClick={() => openOrder(r.order_id)}>{r.order_number}</button></div></td>
        <td className="small">{r.title} × {r.qty}<div className="muted">{r.resolution}</div></td><td className="small">{r.customer}</td><td className="small">{r.reason}{r.reason_details ? ` — ${r.reason_details}` : ''}</td>
        <td>{inr(r.amount)}</td><td><StatusChip s={r.status} /></td>
        <td><span className="cta-row">{(NEXT[r.status] ?? []).map(([a, l]) => <button key={a} className={`btn sm${a === 'reject' ? ' ghost' : ''}`} onClick={() => act(r, a)}>{l}</button>)}</span></td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="muted">No returns here.</td></tr>}</tbody></table></div>
  </div>);
}

export function Refunds({ canApprove }: { canApprove: boolean }) {
  const [view, setView] = useState('action'); const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState('');
  const load = () => sb().rpc('admin_list_refunds', { p_view: view, p_limit: 200 }).then(({ data, error }: any) => { if (error) setErr(friendly(error)); else { setErr(''); setRows(data ?? []); } });
  useEffect(() => { load(); }, [view]);
  async function decide(r: any, ok: boolean) {
    const note = prompt(ok ? `Approve refund ${r.refund_number} of ${inr(r.requested_amount)}? Add a note:` : `Reject refund ${r.refund_number}? Why:`); if (!note) return;
    setBusy(r.id); const { error } = await sb().rpc('admin_decide_refund', { p_refund: r.id, p_approve: ok, p_note: note }); setBusy('');
    if (error) setErr(friendly(error)); else { setMsg(`${r.refund_number} ${ok ? 'approved' : 'rejected'}.`); load(); }
  }
  async function send(r: any) {
    if (!confirm(`Send ${inr(r.approved_amount ?? r.requested_amount)} back to the customer’s original payment through Razorpay?`)) return;
    setBusy(r.id); setErr(''); setMsg('');
    const res = await fetch('/api/admin/refund-send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refund_id: r.id }) });
    const j = await res.json().catch(() => ({})); setBusy('');
    if (!res.ok) setErr(j.error || 'The refund could not be sent.'); else { setMsg(`${r.refund_number} sent to Razorpay (${j.gateway_refund_id}); it completes when Razorpay confirms.`); load(); }
  }
  return (<div className="stack">
    <div className="panel addr"><div className="ptabs" role="tablist">{[['action', 'Needs action'], ['processing', 'With Razorpay'], ['done', 'Completed'], ['all', 'All']].map(([k, l]) =>
      <button key={k} role="tab" type="button" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
      <span className="small muted">Refunds from ShopEye balance complete on their own; card/UPI refunds are sent to Razorpay here.</span></div>
    {err && <div className="msg err" role="alert">{err}</div>}{msg && <div className="msg ok" role="status">{msg}</div>}
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Refunds"><table>
      <thead><tr><th>Refund</th><th>Order</th><th>Amount</th><th>Reason</th><th>Approval</th><th>Gateway</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.refund_number}</strong><div className="small muted">{new Date(r.created_at).toLocaleString('en-IN')}</div></td>
        <td className="small"><button className="linklike" onClick={() => openOrder(r.order_id)}>{r.order_number}</button><div className="muted">{r.customer}</div></td>
        <td>{inr(r.approved_amount ?? r.requested_amount)}<div className="small muted">{r.gateway}</div></td><td className="small">{r.reason_code}<div className="muted">{r.source_type}</div></td>
        <td><StatusChip s={r.approval_status} /></td><td><StatusChip s={r.processor_status} />{r.gateway_refund_id && <div className="small muted">{r.gateway_refund_id}</div>}</td>
        <td>{canApprove && <span className="cta-row">
          {r.approval_status === 'pending' && <><button className="btn sm" disabled={busy === r.id} onClick={() => decide(r, true)}>Approve…</button><button className="btn ghost sm" disabled={busy === r.id} onClick={() => decide(r, false)}>Reject…</button></>}
          {['approved', 'not_required'].includes(r.approval_status) && ['not_sent', 'failed'].includes(r.processor_status) && r.gateway === 'razorpay' &&
            <button className="btn sm" disabled={busy === r.id} onClick={() => send(r)}>{busy === r.id ? 'Sending…' : r.processor_status === 'failed' ? 'Retry send' : 'Send to Razorpay'}</button>}</span>}</td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="muted">Nothing here.</td></tr>}</tbody></table></div>
  </div>);
}

export function Payments() {
  const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState('');
  const load = () => sb().rpc('admin_list_payments', { p_status: status || null, p_q: q || null, p_limit: 200 }).then(({ data, error }: any) => { if (error) setErr(friendly(error)); else { setErr(''); setRows(data ?? []); } });
  useEffect(() => { load(); }, [status]);
  const sum = (s: string) => rows.filter((r) => r.status === s).reduce((n, r) => n + Number(r.amount), 0);
  return (<div className="stack">
    <form className="panel filters-row" onSubmit={(e) => { e.preventDefault(); load(); }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order no. or Razorpay payment/order id" aria-label="Search payments" />
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{['initiated', 'pending', 'paid', 'failed', 'partially_refunded', 'refunded', 'cod_pending'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
      <button className="btn sm">Search</button></form>
    <div className="kpis"><div className="kpi panel"><span className="small muted">Paid (shown)</span><strong>{inr(sum('paid') + sum('partially_refunded'))}</strong></div>
      <div className="kpi panel"><span className="small muted">Failed (shown)</span><strong>{rows.filter((r) => r.status === 'failed').length}</strong></div>
      <div className="kpi panel"><span className="small muted">Refunded (shown)</span><strong>{inr(rows.reduce((n, r) => n + Number(r.refunded), 0))}</strong></div></div>
    {err && <div className="msg err" role="alert">{err}</div>}
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Payments"><table>
      <thead><tr><th>When</th><th>Order</th><th>Gateway</th><th>Amount</th><th>Refunded</th><th>Status</th><th>Razorpay ids</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td className="small">{new Date(r.created_at).toLocaleString('en-IN')}</td>
        <td className="small"><button className="linklike" onClick={() => openOrder(r.order_id)}>{r.order_number}</button><div className="muted">{r.customer}</div></td>
        <td className="small">{r.gateway}<div className="muted">{r.method ?? ''}</div></td><td>{inr(r.amount)}</td><td>{Number(r.refunded) ? inr(r.refunded) : '—'}</td>
        <td><StatusChip s={r.status} />{r.failure_message && <div className="small danger-t">{r.failure_message}</div>}{r.flagged_reason && <div className="small warn-t">{r.flagged_reason}</div>}</td>
        <td className="small">{r.gateway_payment_id ?? '—'}<div className="muted">{r.gateway_order_id ?? ''}</div></td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="muted">No payments match.</td></tr>}</tbody></table></div>
  </div>);
}
