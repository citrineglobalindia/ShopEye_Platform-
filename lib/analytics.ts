'use client';
// SRS: CUST-FR-034 CUST-FR-185 CUST-FR-187 CUST-FR-188 (events only after analytics consent; search terms and every parameter scrubbed of
// emails, phone numbers, codes and card-like numbers; no user id, name, email or address is ever sent; ads signals off)
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || '';
export const CONSENT_COOKIE = 'se_consent';
export type Consent = 'analytics' | 'necessary' | null;

export function readConsent(): Consent {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|; )se_consent=(analytics|necessary)/); return (m?.[1] as Consent) ?? null;
}
export function writeConsent(c: 'analytics' | 'necessary') {
  document.cookie = `${CONSENT_COOKIE}=${c}; Max-Age=${180 * 86400}; Path=/; SameSite=Lax; Secure`;
  window.dispatchEvent(new CustomEvent('se-consent', { detail: c }));
}
const BLOCKED_KEYS = /(e-?mail|phone|mobile|name|address|pincode|user_?id|customer|gstin|otp|token|password)/i;
export function scrub(v: string): string {
  return String(v).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').replace(/\d(?:[\s-]?\d){5,}/g, '[number]').slice(0, 100);
}
function clean(params: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    if ((BLOCKED_KEYS.test(k) && !/^(item_name|item_list_name|metric_name)$/.test(k)) || v == null) continue;
    if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'object' ? clean(x) : typeof x === 'string' ? scrub(x) : x));
    else out[k] = typeof v === 'string' && !/^(item_id|item_name|currency|transaction_id|item_list_name)$/.test(k) ? scrub(v) : v;
  }
  return out;
}
export function track(event: string, params: Record<string, any> = {}) {
  if (!GA_ID || readConsent() !== 'analytics' || typeof window === 'undefined' || !(window as any).gtag) return;
  (window as any).gtag('event', event, clean(params));
}
// GA client id, only when consented (used to attribute the server-side purchase event, CUST-FR-186)
export function gaClientId(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!GA_ID || readConsent() !== 'analytics' || !(window as any).gtag) return resolve(null);
    const t = setTimeout(() => resolve(null), 2000);
    (window as any).gtag('get', GA_ID, 'client_id', (id: string) => { clearTimeout(t); resolve(id || null); });
  });
}
