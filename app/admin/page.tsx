'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { StatusChip } from '@/components/Status';

export default function Admin() {
  const [ok, setOk] = useState<boolean | null>(null); const [tab, setTab] = useState('vendors');
  useEffect(() => { sb().rpc('my_roles').then(({ data }: any) => setOk((data ?? []).some((r: string) => ['super_admin', 'catalog_moderator'].includes(r)))); }, []);
  if (ok === null) return <div className="wrap section">Loading…</div>;
  if (!ok) return <div className="wrap section"><h1>Admin</h1><p>You don’t have admin access. Sign in with an admin account.</p></div>;
  return (<div className="wrap section stack"><div className="order-head"><h1 style={{ margin: 0 }}>Admin</h1><span className="cta-row"><a className="btn ghost sm" href="/admin/reviews">Review moderation</a><a className="btn ghost sm" href="/status">Build status</a></span></div>
    <div className="tabs" role="tablist">{[['vendors', 'Seller applications'], ['products', 'Listings to review'], ['tickets', 'Help requests'], ['giftcards', 'Gift cards'], ['orders', 'Orders'], ['categories', 'Categories']].map(([k, l]) =>
      <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'vendors' && <Vendors />}{tab === 'products' && <Moderation />}{tab === 'tickets' && <Tickets />}{tab === 'giftcards' && <GiftCards />}{tab === 'orders' && <Orders />}{tab === 'categories' && <Categories />}
  </div>);
}

function Vendors() {
  const [rows, setRows] = useState<any[]>([]); const [filter, setFilter] = useState('submitted'); const [err, setErr] = useState('');
  const load = () => sb().rpc('admin_list_vendors', { p_status: filter || null }).then(({ data, error }: any) => { if (error) setErr(friendly(error)); setRows(data ?? []); });
  useEffect(() => { load(); }, [filter]);
  async function decide(id: string, d: string) {
    const reason = d === 'approve' ? 'Approved after review' : prompt(`Reason to ${d} (shared with the seller)`); if (!reason) return;
    const { error } = await sb().rpc('admin_decide_vendor', { p_vendor: id, p_decision: d, p_reason: reason }); if (error) setErr(friendly(error)); load();
  }
  return (<div className="stack">
    <label style={{ maxWidth: 240 }}>Show<select value={filter} onChange={(e) => setFilter(e.target.value)}>
      {[['submitted', 'Waiting for review'], ['active', 'Active'], ['suspended', 'Suspended'], ['rejected', 'Rejected'], ['', 'All']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    {err && <div className="msg err">{err}</div>}
    {!rows.length ? <div className="panel">Nothing here.</div> : <div className="panel tablewrap"><table>
      <thead><tr><th>Seller</th><th>Business</th><th>GSTIN</th><th>Contact</th><th>Status</th><th></th></tr></thead>
      <tbody>{rows.map((v) => <tr key={v.id}><td><strong>{v.display_name}</strong><div className="small muted">{v.vendor_code}</div></td><td>{v.legal_name}</td><td>{v.gstin || <span className="muted">Not given</span>}</td>
        <td className="small">{v.contact_email}<br />{v.contact_mobile}</td><td><StatusChip s={v.status} /></td>
        <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['submitted', 'under_review'].includes(v.status) && <><button className="btn sm" onClick={() => decide(v.id, 'approve')}>Approve</button><button className="btn danger sm" onClick={() => decide(v.id, 'reject')}>Reject</button></>}
          {v.status === 'active' && <button className="btn danger sm" onClick={() => decide(v.id, 'suspend')}>Suspend</button>}
          {v.status === 'suspended' && <button className="btn sm" onClick={() => decide(v.id, 'reactivate')}>Reactivate</button>}</td></tr>)}</tbody></table></div>}
  </div>);
}

function Moderation() {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState('');
  async function load() {
    const db = sb();
    const { data: p } = await db.from('products').select('id,title,description,vendor_id,gst_rate,hsn_code,created_at').eq('status', 'pending_review').order('created_at');
    const ids = (p ?? []).map((x: any) => x.id);
    const [{ data: v }, { data: m }] = ids.length ? await Promise.all([
      db.from('product_variants').select('product_id,sku,attributes,mrp,selling_price').in('product_id', ids),
      db.from('product_media').select('product_id,url').in('product_id', ids)]) : [{ data: [] }, { data: [] }];
    const { data: vend } = await db.rpc('admin_list_vendors', { p_status: null });
    setRows((p ?? []).map((x: any) => ({ ...x, vars: (v ?? []).filter((y: any) => y.product_id === x.id), img: (m ?? []).find((y: any) => y.product_id === x.id)?.url,
      vendor: (vend ?? []).find((y: any) => y.id === x.vendor_id) })));
  }
  useEffect(() => { load(); }, []);
  async function decide(id: string, d: string) {
    const reason = d === 'reject' ? prompt('What should the seller fix? (shared with the seller)') : null; if (d === 'reject' && !reason) return;
    const { error } = await sb().rpc('admin_moderate_product', { p_product: id, p_decision: d, p_reason: reason }); if (error) setErr(friendly(error)); load();
  }
  if (!rows) return <p>Loading…</p>;
  return (<div className="stack">{err && <div className="msg err">{err}</div>}
    {!rows.length ? <div className="panel">No listings waiting for review.</div> : rows.map((p) => <div key={p.id} className="panel" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 16 }}>
      <div>{p.img ? <img src={p.img} alt="" style={{ borderRadius: 8, aspectRatio: '4/5', objectFit: 'cover' }} /> : <div className="muted small">No image</div>}</div>
      <div className="stack" style={{ gap: 8 }}>
        <strong>{p.title}</strong><span className="small muted">by {p.vendor?.display_name} <StatusChip s={p.vendor?.status || ''} /> · GST {Number(p.gst_rate)}% · HSN {p.hsn_code || '—'}</span>
        {p.description && <p className="small" style={{ margin: 0 }}>{p.description.slice(0, 300)}</p>}
        <div className="small">{p.vars.map((v: any) => <div key={v.sku}>{v.sku} {Object.values(v.attributes || {}).join(' / ')}: {inr(v.selling_price)} (MRP {inr(v.mrp)})</div>)}</div>
        <div style={{ display: 'flex', gap: 8 }}><button className="btn sm" onClick={() => decide(p.id, 'approve')}>Approve listing</button><button className="btn danger sm" onClick={() => decide(p.id, 'reject')}>Send back</button></div>
      </div></div>)}</div>);
}

