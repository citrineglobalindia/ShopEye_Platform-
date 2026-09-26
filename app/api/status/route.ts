import { NextResponse } from 'next/server';
import { sbServer } from '@/lib/sb-server';
import data from '@/lib/status.generated.json';
export const dynamic = 'force-dynamic';

// SRS text is confidential: only admins receive it; everyone else gets IDs, sections and status.
export async function GET() {
  let admin = false;
  try {
    const db = await sbServer();
    const { data: { user } } = await db.auth.getUser();
    if (user) { const { data: roles } = await db.rpc('my_roles'); admin = (roles ?? []).some((r: string) => r === 'super_admin'); }
  } catch {}
  const d: any = data;
  const rows = admin ? d.rows : d.rows.map(({ text, ...r }: any) => r);
  return NextResponse.json({ generatedAt: d.generatedAt, commit: d.commit, evidenceAt: d.evidenceAt, total: d.total, admin, rows },
    { headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' } });
}
