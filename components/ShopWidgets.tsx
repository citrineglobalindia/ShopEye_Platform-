'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { sb } from '@/lib/sb-browser';
import { guestCart, mergeGuestCart, wishlistIds, toggleWishlist, recentIds, trackView, clearRecent } from '@/lib/shop-client';
import { inr } from '@/lib/config';

// Header cart link: server count for signed-in users, browser cart for guests
export function CartLink({ serverCount, signedIn }: { serverCount: number; signedIn: boolean }) {
  const [n, setN] = useState(serverCount); const router = useRouter();
  useEffect(() => {
    const upd = () => { if (!signedIn) setN(guestCart().reduce((s, l) => s + l.qty, 0)); else router.refresh(); };
    if (!signedIn) upd();
    window.addEventListener('shopeye:cart', upd); return () => window.removeEventListener('shopeye:cart', upd);
  }, [signedIn]);
  useEffect(() => { if (signedIn) setN(serverCount); }, [serverCount, signedIn]);
  return (
    <Link href="/cart" className="cart-link" aria-label={`Cart, ${n} item${n === 1 ? '' : 's'}`}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>
      <span>Cart</span>{n > 0 && <b className="badge">{n > 99 ? '99+' : n}</b>}
    </Link>);
}
// Runs once after sign-in: merge the guest cart into the account cart
export function GuestCartMerge({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  useEffect(() => { if (signedIn && guestCart().length) mergeGuestCart().then((n) => n && router.refresh()); }, [signedIn]);
  return null;
}
export function WishHeart({ productId, big }: { productId: string; big?: boolean }) {
  const [on, setOn] = useState(false); const [busy, setBusy] = useState(false); const router = useRouter(); const path = usePathname();
  useEffect(() => { const load = () => wishlistIds().then((s) => setOn(s.has(productId))); load();
    window.addEventListener('shopeye:wishlist', load); return () => window.removeEventListener('shopeye:wishlist', load); }, [productId]);
  async function click(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation(); setBusy(true);
    try { const r = await toggleWishlist(productId, !on); if (r === 'login') router.push(`/login?next=${encodeURIComponent(path)}`); else setOn(!on); }
    catch { alert('Could not update your wishlist. Try again.'); } finally { setBusy(false); }
  }
  return (
    <button type="button" className={`heart${big ? ' big' : ''}`} aria-pressed={on} disabled={busy} onClick={click} aria-label={on ? 'Remove from wishlist' : 'Save to wishlist'}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3.1 4.5 6.9 4.5c2.1 0 3.6 1.1 5.1 2.9 1.5-1.8 3-2.9 5.1-2.9 3.8 0 6 3.8 4.5 7.3C19.5 16.4 12 21 12 21z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" /></svg>
      {big && <span>{on ? 'Saved' : 'Save'}</span>}
    </button>);
}
export function TrackView({ id }: { id: string }) { useEffect(() => { trackView(id); }, [id]); return null; }

export function RecentlyViewed({ exclude }: { exclude?: string }) {
  const [items, setItems] = useState<any[]>([]);
  async function load() {
    const ids = recentIds().filter((x) => x !== exclude); if (!ids.length) { setItems([]); return; }
    const db = sb();
    const [{ data: v }, { data: m }] = await Promise.all([
      db.from('catalog_variants').select('product_id,title,selling_price,vendor_name').in('product_id', ids),
      db.from('product_media').select('product_id,url,sort_order').in('product_id', ids).order('sort_order')]);
    const best = new Map<string, any>(); for (const x of v ?? []) if (!best.has(x.product_id) || Number(x.selling_price) < Number(best.get(x.product_id).selling_price)) best.set(x.product_id, x);
    const img = new Map<string, string>(); for (const x of m ?? []) if (!img.has(x.product_id)) img.set(x.product_id, x.url);
    setItems(ids.filter((i) => best.has(i)).map((i) => ({ ...best.get(i), image: img.get(i) })));
  }
  useEffect(() => { load(); window.addEventListener('shopeye:recent', load); return () => window.removeEventListener('shopeye:recent', load); }, [exclude]);
  if (!items.length) return null;
  return (
    <section className="section" aria-labelledby="rv-h">
      <div className="rail-head"><h2 id="rv-h">Recently viewed</h2><button className="linklike" onClick={clearRecent}>Clear</button></div>
      <div className="rail">{items.map((p) => (
        <Link key={p.product_id} href={`/p/${p.product_id}`} className="card mini">
          <div className="ph">{p.image ? <img src={p.image} alt={p.title} loading="lazy" /> : <span className="small">No photo</span>}</div>
          <div className="b"><span className="card-t">{p.title}</span><span className="price">{inr(p.selling_price)}</span></div>
        </Link>))}</div>
    </section>);
}
