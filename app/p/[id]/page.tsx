// SRS: CUST-FR-170 (React escapes all customer text; the only raw HTML is this JSON-LD, with "<" escaped; the database validates every write and emails escape customer text, see scripts/test-security.mjs and UAT §24)
// SRS: CUST-FR-180 (structured data lists each variant as an offer with its real price and stock, and only published verified reviews; nothing is marked up when there is no data)
// SRS: CUST-FR-182 CUST-FR-029 CUST-FR-045 CUST-FR-047 CUST-FR-048 CUST-FR-049 CUST-FR-050 (product URLs use the permanent product ID, so they never change; unknown or removed products show a clean not-found page; variant switch updates photos, price and stock; alternatives when unavailable; return policy before purchase; no fabricated ratings; product structured data and canonical URL)
import { notFound } from 'next/navigation';
import { sbPublic } from '@/lib/sb-server';
import { FIXTURES } from '@/lib/catalog';
import { FIX_PDP } from '@/lib/fixtures';
import { Crumbs } from '@/components/Crumbs';
import AddToCart from '@/components/AddToCart';
import { Gallery, PincodeCheck } from '@/components/ProductExtras';
import { WishHeart, TrackView, RecentlyViewed } from '@/components/ShopWidgets';
import { Rail } from '@/components/ProductGrid';
import { listProducts } from '@/lib/catalog';
import { ReviewList, Stars } from '@/components/Reviews';
import { Questions } from '@/components/Questions';
import { TrackEvent } from '@/components/Analytics';
import { CompareToggle } from '@/components/Alerts';
export const revalidate = 30;

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (FIXTURES) return FIX_PDP(id);
  const db = sbPublic();
  const { data: p } = await db.from('products').select('id,title,description,gst_rate,return_window_days,is_returnable,category_id,vendor_id,specifications,rating_avg,rating_count,is_demo').eq('id', id).eq('status', 'active').maybeSingle();
  if (!p) return null;
  const [{ data: vars }, { data: media }, { data: avail }, { data: cat }] = await Promise.all([
    db.from('catalog_variants').select('variant_id,sku,attributes,mrp,selling_price,discount_pct,vendor_name').eq('product_id', id),
    db.from('product_media').select('url,alt_text,variant_id,credit,credit_url').eq('product_id', id).order('sort_order'),
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
    ...((d.p as any).is_demo ? { robots: { index: false, follow: true } } : {}),   // previews stay out of search engines and shopping results
    openGraph: d.media[0] ? { images: [d.media[0].url.startsWith('data:') ? '/opengraph-image.jpg' : d.media[0].url] } : undefined } : { title: 'Product' };
}
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const d = await load(id);
  if (!d) notFound();
  const { p, media, variants, cat } = d as any;
  const days = p.return_window_days ?? cat?.return_window_days ?? 7;
  const low = Math.min(...variants.map((v: any) => v.selling_price));
  const more = cat ? (await listProducts({ categoryId: p.category_id, perPage: 9 })).items.filter((x) => x.product_id !== id).slice(0, 8) : [];
  const specs = Object.entries(p.specifications ?? {}).filter(([, v]) => v);
  // SRS: CUST-FR-079 (points this item earns and their value, shown before buying)
  const lr: any = FIXTURES ? { points_per_100: 1, rupees_per_point: 1 } : (await sbPublic().rpc('loyalty_rules')).data;
  const earn = lr ? Math.floor(low / 100) * Number(lr.points_per_100) : 0;
  // Only published reviews (RLS for anonymous readers) go into the search markup
  const reviews = FIXTURES || !(p.rating_count > 0) ? [] : (await sbPublic().from('product_reviews').select('author_name,rating,title,body,created_at')
    .eq('product_id', id).eq('status', 'published').order('helpful_count', { ascending: false }).limit(5)).data ?? [];
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: p.title, description: p.description ?? undefined,
    image: media.filter((m: any) => !m.url.startsWith('data:')).map((m: any) => m.url), brand: { '@type': 'Brand', name: variants[0].vendor_name },
    ...(p.rating_count > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(p.rating_avg), reviewCount: p.rating_count } } : {}),
    offers: { '@type': 'AggregateOffer', priceCurrency: 'INR', lowPrice: low, highPrice: Math.max(...variants.map((v: any) => v.selling_price)), offerCount: variants.length,
      availability: variants.some((v: any) => v.available > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      offers: variants.map((v: any) => ({ '@type': 'Offer', sku: v.sku, price: v.selling_price, priceCurrency: 'INR', url: `https://www.shopeye.in/p/${id}`,
        itemCondition: 'https://schema.org/NewCondition', seller: { '@type': 'Organization', name: v.vendor_name },
        availability: v.available > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' })) },
    ...(reviews.length ? { review: reviews.map((r: any) => ({ '@type': 'Review', author: { '@type': 'Person', name: r.author_name }, datePublished: String(r.created_at).slice(0, 10),
        reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 }, ...(r.title ? { name: r.title } : {}), ...(r.body ? { reviewBody: r.body } : {}) })) } : {}) };
  return (
    <div className="wrap section">
      {!p.is_demo && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />}
      <Crumbs items={[['Home', '/'], ...(cat ? [[cat.name, `/c/${cat.slug}`] as [string, string]] : []), [p.title]]} />
      <div className="pdp">
        <div>
          <Gallery media={media} title={p.title} />
          {media[0]?.credit && <p className="small muted" style={{ margin: '6px 0 0' }}>Photo: {media[0].credit_url ? <a href={media[0].credit_url} target="_blank" rel="noopener nofollow">{media[0].credit}</a> : media[0].credit}</p>}
        </div>
        <div className="stack">
          <div>
            <p className="small muted" style={{ margin: 0 }}>Sold by <strong>{variants[0].vendor_name}</strong></p>
            <div className="title-row"><h1 className="pdp-title">{p.title}</h1><WishHeart productId={id} big /></div>
            <p className="small" style={{ margin: 0 }}>{p.rating_count > 0 ? <a href="#rev-h" className="rating-link"><Stars value={Number(p.rating_avg)} /> {Number(p.rating_avg).toFixed(1)} · {p.rating_count} {p.rating_count === 1 ? 'review' : 'reviews'}</a> : <span className="muted">No reviews yet</span>} · <CompareToggle productId={id} /></p>
          </div>
          {p.is_demo
            ? <div className="msg info" role="note"><strong>Preview product.</strong> This listing shows what ShopEye will offer and can’t be bought yet. Sellers are joining now; save it to your wishlist and we’ll have the real thing soon.</div>
            : <AddToCart variants={variants} />}
          <PincodeCheck />
          <ul className="assure small">
            <li><strong>{p.is_returnable ? `${days}-day returns` : 'Not returnable'}</strong><span>{p.is_returnable ? 'From the date of delivery. See the returns policy.' : 'This item can’t be returned once delivered.'}</span></li>
            <li><strong>Price includes {Number(p.gst_rate)}% GST</strong><span>A GST invoice is issued by the seller.</span></li>
            {earn > 0 && <li><strong>Earn {earn} loyalty point{earn === 1 ? '' : 's'}</strong><span>Worth ₹{earn * Number(lr.rupees_per_point)} on a later order, usable once the return window closes.</span></li>}
            <li><strong>Reviewed by ShopEye</strong><span>This listing and seller were checked before going live.</span></li>
          </ul>
        </div>
      </div>
      <div className="pdp-info">
        {p.description && <section><h2>About this product</h2><p style={{ whiteSpace: 'pre-line' }}>{p.description}</p></section>}
        {specs.length > 0 && <section><h2>Specifications</h2><dl className="specs">{specs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl></section>}
      </div>
      <ReviewList productId={id} avg={p.rating_avg} count={p.rating_count ?? 0} />
      <Questions productId={id} />
      <TrackEvent name="view_item" params={{ currency: 'INR', value: low, items: [{ item_id: variants[0].sku, item_name: p.title, price: low }] }} />
      <TrackView id={id} />
      <div id="more">{cat && <Rail title={`More from ${cat.name}`} href={`/c/${cat.slug}`} items={more} />}</div>
      <RecentlyViewed exclude={id} />
    </div>
  );
}
