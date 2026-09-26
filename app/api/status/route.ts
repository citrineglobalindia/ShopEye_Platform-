import { NextResponse } from 'next/server';
import { sbServer } from '@/lib/sb-server';
import data from '@/lib/status.generated.json';
export const dynamic = 'force-dynamic';

// SRS text is confidential: only admins receive it. Manual QA sign-offs are merged in live from the database.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  let admin = false; let signoffs: any[] = []; let history: any[] = [];
  try {
    const db = await sbServer();
    const { data: { user } } = await db.auth.getUser();
    if (user) { const { data: roles } = await db.rpc('my_roles'); admin = (roles ?? []).includes('super_admin'); }
    const s = await db.rpc('requirement_signoff_list'); signoffs = s.data ?? [];
    if (id && admin) { const h = await db.rpc('requirement_signoff_history', { p_req: id }); history = h.data ?? []; }
  } catch {}
  const qa = new Map(signoffs.map((s) => [s.req_id, { result: s.result, at: s.tested_at, note: s.note, by: s.tested_by_name }]));
  const d: any = data;
  const shape = (r: any) => { const { text, ...rest } = r; return { ...(admin ? r : rest), qa: qa.get(r.id) ?? null }; };
  const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' };
  if (id) {
    const i = d.rows.findIndex((r: any) => r.id === id);
    if (i < 0) return NextResponse.json({ error: 'not found' }, { status: 404, headers });
    return NextResponse.json({ admin, generatedAt: d.generatedAt, commit: d.commit, row: shape(d.rows[i]), history,
      prev: d.rows[i - 1]?.id ?? null, next: d.rows[i + 1]?.id ?? null }, { headers });
  }
  return NextResponse.json({ generatedAt: d.generatedAt, commit: d.commit, evidenceAt: d.evidenceAt, total: d.total, admin, rows: d.rows.map(shape) }, { headers });
}
