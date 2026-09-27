'use client';
// SRS: CUST-FR-076 CUST-FR-079 (gift card balance, store credit and points offered at checkout with their values and the 10% points cap shown before placing; checked again on the server)
// SRS: CUST-FR-013 CUST-FR-044 CUST-FR-073 CUST-FR-159 CUST-FR-162 CUST-FR-066 CUST-FR-069 CUST-FR-071 CUST-FR-072 CUST-FR-166 (inline field errors tied to inputs plus a summary; prices recalculated server-side by place_order; back navigation keeps the form and re-checks prices/stock; order saved before success is shown; serviceability re-checked at order; idempotent place order; price changes shown and confirmed; separate packages identified; total and action stay reachable on phones)
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sb } from '@/lib/sb-browser';
import { shippingRules } from '@/lib/shop-client';
import { inr, STATES, shipFor, SHIP_DEFAULT, type ShipRules } from '@/lib/config';
import { friendly } from '@/lib/errors';
import { payForOrder } from '@/lib/pay';
import { track } from '@/lib/analytics';

const blank = { recipient: '', mobile: '', line1: '', line2: '', landmark: '', city: '', state_code: 'KA', pincode: '', address_type: 'home' };

export default function Checkout() {
  const router = useRouter();
  const [rules, setRules] = useState<ShipRules>(SHIP_DEFAULT);
  useEffect(() => { shippingRules().then(setRules); track('begin_checkout', { currency: 'INR' }); sb().rpc('my_wallet').then(({ data }: any) => setWallet(data)); }, []);
  const [wallet, setWallet] = useState<any>(null); const [useGift, setUseGift] = useState(true); const [useCredit, setUseCredit] = useState(true); const [pts, setPts] = useState(0);
  const [user, setUser] = useState<any>(null); const [cart, setCart] = useState<any>(null); const [lines, setLines] = useState<any[]>([]);
  const [addrs, setAddrs] = useState<any[]>([]); const [addrId, setAddrId] = useState(''); const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>(blank); const [method, setMethod] = useState('upi'); const [coupon, setCoupon] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ack, setAck] = useState(false);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [step, setStep] = useState<1 | 2 | 3>(1);
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
      if (d) { if (d.form) setForm(d.form); if (d.method) setMethod(d.method); if (d.coupon) setCoupon(d.coupon); if (d.addrId && (a ?? []).some((x: any) => x.id === d.addrId)) setAddrId(d.addrId); if (d.adding) setAdding(true); if (d.step && (a ?? []).length) setStep(d.step); } } catch {}
  }
  useEffect(() => { load(); window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) load(); }); }, []);
  // keep what the shopper typed if they leave and come back (this tab only; no payment data is stored)
  useEffect(() => { try { sessionStorage.setItem(DK, JSON.stringify({ form, method, coupon, addrId, adding, step })); } catch {} }, [form, method, coupon, addrId, adding, step]);

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
      // ShopEye balance is applied on the server against the final order total (after coupon); the rest goes to Razorpay
      if (bal.use > 0) {
        const r = await sb().rpc('apply_balance', { p_order: data.order_id, p_gift_card: bal.gift > 0, p_store_credit: bal.credit > 0, p_points: bal.points });
        if (r.error && !/BALANCE_ALREADY_APPLIED/.test(r.error.message)) throw r.error;
        if (r.data?.paid) { router.replace(`/account/orders/${data.order_id}?placed=1`); return; }
      }
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
  const ship = pkgs.reduce((s, g) => s + shipFor(g.lines.reduce((t: number, l: any) => t + Number(l.v.selling_price) * l.qty, 0), rules), 0);
  // Preview of the balance the server will apply (gift card, then store credit, then points up to 10% of the order)
  const bal = (() => {
    if (!wallet || method === 'cod') return { gift: 0, credit: 0, points: 0, pv: 0, use: 0, cap: 0 };
    const total = sub + ship; const rate = Number(wallet.rules.rupees_per_point);
    const gift = useGift ? Math.min(total, Number(wallet.gift_card)) : 0;
    const credit = useCredit ? Math.min(total - gift, Number(wallet.store_credit)) : 0;
    const cap = Math.floor(Math.floor(total * wallet.rules.max_redeem_pct / 100) / rate);
    const points = Math.max(0, Math.min(pts, Number(wallet.loyalty_points), cap, Math.floor((total - gift - credit) / rate)));
    return { gift, credit, points, pv: points * rate, use: gift + credit + points * rate, cap };
  })();
  const f = (k: string) => ({ id: `f-${k}`, value: form[k] ?? '', onChange: (e: any) => { setForm({ ...form, [k]: e.target.value }); if (fe[k]) setFe({ ...fe, [k]: '' }); },
    'aria-invalid': fe[k] ? true : undefined, 'aria-describedby': fe[k] ? `e-${k}` : undefined });
  const fx = (k: string) => fe[k] ? <span id={`e-${k}`} className="field-err" role="alert">{fe[k]}</span> : null;
  const STEPS: [1 | 2 | 3, string][] = [[1, 'Address'], [2, 'Payment'], [3, 'Review']];
  const addr = addrs.find((x) => x.id === addrId);
  const METHODS: [string, string, string][] = [['upi', 'UPI', 'Google Pay, PhonePe, Paytm and other UPI apps'], ['card', 'Credit / debit card', 'Visa, Mastercard, RuPay'],
    ['netbanking', 'Net banking', 'All major Indian banks'], ['wallet', 'Wallets', 'Paytm, PhonePe and other wallets'], ['cod', 'Cash on delivery', 'Pay when you receive it, where available']];
  const go = (n: 1 | 2 | 3) => { setStep(n); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => (document.getElementById(`step-${n}`) as HTMLElement)?.focus(), 50); };
  return (
    <div className="wrap section split">
      <div className="stack">
        <h1>Checkout</h1>
        <ol className="stepper" aria-label="Checkout steps">
          {STEPS.map(([n, l]) => (
            <li key={n} className={step === n ? 'on' : step > n ? 'done' : ''} aria-current={step === n ? 'step' : undefined}>
              {step > n ? <button type="button" onClick={() => go(n)} aria-label={`${l}, completed. Go back to ${l}`}><span className="dot">✓</span>{l}</button> : <span><span className="dot">{n}</span>{l}</span>}
            </li>))}
        </ol>
        {step === 1 && <section className="panel stack" aria-labelledby="addr-h" id="step-1" tabIndex={-1}>
          <h2 id="addr-h" style={{ margin: 0 }}>Delivery address</h2>
          {addrs.map((a) => (
            <label key={a.id} className={`choice${addrId === a.id ? ' on' : ''}`}>
              <input type="radio" name="addr" checked={addrId === a.id} onChange={() => setAddrId(a.id)} />
              <span><strong>{a.recipient}</strong>{a.address_type ? <span className="small muted"> · {a.address_type === 'work' ? 'Work' : 'Home'}</span> : null}<br />
                <span className="small">{a.line1}, {a.line2}{a.landmark ? `, ${a.landmark}` : ''}, {a.city} – {a.pincode}</span><br /><span className="small muted">{a.mobile}</span></span></label>))}
          {!adding ? <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setAdding(true)}>+ Add a new address</button> : (
            <form className="form" onSubmit={saveAddress} style={{ maxWidth: 'none' }} noValidate>
              <div className="row2"><label>Full name<input required maxLength={100} {...f('recipient')} />{fx('recipient')}</label>
                <label>Mobile number<input required inputMode="tel" placeholder="10-digit mobile" {...f('mobile')} />{fx('mobile')}</label></div>
              <label>House / flat / building<input required minLength={2} maxLength={200} {...f('line1')} />{fx('line1')}</label>
              <label>Street / area / locality<input required minLength={2} maxLength={200} {...f('line2')} />{fx('line2')}</label>
              <div className="row2"><label>Landmark (optional)<input maxLength={100} {...f('landmark')} /></label>
                <label>Pincode<input required inputMode="numeric" maxLength={6} {...f('pincode')} />{fx('pincode')}</label></div>
              <div className="row2"><label>City<input required {...f('city')} />{fx('city')}</label>
                <label>State<select {...f('state_code')}>{STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label></div>
              <fieldset><legend>Address type</legend><div style={{ display: 'flex', gap: 16 }}>
                {[['home', 'Home'], ['work', 'Work']].map(([v, l]) => <label key={v} className="radio"><input type="radio" name="atype" checked={form.address_type === v} onChange={() => setForm({ ...form, address_type: v })} style={{ width: 'auto' }} /> {l}</label>)}</div></fieldset>
              <div style={{ display: 'flex', gap: 10 }}><button className="btn dark">Save address</button>
                {addrs.length > 0 && <button type="button" className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>}</div>
            </form>)}
          <h3 style={{ margin: '6px 0 0' }}>Delivery</h3>
          <div className="choice on"><span className="dot-static" aria-hidden="true" /><span><strong>Standard delivery</strong> <span className="small muted">· tracked, one package per seller</span><br />
            <span className="small">{ship ? `${inr(ship)} shipping` : 'Free delivery'}</span></span></div>
          {err && <div className="msg err" role="alert">{err}</div>}
          <button className="btn" disabled={!addrId || adding} onClick={() => go(2)}>Continue to payment</button>
        </section>}
        {step === 2 && <section className="panel stack" aria-labelledby="pay-h" id="step-2" tabIndex={-1}>
          <h2 id="pay-h" style={{ margin: 0 }}>Select payment method</h2>
          {METHODS.map(([v, l, d]) => (
            <label key={v} className={`choice${method === v ? ' on' : ''}`}>
              <input type="radio" name="pm" checked={method === v} onChange={() => setMethod(v)} />
              <span><strong>{l}</strong><br /><span className="small muted">{d}</span></span></label>))}
          <label>Coupon code (optional)<input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} maxLength={30} /></label>
          {wallet && method !== 'cod' && (Number(wallet.gift_card) + Number(wallet.store_credit) + Number(wallet.loyalty_points)) > 0 && (
            <fieldset className="stack" style={{ gap: 6 }}><legend>ShopEye balance</legend>
              {Number(wallet.gift_card) > 0 && <label className="radio"><input type="checkbox" checked={useGift} onChange={(e) => setUseGift(e.target.checked)} style={{ width: 'auto' }} /> Gift card balance ({inr(wallet.gift_card)} available)</label>}
              {Number(wallet.store_credit) > 0 && <label className="radio"><input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} style={{ width: 'auto' }} /> Store credit ({inr(wallet.store_credit)} available)</label>}
              {Number(wallet.loyalty_points) > 0 && <label>Loyalty points to use <span className="small muted">({wallet.loyalty_points} available, 1 point = {inr(wallet.rules.rupees_per_point)}, up to {bal.cap} on this order)</span>
                <input type="number" min={0} max={Math.min(Number(wallet.loyalty_points), bal.cap)} value={pts} onChange={(e) => setPts(Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></label>}
              <p className="small muted" style={{ margin: 0 }}>Applied to the final total after any coupon. If you don’t finish paying within an hour, the balance goes back to your account.</p>
            </fieldset>)}
          <div className="secure small"><strong>100% secure payments.</strong> Card and UPI details are entered in Razorpay’s protected window; ShopEye never sees or stores them.</div>
          <div className="cta-row"><button className="btn ghost" onClick={() => go(1)}>Back</button><button className="btn" onClick={() => go(3)}>Continue to review</button></div>
        </section>}
        {step === 3 && <section className="panel stack" aria-labelledby="rev-h" id="step-3" tabIndex={-1}>
          <h2 id="rev-h" style={{ margin: 0 }}>Review your order</h2>
          <div className="review-row"><div><div className="small muted">Deliver to</div>{addr && <><strong>{addr.recipient}</strong><div className="small">{addr.line1}, {addr.line2}, {addr.city} – {addr.pincode}</div></>}</div><button className="linklike" onClick={() => go(1)}>Change</button></div>
          <div className="review-row"><div><div className="small muted">Payment</div><strong>{METHODS.find((m) => m[0] === method)?.[1]}</strong>{coupon && <div className="small">Coupon {coupon}</div>}</div><button className="linklike" onClick={() => go(2)}>Change</button></div>
          {pkgs.map((g, i) => (
            <div key={g.vendor} className="review-row" style={{ display: 'block' }}><div className="small muted">Package {i + 1} from {g.vendor} · standard delivery</div>
              {g.lines.map((l: any) => <div key={l.variant_id} className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>{l.v.title}{Object.values(l.v.attributes || {}).length ? ` (${Object.values(l.v.attributes).join(' / ')})` : ''} × {l.qty}</span><span>{inr(Number(l.v.selling_price) * l.qty)}</span></div>)}
            </div>))}
          <div className="cta-row"><button className="btn ghost" onClick={() => go(2)}>Back</button></div>
        </section>}
      </div>
      <aside className="panel sum sticky-sum">
        <h2 style={{ margin: 0 }}>Order summary</h2>
        {pkgs.length > 1 && <p className="small" style={{ margin: 0 }}>Your order ships as <strong>{pkgs.length} separate packages</strong>, one from each seller, each with its own tracking.</p>}
        <div><span>Items ({lines.reduce((n, l) => n + l.qty, 0)})</span><span>{inr(sub)}</span></div>
        <div><span>Shipping</span><span>{ship ? inr(ship) : 'Free'}</span></div>
        <div className="tot"><span>Total</span><span>{inr(sub + ship)}</span></div>
        {bal.use > 0 && <>
          {bal.gift > 0 && <div className="small"><span>Gift card balance</span><span>−{inr(bal.gift)}</span></div>}
          {bal.credit > 0 && <div className="small"><span>Store credit</span><span>−{inr(bal.credit)}</span></div>}
          {bal.points > 0 && <div className="small"><span>{bal.points} points</span><span>−{inr(bal.pv)}</span></div>}
          <div className="tot"><span>To pay now</span><span>{inr(Math.max(0, sub + ship - bal.use))}</span></div></>}
        <p className="small muted" style={{ margin: 0 }}>Any coupon is applied when you place the order, and the final total is confirmed before payment. Prices include GST.</p>
        {changed.length > 0 && (
          <div className="msg err" role="alert">
            <strong>Prices changed since you added {changed.length === 1 ? 'this item' : 'these items'}:</strong>
            <ul style={{ margin: '6px 0' }}>{changed.map((l) => <li key={l.variant_id}>{l.v.title}: {inr(l.price_at_add)} → {inr(l.v.selling_price)}</li>)}</ul>
            <label style={{ display: 'flex', gap: 8, fontWeight: 600 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 'auto' }} /> I’ve reviewed the new prices</label>
          </div>)}
        {step === 3 && err && <div className="msg err" role="alert">{err}</div>}
        {step === 3
          ? <button className="btn" disabled={busy || !addrId || adding || (changed.length > 0 && !ack)} onClick={place}>{busy ? 'Placing order…' : method === 'cod' || (bal.use > 0 && sub + ship - bal.use <= 0) ? 'Place order' : `Place order and pay ${inr(Math.max(0, sub + ship - bal.use))}`}</button>
          : <button className="btn" disabled={step === 1 && (!addrId || adding)} onClick={() => go((step + 1) as 2 | 3)}>{step === 1 ? 'Continue to payment' : 'Continue to review'}</button>}
      </aside>
    </div>
  );
}
