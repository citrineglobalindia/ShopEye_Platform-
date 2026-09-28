// Tells the phone app bar (components/MobileBar) which title and count to show on this page, and marks the
// page as an inner page (department pages pass `tabs` so the department strip stays visible).
import { BodyClass } from '@/components/BodyClass';
export function MobileTitle({ title, sub, tabs }: { title: string; sub?: string; tabs?: boolean }) {
  return <><span hidden data-mtitle={title} data-mcount={sub} {...(tabs ? { 'data-tabs': '' } : {})} /><BodyClass name={tabs ? 'inner-page tabs-page' : 'inner-page'} /></>;
}
