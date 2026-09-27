'use client';
// Add to cart straight from a product card (single-variant or cheapest variant); the product page is still there for choosing size/colour
import { useState } from 'react';
import { friendly } from '@/lib/errors';
import { track } from '@/lib/analytics';
export function QuickAdd({ variantId, price }: { variantId: string; price: number }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle'); const [msg, setMsg] = useState('');
  async function add() {
    setState('busy');
    try {
      const { addToCart } = await import('@/lib/shop-client');
      await addToCart(variantId, 1, price); setState('done');
      track('add_to_cart', { currency: 'INR', value: price, items: [{ item_id: variantId, price, quantity: 1 }] });
      setTimeout(() => setState('idle'), 2500);
    } catch (e) { setMsg(friendly(e)); setState('err'); }
  }
  return <>
    <button className="btn sm" onClick={add} disabled={state === 'busy'} aria-live="polite">{state === 'busy' ? 'Adding…' : state === 'done' ? 'Added ✓' : 'Add to cart'}</button>
    {state === 'err' && <span className="small danger-t" role="alert">{msg}</span>}
  </>;
}
