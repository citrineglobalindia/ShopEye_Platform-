const OK = ['confirmed','paid','delivered','completed','active','approved','shipped','refunded','success'];
const WARN = ['pending_payment','initiated','pending','packed','ready_to_ship','processing','partially_shipped','partially_delivered','partially_cancelled','partially_refunded','cod_pending','submitted','under_review','pending_review','requested'];
const BAD = ['cancelled','failed','payment_failed','rejected','suspended','rto_initiated'];
const LABEL: Record<string, string> = { pending_payment: 'Awaiting payment', cod_pending: 'Pay on delivery', ready_to_ship: 'Ready to ship', pending_review: 'In review', under_review: 'Under review' };
export function StatusChip({ s }: { s: string }) {
  const cls = OK.includes(s) ? 'ok' : WARN.includes(s) ? 'warn' : BAD.includes(s) ? 'bad' : '';
  const text = LABEL[s] ?? (s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return <span className={`chip ${cls}`}>{text}</span>;
}
