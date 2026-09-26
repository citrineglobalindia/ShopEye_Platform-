// SRS: CUST-FR-082 CUST-FR-083 CUST-FR-085 AF-FR-0079 (server-verified capture, reconcile before re-pay, pending state, no duplicate capture)
import { NextResponse } from 'next/server';
import { sbService } from '@/lib/sb-server';
import { rzp, rzpConfig, hmacHex, safeEqual } from '@/lib/razorpay';

// Called after Checkout success. Verifies the signature, then confirms the
// capture with Razorpay's API before posting — idempotent with the webhook.
export async function POST(req: Request) {
  const cfg = rzpConfig(); const svc = sbService();
  if (!cfg || !svc) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = b;
  if (!oid || !pid || !sig) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const ok = safeEqual(hmacHex(cfg.secret, `${oid}|${pid}`), sig);
  if (!ok) return NextResponse.json({ status: 'pending' }, { status: 400 });
  try {
    let p = await rzp(`/payments/${pid}`);
    if (p.order_id !== oid) return NextResponse.json({ status: 'pending' }, { status: 400 });
    if (p.status === 'authorized') p = await rzp(`/payments/${pid}/capture`, { method: 'POST', body: JSON.stringify({ amount: p.amount, currency: p.currency }) });
    if (p.status !== 'captured') return NextResponse.json({ status: 'pending' });
    const { data, error } = await svc.rpc('svc_process_payment_event', {
      p_event_id: `checkout:${pid}`, p_event_type: 'payment.captured', p_gateway_order_id: oid, p_gateway_payment_id: pid,
      p_amount: p.amount / 100, p_payload: { method: p.method, source: 'checkout_verify' }, p_signature_ok: true });
    if (error) throw error;
    return NextResponse.json({ status: ['processed', 'already_captured', 'duplicate'].includes(data) ? 'paid' : 'pending' });
  } catch (e: any) {
    console.error('payments/verify', oid, e?.message);
    return NextResponse.json({ status: 'pending' });   // webhook will reconcile (CUST-FR-083/085)
  }
}
