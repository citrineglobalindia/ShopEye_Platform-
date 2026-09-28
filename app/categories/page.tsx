// All departments and their categories as picture tiles (the app's Categories tab)
import Link from 'next/link';
import { Crumbs } from '@/components/Crumbs';
import { Pic } from '@/components/Pic';
import { storefront } from '@/lib/storefront';
import { MobileTitle } from '@/components/MobileTitle';
export const revalidate = 60;
export const metadata = { title: 'All categories', description: 'Browse every department and category on ShopEye.' };
export default async function Categories() {
  const d = await storefront();
  const img = (ids: Set<string>) => d.all.find((p) => p.image && p.category_id && ids.has(p.category_id))?.image ?? null;
  const count = (ids: Set<string>) => d.all.filter((p) => p.category_id && ids.has(p.category_id)).length;
  return (
    <div className="wrap section stack">
      <MobileTitle title="All categories" />
      <Crumbs items={[['Home', '/'], ['All categories']]} />
      <h1 className="page-h1" style={{ margin: 0 }}>All categories</h1>
      <nav className="chips sub-chips" aria-label="Jump to department">{d.tree.map((t) => <a key={t.id} href={`#d-${t.slug}`} className="chip">{t.name}</a>)}</nav>
      {d.tree.map((t) => (
        <section key={t.id} id={`d-${t.slug}`} className="stack" aria-labelledby={`h-${t.slug}`} style={{ gap: 10, scrollMarginTop: 140 }}>
          <div className="rail-head"><h2 id={`h-${t.slug}`}>{t.name}</h2><Link href={`/c/${t.slug}`}>Shop all ›</Link></div>
          <div className="cat-grid">
            {t.children.map((c) => { const ids = new Set([c.id]); const i = img(ids); const n = count(ids); return (
              <Link key={c.id} href={`/c/${c.slug}`} className="cat-card">
                <span className="cat-card-img">{i ? <Pic src={i} alt="" w={300} h={300} sizes="(max-width: 600px) 45vw, 180px" /> : <span aria-hidden="true">{c.name[0]}</span>}</span>
                <span className="cat-card-b"><strong>{c.name}</strong><span className="small muted">{n ? `${n} products` : 'Coming soon'}</span></span>
              </Link>); })}
          </div>
        </section>))}
    </div>);
}
