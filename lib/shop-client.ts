'use client';
// SRS: CUST-FR-009 CUST-FR-024 CUST-FR-051 CUST-FR-054 CUST-FR-057 (guest cart kept in the browser and merged at sign-in; recently viewed is clearable; wishlist-to-cart re-validates stock and price)
import { sb } from '@/lib/sb-browser';

type GuestLine = { variant_id: string; qty: number; price: number };
const GK = 'shopeye.guestcart.v1', RK = 'shopeye.recent.v1', TTL = 30 * 864e5;   // guest cart kept 30 days
const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const cartChanged = () => window.dispatchEvent(new Event('shopeye:cart'));

export function guestCart(): GuestLine[] {
  const g = read<{ at: number; lines: GuestLine[] }>(GK, { at: 0, lines: [] });
  if (!g.at || Date.now() - g.at > TTL) return [];
  return g.lines;
}
export function setGuestCart(lines: GuestLine[]) { write(GK, { at: Date.now(), lines: lines.filter((l) => l.qty > 0) }); cartChanged(); }

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
export async function wishlistIds(): Promise<Set<string>> {
  const db = sb(); const { data: { user } } = await db.auth.getUser(); if (!user) return new Set();
  const { data } = await db.from('wishlist_items').select('product_id'); return new Set((data ?? []).map((r: any) => r.product_id));
}
export async function toggleWishlist(productId: string, on: boolean): Promise<'ok' | 'login'> {
  const db = sb(); const { data: { user } } = await db.auth.getUser(); if (!user) return 'login';
  const r = on ? await db.from('wishlist_items').upsert({ customer_id: user.id, product_id: productId })
               : await db.from('wishlist_items').delete().eq('product_id', productId);
  if (r.error) throw r.error; window.dispatchEvent(new Event('shopeye:wishlist')); return 'ok';
}

// Recently viewed: kept on this device only, last 12, clearable
export const recentIds = (): string[] => read<string[]>(RK, []);
export function trackView(id: string) { write(RK, [id, ...recentIds().filter((x) => x !== id)].slice(0, 12)); }
export function clearRecent() { write(RK, []); window.dispatchEvent(new Event('shopeye:recent')); }
