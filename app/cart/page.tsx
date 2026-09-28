'use client';
// SRS: CUST-FR-055 CUST-FR-056 CUST-FR-059 CUST-FR-061 CUST-FR-062 (save for later excluded from totals; account cart persists; totals recalc on change; unavailable items block checkout; per-item removal)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/sb-browser';
import { inr, shipFor, SHIP_DEFAULT, type ShipRules } from '@/lib/config';
import { guestCart, setGuestCart, cartChanged, shippingRules } from '@/lib/shop-client';
import { Crumbs } from '@/components/Crumbs';
import { Pic } from '@/components/Pic';
import { DeliverTo } from '@/components/DeliverTo';
import { BodyClass } from '@/components/BodyClass';
import { MobileTitle } from '@/components/MobileTitle';

type Line = { key: string; qty: number; price_at_add: number; variant_id: string; saved: boolean; v?: any; stock?: number };
export default function Cart() {
  const [rules, setRules] = useState<ShipRules>(SHIP_DEFAULT);
  useEffect(() => { shippingRules().then(setRules); }, []);
  const [lines, setLines] = useState<Line[] | null>(null); const [user, setUser] = useState<any>(undefined); const [cartId, setCartId] = useState<string | null>(null);
  async function load() {
    const db = sb(); const { data: { user } } = await db.auth.getUser(); setUser(user);
    let raw: Line[] = [];
    if (!user) raw = guestCart().map((l) => ({ key: l.variant_id, qty: l.qty, price_at_add: l.price, variant_id: l.variant_id, saved: false }));
    else {
      const { data: cart } = await db.from('carts').select('id').eq('customer_id', user.id).eq('status', 'active').maybeSingle();
      setCartId(cart?.id ?? null);
      if (cart) { const { data } = await db.from('cart_items').select('id,qty,price_at_add,variant_id,saved_for_later').eq('cart_id', cart.id).order('added_at');
        raw = (data ?? []).map((c: any) => ({ key: c.id, qty: c.qty, price_at_add: Number(c.price_at_add), variant_id: c.variant_id, saved: c.saved_for_later })); }
    }
    const ids = [...new Set(raw.map((l) => l.variant_id))];
    const { data: cv } = ids.length ? await db.from('catalog_variants').select('variant_id,product_id,title,attributes,selling_price,mrp,vendor_name,vendor_id,max_qty_per_order').in('variant_id', ids) : { data: [] };
    const pids = [...new Set((cv ?? []).map((v: any) => v.product_id))];
    const stocks = new Map<string, number>(); const imgs = new Map<string, string>();
    await Promise.all(pids.map(async (pid) => { const { data } = await db.rpc('variant_availability', { p_product: pid }); (data ?? []).forEach((a: any) => stocks.set(a.variant_id, a.available)); }));
    if (pids.length) { const { data: m } = await db.from('product_media').select('product_id,url,sort_order').in('product_id', pids).order('sort_order'); (m ?? []).forEach((x: any) => { if (!imgs.has(x.product_id)) imgs.set(x.product_id, x.url); }); }
    const vm = new Map((cv ?? []).map((v: any) => [v.variant_id, { ...v, image: imgs.get(v.product_id) }]));
    setLines(raw.map((l) => ({ ...l, v: vm.get(l.variant_id), stock: stocks.get(l.variant_id) ?? 0 })));
  }
  useEffect(() => { load(); }, []);
  async function setQty(l: Line, qty: number) {
    if (!user) setGuestCart(guestCart().map((g) => g.variant_id === l.variant_id ? { ...g, qty } : g));
    else { await sb().from('cart_items').update({ qty }).eq('id', l.key); cartChanged(); }
    load();
  }
  async function remove(l: Line) {
    if (!user) setGuestCart(guestCart().filter((g) => g.variant_id !== l.variant_id));
    else { await sb().from('cart_items').delete().eq('id', l.key); cartChanged(); }
    load();
  }
  async function toggleSaved(l: Line) {
    const db = sb();
    const clash = lines!.find((x) => x.variant_id === l.variant_id && x.saved !== l.saved);
    if (clash) { await db.from('cart_items').update({ qty: Math.min(clash.qty + l.qty, 10) }).eq('id', clash.key); await db.from('cart_items').delete().eq('id', l.key); }
    else await db.from('cart_items').update({ saved_for_later: !l.saved }).eq('id', l.key);
    cartChanged(); load();
  }
  if (lines === null) return <div className="wrap section">Loading your cart…</div>;
  const active = lines.filter((l) => !l.saved), saved = lines.filter((l) => l.saved);
  if (!active.length && !saved.length) return <div className="wrap section stack"><h1>Your cart is empty</h1><p className="muted">Add something you like; it stays here while you shop.</p><div className="cta-row"><Link className="btn" href="/">Start shopping</Link><Link className="btn ghost" href="/wishlist">View wishlist</Link></div></div>;
  const ok = (l: Line) => l.v && l.stock! >= l.qty;
  const live = active.filter((l) => l.v);
  const groups = Object.values(live.reduce((g: any, l) => ((g[l.v.vendor_name] ||= { vendor: l.v.vendor_name, lines: [] }).lines.push(l), g), {})) as { vendor: string; lines: Line[] }[];
  const items = live.reduce((s, l) => s + Number(l.v.selling_price) * l.qty, 0);
  const mrpTotal = live.reduce((s, l) => s + Math.max(Number(l.v.mrp || 0), Number(l.v.selling_price)) * l.qty, 0);
  const ship = groups.reduce((s, g) => s + shipFor(g.lines.reduce((t, l) => t + Number(l.v.selling_price) * l.qty, 0), rules), 0);
  const blocked = active.some((l) => !ok(l));
  const row = (l: Line) => (
    <div key={l.key} className="cart-line">
      <Link href={l.v ? `/p/${l.v.product_id}` : '#'} className="cart-img">{l.v?.image ? <Pic src={l.v.image} alt="" w={160} h={200} sizes="96px" /> : <span />}</Link>
      <div className="cart-body">
        {l.v ? <Link href={`/p/${l.v.product_id}`}><strong>{l.v.title}</strong></Link> : <strong className="muted">This item is no longer available</strong>}
        {l.v && <div className="small muted">{Object.values(l.v.attributes || {}).join(' / ')}{l.v.vendor_name ? ` · Sold by ${l.v.vendor_name}` : ''}</div>}
        {l.v && <div className="price-line"><strong>{inr(Number(l.v.selling_price))}</strong>{Number(l.v.mrp) > Number(l.v.selling_price) && <><span className="mrp">{inr(l.v.mrp)}</span><span className="off-chip">{Math.round(100 * (Number(l.v.mrp) - Number(l.v.selling_price)) / Number(l.v.mrp))}% off</span></>}</div>}
        {l.v && Number(l.price_at_add) > 0 && Number(l.price_at_add) !== Number(l.v.selling_price) && <div className="small chip warn">Price changed from {inr(l.price_at_add)} to {inr(l.v.selling_price)}</div>}
        {l.v && l.stock! < l.qty && <div className="small chip bad">{l.stock ? `Only ${l.stock} left: lower the quantity` : 'Out of stock'}</div>}
        <div className="cart-actions">
          {l.v && !l.saved && (() => { const max = Math.min(10, l.v.max_qty_per_order || 10, Math.max(l.stock ?? 10, 1)); return (
            <span className="qty-step" role="group" aria-label={`Quantity of ${l.v.title}`}>
              <button type="button" aria-label="Decrease quantity" disabled={l.qty <= 1} onClick={() => setQty(l, l.qty - 1)}>−</button>
              <output aria-live="polite">{l.qty}</output>
              <button type="button" aria-label="Increase quantity" disabled={l.qty >= max} onClick={() => setQty(l, l.qty + 1)}>+</button>
            </span>); })()}
          {user && l.v && <button className="linklike" onClick={() => toggleSaved(l)}>{l.saved ? 'Move to bag' : '♡ Save for later'}</button>}
          <button className="linklike danger-t" onClick={() => remove(l)}>Remove</button>
        </div>
      </div>
      {l.v && <strong className="cart-price">{inr(Number(l.v.selling_price) * l.qty)}</strong>}
    </div>);
  return (
    <div className="wrap section split">
      <div className="stack">
        <Crumbs items={[['Home', '/'], ['Cart']]} />
        <div className="ship-strip"><DeliverTo compact /></div>
        <MobileTitle title="Your cart" sub={live.length ? (() => { const n = live.reduce((s, l) => s + l.qty, 0); return `${n} ${n === 1 ? 'item' : 'items'}`; })() : undefined} />
        <h1 className="page-h1" style={{ margin: 0 }}>My cart{live.length ? ` (${live.reduce((s, l) => s + l.qty, 0)})` : ''}</h1>
        {!user && <div className="msg info">You’re not signed in. Your cart is saved on this device; <Link href="/login?next=/cart">sign in</Link> to keep it with your account.</div>}
        {blocked && <div className="msg err" role="alert">Some items need attention before checkout.</div>}
        {groups.map((g, i) => {
          const pkg = g.lines.reduce((t, l) => t + Number(l.v.selling_price) * l.qty, 0); const need = rules.free - pkg;
          return (
            <section key={g.vendor} className="panel stack" aria-label={`Package ${i + 1} from ${g.vendor}`}>
              <div className="pkg-head"><h3 style={{ margin: 0 }}>Package {i + 1} · from {g.vendor}</h3><span className="small">{shipFor(pkg, rules) ? `Shipping ${inr(shipFor(pkg, rules))}` : 'Free shipping'}</span></div>
              {!rules.live ? null : need > 0 ? <div className="ship-bar"><div style={{ width: `${Math.min(100, (pkg / rules.free) * 100)}%` }} /><span className="small">Add {inr(need)} more from {g.vendor} for free shipping on this package (before any coupon)</span></div>
                        : <div className="small ok-t">This package ships free</div>}
              {g.lines.map(row)}
            </section>);
        })}
        {active.filter((l) => !l.v).map(row)}
        {saved.length > 0 && <section className="panel stack"><h3 style={{ margin: 0 }}>Saved for later ({saved.length})</h3><p className="small muted" style={{ margin: 0 }}>Not included in your total.</p>{saved.map(row)}</section>}
      </div>
      <aside className="panel sum sticky-sum">
        <Link href={user ? '/checkout' : '/login?next=/checkout'} className="coupon-row"><span aria-hidden="true">%</span><span><strong>Apply coupon</strong><span className="small muted">Enter your code at checkout</span></span><span aria-hidden="true">›</span></Link>
        <h2 style={{ margin: 0 }}>Price details</h2>
        <div><span>Bag total ({live.reduce((s, l) => s + l.qty, 0)} items)</span><span>{inr(mrpTotal)}</span></div>
        {mrpTotal > items && <div className="ok-t"><span>Discount</span><span>−{inr(mrpTotal - items)}</span></div>}
        <div><span>Shipping ({groups.length} {groups.length === 1 ? 'package' : 'packages'})</span><span>{ship ? inr(ship) : 'Free'}</span></div>
        <div className="tot"><span>Total payable</span><span>{inr(items + ship)}</span></div>
        {mrpTotal > items && <div className="small ok-t" style={{ fontWeight: 700 }}>You save {inr(mrpTotal - items)} on this order</div>}
        <p className="small muted secure-note" style={{ margin: 0 }}><span aria-hidden="true">🔒</span> Safe and secure payments. Easy returns. Prices include GST.</p>
        {blocked || !live.length ? <button className="btn" disabled>Continue to checkout</button> : <Link className="btn" href={user ? '/checkout' : '/login?next=/checkout'}>{user ? 'Proceed to checkout' : 'Sign in to check out'}</Link>}
      </aside>
      {live.length > 0 && <BodyClass name="has-mcheckout" />}
      {live.length > 0 && <div className="m-checkout" aria-hidden="true">
        <span><span className="small muted">Total</span><strong>{inr(items + ship)}</strong></span>
        {blocked ? <button className="btn" disabled tabIndex={-1}>Fix cart first</button> : <Link className="btn" tabIndex={-1} href={user ? '/checkout' : '/login?next=/checkout'}>{user ? 'Proceed to checkout' : 'Sign in to check out'}</Link>}
      </div>}
    </div>);
}
