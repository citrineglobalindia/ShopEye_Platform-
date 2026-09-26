import Link from 'next/link';
export default function NotFound() { return <div className="wrap section"><h1>We can’t find that page</h1><p>It may have been removed, or the link is wrong.</p><Link className="btn" href="/">Go to the home page</Link></div>; }
