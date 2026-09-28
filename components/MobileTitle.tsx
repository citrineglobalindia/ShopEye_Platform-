// Tells the phone app bar (components/MobileBar) which title and count to show on this page.
// Department pages pass `tabs` so the black department strip stays visible under the search bar.
export function MobileTitle({ title, sub, tabs }: { title: string; sub?: string; tabs?: boolean }) {
  return <span hidden data-mtitle={title} data-mcount={sub} {...(tabs ? { 'data-tabs': '' } : {})} />;
}
