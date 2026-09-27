'use client';
// Browser-only helpers with no network code, so pages can use them without loading the Supabase client up front
export type GuestLine = { variant_id: string; qty: number; price: number };
const GK = 'shopeye.guestcart.v1', RK = 'shopeye.recent.v1', TTL = 30 * 864e5;   // guest cart kept 30 days
export const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
export const write = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const cartChanged = () => window.dispatchEvent(new Event('shopeye:cart'));
export function guestCart(): GuestLine[] {
  const g = read<{ at: number; lines: GuestLine[] }>(GK, { at: 0, lines: [] });
  if (!g.at || Date.now() - g.at > TTL) return [];
  return g.lines;
}
export function setGuestCart(lines: GuestLine[]) { write(GK, { at: Date.now(), lines: lines.filter((l) => l.qty > 0) }); cartChanged(); }
export const recentIds = (): string[] => read<string[]>(RK, []);
export function trackView(id: string) { write(RK, [id, ...recentIds().filter((x) => x !== id)].slice(0, 30)); }
export function clearRecent() { write(RK, []); window.dispatchEvent(new Event('shopeye:recent')); }
// A signed-in browser carries the Supabase auth cookie; without it there is nothing to fetch for the shopper
export const hasSession = () => typeof document !== 'undefined' && /(?:^|; )sb-[a-z0-9]+-auth-token/.test(document.cookie);
// Run after the page has painted and the main thread is free
export const whenIdle = (fn: () => void) => (typeof window !== 'undefined' && 'requestIdleCallback' in window)
  ? (window as any).requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 200);
