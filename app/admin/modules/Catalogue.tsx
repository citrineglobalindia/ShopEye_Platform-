'use client';
// SRS: SA category management (tree of any depth: add, rename, move, reorder, show/hide, GST/HSN/returns defaults),
// brand management, stock visibility and adjustments with reasons
import { useEffect, useMemo, useState } from 'react';
import { sb } from '@/lib/sb-browser';
import { friendly } from '@/lib/errors';
import { StatusChip } from '@/components/Status';

type Cat = { id: string; parent_id: string | null; name: string; slug: string; level: number; sort_order: number; active: boolean; default_gst_rate: number; default_hsn: string | null; return_window_days: number; image_url: string | null; products: number };
const blank = { id: '', parent: '', name: '', gst: '5', ret: '7', hsn: '', img: '', active: true };

export function CategoryTree() {
  const [cats, setCats] = useState<Cat[]>([]); const [f, setF] = useState<any>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [shut, setShut] = useState<Set<string>>(new Set());
  const load = () => sb().rpc('admin_category_tree').then(({ data, error }: any) => { if (error) setErr(friendly(error)); else setCats(data ?? []); });
  useEffect(() => { load(); }, []);
  const kids = useMemo(() => { const m = new Map<string, Cat[]>(); cats.forEach((c) => { const k = c.parent_id ?? 'root'; m.set(k, [...(m.get(k) ?? []), c]); }); m.forEach((v) => v.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))); return m; }, [cats]);
  const total = (id: string): number => (cats.find((c) => c.id === id)?.products ?? 0) + (kids.get(id) ?? []).reduce((n, c) => n + total(c.id), 0);
  const under = (id: string): Set<string> => { const s = new Set([id]); (kids.get(id) ?? []).forEach((c) => under(c.id).forEach((x) => s.add(x))); return s; };
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    const { error } = await sb().rpc('admin_save_category', { p_id: f.id || null, p_parent: f.parent || null, p_name: f.name, p_gst: Number(f.gst), p_return_days: Number(f.ret), p_hsn: f.hsn || null, p_image_url: f.img || null, p_active: f.active });
    if (error) setErr(friendly(error)); else { setMsg(f.id ? `Saved “${f.name}”.` : `Added “${f.name}”.`); setF(null); load(); }
  }
  async function move(c: Cat, d: string) { const { error } = await sb().rpc('admin_move_category', { p_id: c.id, p_direction: d }); if (error) setErr(friendly(error)); else load(); }
  const edit = (c: Cat) => setF({ id: c.id, parent: c.parent_id ?? '', name: c.name, gst: String(c.default_gst_rate), ret: String(c.return_window_days), hsn: c.default_hsn ?? '', img: c.image_url ?? '', active: c.active });
  const row = (c: Cat): React.ReactNode => {
    const ch = kids.get(c.id) ?? []; const closed = shut.has(c.id);
    return (<li key={c.id}>
      <div className={`ct-row${c.active ? '' : ' off'}`}>
        {ch.length ? <button type="button" className="ct-tog" aria-expanded={!closed} aria-label={`${closed ? 'Show' : 'Hide'} ${c.name} sub-categories`} onClick={() => { const s = new Set(shut); closed ? s.delete(c.id) : s.add(c.id); setShut(s); }}>{closed ? '▸' : '▾'}</button> : <span className="ct-tog" />}
        <span className="ct-name"><strong>{c.name}</strong> <span className="small muted">/{c.slug} · {total(c.id)} products · GST {c.default_gst_rate}% · {c.return_window_days}-day returns{c.active ? '' : ' · hidden'}</span></span>
        <span className="ct-act"><button type="button" className="linklike" aria-label={`Move ${c.name} up`} onClick={() => move(c, 'up')}>↑</button><button type="button" className="linklike" aria-label={`Move ${c.name} down`} onClick={() => move(c, 'down')}>↓</button>
          <button type="button" className="linklike" onClick={() => setF({ ...blank, parent: c.id, gst: String(c.default_gst_rate), ret: String(c.return_window_days) })}>+ Sub-category</button>
          <button type="button" className="linklike" onClick={() => edit(c)}>Edit</button>
          <a className="linklike" href={`/c/${c.slug}`} target="_blank">View</a></span>
      </div>
      {ch.length > 0 && !closed && <ul>{ch.map(row)}</ul>}
    </li>);
  };
  const forbidden = f?.id ? under(f.id) : new Set<string>();
  return (<div className="stack">
    <div className="addr"><p className="small muted" style={{ margin: 0 }}>Any depth: Fashion › Women › Western Wear › Dresses › Party dresses… Hidden categories (and everything inside them) leave the store; their products stay safe.</p>
      <button className="btn sm" onClick={() => setF({ ...blank })}>+ New department</button></div>
    {err && <div className="msg err" role="alert">{err}</div>}{msg && <div className="msg ok" role="status">{msg}</div>}
    {f && <form className="panel stack" onSubmit={save}>
      <h2 style={{ margin: 0 }}>{f.id ? `Edit “${f.name}”` : f.parent ? `New sub-category in “${cats.find((c) => c.id === f.parent)?.name}”` : 'New department'}</h2>
      <div className="row2"><label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={60} /></label>
        <label>Inside<select value={f.parent} onChange={(e) => setF({ ...f, parent: e.target.value })}><option value="">— Top level (department) —</option>
          {cats.filter((c) => !forbidden.has(c.id)).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{'— '.repeat(c.level - 1)}{c.name}</option>)}</select></label></div>
      <div className="row2"><label>Default GST<select value={f.gst} onChange={(e) => setF({ ...f, gst: e.target.value })}>{['0', '0.25', '3', '5', '12', '18', '28'].map((g) => <option key={g} value={g}>{g}%</option>)}</select></label>
        <label>Return window (days)<input type="number" min={0} max={60} value={f.ret} onChange={(e) => setF({ ...f, ret: e.target.value })} /></label></div>
      <div className="row2"><label>Default HSN (optional)<input value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value.replace(/\D/g, '').slice(0, 8) })} inputMode="numeric" /></label>
        <label>Tile image (optional, https://)<input value={f.img} onChange={(e) => setF({ ...f, img: e.target.value })} placeholder="Leave empty to use a product photo" /></label></div>
      <label className="radio"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} style={{ width: 'auto' }} /> Show in the store</label>
      <div className="cta-row"><button className="btn dark sm">Save</button><button type="button" className="btn ghost sm" onClick={() => setF(null)}>Cancel</button></div>
    </form>}
    <div className="panel"><ul className="ctree">{(kids.get('root') ?? []).map(row)}</ul></div>
  </div>);
}

