'use client';
// SRS: SA customer management (search, profile with orders/tickets/balance, lock/suspend/reactivate with reason, history)
import { useEffect, useState } from 'react';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { StatusChip } from '@/components/Status';

export function Customers({ canManage }: { canManage: boolean }) {
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [rows, setRows] = useState<any[]>([]); const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null); const [err, setErr] = useState('');
  const load = (pg = page) => sb().rpc('admin_list_customers', { p_q: q || null, p_status: status || null, p_limit: 50, p_offset: pg * 50 })
    .then(({ data, error }: any) => { if (error) setErr(friendly(error)); else { setErr(''); setRows(data ?? []); } });
  useEffect(() => { load(0); setPage(0); }, [status]);
  const total = rows[0]?.total ?? 0;
  if (open) return <Customer id={open} back={() => { setOpen(null); load(); }} canManage={canManage} />;
  return (<div className="stack">
    <form className="panel addr" onSubmit={(e) => { e.preventDefault(); setPage(0); load(0); }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or mobile" aria-label="Search customers" style={{ flex: 1 }} />
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option><option value="active">Active</option><option value="locked">Locked</option><option value="suspended">Suspended</option><option value="unverified">Unverified</option><option value="closed">Closed</option></select>
      <button className="btn sm">Search</button>
    </form>
    {err && <div className="msg err" role="alert">{err}</div>}
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Customers"><table>
      <thead><tr><th>Customer</th><th>Mobile</th><th>Joined</th><th>Orders</th><th>Spend</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}>
        <td><strong>{r.full_name}</strong>{r.is_staff && <span className="small muted"> · staff</span>}<div className="small muted">{r.email}</div></td>
        <td className="small">{r.mobile ?? '—'}</td><td className="small">{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
        <td>{r.orders}</td><td>{inr(r.spend)}</td><td><StatusChip s={r.status} /></td>
        <td><button className="linklike" onClick={() => setOpen(r.id)}>Open</button></td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="muted">No customers match.</td></tr>}</tbody></table></div>
    <div className="addr"><span className="small muted">{total} customers</span>
      <span className="cta-row"><button className="btn ghost sm" disabled={page === 0} onClick={() => { setPage(page - 1); load(page - 1); }}>Previous</button>
        <button className="btn ghost sm" disabled={(page + 1) * 50 >= total} onClick={() => { setPage(page + 1); load(page + 1); }}>Next</button></span></div>
  </div>);
}

function Customer({ id, back, canManage }: { id: string; back: () => void; canManage: boolean }) {
  const [d, setD] = useState<any>(null); const [st, setSt] = useState('suspended'); const [reason, setReason] = useState('');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => sb().rpc('admin_customer_detail', { p_id: id }).then(({ data, error }: any) => { if (error) setErr(friendly(error)); else setD(data); });
  useEffect(() => { load(); }, [id]);
  async function change(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(''); setMsg('');
    const { error } = await sb().rpc('admin_set_customer_status', { p_id: id, p_status: st, p_reason: reason }); setBusy(false);
    if (error) setErr(friendly(error)); else { setMsg(`Account is now ${st}.`); setReason(''); load(); }
  }
  if (!d) return <div className="stack"><button className="linklike" onClick={back}>‹ All customers</button>{err ? <div className="msg err">{err}</div> : <p className="muted">Loading…</p>}</div>;
  const p = d.profile;
  return (<div className="stack">
    <button className="linklike" style={{ justifySelf: 'start' }} onClick={back}>‹ All customers</button>
    <div className="panel stack">
      <div className="addr"><div><h2 style={{ margin: 0 }}>{p.full_name}</h2><div className="small muted">{p.email} · {p.mobile ?? 'no mobile'} · joined {new Date(p.created_at).toLocaleDateString('en-IN')}</div></div><StatusChip s={p.status} /></div>
      <div className="kpis">
        <div className="kpi"><span className="small muted">Orders</span><strong>{d.orders.length}</strong></div>
        <div className="kpi"><span className="small muted">ShopEye balance</span><strong>{inr(d.balance)}</strong></div>
        <div className="kpi"><span className="small muted">Saved addresses</span><strong>{d.addresses}</strong></div>
        <div className="kpi"><span className="small muted">Roles</span><strong className="small">{d.roles.join(', ') || '—'}</strong></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Marketing emails: {p.marketing_consent ? 'yes' : 'no'} · terms accepted: {p.terms_version ?? '—'}{p.consent_at ? ` on ${new Date(p.consent_at).toLocaleDateString('en-IN')}` : ''}</p>
    </div>
    {canManage && <form className="panel stack" onSubmit={change}>
      <h3 style={{ margin: 0 }}>Change account status</h3>
      <div className="row2"><label>New status<select value={st} onChange={(e) => setSt(e.target.value)}><option value="active">Active (reactivate)</option><option value="locked">Locked (can’t sign in until reactivated)</option><option value="suspended">Suspended (policy or fraud review)</option></select></label>
        <label>Reason (kept in the audit log)<input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={300} required /></label></div>
      {err && <div className="msg err" role="alert">{err}</div>}{msg && <div className="msg ok" role="status">{msg}</div>}
      <button className="btn dark sm" disabled={busy} style={{ justifySelf: 'start' }}>{busy ? 'Saving…' : 'Save status'}</button>
    </form>}
    <section className="panel stack"><h3 style={{ margin: 0 }}>Recent orders</h3>
      <div className="tablewrap" tabIndex={0} role="region" aria-label="Customer orders"><table><thead><tr><th>Order</th><th>Placed</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>{d.orders.length ? d.orders.map((o: any) => <tr key={o.id}><td>{o.order_number}</td><td className="small">{new Date(o.placed_at).toLocaleString('en-IN')}</td><td>{inr(o.grand_total)}</td><td><StatusChip s={o.status} /></td></tr>)
          : <tr><td colSpan={4} className="muted">No orders.</td></tr>}</tbody></table></div></section>
    <section className="panel stack"><h3 style={{ margin: 0 }}>Help requests</h3>
      {d.tickets.length ? d.tickets.map((t: any) => <div key={t.id} className="addr"><span>{t.ticket_number} · {t.subject}</span><StatusChip s={t.status} /></div>) : <p className="muted" style={{ margin: 0 }}>None.</p>}</section>
    <section className="panel stack"><h3 style={{ margin: 0 }}>Account history</h3>
      {d.history.length ? d.history.map((h: any, k: number) => <div key={k} className="small"><strong>{new Date(h.occurred_at).toLocaleString('en-IN')}</strong> · {h.action}{h.status ? ` → ${h.status}` : ''}{h.by_email ? ` by ${h.by_email}` : ''}{h.reason ? ` · “${h.reason}”` : ''}</div>)
        : <p className="muted" style={{ margin: 0 }}>No changes recorded.</p>}</section>
  </div>);
}
