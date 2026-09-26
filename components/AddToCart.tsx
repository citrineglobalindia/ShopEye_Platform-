'use client';
// SRS: CUST-FR-041 CUST-FR-042 CUST-FR-043 (variant required, buy now, qty capped by stock and order limit)
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { addToCart } from '@/lib/shop-client';
import { AlertButton } from '@/components/Alerts';
import { useEffect } from 'react';

type V = { variant_id: string; sku: string; attributes: Record<string, string>; mrp: number; selling_price: number; discount_pct: number; available: number };
const label = (v: V) => Object.values(v.attributes || {}).join(' / ') || v.sku;

export default function AddToCart({ variants }: { variants: V[] }) {
  const router = useRouter();
  const first = variants.find((v) => v.available > 0) ?? variants[0];
  const [sel, setSel] = useState<V>(first);
  useEffect(() => { if (sel) window.dispatchEvent(new CustomEvent('shopeye:variant', { detail: sel.variant_id })); }, [sel?.variant_id]);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const out = sel.available <= 0;

  async function go(buyNow: boolean) {
    setBusy(true); setMsg(null);
    try {
      await addToCart(sel.variant_id, qty, sel.selling_price);
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
            <button key={v.variant_id} aria-pressed={v.variant_id === sel.variant_id} className={v.available <= 0 ? 'oos-v' : undefined}
              aria-label={v.available <= 0 ? `${label(v)}, sold out` : undefined} title={v.available <= 0 ? 'Sold out: select to get an email when it’s back' : undefined}
              onClick={() => { setSel(v); setQty(1); }}>{label(v)}</button>))}
        </div>)}
      <div className="cta-row">
        {out ? <AlertButton key={sel.variant_id + 's'} variantId={sel.variant_id} kind="back_in_stock" label="Email me when it’s back" onLabel="We’ll email you when it’s back ✓" />
             : <AlertButton key={sel.variant_id + 'p'} variantId={sel.variant_id} kind="price_drop" label="Watch price" onLabel="Watching price ✓" />}
      </div>
      {out && variants.every((v) => v.available <= 0) && <p className="small" style={{ margin: 0 }}>This product is sold out. <a href="#more">See similar products</a>.</p>}
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
