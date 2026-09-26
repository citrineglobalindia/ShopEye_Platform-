export default function robots() {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/account', '/checkout', '/cart', '/seller', '/admin', '/api', '/login'] }] };
}
