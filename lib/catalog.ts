import 'server-only';
import { unstable_cache } from 'next/cache';
import { sbPublic } from './sb-server';
import { FIX_CATS, FIX_PRODUCTS } from './fixtures';
import type { Card } from '@/components/ProductGrid';

export const FIXTURES = process.env.SHOPEYE_FIXTURES === '1';
export type Sort = 'relevance' | 'new' | 'price_asc' | 'price_desc' | 'discount';
export type ListOpts = { categoryId?: string; categoryIds?: string[]; q?: string; sort?: Sort; min?: number; max?: number; off?: number; page?: number; perPage?: number;
  brand?: string; size?: string; colour?: string; vendor?: string; instock?: boolean };
export type Facet = { value: string; label: string; count: number };
export type ListResult = { items: Card[]; total: number; page: number; pages: number; priceMax: number; facets?: { brands: Facet[]; sizes: Facet[]; colours: Facet[] } };

function applyFilters(all: (Card & { published_at?: string })[], o: ListOpts): ListResult {
  // CUST-FR-032: out-of-stock items stay visible but never outrank in-stock results
  const stockFirst = (xs: any[]) => [...xs].sort((a, b) => Number(b.in_stock !== false) - Number(a.in_stock !== false));
  const priceMax = Math.max(0, ...all.map((c) => c.selling_price));
  // facets are counted before brand/size/colour are applied, so a shopper can still switch between them
  const pre = all.filter((c) => (o.min == null || c.selling_price >= o.min) && (o.max == null || c.selling_price <= o.max) && (!o.off || c.discount_pct >= o.off) && (!o.instock || c.in_stock !== false));
  const count = (vals: (string | undefined)[]) => { const m = new Map<string, number>(); vals.forEach((v) => v && m.set(v, (m.get(v) ?? 0) + 1)); return m; };
  const bm = count(pre.map((c: any) => c.brand_slug)); const bl = new Map(pre.map((c: any) => [c.brand_slug, c.brand_name]));
  const facets = {
    brands: [...bm].map(([v, n]) => ({ value: v, label: String(bl.get(v) ?? v), count: n })).sort((a, b) => a.label.localeCompare(b.label)),
    sizes: [...count(pre.flatMap((c: any) => c.sizes ?? []))].map(([v, n]) => ({ value: v, label: v, count: n })),
    colours: [...count(pre.flatMap((c: any) => c.colours ?? []))].map(([v, n]) => ({ value: v, label: v, count: n })).sort((a, b) => a.label.localeCompare(b.label)),
  };
  let xs = pre.filter((c: any) => (!o.brand || c.brand_slug === o.brand) && (!o.size || (c.sizes ?? []).includes(o.size)) && (!o.colour || (c.colours ?? []).includes(o.colour)) && (!o.vendor || c.vendor_id === o.vendor));
  const by: Record<string, (a: any, b: any) => number> = {
    price_asc: (a, b) => a.selling_price - b.selling_price, price_desc: (a, b) => b.selling_price - a.selling_price,
    discount: (a, b) => b.discount_pct - a.discount_pct, new: (a, b) => String(b.published_at).localeCompare(String(a.published_at)),
  };
  if (o.sort && by[o.sort]) xs = [...xs].sort(by[o.sort]);
  xs = stockFirst(xs);
  const per = o.perPage ?? 24, pages = Math.max(1, Math.ceil(xs.length / per)), page = Math.min(Math.max(1, o.page ?? 1), pages);
  return { items: xs.slice((page - 1) * per, page * per), total: xs.length, page, pages, priceMax, facets };
}

