// SRS: AF-FR-0666 AF-FR-0667 (signature verification, idempotent webhook processing)
import { NextResponse } from 'next/server';
import { sbService } from '@/lib/sb-server';
import { hmacHex, safeEqual } from '@/lib/razorpay';
import { logError } from '@/lib/log';

// Razorpay webhook: payment.captured / payment.failed. Signature over the raw body.
export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET; const svc = sbService();
  if (!secret || !svc) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const raw = await req.text();
  const ok = safeEqual(hmacHex(secret, raw), req.headers.get('x-razorpay-signature') || '');
  let evt: any; try { evt = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const p = evt?.payload?.payment?.entity;
  if (!p?.order_id) return NextResponse.json({ status: 'ignored' });
  // The Razorpay account may also serve another website: only payments ShopEye created (tagged at order creation) are ours
  if (!p?.notes?.shopeye_order_id) return NextResponse.json({ status: 'ignored', reason: 'not a ShopEye payment' });
  const eventId = req.headers.get('x-razorpay-event-id') || `${evt.event}:${p.id}`;
  const { data, error } = await svc.rpc('svc_process_payment_event', {
    p_event_id: eventId, p_event_type: evt.event, p_gateway_order_id: p.order_id, p_gateway_payment_id: p.id,
    p_amount: (p.amount ?? 0) / 100, p_payload: { method: p.method, error_code: p.error_code, error_description: p.error_description }, p_signature_ok: ok });
  if (error) { logError('webhook', eventId, error.message); return NextResponse.json({ error: 'retry' }, { status: 500 }); }  // Razorpay retries
  return NextResponse.json({ status: data });
}
