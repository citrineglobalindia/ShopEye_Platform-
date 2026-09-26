// Local design-preview catalogue. Only used when SHOPEYE_FIXTURES=1 (never set on Vercel).
const tile = (a: string, b: string, label: string) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="500" fill="url(#g)"/><path d="M130 150 L270 150 L300 420 L100 420 Z" fill="rgba(255,255,255,.18)"/><circle cx="200" cy="120" r="34" fill="rgba(255,255,255,.22)"/><text x="200" y="470" font-family="sans-serif" font-size="22" fill="rgba(255,255,255,.85)" text-anchor="middle">${label}</text></svg>`);
export const FIX_CATS = [
  { id: 'c1', name: 'Sarees', slug: 'sarees', parent_id: null }, { id: 'c2', name: 'Kurtas', slug: 'kurtas', parent_id: null },
  { id: 'c3', name: 'Dupattas', slug: 'dupattas', parent_id: null }, { id: 'c4', name: 'Menswear', slug: 'menswear', parent_id: null },
  { id: 'c5', name: 'Home & Decor', slug: 'home-decor', parent_id: null }, { id: 'c6', name: 'Jewellery', slug: 'jewellery', parent_id: null },
];
const P = (i: number, title: string, cat: string, price: number, mrp: number, vendor: string, a: string, b: string, label: string) =>
  ({ product_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title, category_id: cat, selling_price: price, mrp, discount_pct: Math.round((100 * (mrp - price)) / mrp), vendor_name: vendor, image: tile(a, b, label), in_stock: i !== 4, published_at: `2026-09-${String(26 - i).padStart(2, '0')}` });
export const FIX_PRODUCTS = [
  P(1, 'Kanchipuram Silk Saree with Zari Border', 'c1', 12499, 16999, 'Mysore Silk House', '#6B1D3A', '#C0395E', 'Silk saree'),
  P(2, 'Handloom Cotton Kurta, Indigo Block Print', 'c2', 999, 1499, 'Citrine Weaves', '#0B3A8C', '#3F7BD8', 'Cotton kurta'),
  P(3, 'Chanderi Dupatta with Gota Patti', 'c3', 1299, 1899, 'Kolar Handlooms', '#0F6B5B', '#2FB18F', 'Dupatta'),
  P(4, 'Linen Nehru Jacket', 'c4', 2499, 3299, 'Bengaluru Tailors', '#3B3B3B', '#7A7A7A', 'Nehru jacket'),
  P(5, 'Channapatna Wooden Toy Set', 'c5', 749, 899, 'Channapatna Crafts', '#B45309', '#F59E0B', 'Wooden toys'),
  P(6, 'Oxidised Silver Jhumkas', 'c6', 599, 999, 'Jaipur Jewel Box', '#475569', '#94A3B8', 'Jhumkas'),
  P(7, 'Ikat Cotton Saree', 'c1', 3299, 3999, 'Pochampally Looms', '#7C2D12', '#EA580C', 'Ikat saree'),
  P(8, 'Chikankari Straight Kurta', 'c2', 1899, 2499, 'Lucknow Threads', '#E5E7EB', '#9CA3AF', 'Chikankari'),
  P(9, 'Kalamkari Cushion Covers (Set of 2)', 'c5', 899, 1199, 'Srikalahasti Studio', '#1E3A8A', '#B45309', 'Cushions'),
  P(10, 'Bandhani Silk Dupatta', 'c3', 1599, 2199, 'Kutch Colours', '#9D174D', '#F472B6', 'Bandhani'),
  P(11, 'Khadi Cotton Shirt', 'c4', 1199, 1499, 'Khadi Collective', '#14532D', '#4ADE80', 'Khadi shirt'),
  P(12, 'Temple Gold-Plated Necklace', 'c6', 2799, 3999, 'Jaipur Jewel Box', '#78350F', '#FBBF24', 'Necklace'),
];
export const FIX_PDP = (id: string) => {
  const p = FIX_PRODUCTS.find((x) => x.product_id === id); if (!p) return null;
  const cat = FIX_CATS.find((c) => c.id === p.category_id)!;
  return { p: { id, title: p.title, description: `${p.title}. Made by ${p.vendor_name}.\n\nHand-finished and checked by the ShopEye team before listing. Colours may vary slightly from the photos because every piece is handmade.`, gst_rate: 5, return_window_days: 7, is_returnable: true, category_id: cat.id, vendor_id: 'v', specifications: { Material: 'Handloom cotton', Care: 'Dry clean or gentle hand wash', Origin: 'India' } },
    cat: { name: cat.name, slug: cat.slug, return_window_days: 7 }, media: [0, 1, 2].map((k) => ({ url: p.image.replace('rgba(255,255,255,.18)', `rgba(255,255,255,${0.12 + k * 0.08})`), alt_text: p.title })),
    variants: ['S', 'M', 'L', 'XL'].map((s, k) => ({ variant_id: `${id}-${s}`, sku: `FX-${s}`, attributes: { size: s }, mrp: p.mrp, selling_price: p.selling_price, discount_pct: p.discount_pct, vendor_name: p.vendor_name, available: k === 3 ? 0 : 6 - k })) };
};
