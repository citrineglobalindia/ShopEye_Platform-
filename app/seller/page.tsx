'use client';
// SRS: VS-FR-096 VS-FR-099 (onboarding submitted/under review, activation on approval)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { StatusChip } from '@/components/Status';

export default function SellerHub() {
  const [state, setState] = useState<'loading' | 'anon' | 'apply' | 'ready'>('loading');
  const [vendor, setVendor] = useState<any>(null);
  async function load() {
    const db = sb(); const { data: { user } } = await db.auth.getUser();
    if (!user) { setState('anon'); return; }
    const { data } = await db.rpc('my_vendor'); setVendor(data); setState(data ? 'ready' : 'apply');
  }
  useEffect(() => { load(); }, []);
  if (state === 'loading') return <div className="wrap section">Loading…</div>;
  if (state === 'anon') return (<div className="wrap section" style={{ maxWidth: 640 }}>
    <h1>Sell on ShopEye</h1><p>List your products, receive orders, and get paid on a weekly cycle after the return window closes.</p>
    <Link className="btn" href="/login?next=/seller">Sign in to start</Link></div>);
  if (state === 'apply') return <Apply onDone={load} />;
  return <Dashboard vendor={vendor} />;
}

function Apply({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ legal: '', display: '', mobile: '', gstin: '', pincode: '', line1: '', city: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: any) => setF({ ...f, [k]: e.target.value }) });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (f.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin.toUpperCase())) { setErr('GSTIN format looks wrong. It should be 15 characters, like 29ABCDE1234F1Z5.'); return; }
    setBusy(true);
    const { error } = await sb().rpc('apply_as_vendor', { p_legal_name: f.legal, p_display_name: f.display, p_mobile: f.mobile ? '+91' + f.mobile.replace(/\D/g, '').slice(-10) : null,
      p_gstin: f.gstin, p_pickup_pincode: f.pincode, p_address: { line1: f.line1, city: f.city, pincode: f.pincode } });
    setBusy(false); if (error) { setErr(friendly(error)); return; } onDone();
  }
  return (<div className="wrap section" style={{ maxWidth: 680 }}>
    <h1>Apply to sell</h1>
    <p className="muted">We review every seller before their products go live. You can start listing products while we review.</p>
    <form className="form panel" style={{ maxWidth: 'none' }} onSubmit={submit}>
      <div className="row2"><label>Registered business name<input required minLength={2} {...b('legal')} /></label>
        <label>Shop name shown to shoppers<input required minLength={2} maxLength={120} {...b('display')} /></label></div>
      <div className="row2"><label>Business mobile<input inputMode="tel" {...b('mobile')} /></label>
        <label>GSTIN (optional for now)<input maxLength={15} {...b('gstin')} /></label></div>
      <label>Pickup address<input required {...b('line1')} /></label>
      <div className="row2"><label>City<input required {...b('city')} /></label><label>Pickup pincode<input required inputMode="numeric" maxLength={6} {...b('pincode')} /></label></div>
      {err && <div className="msg err">{err}</div>}
      <button className="btn" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</button>
    </form></div>);
}

