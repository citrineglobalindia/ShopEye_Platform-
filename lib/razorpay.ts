import 'server-only';
import crypto from 'node:crypto';
export function rzpConfig() {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  return id && secret ? { id, secret } : null;
}
export async function rzp(path: string, init: RequestInit = {}) {
  const c = rzpConfig(); if (!c) throw new Error('RAZORPAY_NOT_CONFIGURED');
  const r = await fetch(`https://api.razorpay.com/v1${path}`, {
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
