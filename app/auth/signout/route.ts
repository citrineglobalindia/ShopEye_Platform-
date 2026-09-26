// SRS: CUST-FR-019 (logout from current session)
import { NextResponse } from 'next/server';
import { sbServer } from '@/lib/sb-server';
export async function GET(req: Request) {
  const supabase = await sbServer(); await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', req.url));
}
