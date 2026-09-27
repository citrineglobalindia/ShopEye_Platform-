'use client';
// SRS: CUST-FR-015 (Continue with Google or Facebook needs the terms box ticked first; the acceptance is recorded when Google sends the shopper back)
// SRS: CUST-FR-005 CUST-FR-007 CUST-FR-012 CUST-FR-018 CUST-FR-010 CUST-FR-011 CUST-FR-017 CUST-FR-021 CUST-FR-008 (return to the interrupted page via ?next; one account per verified email (Supabase Auth unique identity); code sending and verification rate-limited and throttled by Supabase Auth rate limits; sign up from the account page or mid-checkout via ?next; minimal signup data, consent version recorded, no account-existence disclosure, single-use expiring OTP)
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sb } from '@/lib/sb-browser';

// The Google button appears once the Google provider is switched on in Supabase and NEXT_PUBLIC_GOOGLE_SIGNIN=on is set in Vercel
const GOOGLE_ON = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === 'on';
// Facebook appears once the Facebook provider is on in Supabase and NEXT_PUBLIC_FACEBOOK_SIGNIN=on is set in Vercel
const FACEBOOK_ON = process.env.NEXT_PUBLIC_FACEBOOK_SIGNIN === 'on';
function Login() {
  const router = useRouter(); const params = useSearchParams();
  const next = params.get('next') || '/';
  const linkErr = params.get('e') === 'link';
  const noEmail = params.get('e') === 'noemail';
  const [email, setEmail] = useState(''); const [name, setName] = useState('');
  const [agree, setAgree] = useState(false); const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [info, setInfo] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await sb().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
                 data: { ...(name.trim() ? { full_name: name.trim() } : {}), terms_version: '2026-09', privacy_version: '2026-09' } },
    });
    setBusy(false);
    if (error) { setErr(/rate|seconds|security purposes/i.test(error.message) ? 'Please wait a minute before requesting another code.' : /invalid|format/i.test(error.message) ? 'That email address doesn’t look right. Check it and try again.' : 'We couldn’t send the email right now. Please try again in a minute.'); return; }
    setStep('code'); setInfo(`We sent a sign-in code to ${email}. Enter it below, or tap the link in the email on this device.`);
  }
  // Google: the terms box must be ticked here first; the choice travels back through the callback and is recorded there
  async function social(provider: 'google' | 'facebook') {
    setErr('');
    if (!agree) { setErr('Please tick the box to agree to the Terms and Privacy Policy first.'); return; }
    setBusy(true);
    const { error } = await sb().auth.signInWithOAuth({ provider,
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}&consent=1`,
                 ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : { scopes: 'email public_profile' }) } });
    if (error) { setBusy(false); setErr(`${provider === 'google' ? 'Google' : 'Facebook'} sign-in isn’t available right now. Use the email code instead.`); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await sb().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) { setErr(/rate|many/i.test(error.message) ? 'Too many attempts. Wait a few minutes, then request a new code.' : 'That code is wrong or has expired. Request a new one.'); return; }
    router.replace(next); router.refresh();
  }
  return (
    <div className="wrap section" style={{ maxWidth: 520 }}>
      <h1>Sign in or create an account</h1>
      <p className="muted">No password needed. We’ll email you a one-time code{GOOGLE_ON && FACEBOOK_ON ? ', or you can continue with Google or Facebook' : GOOGLE_ON ? ', or you can continue with Google' : FACEBOOK_ON ? ', or you can continue with Facebook' : ''}.</p>
      {linkErr && <div className="msg err" role="alert">That sign-in link didn’t work or has expired. Request a new code below.</div>}
      {noEmail && <div className="msg err" role="alert">Your Facebook account didn’t share an email address, and ShopEye needs one for order confirmations and invoices. Please sign in with your email or Google instead.</div>}
      {step === 'email' ? (
        <form className="form panel" onSubmit={send}>
          <label>Email address<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Full name <span className="muted small">(only needed the first time)</span><input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'start', fontWeight: 400 }}>
            <input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 'auto', marginTop: 4 }} />
            <span>I agree to ShopEye’s Terms and Privacy Policy.</span></label>
          {err && <div className="msg err" role="alert">{err}</div>}
          <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in code'}</button>
          {(GOOGLE_ON || FACEBOOK_ON) && <>
          <div className="or-rule small muted" aria-hidden="true"><span>or</span></div>
          {GOOGLE_ON && <button type="button" className="btn ghost google-btn" disabled={busy} onClick={() => social('google')}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            Continue with Google</button>}
          {FACEBOOK_ON && <button type="button" className="btn ghost google-btn" disabled={busy} onClick={() => social('facebook')}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v2.9h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/></svg>
            Continue with Facebook</button>}
          <p className="small muted" style={{ margin: 0 }}>We only receive your name and email address.</p></>}
        </form>
      ) : (
        <form className="form panel" onSubmit={verify}>
          <div className="msg info">{info}</div>
          <label>Sign-in code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
          {err && <div className="msg err" role="alert">{err}</div>}
          <button className="btn" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Sign in'}</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={(e) => send(e as any)}>Send a new code</button>
          <button type="button" className="linklike" onClick={() => { setStep('email'); setCode(''); setErr(''); }}>Use a different email</button>
        </form>
      )}
    </div>
  );
}
export default function Page() { return <Suspense><Login /></Suspense>; }
