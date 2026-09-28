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
    // any press outside an open menu (mouse, touch or pen) closes it at once
    const down = (e: PointerEvent) => { const t = e.target as Element; closeAll(t.closest?.('details.mega, details.acct, details.drawer')); };
    // choosing a link inside a menu closes it
    const click = (e: MouseEvent) => { const t = e.target as Element; const menu = t.closest('details.mega, details.acct, details.drawer'); if (menu && t.closest('a')) (menu as HTMLDetailsElement).open = false; };
    // keyboard users tabbing out of a menu
    const focus = (e: FocusEvent) => { const t = e.target as Element; closeAll(t.closest?.('details.mega, details.acct, details.drawer')); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { const open = document.querySelector<HTMLDetailsElement>(SEL); if (open) { open.open = false; open.querySelector('summary')?.focus(); } } };
    // opening one menu closes the others
    const toggle = (e: Event) => { const d = e.target as HTMLDetailsElement; if (d.open && d.matches('details.mega, details.acct, details.drawer')) closeAll(d); };
    document.addEventListener('pointerdown', down, true); document.addEventListener('click', click); document.addEventListener('focusin', focus); document.addEventListener('keydown', key); window.addEventListener('blur', () => closeAll()); document.addEventListener('toggle', toggle, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('focusin', focus); document.removeEventListener('click', click); document.removeEventListener('keydown', key); document.removeEventListener('toggle', toggle, true); };
  }, []);
  return null;
}
