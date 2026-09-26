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
  return NextResponse.redirect(new URL(error ? '/login?e=link' : safeNext, url.origin));
}
