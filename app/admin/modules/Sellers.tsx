'use client';
// SRS: SA vendor administration, KYC review, commission plans, vendor settlements & payouts
import { useEffect, useState } from 'react';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { StatusChip } from '@/components/Status';

export function Sellers({ canManage, canKyc }: { canManage: boolean; canKyc: boolean }) {
  const [rows, setRows] = useState<any[]>([]); const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [open, setOpen] = useState<string | null>(null); const [err, setErr] = useState('');
  const load = () => sb().rpc('admin_vendor_list', { p_status: status || null, p_q: q || null }).then(({ data, error }: any) => { if (error) setErr(friendly(error)); else { setErr(''); setRows(data ?? []); } });
  useEffect(() => { load(); }, [status]);
  if (open) return <Seller id={open} canManage={canManage} canKyc={canKyc} back={() => { setOpen(null); load(); }} />;
  return (<div className="stack">
    <form className="panel filters-row" onSubmit={(e) => { e.preventDefault(); load(); }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Shop name, legal name, code or GSTIN" aria-label="Search sellers" />
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['submitted', 'under_review', 'info_requested', 'approved', 'active', 'suspended', 'rejected', 'closed'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
      <button className="btn sm">Search</button></form>
    {err && <div className="msg err" role="alert">{err}</div>}
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Sellers"><table>
      <thead><tr><th>Seller</th><th>GSTIN</th><th>Live products</th><th>Sales</th><th>Balance</th><th>KYC to review</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.display_name}</strong>{r.is_demo && <span className="small muted"> · preview</span>}<div className="small muted">{r.vendor_code} · {r.contact_email}</div></td>
        <td className="small">{r.gstin ?? '—'}</td><td>{r.products}</td><td>{inr(r.gmv)}</td><td>{inr(r.balance)}</td><td>{r.kyc_pending || '—'}</td><td><StatusChip s={r.status} /></td>
        <td><button className="linklike" onClick={() => setOpen(r.id)}>Open</button></td></tr>)}
        {!rows.length && <tr><td colSpan={8} className="muted">No sellers match.</td></tr>}</tbody></table></div>
  </div>);
}

