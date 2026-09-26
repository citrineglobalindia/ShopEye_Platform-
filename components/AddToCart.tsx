'use client';
// SRS: CUST-FR-041 CUST-FR-042 CUST-FR-043 (variant required, buy now, qty capped by stock and order limit)
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { friendly } from '@/lib/errors';

type V = { variant_id: string; sku: string; attributes: Record<string, string>; mrp: number; selling_price: number; discount_pct: number; available: number };
const label = (v: V) => Object.values(v.attributes || {}).join(' / ') || v.sku;

export async function addToCart(variantId: string, qty: number, price: number) {
  const db = sb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return 'login';
  let { data: cart } = await db.from('carts').select('id').eq('customer_id', user.id).eq('status', 'active').maybeSingle();
  if (!cart) { const r = await db.from('carts').insert({ customer_id: user.id }).select('id').single(); if (r.error) throw r.error; cart = r.data; }
  const { data: existing } = await db.from('cart_items').select('id,qty').eq('cart_id', cart.id).eq('variant_id', variantId).eq('saved_for_later', false).maybeSingle();
  const r = existing
    ? await db.from('cart_items').update({ qty: existing.qty + qty }).eq('id', existing.id)
    : await db.from('cart_items').insert({ cart_id: cart.id, variant_id: variantId, qty, price_at_add: price });
  if (r.error) throw r.error;
  return 'ok';
}

export default function AddToCart({ variants }: { variants: V[] }) {
  const router = useRouter();
  const first = variants.find((v) => v.available > 0) ?? variants[0];
  const [sel, setSel] = useState<V>(first);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const out = sel.available <= 0;

  async function go(buyNow: boolean) {
    setBusy(true); setMsg(null);
    try {
      const r = await addToCart(sel.variant_id, qty, sel.selling_price);
      if (r === 'login') { router.push(`/login?next=${encodeURIComponent(location.pathname)}`); return; }
      if (buyNow) router.push('/checkout'); else setMsg({ t: 'ok', m: 'Added to your cart.' });
    } catch (e) { setMsg({ t: 'err', m: friendly(e) }); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <div><span className="price" style={{ fontSize: '1.6rem' }}>{inr(sel.selling_price)}</span>
        {sel.mrp > sel.selling_price && <><span className="mrp">MRP {inr(sel.mrp)}</span><span className="off">{sel.discount_pct}% off</span></>}</div>
      {variants.length > 1 && (
        <div role="group" aria-label="Choose an option" className="variants">
          {variants.map((v) => (
            <button key={v.variant_id} aria-pressed={v.variant_id === sel.variant_id} disabled={v.available <= 0}
              onClick={() => { setSel(v); setQty(1); }}>{label(v)}</button>))}
        </div>)}
      <p className="small" style={{ margin: 0 }}>{out ? <span className="chip bad">Out of stock</span> : sel.available <= 3 ? <span className="chip warn">Only {sel.available} left</span> : <span className="chip ok">In stock</span>}</p>
      {!out && (<>
        <label style={{ maxWidth: 120 }}>Quantity
          <select value={qty} onChange={(e) => setQty(Number(e.target.value))}>
            {Array.from({ length: Math.min(sel.available, 10) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
          </select></label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy} onClick={() => go(true)}>Buy now</button>
          <button className="btn ghost" disabled={busy} onClick={() => go(false)}>Add to cart</button>
        </div></>)}
      {msg && <div className={`msg ${msg.t}`} role="status">{msg.m} {msg.t === 'ok' && <a href="/cart">View cart</a>}</div>}
    </div>
  );
}
