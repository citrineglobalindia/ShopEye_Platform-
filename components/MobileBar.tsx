'use client';
// Phone app bar (CLiQ style): home shows the logo; inner pages show ‹ back, the page title and product count
// (read from the page's [data-mtitle] heading), plus search, wishlist and bag icons.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { guestCart } from '@/lib/local-store';
const Svg = ({ children }: { children: React.ReactNode }) => <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
export function MobileBar({ serverCount, signedIn, logo }: { serverCount: number; signedIn: boolean; logo: React.ReactNode }) {
  const path = usePathname() ?? '/'; const router = useRouter();
  const [title, setTitle] = useState(''); const [count, setCount] = useState(''); const [n, setN] = useState(serverCount);
  const home = path === '/';
  useEffect(() => {
    const read = () => { const h = document.querySelector<HTMLElement>('[data-mtitle]'); setTitle(h?.dataset.mtitle || h?.textContent?.trim() || ''); setCount(h?.dataset.mcount || document.querySelector<HTMLElement>('[data-mcount]')?.dataset.mcount || ''); };
    // highlight the current department in the tab strip
    document.querySelectorAll<HTMLAnchorElement>('.cats-row > a').forEach((a) => { const on = path === a.getAttribute('href') || path.startsWith(a.getAttribute('href') + '/'); if (on) { a.setAttribute('aria-current', 'page'); a.scrollIntoView({ inline: 'center', block: 'nearest' }); } else a.removeAttribute('aria-current'); });
    read(); const t = setTimeout(read, 400); const mo = new MutationObserver(read); mo.observe(document.body, { childList: true, subtree: true });
    const stop = setTimeout(() => mo.disconnect(), 3000);
    return () => { clearTimeout(t); clearTimeout(stop); mo.disconnect(); };
  }, [path]);
  // App-style header on phones: slides away while scrolling down the page, comes back as soon as you scroll up.
  // One passive listener, work batched into animation frames, only a class toggle (transform-only animation).
  useEffect(() => {
    if (!window.matchMedia('(max-width: 860px)').matches) return;
    let lastY = window.scrollY, ticking = false, hidden = false;
    const root = document.documentElement;
    const on = () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY, dy = y - lastY;
        const busy = document.body.classList.contains('sheet-open') || document.body.classList.contains('gate-open') || !!document.querySelector('.sug');
        const hide = !busy && y > 160 && dy > 6 ? true : dy < -6 || y < 80 ? false : hidden;
        if (hide !== hidden) { hidden = hide; root.classList.toggle('hdr-hide', hide); }
        if (Math.abs(dy) > 6) lastY = y; ticking = false;
      });
    };
    window.addEventListener('scroll', on, { passive: true });
    return () => { window.removeEventListener('scroll', on); root.classList.remove('hdr-hide'); };
  }, [path]);
  useEffect(() => {
    const upd = () => { if (!signedIn) setN(guestCart().reduce((s, l) => s + l.qty, 0)); };
    upd(); window.addEventListener('shopeye:cart', upd); return () => window.removeEventListener('shopeye:cart', upd);
  }, [signedIn]);
  useEffect(() => { if (signedIn) setN(serverCount); }, [serverCount, signedIn]);
  const inner = !home;
  return (
    <div className="mbar">
      {inner ? <button type="button" className="mbar-back" aria-label="Back" onClick={() => (history.length > 1 ? router.back() : router.push('/'))}><Svg><path d="m15 5-7 7 7 7" /></Svg></button> : null}
      <Link href="/" className="mbar-logo" aria-label="ShopEye home">{logo}</Link>
      {inner && title ? <div className="mbar-title"><strong>{title}</strong>{count && <span>{count}</span>}</div> : <span className="mbar-fill" />}
      {inner && <Link href="/search" className="mbar-i" aria-label="Search"><Svg><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg></Link>}
      <Link href="/wishlist" className="mbar-i" aria-label="Wishlist"><Svg><path d="M12 20s-7-4.4-8.8-8.6C2 8 4.1 5 7.3 5c1.9 0 3.4 1 4.7 2.8C13.3 6 14.8 5 16.7 5c3.2 0 5.3 3 4.1 6.4C19 15.6 12 20 12 20z" /></Svg></Link>
      <Link href="/cart" className="mbar-i" aria-label={`Bag, ${n} item${n === 1 ? '' : 's'}`}><Svg><path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V7a3 3 0 0 1 6 0v1" /></Svg>{n > 0 && <b className="mbar-badge">{n > 99 ? '99+' : n}</b>}</Link>
    </div>);
}
