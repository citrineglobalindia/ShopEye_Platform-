'use client';
// Swipeable carousel (native scroll-snap, so it scrolls at full frame rate) with position dots underneath
import { useRef, useState } from 'react';
export function SwipeDots({ id, count, children }: { id: string; count: number; children: React.ReactNode }) {
  const [i, setI] = useState(0); const el = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={el} id={id} className="swipe" tabIndex={0} role="region" aria-roledescription="carousel"
        onScroll={(e) => { const x = e.currentTarget; const w = (x.firstElementChild as HTMLElement)?.offsetWidth || x.clientWidth; setI(Math.round(x.scrollLeft / (w + 10))); }}>
        {children}
      </div>
      {count > 1 && <div className="sdots">{Array.from({ length: count }, (_, k) => (
        <button key={k} type="button" aria-label={`Show ${k + 1} of ${count}`} aria-current={k === i}
          onClick={() => { const x = el.current; const c = x?.children[k] as HTMLElement | undefined; if (x && c) x.scrollTo({ left: c.offsetLeft - x.offsetLeft, behavior: 'smooth' }); }} />))}</div>}
    </>);
}