function Dashboard({ vendor }: { vendor: any }) {
  const [tab, setTab] = useState<'orders' | 'products' | 'add'>('orders');
  return (<div className="wrap section stack">
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
      <h1 style={{ margin: 0 }}>{vendor.display_name}</h1><span>Seller ID {vendor.vendor_code} <StatusChip s={vendor.status} /></span></div>
    {vendor.status !== 'active' && <div className="msg info">{vendor.status === 'rejected' ? `Your application was not approved: ${vendor.status_reason}` : 'Your application is under review. Products you add now go live once both your shop and the product are approved.'}</div>}
    <div className="tabs" role="tablist">
      {([['orders', 'Orders'], ['products', 'Products & stock'], ['add', 'Add a product']] as const).map(([k, l]) =>
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
    </div>
    {tab === 'orders' && <SellerOrders vendorId={vendor.id} />}
    {tab === 'products' && <SellerProducts vendorId={vendor.id} />}
    {tab === 'add' && <AddProduct vendorId={vendor.id} onDone={() => setTab('products')} />}
  </div>);
}

function SellerOrders({ vendorId }: { vendorId: string }) {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState('');
  async function load() {
    const db = sb();
    const { data: subs } = await db.from('sub_orders').select('id,sub_order_number,status,total,created_at').eq('vendor_id', vendorId).neq('status', 'pending_payment').order('created_at', { ascending: false }).limit(100);
    const ids = (subs ?? []).map((s: any) => s.id);
    const { data: items } = ids.length ? await db.from('order_items').select('sub_order_id,product_snapshot,qty,cancelled_qty').in('sub_order_id', ids) : { data: [] };
    setRows((subs ?? []).map((s: any) => ({ ...s, items: (items ?? []).filter((i: any) => i.sub_order_id === s.id) })));
  }
  useEffect(() => { load(); }, []);
  async function act(id: string, action: string) {
    setErr(''); let carrier = null, awb = null;
    if (action === 'ship') { carrier = prompt('Courier name (for example Delhivery)'); if (!carrier) return; awb = prompt('AWB / tracking number'); if (!awb) return; }
    const { error } = await sb().rpc('vendor_update_sub_order', { p_sub_order: id, p_action: action, p_carrier: carrier, p_awb: awb });
    if (error) setErr(friendly(error)); load();
  }
  if (!rows) return <p>Loading orders…</p>;
  if (!rows.length) return <div className="panel">No orders yet. They appear here once a shopper’s payment is confirmed.</div>;
  const next: Record<string, [string, string]> = { confirmed: ['pack', 'Mark packed'], packed: ['ready', 'Mark ready to ship'], ready_to_ship: ['ship', 'Hand over to courier'] };
  return (<div className="stack">{err && <div className="msg err">{err}</div>}
    <div className="panel tablewrap"><table><thead><tr><th>Package</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.sub_order_number}</strong><div className="small muted">{new Date(r.created_at).toLocaleString('en-IN')}</div></td>
        <td>{r.items.map((i: any, k: number) => <div key={k}>{i.product_snapshot?.title} ({i.product_snapshot?.sku}) × {i.qty - i.cancelled_qty}</div>)}</td>
        <td>{inr(r.total)}</td><td><StatusChip s={r.status} /></td>
        <td>{next[r.status] && <button className="btn sm" onClick={() => act(r.id, next[r.status][0])}>{next[r.status][1]}</button>}</td></tr>)}</tbody></table></div></div>);
}

function SellerProducts({ vendorId }: { vendorId: string }) {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState('');
  async function load() {
    const db = sb();
    const { data: prods } = await db.from('products').select('id,title,status,rejection_reason,created_at').eq('vendor_id', vendorId).order('created_at', { ascending: false });
    const ids = (prods ?? []).map((p: any) => p.id);
    const { data: vars } = ids.length ? await db.from('product_variants').select('id,product_id,sku,attributes,selling_price,mrp').in('product_id', ids) : { data: [] };
    const vids = (vars ?? []).map((v: any) => v.id);
    const { data: stock } = vids.length ? await db.from('stock_balances').select('variant_id,on_hand,reserved,available').in('variant_id', vids) : { data: [] };
    setRows((prods ?? []).map((p: any) => ({ ...p, vars: (vars ?? []).filter((v: any) => v.product_id === p.id).map((v: any) => ({ ...v, st: (stock ?? []).find((s: any) => s.variant_id === v.id) })) })));
  }
  useEffect(() => { load(); }, []);
  async function adjust(variant: string) {
    const d = prompt('Change stock by how many units? Use a minus sign to reduce, for example -2'); if (!d || isNaN(Number(d))) return;
    const reason = prompt('Reason for the change (for example "new stock received")'); if (!reason) return;
    const { error } = await sb().rpc('vendor_adjust_stock', { p_variant: variant, p_delta: Math.trunc(Number(d)), p_reason: reason, p_request_id: crypto.randomUUID() });
    if (error) setErr(/stock_no_oversell|check constraint/.test(error.message) ? 'You can’t reduce below units already reserved for orders.' : friendly(error)); load();
  }
  if (!rows) return <p>Loading products…</p>;
  if (!rows.length) return <div className="panel">No products yet. Use “Add a product” to list your first one.</div>;
  return (<div className="stack">{err && <div className="msg err">{err}</div>}
    {rows.map((p) => <div key={p.id} className="panel stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{p.title}</strong><StatusChip s={p.status} /></div>
      {p.status === 'rejected' && <div className="msg err small">Not approved: {p.rejection_reason}</div>}
      <div className="tablewrap"><table><thead><tr><th>SKU</th><th>Option</th><th>Price</th><th>On hand</th><th>Reserved</th><th>Available</th><th></th></tr></thead>
        <tbody>{p.vars.map((v: any) => <tr key={v.id}><td>{v.sku}</td><td>{Object.values(v.attributes || {}).join(' / ') || '—'}</td><td>{inr(v.selling_price)} <span className="mrp">{inr(v.mrp)}</span></td>
          <td>{v.st?.on_hand ?? 0}</td><td>{v.st?.reserved ?? 0}</td><td><strong>{v.st?.available ?? 0}</strong></td>
          <td><button className="btn ghost sm" onClick={() => adjust(v.id)}>Adjust stock</button></td></tr>)}</tbody></table></div>
    </div>)}</div>);
}

