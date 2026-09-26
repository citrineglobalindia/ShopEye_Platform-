// SRS: CUST-FR-183 (sitemap lists public pages only; account, cart and checkout excluded)
import type { MetadataRoute } from 'next';
import { sbPublic } from '@/lib/sb-server';
import { INFO } from '@/lib/info-pages';
export const revalidate = 3600;
const BASE = 'https://www.shopeye.in';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = sbPublic();
  const [{ data: cats }, { data: prods }] = await Promise.all([
    db.from('categories').select('slug').eq('active', true),
    db.from('products').select('id,updated_at').eq('status', 'active').limit(45000)]);
  return [
    { url: `${BASE}/`, changeFrequency: 'daily', priority: 1 },
    ...(cats ?? []).map((c: any) => ({ url: `${BASE}/c/${c.slug}`, changeFrequency: 'daily' as const, priority: 0.8 })),
    ...(prods ?? []).map((p: any) => ({ url: `${BASE}/p/${p.id}`, lastModified: p.updated_at, changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...Object.keys(INFO).map((k) => ({ url: `${BASE}/${k}`, changeFrequency: 'monthly' as const, priority: 0.3 })),
  ];
}
