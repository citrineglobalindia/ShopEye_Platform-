import { notFound } from 'next/navigation';
import Link from 'next/link';
import { INFO } from '@/lib/info-pages';
import { Crumbs } from '@/components/Crumbs';

export function generateStaticParams() { return Object.keys(INFO).map((page) => ({ page })); }
export const dynamicParams = false;
export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const p = INFO[(await params).page]; return p ? { title: p.title, description: p.intro } : {};
}
export default async function InfoPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params; const p = INFO[page];
  if (!p) notFound();
  return (
    <div className="wrap section stack" style={{ maxWidth: 820 }}>
      <Crumbs items={[['Home', '/'], [p.title]]} />
      <h1 style={{ margin: 0 }}>{p.title}</h1>
      <p className="lede">{p.intro}</p>
      {p.sections.map(([h, t]) => <section key={h} className="info-sec"><h2>{h}</h2><p>{t}</p></section>)}
      <p className="small muted">Still need help? <Link href="/contact">Contact us</Link>.</p>
    </div>
  );
}
