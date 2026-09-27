'use client';
// SRS: CUST-FR-076 CUST-FR-077 CUST-FR-078 CUST-FR-079 (gift card codes checked on the server before they add balance; partly used balance stays;
// store credit and every balance lot show their expiry; loyalty points show value, pending points, earning rate and the per-order cap)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { inr } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { Crumbs } from '@/components/Crumbs';

const FUND: Record<string, string> = { store_credit: 'Store credit', gift_card: 'Gift card balance', loyalty: 'Loyalty points' };
const KIND: Record<string, string> = { refund_credit: 'Refund as store credit', gift_card_redeem: 'Gift card added', loyalty_earn: 'Points earned', loyalty_reverse: 'Points reversed (return)',
  order_payment: 'Used for an order', order_release: 'Returned (order not paid)', refund_restore: 'Refunded to balance', expiry: 'Expired', adjustment: 'Adjustment' };
const d = (x: string) => new Date(x).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function Balance() {
  const router = useRouter();
  const [w, setW] = useState<any>(null); const [hist, setHist] = useState<any[]>([]);
  const [code, setCode] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function load() {
    const db = sb(); const { data: { user } } = await db.auth.getUser();
    if (!user) { router.replace('/login?next=/account/balance'); return; }
    const [{ data }, { data: h }] = await Promise.all([db.rpc('my_wallet'), db.from('wallet_ledger').select('id,fund,amount,direction,kind,note,created_at').order('created_at', { ascending: false }).limit(50)]);
    setW(data); setHist(h ?? []);
  }
  useEffect(() => { load(); }, []);
  async function redeem(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 18) { setErr('Enter the full gift card code, for example SEAB-CD12-EF34-GH56.'); return; }
    setBusy(true); const { data, error } = await sb().rpc('redeem_gift_card', { p_code: code }); setBusy(false);
    if (error || !data?.ok) { setErr(friendly(error ?? data?.error)); return; }
    setCode(''); setMsg(`${inr(data.amount)} added to your gift card balance. Use it by ${d(data.expires_at)}.`); load();
  }
  if (!w) return <div className="wrap section">Loading your balance…</div>;
  const r = w.rules; const total = Number(w.store_credit) + Number(w.gift_card) + Number(w.loyalty_value);
  return (
    <div className="wrap section stack" style={{ maxWidth: 880 }}>
      <Crumbs items={[['Home', '/'], ['My account', '/account'], ['ShopEye balance']]} />
      <h1 style={{ margin: 0 }}>ShopEye balance</h1>
      <p className="muted" style={{ margin: 0 }}>Use it at checkout. It’s only for shopping on ShopEye and can’t be withdrawn as cash.</p>
      <div className="acct-links">
        <div className="panel"><strong>{inr(w.gift_card)}</strong><span className="small muted">Gift card balance</span></div>
        <div className="panel"><strong>{inr(w.store_credit)}</strong><span className="small muted">Store credit</span></div>
        <div className="panel"><strong>{w.loyalty_points} points</strong><span className="small muted">Worth {inr(w.loyalty_value)}{Number(w.loyalty_pending_points) > 0 ? ` · ${w.loyalty_pending_points} more after return windows close` : ''}</span></div>
        <div className="panel"><strong>{inr(total)}</strong><span className="small muted">Total you can use</span></div>
      </div>
      <section className="panel stack" aria-labelledby="gc-h">
        <h2 id="gc-h" style={{ margin: 0 }}>Add a gift card</h2>
        <form className="addr" onSubmit={redeem} noValidate>
          <label style={{ flex: 1, minWidth: 220 }}>Gift card code<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={24} autoComplete="off" placeholder="SEAB-CD12-EF34-GH56"
            aria-invalid={!!err} aria-describedby={err ? 'gc-err' : undefined} /></label>
          <button className="btn sm" style={{ alignSelf: 'end' }} disabled={busy}>{busy ? 'Checking…' : 'Add to balance'}</button>
        </form>
        {err && <div id="gc-err" className="msg err" role="alert">{err}</div>}
        {msg && <div className="msg ok" role="status">{msg}</div>}
      </section>
      <section className="panel stack" aria-labelledby="exp-h">
        <h2 id="exp-h" style={{ margin: 0 }}>What expires next</h2>
        {!w.next_expiries.length ? <p className="muted small" style={{ margin: 0 }}>Nothing to expire.</p> :
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{w.next_expiries.map((x: any, i: number) => <li key={i}>{FUND[x.fund]}: {x.fund === 'loyalty' ? `${Math.floor(Number(x.amount) / r.rupees_per_point)} points` : inr(x.amount)} on {d(x.expires_at)}</li>)}</ul>}
      </section>
      <section className="panel stack" aria-labelledby="rules-h">
        <h2 id="rules-h" style={{ margin: 0 }}>How it works</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>Loyalty points:</strong> earn {r.points_per_100} point{r.points_per_100 === 1 ? '' : 's'} for every ₹100 of delivered items. Each point is worth {inr(r.rupees_per_point)}. Points become usable when the item’s return window closes, can pay for up to {r.max_redeem_pct}% of an order, and expire {r.loyalty_expiry_days} days after they become usable.</li>
          <li><strong>Store credit:</strong> when you take a refund as store credit it arrives instantly and lasts {r.store_credit_expiry_days} days.</li>
          <li><strong>Gift cards:</strong> the full value is added when you enter the code; spend it over several orders until its expiry date.</li>
          <li><strong>At checkout</strong> gift card balance is used first, then store credit, then any points you choose. If you get a refund, card or UPI payments are refunded first, then your ShopEye balance.</li>
        </ul>
      </section>
      <section className="panel stack" aria-labelledby="hist-h">
        <h2 id="hist-h" style={{ margin: 0 }}>History</h2>
        {!hist.length ? <p className="muted small" style={{ margin: 0 }}>No activity yet.</p> : (
          <div className="tablewrap" tabIndex={0} role="region" aria-label="Balance history (scrolls sideways on small screens)"><table>
            <thead><tr><th>Date</th><th>What</th><th>Balance</th><th>Amount</th></tr></thead>
            <tbody>{hist.map((h) => <tr key={h.id}><td>{d(h.created_at)}</td><td>{KIND[h.kind] ?? h.kind}{h.note && h.kind !== 'expiry' ? <span className="muted small"> · {h.note}</span> : null}</td><td>{FUND[h.fund]}</td>
              <td className={h.direction === 'credit' ? 'ok-t' : ''}>{h.direction === 'credit' ? '+' : '−'}{inr(h.amount)}</td></tr>)}</tbody>
          </table></div>)}
      </section>
      <p className="small muted" style={{ margin: 0 }}>Questions about your balance? <Link href="/support/new?category=payment">Contact us</Link>.</p>
    </div>);
}
