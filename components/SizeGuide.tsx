'use client';
// General women's apparel size chart (body measurements in inches). Sellers' own charts can replace it later.
import { useState } from 'react';
const ROWS: [string, number, number, number][] = [['XS', 32, 26, 35], ['S', 34, 28, 37], ['M', 36, 30, 39], ['L', 38, 32, 41], ['XL', 40, 34, 43], ['XXL', 42, 36, 45]];
export function SizeGuide() {
  const [open, setOpen] = useState(false);
  return (<>
    <button type="button" className="linklike size-guide" onClick={() => setOpen(true)}>Size Guide</button>
    {open && <>
      <div className="sheet-back" onClick={() => setOpen(false)} />
      <div className="sheet size-sheet" role="dialog" aria-modal="true" aria-labelledby="sg-h">
        <div className="sheet-h"><strong id="sg-h">Size guide</strong><button type="button" className="linklike" onClick={() => setOpen(false)} autoFocus>Close</button></div>
        <p className="small muted" style={{ margin: 0 }}>General body measurements in inches. Check the product details for the fit of this item.</p>
        <div className="tablewrap"><table><thead><tr><th>Size</th><th>Bust</th><th>Waist</th><th>Hip</th></tr></thead>
          <tbody>{ROWS.map(([s, b, w, h]) => <tr key={s}><th scope="row">{s}</th><td>{b}</td><td>{w}</td><td>{h}</td></tr>)}</tbody></table></div>
      </div></>}
  </>);
}
export function ShareButton({ title }: { title: string }) {
  const [done, setDone] = useState(false);
  async function share() {
    try { if (navigator.share) await navigator.share({ title, url: location.href }); else { await navigator.clipboard.writeText(location.href); setDone(true); setTimeout(() => setDone(false), 1800); } } catch {}
  }
  return <button type="button" className="sq-btn" onClick={share} aria-label={done ? 'Link copied' : 'Share this product'}>{done ? '✓' : <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>}</button>;
}
