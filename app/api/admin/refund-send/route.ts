// SRS: SA refund administration — send an approved refund to Razorpay. The caller's own session must be allowed to
// approve refunds (checked in the database); the gateway call uses the server key; the result is recorded server-side.
import { NextResponse } from 'next/server';
import { sbServer, sbService } from '@/lib/sb-server';
import { rzp, rzpConfig, sameSite } from '@/lib/razorpay';
import { logError } from '@/lib/log';

export async function POST(req: Request) {
  if (!sameSite(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const svc = sbService();
  if (!rzpConfig() || !svc) return NextResponse.json({ error: 'Payments are not configured on the server.' }, { status: 503 });
  const { refund_id } = await req.json().catch(() => ({}));
  if (typeof refund_id !== 'string' || !/^[0-9a-f-]{36}$/.test(refund_id)) return NextResponse.json({ error: 'Choose a refund.' }, { status: 400 });
  const user = await sbServer();
  const { data: { user: me } } = await user.auth.getUser();
  if (!me) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  const { data: r, error } = await user.rpc('admin_refund_for_gateway', { p_refund: refund_id });      // permission + state checks
  if (error || !r) return NextResponse.json({ error: error?.message?.replace(/^[A-Z_]+: ?/, '') || 'This refund can’t be sent.' }, { status: 400 });
  try {
    const out = await rzp(`/payments/${encodeURIComponent(r.payment_id)}/refund`, {
      method: 'POST', headers: { 'X-Refund-Idempotency': r.id },
      body: JSON.stringify({ amount: Math.round(Number(r.amount) * 100), speed: 'normal', receipt: r.refund_number, notes: { shopeye_refund_id: r.id, order: r.order_number } }) });
    const { data: state } = await svc.rpc('svc_record_refund', { p_refund: r.id, p_gateway_refund_id: out.id, p_status: out.status || 'pending', p_actor: me.id });
    return NextResponse.json({ status: state, gateway_refund_id: out.id });
  } catch (e: any) {
    logError('admin/refund-send', r.id, e?.message);
    await svc.rpc('svc_record_refund', { p_refund: r.id, p_gateway_refund_id: null, p_status: 'failed', p_error: String(e?.message || 'gateway error').slice(0, 200), p_actor: me.id });
    return NextResponse.json({ error: `Razorpay didn’t accept the refund: ${String(e?.message || '').replace(/^RAZORPAY_\d+: ?/, '')}` }, { status: 502 });
  }
}
