'use client';
// SRS: CUST-FR-049 CUST-FR-128 CUST-FR-129 CUST-FR-130 CUST-FR-131 (no fabricated ratings; verified-purchase marker; write/edit/delete own review with moderation status; helpful and report with abuse controls)
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { sb } from '@/lib/sb-browser';
import { friendly } from '@/lib/errors';

export function Stars({ value, size = 16, label }: { value: number; size?: number; label?: string }) {
  return (
    <span className="stars" role="img" aria-label={label ?? `${value.toFixed(1)} out of 5 stars`} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} aria-hidden="true" className={value >= i - 0.25 ? 'on' : value >= i - 0.75 ? 'half' : ''}>★</span>)}
    </span>);
}

export function ReviewList({ productId, avg, count }: { productId: string; avg: number | null; count: number }) {
  const [items, setItems] = useState<any[]>([]); const [me, setMe] = useState<string | null>(null); const [msg, setMsg] = useState('');
  const router = useRouter(); const path = usePathname();
  async function load() {
    const db = sb(); const { data: { user } } = await db.auth.getUser(); setMe(user?.id ?? null);
    const { data } = await db.from('product_reviews').select('id,customer_id,rating,title,body,status,helpful_count,author_name,created_at,updated_at')
      .eq('product_id', productId).order('helpful_count', { ascending: false }).order('created_at', { ascending: false }).limit(20);
    setItems(data ?? []);
  }
  useEffect(() => { load(); }, [productId]);
  async function vote(id: string, kind: 'helpful' | 'report') {
    if (!me) { router.push(`/login?next=${encodeURIComponent(path)}`); return; }
    let reason: string | null = null;
    if (kind === 'report') { reason = prompt('What’s wrong with this review? (for example: offensive, not about the product, spam)'); if (!reason) return; }
    const { error } = await sb().rpc('vote_review', { p_review: id, p_kind: kind, p_reason: reason });
    setMsg(error ? friendly(error) : kind === 'report' ? 'Thanks. Our team will look at this review.' : 'Thanks for your feedback.'); load();
  }
  const mine = items.find((r) => r.customer_id === me);
  const shown = items.filter((r) => r.status === 'published');
  return (
    <section className="section" aria-labelledby="rev-h">
      <div className="rail-head"><h2 id="rev-h">Ratings and reviews</h2></div>
      {count > 0 && avg ? <div className="rev-sum"><strong className="rev-avg">{Number(avg).toFixed(1)}</strong><div><Stars value={Number(avg)} size={20} /><div className="small muted">{count} verified {count === 1 ? 'review' : 'reviews'}</div></div></div>
                        : <p className="muted">No reviews yet. Reviews come only from customers whose order was delivered.</p>}
      {mine && mine.status !== 'published' && <div className="msg info small">Your review is {mine.status === 'pending' ? 'waiting for moderation. It usually appears within a day.' : `not published: ${mine.status}.`} You can edit it from your order page.</div>}
      {msg && <div className="msg info small" role="status">{msg}</div>}
      <div className="rev-list">{shown.map((r) => (
        <article key={r.id} className="rev">
          <div className="rev-head"><Stars value={r.rating} /> {r.title && <strong>{r.title}</strong>}</div>
          <div className="small muted">{r.author_name} · <span className="chip ok">Verified purchase</span> · {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}{r.updated_at > r.created_at ? ' (edited)' : ''}</div>
          {r.body && <p style={{ margin: '6px 0' }}>{r.body}</p>}
          {r.customer_id !== me && <div className="small rev-actions"><button className="linklike" onClick={() => vote(r.id, 'helpful')}>Helpful{r.helpful_count ? ` (${r.helpful_count})` : ''}</button><button className="linklike" onClick={() => vote(r.id, 'report')}>Report</button></div>}
        </article>))}</div>
    </section>);
}

export function ReviewForm({ productId, title }: { productId: string; title: string }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [existing, setExisting] = useState<any>(null);
  const [rating, setRating] = useState(0); const [t, setT] = useState(''); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { (async () => { const db = sb(); const { data: { user } } = await db.auth.getUser(); if (!user) return;
    const { data } = await db.from('product_reviews').select('id,rating,title,body,status,moderation_note').eq('product_id', productId).eq('customer_id', user.id).maybeSingle();
    if (data) { setExisting(data); setRating(data.rating); setT(data.title ?? ''); setBody(data.body ?? ''); } })(); }, [productId]);
  async function save() {
    if (!rating) { setErr('Choose a star rating.'); return; }
    setBusy(true); setErr('');
    const { data, error } = await sb().rpc('submit_review', { p_product: productId, p_rating: rating, p_title: t, p_body: body }); setBusy(false);
    if (error) { setErr(friendly(error)); return; }
    setExisting({ ...(existing ?? {}), id: data.id, rating, title: t, body, status: data.status }); setOpen(false); router.refresh();
  }
  async function remove() {
    if (!existing || !confirm('Delete your review? This can’t be undone.')) return;
    const { error } = await sb().rpc('delete_my_review', { p_review: existing.id }); if (error) { setErr(friendly(error)); return; }
    setExisting(null); setRating(0); setT(''); setBody('');
  }
  const status = existing && ({ pending: 'Waiting for moderation', published: 'Published', rejected: 'Not published', removed: 'Removed' } as any)[existing.status];
  if (!open) return (
    <span className="rev-inline">
      {existing ? <><span className={`chip ${existing.status === 'published' ? 'ok' : existing.status === 'pending' ? 'warn' : 'bad'}`}>Your review: {status}</span>
        {existing.moderation_note && <span className="small muted"> {existing.moderation_note}</span>}
        <button className="linklike" onClick={() => setOpen(true)}>Edit</button><button className="linklike danger-t" onClick={remove}>Delete</button></>
        : <button className="btn ghost sm" onClick={() => setOpen(true)}>Write a review</button>}
    </span>);
  return (
    <div className="panel stack ret-form">
      <strong>Review “{title}”</strong>
      <fieldset><legend>Your rating</legend>
        <div className="star-pick" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={rating >= n ? 'on' : ''} onClick={() => setRating(n)}>★</button>))}</div>
      </fieldset>
      <label>Headline (optional)<input value={t} onChange={(e) => setT(e.target.value)} maxLength={100} /></label>
      <label>Your review (optional)<textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="Fit, quality, colour, how it compared to the photos…" /></label>
      <p className="small muted" style={{ margin: 0 }}>Shown with your first name and “Verified purchase”. Reviews are checked before they appear; edits are checked again.</p>
      {err && <div className="msg err" role="alert">{err}</div>}
      <div className="cta-row"><button className="btn sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Submit review'}</button><button className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>);
}
