'use client';
// Header menus (All Categories, account menu, phone drawer) are <details> elements: close them after a link is
// chosen, when the page changes, on a click outside, and on Escape.
import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
const SEL = 'details.mega[open], details.acct[open], details.drawer[open]';
const closeAll = (except?: Element | null) => document.querySelectorAll<HTMLDetailsElement>(SEL).forEach((d) => { if (d !== except) d.open = false; });
export function MenuCloser() {
  const path = usePathname(); const sp = useSearchParams();
  useEffect(() => { closeAll(); }, [path, sp]);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      const t = e.target as Element; const menu = t.closest('details.mega, details.acct, details.drawer');
      if (menu && t.closest('a')) { (menu as HTMLDetailsElement).open = false; return; }   // a link inside a menu was chosen
      closeAll(menu);                                                                      // clicked elsewhere
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { const open = document.querySelector<HTMLDetailsElement>(SEL); if (open) { open.open = false; open.querySelector('summary')?.focus(); } } };
    // opening one menu closes the others
    const toggle = (e: Event) => { const d = e.target as HTMLDetailsElement; if (d.open && d.matches('details.mega, details.acct, details.drawer')) closeAll(d); };
    document.addEventListener('click', click); document.addEventListener('keydown', key); document.addEventListener('toggle', toggle, true);
    return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', key); document.removeEventListener('toggle', toggle, true); };
  }, []);
  return null;
}
