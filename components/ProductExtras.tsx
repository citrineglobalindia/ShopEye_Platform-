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
        {media.length === 1
          ? <div className="gallery-main"><Pic src={media[0].url} alt={media[0].alt_text || title} w={900} h={1125} sizes="560px" priority /></div>
          : <div className="gal-grid" role="list" aria-label="Product photos">
              {media.slice(0, 5).map((m, k) => (
                <div key={k} role="listitem" className={k < 2 ? 'big' : 'small'}>
                  <Pic src={m.url} alt={m.alt_text || `${title}, photo ${k + 1}`} w={k < 2 ? 600 : 400} h={k < 2 ? 800 : 530} sizes={k < 2 ? '300px' : '200px'} priority={k < 2} />
                  {k === 1 && <a href="#details" className="finer"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20 20 4M14 4h6v6M9 20H4v-5"/></svg>Finer Details</a>}
                </div>))}
            </div>}
      </div>
    </div>
  );
}
export function PincodeCheck({ returnDays, returnable = true }: { returnDays?: number; returnable?: boolean }) {
  const [pin, setPin] = useState(''); const [city, setCity] = useState(''); const [edit, setEdit] = useState(false);
  const [r, setR] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () => { const s = localStorage.getItem('shopeye.pin'); try { setCity(JSON.parse(localStorage.getItem('shopeye.loc') || '{}').city ?? ''); } catch {}
      if (s) { setPin(s); check(s); } else setEdit(true); };
    load(); window.addEventListener('shopeye:pin', load); return () => window.removeEventListener('shopeye:pin', load);   // header location changes re-check delivery
  }, []);
  async function check(v = pin) {
    if (!/^[1-9]\d{5}$/.test(v)) { setR({ valid: false }); return; }
    setBusy(true); const { data } = await (await sbLazy()).rpc('check_pincode', { p_pincode: v }); setBusy(false); setR(data); setEdit(false);
    if (data?.city) setCity(data.city);
    try { localStorage.setItem('shopeye.pin', v); } catch {}
  }
  const eta = (d: number) => { const x = new Date(Date.now() + d * 864e5); const n = x.getDate(); const sfx = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
    return `${n}${sfx} ${x.toLocaleDateString('en-IN', { month: 'short' })}`; };
  return (
    <div className="shipto">
      <strong className="shipto-h">Ship to</strong>
      {edit || !pin ? (
        <form onSubmit={(e) => { e.preventDefault(); check(); }} className="shipto-box">
          <label className="sr-only" htmlFor="pin">Delivery pincode</label>
          <input id="pin" inputMode="numeric" maxLength={6} placeholder="Enter pincode" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus={!!pin} />
          <button className="linklike shipto-a" disabled={busy}>{busy ? 'Checking…' : 'Check'}</button>
        </form>
      ) : (
        <div className="shipto-box"><span>{pin}{city ? `, ${city}` : ''}</span><button type="button" className="linklike shipto-a" onClick={() => setEdit(true)}>Change Pincode</button></div>)}
      {r && (r.valid === false ? <p className="small bad-t" role="alert">Enter a valid 6-digit pincode.</p>
        : r.serviceable ? <p className="shipto-l"><span aria-hidden="true">🚚</span>Delivery by <strong>{eta(r.eta_max)}</strong> <span className="muted">|</span> <span className="ok-t">Free</span>{r.cod ? <span className="muted small"> · COD available</span> : null}</p>
        : <p className="small bad-t">We don’t deliver to {pin} yet.</p>)}
      {returnDays != null && <p className="shipto-l"><span aria-hidden="true">↺</span><strong>{returnable ? `${returnDays} Days Return available` : 'Not returnable'}</strong> <a href="/returns-policy" className="shipto-a small">Know More</a></p>}
    </div>
  );
}
