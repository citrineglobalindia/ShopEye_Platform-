// CLiQ-style category landing sections: black sub-category tabs, overlay hero carousel, "Explore It All" grid,
// "This Won't Last", "More To Celebrate", "Take Your Pick" and "So Worth It". Every tile is live catalogue data.
import Link from 'next/link';
import { Pic } from '@/components/Pic';
import { SwipeDots } from '@/components/LandingClient';
import type { Tile, BrandTile } from '@/lib/landing';

const cap = (t: { off: number }) => (t.off >= 10 ? `Up to ${t.off}% off` : 'New arrivals');

export function LTabs({ items, current }: { items: { name: string; slug: string }[]; current?: string }) {
  if (items.length < 2) return null;
  return (
    <nav className="ltabs" aria-label="Categories">
      {items.map((c) => <Link key={c.slug} href={`/c/${c.slug}`} aria-current={c.slug === current ? 'page' : undefined}>{c.name}</Link>)}
    </nav>);
}

export function LHero({ slides, name }: { slides: Tile[]; name: string }) {
  const xs = slides.filter((s) => s.img).slice(0, 8);
  if (!xs.length) return null;
  return (
    <section className="lhero" aria-label={`${name} highlights`}>
      <SwipeDots id="lhero" count={xs.length}>
        {xs.map((s, k) => (
          <Link key={s.slug} href={s.href} className="lhero-s" aria-label={`${s.name}, ${cap(s)}`}>
            <Pic src={s.img!} alt="" w={760} h={940} sizes="(max-width: 860px) 92vw, 600px" priority={k === 0} />
            <span className="lhero-t" aria-hidden="true"><em>{cap(s)}</em><strong>{s.name}</strong><span>Picked from independent sellers</span><b>Shop now</b></span>
          </Link>))}
      </SwipeDots>
    </section>);
}

export function LExplore({ tiles, title = 'Explore It All' }: { tiles: Tile[]; title?: string }) {
  if (!tiles.length) return null;
  return (
    <section className="lsec" aria-label={title}>
      <h2 className="lh">{title}</h2>
      <div className={`lexp${tiles.length > 8 ? ' rows3' : tiles.length > 4 ? ' rows2' : ''}`}>
        {tiles.map((t) => (
          <Link key={t.slug} href={t.href} className="lexp-c">
            <span className="lexp-img">{t.img && <Pic src={t.img} alt="" w={240} h={220} sizes="112px" />}</span>
            <strong>{t.name}</strong><span>{cap(t)}</span>
          </Link>))}
      </div>
    </section>);
}

export function LWontLast({ brands }: { brands: BrandTile[] }) {
  const xs = brands.filter((b) => b.img).slice(0, 2);
  if (xs.length < 2) return null;
  return (
    <section className="lsec" aria-label="This won't last">
      <h2 className="lh">This Won’t Last</h2>
      <div className="lwl">
        {xs.map((b) => (
          <Link key={b.slug} href={`/search?brand=${b.slug}`} className="lwl-c">
            <span className="lwl-img"><Pic src={b.img!} alt="" w={400} h={420} sizes="45vw" /><span className="lwl-brand" aria-hidden="true">{b.name}</span></span>
            <span className="lcap">{b.min >= 10 ? `Min. ${b.min}% off` : `Up to ${b.off}% off`}</span>
          </Link>))}
      </div>
    </section>);
}

export function LCelebrate({ slides, title = 'More To Celebrate' }: { slides: Tile[]; title?: string }) {
  const xs = slides.filter((s) => s.img2).slice(0, 5);
  if (xs.length < 2) return null;
  return (
    <section className="lsec" aria-label={title}>
      <h2 className="lh">{title}</h2>
      <SwipeDots id="lcel" count={xs.length}>
        {xs.map((s) => (
          <Link key={s.slug} href={s.href} className="lcel-s">
            <Pic src={s.img2!} alt="" w={800} h={500} sizes="(max-width: 860px) 94vw, 700px" />
            <span className="lcel-t" aria-hidden="true"><em>The</em><strong>{s.name} edit</strong><span>Everything for your {s.name.toLowerCase()} moments</span><b>Shop now</b></span>
          </Link>))}
      </SwipeDots>
    </section>);
}

export function LPick({ lead, tiles }: { lead?: Tile; tiles: Tile[] }) {
  if (!lead?.img || tiles.length < 2) return null;
  return (
    <section className="lsec" aria-label="Take your pick">
      <h2 className="lh">Take Your Pick</h2>
      <Link href={lead.href} className="lpick-ban">
        <Pic src={lead.img} alt="" w={900} h={380} sizes="100vw" />
        <span className="lpick-bt" aria-hidden="true"><strong>{lead.name}<br />staples</strong><span>{cap(lead)}</span></span>
      </Link>
      <div className="lpick-rail">
        {tiles.map((t) => (
          <Link key={t.slug} href={t.href} className="lpick-c">
            <span className="lpick-img">{t.img2 && <Pic src={t.img2} alt="" w={300} h={400} sizes="40vw" />}<span className="lpick-l" aria-hidden="true">{t.name}</span></span>
            <span className="lcap">{cap(t)}</span>
          </Link>))}
      </div>
    </section>);
}

export function LWorthIt({ brands }: { brands: BrandTile[] }) {
  const xs = brands.filter((b) => b.img).slice(2, 10);
  if (xs.length < 2) return null;
  return (
    <section className="lsec" aria-label="So worth it">
      <h2 className="lh">So Worth It</h2>
      <div className="lworth">
        {xs.map((b) => (
          <Link key={b.slug} href={`/search?brand=${b.slug}`} className="lwl-c">
            <span className="lwl-img tall"><Pic src={b.img!} alt="" w={400} h={480} sizes="45vw" /><span className="lwl-brand" aria-hidden="true">{b.name}</span></span>
            <span className="lcap">{b.min >= 10 ? `Min. ${b.min}% off` : `Up to ${b.off}% off`}</span>
          </Link>))}
      </div>
    </section>);
}

// Home on phones: full-bleed hero under a dark, see-through app bar, then a "store" banner with the house brands
export function HomeTop({ img, off, count, brands }: { img?: string | null; off: number; count: number; brands: string[] }) {
  return (
    <div className="m-only htop">
      <Link href="/search?sort=discount" className="htop-hero" aria-label={`Season’s picks: ${off >= 10 ? `up to ${off}% off` : "new arrivals"}`}>
        {img && <Pic src={img} alt="" w={900} h={760} sizes="100vw" priority />}
        <span className="htop-t" aria-hidden="true"><em>Season’s picks</em><strong>{off >= 10 ? `Up to ${off}% off` : 'New arrivals'}</strong><span>{count} products from independent sellers</span></span>
      </Link>
      <Link href={`/search?off=${off >= 50 ? 50 : 30}`} className="hstore">
        <span className="hstore-t"><span>The</span><strong>{off >= 50 ? '50%' : '30%'}</strong><span>store</span></span>
        <span className="hstore-s">Everything feels better at {off >= 50 ? 'half the price' : 'a lower price'}</span>
        <span className="hstore-b" aria-hidden="true">{brands.slice(0, 7).map((b) => <i key={b}>{b}</i>)}</span>
      </Link>
    </div>);
}
