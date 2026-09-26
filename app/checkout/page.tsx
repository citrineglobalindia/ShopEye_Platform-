'use client';
// SRS: CUST-FR-066 CUST-FR-069 (serviceability re-checked when the order is placed; idempotent place order)
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sb } from '@/lib/sb-browser';
import { inr, STATES } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { payForOrder } from '@/lib/pay';

const blank = { recipient: '', mobile: '', line1: '', line2: '', landmark: '', city: '', state_code: 'KA', pincode: '', address_type: 'home' };

export default function Checkout() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null); const [cart, setCart] = useState<any>(null); const [lines, setLines] = useState<any[]>([]);
  const [addrs, setAddrs] = useState<any[]>([]); const [addrId, setAddrId] = useState(''); const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>(blank); const [method, setMethod] = useState('upi'); const [coupon, setCoupon] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  async function load() {
    const db = sb(); const { data: { user } } = await db.auth.getUser();
    if (!user) { router.replace('/login?next=/checkout'); return; }
    setUser(user);
    const { data: c } = await db.from('carts').select('id').eq('customer_id', user.id).eq('status', 'active').maybeSingle(); setCart(c);
    if (c) {
      const { data: ci } = await db.from('cart_items').select('qty,variant_id').eq('cart_id', c.id).eq('saved_for_later', false);
      const ids = (ci ?? []).map((x: any) => x.variant_id);
      const { data: cv } = ids.length ? await db.from('catalog_variants').select('variant_id,title,selling_price,vendor_name').in('variant_id', ids) : { data: [] };
      const m = new Map((cv ?? []).map((v: any) => [v.variant_id, v]));
      setLines((ci ?? []).map((x: any) => ({ ...x, v: m.get(x.variant_id) })));
    }
    const { data: a } = await db.from('customer_addresses').select('*').eq('customer_id', user.id).is('archived_at', null).order('is_default', { ascending: false });
    setAddrs(a ?? []); if (a?.length) setAddrId(a[0].id); else setAdding(true);
  }
  useEffect(() => { load(); }, []);

  async function saveAddress(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const mobile = form.mobile.replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(mobile.slice(-10))) { setErr('Enter a valid 10-digit mobile number.'); return; }
    if (!/^[1-9]\d{5}$/.test(form.pincode)) { setErr('Enter a valid 6-digit pincode.'); return; }
    const { data, error } = await sb().from('customer_addresses').insert({ ...form, mobile: '+91' + mobile.slice(-10), customer_id: user.id, is_default: addrs.length === 0 }).select('id').single();
    if (error) { setErr('Check the address fields: every line needs at least 2 characters.'); return; }
    setAdding(false); setForm(blank); await load(); setAddrId(data.id);
  }

  async function place() {
    setBusy(true); setErr('');
    try {
      // one idempotency key per cart attempt: a double click or retry returns the same order (CUST-FR-069)
      const k = `idem:${cart.id}`; const idem = sessionStorage.getItem(k) || crypto.randomUUID(); sessionStorage.setItem(k, idem);
      const { data, error } = await sb().rpc('place_order', { p_cart: cart.id, p_address: addrId, p_payment_method: method, p_idempotency_key: idem, p_coupon: coupon || null });
      if (error) throw error;
      sessionStorage.removeItem(k);
      if (method === 'cod') { router.replace(`/account/orders/${data.order_id}?placed=1`); return; }
      const a = addrs.find((x) => x.id === addrId);
      let result = 'dismissed';
      try { result = await payForOrder(data.order_id, { email: user.email, contact: a?.mobile, name: a?.recipient }); }
      catch (e: any) { router.replace(`/account/orders/${data.order_id}?payerr=${encodeURIComponent(e.message)}`); return; }
      router.replace(`/account/orders/${data.order_id}?${result === 'paid' ? 'placed=1' : 'pay=' + result}`);
    } catch (e) { setErr(friendly(e)); setBusy(false); }
  }

  if (!user) return <div className="wrap section">Loading checkout…</div>;
  if (!cart || !lines.length) return <div className="wrap section"><h1>Nothing to check out</h1><Link className="btn" href="/">Continue shopping</Link></div>;
  const sub = lines.reduce((s, l) => s + (l.v ? Number(l.v.selling_price) * l.qty : 0), 0);
  const f = (k: string) => ({ value: form[k], onChange: (e: any) => setForm({ ...form, [k]: e.target.value }) });
  return (
    <div className="wrap section split">
      <div className="stack">
        <h1>Checkout</h1>
        <section className="panel stack" aria-labelledby="addr-h">
          <h2 id="addr-h" style={{ margin: 0 }}>Delivery address</h2>
          {addrs.map((a) => (
            <label key={a.id} style={{ display: 'flex', gap: 10, fontWeight: 400, alignItems: 'start' }}>
              <input type="radio" name="addr" checked={addrId === a.id} onChange={() => setAddrId(a.id)} style={{ width: 'auto', marginTop: 5 }} />
              <span><strong>{a.recipient}</strong>, {a.line1}, {a.line2}, {a.city} {a.pincode} <span className="muted">({a.mobile})</span></span></label>))}
          {!adding ? <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setAdding(true)}>Add a new address</button> : (
            <form className="form" onSubmit={saveAddress} style={{ maxWidth: 'none' }}>
              <div className="row2"><label>Full name<input required maxLength={100} {...f('recipient')} /></label>
                <label>Mobile number<input required inputMode="tel" placeholder="10-digit mobile" {...f('mobile')} /></label></div>
              <label>House / flat / building<input required minLength={2} maxLength={200} {...f('line1')} /></label>
              <label>Street / area / locality<input required minLength={2} maxLength={200} {...f('line2')} /></label>
              <div className="row2"><label>Landmark (optional)<input maxLength={100} {...f('landmark')} /></label>
                <label>Pincode<input required inputMode="numeric" maxLength={6} {...f('pincode')} /></label></div>
              <div className="row2"><label>City<input required {...f('city')} /></label>
                <label>State<select {...f('state_code')}>{STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label></div>
              <div style={{ display: 'flex', gap: 10 }}><button className="btn dark">Save address</button>
                {addrs.length > 0 && <button type="button" className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>}</div>
            </form>)}
        </section>
        <section className="panel stack" aria-labelledby="pay-h">
          <h2 id="pay-h" style={{ margin: 0 }}>Payment</h2>
          {[['upi', 'UPI, card, net banking or wallet (Razorpay)'], ['cod', 'Cash on delivery (where available)']].map(([v, l]) => (
            <label key={v} style={{ display: 'flex', gap: 10, fontWeight: 400 }}>
              <input type="radio" name="pm" checked={method === v} onChange={() => setMethod(v)} style={{ width: 'auto' }} /> {l}</label>))}
          <label>Coupon code (optional)<input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} maxLength={30} /></label>
        </section>
      </div>
      <aside className="panel sum">
        <h2 style={{ margin: 0 }}>Order summary</h2>
        {lines.map((l) => <div key={l.variant_id} className="small"><span>{l.v?.title ?? 'Unavailable'} × {l.qty}</span><span>{l.v ? inr(Number(l.v.selling_price) * l.qty) : '—'}</span></div>)}
        <div className="tot"><span>Items total</span><span>{inr(sub)}</span></div>
        <p className="small muted" style={{ margin: 0 }}>Shipping (₹49 per seller package under ₹499) and any coupon are applied when you place the order. Prices include GST.</p>
        {err && <div className="msg err" role="alert">{err}</div>}
        <button className="btn" disabled={busy || !addrId || adding} onClick={place}>{busy ? 'Placing order…' : method === 'cod' ? 'Place order' : 'Place order and pay'}</button>
      </aside>
    </div>
  );
}
