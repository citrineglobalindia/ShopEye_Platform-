// SRS: CUST-FR-001 CUST-FR-002 CUST-FR-003 CUST-FR-004 (logo, categories, search, account, wishlist, cart with live count; mobile drawer keeps search and cart reachable)
import Link from 'next/link';
import { Mark } from '@/components/Logo';
import { CartLink } from '@/components/ShopWidgets';
import { DeliverTo } from '@/components/DeliverTo';

type Cat = { id: string; name: string; slug: string; parent_id: string | null };
const I = {
  box: <path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" />,
  heart: <path d="M12 21s-7.5-4.6-9.5-9.2C1 8 3.3 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.7 0 6 3.5 4.5 7.3C19.5 16.4 12 21 12 21z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
};
const Icon = ({ d }: { d: React.ReactNode }) => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;

export function Header({ user, cartCount, isSeller, isAdmin, cats }: { user: { email?: string; name?: string } | null; cartCount: number; isSeller: boolean; isAdmin: boolean; cats: Cat[] }) {
  const top = cats.filter((c) => !c.parent_id);
  const kids = (id: string) => cats.filter((c) => c.parent_id === id);
  const first = (user?.name || user?.email || '').split(/[\s@]/)[0];
  return (
    <header className="top">
      <div className="wrap top-row">
        <details className="drawer">
          <summary aria-label="Open menu"><span className="burger" aria-hidden="true" /></summary>
          <nav className="drawer-panel" aria-label="Menu">
            <strong className="small muted">Shop by category</strong>
            {top.map((c) => <Link key={c.id} href={`/c/${c.slug}`}>{c.name}</Link>)}
            <hr />
            {user ? <><Link href="/account">My account</Link><Link href="/account/orders">My orders</Link><Link href="/wishlist">Wishlist</Link><Link href="/account/tickets">My help requests</Link></>
              : <Link href="/login">Sign in</Link>}
            <Link href="/seller">{isSeller ? 'Seller hub' : 'Sell on ShopEye'}</Link>
            {isAdmin && <Link href="/admin">Admin</Link>}
            <Link href="/help">Help centre</Link>
          </nav>
        </details>
        <Link href="/" className="brand" aria-label="ShopEye home"><Mark /></Link>
        <form action="/search" className="search" role="search">
          <input name="q" placeholder="Search for products, brands and more" aria-label="Search products" />
          <button type="submit" aria-label="Search"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></button>
        </form>
        <DeliverTo />
        <nav className="nav" aria-label="Account">
          <Link href="/account/orders" className="nav-i hide-sm"><Icon d={I.box} /><span>Orders</span></Link>
          <Link href="/wishlist" className="nav-i hide-sm"><Icon d={I.heart} /><span>Wishlist</span></Link>
          <CartLink serverCount={cartCount} signedIn={!!user} />
          <details className="acct hide-sm">
            <summary className="nav-i"><Icon d={I.user} /><span>{user ? `Hi, ${first}` : 'Account'}</span></summary>
            <div className="acct-menu panel">
              {user ? <><Link href="/account">My account</Link><Link href="/account/orders">My orders</Link><Link href="/account/balance">ShopEye balance</Link><Link href="/account/tickets">Help requests</Link></>
                : <Link href="/login">Sign in or create account</Link>}
              <Link href="/seller">{isSeller ? 'Seller hub' : 'Sell on ShopEye'}</Link>
              {isAdmin && <Link href="/admin">Admin</Link>}
            </div>
          </details>
        </nav>
      </div>
      {top.length > 0 && (
        <nav className="cats" aria-label="Categories"><div className="wrap cats-row">
          <details className="mega">
            <summary><span className="burger sm" aria-hidden="true" /> All Categories</summary>
            <div className="mega-panel">
              {top.map((d) => (
                <div key={d.id} className="mega-col">
                  <Link href={`/c/${d.slug}`} className="mega-h">{d.name}</Link>
                  {kids(d.id).map((c) => <Link key={c.id} href={`/c/${c.slug}`}>{c.name}</Link>)}
                </div>))}
            </div>
          </details>
          {top.map((c) => <Link key={c.id} href={`/c/${c.slug}`}>{c.name}</Link>)}
        </div></nav>)}
    </header>
  );
}