export function Brands() {
  const [rows, setRows] = useState<any[]>([]); const [name, setName] = useState(''); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = () => sb().rpc('admin_list_brands').then(({ data, error }: any) => { if (error) setErr(friendly(error)); else setRows(data ?? []); });
  useEffect(() => { load(); }, []);
  async function save(id: string | null, n: string, status: string, auth: boolean) {
    setErr(''); setMsg(''); const { error } = await sb().rpc('admin_save_brand', { p_id: id, p_name: n, p_status: status, p_requires_authorisation: auth });
    if (error) setErr(friendly(error)); else { setMsg('Saved.'); setName(''); load(); }
  }
  return (<div className="stack">
    <form className="panel addr" onSubmit={(e) => { e.preventDefault(); save(null, name, 'active', false); }}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New brand name" aria-label="New brand name" style={{ flex: 1 }} required minLength={2} />
      <button className="btn sm">Add brand</button></form>
    {err && <div className="msg err" role="alert">{err}</div>}{msg && <div className="msg ok" role="status">{msg}</div>}
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Brands"><table>
      <thead><tr><th>Brand</th><th>Live products</th><th>Needs seller authorisation</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((b) => <tr key={b.id}><td><strong>{b.name}</strong>{b.is_demo && <span className="small muted"> · preview</span>}<div className="small muted">/search?brand={b.slug}</div></td><td>{b.products}</td>
        <td><input type="checkbox" checked={b.requires_authorisation} aria-label={`${b.name} needs seller authorisation`} onChange={(e) => save(b.id, b.name, b.status, e.target.checked)} style={{ width: 'auto' }} /></td>
        <td><StatusChip s={b.status} /></td>
        <td><span className="cta-row"><button className="linklike" onClick={() => { const n = prompt('Rename brand:', b.name); if (n) save(b.id, n, b.status, b.requires_authorisation); }}>Rename</button>
          {b.status !== 'blocked' ? <button className="linklike danger-t" onClick={() => confirm(`Block ${b.name}? Sellers can’t list new products under it.`) && save(b.id, b.name, 'blocked', b.requires_authorisation)}>Block</button>
            : <button className="linklike" onClick={() => save(b.id, b.name, 'active', b.requires_authorisation)}>Unblock</button>}</span></td></tr>)}</tbody></table></div>
  </div>);
}

export function Stock() {
  const [rows, setRows] = useState<any[]>([]); const [q, setQ] = useState(''); const [filter, setFilter] = useState('all'); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = () => sb().rpc('admin_stock', { p_q: q || null, p_filter: filter, p_limit: 300 }).then(({ data, error }: any) => { if (error) setErr(friendly(error)); else { setErr(''); setRows(data ?? []); } });
  useEffect(() => { load(); }, [filter]);
  async function adjust(r: any) {
    const d = Number(prompt(`Change stock of ${r.title} (${r.sku}) by how many? Use a minus sign to reduce. Available now: ${r.available}`)); if (!d) return;
    const why = prompt('Reason (e.g. stock count correction, damaged units):'); if (!why) return;
    const { data, error } = await sb().rpc('admin_adjust_stock', { p_variant: r.variant_id, p_delta: d, p_reason: why });
    if (error) setErr(friendly(error)); else { setMsg(`${r.sku}: available is now ${data}.`); load(); }
  }
  return (<div className="stack">
    <form className="panel filters-row" onSubmit={(e) => { e.preventDefault(); load(); }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product, SKU or seller" aria-label="Search stock" />
      <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show"><option value="all">All</option><option value="low">Low (1–5 left)</option><option value="out">Out of stock</option></select>
      <button className="btn sm">Search</button></form>
    {err && <div className="msg err" role="alert">{err}</div>}{msg && <div className="msg ok" role="status">{msg}</div>}
    <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Stock"><table>
      <thead><tr><th>Product</th><th>SKU</th><th>Seller</th><th>On hand</th><th>Reserved</th><th>Available</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.variant_id}><td><a href={`/p/${r.product_id}`} target="_blank">{r.title}</a>{r.is_demo && <span className="small muted"> · preview</span>}<div className="small muted">{Object.values(r.attributes ?? {}).join(' / ')}</div></td>
        <td className="small">{r.sku}</td><td className="small">{r.vendor}</td><td>{r.on_hand}</td><td>{r.reserved}</td>
        <td className={r.available <= 0 ? 'danger-t' : r.available <= 5 ? 'warn-t' : ''}><strong>{r.available}</strong></td>
        <td><button className="linklike" onClick={() => adjust(r)}>Adjust…</button></td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="muted">Nothing here.</td></tr>}</tbody></table></div>
  </div>);
}
