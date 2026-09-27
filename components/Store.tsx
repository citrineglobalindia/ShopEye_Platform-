// Storefront building blocks shared by the home page and department pages (all driven by live catalogue data)
import Link from 'next/link';
import { Pic } from '@/components/Pic';
import { ProductCard, type Card } from '@/components/ProductGrid';
import { HeroCarousel, Tabs } from '@/components/StoreClient';

export type Slide = { title: string; sub: string; href: string; cta: string; img?: string | null; tone: string };
export function Hero({ slides, side }: { slides: Slide[]; side: Slide[] }) {
  return (
    <section className="hero2" aria-label="Featured">
      <HeroCarousel slides={slides} />
      <div className="hero2-side">
        {side.slice(0, 2).map((s) => (
          <Link key={s.href} href={s.href} className={`side-ban ${s.tone}`}>
            <span className="side-t"><strong>{s.title}</strong><span className="small">{s.sub}</span><span className="side-cta">{s.cta} ›</span></span>
            {s.img && <Pic src={s.img} alt="" w={260} h={260} sizes="160px" />}
          </Link>))}
      </div>
    </section>);
}

export function CircleCats({ title, cats }: { title?: string; cats: { name: string; slug: string; img?: string | null }[] }) {
  if (!cats.length) return null;
  return (
    <section className="section" aria-label={title ?? 'Shop by category'}>
      {title && <div className="rail-head"><h2>{title}</h2></div>}
      <div className="circles">
        {cats.map((c) => (
          <Link key={c.slug} href={`/c/${c.slug}`} className="circle">
            <span className="circle-img">{c.img ? <Pic src={c.img} alt="" w={180} h={180} sizes="96px" /> : <span aria-hidden="true">{c.name[0]}</span>}</span>
            <span className="small">{c.name}</span>
          </Link>))}
      </div>
    </section>);
}

export function Row({ title, href, items, note }: { title: string; href?: string; items: Card[]; note?: string }) {
  if (!items.length) return null;
  return (
    <section className="section" aria-label={title}>
      <div className="rail-head"><h2>{title}{note && <span className="small muted rail-note"> {note}</span>}</h2>{href && <Link href={href}>View all ›</Link>}</div>
      <div className="rail">{items.map((p) => <ProductCard key={p.product_id} p={p} />)}</div>
    </section>);
}

export function Trending({ title, tiles }: { title: string; tiles: { name: string; slug: string; img?: string | null; from?: number }[] }) {
  if (!tiles.length) return null;
  return (
    <section className="section" aria-label={title}>
      <div className="rail-head"><h2>{title}</h2></div>
      <div className="trend">
        {tiles.slice(0, 4).map((t) => (
          <Link key={t.slug} href={`/c/${t.slug}`} className="trend-t">
            {t.img && <Pic src={t.img} alt="" w={400} h={480} sizes="(max-width: 700px) 50vw, 280px" />}
            <span className="trend-cap"><strong>{t.name}</strong>{t.from != null && <span className="small">From ₹{t.from.toLocaleString('en-IN')}</span>}<span className="side-cta">Explore ›</span></span>
          </Link>))}
      </div>
    </section>);
}

export function Brands({ brands }: { brands: { name: string; slug: string; count: number }[] }) {
  if (!brands.length) return null;
  return (
    <section className="section" aria-label="Top brands">
      <div className="rail-head"><h2>Top brands</h2><Link href="/search?sort=new">View all ›</Link></div>
      <div className="brands">
        {brands.map((b) => (
          <Link key={b.slug} href={`/search?brand=${encodeURIComponent(b.slug)}`} className="brand-chip">
            <span className="brand-mark" aria-hidden="true">{b.name}</span>
            <span className="small muted">{b.count} {b.count === 1 ? 'product' : 'products'}</span>
          </Link>))}
      </div>
    </section>);
}

export function Sellers({ sellers }: { sellers: { id: string; display_name: string; slug: string; count: number; items: Card[] }[] }) {
  if (!sellers.length) return null;
  return (
    <section className="section" aria-label="Featured sellers">
      <div className="rail-head"><h2>Featured sellers</h2></div>
      <div className="sellers">
        {sellers.map((s) => (
          <div key={s.id} className="seller panel">
            <div className="seller-h"><span className="seller-av" aria-hidden="true">{s.display_name[0]}</span><div><strong>{s.display_name}</strong><div className="small muted">{s.count} products</div></div></div>
            <div className="seller-imgs">{s.items.slice(0, 3).map((p) => p.image && <Link key={p.product_id} href={`/p/${p.product_id}`} aria-label={p.title}><Pic src={p.image} alt="" w={160} h={160} sizes="80px" /></Link>)}</div>
            <Link href={`/store/${s.slug}`} className="btn ghost sm">View store</Link>
          </div>))}
      </div>
    </section>);
}

export function BestSellers({ title, tabs }: { title: string; tabs: { label: string; items: Card[] }[] }) {
  const t = tabs.filter((x) => x.items.length);
  if (!t.length) return null;
  return (
    <section className="section" aria-label={title}>
      <div className="rail-head"><h2>{title}</h2></div>
      <Tabs labels={t.map((x) => x.label)} panels={t.map((x) => <div key={x.label} className="rail">{x.items.map((p) => <ProductCard key={p.product_id} p={p} />)}</div>)} />
    </section>);
}

export function Promos({ items }: { items: Slide[] }) {
  if (!items.length) return null;
  return (
    <section className="section promos" aria-label="Offers">
      {items.slice(0, 3).map((s) => (
        <Link key={s.href} href={s.href} className={`promo-t ${s.tone}`}>
          <span className="side-t"><strong>{s.title}</strong><span className="small">{s.sub}</span><span className="side-cta">{s.cta} ›</span></span>
          {s.img && <Pic src={s.img} alt="" w={260} h={260} sizes="140px" />}
        </Link>))}
    </section>);
}

export const PROMISES = [
  ['Every listing reviewed', 'Products and sellers are checked before they go live.'],
  ['Secure payments', 'UPI, cards, net banking and wallets via Razorpay.'],
  ['Easy returns', 'Return window shown on every product page.'],
  ['Tracked delivery', 'Each seller’s package is tracked separately.'],
];
export function Promises() {
  return <ul className="promises" aria-label="Our promises">{PROMISES.map(([t, d]) => <li key={t}><strong>{t}</strong><span className="small muted">{d}</span></li>)}</ul>;
}
