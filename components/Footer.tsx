import Link from 'next/link';
export function Footer({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="foot">
      <div className="wrap foot-grid">
        <div><strong className="foot-brand">ShopEye</strong><p className="small">Independent Indian sellers. Every listing reviewed before it goes live.</p></div>
        <nav aria-label="Help"><strong>Help</strong><Link href="/help">Help centre</Link><Link href="/contact">Contact us</Link><Link href="/account/orders">Track an order</Link></nav>
        <nav aria-label="Policies"><strong>Policies</strong><Link href="/shipping-policy">Shipping</Link><Link href="/returns-policy">Returns and refunds</Link><Link href="/cancellation-policy">Cancellations</Link></nav>
        <nav aria-label="Company"><strong>Company</strong><Link href="/about">About ShopEye</Link><Link href="/seller">Sell on ShopEye</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
      </div>
      <div className="wrap foot-base small">
        <span>© {new Date().getFullYear()} ShopEye. Prices include GST.</span>
        <span>Payments secured by Razorpay{signedIn && <> · <form action="/auth/signout" method="post" style={{ display: 'inline' }}><button className="linklike foot-signout">Sign out</button></form></>}</span>
      </div>
    </footer>
  );
}
