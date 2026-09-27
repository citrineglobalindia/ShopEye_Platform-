'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { testedLabel, QuickMark, type QA } from '@/lib/status-ui';

type Row = { id: string; portal: string; section: string; phase: string; text?: string; status: string; tested: string; evidence: string[]; files: string[]; qa: QA };
type Data = { generatedAt: string; commit: string | null; evidenceAt: string | null; total: number; admin: boolean; rows: Row[] };
const STATUSES = ['Done', 'In progress', 'Not started'];
const PAGE = 100;
const cls = (s: string) => s === 'Done' || s === 'Passed' ? 'ok' : s === 'In progress' ? 'warn' : '';
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const fmt = (d?: string | null) => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function StatusPage() {
  const [d, setD] = useState<Data | null>(null); const [err, setErr] = useState('');
  const [q, setQ] = useState(''); const [portal, setPortal] = useState(''); const [phase, setPhase] = useState('');
  const [status, setStatus] = useState(''); const [tested, setTested] = useState(''); const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => fetch('/api/status', { cache: 'no-store' }).then((r) => r.json()).then(setD).catch(() => setErr('Could not load status data.'));
  useEffect(() => { const sp = new URLSearchParams(location.search); if (sp.get('q')) setQ(sp.get('q')!); if (sp.get('portal')) setPortal(sp.get('portal')!); load(); }, []);
  useEffect(() => setPage(0), [q, portal, phase, status, tested]);

  const portals = useMemo(() => d ? [...new Set(d.rows.map((r) => r.portal))] : [], [d]);
  const phases = useMemo(() => d ? [...new Set(d.rows.map((r) => r.phase))].sort() : [], [d]);
  const filtered = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    return d.rows.filter((r) => (!portal || r.portal === portal) && (!phase || r.phase === phase) && (!status || r.status === status)
      && (!tested || testedLabel(r.tested, r.qa).key === tested) && (!s || r.id.toLowerCase().includes(s) || r.section.toLowerCase().includes(s) || (r.text ?? '').toLowerCase().includes(s)));
  }, [d, q, portal, phase, status, tested]);

  if (err) return <div className="wrap section"><div className="msg err">{err}</div></div>;
  if (!d) return <div className="wrap section">Loading build status…</div>;
  const done = d.rows.filter((r) => r.status === 'Done').length;
  const prog = d.rows.filter((r) => r.status === 'In progress').length;
  const pass = d.rows.filter((r) => testedLabel(r.tested, r.qa).key === 'Passed').length;
  const byPortal = portals.map((p) => { const rs = d.rows.filter((r) => r.portal === p); return { p, n: rs.length,
    done: rs.filter((r) => r.status === 'Done').length, prog: rs.filter((r) => r.status === 'In progress').length, pass: rs.filter((r) => testedLabel(r.tested, r.qa).key === 'Passed').length }; });
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const exportCsv = () => {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Requirement ID', 'Portal', 'Section', 'Phase', 'Status', 'Tested', ...(d.admin ? ['Requirement'] : [])];
    const body = filtered.map((r) => [r.id, r.portal, r.section, r.phase, r.status, testedLabel(r.tested, r.qa).text, ...(d.admin ? [r.text ?? ''] : [])].map(esc).join(','));
    const url = URL.createObjectURL(new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: 'shopeye-status.csv' }).click();
  };

  return (
    <div className="wrap section stack">
      <div>
        <h1>Build status</h1>
        <p className="muted">Every requirement from the six ShopEye SRS documents, tracked automatically from the code on each deploy.
          Last generated {fmt(d.generatedAt)}{d.commit ? ` from commit ${d.commit}` : ''}. Test evidence from {fmt(d.evidenceAt)}.</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {[['Requirements', d.total, ''], ['Done', done, `${pct(done, d.total)}%`], ['In progress', prog, `${pct(prog, d.total)}%`],
          ['Not started', d.total - done - prog, `${pct(d.total - done - prog, d.total)}%`], ['Tested and passing', pass, `${pct(pass, d.total)}%`]].map(([l, n, p]) => (
          <div key={l as string} className="panel"><div className="small muted">{l}</div><div style={{ font: '700 1.8rem var(--display)' }}>{Number(n).toLocaleString('en-IN')}</div><div className="small muted">{p}</div></div>))}
      </div>

      <section className="panel tablewrap" aria-labelledby="by-portal" tabIndex={0}>
        <h2 id="by-portal">By portal</h2>
        <table><thead><tr><th>Portal</th><th>Requirements</th><th>Done</th><th>In progress</th><th>Tested</th><th style={{ width: '30%' }}>Progress</th></tr></thead>
          <tbody>{byPortal.map((b) => (
            <tr key={b.p} style={{ cursor: 'pointer' }} onClick={() => setPortal(b.p)}>
              <td><strong>{b.p}</strong></td><td>{b.n.toLocaleString('en-IN')}</td><td>{b.done}</td><td>{b.prog}</td><td>{b.pass}</td>
              <td><div role="img" aria-label={`${pct(b.done, b.n)}% done`} style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', background: '#E9EBF3' }}>
                <span style={{ width: `${pct(b.done, b.n)}%`, background: 'var(--ok)' }} /><span style={{ width: `${pct(b.prog, b.n)}%`, background: '#9DBEEA' }} /></div>
                <span className="small muted">{pct(b.done, b.n)}% done, {pct(b.prog, b.n)}% in progress</span></td>
            </tr>))}</tbody></table>
      </section>

      <section className="panel stack" aria-labelledby="all-reqs">
        <h2 id="all-reqs" style={{ margin: 0 }}>All requirements</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <label>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder={d.admin ? 'ID, section or text' : 'ID or section'} /></label>
          <label>Portal<select value={portal} onChange={(e) => setPortal(e.target.value)}><option value="">All portals</option>{portals.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label>Phase<select value={phase} onChange={(e) => setPhase(e.target.value)}><option value="">All phases</option>{phases.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{STATUSES.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label>Tested<select value={tested} onChange={(e) => setTested(e.target.value)}><option value="">Any</option><option>Passed</option><option>Failed</option><option>Not tested</option></select></label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="small muted">{filtered.length.toLocaleString('en-IN')} of {d.total.toLocaleString('en-IN')} shown{!d.admin && '. Sign in as an admin to see the full requirement text.'}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            {(q || portal || phase || status || tested) && <button className="btn ghost sm" onClick={() => { setQ(''); setPortal(''); setPhase(''); setStatus(''); setTested(''); }}>Clear filters</button>}
            <button className="btn ghost sm" onClick={exportCsv}>Download CSV</button></span>
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>ID</th><th>Portal</th><th>Section</th>{d.admin && <th>Requirement</th>}<th>Phase</th><th>Status</th><th>Tested</th></tr></thead>
          <tbody>{shown.map((r) => (<>
            <tr key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
              <td><Link href={`/status/${r.id}`} onClick={(e) => e.stopPropagation()}><strong>{r.id}</strong></Link></td><td className="small">{r.portal}</td><td className="small">{r.section}</td>
              {d.admin && <td className="small" style={{ maxWidth: 420 }}>{r.text}</td>}
              <td className="small">{r.phase}</td><td><span className={`chip ${cls(r.status)}`}>{r.status}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}><span className={`chip ${testedLabel(r.tested, r.qa).cls}`}>{testedLabel(r.tested, r.qa).text}</span>{d.admin && <> <QuickMark id={r.id} qa={r.qa} onDone={load} /></>}</td></tr>
            {open === r.id && (
              <tr key={r.id + '-x'}><td colSpan={d.admin ? 7 : 6} className="small" style={{ background: 'var(--paper)' }}>
                {r.files.length > 0 && <div><strong>Implemented in:</strong> {r.files.join(', ')}</div>}
                {r.evidence.length > 0 && <div><strong>Proven by test:</strong> {r.evidence.join('; ')}</div>}
                <div><Link href={`/status/${r.id}`}>Open requirement page</Link></div>
              </td></tr>)}
          </>))}</tbody></table></div>
        {filtered.length > PAGE && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn ghost sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="small">Page {page + 1} of {Math.ceil(filtered.length / PAGE)}</span>
            <button className="btn ghost sm" disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(page + 1)}>Next</button>
          </div>)}
      </section>

      <section className="panel small">
        <h3>How status is decided</h3>
        <p><strong>Done:</strong> the requirement ID is cited in the code that implements it (website, APIs or database). <strong>In progress:</strong> its section has groundwork in the database but the feature isn’t complete. <strong>Not started:</strong> no code yet.</p>
        <p style={{ margin: 0 }}><strong>Tested:</strong> “Passed (auto)” means an automated test proves the behaviour; “Passed (QA)” or “Failed (QA)” means an admin checked it by hand with Mark tested. Code status updates on its own with every push; QA marks save instantly. Click any ID for its own page and link.</p>
      </section>
    </div>
  );
}
