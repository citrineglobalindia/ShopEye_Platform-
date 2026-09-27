'use client';
// Delivery location shared by the header, the first-visit location prompt and the product-page delivery check.
export type Loc = { pin: string; city?: string; exact?: boolean; confirmed?: boolean };
const GEO = 'https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en';
export function readLoc(): Loc | null {
  try { return JSON.parse(localStorage.getItem('shopeye.loc') || 'null'); } catch { return null; }
}
export function saveLoc(l: Loc) {
  try { localStorage.setItem('shopeye.pin', l.pin); localStorage.setItem('shopeye.loc', JSON.stringify(l)); } catch {}
  window.dispatchEvent(new Event('shopeye:pin'));
}
export async function ipGuess(): Promise<Loc | null> {
  try { const d = await (await fetch(GEO)).json(); return d?.countryCode === 'IN' && /^[1-9][0-9]{5}$/.test(d.postcode ?? '') ? { pin: d.postcode, city: d.city || d.locality } : null; } catch { return null; }
}
// GPS position -> pincode: BigDataCloud first, OpenStreetMap where BigDataCloud has no pincode for that spot
export async function fromCoords(lat: number, lon: number): Promise<Loc | { city?: string } | null> {
  try {
    const d = await (await fetch(`${GEO}&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`)).json();
    if (d?.countryCode === 'IN' && /^[1-9][0-9]{5}$/.test(d.postcode ?? '')) return { pin: d.postcode, city: d.city || d.locality };
  } catch {}
  try {
    const d = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, { headers: { 'Accept-Language': 'en' } })).json();
    const ad = d?.address ?? {}; const pin = String(ad.postcode ?? '').replace(/\s/g, '');
    const city = ad.city || ad.town || ad.village || ad.county;
    if (ad.country_code === 'in' && /^[1-9][0-9]{5}$/.test(pin)) return { pin, city };
    return city ? { city } : null;
  } catch { return null; }
}
// Ask the browser for GPS and turn it into a pincode; resolves with a saved location or an error message
export function detect(): Promise<{ loc?: Loc; err?: string }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ err: 'Location isn’t available in this browser. Please type your pincode.' });
    navigator.geolocation.getCurrentPosition(async (p) => {
      const l = await fromCoords(p.coords.latitude, p.coords.longitude);
      if (!l || !('pin' in l)) return resolve({ err: l?.city ? `We found ${l.city} but not your exact pincode. Please type it.` : 'We couldn’t find a pincode for this spot. Please type it.' });
      const v: Loc = { ...(l as Loc), exact: true, confirmed: true }; saveLoc(v); resolve({ loc: v });
    }, (e) => resolve({ err: e.code === 1 ? 'Location access is blocked. Allow it from the lock icon next to the address bar (Site settings → Location), or type your pincode.'
        : e.code === 3 ? 'Finding your location took too long. Try again, or type your pincode.'
        : 'Your device couldn’t find your location (check that Location is switched on). Please type your pincode.' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 });
  });
}
