'use client';
// SRS: CUST-FR-040 CUST-FR-052 CUST-FR-053 (compare products; back-in-stock alert names the variant and channel; price-drop alert with opt-out)
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { sbLazy } from '@/lib/sb-lazy';
import { hasSession, whenIdle } from '@/lib/local-store';

export function AlertButton({ variantId, kind, label, onLabel }: { variantId: string; kind: 'back_in_stock' | 'price_drop'; label: string; onLabel: string }) {
  const [on, setOn] = useState(false); const [busy, setBusy] = useState(false); const router = useRouter(); const path = usePathname();
  useEffect(() => { if (!hasSession()) { setOn(false); return; } whenIdle(async () => { const db = await sbLazy(); const { data: { session } } = await db.auth.getSession(); const user = session?.user; if (!user) { setOn(false); return; }
    const { data } = await db.from('product_alerts').select('active').eq('variant_id', variantId).eq('kind', kind).maybeSingle(); setOn(!!data?.active); }); }, [variantId, kind]);
  async function toggle() {
    const { data: { user } } = await (await sbLazy()).auth.getUser(); if (!user) { router.push(`/login?next=${encodeURIComponent(path)}`); return; }
    setBusy(true); const { error } = await (await sbLazy()).rpc('set_product_alert', { p_variant: variantId, p_kind: kind, p_on: !on }); setBusy(false);
    if (!error) setOn(!on);
  }
  return <button type="button" className={`btn ${on ? 'dark' : 'ghost'} sm`} aria-pressed={on} disabled={busy} onClick={toggle}>{on ? onLabel : label}</button>;
}

const CK = 'shopeye.compare.v1', MAX = 4;
export const compareIds = (): string[] => { try { return JSON.parse(localStorage.getItem(CK) || '[]'); } catch { return []; } };
export function CompareToggle({ productId }: { productId: string }) {
  const [on, setOn] = useState(false); const [n, setN] = useState(0); const [msg, setMsg] = useState('');
  useEffect(() => { const ids = compareIds(); setOn(ids.includes(productId)); setN(ids.length); }, [productId]);
  function toggle() {
    let ids = compareIds();
    if (on) ids = ids.filter((x) => x !== productId);
    else { if (ids.length >= MAX) { setMsg(`You can compare up to ${MAX} products. Remove one first.`); return; } ids = [...ids, productId]; }
    localStorage.setItem(CK, JSON.stringify(ids)); setOn(!on); setN(ids.length); setMsg('');
  }
  return <span className="small"><label className="radio" style={{ display: 'inline-flex' }}><input type="checkbox" checked={on} onChange={toggle} /> Compare</label>
    {n > 0 && <> · <a href="/compare">View comparison ({n})</a></>}{msg && <span className="bad-t"> {msg}</span>}</span>;
}
export function clearCompare(id?: string) { localStorage.setItem(CK, JSON.stringify(id ? compareIds().filter((x) => x !== id) : [])); }
