'use client';
// SRS: CUST-FR-068 (optional map pin: drag the pin to the door; details suggested from the pin are only applied
// when the customer taps "Use these details" — the typed address is never overwritten silently)
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { STATES } from '@/lib/config';

export type Pin = { latitude: number; longitude: number; pin_source: 'map' | 'gps' };
export type Suggest = { line2?: string; city?: string; state_code?: string; pincode?: string };
const BLR: [number, number] = [12.9716, 77.5946];
const inIndia = (lat: number, lon: number) => lat >= 6 && lat <= 37.5 && lon >= 68 && lon <= 97.5;
const stateCode = (name?: string) => STATES.find(([, n]) => n.toLowerCase() === String(name ?? '').toLowerCase())?.[0];

async function reverse(lat: number, lon: number): Promise<Suggest | null> {
  try {
    const d = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, { headers: { 'Accept-Language': 'en' } })).json();
    const a = d?.address ?? {}; if (a.country_code !== 'in') return null;
    const pin = String(a.postcode ?? '').replace(/\s/g, '');
    return { line2: [a.road, a.neighbourhood || a.suburb || a.quarter].filter(Boolean).join(', ') || undefined,
             city: a.city || a.town || a.village || a.county, state_code: stateCode(a.state), pincode: /^[1-9][0-9]{5}$/.test(pin) ? pin : undefined };
  } catch { return null; }
}
async function centreForPincode(pin?: string): Promise<[number, number] | null> {
  if (!pin || !/^[1-9][0-9]{5}$/.test(pin)) return null;
  try { const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&country=in&postalcode=${pin}&limit=1`)).json(); return r?.[0] ? [Number(r[0].lat), Number(r[0].lon)] : null; } catch { return null; }
}

export function MapPin({ value, pincode, onPin, onApply }: { value?: Pin | null; pincode?: string; onPin: (p: Pin | null) => void; onApply: (s: Suggest) => void }) {
  const [open, setOpen] = useState(false); const [sug, setSug] = useState<Suggest | null>(null); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const el = useRef<HTMLDivElement>(null); const map = useRef<any>(null); const marker = useRef<any>(null);
  async function place(lat: number, lon: number, source: 'map' | 'gps') {
    if (!inIndia(lat, lon)) { setMsg('Please place the pin inside India.'); return; }
    setMsg(''); onPin({ latitude: Number(lat.toFixed(6)), longitude: Number(lon.toFixed(6)), pin_source: source });
    setBusy(true); setSug(await reverse(lat, lon)); setBusy(false);
  }
  useEffect(() => {
    if (!open || !el.current || map.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      const start: [number, number] = value ? [value.latitude, value.longitude] : (await centreForPincode(pincode)) ?? BLR;
      if (cancelled || !el.current) return;
      const m = L.map(el.current, { zoomControl: true }).setView(start, value ? 17 : 15); map.current = m;
      m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
      const icon = L.divIcon({ className: 'pin-ic', html: '<span></span>', iconSize: [30, 42], iconAnchor: [15, 42] });
      const mk = L.marker(start, { draggable: true, icon, keyboard: true, title: 'Delivery pin (drag to move)' }).addTo(m); marker.current = mk;
      mk.on('dragend', () => { const p = mk.getLatLng(); place(p.lat, p.lng, 'map'); });
      m.on('click', (e: any) => { mk.setLatLng(e.latlng); place(e.latlng.lat, e.latlng.lng, 'map'); });
      if (!value) place(start[0], start[1], 'map');
    })();
    return () => { cancelled = true; };
  }, [open]);
  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);
  function gps() {
    if (!navigator.geolocation) { setMsg('Location isn’t available in this browser.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition((p) => {
      const ll: [number, number] = [p.coords.latitude, p.coords.longitude];
      map.current?.setView(ll, 18); marker.current?.setLatLng(ll); place(ll[0], ll[1], 'gps');
    }, () => { setBusy(false); setMsg('Location access is blocked. Drag the pin instead.'); }, { enableHighAccuracy: true, timeout: 15000 });
  }
  if (!open) return (
    <div className="pin-row">
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>{value ? '📍 Pin set · adjust on map' : '📍 Pin exact location on map (optional)'}</button>
      {value && <button type="button" className="linklike small" onClick={() => onPin(null)}>Remove pin</button>}
    </div>);
  return (
    <div className="pin-box panel stack">
      <div className="pin-head"><strong>Drag the pin to your door</strong><span className="cta-row">
        <button type="button" className="btn ghost sm" onClick={gps} disabled={busy}>◎ Use my location</button>
        <button type="button" className="linklike" onClick={() => setOpen(false)}>Done</button></span></div>
      <div ref={el} className="pin-map" role="application" aria-label="Map: drag the pin or tap the map to set your delivery location" />
      {msg && <p className="small danger-t" role="alert" style={{ margin: 0 }}>{msg}</p>}
      {busy && <p className="small muted" style={{ margin: 0 }}>Looking up this spot…</p>}
      {sug && (sug.line2 || sug.city || sug.pincode) && (
        <div className="pin-sug" role="status">
          <span className="small">Suggested from the pin: <strong>{[sug.line2, sug.city, sug.pincode].filter(Boolean).join(', ')}</strong></span>
          <span className="cta-row"><button type="button" className="btn sm" onClick={() => { onApply(sug); setSug(null); }}>Use these details</button>
            <button type="button" className="btn ghost sm" onClick={() => setSug(null)}>Keep what I typed</button></span>
        </div>)}
      <p className="small muted" style={{ margin: 0 }}>The pin helps the courier find you; your typed address stays as you wrote it unless you tap “Use these details”. Map © OpenStreetMap contributors.</p>
    </div>);
}
