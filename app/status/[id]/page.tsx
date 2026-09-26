'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { testedLabel, markRequirement } from '@/lib/status-ui';

const fmt = (d?: string | null) => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function RequirementPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [copied, setCopied] = useState(false);
  const load = () => fetch(`/api/status?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).then(async (r) => {
    if (r.status === 404) { setErr(`${id} isn’t a requirement ID in the SRS documents.`); return; } setD(await r.json()); }).catch(() => setErr('Could not load this requirement.'));
  useEffect(() => { setD(null); setErr(''); load(); }, [id]);

  async function mark(result: 'passed' | 'failed' | 'cleared') {
    setBusy(true); setMsg('');
    try { await markRequirement(id, result, note); setNote(''); setMsg(result === 'cleared' ? 'QA mark removed.' : `Marked ${result}.`); await load(); }
    catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }
  if (err) return <div className="wrap section stack"><div className="msg err">{err}</div><Link href="/status">Back to all requirements</Link></div>;
  if (!d) return <div className="wrap section">Loading {id}…</div>;
  const r = d.row; const t = testedLabel(r.tested, r.qa);
  return (
    <div className="wrap section stack" style={{ maxWidth: 900 }}>
      <nav className="small" aria-label="Breadcrumb"><Link href="/status">Build status</Link> / <Link href={`/status?portal=${encodeURIComponent(r.portal)}`}>{r.portal}</Link> / {r.id}</nav>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <h1 style={{ margin: 0 }}>{r.id}</h1>
        <span><span className={`chip ${r.status === 'Done' ? 'ok' : r.status === 'In progress' ? 'warn' : ''}`}>{r.status}</span> <span className={`chip ${t.cls}`}>{t.text}</span></span>
      </div>
      <div className="panel stack">
        <div><div className="small muted">Section</div><strong>{r.section}</strong></div>
        <div className="row2"><div><div className="small muted">Portal</div>{r.portal}</div><div><div className="small muted">Delivery phase</div>{r.phase}</div></div>
        {d.admin ? <div><div className="small muted">Requirement (from the SRS)</div><p style={{ margin: 0 }}>{r.text}</p></div>
                 : <p className="small muted" style={{ margin: 0 }}>Sign in as an admin to see the requirement text. The SRS documents are confidential.</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost sm" onClick={() => { navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Link copied' : 'Copy link'}</button>
          {d.prev && <Link className="btn ghost sm" href={`/status/${d.prev}`}>Previous: {d.prev}</Link>}
          {d.next && <Link className="btn ghost sm" href={`/status/${d.next}`}>Next: {d.next}</Link>}
        </div>
      </div>
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Evidence</h2>
        <div><div className="small muted">Implemented in</div>{r.files.length ? <ul style={{ margin: 0 }}>{r.files.map((f: string) => <li key={f}><code>{f}</code></li>)}</ul> : <span>No code cites this requirement yet.</span>}</div>
        <div><div className="small muted">Automated tests that prove it</div>{r.evidence.length ? <ul style={{ margin: 0 }}>{r.evidence.map((e: string) => <li key={e}>{e}</li>)}</ul> : <span>None yet.</span>}</div>
        <div><div className="small muted">Manual QA</div>{r.qa ? <span>{r.qa.result === 'passed' ? 'Passed' : 'Failed'} on {fmt(r.qa.at)}{r.qa.by ? ` by ${r.qa.by}` : ''}{r.qa.note ? `: “${r.qa.note}”` : ''}</span> : <span>Not checked by hand yet.</span>}</div>
        <p className="small muted" style={{ margin: 0 }}>Code status generated {fmt(d.generatedAt)}{d.commit ? ` from commit ${d.commit}` : ''}.</p>
      </div>
      {d.admin && (
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>Mark tested</h2>
          <label>Note <span className="muted small">(required when marking failed)</span>
            <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked, or what went wrong" /></label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy} onClick={() => mark('passed')}>Mark passed</button>
            <button className="btn danger" disabled={busy} onClick={() => mark('failed')}>Mark failed</button>
            {r.qa && <button className="btn ghost" disabled={busy} onClick={() => mark('cleared')}>Remove QA mark</button>}
          </div>
          {msg && <div className="msg info" role="status">{msg}</div>}
          {d.history.length > 0 && (<div className="tablewrap"><table><thead><tr><th>When</th><th>Result</th><th>By</th><th>Note</th></tr></thead>
            <tbody>{d.history.map((h: any, i: number) => <tr key={i}><td className="small">{fmt(h.tested_at)}</td><td>{h.result}</td><td>{h.tested_by_name}</td><td className="small">{h.note}</td></tr>)}</tbody></table></div>)}
        </div>)}
    </div>
  );
}
