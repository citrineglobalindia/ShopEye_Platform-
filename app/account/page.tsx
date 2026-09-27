'use client';
// SRS: CUST-FR-148 CUST-FR-178 CUST-FR-144 (email change, data download and signing out other devices need a sign-in within the last 10 minutes or a fresh email code; recent security activity with times; the sign-in email can only be replaced by a verified new one, never removed)
// SRS: CUST-FR-143 CUST-FR-147 CUST-FR-151 CUST-FR-020 CUST-FR-051 CUST-FR-134 CUST-FR-135 CUST-FR-136 CUST-FR-064 CUST-FR-065 CUST-FR-067 CUST-FR-145 (new email only replaces the old one after both are confirmed; download personal data; expired session returns to login and back here; sign out other devices; clear recently viewed; essential messages can't be switched off; marketing separate and opt-in; saved state shown; add/edit/delete/select addresses; deletion archives so past orders keep their snapshot; profile edits never change past orders)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { STATES } from '@/lib/config';
import { clearRecent, recentIds } from '@/lib/shop-client';
import { Crumbs } from '@/components/Crumbs';

const REAUTH_MIN = 10;
// Minutes since this session last proved who it is (the access token's authentication-method timestamps)
function authAgeMinutes(token?: string | null): number {
  try { const amr = JSON.parse(atob(token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).amr ?? [];
        const t = Math.max(...amr.map((m: any) => Number(m.timestamp) || 0)); return t ? (Date.now() / 1000 - t) / 60 : Infinity; } catch { return Infinity; }
}
const SEC_LABEL: Record<string, string> = { signed_in: 'Signed in', email_changed: 'Sign-in email changed', email_change_requested: 'Email change requested',
  signed_out_other_devices: 'Signed out of other devices', sign_in_method_added: 'New sign-in method added', reverified: 'Confirmed it was you with an email code', data_exported: 'Downloaded your data' };
const blank = { id: '', recipient: '', mobile: '', line1: '', line2: '', landmark: '', city: '', state_code: 'KA', pincode: '', address_type: 'home' };
export default function Account() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null); const [name, setName] = useState(''); const [addrs, setAddrs] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [prefs, setPrefs] = useState({ marketing_email: false, marketing_sms: false, marketing_whatsapp: false }); const [prefMsg, setPrefMsg] = useState(''); const [rv, setRv] = useState(0);
  const [newEmail, setNewEmail] = useState(''); const [emailMsg, setEmailMsg] = useState('');
  const [alerts, setAlerts] = useState<any[]>([]); const [myRevs, setMyRevs] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [reauth, setReauth] = useState<{ label: string; run: () => Promise<void> } | null>(null); const [code, setCode] = useState(''); const [reMsg, setReMsg] = useState('');
  // Sensitive changes need a recent sign-in; otherwise we email a code first (CUST-FR-148)
  async function guarded(label: string, run: () => Promise<void>) {
    const { data: { session } } = await sb().auth.getSession();
    if (authAgeMinutes(session?.access_token) <= REAUTH_MIN) { await run(); return; }
    setReMsg(''); setCode('');
    const { error } = await sb().auth.signInWithOtp({ email: user.email, options: { shouldCreateUser: false } });
    setReMsg(error ? (/rate|seconds/i.test(error.message) ? 'Please wait a minute, then try again.' : 'We couldn’t send a code right now. Try again.') : '');
    setReauth({ label, run });
  }
  async function confirmCode(e: React.FormEvent) {
    e.preventDefault(); if (!reauth) return;
    const { error } = await sb().auth.verifyOtp({ email: user.email, token: code.trim(), type: 'email' });
    if (error) { setReMsg(/rate|many/i.test(error.message) ? 'Too many attempts. Wait a few minutes, then try again.' : 'That code is wrong or has expired.'); return; }
    await sb().rpc('log_security_event', { p_kind: 'reverified' });
    const job = reauth; setReauth(null); setCode(''); await job.run(); load();
  }
  async function load() {
    const db = sb(); const { data: { user } } = await db.auth.getUser();
    if (!user) { router.replace('/login?next=/account'); return; }
    setUser(user);
    const [{ data: p }, { data: a }] = await Promise.all([db.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
      db.from('customer_addresses').select('*').eq('customer_id', user.id).is('archived_at', null).order('is_default', { ascending: false }).order('created_at')]);
    setName(p?.full_name ?? ''); setAddrs(a ?? []);
    const { data: pr } = await db.from('customer_preferences').select('marketing_email,marketing_sms,marketing_whatsapp').maybeSingle(); if (pr) setPrefs(pr);
    setRv(recentIds().length);
    const [{ data: al }, { data: rvw }] = await Promise.all([
      db.from('product_alerts').select('id,variant_id,kind,active,fired_at,created_at').eq('active', true).order('created_at', { ascending: false }),
      db.from('product_reviews').select('id,product_id,rating,title,status,moderation_note,updated_at').eq('customer_id', user.id).order('updated_at', { ascending: false })]);
    const vids = (al ?? []).map((x: any) => x.variant_id);
    const { data: cv } = vids.length ? await db.from('catalog_variants').select('variant_id,product_id,title,attributes,selling_price').in('variant_id', vids) : { data: [] };
    const vm = new Map((cv ?? []).map((v: any) => [v.variant_id, v]));
    setAlerts((al ?? []).map((x: any) => ({ ...x, v: vm.get(x.variant_id) })));
    const pids = (rvw ?? []).map((x: any) => x.product_id);
    const { data: pt } = pids.length ? await db.from('products').select('id,title').in('id', pids) : { data: [] };
    setMyRevs((rvw ?? []).map((x: any) => ({ ...x, product: (pt ?? []).find((p: any) => p.id === x.product_id)?.title })));
    const { data: ev } = await db.from('security_events').select('id,kind,detail,created_at').order('created_at', { ascending: false }).limit(10); setEvents(ev ?? []);
  }
  async function alertOff(a: any) { await sb().from('product_alerts').update({ active: false }).eq('id', a.id); load(); }
  async function savePrefs(next: typeof prefs) {
    setPrefs(next); setPrefMsg('Saving…');
    const { error } = await sb().from('customer_preferences').upsert({ customer_id: user.id, ...next });
    setPrefMsg(error ? 'Could not save. Try again.' : `Saved ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Applies to messages from now on.`);
  }
  async function changeEmail(e: React.FormEvent) {
    e.preventDefault(); setEmailMsg('');
    const v = newEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { setEmailMsg('Enter a valid email address.'); return; }
    if (v === (user.email || '').toLowerCase()) { setEmailMsg('That’s already your email.'); return; }
    await guarded('change your sign-in email', () => startEmailChange(v));
  }
  async function startEmailChange(v: string) {
    // Supabase "secure email change": a confirmation goes to BOTH addresses; the old one stays active until both are confirmed
    const { error } = await sb().auth.updateUser({ email: v }, { emailRedirectTo: `${location.origin}/auth/callback?next=/account` });
    setEmailMsg(error ? (/rate|seconds/i.test(error.message) ? 'Please wait a minute and try again.' : /already|registered/i.test(error.message) ? 'That email is used by another account.' : 'Could not start the change. Try again.')
                      : `Check both ${user.email} and ${v} and confirm in each. Until then, keep signing in with ${user.email}.`);
    if (!error) { setNewEmail(''); await sb().rpc('log_security_event', { p_kind: 'email_change_requested' }); load(); }
  }
  async function downloadData() {
    const db = sb();
    const [p, a, o, oi, t, pr, w, se] = await Promise.all([
      db.from('profiles').select('full_name,email,mobile,created_at').eq('id', user.id).maybeSingle(),
      db.from('customer_addresses').select('recipient,mobile,line1,line2,landmark,city,state_code,pincode,address_type,is_default,created_at,archived_at').eq('customer_id', user.id),
      db.from('orders').select('order_number,status,payment_status,payment_method,subtotal,discount_total,shipping_total,grand_total,placed_at,ship_address'),
      db.from('order_items').select('order_id,product_snapshot,qty,unit_price,line_total,cancelled_qty,return_requested_qty'),
      db.from('support_tickets').select('ticket_number,category,subject,message,status,created_at'),
      db.from('customer_preferences').select('marketing_email,marketing_sms,marketing_whatsapp,updated_at').maybeSingle(),
      db.from('wishlist_items').select('product_id,added_at'),
      db.from('security_events').select('kind,detail,created_at').order('created_at', { ascending: false })]);
    const data = { exported_at: new Date().toISOString(), account: { ...p.data, sign_in_email: user.email }, addresses: a.data, orders: o.data, order_items: oi.data,
      help_requests: t.data, communication_preferences: pr.data, wishlist: w.data, security_activity: se.data, note: 'Payment card details are never stored by ShopEye. For deletion or correction requests, contact support.' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: `shopeye-my-data-${new Date().toISOString().slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    await sb().rpc('log_security_event', { p_kind: 'data_exported' }); load();
  }
  async function signOutOthers() {
    const { error } = await sb().auth.signOut({ scope: 'others' });
    setMsg(error ? '' : 'Signed out of all other devices. This device stays signed in. We’ve emailed you a note of it.'); if (error) setErr('Could not sign out other devices. Try again.');
    if (!error) { await sb().rpc('log_security_event', { p_kind: 'signed_out_other_devices' }); load(); }
  }
  useEffect(() => { load(); }, []);
  async function saveName(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    if (name.trim().length < 2) { setErr('Enter your full name.'); return; }
    const { error } = await sb().from('profiles').update({ full_name: name.trim() }).eq('id', user.id);
    if (error) setErr('Could not save your name.'); else { setMsg('Name saved.'); router.refresh(); }
  }
  async function saveAddr(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const mobile = form.mobile.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(mobile)) { setErr('Enter a valid 10-digit mobile number.'); return; }
    if (!/^[1-9]\d{5}$/.test(form.pincode)) { setErr('Enter a valid 6-digit pincode.'); return; }
    const { id, ...fields } = form; const row = { ...fields, mobile: '+91' + mobile };
    const db = sb();
    // Edits create a new address and archive the old one, so orders keep the address they were shipped to
    if (id) await db.from('customer_addresses').update({ archived_at: new Date().toISOString(), is_default: false }).eq('id', id);
    const wasDefault = id && addrs.find((a) => a.id === id)?.is_default;
    const { error } = await db.from('customer_addresses').insert({ ...row, customer_id: user.id, is_default: !!wasDefault || addrs.length === 0 });
    if (error) { setErr('Check the address: every line needs at least 2 characters.'); return; }
    setForm(null); setMsg(id ? 'Address updated.' : 'Address added.'); load();
  }
  async function remove(a: any) {
    if (!confirm(`Delete the address for ${a.recipient}? Past orders keep the address they were delivered to.`)) return;
    await sb().from('customer_addresses').update({ archived_at: new Date().toISOString(), is_default: false }).eq('id', a.id);
    setMsg('Address deleted.'); load();
  }
  async function makeDefault(a: any) {
    const db = sb();
    await db.from('customer_addresses').update({ is_default: false }).eq('customer_id', user.id).eq('is_default', true);
    await db.from('customer_addresses').update({ is_default: true }).eq('id', a.id); load();
  }
  if (!user) return <div className="wrap section">Loading your account…</div>;
  const f = (k: string) => ({ value: form[k], onChange: (e: any) => setForm({ ...form, [k]: e.target.value }) });
  return (
    <div className="wrap section stack" style={{ maxWidth: 880 }}>
      <Crumbs items={[['Home', '/'], ['My account']]} />
      <h1 style={{ margin: 0 }}>My account</h1>
      <div className="acct-links"><Link className="panel" href="/account/orders"><strong>My orders</strong><span className="small muted">Track, cancel or return</span></Link>
        <Link className="panel" href="/wishlist"><strong>Wishlist</strong><span className="small muted">Products you saved</span></Link>
        <Link className="panel" href="/account/balance"><strong>ShopEye balance</strong><span className="small muted">Gift cards, store credit, points</span></Link>
        <Link className="panel" href="/account/documents"><strong>Invoices</strong><span className="small muted">Tax invoices and credit notes</span></Link>
        <Link className="panel" href="/account/tickets"><strong>Help requests</strong><span className="small muted">Your conversations with us</span></Link></div>
      {msg && <div className="msg ok" role="status">{msg}</div>}{err && <div className="msg err" role="alert">{err}</div>}
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Profile</h2>
        <form onSubmit={saveName} className="row2" style={{ alignItems: 'end' }}>
          <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="btn dark sm">Save name</button></div>
        </form>
        <p className="small muted" style={{ margin: 0 }}>Signed in as {user.email}. Changes apply to future orders; past orders and invoices keep the details they were placed with.</p>
      </section>
      <section className="panel stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ margin: 0 }}>Addresses</h2>
          {!form && <button className="btn ghost sm" onClick={() => setForm({ ...blank })}>Add address</button>}</div>
        {!addrs.length && !form && <p className="muted" style={{ margin: 0 }}>No saved addresses yet.</p>}
        {!form && addrs.map((a) => (
          <div key={a.id} className="addr">
            <div><strong>{a.recipient}</strong> {a.is_default && <span className="chip ok">Default</span>} <span className="chip">{a.address_type}</span>
              <div className="small">{a.line1}, {a.line2}{a.landmark ? `, ${a.landmark}` : ''}, {a.city} {a.pincode}</div><div className="small muted">{a.mobile}</div></div>
            <div className="addr-actions">
              <button className="btn ghost sm" onClick={() => setForm({ ...blank, ...a, mobile: a.mobile.replace('+91', '') })}>Edit</button>
              {!a.is_default && <button className="btn ghost sm" onClick={() => makeDefault(a)}>Make default</button>}
              <button className="btn danger sm" onClick={() => remove(a)}>Delete</button>
            </div>
          </div>))}
        {form && (
          <form className="form" onSubmit={saveAddr} style={{ maxWidth: 'none' }}>
            <div className="row2"><label>Full name<input required maxLength={100} {...f('recipient')} /></label>
              <label>Mobile number<input required inputMode="tel" {...f('mobile')} /></label></div>
            <label>House / flat / building<input required minLength={2} maxLength={200} {...f('line1')} /></label>
            <label>Street / area / locality<input required minLength={2} maxLength={200} {...f('line2')} /></label>
            <div className="row2"><label>Landmark (optional)<input maxLength={100} {...f('landmark')} /></label><label>Pincode<input required inputMode="numeric" maxLength={6} {...f('pincode')} /></label></div>
            <div className="row2"><label>City<input required {...f('city')} /></label>
              <label>State<select {...f('state_code')}>{STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label></div>
            <label>Address type<select {...f('address_type')}><option value="home">Home</option><option value="work">Work</option><option value="other">Other</option></select></label>
            <div style={{ display: 'flex', gap: 10 }}><button className="btn dark">{form.id ? 'Save changes' : 'Save address'}</button><button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button></div>
          </form>)}
      </section>
      <section className="panel stack" aria-labelledby="prefs-h">
        <h2 id="prefs-h" style={{ margin: 0 }}>Messages from ShopEye</h2>
        <p className="small" style={{ margin: 0 }}><strong>Always on:</strong> order confirmations, payment, delivery, refund and account security messages. These are needed to serve your orders and can’t be turned off.</p>
        <fieldset><legend>Offers and new arrivals (optional)</legend>
          {([['marketing_email', 'Email'], ['marketing_sms', 'SMS'], ['marketing_whatsapp', 'WhatsApp']] as const).map(([k, l]) => (
            <label key={k} className="radio"><input type="checkbox" checked={prefs[k]} onChange={(e) => savePrefs({ ...prefs, [k]: e.target.checked })} /> {l}</label>))}
        </fieldset>
        {prefMsg && <p className="small muted" role="status" style={{ margin: 0 }}>{prefMsg}</p>}
      </section>
      {(alerts.length > 0 || myRevs.length > 0) && (
        <section className="panel stack" aria-labelledby="al-h">
          <h2 id="al-h" style={{ margin: 0 }}>Alerts and reviews</h2>
          {alerts.map((a) => (
            <div key={a.id} className="addr"><div><strong>{a.kind === 'back_in_stock' ? 'Back-in-stock alert' : 'Price-drop alert'}</strong>
              <div className="small">{a.v ? <Link href={`/p/${a.v.product_id}`}>{a.v.title}{Object.values(a.v.attributes || {}).length ? ` (${Object.values(a.v.attributes).join(' / ')})` : ''}</Link> : 'Product no longer listed'} · by email</div></div>
              <button className="btn ghost sm" onClick={() => alertOff(a)}>Turn off</button></div>))}
          {myRevs.map((r) => (
            <div key={r.id} className="addr"><div><strong>Your review of {r.product ?? 'a product'}</strong> <span className="small">({r.rating}★)</span>
              <div className="small muted">{({ pending: 'Waiting for moderation', published: 'Published', rejected: 'Not published', removed: 'Removed' } as any)[r.status]}{r.moderation_note ? `: ${r.moderation_note}` : ''}</div></div>
              <Link className="btn ghost sm" href={`/p/${r.product_id}#rev-h`}>View</Link></div>))}
        </section>)}
      <section className="panel stack" aria-labelledby="sec-h">
        <h2 id="sec-h" style={{ margin: 0 }}>Privacy and security</h2>
        {reauth && (
          <form className="panel stack" onSubmit={confirmCode} aria-labelledby="re-h" style={{ borderColor: 'var(--ink)' }}>
            <strong id="re-h">Confirm it’s you</strong>
            <p className="small" style={{ margin: 0 }}>To {reauth.label}, enter the 8-digit code we just emailed to {user.email}. This keeps your account safe if someone else has your device.</p>
            <label>Code<input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-invalid={!!reMsg} aria-describedby="re-err" /></label>
            {reMsg && <div id="re-err" className="msg err" role="alert">{reMsg}</div>}
            <div className="cta-row"><button className="btn sm" disabled={code.length < 6}>Confirm</button><button type="button" className="btn ghost sm" onClick={() => setReauth(null)}>Cancel</button></div>
          </form>)}
        <form className="addr" onSubmit={changeEmail}>
          <div style={{ flex: 1, minWidth: 220 }}><strong>Sign-in email</strong><div className="small muted">Now: {user.email}</div>
            <label className="small" style={{ marginTop: 6 }}>New email<input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" /></label>
            {emailMsg && <p className="small" role="status" style={{ margin: '6px 0 0' }}>{emailMsg}</p>}</div>
          <button className="btn ghost sm" style={{ alignSelf: 'end' }}>Change email</button>
        </form>
        <div className="addr"><div><strong>Your data</strong><div className="small muted">Download your profile, addresses, orders, help requests and preferences as a file.</div></div><button className="btn ghost sm" onClick={() => guarded('download your data', downloadData)}>Download my data</button></div>
        <div className="addr"><div><strong>Signed in on other devices?</strong><div className="small muted">Signs you out everywhere except this device.</div></div><button className="btn ghost sm" onClick={() => guarded('sign out your other devices', signOutOthers)}>Sign out other devices</button></div>
        <div className="addr"><div><strong>Sign-in methods</strong><div className="small muted">{['Email code', ...(user.identities ?? []).filter((i: any) => i.provider !== 'email').map((i: any) => i.provider === 'google' ? 'Google' : i.provider === 'facebook' ? 'Facebook' : i.provider)].join(' · ')}</div></div></div>
        <div><strong>Recent security activity</strong>
          {events.length ? <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{events.map((e) => <li key={e.id}>{SEC_LABEL[e.kind] ?? e.kind}{e.kind === 'email_changed' && e.detail?.from ? ` (${e.detail.from} → ${e.detail.to})` : ''}{e.kind === 'sign_in_method_added' && e.detail?.method ? ` (${e.detail.method})` : ''} · {new Date(e.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</li>)}</ul>
            : <div className="small muted">Nothing recorded yet.</div>}
          <div className="small muted" style={{ marginTop: 4 }}>Don’t recognise something? Sign out other devices and contact us.</div></div>
        <div className="addr"><div><strong>Recently viewed</strong><div className="small muted">{rv ? `${rv} products remembered on this device.` : 'Nothing remembered on this device.'}</div></div>{rv > 0 && <button className="btn ghost sm" onClick={() => { clearRecent(); setRv(0); }}>Clear</button>}</div>
      </section>
    </div>
  );
}