// One cached snapshot of everything on sale (refreshed every 60 s): listings, filters and the home page are
// filtered in memory instead of making several database round trips per request.
const snapshot = unstable_cache(async () => {
  const db = sbPublic();
  const { data: prods } = await db.from('products').select('id,published_at,rating_avg,rating_count,brand_id,vendor_id,category_id').eq('status', 'active').order('published_at', { ascending: false }).limit(3000);
  const ids = (prods ?? []).map((p: any) => p.id);
  if (!ids.length) return [] as any[];
  const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  const parts = await Promise.all(chunk(ids, 300).map((c) => Promise.all([
    db.from('catalog_variants').select('variant_id,product_id,title,selling_price,mrp,discount_pct,vendor_name,vendor_id,is_demo,attributes').in('product_id', c),
    db.from('product_media').select('product_id,url,sort_order').in('product_id', c).order('sort_order'),
    db.rpc('product_stock_levels', { p_ids: c }),
  ])));
  const vars = parts.flatMap((p) => p[0].data ?? []), media = parts.flatMap((p) => p[1].data ?? []), stock = parts.flatMap((p) => p[2].data ?? []);
  const { data: brands } = await db.from('brands').select('id,name,slug');
  const avail = new Map(stock.map((x: any) => [x.product_id, Number(x.available)]));
  const best = new Map<string, any>(); const sizes = new Map<string, Set<string>>(); const colours = new Map<string, Set<string>>();
  for (const v of vars) {
    const b = best.get(v.product_id); if (!b || Number(v.selling_price) < Number(b.selling_price)) best.set(v.product_id, v);
    const a = v.attributes ?? {};
    if (a.size) (sizes.get(v.product_id) ?? sizes.set(v.product_id, new Set()).get(v.product_id)!).add(String(a.size));
    if (a.colour) (colours.get(v.product_id) ?? colours.set(v.product_id, new Set()).get(v.product_id)!).add(String(a.colour));
  }
  const img = new Map<string, string>(); const nimg = new Map<string, number>();
  for (const m of media) { if (!img.has(m.product_id)) img.set(m.product_id, m.url); nimg.set(m.product_id, (nimg.get(m.product_id) ?? 0) + 1); }
  const bmap = new Map((brands ?? []).map((b: any) => [b.id, b]));
  return (prods ?? []).filter((m: any) => best.has(m.id)).map((m: any) => {
    const b = best.get(m.id); const br: any = bmap.get(m.brand_id);
    return { ...b, attributes: undefined, selling_price: Number(b.selling_price), mrp: Number(b.mrp), image: img.get(m.id) ?? null, published_at: m.published_at,
      in_stock: (avail.get(m.id) ?? 0) > 0, stock_left: avail.get(m.id) ?? 0, photos: nimg.get(m.id) ?? 0, rating_avg: m.rating_avg ?? null, rating_count: m.rating_count ?? 0, category_id: m.category_id,
      brand_slug: br?.slug, brand_name: br?.name, sizes: [...(sizes.get(m.id) ?? [])], colours: [...(colours.get(m.id) ?? [])] };
  });
}, ['catalog-snapshot-v2'], { revalidate: 60, tags: ['catalog'] });

