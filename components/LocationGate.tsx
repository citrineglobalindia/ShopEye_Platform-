'use client';
// Delivery location is required before shopping (like other Indian e-commerce apps): on the first visit the
// browser's location prompt opens straight away; if it's declined or unavailable, a pincode must be typed.
// A network-based guess can be confirmed with one tap. Legal and account pages are never blocked.
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { readLoc, saveLoc, ipGuess, detect, type Loc } from '@/lib/location';
const OPEN_PATHS = /^\/(privacy|terms|data-deletion|about|contact|help|login|auth|admin|seller|status|shipping-policy|returns-policy|cancellation-policy)(\/|$)/;
export function LocationGate() {
  const path = usePathname() ?? '/';
  const [need, setNeed] = useState(false); const [guess, setGuess] = useState<Loc | null>(null);
  const [pin, setPin] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const l = readLoc();
    if (l?.confirmed || OPEN_PATHS.test(path)) { setNeed(false); return; }
    setNeed(true);
    ipGuess().then(setGuess);
    // ask the browser right away, the way Google's own apps do; the dialog explains what happens either way
    setBusy(true); detect().then((r) => { setBusy(false); if (r.loc) setNeed(false); else if (r.err) setErr(r.err); });
  }, [path]);
  useEffect(() => { if (need) { document.body.classList.add('gate-open'); setTimeout(() => box.current?.querySelector<HTMLElement>('button, input')?.focus(), 50); } else document.body.classList.remove('gate-open'); }, [need]);
  if (!need) return null;
  async function gps() { setErr(''); setBusy(true); const r = await detect(); setBusy(false); if (r.loc) setNeed(false); else setErr(r.err ?? ''); }
  function typed(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[1-9][0-9]{5}$/.test(pin)) { setErr('Enter a valid 6-digit pincode.'); return; }
    saveLoc({ pin, confirmed: true }); setNeed(false);
  }
  function confirmGuess() { if (guess) { saveLoc({ ...guess, confirmed: true }); setNeed(false); } }
  return (
    <div className="gate-back">
      <div ref={box} className="gate panel" role="dialog" aria-modal="true" aria-labelledby="gate-h" aria-describedby="gate-d"
        onKeyDown={(e) => { if (e.key === 'Tab') { const f = [...(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input') ?? [])]; if (!f.length) return;
          const i = f.indexOf(document.activeElement as HTMLElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } } }}>
        <span className="gate-ic" aria-hidden="true">📍</span>
        <h2 id="gate-h" style={{ margin: 0 }}>Where should we deliver?</h2>
        <p id="gate-d" className="muted small" style={{ margin: 0 }}>We need your delivery location to show what can reach you, delivery dates and charges.</p>
        <button type="button" className="btn" onClick={gps} disabled={busy}>{busy ? 'Detecting your location…' : '◎ Use my current location'}</button>
        {guess && <button type="button" className="btn ghost" onClick={confirmGuess} disabled={busy}>Deliver to {guess.city ? `${guess.city} ` : ''}{guess.pin}</button>}
        <div className="or-rule small muted" aria-hidden="true"><span>or</span></div>
        <form onSubmit={typed} className="gate-form" noValidate>
          <label className="sr-only" htmlFor="gate-pin">Pincode</label>
          <input id="gate-pin" value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(''); }} inputMode="numeric" placeholder="Enter 6-digit pincode" autoComplete="postal-code"
            aria-invalid={!!err && pin.length > 0} aria-describedby={err ? 'gate-err' : undefined} />
          <button className="btn dark">Continue</button>
        </form>
        {err && <p id="gate-err" className="small danger-t" role="alert" style={{ margin: 0 }}>{err}</p>}
        <p className="small muted" style={{ margin: 0 }}>Your location stays on this device. <a href="/privacy">Privacy</a></p>
      </div>
    </div>);
}
