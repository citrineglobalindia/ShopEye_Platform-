// A seller's storefront: everything they have on sale, with the usual filters
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { Listing, parseList, type Params } from '@/components/Listing';
import { Crumbs } from '@/components/Crumbs';
import { ListSkeleton } from '@/components/ListSkeleton';
import { getSeller, listProducts } from '@/lib/catalog';
import { MobileTitle } from '@/components/MobileTitle';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const s = await getSeller((await params).slug);
  return s ? { title: `${s.display_name} store`, description: `Shop ${s.display_name} on ShopEye.`, alternates: { canonical: `/store/${s.slug}` } } : { title: 'Store' };
}
export default async function Store({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const { slug } = await params; const sp = await searchParams;
  const s = await getSeller(slug);
  if (!s) notFound();
  return (
    <div className="wrap section stack">
      <MobileTitle title={s.display_name} />
      <Crumbs items={[['Home', '/'], ['Sellers'], [s.display_name]]} />
      <div className="store-head panel"><span className="seller-av lg" aria-hidden="true">{s.display_name[0]}</span>
        <div><h1 style={{ margin: 0 }}>{s.display_name}</h1><p className="small muted" style={{ margin: 0 }}>Independent seller on ShopEye · every listing reviewed before it goes live</p></div></div>
      <Suspense fallback={<ListSkeleton />}><Results id={s.id} slug={slug} sp={sp} /></Suspense>
    </div>);
}
async function Results({ id, slug, sp }: { id: string; slug: string; sp: Params }) {
  const result = await listProducts({ vendor: id, ...parseList(sp) });
  return <Listing base={`/store/${slug}`} params={sp} result={result} empty={<><h3>No products yet</h3><p className="muted"><Link href="/">Browse everything</Link>.</p></>} />;
}
