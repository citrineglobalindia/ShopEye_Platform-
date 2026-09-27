'use client';
// SRS: CUST-FR-167 (the table scrolls sideways inside its own labelled, keyboard-focusable panel on phones; the page itself never scrolls sideways)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { compareIds, clearCompare } from '@/components/Alerts';
import { Stars } from '@/components/Reviews';
import { Crumbs } from '@/components/Crumbs';
import { Pic } from '@/components/Pic';

export default function Compare() {
  const [rows, setRows] = useState<any[] | null>(null);
  async function load() {
    const ids = compareIds(); if (!ids.length) { setRows([]); return; }
    const db = sb();
    const [{ data: p }, { data: v }, { data: m }, { data: st }] = await Promise.all([
      db.from('products').select('id,title,specifications,return_window_days,is_returnable,rating_avg,rating_count').in('id', ids).eq('status', 'active'),
      db.from('catalog_variants').select('product_id,selling_price,mrp,discount_pct,vendor_name').in('product_id', ids),
      db.from('product_media').select('product_id,url,sort_order').in('product_id', ids).order('sort_order'),
      db.rpc('product_stock', { p_ids: ids })]);
    setRows(ids.map((id) => { const pr = (p ?? []).find((x: any) => x.id === id); if (!pr) return null;
      const vs = (v ?? []).filter((x: any) => x.product_id === id).sort((a: any, b: any) => a.selling_price - b.selling_price);
      return { ...pr, v: vs[0], image: (m ?? []).find((x: any) => x.product_id === id)?.url, inStock: (st ?? []).find((x: any) => x.product_id === id)?.in_stock }; }).filter(Boolean));
  }
  useEffect(() => { load(); }, []);
  if (rows === null) return <div className="wrap section">Loading comparison…</div>;
  const specKeys = [...new Set(rows.flatMap((r) => Object.keys(r.specifications ?? {})))];
  const line = (label: string, f: (r: any) => React.ReactNode) => <tr><th scope="row">{label}</th>{rows.map((r) => <td key={r.id}>{f(r)}</td>)}</tr>;
  return (
    <div className="wrap section stack">
      <Crumbs items={[['Home', '/'], ['Compare products']]} />
      <h1 style={{ margin: 0 }}>Compare products</h1>
      {!rows.length ? <div className="panel empty">Nothing to compare yet. Tick “Compare” on up to 4 product pages.</div> : (
        <div className="tablewrap panel" tabIndex={0} role="region" aria-label="Product comparison (scrolls sideways on small screens)"><table className="cmp">
          <thead><tr><th scope="col"><span className="sr-only">Detail</span></th>{rows.map((r) => (
            <th key={r.id} scope="col"><Link href={`/p/${r.id}`} className="cmp-head">{r.image && <Pic src={r.image} alt="" w={320} h={400} sizes="160px" />}<span>{r.title}</span></Link>
              <button className="linklike small" onClick={() => { clearCompare(r.id); load(); }}>Remove</button></th>))}</tr></thead>
          <tbody>
            {line('Price', (r) => r.v ? <strong>{inr(r.v.selling_price)}</strong> : '—')}
            {line('MRP', (r) => r.v && r.v.mrp > r.v.selling_price ? <><s>{inr(r.v.mrp)}</s> ({r.v.discount_pct}% off)</> : '—')}
            {line('Availability', (r) => r.inStock ? <span className="chip ok">In stock</span> : <span className="chip">Out of stock</span>)}
            {line('Rating', (r) => r.rating_count ? <><Stars value={Number(r.rating_avg)} /> <span className="small">({r.rating_count})</span></> : <span className="small muted">No reviews yet</span>)}
            {line('Seller', (r) => r.v?.vendor_name ?? '—')}
            {line('Returns', (r) => r.is_returnable ? `${r.return_window_days ?? 7} days` : 'Not returnable')}
            {specKeys.map((k) => <tr key={k}><th scope="row">{k}</th>{rows.map((r) => <td key={r.id}>{String(r.specifications?.[k] ?? '—')}</td>)}</tr>)}
          </tbody></table></div>)}
    </div>);
}
