import Link from 'next/link';
import { inr } from '@/lib/config';
export type Card = { product_id: string; title: string; selling_price: number; mrp: number; discount_pct: number; vendor_name: string; image?: string | null };
export function ProductGrid({ items, empty }: { items: Card[]; empty?: React.ReactNode }) {
  if (!items.length) return <div className="panel">{empty ?? 'No products here yet.'}</div>;
  return (
    <div className="grid">
      {items.map((p) => (
        <Link key={p.product_id} href={`/p/${p.product_id}`} className="card">
          <div className="ph">{p.image ? <img src={p.image} alt={p.title} loading="lazy" /> : <span className="small">No image</span>}</div>
          <div className="b">
            <span className="card-t">{p.title}</span>
            <span className="small muted">by {p.vendor_name}</span>
            <span><span className="price">{inr(p.selling_price)}</span>
              {p.mrp > p.selling_price && <><span className="mrp">{inr(p.mrp)}</span><span className="off">{p.discount_pct}% off</span></>}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
