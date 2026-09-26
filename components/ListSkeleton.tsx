// SRS: CUST-FR-155 (results stream in behind a skeleton; the rest of the page stays usable)
export function ListSkeleton() {
  return (
    <div className="grid" aria-busy="true"><span className="sr-only">Loading products…</span>
      {Array.from({ length: 8 }, (_, i) => <div key={i} className="card"><div className="ph sk" /><div className="b"><div className="sk" style={{ height: 12, width: '60%' }} /><div className="sk" style={{ height: 14 }} /><div className="sk" style={{ height: 14, width: '40%' }} /></div></div>)}
    </div>);
}
