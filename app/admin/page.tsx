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
  return (<div className="wrap section stack"><h1>Admin</h1>
    <div className="tabs" role="tablist">{[['vendors', 'Seller applications'], ['products', 'Listings to review'], ['orders', 'Orders'], ['categories', 'Categories']].map(([k, l]) =>
      <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'vendors' && <Vendors />}{tab === 'products' && <Moderation />}{tab === 'orders' && <Orders />}{tab === 'categories' && <Categories />}
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
