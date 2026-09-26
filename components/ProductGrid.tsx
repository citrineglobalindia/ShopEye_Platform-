import Link from 'next/link';
import { inr } from '@/lib/config';
export type Card = { product_id: string; title: string; selling_price: number; mrp: number; discount_pct: number; vendor_name: string; image?: string | null };
export function ProductCard({ p }: { p: Card }) {
  return (
    <Link href={`/p/${p.product_id}`} className="card">
      <div className="ph">
        {p.image ? <img src={p.image} alt={p.title} loading="lazy" /> : <span className="small">Photo coming soon</span>}
        {p.discount_pct >= 5 && <span className="off-badge">{p.discount_pct}% off</span>}
      </div>
      <div className="b">
        <span className="small muted">{p.vendor_name}</span>
        <span className="card-t">{p.title}</span>
        <span><span className="price">{inr(p.selling_price)}</span>{p.mrp > p.selling_price && <span className="mrp">{inr(p.mrp)}</span>}</span>
      </div>
    </Link>
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
