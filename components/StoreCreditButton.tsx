'use client';
// SRS: CUST-FR-080 (a card/UPI refund not yet sent can be taken instantly as ShopEye store credit instead)
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { friendly } from '@/lib/errors';
export function StoreCreditButton({ refundId, days }: { refundId: string; days: number }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function go() {
    if (!confirm(`Take this refund as ShopEye store credit? It arrives instantly and can be used for ${days} days. This can’t be changed back to your bank.`)) return;
    setBusy(true); const { error } = await sb().rpc('refund_to_store_credit', { p_refund: refundId }); setBusy(false);
    if (error) setErr(friendly(error)); else router.refresh();
  }
  return <>{err && <span className="small danger-t" role="alert">{err} </span>}<button className="linklike" disabled={busy} onClick={go}>{busy ? 'Converting…' : 'Take as store credit instead'}</button></>;
}
