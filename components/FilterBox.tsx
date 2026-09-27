'use client';
// Filters are open on desktop; on phones they start collapsed as a drawer (CUST-FR-036).
// Collapsed by CSS from the first paint (not by script after load), so the results never jump (layout shift found by scripts/web-vitals-check.py).
import { useEffect, useState } from 'react';
export function FilterBox({ children, label }: { children: React.ReactNode; label: string }) {
  const [mOpen, setMOpen] = useState(false); const [phone, setPhone] = useState(false);
  useEffect(() => { setPhone(window.matchMedia('(max-width: 860px)').matches); }, []);   // only affects the ARIA state, not layout
  return (
    <details open className={`filter-box${mOpen ? ' m-open' : ''}`}>
      <summary aria-expanded={phone ? mOpen : undefined} onClick={(e) => { if (window.matchMedia('(max-width: 860px)').matches) { e.preventDefault(); setMOpen((v) => !v); } }}>
        <strong>{label}</strong></summary>
      {children}
    </details>);
}
