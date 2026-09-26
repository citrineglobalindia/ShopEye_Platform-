'use client';
// SRS: CUST-FR-020 CUST-FR-051 CUST-FR-134 CUST-FR-135 CUST-FR-136 CUST-FR-064 CUST-FR-065 CUST-FR-067 CUST-FR-145 (sign out other devices; clear recently viewed; essential messages can't be switched off; marketing separate and opt-in; saved state shown; add/edit/delete/select addresses; deletion archives so past orders keep their snapshot; profile edits never change past orders)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { STATES } from '@/lib/config';
import { clearRecent, recentIds } from '@/lib/shop-client';
import { Crumbs } from '@/components/Crumbs';

const blank = { id: '', recipient: '', mobile: '', line1: '', line2: '', landmark: '', city: '', state_code: 'KA', pincode: '', address_type: 'home' };
export default function Account() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null); const [name, setName] = useState(''); const [addrs, setAddrs] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [prefs, setPrefs] = useState({ marketing_email: false, marketing_sms: false, marketing_whatsapp: false }); const [prefMsg, setPrefMsg] = useState(''); const [rv, setRv] = useState(0);
  async function load() {
    const db = sb(); const { data: { user } } = await db.auth.getUser();
    if (!user) { router.replace('/login?next=/account'); return; }
    setUser(user);
    const [{ data: p }, { data: a }] = await Promise.all([db.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
      db.from('customer_addresses').select('*').eq('customer_id', user.id).is('archived_at', null).order('is_default', { ascending: false }).order('created_at')]);
    setName(p?.full_name ?? ''); setAddrs(a ?? []);
    const { data: pr } = await db.from('customer_preferences').select('marketing_email,marketing_sms,marketing_whatsapp').maybeSingle(); if (pr) setPrefs(pr);
    setRv(recentIds().length);
  }
  async function savePrefs(next: typeof prefs) {
    setPrefs(next); setPrefMsg('Saving…');
    const { error } = await sb().from('customer_preferences').upsert({ customer_id: user.id, ...next });
    setPrefMsg(error ? 'Could not save. Try again.' : `Saved ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Applies to messages from now on.`);
  }
  async function signOutOthers() {
    const { error } = await sb().auth.signOut({ scope: 'others' });
    setMsg(error ? '' : 'Signed out of all other devices. This device stays signed in.'); if (error) setErr('Could not sign out other devices. Try again.');
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
      <section className="panel stack" aria-labelledby="sec-h">
        <h2 id="sec-h" style={{ margin: 0 }}>Privacy and security</h2>
        <div className="addr"><div><strong>Signed in on other devices?</strong><div className="small muted">Signs you out everywhere except this device.</div></div><button className="btn ghost sm" onClick={signOutOthers}>Sign out other devices</button></div>
        <div className="addr"><div><strong>Recently viewed</strong><div className="small muted">{rv ? `${rv} products remembered on this device.` : 'Nothing remembered on this device.'}</div></div>{rv > 0 && <button className="btn ghost sm" onClick={() => { clearRecent(); setRv(0); }}>Clear</button>}</div>
      </section>
    </div>
  );
}
