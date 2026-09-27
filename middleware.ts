import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, AUTH_COOKIE } from './lib/config';

// Refreshes the auth session cookie on every request
export async function middleware(req: NextRequest) {
  // /Status, /STATUS etc. -> /status (exact-case check avoids a redirect loop)
  const p = req.nextUrl.pathname;
  if (p !== '/status' && p.toLowerCase() === '/status') return NextResponse.redirect(new URL('/status', req.url), 308);
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: AUTH_COOKIE,
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return res;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|api/payments/webhook).*)'] };
