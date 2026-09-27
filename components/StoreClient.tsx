'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Slide } from '@/components/Store';

// Auto-advancing hero that pauses on hover/focus and respects reduced-motion; dots are real buttons
export function HeroCarousel({ slides }: { slides: Slide[] }) {
  const [i, setI] = useState(0); const paused = useRef(false);
  useEffect(() => {
    if (slides.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => { if (!paused.current) setI((x) => (x + 1) % slides.length); }, 6000);
    return () => clearInterval(t);
  }, [slides.length]);
  if (!slides.length) return null;
  const s = slides[i];
  return (
    <div className={`hero2-main ${s.tone}`} onMouseEnter={() => (paused.current = true)} onMouseLeave={() => (paused.current = false)}
      onFocus={() => (paused.current = true)} onBlur={() => (paused.current = false)} aria-roledescription="carousel">
      <div className="hero2-copy" aria-live="polite">
        <p className="kicker">{s.sub}</p>
        <h1>{s.title}</h1>
        <Link className="btn" href={s.href}>{s.cta}</Link>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {s.img && <img className="hero2-img" src={s.img.replace('w=900', 'w=1100')} alt="" fetchPriority={i === 0 ? 'high' : 'auto'} />}
      {slides.length > 1 && <div className="dots">{slides.map((_, k) => <button key={k} type="button" aria-label={`Show slide ${k + 1} of ${slides.length}`} aria-current={k === i} onClick={() => setI(k)} />)}</div>}
    </div>);
}

export function Tabs({ labels, panels }: { labels: string[]; panels: React.ReactNode[] }) {
  const [i, setI] = useState(0);
  return (
    <div>
      <div className="ptabs" role="tablist">
        {labels.map((l, k) => <button key={l} role="tab" type="button" aria-selected={k === i} className={k === i ? 'on' : ''} onClick={() => setI(k)}>{l}</button>)}
      </div>
      <div role="tabpanel">{panels[i]}</div>
    </div>);
}
