import { ProductGrid } from '@/components/ProductGrid';
import { listCards } from '@/lib/catalog';
export const metadata = { title: 'Search', robots: { index: false } };
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const items = q.trim() ? await listCards({ q }) : [];
  return (<div className="wrap section">
    <h1>{q ? <>Results for “{q}”</> : 'Search'}</h1>
    <p className="muted">{q ? `${items.length} products found` : 'Type what you’re looking for in the search bar.'}</p>
    {q && <ProductGrid items={items} empty={<p>No matches. Try a shorter word, like “kurta” or “silk”.</p>} />}
  </div>);
}
