'use client';
// SRS: CUST-FR-046 (delivery check by pincode without login)
import { useEffect, useState } from 'react';
import { sbLazy } from '@/lib/sb-lazy';
import { Pic } from '@/components/Pic';

export function Gallery({ media: all, title }: { media: { url: string; alt_text?: string; variant_id?: string | null }[]; title: string }) {
  const [i, setI] = useState(0); const [variant, setVariant] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  useEffect(() => { const on = (e: any) => { setVariant(e.detail); setI(0); }; window.addEventListener('shopeye:variant', on); return () => window.removeEventListener('shopeye:variant', on); }, []);
  // photos for the chosen variant first, then photos shared by all variants
  const own = all.filter((m) => variant && m.variant_id === variant);
  const media = own.length ? [...own, ...all.filter((m) => !m.variant_id)] : all.filter((m) => !m.variant_id || !all.some((x) => !x.variant_id)).length ? all.filter((m) => !m.variant_id) : all;
  if (!media.length) return <div className="gallery-main empty-photo">Photos coming soon</div>;
  const share = async () => {
    const data = { title, url: location.href };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1800); } } catch {}
  };
  return (
    <div className="gallery">
      {/* phones: swipe through every photo, with dots and a share button */}
      <div className="gal-m m-only">
        <div className="gal-strip" tabIndex={0} role="region" onScroll={(e) => { const el = e.currentTarget; setI(Math.round(el.scrollLeft / el.clientWidth)); }} aria-label="Product photos, swipe to see more">
          {media.map((m, k) => <div key={k} className="gal-slide"><Pic src={m.url} alt={m.alt_text || title} w={900} h={1125} sizes="100vw" priority={k === 0} /></div>)}
        </div>
        {media.length > 1 && <div className="gal-dots" aria-hidden="true">{media.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>}
        <button type="button" className="gal-share" onClick={share} aria-label="Share this product">{copied ? '✓' : <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>}</button>
      </div>
      <div className="d-only">
      <div className="gallery-main"><Pic src={media[i].url} alt={media[i].alt_text || title} w={900} h={1125} sizes="(max-width: 800px) 100vw, 560px" priority /></div>
      {media.length > 1 && (
        <div className="thumbs" role="list">
          {media.map((m, k) => <button key={k} role="listitem" aria-label={`Show photo ${k + 1}`} aria-current={k === i} onClick={() => setI(k)}><img src={m.url.replace(/w=\d+/, 'w=160')} alt="" /></button>)}
        </div>)}
      </div>
    </div>
  );
}
export function PincodeCheck() {
  const [pin, setPin] = useState(''); const [r, setR] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () => { const s = localStorage.getItem('shopeye.pin'); if (s) { setPin(s); check(s); } };
    load(); window.addEventListener('shopeye:pin', load); return () => window.removeEventListener('shopeye:pin', load);   // header location changes re-check delivery
  }, []);
  async function check(v = pin) {
    if (!/^[1-9]\d{5}$/.test(v)) { setR({ valid: false }); return; }
    setBusy(true); const { data } = await (await sbLazy()).rpc('check_pincode', { p_pincode: v }); setBusy(false); setR(data);
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
