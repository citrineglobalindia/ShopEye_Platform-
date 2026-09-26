'use client';
import { useEffect, useRef } from 'react';
// Filters are open on desktop; on phones they start collapsed as a drawer (CUST-FR-036)
export function FilterBox({ children, label }: { children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (window.matchMedia('(max-width: 860px)').matches && ref.current) ref.current.open = false; }, []);
  return <details ref={ref} open className="filter-box"><summary><strong>{label}</strong></summary>{children}</details>;
}
