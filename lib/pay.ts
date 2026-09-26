'use client';
// Opens Razorpay Checkout for an order. The server creates the gateway order and
// verifies the result; the browser redirect alone never marks an order paid (CUST-FR-082).
function loadScript(): Promise<void> {
  return new Promise((ok, fail) => {
    if ((window as any).Razorpay) return ok();
    const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => ok(); s.onerror = () => fail(new Error('Could not load the payment window.')); document.body.appendChild(s);
  });
}
export async function payForOrder(orderId: string, prefill: { email?: string; contact?: string; name?: string }): Promise<'paid' | 'pending' | 'dismissed'> {
  const r = await fetch('/api/payments/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order_id: orderId }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Online payment is unavailable right now.');
  await loadScript();
  return new Promise((resolve, reject) => {
    const rzp = new (window as any).Razorpay({
      key: j.key_id, order_id: j.gateway_order_id, amount: j.amount_paise, currency: 'INR', name: 'Shopeye',
      description: `Order ${j.order_number}`, prefill, theme: { color: '#1C2554' },
      handler: async (resp: any) => {
        const v = await fetch('/api/payments/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(resp) });
        const vj = await v.json().catch(() => ({}));
        resolve(v.ok && vj.status === 'paid' ? 'paid' : 'pending');
      },
      modal: { ondismiss: () => resolve('dismissed') },
    });
    rzp.on('payment.failed', () => {});   // Razorpay shows the failure and lets the shopper retry in the same window
    try { rzp.open(); } catch (e) { reject(e); }
  });
}
