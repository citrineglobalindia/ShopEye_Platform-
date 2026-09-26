import './globals.css';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Mark } from '@/components/Logo';
import { sbServer } from '@/lib/sb-server';
import { listCategories } from '@/lib/catalog';

export const metadata: Metadata = {
  title: { default: 'Shopeye — shop from independent Indian sellers', template: '%s | Shopeye' },
  description: 'A marketplace of independent Indian sellers. Secure payments, tracked delivery and easy returns.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await sbServer();
  const [{ data: { user } }, cats] = await Promise.all([supabase.auth.getUser(), listCategories()]);
  let roles: string[] = [];
  if (user) { const { data } = await supabase.rpc('my_roles'); roles = data ?? []; }
  const isSeller = roles.some((r) => r === 'vendor_owner' || r === 'vendor_staff');
  const isAdmin = roles.includes('super_admin') || roles.includes('catalog_moderator');
  return (
    <html lang="en-IN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Hanken+Grotesk:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <a href="#main" className="small" style={{ position: 'absolute', left: -9999 }}>Skip to content</a>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="brand" aria-label="Shopeye home"><Mark /> Shopeye</Link>
            <form action="/search" className="search" role="search">
              <input name="q" placeholder="Search kurtas, sarees, handloom…" aria-label="Search products" />
              <button type="submit">Search</button>
            </form>
            <nav className="nav" aria-label="Account">
              {isAdmin && <Link href="/admin">Admin</Link>}
              <Link href="/seller">{isSeller ? 'Seller hub' : 'Sell on Shopeye'}</Link>
              {user ? <Link href="/account/orders">Orders</Link> : <Link href="/login">Sign in</Link>}
              <Link href="/cart">Cart</Link>
            </nav>
          </div>
        </header>
        {cats.length > 0 && (
          <nav className="cats" aria-label="Categories"><div className="wrap">
            {cats.filter((c: any) => !c.parent_id).map((c: any) => <Link key={c.id} href={`/c/${c.slug}`}>{c.name}</Link>)}
          </div></nav>
        )}
        <main id="main">{children}</main>
        <footer className="foot"><div className="wrap">
          <span>© {new Date().getFullYear()} Shopeye</span>
          <span>Prices include GST. Payments are processed securely by Razorpay.</span>
          {user && <a href="/auth/signout">Sign out</a>}
        </div></footer>
      </body>
    </html>
  );
}
