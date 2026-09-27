'use client';
// Header "Deliver to": on the first visit the city and pincode are estimated automatically from the network
// (no permission prompt); "Use my current location" asks the browser for GPS for an exact pincode; or type one.
// Shared with the product-page delivery check (same saved pincode).
import { useEffect, useState } from 'react';
const GEO = 'https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en';
type Loc = { pin: string; city?: string; exact?: boolean };
function save(l: Loc) { try { localStorage.setItem('shopeye.pin', l.pin); localStorage.setItem('shopeye.loc', JSON.stringify(l)); } catch {} window.dispatchEvent(new Event('shopeye:pin')); }
async function lookup(q = ''): Promise<Loc | null> {
  try { const d = await (await fetch(GEO + q)).json(); return d?.countryCode === 'IN' && /^[1-9][0-9]{5}$/.test(d.postcode ?? '') ? { pin: d.postcode, city: d.city || d.locality } : null; } catch { return null; }
}
export function DeliverTo({ compact = false }: { compact?: boolean }) {
  const [loc, setLoc] = useState<Loc | null>(null); const [edit, setEdit] = useState(''); const [open, setOpen] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let saved: Loc | null = null;
    try { saved = JSON.parse(localStorage.getItem('shopeye.loc') || 'null') ?? (localStorage.getItem('shopeye.pin') ? { pin: localStorage.getItem('shopeye.pin')! } : null); } catch {}
    if (saved) { setLoc(saved); return; }
    lookup().then((l) => { if (l) { setLoc(l); save(l); } });                    // automatic, approximate
    const on = () => { try { setLoc(JSON.parse(localStorage.getItem('shopeye.loc') || 'null')); } catch {} };
    window.addEventListener('shopeye:pin', on); return () => window.removeEventListener('shopeye:pin', on);
  }, []);
  function useGps() {
    if (!navigator.geolocation) { setErr('Location isn’t available in this browser.'); return; }
    setBusy(true); setErr('');
    navigator.geolocation.getCurrentPosition(async (p) => {
      const l = await lookup(`&latitude=${p.coords.latitude.toFixed(4)}&longitude=${p.coords.longitude.toFixed(4)}`);
      setBusy(false);
      if (!l) { setErr('We couldn’t find a pincode here. Please type it.'); return; }
      const v = { ...l, exact: true }; setLoc(v); save(v); setOpen(false);
    }, () => { setBusy(false); setErr('Location permission was declined. You can type your pincode instead.'); }, { timeout: 10000, maximumAge: 600000 });
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[1-9][0-9]{5}$/.test(edit)) { setErr('Enter a 6-digit pincode'); return; }
    const v = { pin: edit }; setLoc(v); save(v); setOpen(false); setErr('');
  }
  return (
    <div className={`deliver${compact ? ' compact' : ''}`}>
      <button type="button" className="deliver-btn" aria-expanded={open} onClick={() => { setEdit(loc?.pin ?? ''); setOpen((o) => !o); }}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>
        <span><span className="small muted">Deliver to{loc?.city ? ` ${loc.city}` : ''}</span><strong>{loc?.pin ?? 'Select location'}</strong></span>
      </button>
      {open && (
        <div className="deliver-pop panel">
          <button type="button" className="btn ghost sm" onClick={useGps} disabled={busy}>{busy ? 'Finding you…' : '◎ Use my current location'}</button>
          <form onSubmit={submit} className="stack" style={{ gap: 6 }}>
            <label className="small">Or enter a pincode<input value={edit} onChange={(e) => setEdit(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" aria-invalid={!!err} aria-describedby={err ? 'pin-err' : undefined} /></label>
            {err && <span id="pin-err" className="small danger-t" role="alert">{err}</span>}
            <button className="btn sm">Save</button>
          </form>
          {loc && !loc.exact && <p className="small muted" style={{ margin: 0 }}>Estimated from your network. Use your location or type your pincode for accurate delivery dates.</p>}
        </div>)}
    </div>);
}
