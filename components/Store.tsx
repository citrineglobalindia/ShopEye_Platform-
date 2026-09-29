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

// Phone department landing (Tata CLiQ style): "Category of the day" banner and two-column picture tiles
export function CategoryOfDay({ c }: { c?: { name: string; slug: string; img?: string | null; off?: number } }) {
  if (!c) return null;
  return (
    <Link href={`/c/${c.slug}`} className="cotd">
      <span className="cotd-t"><em>Category of the day</em><strong>{c.name}</strong>{!!c.off && <span>Up to {c.off}% off</span>}</span>
      {c.img && <Pic src={c.img} alt="" w={400} h={400} sizes="45vw" />}
    </Link>);
}
export function CatTiles({ cats }: { cats: { name: string; slug: string; img?: string | null }[] }) {
  if (!cats.length) return null;
  return (
    <nav className="cat-tiles2" aria-label="Categories">
      {cats.map((c) => (
        <Link key={c.slug} href={`/c/${c.slug}`} className={`tile2${c.img ? "" : " noimg"}`}><span>{c.name}</span>{c.img && <Pic src={c.img} alt="" w={240} h={240} sizes="25vw" />}</Link>))}
    </nav>);
}
// Sub-category picture rail + "Value finds" price shortcuts on listing pages
export function SubRail({ cats, current }: { cats: { name: string; slug: string; img?: string | null }[]; current?: string }) {
  if (cats.length < 2) return null;
  return (
    <nav className="subrail" aria-label="Related categories">
      {cats.map((c) => (
        <Link key={c.slug} href={`/c/${c.slug}`} className={`subrail-i${c.slug === current ? ' on' : ''}`} aria-current={c.slug === current ? 'page' : undefined}>
          <span className="subrail-img">{c.img ? <Pic src={c.img} alt="" w={200} h={240} sizes="110px" /> : <span aria-hidden="true">{c.name[0]}</span>}</span>
          <span className="small">{c.name}</span>
        </Link>))}
    </nav>);
}
export function ValueFinds({ base }: { base: string }) {
  const V: [string, string, string][] = [['Newest', 'arrivals', '?sort=new'], ['Under', '₹999', '?max=999'], ['Under', '₹1,499', '?max=1499'], ['Min', '30% off', '?off=30']];
  return (
    <section aria-labelledby="vf-h" className="vf-wrap">
      <h2 id="vf-h" className="serif-h">Value finds</h2>
      <div className="vf">{V.map(([a, b, q]) => <Link key={q} href={`${base}${q}`} className="vf-t"><span>{a}</span><strong>{b}</strong></Link>)}</div>
    </section>);
}
export function ExploreAll({ cats }: { cats: { name: string; slug: string; img?: string | null; off?: number }[] }) {
  if (!cats.length) return null;
  return (
    <section aria-labelledby="ex-h" style={{ margin: '14px 0' }}>
      <h2 id="ex-h" className="serif-h">Explore it all</h2>
      <div className="explore">{cats.map((c) => (
        <Link key={c.slug} href={`/c/${c.slug}`}><span className="ex-img">{c.img && <Pic src={c.img} alt="" w={220} h={220} sizes="108px" />}</span>
          <strong>{c.name}</strong>{!!c.off && <span className="small">Up to {c.off}% off</span>}</Link>))}</div>
    </section>);
}

// "Get the look": tall photo-only cards leading to products
export function GetTheLook({ items, title = 'Get the look' }: { items: { product_id: string; title: string; image?: string | null }[]; title?: string }) {
  const xs = items.filter((p) => p.image).slice(0, 8);
  if (xs.length < 3) return null;
  return (
    <section aria-label={title} className="look-sec">
      <h2 className="serif-h">{title}</h2>
      <div className="look-rail">{xs.map((p) => <Link key={p.product_id} href={`/p/${p.product_id}`} className="look-c" aria-label={p.title}><Pic src={p.image!} alt="" w={320} h={420} sizes="45vw" /></Link>)}</div>
    </section>);
}
