'use client';
// SRS: CUST-FR-132 (product questions and answers: first name only, phone numbers, emails and chat links refused, report with reason)
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { sbLazy } from '@/lib/sb-lazy';
import { friendly } from '@/lib/errors';
import { whenIdle } from '@/lib/local-store';

const when = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export function Questions({ productId }: { productId: string }) {
  const [qs, setQs] = useState<any[]>([]); const [me, setMe] = useState<string | null>(null);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const router = useRouter(); const path = usePathname();
  async function load() {
    const db = await sbLazy(); const { data: { session } } = await db.auth.getSession(); setMe(session?.user.id ?? null);
    const { data: q } = await db.from('product_questions').select('id,customer_id,body,status,moderation_note,author_name,created_at')
      .eq('product_id', productId).neq('status', 'removed').order('created_at', { ascending: false }).limit(30);
    const ids = (q ?? []).map((x: any) => x.id);
    const { data: a } = ids.length ? await db.from('product_answers').select('id,question_id,answerer_kind,body,created_at').in('question_id', ids).order('created_at') : { data: [] };
    setQs((q ?? []).map((x: any) => ({ ...x, answers: (a ?? []).filter((y: any) => y.question_id === x.id) })));
  }
  useEffect(() => { whenIdle(load); }, [productId]);
  async function ask(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    if (!me) { router.push(`/login?next=${encodeURIComponent(path + '#qa-h')}`); return; }
    setBusy(true); const { error } = await (await sbLazy()).rpc('ask_question', { p_product: productId, p_body: text }); setBusy(false);
    if (error) { setErr(friendly(error)); return; }
    setText(''); setMsg('Thanks. Your question will appear here once our team has checked it, and we’ll email you when it’s answered.'); load();
  }
  async function report(kind: 'question' | 'answer', id: string) {
    if (!me) { router.push(`/login?next=${encodeURIComponent(path + '#qa-h')}`); return; }
    const reason = prompt('What’s wrong with it? (for example: offensive, spam, not about this product)'); if (!reason) return;
    const { error } = await (await sbLazy()).rpc('report_qa', { p_kind: kind, p_id: id, p_reason: reason });
    setMsg(error ? friendly(error) : 'Thanks. Our team will take a look.');
  }
  async function remove(id: string) {
    if (!confirm('Delete your question?')) return;
    const { error } = await (await sbLazy()).rpc('delete_my_question', { p_question: id }); if (error) setErr(friendly(error)); else load();
  }
  const shown = qs.filter((q) => q.status === 'published' || q.customer_id === me);
  return (
    <section className="section" aria-labelledby="qa-h">
      <div className="rail-head"><h2 id="qa-h">Questions and answers</h2></div>
      <form onSubmit={ask} className="stack" style={{ gap: 8, maxWidth: 640 }} noValidate>
        <label htmlFor="qa-new">Ask about size, fabric, care or delivery</label>
        <textarea id="qa-new" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} aria-describedby="qa-help"
          aria-invalid={!!err} placeholder="Is this saree pre-washed?" />
        <p id="qa-help" className="small muted" style={{ margin: 0 }}>Shown with your first name only. Don’t include phone numbers or email addresses; the seller answers here, in public.</p>
        {err && <div className="msg err" role="alert">{err}</div>}
        {msg && <div className="msg info small" role="status">{msg}</div>}
        <div><button className="btn sm" disabled={busy}>{busy ? 'Sending…' : me ? 'Ask a question' : 'Sign in to ask'}</button></div>
      </form>
      {shown.length === 0 ? <p className="muted">No questions yet.</p> : (
        <div className="rev-list">{shown.map((q) => (
          <article key={q.id} className="rev">
            <p style={{ margin: 0 }}><strong>Q:</strong> {q.body}</p>
            <div className="small muted">{q.author_name} · {when(q.created_at)}
              {q.customer_id === me && q.status !== 'published' && <> · <span className={`chip ${q.status === 'pending' ? 'warn' : 'bad'}`}>{q.status === 'pending' ? 'Waiting for moderation' : 'Not published'}</span>{q.moderation_note ? ` ${q.moderation_note}` : ''}</>}
            </div>
            {q.answers.map((a: any) => (
              <div key={a.id} style={{ margin: '6px 0 0 16px' }}>
                <p style={{ margin: 0 }}><strong>A:</strong> {a.body}</p>
                <div className="small muted">{a.answerer_kind === 'seller' ? 'Seller' : 'ShopEye team'} · {when(a.created_at)}
                  {q.status === 'published' && <> · <button className="linklike" onClick={() => report('answer', a.id)}>Report</button></>}</div>
              </div>))}
            {q.status === 'published' && !q.answers.length && <p className="small muted" style={{ margin: '4px 0 0' }}>Waiting for the seller to answer.</p>}
            <div className="small rev-actions">
              {q.customer_id === me ? <button className="linklike danger-t" onClick={() => remove(q.id)}>Delete</button>
                : q.status === 'published' && <button className="linklike" onClick={() => report('question', q.id)}>Report</button>}
            </div>
          </article>))}</div>)}
    </section>);
}
