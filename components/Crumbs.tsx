// Breadcrumb trail (used on category, product and help pages)
import Link from 'next/link';
export function Crumbs({ items }: { items: [string, string?][] }) {
  return (
    <nav className="crumbs small" aria-label="Breadcrumb"><ol>
      {items.map(([label, href], i) => <li key={i}>{href ? <Link href={href}>{label}</Link> : <span aria-current="page">{label}</span>}</li>)}
    </ol></nav>
  );
}
