'use client';
// SRS: CUST-FR-109 (optional business GSTIN, validated on the server and fixed once the first invoice is issued)
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { friendly } from '@/lib/errors';

export function GstDetails({ orderId, gstin, name, locked }: { orderId: string; gstin: string | null; name: string | null; locked: boolean }) {
  const router = useRouter(); const [open, setOpen] = useState(false);
  const [g, setG] = useState(gstin ?? ''); const [n, setN] = useState(name ?? ''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function save(clear = false) {
    setErr(''); setBusy(true);
    const { error } = await sb().rpc('set_order_gst_details', { p_order: orderId, p_gstin: clear ? null : g, p_legal_name: clear ? null : n }); setBusy(false);
    if (error) { setErr(friendly(error)); return; }
    setOpen(false); router.refresh();
  }
  if (locked) return gstin ? <p className="small" style={{ margin: 0 }}>Business invoice for <strong>{name}</strong>, GSTIN {gstin}. To correct it, <a href={`/support/new?order=${orderId}&category=order`}>contact support</a>.</p> : null;
  if (!open) return (
    <p className="small" style={{ margin: 0 }}>{gstin ? <>Invoice will show <strong>{name}</strong>, GSTIN {gstin}. </> : 'Buying for a business? '}
      <button className="linklike" onClick={() => setOpen(true)}>{gstin ? 'Change' : 'Add your GSTIN'}</button>{gstin && <> · <button className="linklike" onClick={() => save(true)}>Remove</button></>}</p>);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <label>GSTIN<input value={g} onChange={(e) => setG(e.target.value.toUpperCase())} maxLength={15} autoCapitalize="characters" placeholder="29ABCDE1234F1Z5" aria-describedby="gst-help" /></label>
      <label>Registered business name<input value={n} onChange={(e) => setN(e.target.value)} maxLength={200} /></label>
      <p id="gst-help" className="small muted" style={{ margin: 0 }}>Added before your package ships, it appears on the seller’s tax invoice. After that, invoices can only be corrected through support.</p>
      {err && <div className="msg err" role="alert">{err}</div>}
      <div className="cta-row"><button className="btn sm" disabled={busy} onClick={() => save()}>Save</button><button className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>);
}
