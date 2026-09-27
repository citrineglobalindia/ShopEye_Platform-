// SRS: CUST-FR-019 CUST-FR-149 (logout from the current session; POST from our own pages only, so another site can't sign you out with a link or image)
import { NextResponse } from 'next/server';
import { sbServer } from '@/lib/sb-server';
import { sameSite } from '@/lib/razorpay';
export async function POST(req: Request) {
  if (!sameSite(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = await sbServer(); await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', req.url), 303);
}
// Old bookmarked links: don't sign out on GET, just go home
export function GET(req: Request) { return NextResponse.redirect(new URL('/', req.url), 303); }
