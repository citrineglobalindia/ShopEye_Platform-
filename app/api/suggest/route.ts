// Header search suggestions: top matching products (typo-tolerant) plus matching departments/categories and brands
import { NextResponse } from 'next/server';
import { searchSuggest, listCategories, FIXTURES } from '@/lib/catalog';
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 60);
  if (q.length < 2 || FIXTURES) return NextResponse.json({ products: [], categories: [] });
  const [products, cats] = await Promise.all([searchSuggest(q.toLowerCase()), listCategories()]);
  const ql = q.toLowerCase();
  const categories = (cats as any[]).filter((c) => c.name.toLowerCase().includes(ql)).slice(0, 4).map((c) => ({ name: c.name, slug: c.slug }));
  return NextResponse.json({ products, categories }, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } });
}
