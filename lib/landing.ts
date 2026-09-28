import 'server-only';
// Data for a CLiQ-style category landing page (any category that has sub-categories), from live catalogue data
import { listProducts, idsUnder, leavesUnder, type CatNode } from '@/lib/catalog';
import type { Card } from '@/components/ProductGrid';
export type Tile = { name: string; slug: string; img: string | null; img2: string | null; off: number; count: number; href: string };
export type BrandTile = { name: string; slug: string; img: string | null; off: number; min: number };
export async function landing(node: CatNode) {
  const all = (await listProducts({ categoryIds: idsUnder(node), sort: 'new', perPage: 2000 })).items;
  const under = (n: CatNode) => { const ids = new Set(idsUnder(n)); return all.filter((p) => p.category_id && ids.has(p.category_id)); };
  const tile = (n: CatNode): Tile => { const xs = under(n); const imgs = xs.map((p) => p.image).filter(Boolean) as string[];
    return { name: n.name, slug: n.slug, img: n.image_url ?? imgs[0] ?? null, img2: imgs[1] ?? imgs[0] ?? null, off: Math.max(0, ...xs.map((p) => p.discount_pct)), count: xs.length, href: `/c/${n.slug}` }; };
  const children = node.children.map(tile).filter((t) => t.count);
  // "Explore it all": every category below this one (children first, then their sub-categories)
  const seen = new Set<string>(); const explore: Tile[] = [];
  for (const n of [...node.children, ...node.children.flatMap((c) => c.children), ...leavesUnder(node)]) {
    if (seen.has(n.slug)) continue; seen.add(n.slug); const t = tile(n); if (t.count) explore.push(t);
  }
  const brandMap = new Map<string, { name: string; slug: string; items: Card[] }>();
  all.forEach((p) => { if (!p.brand_slug) return; const b = brandMap.get(p.brand_slug) ?? { name: p.brand_name!, slug: p.brand_slug, items: [] }; b.items.push(p); brandMap.set(p.brand_slug, b); });
  const brands: BrandTile[] = [...brandMap.values()].map((b) => ({ name: b.name, slug: b.slug, img: b.items.find((p) => p.image)?.image ?? null,
    off: Math.max(...b.items.map((p) => p.discount_pct)), min: Math.min(...b.items.map((p) => p.discount_pct)) })).sort((a, b) => b.off - a.off);
  const leaves = leavesUnder(node).map(tile).filter((t) => t.count);
  return { all, children, explore, brands, leaves, off: Math.max(0, ...all.map((p) => p.discount_pct)) };
}
