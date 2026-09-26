import { notFound } from 'next/navigation';
import { sbPublic } from '@/lib/sb-server';
import AddToCart from '@/components/AddToCart';
export const revalidate = 30;

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = sbPublic();
  const { data: p } = await db.from('products').select('id,title,description,gst_rate,return_window_days,is_returnable,category_id,vendor_id,specifications').eq('id', id).eq('status', 'active').maybeSingle();
  if (!p) return null;
  const [{ data: vars }, { data: media }, { data: avail }, { data: cat }] = await Promise.all([
    db.from('catalog_variants').select('variant_id,sku,attributes,mrp,selling_price,discount_pct,vendor_name').eq('product_id', id),
    db.from('product_media').select('url,alt_text').eq('product_id', id).order('sort_order'),
    db.rpc('variant_availability', { p_product: id }),
    db.from('categories').select('name,return_window_days').eq('id', p.category_id).maybeSingle(),
  ]);
  if (!vars?.length) return null;
  const stock = new Map((avail ?? []).map((a: any) => [a.variant_id, a.available]));
  return { p, cat, media: media ?? [], variants: vars.map((v: any) => ({ ...v, mrp: Number(v.mrp), selling_price: Number(v.selling_price), available: stock.get(v.variant_id) ?? 0 })) };
}
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const d = await load((await params).id);
  return d ? { title: d.p.title, description: (d.p.description ?? '').slice(0, 155) } : { title: 'Product' };
}
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const d = await load((await params).id);
  if (!d) notFound();
  const { p, media, variants, cat } = d;
  const days = p.return_window_days ?? cat?.return_window_days ?? 7;
  return (
    <div className="wrap pdp">
      <div className="gallery stack">
        {media.length ? media.map((m: any, i: number) => <img key={i} src={m.url} alt={m.alt_text || p.title} />) : <div className="panel muted">No photos yet</div>}
      </div>
      <div className="stack">
        <div><h1>{p.title}</h1><p className="muted">Sold by {variants[0].vendor_name}{cat ? ` in ${cat.name}` : ''}</p></div>
        <AddToCart variants={variants} />
        <div className="panel small">
          <p><strong>Returns:</strong> {p.is_returnable ? `Return within ${days} days of delivery.` : 'This item can’t be returned.'}</p>
          <p style={{ margin: 0 }}><strong>Price</strong> includes {Number(p.gst_rate)}% GST.</p>
        </div>
        {p.description && <div><h2>About this product</h2><p style={{ whiteSpace: 'pre-line' }}>{p.description}</p></div>}
      </div>
    </div>
  );
}
