'use client';
// SRS: CUST-FR-140 (urgent is offered only for the two situations with an urgent escalation: money taken with no order, and someone else using the account)
// SRS: CUST-FR-139 CUST-FR-142 (form prefilled from the order it was opened from; confirmation with reference number)
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { friendly } from '@/lib/errors';
import { Crumbs } from '@/components/Crumbs';

const CATS: [string, string][] = [['order', 'An order or delivery'], ['payment', 'A payment'], ['return', 'A return'], ['refund', 'A refund'], ['account', 'My account'], ['other', 'Something else']];
const URGENT: Record<string, [string, string]> = {
  payment: ['payment_taken_no_order', 'Money left my account but I have no order'],
  account: ['account_misuse', 'Someone else is using my account'],
};
function NewTicket() {
  const router = useRouter(); const sp = useSearchParams();
  const [orders, setOrders] = useState<any[]>([]); const [cat, setCat] = useState(sp.get('category') || 'order'); const [order, setOrder] = useState(sp.get('order') || '');
  const [subject, setSubject] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<string | null>(null);
  const [urgent, setUrgent] = useState(false); const [wasUrgent, setWasUrgent] = useState(false);
  useEffect(() => { (async () => { const db = sb(); const { data: { user } } = await db.auth.getUser();
    if (!user) { router.replace(`/login?next=${encodeURIComponent('/support/new?' + sp.toString())}`); return; }
    const { data } = await db.from('orders').select('id,order_number,placed_at').order('placed_at', { ascending: false }).limit(20); setOrders(data ?? []); })(); }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (subject.trim().length < 5) { setErr('Add a short subject (at least 5 characters).'); return; }
    if (message.trim().length < 10) { setErr('Tell us a little more (at least 10 characters).'); return; }
    setBusy(true); const { data, error } = await sb().rpc('create_support_ticket', { p_category: cat, p_subject: subject, p_message: message, p_order: order || null, p_urgent: urgent && URGENT[cat] ? URGENT[cat][0] : null }); setBusy(false);
    if (error) { setErr(friendly(error)); return; } setWasUrgent(data.priority === 'urgent'); setDone(data.ticket_number);
  }
  if (done) return (<div className="wrap section stack" style={{ maxWidth: 680 }}><div className="msg ok" role="status"><strong>Request received.</strong> Your reference number is <strong>{done}</strong>. {wasUrgent ? 'We’ve marked it urgent, so it’s handled before other requests.' : 'We reply within one working day.'}</div>
    <div className="cta-row"><Link className="btn" href="/account/tickets">View my help requests</Link><Link className="btn ghost" href="/">Continue shopping</Link></div></div>);
  return (
    <div className="wrap section stack" style={{ maxWidth: 680 }}>
      <Crumbs items={[['Home', '/'], ['Help centre', '/help'], ['Contact us']]} />
      <h1 style={{ margin: 0 }}>How can we help?</h1>
      <p className="muted" style={{ margin: 0 }}>For order questions, pick the order so we can see the details straight away. <Link href="/help">Common answers</Link></p>
      <form className="form panel" onSubmit={submit} style={{ maxWidth: 'none' }} noValidate>
        <label>What’s it about?<select value={cat} onChange={(e) => { setCat(e.target.value); setUrgent(false); }}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Order (optional)<select value={order} onChange={(e) => setOrder(e.target.value)}><option value="">Not about a specific order</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.order_number} · {new Date(o.placed_at).toLocaleDateString('en-IN')}</option>)}</select></label>
        {URGENT[cat] && <label className="check-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} style={{ width: 'auto', marginTop: 4 }} />
          <span>{URGENT[cat][1]}<span className="small muted" style={{ display: 'block' }}>Tick this only if it applies. It marks your request urgent so it’s handled first.{cat === 'account' ? ' Also sign out other devices from My account.' : ''}</span></span></label>}
        <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} aria-describedby={err ? 'terr' : undefined} /></label>
        <label>Details<textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="What happened, and what would you like us to do?" /></label>
        <p className="small muted" style={{ margin: 0 }}>Never share card numbers, CVV, UPI PIN or OTPs. ShopEye will never ask for them.</p>
        {err && <div id="terr" className="msg err" role="alert">{err}</div>}
        <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
      </form>
    </div>);
}
export default function Page() { return <Suspense><NewTicket /></Suspense>; }
