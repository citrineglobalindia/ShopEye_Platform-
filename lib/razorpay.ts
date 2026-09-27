import 'server-only';
// SRS: CUST-FR-169 (ShopEye stores no passwords: sign-in is by email one-time code, issued and stored hashed by Supabase Auth; API secrets such as the Razorpay key secret live only in server-only modules and Vercel env, the Brevo key in Supabase Vault)
import crypto from 'node:crypto';
export function rzpConfig() {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  return id && secret ? { id, secret } : null;
}
export async function rzp(path: string, init: RequestInit = {}) {
  const c = rzpConfig(); if (!c) throw new Error('RAZORPAY_NOT_CONFIGURED');
  // SRS: CUST-FR-156 (timeouts on provider calls; retries only through idempotent paths)
  const r = await fetch(`https://api.razorpay.com/v1${path}`, {
    signal: AbortSignal.timeout(15000),
    ...init, headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${c.id}:${c.secret}`).toString('base64'), ...(init.headers || {}) },
    cache: 'no-store',
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`RAZORPAY_${r.status}: ${j?.error?.description || 'error'}`);
  return j;
}
export function hmacHex(secret: string, data: string) { return crypto.createHmac('sha256', secret).update(data).digest('hex'); }
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// SRS: CUST-FR-171 (state-changing browser calls must come from our own site)
export function sameSite(req: Request) {
  const o = req.headers.get('origin'); if (!o) return true;           // non-browser clients send no Origin
  try { const h = new URL(o).host; return h === new URL(req.url).host || /^(www\.)?shopeye\.in$/.test(h) || /^shop-eye-platform(-[a-z0-9-]+)?\.vercel\.app$/.test(h) || (process.env.NODE_ENV !== 'production' && /^localhost(:\d+)?$/.test(h)); } catch { return false; }
}
