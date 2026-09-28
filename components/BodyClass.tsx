'use client';
// Adds a class to <body> while this component is on the page. Cheaper than CSS body:has(...) selectors,
// which make the browser re-check the whole page on every change (a source of scroll jank on phones).
import { useEffect } from 'react';
export function BodyClass({ name }: { name: string }) {
  useEffect(() => { const c = name.split(' ').filter(Boolean); document.body.classList.add(...c); return () => document.body.classList.remove(...c); }, [name]);
  return null;
}
