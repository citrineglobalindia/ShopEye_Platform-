'use client';
// SRS: SA-FR-0040 SA-FR-0041 SA-FR-0042 (dashboard: today and 7-day sales, queues needing action, 14-day trend, recent orders)
import { useEffect, useState } from 'react';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { StatusChip } from '@/components/Status';

export function Dashboard({ go }: { go: (tab: string) => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  const load = () => sb().rpc('admin_dashboard').then(({ data, error }: any) => { if (error) setErr(friendly(error)); else setD(data); });
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  if (err) return <div className="msg err" role="alert">{err}</div>;
  if (!d) return <p className="muted">Loading dashboard…</p>;
  const max = Math.max(1, ...d.sales_14d.map((x: any) => Number(x.gmv)));
  const Q = ([['Seller applications', d.vendor_applications, 'vendors'], ['Listings to review', d.listings_to_review, 'products'], ['Open help requests', d.tickets_open, 'tickets'],
    ['Urgent help requests', d.tickets_urgent, 'tickets'], ['Reviews to moderate', d.reviews_pending, 'reviews'], ['Refunds pending', d.refunds_pending, 'orders'],
    ['Packages to ship', d.to_ship, 'orders'], ['Low stock (≤5)', d.low_stock, 'catalogue'], ['Out of stock', d.out_of_stock, 'catalogue']] as [string, number, string][]);
  return (<div className="stack">
    <div className="kpis">
      {[['Sales today', inr(d.gmv_today), `${d.orders_today} paid orders`], ['Sales, last 7 days', inr(d.gmv_7d), `${d.orders_7d} paid orders`],
        ['Average order (30 days)', inr(d.aov_30d), 'paid orders only'], ['Customers', String(d.customers_total), `+${d.customers_7d} this week`],
        ['Active sellers', String(d.vendors_active), `${d.products_live} products live`], ['Payment failures (24 h)', String(d.payment_failures_24h), `${d.awaiting_payment} awaiting payment`]].map(([l, v, s]) => (
        <div key={l} className="kpi panel"><span className="small muted">{l}</span><strong>{v}</strong><span className="small muted">{s}</span></div>))}
    </div>
    <div className="dash2">
      <section className="panel stack" aria-labelledby="q-h">
        <h2 id="q-h" style={{ margin: 0 }}>Needs attention</h2>
        {Q.map(([l, n, t]) => <button key={l} type="button" className={`queue${n ? ' hot' : ''}`} onClick={() => go(t)}><span>{l}</span><b>{n}</b></button>)}
        {d.preview_products > 0 && <p className="small muted" style={{ margin: 0 }}>{d.preview_products} preview products are live; remove them from All products when sellers list real ones.</p>}
      </section>
      <section className="panel stack" aria-labelledby="s-h">
        <h2 id="s-h" style={{ margin: 0 }}>Sales, last 14 days</h2>
        <div className="bars" role="img" aria-label={`Daily paid sales for 14 days; highest ${inr(max)}`}>
          {d.sales_14d.map((x: any) => <div key={x.day} className="bar" title={`${x.day}: ${inr(x.gmv)}, ${x.orders} orders`}><i style={{ height: `${Math.max(2, (Number(x.gmv) / max) * 100)}%` }} /><span>{x.day.slice(8)}</span></div>)}
        </div>
        <h3 style={{ margin: '8px 0 0' }}>Recent orders</h3>
        <div className="tablewrap" tabIndex={0} role="region" aria-label="Recent orders"><table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>{d.recent_orders.length ? d.recent_orders.map((o: any) => <tr key={o.id}><td>{o.order_number}</td><td className="small">{o.full_name ?? '—'}</td><td>{inr(o.grand_total)}</td><td><StatusChip s={o.status} /></td></tr>)
            : <tr><td colSpan={4} className="muted">No orders yet.</td></tr>}</tbody></table></div>
      </section>
    </div>
    <p className="small muted">Updated {new Date(d.generated_at).toLocaleTimeString('en-IN')} · refreshes every minute</p>
  </div>);
}
