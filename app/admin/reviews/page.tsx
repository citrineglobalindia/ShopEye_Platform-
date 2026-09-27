'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/sb-browser';
import { friendly } from '@/lib/errors';
import { Stars } from '@/components/Reviews';

// SRS: CUST-FR-132 (moderate product questions, answer as the ShopEye team, restore answers hidden by reports)
function QuestionModeration() {
  const [pending, setPending] = useState<any[]>([]); const [open, setOpen] = useState<any[]>([]); const [hidden, setHidden] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); const [msg, setMsg] = useState('');
  async function load() {
    const db = sb();
    const [{ data: p }, { data: pub }, { data: h }] = await Promise.all([
      db.from('product_questions').select('id,product_id,body,author_name,report_count,created_at,products(title)').eq('status', 'pending').order('created_at'),
      db.from('product_questions').select('id,product_id,body,author_name,created_at,products(title),product_answers(id)').eq('status', 'published').order('created_at').limit(100),
      db.from('product_answers').select('id,question_id,body,answerer_kind,report_count').eq('status', 'removed').limit(50)]);
    setPending(p ?? []); setOpen((pub ?? []).filter((q: any) => !q.product_answers?.length)); setHidden(h ?? []);
  }
  useEffect(() => { load(); }, []);
  async function decide(id: string, d: 'published' | 'rejected') {
    const note = d === 'rejected' ? prompt('Reason shown to the customer (e.g. “Contains contact details”):') : null;
    if (d === 'rejected' && !note) return;
    const { error } = await sb().rpc('moderate_question', { p_question: id, p_decision: d, p_note: note });
    setMsg(error ? friendly(error) : d === 'published' ? 'Question published.' : 'Question rejected.'); load();
  }
  async function answer(id: string) {
    const { error } = await sb().rpc('answer_question', { p_question: id, p_body: drafts[id] ?? '' });
    setMsg(error ? friendly(error) : 'Answer posted. The customer has been emailed.'); if (!error) setDrafts({ ...drafts, [id]: '' }); load();
  }
  async function restore(id: string) {
    const { error } = await sb().rpc('moderate_answer', { p_answer: id, p_decision: 'published' }); setMsg(error ? friendly(error) : 'Answer restored.'); load();
  }
  return (
    <section className="stack" aria-labelledby="mq-h">
      <h2 id="mq-h" style={{ margin: 0 }}>Product questions</h2>
      {msg && <div className="msg info" role="status">{msg}</div>}
      {!pending.length && !open.length && !hidden.length && <div className="panel empty">No questions need attention.</div>}
      {pending.map((q) => (
        <div key={q.id} className="panel stack">
          <div className="pkg-head"><span><Link href={`/p/${q.product_id}`}>{q.products?.title}</Link> · waiting for moderation</span>{q.report_count > 0 && <span className="chip bad">Reported {q.report_count}×</span>}</div>
          <p style={{ margin: 0 }}>{q.body}</p><div className="small muted">{q.author_name} · {new Date(q.created_at).toLocaleString('en-IN')}</div>
          <div className="cta-row"><button className="btn sm" onClick={() => decide(q.id, 'published')}>Publish</button><button className="btn danger sm" onClick={() => decide(q.id, 'rejected')}>Reject</button></div>
        </div>))}
      {open.map((q) => (
        <div key={q.id} className="panel stack">
          <div className="pkg-head"><span><Link href={`/p/${q.product_id}`}>{q.products?.title}</Link> · not answered yet</span></div>
          <p style={{ margin: 0 }}>{q.body}</p>
          <label>Answer as the ShopEye team<textarea rows={2} maxLength={1000} value={drafts[q.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [q.id]: e.target.value })} /></label>
          <div><button className="btn sm" onClick={() => answer(q.id)}>Post answer</button></div>
        </div>))}
      {hidden.map((a) => (
        <div key={a.id} className="panel stack">
          <div className="pkg-head"><span>Answer hidden after {a.report_count} reports ({a.answerer_kind === 'seller' ? 'seller' : 'ShopEye team'})</span></div>
          <p style={{ margin: 0 }}>{a.body}</p><div><button className="btn ghost sm" onClick={() => restore(a.id)}>Restore</button></div>
        </div>))}
    </section>);
}

export default function ReviewModeration() {
  const [rows, setRows] = useState<any[] | null>(null); const [msg, setMsg] = useState('');
  async function load() {
    const { data, error } = await sb().from('product_reviews').select('id,product_id,rating,title,body,status,report_count,author_name,created_at,products(title)').eq('status', 'pending').order('created_at');
    setRows(error ? [] : data ?? []);
  }
  useEffect(() => { load(); }, []);
  async function decide(id: string, d: 'published' | 'rejected') {
    const note = d === 'rejected' ? prompt('Reason shown to the customer (e.g. “Contains contact details”):') : null;
    if (d === 'rejected' && !note) return;
    const { error } = await sb().rpc('moderate_review', { p_review: id, p_decision: d, p_note: note });
    setMsg(error ? friendly(error) : d === 'published' ? 'Published.' : 'Rejected.'); load();
  }
  if (rows === null) return <div className="wrap section">Loading…</div>;
  return (
    <div className="wrap section stack">
      <div className="order-head"><h1 style={{ margin: 0 }}>Reviews waiting for moderation</h1><Link href="/admin">Back to admin</Link></div>
      {msg && <div className="msg info" role="status">{msg}</div>}
      {!rows.length ? <div className="panel empty">Nothing waiting. (If you expected reviews here, check you’re signed in as an admin or moderator.)</div>
        : rows.map((r) => (
          <div key={r.id} className="panel stack">
            <div className="pkg-head"><span><Link href={`/p/${r.product_id}`}>{r.products?.title}</Link> · <Stars value={r.rating} /></span>{r.report_count > 0 && <span className="chip bad">Reported {r.report_count}×</span>}</div>
            {r.title && <strong>{r.title}</strong>}{r.body && <p style={{ margin: 0 }}>{r.body}</p>}
            <div className="small muted">{r.author_name} · {new Date(r.created_at).toLocaleString('en-IN')}</div>
            <div className="cta-row"><button className="btn sm" onClick={() => decide(r.id, 'published')}>Publish</button><button className="btn danger sm" onClick={() => decide(r.id, 'rejected')}>Reject</button></div>
          </div>))}
      <QuestionModeration />
    </div>);
}
