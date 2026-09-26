// SRS: CUST-FR-048 CUST-FR-049 CUST-FR-050 (return policy before purchase; no fabricated ratings; product structured data and canonical URL)
import { notFound } from 'next/navigation';
import { sbPublic } from '@/lib/sb-server';
import { FIXTURES } from '@/lib/catalog';
import { FIX_PDP } from '@/lib/fixtures';
import { Crumbs } from '@/components/Crumbs';
import AddToCart from '@/components/AddToCart';
import { Gallery, PincodeCheck } from '@/components/ProductExtras';
export const revalidate = 30;

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (FIXTURES) return FIX_PDP(id);
  const db = sbPublic();
  const { data: p } = await db.from('products').select('id,title,description,gst_rate,return_window_days,is_returnable,category_id,vendor_id,specifications').eq('id', id).eq('status', 'active').maybeSingle();
  if (!p) return null;
  const [{ data: vars }, { data: media }, { data: avail }, { data: cat }] = await Promise.all([
    db.from('catalog_variants').select('variant_id,sku,attributes,mrp,selling_price,discount_pct,vendor_name').eq('product_id', id),
    db.from('product_media').select('url,alt_text').eq('product_id', id).order('sort_order'),
    db.rpc('variant_availability', { p_product: id }),
    db.from('categories').select('name,slug,return_window_days').eq('id', p.category_id).maybeSingle(),
  ]);
  if (!vars?.length) return null;
  const stock = new Map((avail ?? []).map((a: any) => [a.variant_id, a.available]));
  return { p, cat, media: media ?? [], variants: vars.map((v: any) => ({ ...v, mrp: Number(v.mrp), selling_price: Number(v.selling_price), available: stock.get(v.variant_id) ?? 0 })) };
}
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const d = await load(id);
  return d ? { title: d.p.title, description: (d.p.description ?? '').slice(0, 155), alternates: { canonical: `/p/${id}` },
    openGraph: d.media[0] ? { images: [d.media[0].url.startsWith('data:') ? '/opengraph-image.jpg' : d.media[0].url] } : undefined } : { title: 'Product' };
}
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const d = await load(id);
  if (!d) notFound();
  const { p, media, variants, cat } = d as any;
  const days = p.return_window_days ?? cat?.return_window_days ?? 7;
  const low = Math.min(...variants.map((v: any) => v.selling_price));
  const specs = Object.entries(p.specifications ?? {}).filter(([, v]) => v);
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: p.title, description: p.description ?? undefined,
    image: media.filter((m: any) => !m.url.startsWith('data:')).map((m: any) => m.url), brand: { '@type': 'Brand', name: variants[0].vendor_name },
    offers: { '@type': 'AggregateOffer', priceCurrency: 'INR', lowPrice: low, offerCount: variants.length,
      availability: variants.some((v: any) => v.available > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' } };
  return (
    <div className="wrap section">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <Crumbs items={[['Home', '/'], ...(cat ? [[cat.name, `/c/${cat.slug}`] as [string, string]] : []), [p.title]]} />
      <div className="pdp">
        <Gallery media={media} title={p.title} />
        <div className="stack">
          <div>
            <p className="small muted" style={{ margin: 0 }}>Sold by <strong>{variants[0].vendor_name}</strong></p>
            <h1 className="pdp-title">{p.title}</h1>
            <p className="small muted" style={{ margin: 0 }}>No reviews yet</p>
          </div>
          <AddToCart variants={variants} />
          <PincodeCheck />
          <ul className="assure small">
            <li><strong>{p.is_returnable ? `${days}-day returns` : 'Not returnable'}</strong><span>{p.is_returnable ? 'From the date of delivery. See the returns policy.' : 'This item can’t be returned once delivered.'}</span></li>
            <li><strong>Price includes {Number(p.gst_rate)}% GST</strong><span>A GST invoice is issued by the seller.</span></li>
            <li><strong>Reviewed by ShopEye</strong><span>This listing and seller were checked before going live.</span></li>
          </ul>
        </div>
      </div>
      <div className="pdp-info">
        {p.description && <section><h2>About this product</h2><p style={{ whiteSpace: 'pre-line' }}>{p.description}</p></section>}
        {specs.length > 0 && <section><h2>Specifications</h2><dl className="specs">{specs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl></section>}
      </div>
    </div>
  );
}
