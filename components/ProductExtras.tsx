'use client';
// SRS: CUST-FR-046 (delivery check by pincode without login)
import { useEffect, useState } from 'react';
import { sb } from '@/lib/sb-browser';

export function Gallery({ media: all, title }: { media: { url: string; alt_text?: string; variant_id?: string | null }[]; title: string }) {
  const [i, setI] = useState(0); const [variant, setVariant] = useState<string | null>(null);
  useEffect(() => { const on = (e: any) => { setVariant(e.detail); setI(0); }; window.addEventListener('shopeye:variant', on); return () => window.removeEventListener('shopeye:variant', on); }, []);
  // photos for the chosen variant first, then photos shared by all variants
  const own = all.filter((m) => variant && m.variant_id === variant);
  const media = own.length ? [...own, ...all.filter((m) => !m.variant_id)] : all.filter((m) => !m.variant_id || !all.some((x) => !x.variant_id)).length ? all.filter((m) => !m.variant_id) : all;
  if (!media.length) return <div className="gallery-main empty-photo">Photos coming soon</div>;
  return (
    <div className="gallery">
      <div className="gallery-main"><img src={media[i].url} alt={media[i].alt_text || title} /></div>
      {media.length > 1 && (
        <div className="thumbs" role="list">
          {media.map((m, k) => <button key={k} role="listitem" aria-label={`Show photo ${k + 1}`} aria-current={k === i} onClick={() => setI(k)}><img src={m.url} alt="" /></button>)}
        </div>)}
    </div>
  );
}
export function PincodeCheck() {
  const [pin, setPin] = useState(''); const [r, setR] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { const s = localStorage.getItem('shopeye.pin'); if (s) { setPin(s); check(s); } }, []);
  async function check(v = pin) {
    if (!/^[1-9]\d{5}$/.test(v)) { setR({ valid: false }); return; }
    setBusy(true); const { data } = await sb().rpc('check_pincode', { p_pincode: v }); setBusy(false); setR(data);
    try { localStorage.setItem('shopeye.pin', v); } catch {}
  }
  const eta = (d: number) => new Date(Date.now() + d * 864e5).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <div className="panel pin">
      <form onSubmit={(e) => { e.preventDefault(); check(); }} className="pin-row">
        <label className="small" htmlFor="pin">Check delivery</label>
        <input id="pin" inputMode="numeric" maxLength={6} placeholder="Enter pincode" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <button className="btn ghost sm" disabled={busy}>{busy ? 'Checking…' : 'Check'}</button>
      </form>
      {r && (r.valid === false ? <p className="small bad-t">Enter a valid 6-digit pincode.</p>
        : r.serviceable ? <p className="small ok-t">Delivery by {eta(r.eta_min)}–{eta(r.eta_max)}{r.cod ? '. Cash on delivery available.' : '. Pay online at checkout.'}</p>
        : <p className="small bad-t">We don’t deliver to {pin} yet.</p>)}
    </div>
  );
}
