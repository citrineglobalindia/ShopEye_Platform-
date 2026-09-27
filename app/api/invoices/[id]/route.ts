// SRS: CUST-FR-104 CUST-FR-108 (invoice PDF built on request for the signed-in buyer only; needs the invoice id and its unguessable key; never cached or stored publicly)
import { NextResponse } from 'next/server';
import { sbServer } from '@/lib/sb-server';
import { invoicePdf } from '@/lib/invoice-pdf';
export const dynamic = 'force-dynamic';
const NO_STORE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' };
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const key = new URL(req.url).searchParams.get('k') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{48}$/.test(key)) return new NextResponse('Not found', { status: 404, headers: NO_STORE });
  const db = await sbServer(); const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent('/account/documents')}`, req.url), { headers: NO_STORE });
  const { data, error } = await db.rpc('invoice_document', { p_invoice: id, p_key: key });   // RLS: only the buyer (or the seller / finance)
  if (error || !data) return new NextResponse('Not found', { status: 404, headers: NO_STORE });
  const pdf = invoicePdf(data);
  const name = `${data.invoice.kind === 'credit_note' ? 'credit-note' : 'invoice'}-${String(data.invoice.number).replace(/\//g, '-')}.pdf`;
  return new NextResponse(Buffer.from(pdf), { headers: { ...NO_STORE, 'content-type': 'application/pdf', 'content-disposition': `${new URL(req.url).searchParams.get('dl') ? 'attachment' : 'inline'}; filename="${name}"` } });
}
