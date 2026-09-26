import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Listing, parseList, type Params } from '@/components/Listing';
import { Crumbs } from '@/components/Crumbs';
import { Suspense } from 'react';
import { listProducts, getCategory } from '@/lib/catalog';
import { ListSkeleton } from '@/components/ListSkeleton';

// SRS: CUST-FR-179 CUST-FR-181 (unique title/description and canonical; filtered, sorted and paged variants are noindex)
export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const c = await getCategory((await params).slug); const sp = await searchParams;
  const filtered = Object.values(sp).some(Boolean);
  return c ? { title: c.name, description: `Shop ${c.name} from independent Indian sellers on ShopEye. Every listing reviewed before it goes live.`, alternates: { canonical: `/c/${c.slug}` }, robots: filtered ? { index: false, follow: true } : undefined } : { title: 'Category' };
}
export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const { slug } = await params; const sp = await searchParams;
  const cat = await getCategory(slug);
  if (!cat) notFound();
  return (
    <div className="wrap section stack">
      <Crumbs items={[['Home', '/'], [cat.name]]} />
      <h1 style={{ margin: 0 }}>{cat.name}</h1>
      <Suspense fallback={<ListSkeleton />}><Results slug={slug} catId={cat.id} sp={sp} /></Suspense>
    </div>
  );
}

async function Results({ slug, catId, sp }: { slug: string; catId: string; sp: Params }) {
  const result = await listProducts({ categoryId: catId, ...parseList(sp) });
  return <Listing base={`/c/${slug}`} params={sp} result={result}
    empty={<><h3>Nothing matches yet</h3><p className="muted">Try removing a filter, or <Link href="/">browse everything</Link>.</p></>} />;
}
