import Link from 'next/link';
import { Aperture } from '@/components/Logo';
import { ProductGrid } from '@/components/ProductGrid';
import { listCards, listCategories } from '@/lib/catalog';
export const revalidate = 60;

export default async function Home() {
  const [items, cats] = await Promise.all([listCards({ limit: 24 }), listCategories()]);
  return (
    <div className="wrap">
      <section className="hero">
        <div>
          <h1>Handpicked from sellers across India, checked before it reaches you.</h1>
          <p>Every listing is reviewed before it goes live. Pay securely, track each package, and return within the window shown on the product.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a className="btn" href="#new">Browse new arrivals</a>
            <Link className="btn ghost" href="/seller">Sell on Shopeye</Link>
          </div>
        </div>
        <Aperture />
      </section>
      {cats.length > 0 && (
        <section className="section" aria-labelledby="shop-by">
          <h2 id="shop-by">Shop by category</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {cats.map((c: any) => <Link key={c.id} href={`/c/${c.slug}`} className="btn ghost sm">{c.name}</Link>)}
          </div>
        </section>
      )}
      <section className="section" id="new" aria-labelledby="new-h">
        <h2 id="new-h">New arrivals</h2>
        <ProductGrid items={items} empty={<>
          <h3>The shelves are being stocked</h3>
          <p className="muted">Sellers are listing their first products now. Are you a seller? <Link href="/seller">List your products</Link>.</p>
        </>} />
      </section>
    </div>
  );
}
