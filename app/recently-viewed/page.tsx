// Everything viewed on this device (kept locally, clearable), newest first
import Link from 'next/link';
import { Crumbs } from '@/components/Crumbs';
import { RecentlyViewed } from '@/components/ShopWidgets';
import { MobileTitle } from '@/components/MobileTitle';
export const metadata = { title: 'Recently viewed', robots: { index: false } };
export default function Page() {
  return (
    <div className="wrap section stack">
      <MobileTitle title="Recently viewed" />
      <Crumbs items={[['Home', '/'], ['Recently viewed']]} />
      <h1 className="page-h1" style={{ margin: 0 }}>Recently viewed</h1>
      <p className="muted" style={{ margin: 0 }}>The last products you opened on this device. Only you can see this list.</p>
      <RecentlyViewed grid emptyNote={<div className="panel empty"><h3>Nothing here yet</h3><p className="muted">Products you open will appear here. <Link href="/">Start browsing</Link>.</p></div>} />
    </div>);
}
