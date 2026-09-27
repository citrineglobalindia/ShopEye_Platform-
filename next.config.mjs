/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel image CDN for ShopEye-hosted photos only (Supabase Storage); AVIF/WebP, cached 30 days
  images: { formats: ['image/avif', 'image/webp'], minimumCacheTTL: 2592000, deviceSizes: [360, 480, 640, 828, 1080, 1280],
            imageSizes: [96, 160, 260, 320], remotePatterns: [{ protocol: 'https', hostname: 'byaaaesufrneivzcsxtv.supabase.co', pathname: '/storage/v1/object/public/**' }] },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: [
      // SRS: CUST-FR-149 CUST-FR-168 (content security policy with upgrade-insecure-requests, HSTS for two years including subdomains; http redirects to https at the edge)
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://byaaaesufrneivzcsxtv.supabase.co wss://byaaaesufrneivzcsxtv.supabase.co https://api.razorpay.com https://lumberjack.razorpay.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://api.bigdatacloud.net; frame-src https://api.razorpay.com https://checkout.razorpay.com; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests" },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self "https://api.razorpay.com")' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ] }];
  },
};
export default nextConfig;
