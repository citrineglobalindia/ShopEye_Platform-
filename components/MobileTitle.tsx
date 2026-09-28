// Tells the phone app bar (components/MobileBar) which title and count to show on this page, and marks the
// page as an inner page. `tabs` keeps the black category strip; `switcher` lists sibling categories for the
// title's ▾ menu (e.g. WOMEN ▾ → Men, Accessories).
import { BodyClass } from '@/components/BodyClass';
export function MobileTitle({ title, sub, tabs, switcher }: { title: string; sub?: string; tabs?: boolean; switcher?: { name: string; slug: string }[] }) {
  return <><span hidden data-mtitle={title} data-mcount={sub} {...(tabs ? { 'data-tabs': '' } : {})} {...(switcher && switcher.length > 1 ? { 'data-mswitch': JSON.stringify(switcher) } : {})} />
    <BodyClass name={tabs ? 'inner-page tabs-page' : 'inner-page'} /></>;
}
