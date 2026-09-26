import { notFound } from 'next/navigation';
import { ProductGrid } from '@/components/ProductGrid';
import { listCards } from '@/lib/catalog';
import { sbPublic } from '@/lib/sb-server';
export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data } = await sbPublic().from('categories').select('name').eq('slug', slug).maybeSingle();
  return { title: data?.name ?? 'Category' };
}
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data: cat } = await sbPublic().from('categories').select('id,name').eq('slug', slug).maybeSingle();
  if (!cat) notFound();
  const items = await listCards({ categoryId: cat.id });
  return (<div className="wrap section"><h1>{cat.name}</h1><p className="muted">{items.length} products</p>
    <ProductGrid items={items} empty={<p>No products in {cat.name} yet. Check back soon.</p>} /></div>);
}
