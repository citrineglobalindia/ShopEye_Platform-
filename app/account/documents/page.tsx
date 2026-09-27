// SRS: CUST-FR-097 (every tax invoice and credit note stays available to the buyer for the retention period, 8 years from issue)
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sbServer } from '@/lib/sb-server';
import { inr } from '@/lib/config';
import { Crumbs } from '@/components/Crumbs';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoices and documents', robots: { index: false } };

export default async function Documents() {
  const db = await sbServer(); const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login?next=/account/documents');
  const { data: docs } = await db.from('invoices').select('id,kind,number,order_id,issued_at,total,doc_key,retain_until,supplier,orders(order_number)')
    .eq('customer_id', user.id).order('issued_at', { ascending: false }).limit(500);
  const d = (x: string) => new Date(x).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="wrap section stack" style={{ maxWidth: 880 }}>
      <Crumbs items={[['Home', '/'], ['My account', '/account'], ['Invoices']]} />
      <h1 style={{ margin: 0 }}>Invoices and credit notes</h1>
      <p className="muted" style={{ margin: 0 }}>Each seller issues its own tax invoice when your package ships. Documents stay here for 8 years from the date they were issued.</p>
      {!docs?.length ? <div className="panel empty">No invoices yet. They appear once an order ships.</div> : (
        <div className="panel tablewrap" tabIndex={0} role="region" aria-label="Invoices (scrolls sideways on small screens)"><table>
          <thead><tr><th>Document</th><th>Order</th><th>Seller</th><th>Date</th><th>Amount</th><th>Kept until</th><th></th></tr></thead>
          <tbody>{docs.map((x: any) => (
            <tr key={x.id}><td>{x.kind === 'credit_note' ? 'Credit note' : 'Tax invoice'} {x.number}</td>
              <td><Link href={`/account/orders/${x.order_id}`}>{x.orders?.order_number}</Link></td><td>{x.supplier?.trade_name ?? x.supplier?.legal_name}</td>
              <td>{d(x.issued_at)}</td><td>{x.kind === 'credit_note' ? '−' : ''}{inr(x.total)}</td><td>{d(x.retain_until)}</td>
              <td><a className="btn ghost sm" href={`/api/invoices/${x.id}?k=${x.doc_key}`} target="_blank" rel="noopener">PDF</a></td></tr>))}</tbody>
        </table></div>)}
    </div>);
}
