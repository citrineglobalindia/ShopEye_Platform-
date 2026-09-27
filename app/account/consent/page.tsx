'use client';
// SRS: CUST-FR-015 (an account created through Google can't continue until the current terms and privacy notice are accepted)
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { sb } from '@/lib/sb-browser';

function Consent() {
  const router = useRouter(); const sp = useSearchParams();
  const raw = sp.get('next') || '/'; const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  const [agree, setAgree] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function accept(e: React.FormEvent) {
    e.preventDefault(); if (!agree) { setErr('Please tick the box to continue.'); return; }
    setBusy(true); const { error } = await sb().rpc('record_consent'); setBusy(false);
    if (error) { setErr('We couldn’t save that. Please try again.'); return; }
    router.replace(next); router.refresh();
  }
  async function cancel() { await sb().auth.signOut(); router.replace('/'); router.refresh(); }
  return (
    <div className="wrap section" style={{ maxWidth: 560 }}>
      <h1>One more step</h1>
      <p className="muted">Before you use your ShopEye account, please read and accept our <Link href="/terms" target="_blank">Terms</Link> and <Link href="/privacy" target="_blank">Privacy Policy</Link>.</p>
      <form className="form panel" onSubmit={accept}>
        <label style={{ display: 'flex', gap: 10, alignItems: 'start', fontWeight: 400 }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 'auto', marginTop: 4 }} aria-describedby={err ? 'c-err' : undefined} />
          <span>I agree to ShopEye’s Terms and Privacy Policy.</span></label>
        {err && <div id="c-err" className="msg err" role="alert">{err}</div>}
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Accept and continue'}</button>
        <button type="button" className="linklike" onClick={cancel}>Don’t accept and sign out</button>
      </form>
    </div>);
}
export default function Page() { return <Suspense><Consent /></Suspense>; }
