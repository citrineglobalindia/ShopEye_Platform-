// SRS: CUST-FR-025 (responsive home, lazy-loaded images)
import Link from 'next/link';
import { HeroLogo } from '@/components/Logo';
import { ProductGrid, Rail } from '@/components/ProductGrid';
import { listProducts, listCategories } from '@/lib/catalog';
import { RecentlyViewed } from '@/components/ShopWidgets';
export const revalidate = 60;

const PROMISES = [
  ['Reviewed before it’s listed', 'Our team checks every product and every seller before they go live.'],
  ['Pay the way you like', 'UPI, cards, net banking and wallets, secured by Razorpay.'],
  ['Track every package', 'Orders from different sellers arrive as separate, tracked packages.'],
  ['Returns shown up front', 'Each product page tells you its return window before you buy.'],
];

export default async function Home() {
  const [latest, deals, cats] = await Promise.all([
    listProducts({ sort: 'new', perPage: 12 }), listProducts({ sort: 'discount', off: 20, perPage: 8 }), listCategories()]);
  const top = (cats as any[]).filter((c) => !c.parent_id);
  return (
    <div className="wrap">
      <section className="hero">
        <div>
          <p className="kicker">Made in India, sold by the people who make it</p>
          <h1>Handpicked from sellers across India, checked before it reaches you.</h1>
          <p className="lede">Handloom, handcrafted and small-batch goods from independent sellers. Every listing is reviewed before it goes live.</p>
          <div className="cta-row"><a className="btn" href="#new">Browse new arrivals</a><Link className="btn ghost" href="/seller">Sell on ShopEye</Link></div>
        </div>
        <HeroLogo />
      </section>

      <ul className="promises" aria-label="Our promises">
        {PROMISES.map(([t, d]) => <li key={t}><strong>{t}</strong><span className="small muted">{d}</span></li>)}
      </ul>

      {top.length > 0 && (
        <section className="section" aria-labelledby="shop-by">
          <div className="rail-head"><h2 id="shop-by">Shop by category</h2></div>
          <div className="cat-tiles">{top.map((c) => <Link key={c.id} href={`/c/${c.slug}`} className="cat-tile"><span>{c.name}</span><span aria-hidden="true" className="arrow">›</span></Link>)}</div>
        </section>)}

      <Rail title="Biggest savings right now" href="/search?q=&sort=discount" items={deals.items} />

      <RecentlyViewed />

      <section className="section" id="new" aria-labelledby="new-h">
        <div className="rail-head"><h2 id="new-h">New arrivals</h2>{latest.total > 12 && <Link href="/search?sort=new">See all</Link>}</div>
        <ProductGrid items={latest.items} empty={<>
          <h3>The shelves are being stocked</h3>
          <p className="muted">Sellers are listing their first products now. Are you a seller? <Link href="/seller">List your products</Link>.</p>
        </>} />
      </section>
    </div>
  );
}
