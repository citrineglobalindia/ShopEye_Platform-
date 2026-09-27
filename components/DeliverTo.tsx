'use client';
// Header "Deliver to": shows the confirmed delivery location; change it with GPS ("Use my current location") or a pincode.
// Shared with the product-page delivery check (same saved pincode).
import { useEffect, useState } from 'react';
import { readLoc, saveLoc as save, detect, type Loc } from '@/lib/location';
export function DeliverTo({ compact = false }: { compact?: boolean }) {
  const [loc, setLoc] = useState<Loc | null>(null); const [edit, setEdit] = useState(''); const [open, setOpen] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLoc(readLoc());
    const on = () => setLoc(readLoc());
    window.addEventListener('shopeye:pin', on); return () => window.removeEventListener('shopeye:pin', on);
  }, []);
  async function useGps() {
    setBusy(true); setErr(''); const r = await detect(); setBusy(false);
    if (r.loc) { setLoc(r.loc); setOpen(false); } else setErr(r.err ?? '');
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[1-9][0-9]{5}$/.test(edit)) { setErr('Enter a 6-digit pincode'); return; }
    const v = { pin: edit, confirmed: true }; setLoc(v); save(v); setOpen(false); setErr('');
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
          {false && <p className="small muted" style={{ margin: 0 }}>Estimated from your network. Use your location or type your pincode for accurate delivery dates.</p>}
        </div>)}
    </div>);
}
