// SRS: CUST-FR-074 CUST-FR-087 CUST-FR-176 (hosted Razorpay checkout; no card data on ShopEye servers)
import { NextResponse } from 'next/server';
import { sbServer, sbService } from '@/lib/sb-server';
import { rzp, rzpConfig, sameSite } from '@/lib/razorpay';
import { logError } from '@/lib/log';

// Creates (or reuses) the Razorpay order for a ShopEye order the caller owns.
export async function POST(req: Request) {
  if (!sameSite(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const cfg = rzpConfig(); const svc = sbService();
  if (!cfg || !svc) return NextResponse.json({ error: 'Online payment is being set up. Choose cash on delivery or try again later.' }, { status: 503 });
  const { order_id } = await req.json().catch(() => ({}));
  const user = await sbServer();
  const { data: { user: me } } = await user.auth.getUser();
  if (!me) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  // RLS: this read only succeeds for the order's owner (CUST-FR-172/173)
  const { data: order } = await user.from('orders').select('id,order_number,grand_total,payment_status,payment_method').eq('id', order_id).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  if (order.payment_method === 'cod') return NextResponse.json({ error: 'This order is cash on delivery.' }, { status: 400 });
  if (['paid', 'partially_refunded', 'refunded'].includes(order.payment_status)) return NextResponse.json({ error: 'This order is already paid.' }, { status: 409 });

  const { data: pay } = await svc.from('payments').select('id,gateway_order_id,amount,status').eq('order_id', order.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!pay) return NextResponse.json({ error: 'Payment record missing. Contact support with your order number.' }, { status: 409 });
  let gatewayOrderId = pay.gateway_order_id;
  try {
    if (!gatewayOrderId) {
      const ro = await rzp('/orders', { method: 'POST', body: JSON.stringify({ amount: Math.round(Number(pay.amount) * 100), currency: 'INR', receipt: order.order_number, notes: { shopeye_order_id: order.id } }) });
      gatewayOrderId = ro.id;
      const { error } = await svc.rpc('svc_attach_gateway_order', { p_order: order.id, p_gateway_order_id: gatewayOrderId });
      if (error) throw error;
    }
  } catch (e: any) {
    logError('payments/create', order.id, e?.message);
    return NextResponse.json({ error: 'We couldn’t start the payment. Please try again.' }, { status: 502 });
  }
  return NextResponse.json({ key_id: cfg.id, gateway_order_id: gatewayOrderId, amount_paise: Math.round(Number(pay.amount) * 100), order_number: order.order_number });
}
