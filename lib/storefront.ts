import 'server-only';
// Builds the home page and department pages from live catalogue data (no hard-coded products)
import { listProducts, categoryTree, idsUnder, FIXTURES, type CatNode } from '@/lib/catalog';
import { sbPublic } from '@/lib/sb-server';
import type { Card } from '@/components/ProductGrid';
import type { Slide } from '@/components/Store';

const TONES = ['t-navy', 't-teal', 't-plum', 't-sand', 't-green', 't-rose'];
export async function storefront(slug?: string) {
  const tree = await categoryTree();
  const dept = slug ? tree.find((d) => d.slug === slug) ?? null : null;
  const scope: CatNode[] = dept ? dept.children : tree;                 // what the circles/tabs/banners are made of
  const all = (await listProducts({ categoryIds: dept ? idsUnder(dept) : undefined, sort: 'new', perPage: 800 })).items;
  const under = (n: CatNode) => { const ids = new Set(idsUnder(n)); return all.filter((p) => p.category_id && ids.has(p.category_id)); };
  const groups = scope.map((n) => ({ n, items: under(n) })).filter((g) => g.items.length);
  const img = (xs: Card[]) => xs.find((p) => p.image)?.image ?? null;
  const upTo = (xs: Card[]) => Math.max(0, ...xs.map((p) => p.discount_pct));
  const slides: Slide[] = groups.map((g, k) => ({
    title: dept ? `${g.n.name} from independent sellers` : `Discover ${g.n.name}`,
    sub: `${upTo(g.items) >= 10 ? `Up to ${upTo(g.items)}% off · ` : ''}${g.items.length} products`,
    href: `/c/${g.n.slug}`, cta: 'Shop now', img: img(g.items), tone: TONES[k % TONES.length],
  }));
  const circles = groups.map((g) => ({ name: g.n.name, slug: g.n.slug, img: g.n.image_url ?? img(g.items) }));
  const deals = [...all].filter((p) => p.discount_pct >= 20).sort((a, b) => b.discount_pct - a.discount_pct).slice(0, 12);
  const trending = [...groups].sort((a, b) => b.items.length - a.items.length).slice(0, 4)
    .map((g) => ({ name: g.n.name, slug: g.n.slug, img: img(g.items.slice(1)) ?? img(g.items), from: Math.min(...g.items.map((p) => p.selling_price)) }));
  const bcount = new Map<string, { name: string; slug: string; count: number }>();
  all.forEach((p) => { if (p.brand_slug) { const b = bcount.get(p.brand_slug) ?? { name: p.brand_name!, slug: p.brand_slug, count: 0 }; b.count++; bcount.set(p.brand_slug, b); } });
  const brands = [...bcount.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  const vmap = new Map<string, { id: string; display_name: string; count: number; items: Card[] }>();
  all.forEach((p) => { if (p.vendor_id) { const v = vmap.get(p.vendor_id) ?? { id: p.vendor_id, display_name: p.vendor_name, count: 0, items: [] }; v.count++; if (v.items.length < 3) v.items.push(p); vmap.set(p.vendor_id, v); } });
  const vids = [...vmap.keys()];
  const { data: vrows } = FIXTURES || !vids.length ? { data: [] as any[] } : await sbPublic().from('vendors').select('id,slug').in('id', vids);
  const vslug = new Map((vrows ?? []).map((v: any) => [v.id, v.slug]));
  const tabs = groups.slice(0, 6).map((g) => ({ label: g.n.name, items: g.items.slice(0, 10) }));
  return { tree, dept, all, groups, slides: slides.slice(0, 5), side: slides.slice(5, 7).length ? slides.slice(5, 7) : slides.slice(1, 3),
           promos: slides.slice(2, 5), circles, deals, trending, brands, vendors: [...vmap.values()].filter((v) => vslug.has(v.id)).map((v) => ({ ...v, slug: vslug.get(v.id) as string })).sort((a, b) => b.count - a.count).slice(0, 5), tabs };
}
