// SRS: CUST-FR-027 CUST-FR-039 (cards use current price and stock; unavailable products clearly labelled)
import Link from 'next/link';
import { inr } from '@/lib/config';
import { WishHeart } from '@/components/ShopWidgets';
import { Pic } from '@/components/Pic';
export type Card = { product_id: string; title: string; selling_price: number; mrp: number; discount_pct: number; vendor_name: string; image?: string | null; in_stock?: boolean; rating_avg?: number | null; rating_count?: number };
export function ProductCard({ p }: { p: Card }) {
  return (
    <div className={`card${p.in_stock === false ? ' oos' : ''}`}>
      <Link href={`/p/${p.product_id}`} className="card-link">
      <div className="ph">
        {p.image ? <Pic src={p.image} alt={p.title} /> : <span className="small">Photo coming soon</span>}
        {p.in_stock === false ? <span className="oos-badge">Out of stock</span> : p.discount_pct >= 5 && <span className="off-badge">{p.discount_pct}% off</span>}
      </div>
      <div className="b">
        <span className="small muted">{p.vendor_name}</span>
        <span className="card-t">{p.title}</span>
        {!!p.rating_count && <span className="small card-rating" aria-label={`Rated ${Number(p.rating_avg).toFixed(1)} out of 5 from ${p.rating_count} reviews`}><span aria-hidden="true">★ {Number(p.rating_avg).toFixed(1)} ({p.rating_count})</span></span>}
        <span><span className="price">{inr(p.selling_price)}</span>{p.mrp > p.selling_price && <span className="mrp">{inr(p.mrp)}</span>}</span>
      </div>
      </Link>
      <WishHeart productId={p.product_id} />
    </div>
  );
}
export function ProductGrid({ items, empty }: { items: Card[]; empty?: React.ReactNode }) {
  if (!items.length) return <div className="panel empty">{empty ?? 'No products here yet.'}</div>;
  return <div className="grid">{items.map((p) => <ProductCard key={p.product_id} p={p} />)}</div>;
}
export function Rail({ title, href, items }: { title: string; href?: string; items: Card[] }) {
  if (!items.length) return null;
  return (
    <section className="section" aria-label={title}>
      <div className="rail-head"><h2>{title}</h2>{href && <Link href={href}>See all</Link>}</div>
      <div className="rail">{items.map((p) => <ProductCard key={p.product_id} p={p} />)}</div>
    </section>
  );
}
