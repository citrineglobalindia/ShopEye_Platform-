'use client';
// SRS: CUST-FR-009 CUST-FR-024 CUST-FR-051 CUST-FR-054 CUST-FR-057 (guest cart kept in the browser and merged at sign-in; recently viewed is clearable; wishlist-to-cart re-validates stock and price)
import { sb } from '@/lib/sb-browser';

import { guestCart, setGuestCart, cartChanged, recentIds } from '@/lib/local-store';
export { guestCart, setGuestCart, cartChanged, recentIds, trackView, clearRecent } from '@/lib/local-store';

export async function addToCart(variantId: string, qty: number, price: number): Promise<'ok'> {
  const db = sb(); const { data: { user } } = await db.auth.getUser();
  if (!user) {
    const lines = guestCart(); const ex = lines.find((l) => l.variant_id === variantId);
    if (ex) ex.qty = Math.min(ex.qty + qty, 10); else lines.push({ variant_id: variantId, qty, price });
    setGuestCart(lines); return 'ok';
  }
  let { data: cart } = await db.from('carts').select('id').eq('customer_id', user.id).eq('status', 'active').maybeSingle();
  if (!cart) { const r = await db.from('carts').insert({ customer_id: user.id }).select('id').single(); if (r.error) throw r.error; cart = r.data; }
  const { data: existing } = await db.from('cart_items').select('id,qty').eq('cart_id', cart.id).eq('variant_id', variantId).eq('saved_for_later', false).maybeSingle();
  const r = existing ? await db.from('cart_items').update({ qty: Math.min(existing.qty + qty, 10) }).eq('id', existing.id)
                     : await db.from('cart_items').insert({ cart_id: cart.id, variant_id: variantId, qty, price_at_add: price });
  if (r.error) throw r.error;
  cartChanged(); return 'ok';
}
// Called once after sign-in: moves the browser cart into the account cart (current price is re-checked at checkout)
export async function mergeGuestCart() {
  const lines = guestCart(); if (!lines.length) return 0;
  const { data: { user } } = await sb().auth.getUser(); if (!user) return 0;
  let n = 0; for (const l of lines) { try { await addToCart(l.variant_id, l.qty, l.price); n++; } catch {} }
  setGuestCart([]); return n;
}

// Wishlist (signed-in only; server-side, owner-only by row-level security)
// One shared lookup per page for every heart on it, refreshed when the wishlist changes (was one auth + query per product card)
let wishCache: Promise<Set<string>> | null = null;
if (typeof window !== 'undefined') window.addEventListener('shopeye:wishlist', () => { wishCache = null; });
export function wishlistIds(): Promise<Set<string>> {
  wishCache ??= (async () => {
    const db = sb(); const { data: { session } } = await db.auth.getSession(); if (!session) return new Set<string>();
    const { data } = await db.from('wishlist_items').select('product_id'); return new Set((data ?? []).map((r: any) => r.product_id));
  })();
  return wishCache;
}
export async function toggleWishlist(productId: string, on: boolean): Promise<'ok' | 'login'> {
  const db = sb(); const { data: { user } } = await db.auth.getUser(); if (!user) return 'login';
  const r = on ? await db.from('wishlist_items').upsert({ customer_id: user.id, product_id: productId })
               : await db.from('wishlist_items').delete().eq('product_id', productId);
  if (r.error) throw r.error; window.dispatchEvent(new Event('shopeye:wishlist')); return 'ok';
}

// Recently viewed lives in lib/local-store (device only, last 12, clearable)

// SRS: CUST-FR-063 (free-shipping progress only from the live rule the server charges by; hidden if it can't be read)
let shipCache: Promise<import('./config').ShipRules> | null = null;
export function shippingRules() {
  shipCache ??= (async () => {
    const { data, error } = await sb().rpc('shipping_rules');
    if (error || !data) { shipCache = null; return { ...(await import('./config')).SHIP_DEFAULT }; }
    return { flat: Number(data.flat_fee_per_vendor), free: Number(data.free_threshold_per_vendor), live: true };
  })();
  return shipCache;
}
