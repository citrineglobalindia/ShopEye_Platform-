'use client';
import { Fragment, useEffect, useState } from 'react';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { StatusChip } from '@/components/Status';
import { Dashboard } from './modules/Dashboard';
import { Customers } from './modules/Customers';
import { Staff } from './modules/Staff';
import { Audit } from './modules/Audit';
import { OrdersAdmin } from './modules/OrdersAdmin';
import { Returns, Refunds, Payments } from './modules/Money';
import { Sellers, Commission, Settlements } from './modules/Sellers';

// Super Admin portal shell: sidebar grouped by area, sections shown only when the signed-in admin may use them
const NAV: { group: string; items: [string, string, string[]][] }[] = [
  { group: 'Overview', items: [['dashboard', 'Dashboard', ['dashboard.view']]] },
  { group: 'Commerce', items: [['orders', 'Orders', ['order.view.all']], ['returns', 'Returns', ['return.manage']], ['refunds', 'Refunds', ['refund.approve', 'payment.view']], ['payments', 'Payments', ['payment.view']], ['tickets', 'Help requests', ['customer.view', 'order.view.all']]] },
  { group: 'People', items: [['customers', 'Customers', ['customer.view']], ['sellers', 'Sellers', ['vendor.view']], ['vendors', 'Seller applications', ['vendor.approve']]] },
  { group: 'Finance', items: [['commission', 'Commission', ['commission.manage']], ['settlements', 'Settlements & payouts', ['payout.prepare', 'payout.approve', 'payout.execute']]] },
  { group: 'Catalogue', items: [['products', 'Listings to review', ['catalog.product.moderate']], ['catalogue', 'All products', ['catalog.product.moderate']], ['categories', 'Categories', ['catalog.product.moderate']], ['reviews', 'Reviews', ['review.moderate']]] },
  { group: 'Marketing', items: [['giftcards', 'Gift cards', ['gift_card.manage']]] },
  { group: 'Insights', items: [['speed', 'Site speed', ['analytics.view']], ['build', 'Build status', ['dashboard.view']]] },
  { group: 'Administration', items: [['staff', 'Admin users & roles', ['admin.users.manage']], ['audit', 'Audit log', ['audit.view']]] },
];
export default function Admin() {
  const [acc, setAcc] = useState<{ roles: string[]; permissions: string[] } | null>(null);
  const [tab, setTabState] = useState('');
  useEffect(() => { sb().rpc('admin_my_access').then(({ data }: any) => setAcc(data ?? { roles: [], permissions: [] })); }, []);
  useEffect(() => { const t = new URLSearchParams(location.search).get('tab'); if (t) setTabState(t);
    const pop = () => setTabState(new URLSearchParams(location.search).get('tab') ?? ''); addEventListener('popstate', pop); return () => removeEventListener('popstate', pop); }, []);
  if (acc === null) return <div className="wrap section">Loading…</div>;
  const can = (perms: string[]) => acc.roles.includes('super_admin') || perms.some((p) => acc.permissions.includes(p));
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter(([, , perms]) => can(perms)) })).filter((g) => g.items.length);
  if (!acc.roles.length || !nav.length) return <div className="wrap section"><h1>Admin</h1><p>You don’t have admin access. Sign in with an admin account.</p></div>;
  const first = nav[0].items[0][0];
  const cur = nav.some((g) => g.items.some(([k]) => k === tab)) ? tab : first;
  const setTab = (k: string) => {
    if (k === 'reviews') { location.href = '/admin/reviews'; return; } if (k === 'build') { location.href = '/status'; return; }
    history.pushState(null, '', `/admin?tab=${k}`); setTabState(k); window.scrollTo(0, 0);
  };
  const label = nav.flatMap((g) => g.items).find(([k]) => k === cur)?.[1] ?? 'Admin';
  return (<div className="admin-shell">
    <nav className="admin-nav" aria-label="Admin sections">
      <div className="admin-brand"><strong>ShopEye Admin</strong><span className="small muted">{acc.roles.map((r) => r.replace(/_/g, ' ')).join(', ')}</span></div>
      {nav.map((g) => <div key={g.group} className="admin-grp"><span className="admin-gh">{g.group}</span>
        {g.items.map(([k, l]) => <button key={k} type="button" aria-current={k === cur ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>)}</div>)}
    </nav>
    <main className="admin-main stack" id="admin-main">
      <h1 style={{ margin: 0 }}>{label}</h1>
      {cur === 'dashboard' && <Dashboard go={setTab} />}{cur === 'customers' && <Customers canManage={can(['customer.manage'])} />}
      {cur === 'staff' && <Staff />}{cur === 'audit' && <Audit />}
      {cur === 'vendors' && <Vendors />}{cur === 'products' && <Moderation />}{cur === 'tickets' && <Tickets />}{cur === 'giftcards' && <GiftCards />}
      {cur === 'catalogue' && <Products />}{cur === 'speed' && <Speed />}{cur === 'orders' && <OrdersAdmin canManage={can(['order.manage'])} />}{cur === 'returns' && <Returns />}{cur === 'refunds' && <Refunds canApprove={can(['refund.approve'])} />}{cur === 'payments' && <Payments />}{cur === 'sellers' && <Sellers canManage={can(['vendor.manage'])} canKyc={can(['vendor.kyc.review'])} />}{cur === 'commission' && <Commission />}{cur === 'settlements' && <Settlements />}{cur === 'categories' && <Categories />}
    </main>
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


// SRS: CUST-FR-153 (real-visitor Core Web Vitals at the 75th percentile, per page type and device, against Google's thresholds)
function Speed() {
  const [days, setDays] = useState(28); const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { sb().rpc('admin_vitals', { p_days: days }).then(({ data, error }: any) => { if (error) setErr(friendly(error)); else setD(data); }); }, [days]);
  if (err) return <div className="msg err" role="alert">{err}</div>;
  if (!d) return <p className="muted">Loading…</p>;
  const M = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];
  const NAMES: Record<string, string> = { LCP: 'Largest content shown', INP: 'Response to taps/clicks', CLS: 'Layout stability', FCP: 'First content shown', TTFB: 'Server response' };
  const cell = (r: any) => { if (!r) return <td className="muted">—</td>; const [g, p] = d.thresholds[r.metric]; const v = Number(r.p75);
    const st = v <= g ? ['ok-t', 'Good'] : v <= p ? ['warn-t', 'Needs work'] : ['danger-t', 'Poor'];
    return <td><strong className={st[0]}>{r.metric === 'CLS' ? v.toFixed(3) : `${Math.round(v).toLocaleString('en-IN')} ms`}</strong><span className="small muted"> · {st[1]} · {r.samples}</span></td>; };
  const find = (page: string, device: string, metric: string) => d.rows.find((r: any) => r.page === page && r.device === device && r.metric === metric);
  const pages = [...new Set(d.rows.map((r: any) => r.page).filter((x: string) => x !== 'all'))] as string[];
  const total = find('all', 'all', 'LCP')?.samples ?? 0;
  return (<div className="stack">
    <div className="panel stack">
      <div className="addr"><strong>Real-visitor page speed (75th percentile)</strong>
        <label className="small">Period <select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>7 days</option><option value={28}>28 days</option><option value={90}>90 days</option></select></label></div>
      <p className="small muted" style={{ margin: 0 }}>Measured in visitors’ browsers on every page view: page type and device only, no personal data. “Good” uses Google’s Core Web Vitals thresholds (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1). {total ? `${total} page views measured.` : 'No visits measured yet in this period.'}</p>
    </div>
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Page speed by device"><table>
      <thead><tr><th>Metric</th><th>All</th><th>Phones</th><th>Desktop</th></tr></thead>
      <tbody>{M.map((m) => <tr key={m}><th scope="row">{m}<div className="small muted">{NAMES[m]}</div></th>{cell(find('all', 'all', m))}{cell(find('all', 'mobile', m))}{cell(find('all', 'desktop', m))}</tr>)}</tbody></table></div>
    {pages.length > 0 && <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Page speed by page type"><table>
      <thead><tr><th>Page type</th>{['LCP', 'INP', 'CLS', 'TTFB'].map((m) => <th key={m}>{m}</th>)}</tr></thead>
      <tbody>{pages.map((p) => <tr key={p}><th scope="row" style={{ textTransform: 'capitalize' }}>{p}</th>{['LCP', 'INP', 'CLS', 'TTFB'].map((m) => <Fragment key={m}>{cell(find(p, 'all', m))}</Fragment>)}</tr>)}</tbody></table></div>}
  </div>);
}

