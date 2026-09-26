// SRS: CUST-FR-030 CUST-FR-033 (query, result count, filters, sort and grid; query rendered safely)
import Link from 'next/link';
import { Listing, parseList, type Params } from '@/components/Listing';
import { listProducts, listCategories } from '@/lib/catalog';
import { Crumbs } from '@/components/Crumbs';
export const metadata = { title: 'Search', robots: { index: false } };

export default async function Search({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams; const q = (sp.q ?? '').trim();
  const [result, cats] = await Promise.all([listProducts({ q: q || undefined, ...parseList(sp) }), listCategories()]);
  return (
    <div className="wrap section stack">
      <Crumbs items={[['Home', '/'], ['Search']]} />
      <h1 style={{ margin: 0 }}>{q ? <>Results for “{q}”</> : 'All products'}</h1>
      <Listing base="/search" params={sp} result={result} empty={<>
        <h3>No matches{q ? <> for “{q}”</> : ''}</h3>
        <p className="muted">Try a shorter word, like “silk” or “kurta”, or browse a category:</p>
        <div className="cta-row">{(cats as any[]).filter((c) => !c.parent_id).slice(0, 6).map((c) => <Link key={c.id} className="btn ghost sm" href={`/c/${c.slug}`}>{c.name}</Link>)}</div>
      </>} />
    </div>
  );
}
