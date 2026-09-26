// SRS: CUST-FR-006 (breadcrumbs on every customer page except home, sign-in and checkout, where they would reduce clarity)
import Link from 'next/link';
export function Crumbs({ items }: { items: [string, string?][] }) {
  return (
    <nav className="crumbs small" aria-label="Breadcrumb"><ol>
      {items.map(([label, href], i) => <li key={i}>{href ? <Link href={href}>{label}</Link> : <span aria-current="page">{label}</span>}</li>)}
    </ol></nav>
  );
}
