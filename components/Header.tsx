// SRS: CUST-FR-002 CUST-FR-003 CUST-FR-004 (cart count badge; sign-in vs account menu; mobile drawer keeps search and cart reachable)
import Link from 'next/link';
import { Mark } from '@/components/Logo';

type Cat = { id: string; name: string; slug: string; parent_id: string | null };
export function Header({ user, cartCount, isSeller, isAdmin, cats }: { user: { email?: string; name?: string } | null; cartCount: number; isSeller: boolean; isAdmin: boolean; cats: Cat[] }) {
  const top = cats.filter((c) => !c.parent_id);
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
            {user ? <><Link href="/account">My account</Link><Link href="/account/orders">My orders</Link></> : <Link href="/login">Sign in or create account</Link>}
            <Link href="/seller">{isSeller ? 'Seller hub' : 'Sell on ShopEye'}</Link>
            {isAdmin && <Link href="/admin">Admin</Link>}
            <Link href="/help">Help centre</Link>
          </nav>
        </details>
        <Link href="/" className="brand" aria-label="ShopEye home"><Mark /></Link>
        <form action="/search" className="search" role="search">
          <input name="q" placeholder="Search sarees, kurtas, handloom…" aria-label="Search products" />
          <button type="submit">Search</button>
        </form>
        <nav className="nav" aria-label="Account">
          {isAdmin && <Link href="/admin" className="hide-sm">Admin</Link>}
          <Link href="/seller" className="hide-sm">{isSeller ? 'Seller hub' : 'Sell'}</Link>
          {user ? <Link href="/account" className="hide-sm">Hi, {first}</Link> : <Link href="/login" className="hide-sm">Sign in</Link>}
          <Link href="/cart" className="cart-link" aria-label={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>
            <span>Cart</span>{cartCount > 0 && <b className="badge">{cartCount > 99 ? '99+' : cartCount}</b>}
          </Link>
        </nav>
      </div>
      {top.length > 0 && (
        <nav className="cats" aria-label="Categories"><div className="wrap">
          {top.map((c) => <Link key={c.id} href={`/c/${c.slug}`}>{c.name}</Link>)}
        </div></nav>)}
    </header>
  );
}
