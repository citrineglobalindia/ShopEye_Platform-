'use client';
// Header "Deliver to" pincode: shared with the product-page delivery check (same saved pincode)
import { useEffect, useState } from 'react';
export function DeliverTo() {
  const [pin, setPin] = useState(''); const [edit, setEdit] = useState(''); const [open, setOpen] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { try { setPin(localStorage.getItem('shopeye.pin') ?? ''); } catch {} }, []);
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[1-9][0-9]{5}$/.test(edit)) { setErr('Enter a 6-digit pincode'); return; }
    try { localStorage.setItem('shopeye.pin', edit); } catch {}
    setPin(edit); setOpen(false); setErr(''); window.dispatchEvent(new Event('shopeye:pin'));
  }
  return (
    <div className="deliver hide-sm">
      <button type="button" className="deliver-btn" aria-expanded={open} onClick={() => { setEdit(pin); setOpen((o) => !o); }}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>
        <span><span className="small muted">Deliver to</span><strong>{pin || 'Enter pincode'}</strong></span>
      </button>
      {open && (
        <form className="deliver-pop panel" onSubmit={save}>
          <label className="small">Delivery pincode<input value={edit} onChange={(e) => setEdit(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoFocus aria-invalid={!!err} aria-describedby={err ? 'pin-err' : undefined} /></label>
          {err && <span id="pin-err" className="small danger-t" role="alert">{err}</span>}
          <button className="btn sm">Save</button>
        </form>)}
    </div>);
}