// CUST-FR-030/033/035/036/037: search (typo-tolerant, ranked) and listing with filters and sort, URL-driven
export async function listProducts(o: ListOpts = {}): Promise<ListResult> {
  if (FIXTURES) {
    const q = o.q?.toLowerCase().trim();
    return applyFilters(FIX_PRODUCTS.filter((p) => (!o.categoryId || p.category_id === o.categoryId) && (!q || p.title.toLowerCase().includes(q) || p.vendor_name.toLowerCase().includes(q))), o);
  }
  let all: any[] = await snapshot();
  const cids = o.categoryIds ?? (o.categoryId ? [o.categoryId] : null);
  if (cids) { const set = new Set(cids); all = all.filter((c) => set.has(c.category_id)); }
  if (o.vendor) all = all.filter((c) => c.vendor_id === o.vendor);
  if (o.q) {
    const { data } = await sbPublic().rpc('search_products', { p_q: o.q, p_limit: 300 });
    const rank = new Map((data ?? []).map((r: any, i: number) => [r.product_id, i]));
    all = all.filter((c) => rank.has(c.product_id)).sort((a, b) => (rank.get(a.product_id) as number) - (rank.get(b.product_id) as number));
  }
  return applyFilters(all, o);
}
export const searchSuggest = unstable_cache(async (q: string) => {
  const { data } = await sbPublic().rpc('search_products', { p_q: q, p_limit: 6 });
  const snap: any[] = await snapshot(); const by = new Map(snap.map((c) => [c.product_id, c]));
  return (data ?? []).map((r: any) => by.get(r.product_id)).filter(Boolean).map((c: any) => ({ id: c.product_id, title: c.title, price: c.selling_price, image: c.image }));
}, ['search-suggest-v1'], { revalidate: 60, tags: ['catalog'] });
export async function listCards(o: ListOpts & { limit?: number } = {}): Promise<Card[]> {
  return (await listProducts({ ...o, sort: o.sort ?? 'new', perPage: o.limit ?? 24 })).items;
}
const cachedCats = unstable_cache(async () => {
  const { data } = await sbPublic().from('categories').select('id,name,slug,parent_id,image_url').eq('active', true).order('sort_order').order('name');
  return data ?? [];
}, ['categories-v1'], { revalidate: 60, tags: ['catalog'] });
export async function listCategories() {
  if (FIXTURES) return FIX_CATS;
  const data = await cachedCats();
  // a sub-category is shown only while its department is active
  const act = new Set((data ?? []).map((c: any) => c.id));
  return (data ?? []).filter((c: any) => !c.parent_id || act.has(c.parent_id));
}
export async function getCategory(slug: string) {
  if (FIXTURES) return FIX_CATS.find((c) => c.slug === slug) ?? null;
  return ((await cachedCats()) as any[]).find((c) => c.slug === slug) ?? null;
}

// Departments with their sub-categories
export type CatNode = { id: string; name: string; slug: string; parent_id: string | null; image_url?: string | null; children: CatNode[] };
export async function categoryTree(): Promise<CatNode[]> {
  const cats = (await listCategories()) as any[];
  const node = new Map<string, CatNode>(cats.map((c) => [c.id, { ...c, children: [] }]));
  const roots: CatNode[] = [];
  for (const c of cats) { const n = node.get(c.id)!; if (c.parent_id && node.has(c.parent_id)) node.get(c.parent_id)!.children.push(n); else if (!c.parent_id) roots.push(n); }
  return roots;
}
export const idsUnder = (n: CatNode): string[] => [n.id, ...n.children.flatMap(idsUnder)];

// Brands and sellers with something on sale, for the brand row, the seller cards and store pages
export async function listBrands(limit = 12) {
  if (FIXTURES) return [] as { id: string; name: string; slug: string; count: number }[];
  const db = sbPublic();
  const { data: brands } = await db.from('brands').select('id,name,slug').order('name');
  const { data: prods } = await db.from('products').select('brand_id').eq('status', 'active').not('brand_id', 'is', null).limit(2000);
  const n = new Map<string, number>(); (prods ?? []).forEach((p: any) => n.set(p.brand_id, (n.get(p.brand_id) ?? 0) + 1));
  return (brands ?? []).filter((b: any) => n.get(b.id)).map((b: any) => ({ ...b, count: n.get(b.id)! })).sort((a, b) => b.count - a.count).slice(0, limit);
}
export async function listSellers(limit = 6) {
  if (FIXTURES) return [] as any[];
  const db = sbPublic();
  const { data: vs } = await db.from('vendors').select('id,display_name,slug').eq('status', 'active');
  const out = [];
  for (const v of vs ?? []) {
    const r = await listProducts({ vendor: v.id, sort: 'new', perPage: 3 });
    if (r.total) out.push({ ...v, count: r.total, items: r.items });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, limit);
}
export async function getSeller(slug: string) {
  if (FIXTURES) return null;
  const { data } = await sbPublic().from('vendors').select('id,display_name,slug').eq('slug', slug).eq('status', 'active').maybeSingle();
  return data;
}