function Orders() {
  const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState('');
  async function load() {
    const { data } = await sb().from('sub_orders').select('id,sub_order_number,status,total,created_at,order_id').order('created_at', { ascending: false }).limit(100);
    setRows(data ?? []);
  }
  useEffect(() => { load(); }, []);
  async function delivered(id: string) {
    if (!confirm('Record this package as delivered? This starts the return window.')) return;
    const { error } = await sb().rpc('admin_mark_delivered', { p_sub_order: id }); if (error) setErr(friendly(error)); load();
  }
  return (<div className="stack">{err && <div className="msg err">{err}</div>}
    <p className="small muted">Until a courier integration is connected, delivery is recorded here when the courier confirms it.</p>
    {!rows.length ? <div className="panel">No orders yet.</div> : <div className="panel tablewrap"><table><thead><tr><th>Package</th><th>Placed</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td>{r.sub_order_number}</td><td>{new Date(r.created_at).toLocaleString('en-IN')}</td><td>{inr(r.total)}</td><td><StatusChip s={r.status} /></td>
        <td>{r.status === 'shipped' && <button className="btn sm" onClick={() => delivered(r.id)}>Mark delivered</button>}</td></tr>)}</tbody></table></div>}</div>);
}

// SRS: CUST-FR-076 (ShopEye issues closed-loop gift cards; codes are shown once and only their hash is kept)
function GiftCards() {
  const [rows, setRows] = useState<any[]>([]); const [n, setN] = useState('1'); const [amt, setAmt] = useState('500'); const [days, setDays] = useState('365'); const [note, setNote] = useState('');
  const [codes, setCodes] = useState<any[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => sb().from('gift_cards').select('id,last4,amount,expires_at,status,note,redeemed_at,created_at').order('created_at', { ascending: false }).limit(100).then(({ data }: any) => setRows(data ?? []));
  useEffect(() => { load(); }, []);
  async function issue(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { data, error } = await sb().rpc('admin_issue_gift_cards', { p_count: Number(n), p_amount: Number(amt), p_valid_days: Number(days), p_note: note || null }); setBusy(false);
    if (error) { setErr(/COUNT/.test(error.message) ? 'Issue between 1 and 500 cards at a time.' : /AMOUNT/.test(error.message) ? 'Amount must be above ₹0 and at most ₹10,000.' : /VALIDITY/.test(error.message) ? 'Validity must be 30 to 1,095 days.' : friendly(error)); return; }
    setCodes(data ?? []); load();
  }
  function download() {
    const csv = 'code,amount,expires\n' + codes.map((c) => `${c.code},${c.amount},${String(c.expires_at).slice(0, 10)}`).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); Object.assign(document.createElement('a'), { href: url, download: 'shopeye-gift-cards.csv' }).click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  return (<div className="stack">
    <form className="panel stack" onSubmit={issue}>
      <strong>Issue gift cards</strong>
      <div className="row2" style={{ gap: 8 }}><label>How many<input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /></label><label>Amount (₹ each)<input inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value)} /></label></div>
      <div className="row2" style={{ gap: 8 }}><label>Valid for (days)<input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label><label>Note (e.g. campaign)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} /></label></div>
      <p className="small muted" style={{ margin: 0 }}>Closed-loop cards, usable only on ShopEye. The total is booked as a promotional expense and a customer-balance liability.</p>
      {err && <div className="msg err" role="alert">{err}</div>}
      <div><button className="btn sm" disabled={busy}>{busy ? 'Issuing…' : 'Issue'}</button></div>
    </form>
    {codes.length > 0 && <div className="panel stack"><strong>New codes — copy or download them now. They can’t be shown again.</strong>
      <pre className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{codes.map((c) => `${c.code}  ₹${c.amount}`).join('\n')}</pre>
      <div><button className="btn ghost sm" onClick={download}>Download CSV</button></div></div>}
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Gift cards"><table><thead><tr><th>Card</th><th>Amount</th><th>Status</th><th>Expires</th><th>Note</th></tr></thead>
      <tbody>{rows.map((g) => <tr key={g.id}><td>••{g.last4}</td><td>{inr(g.amount)}</td><td><StatusChip s={g.status} /></td><td>{new Date(g.expires_at).toLocaleDateString('en-IN')}</td><td className="small">{g.note}</td></tr>)}</tbody></table></div>
  </div>);
}

