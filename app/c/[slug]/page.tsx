import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Listing, parseList, type Params } from '@/components/Listing';
import { Crumbs } from '@/components/Crumbs';
import { listProducts, getCategory } from '@/lib/catalog';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getCategory((await params).slug);
  return c ? { title: c.name, description: `Shop ${c.name} from independent Indian sellers on ShopEye.`, alternates: { canonical: `/c/${c.slug}` } } : { title: 'Category' };
}
export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Params> }) {
  const { slug } = await params; const sp = await searchParams;
  const cat = await getCategory(slug);
  if (!cat) notFound();
  const result = await listProducts({ categoryId: cat.id, ...parseList(sp) });
  return (
    <div className="wrap section stack">
      <Crumbs items={[['Home', '/'], [cat.name]]} />
      <h1 style={{ margin: 0 }}>{cat.name}</h1>
      <Listing base={`/c/${slug}`} params={sp} result={result}
        empty={<><h3>Nothing matches yet</h3><p className="muted">Try removing a filter, or <Link href="/">browse everything</Link>.</p></>} />
    </div>
  );
}
