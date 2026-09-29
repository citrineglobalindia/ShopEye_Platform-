'use client';
// SRS: SA audit logs & activity history (who changed what, when, before/after, reason; filter; load older)
import { useEffect, useState } from 'react';
import { sb } from '@/lib/sb-browser';
import { friendly } from '@/lib/errors';
const ENT = ['', 'profiles', 'user_roles', 'vendors', 'products', 'product_variants', 'orders', 'sub_orders', 'payments', 'vendor_kyc_documents', 'vendor_bank_accounts'];
export function Audit() {
  const [rows, setRows] = useState<any[]>([]); const [ent, setEnt] = useState(''); const [act, setAct] = useState(''); const [err, setErr] = useState(''); const [more, setMore] = useState(true);
  const load = async (append = false) => {
    const before = append && rows.length ? rows[rows.length - 1].id : null;
    const { data, error } = await sb().rpc('admin_audit_log', { p_entity: ent || null, p_action: act || null, p_before: before, p_limit: 50 });
    if (error) { setErr(friendly(error)); return; }
    setErr(''); setMore((data ?? []).length === 50); setRows(append ? [...rows, ...(data ?? [])] : data ?? []);
  };
  useEffect(() => { load(); }, [ent]);
  const diff = (a: any, b: any) => { if (!a && !b) return ''; const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]) && !/_at$|updated|search_tsv/.test(k));
    return keys.slice(0, 6).map((k) => `${k}: ${a?.[k] ?? '—'} → ${b?.[k] ?? '—'}`).join('; '); };
  return (<div className="stack">
    <form className="panel addr" onSubmit={(e) => { e.preventDefault(); load(); }}>
      <select value={ent} onChange={(e) => setEnt(e.target.value)} aria-label="Record type">{ENT.map((x) => <option key={x} value={x}>{x ? x.replace(/_/g, ' ') : 'All record types'}</option>)}</select>
      <input value={act} onChange={(e) => setAct(e.target.value)} placeholder="Action contains… (e.g. role, status)" aria-label="Action" style={{ flex: 1 }} />
      <button className="btn sm">Filter</button></form>
    {err && <div className="msg err" role="alert">{err}</div>}
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Audit log"><table>
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th><th>Change</th><th>Reason</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td className="small">{new Date(r.occurred_at).toLocaleString('en-IN')}</td><td className="small">{r.actor_email ?? 'system'}</td>
        <td className="small">{r.action}</td><td className="small">{r.entity_type}<div className="muted">{String(r.entity_id).slice(0, 8)}</div></td>
        <td className="small">{diff(r.before_value, r.after_value)}</td><td className="small">{r.reason ?? ''}</td></tr>)}
        {!rows.length && <tr><td colSpan={6} className="muted">Nothing recorded yet.</td></tr>}</tbody></table></div>
    {more && rows.length > 0 && <button className="btn ghost sm" style={{ justifySelf: 'center' }} onClick={() => load(true)}>Load older</button>}
  </div>);
}
