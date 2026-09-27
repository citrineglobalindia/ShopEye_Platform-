// SRS: CUST-FR-023 (the one-time code in the email link is used once, then the browser is sent on to a clean URL; the response is never cached; the site-wide referrer policy only ever shares our origin, never the path or query; failures show a generic message)
// SRS: CUST-FR-015 (Google and Facebook sign-in: terms accepted on our page first, recorded on return; otherwise the consent page comes before anything else)
// SRS: CUST-FR-016 CUST-FR-024 (return to intended action after sign-in; open-redirect protected)
import { NextResponse } from 'next/server';
import { sbServer } from '@/lib/sb-server';
// Handles the email link (PKCE code or token hash) and returns to the intended page
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';   // no open redirects (CUST validation matrix)
  const supabase = await sbServer();
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = (url.searchParams.get('type') || 'email') as any;
  const { error } = code ? await supabase.auth.exchangeCodeForSession(code)
                  : tokenHash ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
                  : { error: new Error('missing code') };
  // Google sign-ups: record the terms the shopper ticked before leaving for Google; anyone still without consent is asked first (CUST-FR-015)
  // Facebook accounts made with a phone number share no email; ShopEye needs one for orders and invoices
  const providerErr = url.searchParams.get('error_description') || '';
  let dest = error ? (/email/i.test(providerErr) ? '/login?e=noemail' : '/login?e=link') : safeNext;
  if (!error) {
    if (url.searchParams.get('consent') === '1') await supabase.rpc('record_consent');
    const { data: needs } = await supabase.rpc('needs_consent');
    if (needs) dest = `/account/consent?next=${encodeURIComponent(safeNext)}`;
  }
  const res = NextResponse.redirect(new URL(dest, url.origin));
  res.headers.set('cache-control', 'no-store');
  return res;
}
