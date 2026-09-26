'use client';
// SRS: CUST-FR-098 CUST-FR-115 CUST-FR-118 CUST-FR-120 (reorder re-validates current price/stock; return with reason and evidence; upload shows progress and retry without losing the form; cancel return while allowed)
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { friendly } from '@/lib/errors';
import { addToCart } from '@/lib/shop-client';

const REASONS: [string, string, boolean][] = [['size_issue', 'Doesn’t fit', false], ['not_as_described', 'Not as described', false], ['damaged', 'Arrived damaged', true],
  ['defective', 'Defective or not working', true], ['wrong_item', 'Wrong item sent', true], ['changed_mind', 'Changed my mind', false]];
type Up = { file: File; state: 'uploading' | 'done' | 'error'; path?: string };

export function ReturnItem({ itemId, max }: { itemId: string; max: number }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [qty, setQty] = useState(1); const [reason, setReason] = useState('size_issue');
  const [details, setDetails] = useState(''); const [ups, setUps] = useState<Up[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const needsPhoto = REASONS.find((r) => r[0] === reason)![2];
  if (!open) return <button className="btn ghost sm" onClick={() => setOpen(true)}>Return item</button>;
  async function upload(u: Up, i: number) {
    setUps((xs) => xs.map((x, k) => k === i ? { ...x, state: 'uploading' } : x));
    const { data: { user } } = await sb().auth.getUser();
    const ext = u.file.type === 'image/png' ? 'png' : u.file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${user!.id}/${itemId}/${crypto.randomUUID()}.${ext}`;       // safe, non-guessable name; original filename not used
    const { error } = await sb().storage.from('return-evidence').upload(path, u.file, { contentType: u.file.type, upsert: false });
    setUps((xs) => xs.map((x, k) => k === i ? { ...x, state: error ? 'error' : 'done', path: error ? undefined : path } : x));
  }
  function pick(files: FileList | null) {
    setErr('');
    const add = [...(files ?? [])].filter((f) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { setErr('Photos must be JPG, PNG or WebP.'); return false; }
      if (f.size > 5 * 1024 * 1024) { setErr('Each photo must be under 5 MB.'); return false; }
      return true; }).slice(0, 4 - ups.length).map((file) => ({ file, state: 'uploading' as const }));
    const start = ups.length; setUps((xs) => [...xs, ...add]); add.forEach((u, k) => upload(u, start + k));
  }
  async function submit() {
    setErr('');
    const paths = ups.filter((u) => u.state === 'done').map((u) => u.path!);
    if (needsPhoto && !paths.length) { setErr('Add at least one photo for damaged, defective or wrong items.'); return; }
    if (ups.some((u) => u.state === 'uploading')) { setErr('Wait for photos to finish uploading.'); return; }
    setBusy(true);
    const { error } = await sb().rpc('request_return', { p_item: itemId, p_qty: qty, p_resolution: 'refund', p_reason: reason,
      p_idem_key: `ret:${itemId}:${qty}:${reason}:${paths.join('|')}`, p_details: details || null, p_evidence: paths, p_pickup: null });
    setBusy(false);
    if (error) { setErr(friendly(error)); return; }
    router.refresh(); setOpen(false);
  }
  return (
    <div className="panel stack ret-form">
      <strong>Return this item</strong>
      <div className="row2">
        {max > 1 ? <label>Quantity<select value={qty} onChange={(e) => setQty(Number(e.target.value))}>{Array.from({ length: max }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</select></label> : <span />}
        <label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <label>Tell us more (optional)<textarea rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
      <div>
        <label>Photos {needsPhoto ? '(required)' : '(optional)'}<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => pick(e.target.files)} disabled={ups.length >= 4} /></label>
        <ul className="uplist">{ups.map((u, i) => (
          <li key={i}><span>{u.file.name}</span>
            {u.state === 'uploading' && <span className="small muted">Uploading…</span>}
            {u.state === 'done' && <span className="small ok-t">Uploaded</span>}
            {u.state === 'error' && <><span className="small bad-t">Upload failed</span> <button className="linklike" onClick={() => upload(u, i)}>Retry</button></>}
            <button className="linklike" onClick={() => setUps((xs) => xs.filter((_, k) => k !== i))} aria-label={`Remove ${u.file.name}`}>Remove</button></li>))}</ul>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Refunds go back to your original payment method after the item passes its quality check.</p>
      {err && <div className="msg err" role="alert">{err}</div>}
      <div className="cta-row"><button className="btn sm" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Request return'}</button><button className="btn ghost sm" onClick={() => setOpen(false)}>Keep item</button></div>
    </div>);
}
export function CancelReturn({ returnId }: { returnId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  return <button className="linklike danger-t" disabled={busy} onClick={async () => {
    if (!confirm('Cancel this return request? You can request a new return while the return window is open.')) return;
    setBusy(true); const { error } = await sb().rpc('cancel_return', { p_return: returnId }); setBusy(false);
    if (error) alert(friendly(error)); else router.refresh(); }}>Cancel return</button>;
}
export function Reorder({ lines }: { lines: { variant_id: string; qty: number; title: string }[] }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  async function go() {
    setBusy(true); setMsg('');
    const ids = lines.map((l) => l.variant_id);
    const { data: cv } = await sb().from('catalog_variants').select('variant_id,product_id,selling_price').in('variant_id', ids);   // current price, active listings only
    const live = new Map((cv ?? []).map((v: any) => [v.variant_id, v]));
    let added = 0; const skipped: string[] = [];
    for (const l of lines) {
      const v = live.get(l.variant_id); if (!v) { skipped.push(l.title); continue; }
      const { data: av } = await sb().rpc('variant_availability', { p_product: v.product_id });
      const stock = (av ?? []).find((a: any) => a.variant_id === l.variant_id)?.available ?? 0;
      if (stock <= 0) { skipped.push(l.title); continue; }
      try { await addToCart(l.variant_id, Math.min(l.qty, stock), Number(v.selling_price)); added++; } catch { skipped.push(l.title); }
    }
    setBusy(false);
    if (added && !skipped.length) router.push('/cart');
    else setMsg(added ? `Added ${added} item${added > 1 ? 's' : ''} at today’s prices. Not available now: ${skipped.join(', ')}.` : `None of these items are available right now.`);
  }
  return <>{msg && <div className="msg info small">{msg} {msg.startsWith('Added') && <a href="/cart">Go to cart</a>}</div>}<button className="btn sm" disabled={busy} onClick={go}>{busy ? 'Adding…' : 'Buy these again'}</button></>;
}