function Seller({ id, back, canManage, canKyc }: { id: string; back: () => void; canManage: boolean; canKyc: boolean }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = () => sb().rpc('admin_vendor_detail', { p_vendor: id }).then(({ data, error }: any) => { if (error) setErr(friendly(error)); else setD(data); });
  useEffect(() => { load(); }, [id]);
  async function run(fn: () => PromiseLike<any>, ok: string) { setErr(''); setMsg(''); const { error } = await fn(); if (error) setErr(friendly(error)); else { setMsg(ok); load(); } }
  if (!d) return <div className="stack"><button className="linklike" onClick={back}>‹ All sellers</button>{err ? <div className="msg err">{err}</div> : <p className="muted">Loading…</p>}</div>;
  const v = d.vendor; const s = d.stats;
  const setStatus = (st: string) => { const why = prompt(`Why ${st === 'active' ? 'reactivate' : st === 'suspended' ? 'suspend' : 'close'} ${v.display_name}? (kept in the audit log)`); if (why) run(() => sb().rpc('admin_set_vendor_status', { p_vendor: id, p_status: st, p_reason: why }), `Seller is now ${st}.`); };
  const kyc = (k: any, ok: boolean) => { const note = ok ? prompt('Note (optional):') ?? '' : prompt('What must the seller fix? (they see this)'); if (!ok && !note) return; run(() => sb().rpc('admin_review_kyc', { p_doc: k.id, p_approve: ok, p_note: note }), `${k.doc_type} ${ok ? 'verified' : 'rejected'}.`); };
  const bank = (a: any, ok: boolean) => { const note = prompt(ok ? 'Approval note (e.g. penny-drop matched):' : 'Why reject this account?'); if (note) run(() => sb().rpc('admin_decide_bank', { p_account: a.id, p_approve: ok, p_note: note }), `Bank account ${ok ? 'approved' : 'rejected'}.`); };
  const hold = () => { const amt = Number(prompt('Hold how much (₹) from this seller’s payouts?')); if (!amt) return; const why = prompt('Reason (e.g. dispute number):'); if (why) run(() => sb().rpc('admin_place_hold', { p_vendor: id, p_amount: amt, p_reason: why }), 'Hold placed.'); };
  const release = (h: any) => { const why = prompt('Why release this hold?'); if (why) run(() => sb().rpc('admin_release_hold', { p_hold: h.id, p_reason: why }), 'Hold released.'); };
  return (<div className="stack">
    <button className="linklike" style={{ justifySelf: 'start' }} onClick={back}>‹ All sellers</button>
    <div className="panel stack">
      <div className="addr"><div><h2 style={{ margin: 0 }}>{v.display_name}</h2><div className="small muted">{v.legal_name} · {v.vendor_code} · {v.business_type ?? ''} · GSTIN {v.gstin ?? '—'} · PAN ••••{v.pan_last4 ?? '—'}</div>
        <div className="small muted">{v.contact_email} · {v.contact_mobile} · settles {v.settlement_cycle ?? 'weekly'}</div></div>
        <span className="cta-row"><StatusChip s={v.status} />{canManage && (v.status === 'active' ? <button className="btn ghost sm" onClick={() => setStatus('suspended')}>Suspend…</button>
          : v.status === 'suspended' ? <button className="btn sm" onClick={() => setStatus('active')}>Reactivate…</button> : null)}</span></div>
      {v.status_reason && <p className="small" style={{ margin: 0 }}>Last reason: {v.status_reason}</p>}
      <div className="kpis">{[['Live products', s.products_live], ['Awaiting review', s.products_review], ['Orders', s.orders], ['Sales', inr(s.gmv)], ['Balance owed', inr(s.balance)], ['On hold', inr(s.held)]].map(([l, x]) =>
        <div key={String(l)} className="kpi"><span className="small muted">{l}</span><strong>{x}</strong></div>)}</div>
    </div>
    {err && <div className="msg err" role="alert">{err}</div>}{msg && <div className="msg ok" role="status">{msg}</div>}
    <section className="panel stack"><h3 style={{ margin: 0 }}>KYC documents</h3>
      {d.kyc.length ? d.kyc.map((k: any) => <div key={k.id} className="addr small"><span>{k.doc_type.replace(/_/g, ' ')} · uploaded {new Date(k.uploaded_at).toLocaleDateString('en-IN')}{k.expires_on ? ` · expires ${k.expires_on}` : ''}{k.review_note ? ` · “${k.review_note}”` : ''}</span>
        <span className="cta-row"><StatusChip s={k.status} />{canKyc && k.status === 'pending' && <><button className="btn sm" onClick={() => kyc(k, true)}>Verify</button><button className="btn ghost sm" onClick={() => kyc(k, false)}>Reject…</button></>}</span></div>)
        : <p className="muted small" style={{ margin: 0 }}>No documents uploaded yet.</p>}</section>
    <section className="panel stack"><h3 style={{ margin: 0 }}>Bank accounts</h3>
      {d.banks.length ? d.banks.map((a: any) => <div key={a.id} className="addr small"><span>{a.account_holder} · ••••{a.account_last4} · {a.ifsc} · penny drop {a.penny_drop_status ?? '—'}</span>
        <span className="cta-row"><StatusChip s={a.status} />{canManage && a.status === 'pending_approval' && <><button className="btn sm" onClick={() => bank(a, true)}>Approve…</button><button className="btn ghost sm" onClick={() => bank(a, false)}>Reject…</button></>}</span></div>)
        : <p className="muted small" style={{ margin: 0 }}>No bank account added.</p>}</section>
    <section className="panel stack"><div className="addr"><h3 style={{ margin: 0 }}>Settlement holds</h3>{canManage && <button className="btn ghost sm" onClick={hold}>Place hold…</button>}</div>
      {d.holds.length ? d.holds.map((h: any) => <div key={h.id} className="addr small"><span>{inr(h.amount)} · {h.reason} · {new Date(h.placed_at).toLocaleDateString('en-IN')}</span>
        <span className="cta-row"><StatusChip s={h.status} />{h.status === 'active' && <button className="linklike" onClick={() => release(h)}>Release…</button>}</span></div>) : <p className="muted small" style={{ margin: 0 }}>No holds.</p>}</section>
    <section className="panel stack"><h3 style={{ margin: 0 }}>Commission rules for this seller</h3>
      {d.commission.length ? d.commission.map((r: any) => <div key={r.id} className="small">{r.category ?? 'All categories'} · {r.commission_type === 'percent' ? `${r.commission_value}%` : `${inr(r.commission_value)} per unit`} · from {r.effective_from}{r.effective_to ? ` to ${r.effective_to}` : ''}{r.active ? '' : ' · inactive'}</div>)
        : <p className="muted small" style={{ margin: 0 }}>Uses the category or marketplace rate. Set seller rates in Commission.</p>}</section>
    <section className="panel stack"><h3 style={{ margin: 0 }}>Payouts</h3>
      {d.payouts.length ? d.payouts.map((p: any) => <div key={p.id} className="addr small"><span>{p.batch_number} · {inr(p.net_payable)}{p.utr ? ` · UTR ${p.utr}` : ''}{p.paid_at ? ` · ${new Date(p.paid_at).toLocaleDateString('en-IN')}` : ''}</span><StatusChip s={p.payout_status} /></div>)
        : <p className="muted small" style={{ margin: 0 }}>No payouts yet.</p>}</section>
    <section className="panel stack"><h3 style={{ margin: 0 }}>Team and history</h3>
      {d.team.map((t: any, k: number) => <div key={k} className="small">{t.name} · {t.email} · {t.role.replace(/_/g, ' ')}</div>)}
      {d.history.map((h: any, k: number) => <div key={'h' + k} className="small muted">{new Date(h.occurred_at).toLocaleString('en-IN')} · {h.action}{h.status ? ` → ${h.status}` : ''}{h.by_email ? ` · ${h.by_email}` : ''}{h.reason ? ` · “${h.reason}”` : ''}</div>)}</section>
  </div>);
}