// Remove products safely: never a hard delete. Archived products leave the storefront and every cart, while orders,
// invoices and stock history keep pointing at them, so nothing breaks later.
function Products() {
  const [rows, setRows] = useState<any[]>([]); const [q, setQ] = useState(''); const [onlyPreview, setOnlyPreview] = useState(false);
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  async function load() {
    let r = sb().from('products').select('id,title,status,is_demo,vendors(display_name),categories(name)').neq('status', 'archived').order('created_at', { ascending: false }).limit(300);
    if (q.trim()) r = r.ilike('title', `%${q.trim()}%`);
    if (onlyPreview) r = r.eq('is_demo', true);
    const { data } = await r; setRows(data ?? []);
  }
  useEffect(() => { load(); }, [onlyPreview]);
  async function remove(id: string, title: string) {
    if (!confirm(`Remove “${title}”? It will disappear from the store and from shoppers’ carts. Orders and invoices that include it are kept.`)) return;
    setBusy(id); setErr(''); const { error } = await sb().rpc('admin_remove_product', { p_product: id }); setBusy('');
    if (error) setErr(friendly(error)); else { setMsg(`Removed “${title}”.`); load(); }
  }
  async function removeAllPreview() {
    if (!confirm('Remove every preview product, preview brand and the preview banner? Real sellers’ products are not touched.')) return;
    setBusy('all'); setErr(''); const { data, error } = await sb().rpc('admin_remove_preview_catalogue'); setBusy('');
    if (error) setErr(friendly(error)); else { setMsg(`Removed ${data?.archived_products ?? 0} preview products.`); load(); }
  }
  const previews = rows.filter((r) => r.is_demo).length;
  return (<div className="stack">
    <div className="panel stack">
      <div className="addr"><form className="addr" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); load(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" style={{ flex: 1 }} />
        <button className="btn sm">Search</button></form>
        <label className="radio small"><input type="checkbox" checked={onlyPreview} onChange={(e) => setOnlyPreview(e.target.checked)} style={{ width: 'auto' }} /> Preview only</label></div>
      <div className="addr"><span className="small muted">Showing {rows.length}{previews ? ` · ${previews} preview` : ''}. Removing archives the product: it leaves the store and carts; order history stays intact.</span>
        <button className="btn ghost sm" disabled={busy === 'all'} onClick={removeAllPreview}>{busy === 'all' ? 'Removing…' : 'Remove all preview products'}</button></div>
      {msg && <div className="msg ok" role="status">{msg}</div>}{err && <div className="msg err" role="alert">{err}</div>}
    </div>
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Products"><table><thead><tr><th>Product</th><th>Seller</th><th>Category</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td><a href={`/p/${r.id}`} target="_blank">{r.title}</a>{r.is_demo && <span className="small muted"> · Preview</span>}</td><td className="small">{r.vendors?.display_name}</td><td className="small">{r.categories?.name}</td>
        <td><StatusChip s={r.status} /></td><td><button className="linklike danger-t" disabled={busy === r.id} onClick={() => remove(r.id, r.title)}>{busy === r.id ? 'Removing…' : 'Remove'}</button></td></tr>)}</tbody></table></div>
  </div>);
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
