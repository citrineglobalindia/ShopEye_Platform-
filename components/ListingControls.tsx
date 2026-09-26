'use client';
// SRS: CUST-FR-038 (changing sort or filters keeps the shopper's place: no full reload, no jump to top)
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';

// remember where the shopper was and return there after the results update
function useKeepScroll(pending: boolean) {
  const y = useRef<number | null>(null);
  useEffect(() => { if (!pending && y.current != null) { const t = y.current; y.current = null; requestAnimationFrame(() => window.scrollTo({ top: t })); } }, [pending]);
  return () => { y.current = window.scrollY; };
}

export function SortSelect({ base, params, options }: { base: string; params: Record<string, string | undefined>; options: [string, string][] }) {
  const router = useRouter(); const [pending, start] = useTransition(); const mark = useKeepScroll(pending);
  return (
    <label className="small">Sort by{' '}
      <select defaultValue={params.sort ?? ''} aria-busy={pending} onChange={(e) => {
        const u = new URLSearchParams(); Object.entries(params).forEach(([k, v]) => v && k !== 'sort' && k !== 'page' && u.set(k, v));
        if (e.target.value) u.set('sort', e.target.value); mark();
        start(() => router.push(`${base}${u.toString() ? `?${u}` : ''}`, { scroll: false }));
      }}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {pending && <span className="small muted"> Updating…</span>}
    </label>);
}
export function FilterForm({ base, children }: { base: string; children: React.ReactNode }) {
  const router = useRouter(); const [pending, start] = useTransition(); const mark = useKeepScroll(pending);
  return (
    <form action={base} className="stack" style={{ gap: 14 }} aria-busy={pending} onSubmit={(e) => {
      e.preventDefault(); mark();
      const u = new URLSearchParams(); new FormData(e.currentTarget).forEach((v, k) => { if (String(v)) u.set(k, String(v)); });
      start(() => router.push(`${base}${u.toString() ? `?${u}` : ''}`, { scroll: false }));
      const d = e.currentTarget.closest('details'); if (d && window.matchMedia('(max-width: 860px)').matches) d.open = false;
    }}>{children}</form>);
}