// SRS: CUST-FR-140 (urgent help requests are listed first)
function Tickets() {
  const [rows, setRows] = useState<any[]>([]); const [err, setErr] = useState('');
  const load = () => sb().from('support_tickets').select('id,ticket_number,category,subject,message,status,priority,urgent_reason,created_at').not('status', 'in', '(resolved,closed)')
    .order('priority', { ascending: false }).order('created_at').limit(100).then(({ data, error }: any) => { if (error) setErr(friendly(error)); setRows(data ?? []); });
  useEffect(() => { load(); }, []);
  async function set(id: string, st: string) { const { error } = await sb().rpc('update_ticket_status', { p_ticket: id, p_status: st }); if (error) setErr(friendly(error)); load(); }
  return (<div className="stack">{err && <div className="msg err">{err}</div>}
    {!rows.length ? <div className="panel">No open help requests.</div> : rows.map((t) => (
      <details key={t.id} className="panel"><summary className="pkg-head"><span>{t.priority === 'urgent' && <span className="chip warn">Urgent</span>} <strong>{t.ticket_number}</strong> · {t.subject}</span><StatusChip s={t.status} /></summary>
        <p className="small muted">{t.category}{t.urgent_reason ? ` · ${t.urgent_reason.replace(/_/g, ' ')}` : ''} · {new Date(t.created_at).toLocaleString('en-IN')}</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{t.message}</p>
        <div className="cta-row">{t.status === 'open' && <button className="btn sm" onClick={() => set(t.id, 'in_progress')}>Start</button>}<button className="btn ghost sm" onClick={() => set(t.id, 'resolved')}>Mark resolved</button></div>
      </details>))}</div>);
}

function Categories() {
  const [rows, setRows] = useState<any[]>([]); const [name, setName] = useState(''); const [gst, setGst] = useState('5'); const [days, setDays] = useState('7'); const [err, setErr] = useState('');
  const load = () => sb().from('categories').select('id,name,slug,default_gst_rate,return_window_days').order('name').then(({ data }: any) => setRows(data ?? []));
  useEffect(() => { load(); }, []);
  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const { error } = await sb().rpc('admin_create_category', { p_name: name, p_parent: null, p_gst_rate: Number(gst), p_return_days: Number(days) });
    if (error) { setErr(/duplicate/.test(error.message) ? 'A category with that name already exists.' : friendly(error)); return; } setName(''); load();
  }
  return (<div className="stack">
    <form className="form panel" onSubmit={add} style={{ maxWidth: 'none' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
        <label>Category name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Default GST<select value={gst} onChange={(e) => setGst(e.target.value)}>{['0', '3', '5', '12', '18', '28'].map((g) => <option key={g} value={g}>{g}%</option>)}</select></label>
        <label>Return days<input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
        <button className="btn">Add category</button></div>
      {err && <div className="msg err">{err}</div>}</form>
    <div className="panel tablewrap"><table><thead><tr><th>Name</th><th>Link</th><th>GST</th><th>Returns</th></tr></thead>
      <tbody>{rows.map((c) => <tr key={c.id}><td>{c.name}</td><td>/c/{c.slug}</td><td>{Number(c.default_gst_rate)}%</td><td>{c.return_window_days} days</td></tr>)}</tbody></table></div>
  </div>);
}
