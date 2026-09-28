'use client';
// Phone-style bottom navigation (shown on small screens only), same destinations the mobile app will have
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const T: [string, string, React.ReactNode][] = [
  ['/', 'Home', <path key="h" d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />],
  ['/categories', 'Categories', <g key="c"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></g>],
  ['/search?sort=discount', 'Deals', <g key="d"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></g>],
  ['/wishlist', 'Wishlist', <path key="w" d="M12 20s-7-4.4-8.8-8.6C2 8 4.1 5 7.3 5c1.9 0 3.4 1 4.7 2.8C13.3 6 14.8 5 16.7 5c3.2 0 5.3 3 4.1 6.4C19 15.6 12 20 12 20z" />],
  ['/account', 'Account', <g key="a"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></g>],
];
export function BottomNav() {
  const path = usePathname() ?? '/';
  const active = (href: string) => (href === '/' ? path === '/' : href === '/account' ? path === '/account' || (path.startsWith('/account') && !path.startsWith('/account/orders')) : path.startsWith(href.split('?')[0]) && href !== '/search?sort=discount' || (href === '/categories' && path.startsWith('/c/')));
  return (
    <nav className="bottom-nav" aria-label="Main">
      {T.map(([href, label, icon]) => (
        <Link key={href} href={href} className={active(href) ? 'on' : ''} aria-current={active(href) ? 'page' : undefined}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
          <span>{label}</span>
        </Link>))}
    </nav>);
}