export function Commission() {
  const [rows, setRows] = useState<any[]>([]); const [cats, setCats] = useState<any[]>([]); const [vendors, setVendors] = useState<any[]>([]);
  const [f, setF] = useState({ vendor: '', category: '', type: 'percent', value: '', from: new Date().toISOString().slice(0, 10), note: '' }); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = async () => {
    const [a, b, c] = await Promise.all([sb().rpc('admin_list_commission_rules'), sb().from('categories').select('id,name,level').eq('active', true).order('level').order('name'), sb().rpc('admin_vendor_list', { p_status: 'active', p_q: null })]);
    if (a.error) setErr(friendly(a.error)); else setRows(a.data ?? []); setCats(b.data ?? []); setVendors(c.data ?? []);
  };
  useEffect(() => { load(); }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    const { error } = await sb().rpc('admin_save_commission_rule', { p_vendor: f.vendor || null, p_category: f.category || null, p_type: f.type, p_value: Number(f.value), p_from: f.from, p_note: f.note });
    if (error) setErr(friendly(error)); else { setMsg('Commission rule saved; the rule it replaces ends the day before.'); setF({ ...f, value: '', note: '' }); load(); }
  }
  async function end(r: any) { const why = prompt('Why end this rule?'); if (!why) return; const { error } = await sb().rpc('admin_end_commission_rule', { p_rule: r.id, p_note: why }); if (error) setErr(friendly(error)); else load(); }
  return (<div className="stack">
    <form className="panel stack" onSubmit={save}>
      <h2 style={{ margin: 0 }}>Set a commission rate</h2>
      <p className="small muted" style={{ margin: 0 }}>Most specific wins: a seller’s own rate, then the category rate, then the marketplace default (leave both empty). Commission is charged on the item’s selling price, plus 18% GST on the commission. Orders keep the rate they were placed at.</p>
      <div className="row2"><label>Seller<select value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })}><option value="">Any seller</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.display_name}</option>)}</select></label>
        <label>Category<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Any category</option>{cats.map((c) => <option key={c.id} value={c.id}>{'— '.repeat(Math.max(0, c.level - 1))}{c.name}</option>)}</select></label></div>
      <div className="row2"><label>Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="percent">Percentage of price</option><option value="flat_per_unit">Fixed ₹ per unit</option></select></label>
        <label>{f.type === 'percent' ? 'Rate (%)' : 'Amount (₹ per unit)'}<input type="number" step="0.01" min={0} max={f.type === 'percent' ? 60 : undefined} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required /></label></div>
      <div className="row2"><label>Starts on<input type="date" value={f.from} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, from: e.target.value })} required /></label>
        <label>Note<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} minLength={5} required placeholder="e.g. Launch rate agreed with seller" /></label></div>
      {err && <div className="msg err" role="alert">{err}</div>}{msg && <div className="msg ok" role="status">{msg}</div>}
      <button className="btn dark sm" style={{ justifySelf: 'start' }}>Save rate</button>
    </form>
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Commission rules"><table>
      <thead><tr><th>Applies to</th><th>Rate</th><th>From</th><th>To</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td>{r.vendor ?? 'Any seller'} · {r.category ?? 'any category'}</td><td>{r.commission_type === 'percent' ? `${Number(r.commission_value)}%` : `${inr(r.commission_value)}/unit`}</td>
        <td className="small">{r.effective_from}</td><td className="small">{r.effective_to ?? 'open'}</td><td><StatusChip s={r.active ? 'active' : 'inactive'} /></td>
        <td>{r.active && <button className="linklike danger-t" onClick={() => end(r)}>End…</button>}</td></tr>)}
        {!rows.length && <tr><td colSpan={6} className="muted">No commission rules yet — ShopEye earns ₹0 per sale until you add one (a marketplace default is the usual start).</td></tr>}</tbody></table></div>
  </div>);
}

