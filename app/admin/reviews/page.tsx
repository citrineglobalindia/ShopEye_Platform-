'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/sb-browser';
import { friendly } from '@/lib/errors';
import { Stars } from '@/components/Reviews';

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
    </div>);
}
