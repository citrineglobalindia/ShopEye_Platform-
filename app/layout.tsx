import './globals.css';
import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { GuestCartMerge } from '@/components/ShopWidgets';
import { sbServer } from '@/lib/sb-server';
import { listCategories, FIXTURES } from '@/lib/catalog';

export const viewport = { themeColor: '#021A53' };
export const metadata: Metadata = {
  metadataBase: new URL('https://www.shopeye.in'),
  title: { default: 'ShopEye — shop from independent Indian sellers', template: '%s | ShopEye' },
  description: 'A marketplace of independent Indian sellers. Every listing reviewed, secure payments, tracked delivery and easy returns.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await sbServer();
  const [{ data: { user } }, cats] = await Promise.all([supabase.auth.getUser(), listCategories()]);
  let roles: string[] = []; let cartCount = 0; let name: string | undefined;
  if (user) {
    const [{ data: r }, { data: prof }, { data: cart }] = await Promise.all([
      supabase.rpc('my_roles'), supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
      supabase.from('carts').select('id').eq('customer_id', user.id).eq('status', 'active').maybeSingle()]);
    roles = r ?? []; name = prof?.full_name;
    if (cart) { const { data: items } = await supabase.from('cart_items').select('qty').eq('cart_id', cart.id).eq('saved_for_later', false); cartCount = (items ?? []).reduce((s: number, i: any) => s + i.qty, 0); }
  }
  if (FIXTURES && !user) cartCount = 2;
  return (
    <html lang="en-IN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Hanken+Grotesk:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <Header user={user ? { email: user.email, name } : null} cartCount={cartCount} cats={cats as any}
          isSeller={roles.some((r) => r === 'vendor_owner' || r === 'vendor_staff')} isAdmin={roles.includes('super_admin') || roles.includes('catalog_moderator')} />
        <GuestCartMerge signedIn={!!user} />
        <main id="main">{children}</main>
        <Footer signedIn={!!user} />
      </body>
    </html>
  );
}
