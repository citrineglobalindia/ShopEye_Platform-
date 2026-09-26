'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';

export default function Cart() {
  const [items, setItems] = useState<any[] | null>(null); const [signedIn, setSignedIn] = useState(true);
  async function load() {
    const db = sb(); const { data: { user } } = await db.auth.getUser();
    if (!user) { setSignedIn(false); setItems([]); return; }
    const { data: cart } = await db.from('carts').select('id').eq('customer_id', user.id).eq('status', 'active').maybeSingle();
    if (!cart) { setItems([]); return; }
    const { data: ci } = await db.from('cart_items').select('id,qty,price_at_add,variant_id').eq('cart_id', cart.id).eq('saved_for_later', false).order('added_at');
    const ids = (ci ?? []).map((c: any) => c.variant_id);
    const { data: cv } = ids.length ? await db.from('catalog_variants').select('variant_id,product_id,title,attributes,selling_price,mrp,vendor_name').in('variant_id', ids) : { data: [] };
    const m = new Map((cv ?? []).map((v: any) => [v.variant_id, v]));
    setItems((ci ?? []).map((c: any) => ({ ...c, v: m.get(c.variant_id) })));
  }
  useEffect(() => { load(); }, []);
  async function setQty(id: string, qty: number) { await sb().from('cart_items').update({ qty }).eq('id', id); load(); }
  async function remove(id: string) { await sb().from('cart_items').delete().eq('id', id); load(); }

  if (items === null) return <div className="wrap section">Loading your cart…</div>;
  if (!signedIn) return <div className="wrap section"><h1>Your cart</h1><p>Sign in to see your cart.</p><Link className="btn" href="/login?next=/cart">Sign in</Link></div>;
  if (!items.length) return <div className="wrap section"><h1>Your cart is empty</h1><Link className="btn" href="/">Start shopping</Link></div>;
  const live = items.filter((i) => i.v);
  const sub = live.reduce((s, i) => s + Number(i.v.selling_price) * i.qty, 0);
  const groups = Object.entries(live.reduce((g: any, i) => ((g[i.v.vendor_name] ||= []).push(i), g), {}));
  return (
    <div className="wrap section split">
      <div className="stack">
        <h1>Your cart</h1>
        {items.some((i) => !i.v) && <div className="msg err">Some items are no longer available. Remove them to check out.</div>}
        {groups.map(([vendor, list]: any) => (
          <div key={vendor} className="panel stack">
            <h3 style={{ margin: 0 }}>Package from {vendor}</h3>
            {list.map((i: any) => (
              <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div><Link href={`/p/${i.v.product_id}`}><strong>{i.v.title}</strong></Link>
                  <div className="small muted">{Object.values(i.v.attributes || {}).join(' / ')}</div>
                  {Number(i.price_at_add) > 0 && Number(i.price_at_add) !== Number(i.v.selling_price) && <div className="small chip warn">Price changed from {inr(i.price_at_add)}</div>}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select aria-label="Quantity" value={i.qty} onChange={(e) => setQty(i.id, Number(e.target.value))} style={{ width: 70 }}>
                    {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => <option key={n}>{n}</option>)}</select>
                  <strong>{inr(Number(i.v.selling_price) * i.qty)}</strong>
                  <button className="btn danger sm" onClick={() => remove(i.id)}>Remove</button>
                </div>
              </div>))}
          </div>))}
        {items.filter((i) => !i.v).map((i) => <div key={i.id} className="panel" style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Unavailable item</span><button className="btn danger sm" onClick={() => remove(i.id)}>Remove</button></div>)}
      </div>
      <aside className="panel sum">
        <div><span>Items ({live.reduce((s, i) => s + i.qty, 0)})</span><span>{inr(sub)}</span></div>
        <div className="muted small"><span>Shipping, coupons and final total are confirmed at checkout.</span></div>
        <Link className="btn" href="/checkout" aria-disabled={items.some((i) => !i.v)}>Continue to checkout</Link>
      </aside>
    </div>
  );
}
