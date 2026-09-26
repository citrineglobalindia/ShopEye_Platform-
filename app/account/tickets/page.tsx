// SRS: CUST-FR-138 (customer sees ticket reference and status)
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sbServer } from '@/lib/sb-server';
import { StatusChip } from '@/components/Status';
import { Crumbs } from '@/components/Crumbs';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'My help requests', robots: { index: false } };
export default async function Tickets() {
  const db = await sbServer(); const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login?next=/account/tickets');
  const { data: t } = await db.from('support_tickets').select('id,ticket_number,category,subject,message,status,created_at,updated_at,order_id').eq('customer_id', user.id).order('created_at', { ascending: false });
  return (
    <div className="wrap section stack" style={{ maxWidth: 880 }}>
      <Crumbs items={[['Home', '/'], ['My account', '/account'], ['Help requests']]} />
      <div className="order-head"><h1 style={{ margin: 0 }}>My help requests</h1><Link className="btn sm" href="/support/new">New request</Link></div>
      {!t?.length ? <div className="panel empty">You haven’t contacted us yet. <Link href="/help">See common answers</Link>.</div>
        : t.map((x: any) => (
          <details key={x.id} className="panel">
            <summary className="pkg-head"><span><strong>{x.ticket_number}</strong> · {x.subject}</span><StatusChip s={x.status} /></summary>
            <p className="small muted">Sent {new Date(x.created_at).toLocaleString('en-IN')}{x.order_id ? <> about <Link href={`/account/orders/${x.order_id}`}>an order</Link></> : ''}. Last update {new Date(x.updated_at).toLocaleString('en-IN')}.</p>
            <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{x.message}</p>
          </details>))}
    </div>);
}
