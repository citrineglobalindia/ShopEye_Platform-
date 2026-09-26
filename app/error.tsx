'use client';
// SRS: CUST-FR-157 (if a service is unavailable the page degrades to a clear message with retry, never a blank or technical error)
import Link from 'next/link';
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="wrap section stack" style={{ maxWidth: 640 }}>
      <h1 style={{ margin: 0 }}>Something went wrong on our side</h1>
      <p className="muted">Your cart and orders are safe. This is usually temporary.</p>
      <div className="cta-row"><button className="btn" onClick={() => reset()}>Try again</button><Link className="btn ghost" href="/">Go to the home page</Link></div>
      <p className="small muted">Still stuck? <Link href="/support/new">Contact us</Link>.</p>
    </div>);
}