function AddProduct({ vendorId, onDone }: { vendorId: string; onDone: () => void }) {
  const [cats, setCats] = useState<any[]>([]);
  const [f, setF] = useState({ title: '', category: '', description: '', gst: '5', hsn: '', images: '' });
  const [vars, setVars] = useState([{ sku: '', option: '', mrp: '', price: '', stock: '' }]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { sb().from('categories').select('id,name').eq('active', true).order('name').then(({ data }: any) => setCats(data ?? [])); }, []);
  const b = (k: keyof typeof f) => ({ value: f[k], onChange: (e: any) => setF({ ...f, [k]: e.target.value }) });
  const setV = (i: number, k: string, val: string) => setVars(vars.map((v, j) => j === i ? { ...v, [k]: val } : v));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    for (const v of vars) {
      if (!/^[A-Za-z0-9._-]{2,64}$/.test(v.sku)) { setErr('Each SKU needs 2–64 letters, numbers, dots, dashes or underscores.'); return; }
      if (!(Number(v.price) > 0) || Number(v.price) > Number(v.mrp)) { setErr('Selling price must be above zero and not more than MRP.'); return; }
    }
    setBusy(true);
    const { error } = await sb().rpc('vendor_create_product', {
      p_vendor: vendorId, p_category: f.category, p_title: f.title, p_description: f.description, p_gst_rate: Number(f.gst), p_hsn: f.hsn,
      p_image_urls: f.images.split(/\s+/).filter(Boolean),
      p_variants: vars.map((v) => ({ sku: v.sku, attributes: v.option ? { option: v.option } : {}, mrp: Number(v.mrp), price: Number(v.price), stock: Number(v.stock || 0) })) });
    setBusy(false); if (error) { setErr(friendly(error)); return; } onDone();
  }
  if (!cats.length) return <div className="panel">No categories exist yet. An admin needs to create categories before products can be listed.</div>;
  return (<form className="form panel" style={{ maxWidth: 'none' }} onSubmit={submit}>
    <label>Product title<input required minLength={3} maxLength={250} {...b('title')} /></label>
    <div className="row2"><label>Category<select required {...b('category')}><option value="">Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>GST rate<select {...b('gst')}>{['0', '3', '5', '12', '18', '28'].map((g) => <option key={g} value={g}>{g}%</option>)}</select></label></div>
    <label>Description<textarea rows={5} {...b('description')} /></label>
    <div className="row2"><label>HSN code<input maxLength={8} {...b('hsn')} /></label>
      <label>Image links (https, one per line)<textarea rows={2} placeholder="https://…" {...b('images')} /></label></div>
    <fieldset className="stack" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
      <legend>Options and stock</legend>
      {vars.map((v, i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
        <label>SKU<input required value={v.sku} onChange={(e) => setV(i, 'sku', e.target.value)} /></label>
        <label>Option (size/colour)<input value={v.option} onChange={(e) => setV(i, 'option', e.target.value)} /></label>
        <label>MRP ₹<input required inputMode="decimal" value={v.mrp} onChange={(e) => setV(i, 'mrp', e.target.value)} /></label>
        <label>Selling price ₹<input required inputMode="decimal" value={v.price} onChange={(e) => setV(i, 'price', e.target.value)} /></label>
        <label>Stock<input inputMode="numeric" value={v.stock} onChange={(e) => setV(i, 'stock', e.target.value)} /></label>
      </div>)}
      <button type="button" className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setVars([...vars, { sku: '', option: '', mrp: '', price: '', stock: '' }])}>Add another option</button>
    </fieldset>
    {err && <div className="msg err">{err}</div>}
    <button className="btn" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</button>
  </form>);
}
