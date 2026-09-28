'use client';
import { BodyClass } from '@/components/BodyClass';
// SRS: CUST-FR-038 (changing sort or filters keeps the shopper's place: no full reload, no jump to top)
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

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
      const a = document.getElementById('filters'); if (a) delete a.dataset.open; document.body.classList.remove('sheet-open');
    }}>{children}</form>);
}

// Phone toolbar (Sort · Filter · Brand) opening bottom sheets, like the mobile app
export function MobileListBar({ base, params, options, filterCount }: { base: string; params: Record<string, string | undefined>; options: [string, string][]; filterCount: number }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const openFilters = (focus?: string) => {
    const a = document.getElementById('filters'); if (!a) return;
    a.dataset.open = 'true'; document.body.classList.add('sheet-open');
    setTimeout(() => (document.getElementById(focus ?? 'filters-close') as HTMLElement | null)?.focus(), 60);
  };
  const [sortOpen, setSortOpen] = useSortState();
  useEffect(() => { document.body.classList.toggle('sheet-open', sortOpen); }, [sortOpen]);
  const [one, setOne] = useState(false);
  useEffect(() => { try { const v = localStorage.getItem('shopeye.grid1') === '1'; setOne(v); document.body.classList.toggle('grid-1', v); } catch {} }, []);
  const toggleGrid = () => { const v = !one; setOne(v); document.body.classList.toggle('grid-1', v); try { localStorage.setItem('shopeye.grid1', v ? '1' : '0'); } catch {} };
  const setSort = (v: string) => {
    const u = new URLSearchParams(); Object.entries(params).forEach(([k, x]) => x && k !== 'sort' && k !== 'page' && u.set(k, x)); if (v) u.set('sort', v);
    setSortOpen(false); start(() => router.push(`${base}${u.toString() ? `?${u}` : ''}`, { scroll: false }));
  };
  return (<>
    <BodyClass name="has-mbar" />
    <div className="m-bar" aria-busy={pending}>
      <button type="button" className="m-grid" aria-label={one ? 'Show two products per row' : 'Show one product per row'} onClick={toggleGrid}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{one ? <><rect x="4" y="4" width="7" height="16" rx="1.5" /><rect x="13" y="4" width="7" height="16" rx="1.5" /></> : <><rect x="4" y="4" width="16" height="7" rx="1.5" /><rect x="4" y="13" width="16" height="7" rx="1.5" /></>}</svg></button>
      <button type="button" onClick={() => setSortOpen(true)}><span className="m-bar-t">⇅ Sort</span><span className="m-bar-s">{options.find(([v]) => v === (params.sort ?? ''))?.[1] ?? 'Relevance'}</span></button>
      <button type="button" onClick={() => openFilters()}><span className="m-bar-t">☰ Filter{filterCount ? <span className="m-badge">{filterCount}</span> : null}</span></button>
    </div>
    {sortOpen && <>
      <div className="sheet-back" onClick={() => setSortOpen(false)} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Sort by">
        <div className="sheet-h"><strong>Sort by</strong><button type="button" className="linklike" onClick={() => setSortOpen(false)} autoFocus>Close</button></div>
        {options.map(([v, l]) => <button key={v} type="button" className={`sheet-opt${(params.sort ?? '') === v ? ' on' : ''}`} onClick={() => setSort(v)}>{l}{(params.sort ?? '') === v ? ' ✓' : ''}</button>)}
      </div></>}
  </>);
}
function useSortState() { return useState(false); }
export function FilterSheetClose() {
  return <button type="button" id="filters-close" className="linklike sheet-x" onClick={() => { const a = document.getElementById('filters'); if (a) delete a.dataset.open; document.body.classList.remove('sheet-open'); }}>Close</button>;
}
