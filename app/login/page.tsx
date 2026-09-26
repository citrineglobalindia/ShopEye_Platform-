'use client';
// SRS: CUST-FR-010 CUST-FR-011 CUST-FR-017 CUST-FR-021 (minimal signup data, consent version recorded, no account-existence disclosure, single-use expiring OTP)
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sb } from '@/lib/sb-browser';

function Login() {
  const router = useRouter(); const params = useSearchParams();
  const next = params.get('next') || '/';
  const [email, setEmail] = useState(''); const [name, setName] = useState('');
  const [agree, setAgree] = useState(false); const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [info, setInfo] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await sb().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
                 data: name ? { full_name: name.trim(), terms_version: '2026-09', privacy_version: '2026-09' } : undefined },
    });
    setBusy(false);
    if (error) { setErr(/rate|seconds/i.test(error.message) ? 'Please wait a minute before requesting another email.' : 'We couldn’t send the email. Check the address and try again.'); return; }
    setStep('code'); setInfo(`We sent a sign-in link to ${email}. Open it on this device, or enter the 6-digit code if your email shows one.`);
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await sb().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) { setErr('That code is wrong or has expired. Request a new one.'); return; }
    router.replace(next); router.refresh();
  }
  return (
    <div className="wrap section" style={{ maxWidth: 520 }}>
      <h1>Sign in or create an account</h1>
      <p className="muted">No password needed. We’ll email you a secure link.</p>
      {step === 'email' ? (
        <form className="form panel" onSubmit={send}>
          <label>Email address<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Full name <span className="muted small">(only needed the first time)</span><input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'start', fontWeight: 400 }}>
            <input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 'auto', marginTop: 4 }} />
            <span>I agree to ShopEye’s Terms and Privacy Policy.</span></label>
          {err && <div className="msg err" role="alert">{err}</div>}
          <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
        </form>
      ) : (
        <form className="form panel" onSubmit={verify}>
          <div className="msg info">{info}</div>
          <label>6-digit code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></label>
          {err && <div className="msg err" role="alert">{err}</div>}
          <button className="btn" disabled={busy || code.length !== 6}>Sign in</button>
          <button type="button" className="btn ghost" onClick={() => setStep('email')}>Use a different email</button>
        </form>
      )}
    </div>
  );
}
export default function Page() { return <Suspense><Login /></Suspense>; }
