'use client';
// SRS: CUST-FR-013 CUST-FR-044 CUST-FR-073 CUST-FR-159 CUST-FR-162 CUST-FR-066 CUST-FR-069 CUST-FR-071 CUST-FR-072 CUST-FR-166 (inline field errors tied to inputs plus a summary; prices recalculated server-side by place_order; back navigation keeps the form and re-checks prices/stock; order saved before success is shown; serviceability re-checked at order; idempotent place order; price changes shown and confirmed; separate packages identified; total and action stay reachable on phones)
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sb } from '@/lib/sb-browser';
import { inr, STATES, shipFor } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { payForOrder } from '@/lib/pay';

const blank = { recipient: '', mobile: '', line1: '', line2: '', landmark: '', city: '', state_code: 'KA', pincode: '', address_type: 'home' };

export default function Checkout() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null); const [cart, setCart] = useState<any>(null); const [lines, setLines] = useState<any[]>([]);
  const [addrs, setAddrs] = useState<any[]>([]); const [addrId, setAddrId] = useState(''); const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>(blank); const [method, setMethod] = useState('upi'); const [coupon, setCoupon] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ack, setAck] = useState(false);
  const [fe, setFe] = useState<Record<string, string>>({});
  const DK = 'shopeye.checkout.draft';

  async function load() {
    const db = sb(); const { data: { user } } = await db.auth.getUser();
    if (!user) { router.replace('/login?next=/checkout'); return; }
    setUser(user);
    const { data: c } = await db.from('carts').select('id').eq('customer_id', user.id).eq('status', 'active').maybeSingle(); setCart(c);
    if (c) {
      const { data: ci } = await db.from('cart_items').select('id,qty,variant_id,price_at_add').eq('cart_id', c.id).eq('saved_for_later', false);
      const ids = (ci ?? []).map((x: any) => x.variant_id);
      const { data: cv } = ids.length ? await db.from('catalog_variants').select('variant_id,title,selling_price,vendor_name,attributes').in('variant_id', ids) : { data: [] };
      const m = new Map((cv ?? []).map((v: any) => [v.variant_id, v]));
      setLines((ci ?? []).map((x: any) => ({ ...x, v: m.get(x.variant_id) })));
    }
    const { data: a } = await db.from('customer_addresses').select('*').eq('customer_id', user.id).is('archived_at', null).order('is_default', { ascending: false });
    setAddrs(a ?? []); if (a?.length) setAddrId(a[0].id); else setAdding(true);
    try { const d = JSON.parse(sessionStorage.getItem(DK) || 'null');
      if (d) { if (d.form) setForm(d.form); if (d.method) setMethod(d.method); if (d.coupon) setCoupon(d.coupon); if (d.addrId && (a ?? []).some((x: any) => x.id === d.addrId)) setAddrId(d.addrId); if (d.adding) setAdding(true); } } catch {}
  }
  useEffect(() => { load(); window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) load(); }); }, []);
  // keep what the shopper typed if they leave and come back (this tab only; no payment data is stored)
  useEffect(() => { try { sessionStorage.setItem(DK, JSON.stringify({ form, method, coupon, addrId, adding })); } catch {} }, [form, method, coupon, addrId, adding]);

  async function saveAddress(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const errs: Record<string, string> = {};
    const req: [string, string][] = [['recipient', 'Enter the recipient’s full name.'], ['line1', 'Enter house, flat or building.'], ['line2', 'Enter street, area or locality.'], ['city', 'Enter the city.']];
    req.forEach(([k, m]) => { if (!form[k] || String(form[k]).trim().length < 2) errs[k] = m; });
    if (!/^[6-9]\d{9}$/.test(String(form.mobile || '').replace(/\D/g, '').slice(-10))) errs.mobile = 'Enter a valid 10-digit mobile number.';
    if (!/^[1-9]\d{5}$/.test(String(form.pincode || ''))) errs.pincode = 'Enter a valid 6-digit pincode.';
    setFe(errs);
    if (Object.keys(errs).length) { setErr(`Please fix ${Object.keys(errs).length} ${Object.keys(errs).length === 1 ? 'field' : 'fields'} in the address.`); (document.getElementById(`f-${Object.keys(errs)[0]}`) as HTMLElement)?.focus(); return; }
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
      // Accepting changed prices updates the cart so the same change isn't flagged again
      for (const l of changed) await sb().from('cart_items').update({ price_at_add: l.v.selling_price }).eq('id', l.id);
      // one idempotency key per cart attempt: a double click or retry returns the same order (CUST-FR-069)
      const k = `idem:${cart.id}`; const idem = sessionStorage.getItem(k) || crypto.randomUUID(); sessionStorage.setItem(k, idem);
      const { data, error } = await sb().rpc('place_order', { p_cart: cart.id, p_address: addrId, p_payment_method: method, p_idempotency_key: idem, p_coupon: coupon || null });
      if (error) throw error;
      sessionStorage.removeItem(k);
      try { sessionStorage.removeItem(DK); } catch {}
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
  const changed = lines.filter((l) => l.v && Number(l.price_at_add) > 0 && Number(l.price_at_add) !== Number(l.v.selling_price));
  const pkgs = Object.values(lines.filter((l) => l.v).reduce((g: any, l) => ((g[l.v.vendor_name] ||= { vendor: l.v.vendor_name, lines: [] }).lines.push(l), g), {})) as any[];
  const ship = pkgs.reduce((s, g) => s + shipFor(g.lines.reduce((t: number, l: any) => t + Number(l.v.selling_price) * l.qty, 0)), 0);
  const f = (k: string) => ({ id: `f-${k}`, value: form[k] ?? '', onChange: (e: any) => { setForm({ ...form, [k]: e.target.value }); if (fe[k]) setFe({ ...fe, [k]: '' }); },
    'aria-invalid': fe[k] ? true : undefined, 'aria-describedby': fe[k] ? `e-${k}` : undefined });
  const fx = (k: string) => fe[k] ? <span id={`e-${k}`} className="field-err" role="alert">{fe[k]}</span> : null;
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
            <form className="form" onSubmit={saveAddress} style={{ maxWidth: 'none' }} noValidate>
              <div className="row2"><label>Full name<input required maxLength={100} {...f('recipient')} />{fx('recipient')}</label>
                <label>Mobile number<input required inputMode="tel" placeholder="10-digit mobile" {...f('mobile')} />{fx('mobile')}</label></div>
              <label>House / flat / building<input required minLength={2} maxLength={200} {...f('line1')} />{fx('line1')}</label>
              <label>Street / area / locality<input required minLength={2} maxLength={200} {...f('line2')} />{fx('line2')}</label>
              <div className="row2"><label>Landmark (optional)<input maxLength={100} {...f('landmark')} /></label>
                <label>Pincode<input required inputMode="numeric" maxLength={6} {...f('pincode')} />{fx('pincode')}</label></div>
              <div className="row2"><label>City<input required {...f('city')} />{fx('city')}</label>
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
      <aside className="panel sum sticky-sum">
        <h2 style={{ margin: 0 }}>Order summary</h2>
        {pkgs.length > 1 && <p className="small" style={{ margin: 0 }}>Your order ships as <strong>{pkgs.length} separate packages</strong>, one from each seller, each with its own tracking.</p>}
        {pkgs.map((g, i) => (
          <div key={g.vendor} className="pkg-sum">
            <div className="small muted">Package {i + 1} from {g.vendor}</div>
            {g.lines.map((l: any) => <div key={l.variant_id} className="small"><span>{l.v.title}{Object.values(l.v.attributes || {}).length ? ` (${Object.values(l.v.attributes).join(' / ')})` : ''} × {l.qty}</span><span>{inr(Number(l.v.selling_price) * l.qty)}</span></div>)}
          </div>))}
        <div><span>Items</span><span>{inr(sub)}</span></div>
        <div><span>Shipping</span><span>{ship ? inr(ship) : 'Free'}</span></div>
        <div className="tot"><span>Total</span><span>{inr(sub + ship)}</span></div>
        <p className="small muted" style={{ margin: 0 }}>Any coupon is applied when you place the order, and the final total is confirmed before payment. Prices include GST.</p>
        {changed.length > 0 && (
          <div className="msg err" role="alert">
            <strong>Prices changed since you added {changed.length === 1 ? 'this item' : 'these items'}:</strong>
            <ul style={{ margin: '6px 0' }}>{changed.map((l) => <li key={l.variant_id}>{l.v.title}: {inr(l.price_at_add)} → {inr(l.v.selling_price)}</li>)}</ul>
            <label style={{ display: 'flex', gap: 8, fontWeight: 600 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 'auto' }} /> I’ve reviewed the new prices</label>
          </div>)}
        {err && <div className="msg err" role="alert">{err}</div>}
        <button className="btn" disabled={busy || !addrId || adding || (changed.length > 0 && !ack)} onClick={place}>{busy ? 'Placing order…' : method === 'cod' ? 'Place order' : 'Place order and pay'}</button>
      </aside>
    </div>
  );
}
