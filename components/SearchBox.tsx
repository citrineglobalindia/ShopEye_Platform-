'use client';
// SRS: CUST-FR-030 CUST-FR-033 (search as you type: typo-tolerant product and category suggestions, recent searches on this device, keyboard navigable)
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { inr } from '@/lib/config';
type Sug = { products: { id: string; title: string; price: number; image?: string | null }[]; categories: { name: string; slug: string }[] };
const RK = 'shopeye.searches.v1';
export function SearchBox({ placeholder: ph = 'Search for products, brands and more' }: { placeholder?: string }) {
  // the phone home page asks the question the app does
  const onHome = usePathname() === '/'; const placeholder = onHome ? 'What are you looking for ?' : ph;
  const router = useRouter();
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [sug, setSug] = useState<Sug | null>(null);
  const [recent, setRecent] = useState<string[]>([]); const [hi, setHi] = useState(-1); const box = useRef<HTMLFormElement>(null);
  useEffect(() => { try { setRecent(JSON.parse(localStorage.getItem(RK) || '[]')); } catch {} setVoice(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)); }, []);
  // voice search where the browser supports it (Chrome on Android/desktop): Indian English, then search
  const [voice, setVoice] = useState(false); const [listening, setListening] = useState(false); const rec = useRef<any>(null);
  function listen() {
    if (listening) { rec.current?.stop(); return; }
    const R = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!R) return;
    const r = new R(); r.lang = 'en-IN'; r.interimResults = true; r.maxAlternatives = 1; rec.current = r;
    r.onresult = (e: any) => { const t = Array.from(e.results).map((x: any) => x[0].transcript).join(' '); setQ(t); if (e.results[e.results.length - 1].isFinal) go(t); };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    setListening(true); r.start();
  }
  useEffect(() => {
    const t = q.trim(); if (t.length < 2) { setSug(null); return; }
    const c = new AbortController();
    const id = setTimeout(() => fetch(`/api/suggest?q=${encodeURIComponent(t)}`, { signal: c.signal }).then((r) => r.json()).then(setSug).catch(() => {}), 180);
    return () => { clearTimeout(id); c.abort(); };
  }, [q]);
  useEffect(() => { const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off); }, []);
  const items: { label: string; href: string; img?: string | null; sub?: string }[] = q.trim().length < 2
    ? recent.map((r) => ({ label: r, href: `/search?q=${encodeURIComponent(r)}`, sub: 'Recent search' }))
    : [...(sug?.categories ?? []).map((c) => ({ label: c.name, href: `/c/${c.slug}`, sub: 'Category' })),
       ...(sug?.products ?? []).map((p) => ({ label: p.title, href: `/p/${p.id}`, img: p.image, sub: inr(p.price) }))];
  function go(term: string) {
    const t = term.trim(); if (!t) return;
    const next = [t, ...recent.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, 6);
    try { localStorage.setItem(RK, JSON.stringify(next)); } catch {}
    setRecent(next); setOpen(false); router.push(`/search?q=${encodeURIComponent(t)}`);
  }
  function key(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, -1)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter' && hi >= 0 && items[hi]) { e.preventDefault(); setOpen(false); router.push(items[hi].href); }
  }
  return (
    <form ref={box} action="/search" className="search" role="search" onSubmit={(e) => { e.preventDefault(); go(q); }}>
      <input name="q" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(-1); }} onFocus={() => setOpen(true)} onKeyDown={key}
        placeholder={placeholder} aria-label="Search products" autoComplete="off" role="combobox" aria-expanded={open && items.length > 0} aria-controls="search-sug"
        aria-activedescendant={hi >= 0 ? `sug-${hi}` : undefined} />
      {voice && <button type="button" className="mic" aria-label={listening ? 'Listening… tap to stop' : 'Search by voice'} aria-pressed={listening} onClick={listen}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>{listening && <span className="mic-on" aria-hidden="true" />}</button>}
      <button type="submit" aria-label="Search"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></button>
      {open && items.length > 0 && (
        <ul id="search-sug" className="sug panel" role="listbox">
          {items.map((it, k) => (
            <li key={it.href + k} id={`sug-${k}`} role="option" aria-selected={k === hi}>
              <a href={it.href} className={k === hi ? 'on' : ''} onClick={(e) => { e.preventDefault(); setOpen(false); router.push(it.href); }}>
                {it.img ? <img src={it.img.replace(/w=\d+/, 'w=80')} alt="" width={36} height={36} /> : <span className="sug-ic" aria-hidden="true">{it.sub === 'Recent search' ? '↺' : '▦'}</span>}
                <span><span className="sug-t">{it.label}</span><span className="small muted">{it.sub}</span></span>
              </a></li>))}
          {q.trim().length >= 2 && <li role="option" aria-selected={false}><a href={`/search?q=${encodeURIComponent(q.trim())}`} onClick={(e) => { e.preventDefault(); go(q); }} className="sug-all">See all results for “{q.trim()}”</a></li>}
        </ul>)}
    </form>);
}
