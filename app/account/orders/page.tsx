// SRS: CUST-FR-167 (the table scrolls sideways inside its own labelled, keyboard-focusable panel on phones; the page itself never scrolls sideways)
// SRS: CUST-FR-094 (order history readable from snapshots)
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sbServer } from '@/lib/sb-server';
import { inr } from '@/lib/config';
import { StatusChip } from '@/components/Status';
import { Crumbs } from '@/components/Crumbs';
export const metadata = { title: 'My orders', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function Orders() {
  const db = await sbServer(); const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login?next=/account/orders');
  const { data: orders } = await db.from('orders').select('id,order_number,placed_at,status,payment_status,grand_total').eq('customer_id', user.id).order('placed_at', { ascending: false }).limit(50);
  return (<div className="wrap section stack">
    <Crumbs items={[['Home', '/'], ['My account', '/account'], ['My orders']]} />
    <h1>My orders</h1>
    {!orders?.length ? <div className="panel"><p>You haven’t placed an order yet.</p><Link className="btn" href="/">Start shopping</Link></div> : (
      <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Your orders (scrolls sideways on small screens)"><table>
        <thead><tr><th>Order</th><th>Placed</th><th>Status</th><th>Payment</th><th>Total</th></tr></thead>
        <tbody>{orders.map((o: any) => (<tr key={o.id}>
          <td><Link href={`/account/orders/${o.id}`}><strong>{o.order_number}</strong></Link></td>
          <td>{new Date(o.placed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
          <td><StatusChip s={o.status} /></td><td><StatusChip s={o.payment_status} /></td><td>{inr(o.grand_total)}</td></tr>))}</tbody>
      </table></div>)}
  </div>);
}
