'use client';
// SRS: CUST-FR-187 (cookie choice banner; Google Analytics loads only after "Accept"; Consent Mode defaults to denied and ads
// storage is never granted; Core Web Vitals from real visits are reported as events, only with consent)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import { GA_ID, readConsent, writeConsent, track, type Consent } from '@/lib/analytics';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/lib/config';

// SRS: CUST-FR-153 (real-visitor Core Web Vitals: page type + device class only, sent when the page is hidden)
const pageType = (p: string) => p === '/' ? 'home' : p.startsWith('/p/') ? 'product' : p.startsWith('/c/') ? 'category' : p.startsWith('/search') ? 'search'
  : p.startsWith('/cart') ? 'cart' : p.startsWith('/checkout') ? 'checkout' : p.startsWith('/account') ? 'account' : p.startsWith('/store/') ? 'store' : 'other';
let vq: { _k?: string; metric: string; value: number; page: string; device: string; conn?: string }[] = []; let hooked = false; const seen = new Set<string>();
function flushVitals() {
  if (!vq.length) return; const rows = vq.splice(0, 8).map(({ _k, ...r }: any) => r);
  try {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/record_vitals`, { method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` }, body: JSON.stringify({ p_rows: rows }) }).catch(() => {});
  } catch {}
}
function queueVital(id: string, name: string, value: number, path: string) {
  if (typeof window === 'undefined' || (navigator as any).webdriver || !['LCP', 'INP', 'CLS', 'FCP', 'TTFB'].includes(name)) return;
  const key = name; void id; const prev = vq.findIndex((x: any) => x._k === key);
  if (prev >= 0) vq.splice(prev, 1); else if (seen.has(key)) return;   // one value per metric per page view (latest wins)
  seen.add(key);
  const conn = (navigator as any).connection?.effectiveType;
  vq.push({ _k: key, metric: name, value: Math.round(value * (name === 'CLS' ? 10000 : 1)) / (name === 'CLS' ? 10000 : 1), page: pageType(path),
            device: window.matchMedia('(max-width: 860px)').matches ? 'mobile' : 'desktop', ...(conn ? { conn } : {}) });
  if (!hooked) { hooked = true; addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushVitals()); addEventListener('pagehide', flushVitals); }
  if (vq.length >= 8) flushVitals();
}
function loadGa() {
  const w = window as any;
  if (!GA_ID || w.__seGa) return; w.__seGa = true;
  w.dataLayer = w.dataLayer || []; w.gtag = function () { w.dataLayer.push(arguments); };
  w.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  w.gtag('consent', 'update', { analytics_storage: 'granted' });
  w.gtag('js', new Date());
  w.gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false, send_page_view: false });
  const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`; document.head.appendChild(s);
}

export function Analytics() {
  const [consent, setConsent] = useState<Consent | 'unknown'>('unknown'); const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => {
    const c = readConsent(); setConsent(c); if (c === 'analytics') loadGa();
    const onChange = (e: any) => { setConsent(e.detail); if (e.detail === 'analytics') loadGa(); };
    const reopen = () => setOpen(true);
    window.addEventListener('se-consent', onChange); window.addEventListener('se-cookie-settings', reopen);
    return () => { window.removeEventListener('se-consent', onChange); window.removeEventListener('se-cookie-settings', reopen); };
  }, []);
  // Page views: path only; query strings (search terms, order ids) are never sent as the page location
  useEffect(() => { if (consent === 'analytics') track('page_view', { page_path: path, page_location: location.origin + path, page_title: document.title }); }, [path, consent]);
  useReportWebVitals((m) => {
    track('web_vital', { metric_name: m.name, value: Math.round(m.name === 'CLS' ? m.value * 1000 : m.value), metric_rating: (m as any).rating, page_path: path });
    queueVital(m.id, m.name, m.value, path);   // first-party, anonymous real-visitor speed (no consent needed: no identifiers)
  });
  if (!GA_ID || consent === 'unknown' || (consent !== null && !open)) return null;   // nothing to ask when GA isn't configured
  function choose(c: 'analytics' | 'necessary') {
    const was = readConsent(); writeConsent(c); setConsent(c); setOpen(false);
    if (was === 'analytics' && c === 'necessary') location.reload();   // unload GA completely after withdrawing consent
  }
  return (
    <div className="consent" role="dialog" aria-modal="false" aria-labelledby="consent-h">
      <div className="wrap consent-in">
        <div><strong id="consent-h">Cookies on ShopEye</strong>
          <p className="small" style={{ margin: '4px 0 0' }}>We use essential cookies to keep you signed in and remember your cart. With your permission we’d also use Google Analytics to understand how the site is used. It never receives your name, email or address. <Link href="/privacy">Privacy policy</Link></p></div>
        <div className="cta-row"><button className="btn sm" onClick={() => choose('analytics')}>Accept analytics</button><button className="btn ghost sm" onClick={() => choose('necessary')}>Essential only</button></div>
      </div>
    </div>);
}
export function CookieSettingsLink() {
  if (!GA_ID) return null;
  return <button className="linklike foot-signout" onClick={() => window.dispatchEvent(new Event('se-cookie-settings'))}>Cookie settings</button>;
}

// Fires one analytics event when mounted (no-op without consent)
export function TrackEvent({ name, params }: { name: string; params: Record<string, any> }) {
  useEffect(() => { track(name, params); }, [name, JSON.stringify(params)]);
  return null;
}
// Search: the (scrubbed) term and result count, plus which result was clicked (CUST-FR-034)
export function TrackSearch({ q, count }: { q: string; count: number }) {
  useEffect(() => {
    if (q) track('search', { search_term: q, result_count: count });
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href^="/p/"]') as HTMLAnchorElement | null;
      if (a && q) track('select_item', { item_list_name: 'search', search_term: q, items: [{ item_id: a.getAttribute('href')!.slice(3) }] });
    };
    document.addEventListener('click', onClick); return () => document.removeEventListener('click', onClick);
  }, [q, count]);
  return null;
}
// After checkout: hand the consented GA client id to the server, which sends the purchase once payment is confirmed (CUST-FR-186)
export function OrderAnalytics({ orderId }: { orderId: string }) {
  useEffect(() => { (async () => {
    const { gaClientId } = await import('@/lib/analytics'); const id = await gaClientId(); if (!id) return;
    const { sb } = await import('@/lib/sb-browser'); await sb().rpc('set_order_analytics', { p_order: orderId, p_client_id: id });
  })(); }, [orderId]);
  return null;
}
