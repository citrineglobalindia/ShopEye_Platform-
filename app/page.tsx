// SRS: CUST-FR-025 CUST-FR-028 CUST-FR-163 (responsive home, lazy-loaded images; keyboard reachable; informative images have alt text, decorative icons are aria-hidden)
import Link from 'next/link';
import { FIXTURES } from '@/lib/catalog';
import { sbPublic } from '@/lib/sb-server';
import { storefront } from '@/lib/storefront';
import { RecentlyViewed } from '@/components/ShopWidgets';
import { Hero, CircleCats, Row, Trending, Brands, Sellers, BestSellers, Promos, Promises } from '@/components/Store';
import { ProductGrid } from '@/components/ProductGrid';
export const revalidate = 60;

export default async function Home() {
  const d = await storefront();
  // SRS: CUST-FR-026 — only banners inside their start/end dates are returned (enforced by row-level security)
  const { data: banners } = FIXTURES ? { data: [] as any[] } : await sbPublic().from('promo_banners').select('id,title,subtitle,link_path').order('sort_order').limit(2);
  return (
    <div className="wrap">
      {d.slides.length ? <Hero slides={d.slides} side={d.side} /> : (
        <section className="hero"><div><p className="kicker">Made in India, sold by the people who make it</p>
          <h1>Handpicked from sellers across India, checked before it reaches you.</h1>
          <div className="cta-row"><Link className="btn" href="/search?sort=new">Browse products</Link><Link className="btn ghost" href="/seller">Sell on ShopEye</Link></div></div></section>)}
      {(banners ?? []).map((b: any) => (
        <Link key={b.id} href={b.link_path || '/'} className="promo"><strong>{b.title}</strong>{b.subtitle && <span>{b.subtitle}</span>}<span className="promo-cta" aria-hidden="true">Shop now ›</span></Link>))}
      <CircleCats title="Shop by category" cats={d.circles} />
      <RecentlyViewed />
      <Row title="Deals of the day" href="/search?sort=discount" items={d.deals} />
      <Trending title="Trending now" tiles={d.trending} />
      <Promos items={d.promos} />
      <Brands brands={d.brands} />
      <Sellers sellers={d.vendors} />
      <BestSellers title="Top picks by category" tabs={d.tabs} />
      <section className="section" id="new" aria-labelledby="new-h">
        <div className="rail-head"><h2 id="new-h">New arrivals</h2>{d.all.length > 12 && <Link href="/search?sort=new">View all ›</Link>}</div>
        <ProductGrid items={d.all.slice(0, 12)} empty={<><h3>The shelves are being stocked</h3><p className="muted">Sellers are listing their first products now. <Link href="/seller">List your products</Link>.</p></>} />
      </section>
      <Promises />
    </div>
  );
}
