'use client';
// SRS: SA admin users, roles & permissions (grant by email with reason, revoke with reason, roles and what they allow)
import { useEffect, useState } from 'react';
import { sb } from '@/lib/sb-browser';
import { friendly } from '@/lib/errors';

export function Staff() {
  const [staff, setStaff] = useState<any[]>([]); const [roles, setRoles] = useState<any[]>([]); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [email, setEmail] = useState(''); const [role, setRole] = useState('help_desk_agent'); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const load = async () => {
    const [a, b] = await Promise.all([sb().rpc('admin_list_staff'), sb().rpc('admin_list_roles')]);
    if (a.error || b.error) setErr(friendly(a.error ?? b.error)); else { setStaff(a.data ?? []); setRoles(b.data ?? []); }
  };
  useEffect(() => { load(); }, []);
  async function grant(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(''); setMsg('');
    const { error } = await sb().rpc('admin_grant_role', { p_email: email, p_role: role, p_reason: reason }); setBusy(false);
    if (error) setErr(friendly(error)); else { setMsg(`${role.replace(/_/g, ' ')} given to ${email}.`); setEmail(''); setReason(''); load(); }
  }
  async function revoke(u: any, r: string) {
    const why = prompt(`Remove "${r.replace(/_/g, ' ')}" from ${u.email}? Give a reason (kept in the audit log):`);
    if (!why) return;
    const { error } = await sb().rpc('admin_revoke_role', { p_user: u.user_id, p_role: r, p_reason: why });
    if (error) setErr(friendly(error)); else { setMsg(`Removed ${r.replace(/_/g, ' ')} from ${u.email}.`); load(); }
  }
  return (<div className="stack">
    <form className="panel stack" onSubmit={grant}>
      <h2 style={{ margin: 0 }}>Give someone a staff role</h2>
      <p className="small muted" style={{ margin: 0 }}>They need a ShopEye account first (they sign up normally). Seller roles are handled from the seller’s shop, not here.</p>
      <div className="row2"><label>Their account email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Role<select value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((r) => <option key={r.code} value={r.code}>{r.name ?? r.code}</option>)}</select></label></div>
      <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={300} required placeholder="e.g. Joined the support team" /></label>
      {err && <div className="msg err" role="alert">{err}</div>}{msg && <div className="msg ok" role="status">{msg}</div>}
      <button className="btn dark sm" disabled={busy} style={{ justifySelf: 'start' }}>{busy ? 'Saving…' : 'Give role'}</button>
    </form>
    <section className="panel tablewrap" tabIndex={0} role="region" aria-label="Staff"><table>
      <thead><tr><th>Person</th><th>Roles</th><th>Account</th></tr></thead>
      <tbody>{staff.map((u) => <tr key={u.user_id}><td><strong>{u.full_name}</strong><div className="small muted">{u.email}</div></td>
        <td>{u.roles.map((r: string) => <span key={r} className="role-chip">{r.replace(/_/g, ' ')} <button className="linklike danger-t" aria-label={`Remove ${r} from ${u.email}`} onClick={() => revoke(u, r)}>×</button></span>)}</td>
        <td className="small">{u.status}</td></tr>)}
        {!staff.length && <tr><td colSpan={3} className="muted">No staff yet.</td></tr>}</tbody></table></section>
    <section className="panel stack"><h2 style={{ margin: 0 }}>Roles and what they allow</h2>
      {roles.map((r) => <details key={r.code} className="acc"><summary><h2 style={{ fontSize: '.9rem' }}>{r.name ?? r.code}</h2></summary>
        <p className="small" style={{ margin: 0 }}>{r.permissions.length ? r.permissions.join(' · ') : 'No permissions yet.'}</p></details>)}</section>
  </div>);
}
