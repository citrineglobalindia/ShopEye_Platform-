import 'server-only';
import { sbPublic } from './sb-server';
import { FIX_CATS, FIX_PRODUCTS } from './fixtures';
import type { Card } from '@/components/ProductGrid';

export const FIXTURES = process.env.SHOPEYE_FIXTURES === '1';
export type Sort = 'relevance' | 'new' | 'price_asc' | 'price_desc' | 'discount';
export type ListOpts = { categoryId?: string; q?: string; sort?: Sort; min?: number; max?: number; off?: number; page?: number; perPage?: number };
export type ListResult = { items: Card[]; total: number; page: number; pages: number; priceMax: number };

function applyFilters(all: (Card & { published_at?: string })[], o: ListOpts): ListResult {
  // CUST-FR-032: out-of-stock items stay visible but never outrank in-stock results
  const stockFirst = (xs: any[]) => [...xs].sort((a, b) => Number(b.in_stock !== false) - Number(a.in_stock !== false));
  const priceMax = Math.max(0, ...all.map((c) => c.selling_price));
  let xs = all.filter((c) => (o.min == null || c.selling_price >= o.min) && (o.max == null || c.selling_price <= o.max) && (!o.off || c.discount_pct >= o.off));
  const by: Record<string, (a: any, b: any) => number> = {
    price_asc: (a, b) => a.selling_price - b.selling_price, price_desc: (a, b) => b.selling_price - a.selling_price,
    discount: (a, b) => b.discount_pct - a.discount_pct, new: (a, b) => String(b.published_at).localeCompare(String(a.published_at)),
  };
  if (o.sort && by[o.sort]) xs = [...xs].sort(by[o.sort]);
  xs = stockFirst(xs);
  const per = o.perPage ?? 24, pages = Math.max(1, Math.ceil(xs.length / per)), page = Math.min(Math.max(1, o.page ?? 1), pages);
  return { items: xs.slice((page - 1) * per, page * per), total: xs.length, page, pages, priceMax };
}

// CUST-FR-030/035/036/037: search and listing with price/discount filters and sort, URL-driven
export async function listProducts(o: ListOpts = {}): Promise<ListResult> {
  if (FIXTURES) {
    const q = o.q?.toLowerCase().trim();
    return applyFilters(FIX_PRODUCTS.filter((p) => (!o.categoryId || p.category_id === o.categoryId) && (!q || p.title.toLowerCase().includes(q) || p.vendor_name.toLowerCase().includes(q))), o);
  }
  const db = sbPublic();
  let pq = db.from('products').select('id,published_at,rating_avg,rating_count').eq('status', 'active');
  if (o.categoryId) pq = pq.eq('category_id', o.categoryId);
  if (o.q) {
    const terms = o.q.trim().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
    if (!terms.length) return { items: [], total: 0, page: 1, pages: 1, priceMax: 0 };
    pq = pq.textSearch('search_tsv', terms.map((w) => `${w}:*`).join(' & '), { config: 'simple' });
  }
  const { data: prods } = await pq.order('published_at', { ascending: false }).limit(500);
  const ids = (prods ?? []).map((p: any) => p.id);
  if (!ids.length) return { items: [], total: 0, page: 1, pages: 1, priceMax: 0 };
  const [{ data: vars }, { data: media }, { data: stock }] = await Promise.all([
    db.from('catalog_variants').select('product_id,title,selling_price,mrp,discount_pct,vendor_name').in('product_id', ids),
    db.from('product_media').select('product_id,url,sort_order').in('product_id', ids).order('sort_order'),
    db.rpc('product_stock', { p_ids: ids }),
  ]);
  const inStock = new Map((stock ?? []).map((x: any) => [x.product_id, x.in_stock]));
  const best = new Map<string, any>();
  for (const v of vars ?? []) { const b = best.get(v.product_id); if (!b || Number(v.selling_price) < Number(b.selling_price)) best.set(v.product_id, v); }
  const img = new Map<string, string>();
  for (const m of media ?? []) if (!img.has(m.product_id)) img.set(m.product_id, m.url);
  const pub = new Map((prods ?? []).map((p: any) => [p.id, p.published_at]));
  const rat = new Map((prods ?? []).map((p: any) => [p.id, [p.rating_avg, p.rating_count]]));
  const all = ids.filter((id) => best.has(id)).map((id) => { const b = best.get(id); return { ...b, selling_price: Number(b.selling_price), mrp: Number(b.mrp), image: img.get(id) ?? null, published_at: pub.get(id), in_stock: inStock.get(id) ?? false, rating_avg: rat.get(id)?.[0] ?? null, rating_count: rat.get(id)?.[1] ?? 0 }; });
  return applyFilters(all, o);
}
export async function listCards(o: ListOpts & { limit?: number } = {}): Promise<Card[]> {
  return (await listProducts({ ...o, sort: o.sort ?? 'new', perPage: o.limit ?? 24 })).items;
}
export async function listCategories() {
  if (FIXTURES) return FIX_CATS;
  const { data } = await sbPublic().from('categories').select('id,name,slug,parent_id').eq('active', true).order('sort_order').order('name');
  return data ?? [];
}
export async function getCategory(slug: string) {
  if (FIXTURES) return FIX_CATS.find((c) => c.slug === slug) ?? null;
  const { data } = await sbPublic().from('categories').select('id,name,slug').eq('slug', slug).maybeSingle();
  return data;
}
