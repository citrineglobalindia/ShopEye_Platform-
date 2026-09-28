// SRS: CUST-FR-027 CUST-FR-039 (cards use current price and stock; unavailable products clearly labelled)
import Link from 'next/link';
import { inr } from '@/lib/config';
import { WishHeart } from '@/components/ShopWidgets';
import { Pic } from '@/components/Pic';
import { QuickAdd } from '@/components/QuickAdd';
export type Card = { stock_left?: number; photos?: number; category_id?: string; is_demo?: boolean; variant_id?: string; brand_name?: string; brand_slug?: string; vendor_id?: string; sizes?: string[]; colours?: string[]; product_id: string; title: string; selling_price: number; mrp: number; discount_pct: number; vendor_name: string; image?: string | null; in_stock?: boolean; rating_avg?: number | null; rating_count?: number };
// whole rupees on cards, like shopping apps (₹12,999 rather than ₹12,999.00)
const rs = (n: number) => inr(n).replace(/\.00$/, '');
export function ProductCard({ p }: { p: Card }) {
  return (
    <div className={`card${p.in_stock === false ? ' oos' : ''}`}>
      <Link href={`/p/${p.product_id}`} className="card-link">
      <div className="ph">
        {p.image ? <Pic src={p.image} alt={p.title} /> : <span className="small">Photo coming soon</span>}
        {(p.photos ?? 0) > 1 && <span className="card-dots" aria-hidden="true">{Array.from({ length: Math.min(p.photos!, 4) }, (_, k) => <i key={k} className={k === 0 ? 'on' : ''} />)}</span>}
        {p.is_demo ? <span className="demo-badge">Preview</span> : p.in_stock === false ? <span className="oos-badge">Out of stock</span>
          : (p as any).published_at && Date.now() - new Date((p as any).published_at).getTime() < 14 * 864e5 ? <span className="new-badge">New</span>
          : p.discount_pct >= 40 ? <span className="offer-badge">On offer</span> : null}
      </div>
      <div className="b">
        <span className="card-brand">{p.brand_name ?? p.vendor_name}</span>
        <span className="card-t">{p.title}</span>
        {!!p.rating_count && <span className="small card-rating" aria-label={`Rated ${Number(p.rating_avg).toFixed(1)} out of 5 from ${p.rating_count} reviews`}><span aria-hidden="true">★ {Number(p.rating_avg).toFixed(1)} ({p.rating_count})</span></span>}
        <span className="card-price"><span className="price">{rs(p.selling_price)}</span>{p.mrp > p.selling_price && <><span className="mrp">{rs(p.mrp)}</span><span className="card-off">{p.discount_pct}% Off</span></>}</span>
        {!p.is_demo && !!p.stock_left && p.stock_left > 0 && p.stock_left <= 5 && <span className="card-low">Limited stock!</span>}
      </div>
      </Link>
      <WishHeart productId={p.product_id} />
      <div className="card-cta">{p.is_demo || !p.variant_id
        ? <span className="btn ghost sm soon" aria-disabled="true">Coming soon</span>
        : p.in_stock === false ? <Link className="btn ghost sm" href={`/p/${p.product_id}`}>Notify me</Link>
        : <QuickAdd variantId={p.variant_id} price={p.selling_price} />}</div>
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
