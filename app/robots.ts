// SRS: CUST-FR-184 (private pages not indexable)
export default function robots() {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/account', '/checkout', '/cart', '/seller', '/admin', '/api', '/login', '/status'] }] };
}
