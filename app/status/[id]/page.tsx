'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { testedLabel, markRequirement, tryHref } from '@/lib/status-ui';

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
  const n = r.notes ?? {};
  // Curated links first, then pages derived from the code that cites this ID; one button per destination
  const links: { label: string; href: string }[] = [];
  for (const l of [...(n.try ?? []), ...(r.pages ?? []).filter((p: any) => p.href)]) if (!links.some((x) => x.href === l.href)) links.push(l);
  const backend = (r.pages ?? []).filter((p: any) => !p.href).map((p: any) => p.label);
  const builtBy = new Map((r.built ?? []).map((b: any) => [b.file, b.note]));
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
      <section className="panel stack" aria-labelledby="fn-h">
        <h2 id="fn-h" style={{ margin: 0 }}>Functionality</h2>
        {n.what ? <p style={{ margin: 0 }}>{n.what}</p>
          : r.built?.length ? <p style={{ margin: 0 }}>{r.built[0].note}.</p>
          : <p className="muted" style={{ margin: 0 }}>{r.status === 'Done' ? 'Built; see the evidence below for where.' : `Not built yet. It is part of the ${r.portal}${r.portal === 'Customer Website' ? '' : ' portal'}, which comes in a later phase.`}</p>}
        <div>
          <div className="small muted">Try it live</div>
          {links.length ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {links.map((l) => <a key={l.href} className="btn sm" href={tryHref(l.href)} target="_blank" rel="noopener">{l.label} ↗</a>)}
            </div>
            : <span>{backend.length ? 'Nothing to click: this works behind the scenes.' : 'No live page yet.'}</span>}
          {backend.length > 0 && <p className="small muted" style={{ margin: '6px 0 0' }}>Also enforced in: {backend.join(', ')}.</p>}
        </div>
        {n.check?.length > 0 && <div><div className="small muted">How to check it</div>
          <ol style={{ margin: '4px 0 0', paddingLeft: 20 }}>{n.check.map((c: string, i: number) => <li key={i}>{c}</li>)}</ol></div>}
        {n.next && <div className="msg info small" role="note"><strong>Waiting on:</strong> {n.next}</div>}
      </section>
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Evidence</h2>
        <div><div className="small muted">Implemented in</div>{r.files.length ? <ul style={{ margin: 0 }}>{r.files.map((f: string) => <li key={f}><code style={{ overflowWrap: 'anywhere' }}>{f}</code>{builtBy.get(f) ? <span className="small muted"> — {String(builtBy.get(f))}</span> : null}</li>)}</ul>
          : r.groundwork?.length ? <div><span>No code cites this requirement on its own yet. Groundwork is in place in:</span><ul style={{ margin: 0 }}>{r.groundwork.map((f: string) => <li key={f}><code style={{ overflowWrap: 'anywhere' }}>{f}</code></li>)}</ul></div>
          : <span>No code cites this requirement yet.</span>}</div>
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