export function Settlements() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => sb().rpc('admin_list_settlements').then(({ data, error }: any) => { if (error) setErr(friendly(error)); else setD(data); });
  useEffect(() => { load(); }, []);
  async function action(a: string, b?: any) {
    let comment: string | null = null;
    if (['approve', 'reject', 'return'].includes(a)) { comment = prompt(`${a[0].toUpperCase() + a.slice(1)} batch ${b.batch_number}? Add a note:`); if (!comment) return; }
    if (a === 'generate' && !confirm('Create a settlement batch for everything eligible up to now?')) return;
    setBusy(true); setErr(''); setMsg(''); const { data, error } = await sb().rpc('admin_settlement_action', { p_action: a, p_batch: b?.id ?? null, p_cycle: 'weekly', p_comment: comment }); setBusy(false);
    if (error) setErr(friendly(error)); else { setMsg(`Done: ${String(data).replace(/_/g, ' ')}.`); load(); }
  }
  async function paid(l: any, ok: boolean) {
    const utr = ok ? prompt(`Bank UTR / reference for ${inr(l.net)} paid to ${l.vendor}:`) : null; if (ok && !utr) return;
    const why = ok ? null : prompt('Why did this payout fail?'); if (!ok && !why) return;
    const { error } = await sb().rpc('admin_record_payout', { p_line: l.id, p_paid: ok, p_utr: utr, p_failure: why });
    if (error) setErr(friendly(error)); else { setMsg(ok ? `Payout to ${l.vendor} recorded.` : 'Failure recorded; it can be retried.'); load(); }
  }
  if (!d) return err ? <div className="msg err" role="alert">{err}</div> : <p className="muted">Loading…</p>;
  return (<div className="stack">
    <section className="panel stack"><div className="addr"><h2 style={{ margin: 0 }}>What sellers are owed</h2><button className="btn sm" disabled={busy} onClick={() => action('generate')}>Create settlement batch</button></div>
      <p className="small muted" style={{ margin: 0 }}>A batch includes delivered orders past their return window, minus commission, refunds and holds. It then needs a second person to approve before payouts are recorded.</p>
      <div className="tablewrap"><table><thead><tr><th>Seller</th><th>Balance</th><th>On hold</th><th>Bank</th><th>Cycle</th></tr></thead>
        <tbody>{d.balances.length ? d.balances.map((b: any) => <tr key={b.id}><td>{b.display_name}</td><td>{inr(b.balance)}</td><td>{Number(b.held) ? inr(b.held) : '—'}</td><td className="small">{b.bank_last4 ? `••••${b.bank_last4}` : <span className="danger-t">no approved account</span>}</td><td className="small">{b.settlement_cycle ?? 'weekly'}</td></tr>)
          : <tr><td colSpan={5} className="muted">No seller balances yet.</td></tr>}</tbody></table></div></section>
    {err && <div className="msg err" role="alert">{err}</div>}{msg && <div className="msg ok" role="status">{msg}</div>}
    {d.batches.map((b: any) => <section key={b.id} className="panel stack">
      <div className="addr"><div><strong>{b.batch_number}</strong><div className="small muted">{b.cycle} · cut-off {new Date(b.cutoff_at).toLocaleString('en-IN')} · {b.vendor_count} sellers · prepared by {b.prepared_by ?? '—'}</div></div>
        <span className="cta-row"><StatusChip s={b.status} />
          {b.status === 'draft' && <button className="btn sm" disabled={busy} onClick={() => action('submit', b)}>Submit for approval</button>}
          {b.status === 'pending_approval' && <><button className="btn sm" disabled={busy} onClick={() => action('approve', b)}>Approve…</button><button className="btn ghost sm" disabled={busy} onClick={() => action('return', b)}>Send back…</button><button className="btn ghost sm" disabled={busy} onClick={() => action('reject', b)}>Reject…</button></>}</span></div>
      <div className="kpis"><div className="kpi"><span className="small muted">Eligible</span><strong>{inr(b.gross_eligible)}</strong></div><div className="kpi"><span className="small muted">Held</span><strong>{inr(b.total_holds)}</strong></div><div className="kpi"><span className="small muted">Net to pay</span><strong>{inr(b.net_payable)}</strong></div></div>
      <div className="tablewrap"><table><thead><tr><th>Seller</th><th>Eligible</th><th>Held</th><th>Net</th><th>Payout</th><th /></tr></thead>
        <tbody>{b.lines.map((l: any) => <tr key={l.id}><td>{l.vendor}</td><td>{inr(l.eligible)}</td><td>{inr(l.held)}</td><td>{inr(l.net)}</td><td><StatusChip s={l.status} />{l.utr && <div className="small muted">UTR {l.utr}</div>}{l.failure && <div className="small danger-t">{l.failure}</div>}</td>
          <td>{['approved', 'processing', 'partial'].includes(b.status) && l.status !== 'paid' && <span className="cta-row"><button className="btn sm" onClick={() => paid(l, true)}>Mark paid…</button><button className="btn ghost sm" onClick={() => paid(l, false)}>Failed…</button></span>}</td></tr>)}</tbody></table></div>
    </section>)}
    {!d.batches.length && <p className="muted">No settlement batches yet.</p>}
  </div>);
}
