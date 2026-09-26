import 'server-only';
import { sbPublic } from './sb-server';
import type { Card } from '@/components/ProductGrid';

// One card per product: lowest-priced active variant + first image
export async function listCards(opts: { categoryId?: string; q?: string; limit?: number } = {}): Promise<Card[]> {
  const db = sbPublic();
  let pq = db.from('products').select('id').eq('status', 'active');
  if (opts.categoryId) pq = pq.eq('category_id', opts.categoryId);
  if (opts.q) pq = pq.textSearch('search_tsv', opts.q.trim().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).map((w) => `${w}:*`).join(' & '), { config: 'simple' });
  const { data: prods } = await pq.order('published_at', { ascending: false }).limit(opts.limit ?? 48);
  const ids = (prods ?? []).map((p: any) => p.id);
  if (!ids.length) return [];
  const [{ data: vars }, { data: media }] = await Promise.all([
    db.from('catalog_variants').select('product_id,title,selling_price,mrp,discount_pct,vendor_name').in('product_id', ids),
    db.from('product_media').select('product_id,url,sort_order').in('product_id', ids).order('sort_order'),
  ]);
  const best = new Map<string, any>();
  for (const v of vars ?? []) { const b = best.get(v.product_id); if (!b || Number(v.selling_price) < Number(b.selling_price)) best.set(v.product_id, v); }
  const img = new Map<string, string>();
  for (const m of media ?? []) if (!img.has(m.product_id)) img.set(m.product_id, m.url);
  return ids.filter((id) => best.has(id)).map((id) => ({ ...best.get(id), selling_price: Number(best.get(id).selling_price), mrp: Number(best.get(id).mrp), image: img.get(id) ?? null }));
}
export async function listCategories() {
  const { data } = await sbPublic().from('categories').select('id,name,slug,parent_id').eq('active', true).order('sort_order').order('name');
  return data ?? [];
}
