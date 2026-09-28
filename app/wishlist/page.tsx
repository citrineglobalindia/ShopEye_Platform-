'use client';
// SRS: CUST-FR-054 (moving a wishlist item to cart re-checks current stock, variant and price)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { toggleWishlist, addToCart } from '@/lib/shop-client';
import { Crumbs } from '@/components/Crumbs';
import { Pic } from '@/components/Pic';
import { MobileTitle } from '@/components/MobileTitle';

export default function Wishlist() {
  const router = useRouter(); const [items, setItems] = useState<any[] | null>(null); const [signedIn, setSignedIn] = useState(true); const [msg, setMsg] = useState('');
  async function load() {
    const db = sb(); const { data: { user } } = await db.auth.getUser();
    if (!user) { setSignedIn(false); setItems([]); return; }
    const { data: w } = await db.from('wishlist_items').select('product_id,added_at').order('added_at', { ascending: false });
    const ids = (w ?? []).map((x: any) => x.product_id); if (!ids.length) { setItems([]); return; }
    const [{ data: cv }, { data: m }, { data: st }] = await Promise.all([
      db.from('catalog_variants').select('variant_id,product_id,title,selling_price,mrp,vendor_name').in('product_id', ids),
      db.from('product_media').select('product_id,url,sort_order').in('product_id', ids).order('sort_order'),
      db.rpc('product_stock', { p_ids: ids })]);
    const img = new Map<string, string>(); (m ?? []).forEach((x: any) => { if (!img.has(x.product_id)) img.set(x.product_id, x.url); });
    const stock = new Map((st ?? []).map((x: any) => [x.product_id, x.in_stock]));
    setItems(ids.map((id: string) => { const vs = (cv ?? []).filter((v: any) => v.product_id === id);
      return { id, vs, v: vs.sort((a: any, b: any) => a.selling_price - b.selling_price)[0], image: img.get(id), inStock: stock.get(id) ?? false }; }));
  }
  useEffect(() => { load(); }, []);
  async function move(it: any) {
    setMsg('');
    if (it.vs.length > 1) { router.push(`/p/${it.id}`); return; }        // needs a size/colour choice first
    const { data: av } = await sb().rpc('variant_availability', { p_product: it.id });
    const a = (av ?? []).find((x: any) => x.variant_id === it.v.variant_id);
    if (!a || a.available <= 0) { setMsg(`${it.v.title} is out of stock right now.`); return; }
    await addToCart(it.v.variant_id, 1, Number(it.v.selling_price)); await toggleWishlist(it.id, false);
    setMsg(`${it.v.title} moved to your cart at ${inr(it.v.selling_price)}.`); load();
  }
  if (items === null) return <div className="wrap section">Loading your wishlist…</div>;
  return (
    <div className="wrap section stack">
      <Crumbs items={[['Home', '/'], ['Wishlist']]} />
      <MobileTitle title="Wishlist" />
      <h1 style={{ margin: 0 }}>Wishlist</h1>
      {!signedIn ? <div className="panel empty"><p>Sign in to save products you like and find them on any device.</p><Link className="btn" href="/login?next=/wishlist">Sign in</Link></div>
        : !items.length ? <div className="panel empty"><h3>Nothing saved yet</h3><p className="muted">Tap the heart on any product to save it here.</p><Link className="btn" href="/">Start shopping</Link></div>
        : (<>
          {msg && <div className="msg info" role="status">{msg} <Link href="/cart">View cart</Link></div>}
          <div className="grid">{items.map((it) => (
            <div key={it.id} className={`card${it.inStock ? '' : ' oos'}`}>
              <Link href={`/p/${it.id}`} className="card-link">
                <div className="ph">{it.image ? <Pic src={it.image} alt={it.v?.title ?? ''} /> : <span className="small">No photo</span>}{!it.inStock && <span className="oos-badge">Out of stock</span>}</div>
                <div className="b">{it.v ? <><span className="small muted">{it.v.vendor_name}</span><span className="card-t">{it.v.title}</span><span className="price">{inr(it.v.selling_price)}</span></> : <span className="muted">No longer available</span>}</div>
              </Link>
              <div className="card-foot">
                {it.v && it.inStock && <button className="btn sm" onClick={() => move(it)}>{it.vs.length > 1 ? 'Choose size' : 'Move to cart'}</button>}
                <button className="linklike danger-t" onClick={async () => { await toggleWishlist(it.id, false); load(); }}>Remove</button>
              </div>
            </div>))}</div></>)}
    </div>);
}
