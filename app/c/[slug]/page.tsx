import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Listing, parseList, type Params } from '@/components/Listing';
import { Crumbs } from '@/components/Crumbs';
import { Suspense } from 'react';
import { listProducts, getCategory, categoryTree, idsUnder, findNode, pathTo } from '@/lib/catalog';
import { landing } from '@/lib/landing';
import { LTabs, LHero, LExplore, LWontLast, LCelebrate, LPick, LWorthIt } from '@/components/Landing';
import { ProductCard } from '@/components/ProductGrid';
import { ListSkeleton } from '@/components/ListSkeleton';
import { RecentlyViewed } from '@/components/ShopWidgets';
import { Hero, CircleCats, Row, Trending, Brands, Sellers, BestSellers, Promos, CategoryOfDay, CatTiles, SubRail, ValueFinds, ExploreAll, GetTheLook } from '@/components/Store';
import { MobileTitle } from '@/components/MobileTitle';

// SRS: CUST-FR-179 CUST-FR-181 (unique title/description and canonical; filtered, sorted and paged variants are noindex)
export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const c = await getCategory((await params).slug); const sp = await searchParams;
  const filtered = Object.values(sp).some(Boolean);
  return c ? { title: c.name, description: `Shop ${c.name} from independent Indian sellers on ShopEye. Every listing reviewed before it goes live.`, alternates: { canonical: `/c/${c.slug}` }, robots: filtered ? { index: false, follow: true } : undefined } : { title: 'Category' };
}
export const revalidate = 60;

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const { slug } = await params; const sp = await searchParams;
  const tree = await categoryTree();
  const node = findNode(tree, slug);
  if (!node) notFound();
  const path = pathTo(tree, slug);                          // e.g. Fashion › Women › Western Wear › Dresses
  const parent = path.length > 1 ? path[path.length - 2] : null;
  const filtered = Object.values(sp).some(Boolean);
  const crumbs: [string, string?][] = [['Home', '/'], ...path.map((n, k) => (k === path.length - 1 ? [n.name] : [n.name, `/c/${n.slug}`]) as [string, string?])];
  const switcher = (parent ? parent.children : tree).map((n) => ({ name: n.name, slug: n.slug }));

  // A category with sub-categories gets its own landing page (any depth: Fashion, Women, Western Wear…)
  if (node.children.length && !filtered) {
    const d = await landing(node);
    const tabsOf = path.length >= 2 ? path[0] : node;       // tabs: the department's sections, current one underlined
    const slides = d.children.length >= 2 ? d.children : d.leaves;
    return (
      <div className="landing">
        <MobileTitle title={node.name} sub={`${d.all.length.toLocaleString('en-IN')} Products`} tabs switcher={switcher} />
        <h1 className="sr-only">{node.name}</h1>
        <LTabs items={tabsOf.children} current={path[1]?.slug} />
        <div className="wrap">
          <div className="d-only"><Crumbs items={crumbs} /></div>
          <LHero slides={slides} name={node.name} />
          <LExplore tiles={d.explore} />
          <LWontLast brands={d.brands} />
          <LCelebrate slides={d.leaves.length >= 2 ? d.leaves : d.children} />
          <LPick lead={d.leaves[0]} tiles={d.leaves.slice(1)} />
          <LWorthIt brands={d.brands} />
          <RecentlyViewed />
          <section className="lsec" aria-label={`Trending in ${node.name}`}>
            <h2 className="lh">Trending in {node.name}</h2>
            <div className="grid">{d.all.slice(0, 12).map((p) => <ProductCard key={p.product_id} p={p} />)}</div>
            {d.all.length > 12 && <p style={{ textAlign: 'center' }}><Link className="btn ghost" href={`/c/${slug}?sort=new`}>View all {d.all.length} products</Link></p>}
          </section>
        </div>
      </div>);
  }

  // A category without sub-categories (or any filtered view): sibling picture rail, banner, value finds, products
  const sib = parent ? (await landing(parent)).children : [];
  return (
    <div className="wrap section stack">
      <div className="d-only"><Crumbs items={crumbs} /></div>
      <h1 className="page-h1" style={{ margin: 0 }}>{node.name}</h1>
      {sib.length > 1 && <SubRail current={slug} cats={sib.map((t) => ({ name: t.name, slug: t.slug, img: t.img }))} />}
      {!filtered && <><CatBanner slug={slug} name={node.name} ids={idsUnder(node)} /><ValueFinds base={`/c/${slug}`} /><Look ids={idsUnder(node)} /></>}
      <Suspense fallback={<ListSkeleton />}><Results slug={slug} ids={idsUnder(node)} sp={sp} title={node.name} switcher={switcher} /></Suspense>
      <RecentlyViewed />
    </div>
  );
}

async function Results({ slug, ids, sp, title, switcher }: { slug: string; ids: string[]; sp: Params; title: string; switcher?: { name: string; slug: string }[] }) {
  const result = await listProducts({ categoryIds: ids, ...parseList(sp) });
  return <><MobileTitle title={title} sub={`${result.total.toLocaleString('en-IN')} Products`} switcher={switcher} /><Listing base={`/c/${slug}`} params={sp} result={result}
    empty={<><h3>Nothing matches yet</h3><p className="muted">Try removing a filter, or <Link href="/">browse everything</Link>.</p></>} /></>;
}

// Promo banner for the category (its biggest real discount) and "Get the look" photo rail
async function CatBanner({ slug, name, ids }: { slug: string; name: string; ids: string[] }) {
  const r = await listProducts({ categoryIds: ids, sort: 'discount', perPage: 24 });
  const top = r.items[0]; if (!top) return null;
  const off = top.discount_pct;
  return (
    <Link href={`/c/${slug}?sort=discount`} className="cat-ban">
      {top.image && <img src={top.image.replace(/w=\d+/, 'w=900')} alt="" />}
      <span className="cat-ban-t"><strong>The {name} store</strong>{off >= 10 && <span>Up to {off}% off</span>}<span className="cat-ban-cta">Shop now</span></span>
    </Link>);
}
async function Look({ ids }: { ids: string[] }) {
  const r = await listProducts({ categoryIds: ids, sort: 'new', perPage: 12 });
  return <GetTheLook items={r.items} />;
}
