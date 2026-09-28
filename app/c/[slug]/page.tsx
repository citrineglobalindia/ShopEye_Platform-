import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Listing, parseList, type Params } from '@/components/Listing';
import { Crumbs } from '@/components/Crumbs';
import { Suspense } from 'react';
import { listProducts, getCategory, categoryTree, idsUnder } from '@/lib/catalog';
import { storefront } from '@/lib/storefront';
import { ListSkeleton } from '@/components/ListSkeleton';
import { RecentlyViewed } from '@/components/ShopWidgets';
import { Hero, CircleCats, Row, Trending, Brands, Sellers, BestSellers, Promos, CategoryOfDay, CatTiles, SubRail, ValueFinds } from '@/components/Store';

// SRS: CUST-FR-179 CUST-FR-181 (unique title/description and canonical; filtered, sorted and paged variants are noindex)
export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const c = await getCategory((await params).slug); const sp = await searchParams;
  const filtered = Object.values(sp).some(Boolean);
  return c ? { title: c.name, description: `Shop ${c.name} from independent Indian sellers on ShopEye. Every listing reviewed before it goes live.`, alternates: { canonical: `/c/${c.slug}` }, robots: filtered ? { index: false, follow: true } : undefined } : { title: 'Category' };
}
export const revalidate = 60;

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const { slug } = await params; const sp = await searchParams;
  const cat = await getCategory(slug);
  if (!cat) notFound();
  const tree = await categoryTree();
  const dept = tree.find((d) => d.slug === slug);
  const parent = cat.parent_id ? tree.find((d) => d.id === cat.parent_id) : null;
  const siblings = (dept ?? parent)?.children ?? [];
  const filtered = Object.values(sp).some(Boolean);
  const side = (
    <nav className="panel cat-side" aria-label={`${(dept ?? parent)?.name ?? cat.name} categories`}>
      <strong>{(dept ?? parent)?.name ?? 'Categories'}</strong>
      {(dept ?? parent) && <Link href={`/c/${(dept ?? parent)!.slug}`} aria-current={dept ? 'page' : undefined}>All {(dept ?? parent)!.name}</Link>}
      {siblings.map((c) => <Link key={c.id} href={`/c/${c.slug}`} aria-current={c.slug === slug ? 'page' : undefined}>{c.name}</Link>)}
    </nav>);
  if (dept && dept.children.length && !filtered) {
    const d = await storefront(slug);
    return (
      <div className="wrap section">
        <Crumbs items={[['Home', '/'], [dept.name]]} />
        <div className="dept">
          <aside className="dept-side">{side}
            <form className="panel stack" action={`/c/${slug}`} style={{ gap: 8 }}>
              <strong>Filter {dept.name}</strong>
              <div className="row2" style={{ gap: 8 }}><label className="small">Min ₹<input name="min" inputMode="numeric" /></label><label className="small">Max ₹<input name="max" inputMode="numeric" /></label></div>
              <label className="radio small"><input type="checkbox" name="instock" value="1" style={{ width: 'auto' }} /> In stock only</label>
              <select name="sort" aria-label="Sort" defaultValue=""><option value="">Relevance</option><option value="new">Newest first</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="discount">Biggest discount</option></select>
              <button className="btn dark sm">Show products</button>
            </form>
          </aside>
          <div className="dept-main">
            <Hero slides={d.slides} side={d.side} />
            <div className="m-only"><CategoryOfDay c={d.cotd} /><CatTiles cats={d.circles} /></div>
            <div className="d-only"><CircleCats title={`Shop ${dept.name} by category`} cats={d.circles} /></div>
            <RecentlyViewed />
            <Row title="Deals of the day" href={`/c/${slug}?sort=discount`} items={d.deals} />
            <Trending title="Shop by trending styles" tiles={d.trending} />
            <Brands brands={d.brands} />
            <Sellers sellers={d.vendors} />
            <BestSellers title={`Top picks in ${dept.name}`} tabs={d.tabs} />
            <Promos items={d.promos} />
          </div>
        </div>
      </div>);
  }
  return (
    <div className="wrap section stack">
      <Crumbs items={[['Home', '/'], ...(parent ? [[parent.name, `/c/${parent.slug}`] as [string, string]] : []), [cat.name]]} />
      <h1 style={{ margin: 0 }}>{cat.name}</h1>
      {siblings.length > 0 && (dept || parent) && <SubRail current={slug} cats={(await storefront((dept ?? parent)!.slug)).circles} />}
      {!filtered && <ValueFinds base={`/c/${slug}`} />}
      <Suspense fallback={<ListSkeleton />}><Results slug={slug} ids={dept ? idsUnder(dept) : [cat.id]} sp={sp} /></Suspense>
      <RecentlyViewed />
    </div>
  );
}

async function Results({ slug, ids, sp }: { slug: string; ids: string[]; sp: Params }) {
  const result = await listProducts({ categoryIds: ids, ...parseList(sp) });
  return <Listing base={`/c/${slug}`} params={sp} result={result}
    empty={<><h3>Nothing matches yet</h3><p className="muted">Try removing a filter, or <Link href="/">browse everything</Link>.</p></>} />;
}
